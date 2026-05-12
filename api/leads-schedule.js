const { getSheetsClient, colToLetter, invalidateCache } = require("../lib/sheets");
const { logAuditBatch, genRequestId } = require("../lib/audit");
const { ensureTabHeaders } = require("../lib/sheetsSchema");

function readBody(req) {
  return new Promise((resolve, reject) => {
    let body = "";
    req.on("data", (chunk) => (body += chunk));
    req.on("end", () => {
      try { resolve(JSON.parse(body)); }
      catch { reject(new Error("Invalid JSON")); }
    });
    req.on("error", reject);
  });
}

function normalizeScheduledDate(value) {
  const s = String(value || "").trim();
  if (!s) return "";
  if (s.includes("T")) return s.slice(0, 16);
  const parsed = new Date(s);
  if (!isNaN(parsed.getTime())) {
    const yyyy = parsed.getFullYear();
    const mm = String(parsed.getMonth() + 1).padStart(2, "0");
    const dd = String(parsed.getDate()).padStart(2, "0");
    const hh = String(parsed.getHours()).padStart(2, "0");
    const min = String(parsed.getMinutes()).padStart(2, "0");
    return `${yyyy}-${mm}-${dd}T${hh}:${min}`;
  }
  return "";
}

async function handleScheduleLead(req, res) {
  if (req.method !== "PATCH") {
    res.writeHead(405, { "Content-Type": "application/json" });
    return res.end(JSON.stringify({ ok: false, error: "Method not allowed" }));
  }

  try {
    const data = await readBody(req);
    const id = String(data.id || "").trim();

    if (!id) {
      res.writeHead(400, { "Content-Type": "application/json" });
      return res.end(JSON.stringify({ ok: false, error: "Missing id" }));
    }

    const sheets = await getSheetsClient();
    const spreadsheetId = process.env.CRM_SHEET_ID;

    const getResp = await sheets.spreadsheets.values.get({
      spreadsheetId,
      range: "Leads!A1:AZ5000", // AZ includes gcal_event_id at col AE (index 30)
    });

    const values = getResp.data.values || [];
    let foundIdx = -1;
    for (let i = 1; i < values.length; i++) {
      if (String(values[i]?.[0] || "").trim() === id) { foundIdx = i; break; }
    }

    if (foundIdx === -1) {
      res.writeHead(404, { "Content-Type": "application/json" });
      return res.end(JSON.stringify({ ok: false, error: "Lead not found" }));
    }

    const row = values[foundIdx] || [];
    while (row.length < 20) row.push("");

    const depositRequired = String(row[6] || "").toLowerCase() === "true";
    const depositReceived = Number(row[10] || 0);
    const depositOverride = data.deposit_override === true;

    const reqId = genRequestId();
    const oldSnap = row.slice();

    if (depositRequired && depositReceived <= 0 && !depositOverride) {
      res.writeHead(400, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ok: false, error: "DEPOSIT_REQUIRED" }));
      const { logAudit } = require("../lib/audit");
      logAudit({ action: "lead.status.blocked", entity_type: "lead", entity_id: id, field: "status", old_value: String(row[8] || ""), new_value: "Scheduled", note: "Deposit required but not received", source: "crm-leads", request_id: reqId }).catch(() => {});
      return;
    }

    row[8] = "Scheduled";
    row[13] = normalizeScheduledDate(data.scheduled_date);
    row[14] = String(data.assigned_to || "");
    row[16] = String(data.schedule_window || row[16] || "");
    row[17] = String(data.schedule_preference || row[17] || "");
    row[18] = String(Math.max(0, Math.min(1440, Math.round(Number(data.duration_minutes || 0)))));
    row[19] = String(depositOverride);

    const headers = values[0] || [];
    while (row.length < headers.length) row.push(""); // ensure row covers all columns

    const sheetRow = foundIdx + 1;
    const endColLetter = colToLetter(Math.max(headers.length - 1, 19)); // at least T (index 19)
    await sheets.spreadsheets.values.update({
      spreadsheetId,
      range: `Leads!A${sheetRow}:${endColLetter}${sheetRow}`,
      valueInputOption: "RAW",
      requestBody: { majorDimension: "ROWS", values: [row.slice(0, headers.length)] },
    });

    const leadId = String(row[0] || "").trim();
    const lead = {
      id: leadId, status: row[8], scheduled_date: row[13],
      assigned_to: row[14], duration_minutes: Number(row[18]),
      deposit_override: depositOverride,
    };

    invalidateCache(spreadsheetId, "Leads");
    invalidateCache(spreadsheetId, "Bookings");

    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ ok: true, lead }));

    // ── Fire-and-forget: upsert a Booking row so crew portal can see the job ──
    setImmediate(async () => {
      try {
        await ensureTabHeaders("Bookings");
        const scheduledDt = row[13] || "";
        if (!scheduledDt || !leadId) return;
        const bkResp = await sheets.spreadsheets.values.get({ spreadsheetId, range: "Bookings!A:Z" });
        const bkRows = bkResp.data.values || [];
        const bkHdrs = bkRows[0] || [];
        const bkIdx  = Object.fromEntries(bkHdrs.map((h, i) => [String(h).trim(), i]));
        const bkGet  = (r, col) => String(r[bkIdx[col] ?? -1] ?? "").trim();

        // Find existing booking for this lead (by lead_id or by booking_id stored in lead row)
        const hdrsArr = values[0] || [];
        const hIdx    = Object.fromEntries(hdrsArr.map((h, i) => [String(h).trim(), i]));
        const existingBkId = String(row[hIdx["booking_id"] ?? -1] || "").trim();
        let existingRowIdx = -1;
        for (let i = 1; i < bkRows.length; i++) {
          const bkLid = bkGet(bkRows[i], "lead_id");
          const bkBid = bkGet(bkRows[i], "booking_id");
          if ((bkLid && bkLid === leadId) || (existingBkId && bkBid === existingBkId)) {
            existingRowIdx = i;
            break;
          }
        }

        const leadName   = String(row[hIdx["name"]    ?? 2]  || "").trim();
        const leadPhone  = String(row[hIdx["phone"]   ?? 3]  || "").trim();
        const leadAddr   = String(row[hIdx["address"] ?? 4]  || "").trim();
        const leadEmail  = String(row[hIdx["email"]   ?? -1] ?? "").trim();
        const schedBlock = String(row[hIdx["schedule_window"] ?? 16] || "").trim();
        const durMins    = String(Number(row[hIdx["duration_minutes"] ?? 18]) || 90);
        const assignedTo = String(row[hIdx["assigned_to"] ?? 14] || "").trim();
        const quoteId    = String(row[hIdx["last_quote_id"] ?? -1] ?? "").trim();

        if (existingRowIdx > 0) {
          // Update existing booking row
          const bkRow = [...bkRows[existingRowIdx]];
          while (bkRow.length < bkHdrs.length) bkRow.push("");
          if (bkIdx["scheduled_datetime"] != null) bkRow[bkIdx["scheduled_datetime"]] = scheduledDt;
          if (bkIdx["schedule_block"]     != null) bkRow[bkIdx["schedule_block"]]     = schedBlock;
          if (bkIdx["duration_minutes"]   != null) bkRow[bkIdx["duration_minutes"]]   = durMins;
          if (bkIdx["assigned_to"]        != null) bkRow[bkIdx["assigned_to"]]        = assignedTo;
          if (bkIdx["assigned_crew_names"]!= null) bkRow[bkIdx["assigned_crew_names"]]= assignedTo;
          if (bkIdx["status"]             != null && bkGet(bkRows[existingRowIdx], "status") !== "cancelled") bkRow[bkIdx["status"]] = "confirmed";
          const endC = colToLetter(bkHdrs.length - 1);
          await sheets.spreadsheets.values.update({
            spreadsheetId, range: `Bookings!A${existingRowIdx + 1}:${endC}${existingRowIdx + 1}`,
            valueInputOption: "RAW", requestBody: { values: [bkRow.slice(0, bkHdrs.length)] },
          });
          console.log(`[leads-schedule] Updated existing Booking row ${existingRowIdx + 1} for lead ${leadId}`);
        } else {
          // Create new booking row
          const newBkId = `BK-${Date.now()}-${Math.random().toString(36).slice(2, 6).toUpperCase()}`;
          const newRow  = bkHdrs.map(h => {
            switch (h) {
              case "booking_id":         return newBkId;
              case "quote_id":           return quoteId;
              case "lead_id":            return leadId;
              case "created_at":         return new Date().toISOString();
              case "scheduled_datetime": return scheduledDt;
              case "duration_minutes":   return durMins;
              case "address":            return leadAddr;
              case "customer_name":      return leadName;
              case "phone":              return leadPhone;
              case "email":              return leadEmail;
              case "status":             return "confirmed";
              case "schedule_block":     return schedBlock;
              case "assigned_to":        return assignedTo;
              case "assigned_crew_names":return assignedTo;
              default:                   return "";
            }
          });
          await sheets.spreadsheets.values.append({
            spreadsheetId, range: "Bookings!A:A",
            valueInputOption: "RAW", insertDataOption: "INSERT_ROWS",
            requestBody: { values: [newRow] },
          });
          // Also write the booking_id back to the Lead row
          if (hIdx["booking_id"] != null) {
            const bkIdColLetter = colToLetter(hIdx["booking_id"]);
            sheets.spreadsheets.values.update({
              spreadsheetId, range: `Leads!${bkIdColLetter}${sheetRow}`,
              valueInputOption: "RAW", requestBody: { values: [[newBkId]] },
            }).catch(() => {});
          }
          console.log(`[leads-schedule] Created Booking ${newBkId} for lead ${leadId}`);
        }
      } catch (bkErr) {
        console.error("[leads-schedule] Booking upsert error:", bkErr.message);
      }
    });

    // ── Fire-and-forget: Google Calendar push ─────────────────────
    setImmediate(async () => {
      try {
        const { createJobGCalEvent, updateGCalEvent, writeGCalEventIdToSheet } = require("../lib/googleCalendar");
        const gcalColIdx = headers.indexOf("gcal_event_id");
        const existing   = gcalColIdx >= 0 ? String(oldSnap[gcalColIdx] || "") : "";
        const schedDate  = row[13];
        const durMins    = Math.max(30, Number(row[18]) || 120);
        const leadName   = String(row[2]  || "");
        const leadAddr   = String(row[4]  || "");
        const jobType    = String(row[5]  || "");
        const leadNotes  = String(row[15] || "");

        // Estimate detection: union of old + new status so transitions in either direction are caught.
        const combinedStatus = (String(oldSnap[8] || "") + " " + String(row[8] || "")).toLowerCase();
        const isEstimate = combinedStatus.includes("estimate") || combinedStatus.includes("quote");
        const titlePrefix = isEstimate ? "Estimate" : "Job";
        const titleSuffix = jobType ? `${jobType} – ${leadName}` : leadName;
        const gcalTitle = `${titlePrefix} – ${titleSuffix}${leadAddr ? " – " + leadAddr.split(",")[0] : ""}`;

        if (existing) {
          const [gcalEventId, calendarId] = existing.split("|");
          if (gcalEventId && calendarId && schedDate) {
            const { addMinutesToISO } = require("../lib/googleCalendar");
            const endDT = addMinutesToISO(schedDate.slice(0, 16), durMins) || null;
            const updated = await updateGCalEvent({
              calendarId, gcalEventId,
              title: gcalTitle, type: titlePrefix.toLowerCase(),
              startDT: schedDate, endDT, notes: leadNotes, isAllDay: false,
            });
            if (!updated) {
              // Event missing from GCal — create fresh
              const freshResult = await createJobGCalEvent({
                title: gcalTitle, status: "Scheduled",
                scheduledDate: schedDate, durationMinutes: durMins,
                address: leadAddr, notes: leadNotes,
              });
              if (freshResult && freshResult.gcalEventId && gcalColIdx >= 0) {
                await writeGCalEventIdToSheet({
                  tab: "Leads", idCol: 0, idValue: id,
                  gcalCol: gcalColIdx, gcalEventId: freshResult.gcalEventId, calendarId: freshResult.calendarId,
                });
              }
            }
          }
        } else if (schedDate) {
          const result = await createJobGCalEvent({
            title: gcalTitle, status: "Scheduled",
            scheduledDate: schedDate, durationMinutes: durMins,
            address: leadAddr, notes: leadNotes,
          });
          if (result && result.gcalEventId && gcalColIdx >= 0) {
            await writeGCalEventIdToSheet({
              tab: "Leads", idCol: 0, idValue: id,
              gcalCol: gcalColIdx, gcalEventId: result.gcalEventId, calendarId: result.calendarId,
            });
          }
        }
      } catch (gcalErr) {
        console.error("[leads-schedule] GCal push error:", gcalErr.message);
      }
    });

    // Audit: log changed schedule fields
    const schedFields = { 8: "status", 13: "scheduled_date", 14: "assigned_to", 18: "duration_minutes", 19: "deposit_override" };
    const entries = [];
    for (const [idx, fname] of Object.entries(schedFields)) {
      const i = Number(idx);
      if (String(oldSnap[i] || "") !== String(row[i] || "")) {
        entries.push({ action: "lead.schedule", entity_type: "lead", entity_id: id, field: fname, old_value: String(oldSnap[i] || ""), new_value: String(row[i] || ""), source: "crm-leads", request_id: reqId });
      }
    }
    if (entries.length > 0) logAuditBatch(entries).catch(() => {});
  } catch (err) {
    res.writeHead(500, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ ok: false, error: err.message }));
  }
}

module.exports = { handleScheduleLead };

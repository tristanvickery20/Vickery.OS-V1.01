// api/leads-update.js
const { getSheetsClient } = require("../lib/sheets");
const { logAuditBatch, genRequestId } = require("../lib/audit");

// Promotion: when a Lead enters any of these stages, it becomes a "Client" record.
// (We keep sheets normalized, UI can still be collapsed into one Clients screen.)
const PROMOTION_STATUSES = new Set([
  "Scheduled",
  "In Progress",
  "Complete",
  "Invoiced",
  "Paid",
  "Closed",
]);

function nowISO() {
  return new Date().toISOString();
}

function todayISO() {
  return new Date().toISOString().split("T")[0];
}

function parseNum(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

function toBoolStr(v) {
  return String(Boolean(v));
}

function normStr(v) {
  return String(v || "").trim();
}

function isTruthy(v) {
  const s = String(v || "").toLowerCase().trim();
  return s === "true" || s === "1" || s === "yes" || s === "y";
}

function toDatetimeLocalString(d) {
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  const hh = String(d.getHours()).padStart(2, "0");
  const min = String(d.getMinutes()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}T${hh}:${min}`;
}

function normalizeScheduledDate(value) {
  if (value === null || value === undefined) return null;
  const s = String(value).trim();
  if (!s) return "";
  if (s.includes("T")) return s.slice(0, 16);
  const parsed = new Date(s);
  if (!isNaN(parsed.getTime())) return toDatetimeLocalString(parsed);
  return null;
}

function clampDurationMinutes(v) {
  if (v === null || v === undefined) return null;
  const n = Number(v);
  if (!Number.isFinite(n)) return null;
  return Math.max(0, Math.min(1440, Math.round(n)));
}

function stageError(res, msg) {
  res.writeHead(400, { "Content-Type": "application/json" });
  return res.end(JSON.stringify({ ok: false, error: "INVALID_STAGE_TRANSITION", message: msg }));
}

async function hasTimeEntries(sheets, spreadsheetId, leadId) {
  try {
    const resp = await sheets.spreadsheets.values.get({
      spreadsheetId,
      range: "Time!A1:Z5000",
    });
    const values = resp.data.values || [];
    if (values.length < 2) return false;

    const headers = values[0] || [];
    const leadIdx = headers.indexOf("lead_id");
    if (leadIdx < 0) return false;

    return values.slice(1).some((r) => String(r?.[leadIdx] || "") === leadId);
  } catch {
    return false;
  }
}

function pad4(n) {
  const s = String(n);
  return s.length >= 4 ? s : "0".repeat(4 - s.length) + s;
}

function nextIdWithPrefix(existingIds, prefix) {
  let max = 0;
  for (const id of existingIds) {
    const s = String(id || "").trim();
    if (!s.startsWith(prefix)) continue;
    const num = Number(s.slice(prefix.length));
    if (Number.isFinite(num) && num > max) max = num;
  }
  return prefix + pad4(max + 1);
}

async function readTabRaw(sheets, spreadsheetId, tabName) {
  try {
    const resp = await sheets.spreadsheets.values.get({
      spreadsheetId,
      range: `${tabName}!A1:Z5000`,
    });
    const values = resp.data.values || [];
    const headers = values[0] || [];
    const rows = values.length >= 2 ? values.slice(1) : [];
    return { headers, rows };
  } catch {
    return { headers: [], rows: [] };
  }
}

async function upsertClientAndPropertyFromLead({
  sheets,
  spreadsheetId,
  lead,
}) {
  // lead fields from Leads sheet
  const leadName = normStr(lead.name);
  const leadPhone = normStr(lead.phone);
  const leadEmail = normStr(lead.email); // might not exist in Leads; we handle safely
  const leadAddress = normStr(lead.address);
  const leadNotes = normStr(lead.notes);

  const now = nowISO();

  // ----- CLIENTS -----
  const clientsTab = await readTabRaw(sheets, spreadsheetId, "Clients");
  const ch = clientsTab.headers || [];
  const cr = clientsTab.rows || [];

  const c_id = ch.indexOf("id");
  const c_phone = ch.indexOf("phone");
  const c_name = ch.indexOf("name");
  const c_email = ch.indexOf("email");
  const c_created = ch.indexOf("created_at");
  const c_updated = ch.indexOf("updated_at");
  const c_sms = ch.indexOf("sms_opt_in");
  const c_desc = ch.indexOf("job_description");
  const c_status = ch.indexOf("status_code");
  const c_last = ch.indexOf("last_activity_at");

  const existingClientIds = [];
  let matchedClientId = "";

  for (const row of cr) {
    if (c_id >= 0) existingClientIds.push(row[c_id]);
    const rowPhone = c_phone >= 0 ? String(row[c_phone] || "").trim() : "";
    if (!matchedClientId && leadPhone && rowPhone === leadPhone) {
      matchedClientId = c_id >= 0 ? String(row[c_id] || "").trim() : "";
    }
  }

  // If lead already has a client_id, prefer it
  const finalClientId = lead.client_id ? lead.client_id : (matchedClientId || nextIdWithPrefix(existingClientIds, "C-"));

  // Upsert client row only if it doesn't exist by ID
  let clientIdExists = false;
  for (const row of cr) {
    const idv = c_id >= 0 ? String(row[c_id] || "").trim() : "";
    if (idv && idv === finalClientId) { clientIdExists = true; break; }
  }

  if (!clientIdExists) {
    // Build row in EXACT Clients schema order (Ticket 10)
    const newClientRow = [
      finalClientId,     // id
      now,               // created_at
      now,               // updated_at
      leadName,          // name
      leadPhone,         // phone
      leadEmail,         // email
      "",                // sms_opt_in
      leadNotes,         // job_description (we'll treat lead notes as job desc for now)
      "active",          // status_code
      now,               // last_activity_at
    ];

    await sheets.spreadsheets.values.append({
      spreadsheetId,
      range: "Clients!A:Z",
      valueInputOption: "RAW",
      requestBody: { values: [newClientRow] },
    });
  } else {
    // Touch updated_at / last_activity_at (non-destructive)
    // Find row index in sheet to update a couple cells only if headers exist
    if (c_id >= 0 && (c_updated >= 0 || c_last >= 0 || c_name >= 0 || c_email >= 0)) {
      let sheetRowNumber = -1; // 1-based
      for (let i = 0; i < cr.length; i++) {
        const idv = c_id >= 0 ? String(cr[i]?.[c_id] || "").trim() : "";
        if (idv === finalClientId) { sheetRowNumber = i + 2; break; } // +2 accounts for header row
      }

      if (sheetRowNumber > 0) {
        const updates = [];
        // Only set blanks (don’t overwrite user edits)
        const existingName = c_name >= 0 ? String(cr[sheetRowNumber - 2]?.[c_name] || "").trim() : "";
        const existingEmail = c_email >= 0 ? String(cr[sheetRowNumber - 2]?.[c_email] || "").trim() : "";

        if (c_name >= 0 && !existingName && leadName) updates.push({ colIdx: c_name, val: leadName });
        if (c_email >= 0 && !existingEmail && leadEmail) updates.push({ colIdx: c_email, val: leadEmail });

        if (c_updated >= 0) updates.push({ colIdx: c_updated, val: now });
        if (c_last >= 0) updates.push({ colIdx: c_last, val: now });

        for (const u of updates) {
          const colLetter = String.fromCharCode("A".charCodeAt(0) + u.colIdx);
          await sheets.spreadsheets.values.update({
            spreadsheetId,
            range: `Clients!${colLetter}${sheetRowNumber}`,
            valueInputOption: "RAW",
            requestBody: { values: [[u.val]] },
          });
        }
      }
    }
  }

  // ----- PROPERTIES -----
  // Create a primary property from lead address if none exists for the client.
  const propsTab = await readTabRaw(sheets, spreadsheetId, "Properties");
  const ph = propsTab.headers || [];
  const pr = propsTab.rows || [];

  const p_id = ph.indexOf("id");
  const p_client = ph.indexOf("client_id");
  const p_addr1 = ph.indexOf("address_line1");
  const p_primary = ph.indexOf("is_primary");

  let hasAnyProp = false;
  let hasPrimary = false;
  const existingPropIds = [];

  for (const row of pr) {
    if (p_id >= 0) existingPropIds.push(row[p_id]);
    const cid = p_client >= 0 ? String(row[p_client] || "").trim() : "";
    if (cid === finalClientId) {
      hasAnyProp = true;
      if (p_primary >= 0 && isTruthy(row[p_primary])) hasPrimary = true;
    }
  }

  if (!hasAnyProp && leadAddress) {
    const propId = nextIdWithPrefix(existingPropIds, "P-");
    // EXACT Properties schema order (Ticket 10)
    const newPropRow = [
      propId,           // id
      now,              // created_at
      now,              // updated_at
      finalClientId,    // client_id
      leadAddress,      // address_line1
      "",               // address_line2
      "",               // city
      "",               // state
      "",               // zip
      "",               // lat
      "",               // lng
      "true",           // is_primary
      "",               // notes
    ];

    await sheets.spreadsheets.values.append({
      spreadsheetId,
      range: "Properties!A:Z",
      valueInputOption: "RAW",
      requestBody: { values: [newPropRow] },
    });
  } else if (hasAnyProp && !hasPrimary) {
    // If there are properties but none marked primary, we won't change existing rows here.
    // (Ticket 12+ can add an editor.)
  }

  return { client_id: finalClientId };
}

async function generateJobNumberFromLeads(sheets, spreadsheetId) {
  // Look at Leads job_number column values to find next J-####
  const resp = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: "Leads!A1:Z5000",
  });
  const values = resp.data.values || [];
  if (values.length < 2) return "J-0001";

  const headers = values[0] || [];
  const jobIdx = headers.indexOf("job_number");
  if (jobIdx < 0) return "J-0001";

  const existing = values.slice(1).map((r) => r?.[jobIdx] || "").filter(Boolean);
  return nextIdWithPrefix(existing, "J-");
}

async function handleUpdateLead(req, res) {
  try {
    let body = "";
    req.on("data", (chunk) => (body += chunk));
    req.on("end", async () => {
      const data = body ? JSON.parse(body) : {};
      const id = String(data.id || "").trim();

      if (!id) {
        res.writeHead(400, { "Content-Type": "application/json" });
        return res.end(JSON.stringify({ ok: false, error: "Missing id" }));
      }

      const reqId = genRequestId();
      const sheets = await getSheetsClient();
      const spreadsheetId = process.env.CRM_SHEET_ID;

      const getResp = await sheets.spreadsheets.values.get({
        spreadsheetId,
        range: "Leads!A1:Z5000",
      });

      const values = getResp.data.values || [];
      if (values.length <= 1) {
        res.writeHead(404, { "Content-Type": "application/json" });
        return res.end(JSON.stringify({ ok: false, error: "No leads" }));
      }

      const headers = values[0] || [];
      const idx = (name) => headers.indexOf(name);

      // Required indices (existing)
      const i_id = idx("id");
      const i_status = idx("status");
      const i_deposit_required = idx("deposit_required");
      const i_deposit_received = idx("deposit_received");
      const i_scheduled_date = idx("scheduled_date");
      const i_duration = idx("duration_minutes");
      const i_invoiced = idx("invoiced_amount");
      const i_paid = idx("paid_amount");
      const i_invoice_date = idx("invoice_date");
      const i_paid_date = idx("paid_date");
      const i_assigned = idx("assigned_to");
      const i_notes = idx("notes");
      const i_window = idx("schedule_window");
      const i_pref = idx("schedule_preference");
      const i_override = idx("deposit_override");

      // NEW indices (Ticket: add to Leads)
      const i_client_id = idx("client_id");
      const i_job_number = idx("job_number");

      let foundIdx = -1;
      for (let r = 1; r < values.length; r++) {
        if (String(values[r]?.[i_id] || "").trim() === id) { foundIdx = r; break; }
      }

      if (foundIdx === -1) {
        res.writeHead(404, { "Content-Type": "application/json" });
        return res.end(JSON.stringify({ ok: false, error: "Lead not found" }));
      }

      const row = (values[foundIdx] || []).slice(); // clone
      while (row.length < headers.length) row.push("");

      const oldSnap = row.slice();

      const currentStatus = String(row[i_status] || "").trim();
      const depositRequired = String(row[i_deposit_required] || "").toLowerCase() === "true";
      const depositReceived = parseNum(row[i_deposit_received]);

      // Apply field updates BEFORE stage checks
      if (data.invoiced_amount !== undefined && i_invoiced >= 0) row[i_invoiced] = String(Number(data.invoiced_amount || 0));
      if (data.paid_amount !== undefined && i_paid >= 0) row[i_paid] = String(Number(data.paid_amount || 0));
      if (data.deposit_received !== undefined && i_deposit_received >= 0) row[i_deposit_received] = String(Number(data.deposit_received || 0));
      if (data.assigned_to !== undefined && i_assigned >= 0) row[i_assigned] = String(data.assigned_to || "");
      if (data.schedule_window !== undefined && i_window >= 0) row[i_window] = String(data.schedule_window || "");
      if (data.schedule_preference !== undefined && i_pref >= 0) row[i_pref] = String(data.schedule_preference || "");
      if (data.notes !== undefined && i_notes >= 0) row[i_notes] = String(data.notes || "");
      if (data.deposit_override !== undefined && i_override >= 0) row[i_override] = toBoolStr(data.deposit_override);

      const normSched = normalizeScheduledDate(data.scheduled_date);
      if (normSched !== null && i_scheduled_date >= 0) row[i_scheduled_date] = normSched;

      const dur = clampDurationMinutes(data.duration_minutes);
      if (dur !== null && i_duration >= 0) row[i_duration] = String(dur);

      // Editable fields (new): allow manual edits if provided
      if (data.client_id !== undefined && i_client_id >= 0) row[i_client_id] = String(data.client_id || "");
      if (data.job_number !== undefined && i_job_number >= 0) row[i_job_number] = String(data.job_number || "");

      // Stage enforcement + status update
      if (data.status !== undefined && i_status >= 0) {
        const nextStatus = String(data.status || "").trim();

        // Deposit gate on scheduling stages
        const schedulingStatuses = new Set(["Scheduled", "In Progress"]);
        const overrideDeposit = Boolean(data.deposit_override || data.override_deposit);

        if (schedulingStatuses.has(nextStatus) && depositRequired && depositReceived <= 0 && !overrideDeposit) {
          res.writeHead(400, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ ok: false, error: "DEPOSIT_REQUIRED" }));
          return;
        }

        if (nextStatus === "Complete") {
          const hasScheduled = i_scheduled_date >= 0 && String(row[i_scheduled_date] || "").trim() !== "";
          const hasDuration = i_duration >= 0 && parseNum(row[i_duration]) > 0;
          const hasTime = hasDuration || await hasTimeEntries(sheets, spreadsheetId, id);
          if (!hasScheduled || !hasTime) {
            return stageError(res, "Must have scheduled_date and logged time or duration > 0");
          }
        }

        if (nextStatus === "Invoiced" && currentStatus !== "Complete") {
          return stageError(res, "Must be Complete before moving to Invoiced");
        }

        if (nextStatus === "Paid" && i_invoiced >= 0 && parseNum(row[i_invoiced]) <= 0) {
          return stageError(res, "invoiced_amount must be > 0 before marking Paid");
        }

        if (nextStatus === "Closed" && i_paid >= 0 && i_invoiced >= 0 && parseNum(row[i_paid]) < parseNum(row[i_invoiced])) {
          return stageError(res, "paid_amount must be >= invoiced_amount before Closing");
        }

        row[i_status] = nextStatus;

        // Auto-dates
        if (nextStatus === "Invoiced" && i_invoice_date >= 0 && !String(row[i_invoice_date] || "").trim()) {
          row[i_invoice_date] = todayISO();
        }
        if (nextStatus === "Paid" && i_paid_date >= 0 && !String(row[i_paid_date] || "").trim()) {
          row[i_paid_date] = todayISO();
        }

        // ---- PROMOTION: create/attach client + job number ----
        if (PROMOTION_STATUSES.has(nextStatus)) {
          // Ensure job_number exists
          if (i_job_number >= 0 && !String(row[i_job_number] || "").trim()) {
            row[i_job_number] = await generateJobNumberFromLeads(sheets, spreadsheetId);
          }

          // Ensure client_id exists + upsert Clients/Properties
          const leadObj = {
            id: String(row[i_id] || ""),
            name: String(row[idx("name")] >= 0 ? row[idx("name")] : ""),
            phone: String(row[idx("phone")] >= 0 ? row[idx("phone")] : ""),
            email: String(row[idx("email")] >= 0 ? row[idx("email")] : ""),
            address: String(row[idx("address")] >= 0 ? row[idx("address")] : ""),
            notes: String(i_notes >= 0 ? row[i_notes] : ""),
            client_id: String(i_client_id >= 0 ? row[i_client_id] : ""),
          };

          const up = await upsertClientAndPropertyFromLead({
            sheets,
            spreadsheetId,
            lead: leadObj,
          });

          if (i_client_id >= 0 && up && up.client_id) {
            row[i_client_id] = up.client_id;
          }
        }
      }

      // Write back full row width (to include new columns)
      const sheetRowNumber = foundIdx + 1;
      const endColLetter = String.fromCharCode("A".charCodeAt(0) + Math.min(headers.length - 1, 25)); // up to Z
      const range = `Leads!A${sheetRowNumber}:${endColLetter}${sheetRowNumber}`;

      await sheets.spreadsheets.values.update({
        spreadsheetId,
        range,
        valueInputOption: "RAW",
        requestBody: { majorDimension: "ROWS", values: [row.slice(0, headers.length)] },
      });

      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ok: true }));

      // Fire-and-forget: Google Calendar push when lead becomes Scheduled/In Progress
      const newStatus = String(row[i_status] || "");
      if (newStatus === "Scheduled" || newStatus === "In Progress") {
        const leadName    = String(row[idx("name")]     || "");
        const leadAddress = String(row[idx("address")]  || "");
        const jobType     = String(row[idx("job_type")] || "");
        const leadNotes   = String(row[i_notes]         || "");
        const schedDate   = String(row[i_scheduled_date]|| "");
        const durMins     = Number(row[i_duration]      || 120);
        const gcalColIdx  = idx("gcal_event_id");
        const existing    = gcalColIdx >= 0 ? String(row[gcalColIdx] || "") : "";
        const isEstimate  = ["Estimate", "Quote", "Quoted"].includes(String(oldSnap[i_status] || "")) ||
                            String(data.status || "").includes("Estimate");

        const titlePrefix = isEstimate ? "Estimate" : "Job";
        const titleSuffix = jobType ? `${jobType} – ${leadName}` : leadName;
        const gcalTitle = `${titlePrefix} – ${titleSuffix}${leadAddress ? " – " + leadAddress.split(",")[0] : ""}`;

        setImmediate(async () => {
          try {
            const { createJobGCalEvent, updateGCalEvent, writeGCalEventIdToSheet, loadCalendarIds } = require("../lib/googleCalendar");
            if (existing) {
              const [gcalEventId, calendarId] = existing.split("|");
              if (gcalEventId && calendarId && schedDate) {
                await updateGCalEvent({
                  calendarId, gcalEventId,
                  title:   gcalTitle,
                  type:    titlePrefix.toLowerCase(),
                  startDT: schedDate,
                  endDT:   null,
                  notes:   leadNotes,
                  isAllDay: false,
                });
              }
            } else {
              const result = await createJobGCalEvent({
                title:           gcalTitle,
                status:          newStatus,
                scheduledDate:   schedDate,
                durationMinutes: durMins,
                address:         leadAddress,
                notes:           leadNotes,
              });
              if (result && result.gcalEventId && gcalColIdx >= 0) {
                await writeGCalEventIdToSheet({
                  tab: "Leads", idCol: idx("id"), idValue: id,
                  gcalCol: gcalColIdx, gcalEventId: result.gcalEventId, calendarId: result.calendarId,
                });
              }
            }
          } catch (gcalErr) {
            console.error("[leads-update] GCal push error:", gcalErr.message);
          }
        });
      }

      // Audit (only changed fields we care about)
      const fieldNames = [
        "status",
        "scheduled_date",
        "assigned_to",
        "duration_minutes",
        "deposit_received",
        "deposit_override",
        "invoiced_amount",
        "paid_amount",
        "invoice_date",
        "paid_date",
        "notes",
        "schedule_window",
        "schedule_preference",
        "client_id",
        "job_number",
      ];

      const auditEntries = [];
      for (const f of fieldNames) {
        const col = idx(f);
        if (col < 0) continue;
        if (String(oldSnap[col] || "") !== String(row[col] || "")) {
          auditEntries.push({
            action: "lead.update",
            entity_type: "lead",
            entity_id: id,
            field: f,
            old_value: String(oldSnap[col] || ""),
            new_value: String(row[col] || ""),
            source: "crm-leads",
            request_id: reqId,
          });
        }
      }
      if (auditEntries.length) logAuditBatch(auditEntries).catch(() => {});
      return;
    });
  } catch (error) {
    res.writeHead(500, { "Content-Type": "text/plain" });
    return res.end("Lead Update Error: " + error.message);
  }
}

module.exports = { handleUpdateLead };
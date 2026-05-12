// api/schedule-booking-patch.js
// PATCH /api/schedule/bookings/:id
//
// Accepts a partial update to a single booking row.
// Allowed fields:
//   scheduled_datetime   — ISO string (drag-to-reschedule)
//   duration_minutes     — number    (resize drag)
//   assigned_tech_id     — string    (drag-to-reassign in Day view)
//   status               — string    (status change)
//
// On success returns the updated booking object.
// Side effect: when status → "complete", SMS the assigned tech with invoice link.

const { getSheetsClient, colToLetter } = require("../lib/sheets");
const { ensureTabHeaders }           = require("../lib/sheetsSchema");
const { sendSms, buildMessage, INVOICE_TEMPLATES } = require("../lib/sms");

const SPREADSHEET_ID = () => process.env.CRM_SHEET_ID;
const ALLOWED_FIELDS  = new Set([
  "scheduled_datetime", "duration_minutes", "assigned_tech_id", "assigned_tech_ids", "status",
  "arrived_at", "arrived_lat", "arrived_lng",
]);

function json(res, status, payload) {
  res.writeHead(status, { "Content-Type": "application/json", "Cache-Control": "no-store" });
  res.end(JSON.stringify(payload));
}

function parseBody(req) {
  return new Promise((resolve, reject) => {
    let body = "";
    req.on("data", c => (body += c));
    req.on("end", () => { try { resolve(JSON.parse(body || "{}")); } catch (e) { reject(e); } });
    req.on("error", reject);
  });
}

function rowsToObjects(rows) {
  if (!rows || rows.length < 2) return [];
  const [headers, ...data] = rows;
  return data.map(r => Object.fromEntries(headers.map((h, i) => [h, r[i] ?? ""])));
}

function normalizeIdList(raw) {
  return String(raw || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

async function handlePatchBooking(req, res) {
  try {
    // Extract booking ID from URL path
    const rawPath  = req.url.split("?")[0];
    const bookingId = rawPath.replace(/^\/api\/schedule\/bookings\//, "").trim();
    if (!bookingId) return json(res, 400, { ok: false, error: "booking_id required in path" });

    const body    = await parseBody(req);
    const updates = {};
    for (const [k, v] of Object.entries(body)) {
      if (ALLOWED_FIELDS.has(k)) updates[k] = v;
    }
    if (Object.keys(updates).length === 0) {
      return json(res, 400, { ok: false, error: "No valid fields to update" });
    }

    const sheets = await getSheetsClient();
    const id     = SPREADSHEET_ID();

    await ensureTabHeaders("Bookings");

    const r = await sheets.spreadsheets.values.get({
      spreadsheetId: id,
      range:         "Bookings!A:Z",
    });
    const rows = r.data.values || [];
    if (rows.length < 2) return json(res, 404, { ok: false, error: "Booking not found" });

    const headers  = rows[0];
    const idIdx    = headers.indexOf("booking_id");
    if (idIdx < 0) return json(res, 500, { ok: false, error: "booking_id column not found" });

    let rowIdx = -1;
    for (let i = 1; i < rows.length; i++) {
      if (String(rows[i][idIdx] || "") === bookingId) { rowIdx = i; break; }
    }
    if (rowIdx < 0) return json(res, 404, { ok: false, error: `Booking ${bookingId} not found` });

    const row = [...rows[rowIdx]];
    const originalRow = [...rows[rowIdx]];
    // Pad row to header length
    while (row.length < headers.length) row.push("");

    for (const [field, value] of Object.entries(updates)) {
      const colIdx = headers.indexOf(field);
      if (colIdx >= 0) {
        row[colIdx] = String(value ?? "");
      } else {
        console.warn(`[schedule-booking-patch] Column "${field}" not found in Bookings sheet headers`);
      }
    }

    const sheetRow = rowIdx + 1;
    const endCol   = colToLetter(headers.length - 1);
    await sheets.spreadsheets.values.update({
      spreadsheetId:    id,
      range:            `Bookings!A${sheetRow}:${endCol}${sheetRow}`,
      valueInputOption: "RAW",
      requestBody:      { majorDimension: "ROWS", values: [row.slice(0, headers.length)] },
    });

    const updated = Object.fromEntries(headers.map((h, i) => [h, row[i] || ""]));
    console.log(`[schedule-booking-patch] Updated booking ${bookingId}:`, updates);
    console.log("[schedule-booking-patch] Full Bookings row after update:", updated);

    let quoteSnapshotEventId = "";
    const assignmentChanged = ("assigned_tech_id" in updates) || ("assigned_tech_ids" in updates);
    if (assignmentChanged) {
      quoteSnapshotEventId = await appendTechAssignedSnapshot({
        sheets, spreadsheetId: id, updatedBooking: updated,
      });
      await mirrorAssignmentToLead({
        sheets, spreadsheetId: id, updatedBooking: updated,
      });
    }

    // Side effect: when status just changed to "complete", SMS the assigned tech
    if (updates.status && String(updates.status).toLowerCase() === "complete") {
      smsTechOnComplete(updated, sheets, id).catch(err =>
        console.error("[schedule-booking-patch] SMS-on-complete error:", err.message)
      );
    }

    json(res, 200, {
      ok: true,
      booking: updated,
      booking_id: updated.booking_id || bookingId,
      quote_id: updated.quote_id || "",
      assigned_tech_id: updated.assigned_tech_id || "",
      assigned_tech_ids: updated.assigned_tech_ids || "",
      assigned_crew_names: (updated.assigned_crew_names || ""),
      quote_snapshot_event_id: quoteSnapshotEventId,
    });
  } catch (err) {
    console.error("[schedule-booking-patch]", err.message);
    json(res, 500, { ok: false, error: err.message });
  }
}

async function resolveCrewNamesByIds(sheets, spreadsheetId, ids) {
  if (!ids.length) return [];
  const staffResp = await sheets.spreadsheets.values.get({ spreadsheetId: SPREADSHEET_ID(), range: "Staff!A:Z" }).catch(() => ({ data: { values: [] } }));
  const rows = staffResp.data.values || [];
  if (rows.length < 2) return ids;
  const [headers, ...data] = rows;
  const idx = Object.fromEntries(headers.map((h, i) => [h, i]));
  const nameById = {};
  for (const r of data) {
    const sid = String(r[idx.staff_id] || "").trim();
    if (!sid) continue;
    nameById[sid] = `${String(r[idx.first_name] || "").trim()} ${String(r[idx.last_name] || "").trim()}`.trim() || sid;
  }
  return ids.map((id) => nameById[id] || id);
}

async function appendTechAssignedSnapshot({ sheets, spreadsheetId, updatedBooking }) {
  await ensureTabHeaders("QuoteSnapshots");
  const resp = await sheets.spreadsheets.values.get({ spreadsheetId, range: "QuoteSnapshots!A:AZ" });
  const rows = resp.data.values || [];
  const headers = rows[0] || [];
  const idx = Object.fromEntries(headers.map((h, i) => [h, i]));
  const bookingIds = await resolveTechIdsFromMixedValues(sheets, spreadsheetId, normalizeIdList(updatedBooking.assigned_tech_ids || updatedBooking.assigned_tech_id));
  if (bookingIds.length) {
    updatedBooking.assigned_tech_ids = bookingIds.join(",");
    updatedBooking.assigned_tech_id = bookingIds[0] || "";
  }
  const crewNames = await resolveCrewNamesByIds(sheets, spreadsheetId, bookingIds);
  const assignedCrewNames = crewNames.join(", ");

  const eventId = `QSE-${Date.now()}-${Math.random().toString(36).slice(2, 8).toUpperCase()}`;
  const createdAt = new Date().toISOString();
  const snapshotState = { ...updatedBooking, assigned_crew_names: assignedCrewNames };

  const outRow = headers.map((h) => {
    switch (h) {
      case "event_id": return eventId;
      case "event_type": return "tech_assigned";
      case "created_at": return createdAt;
      case "quote_id": return updatedBooking.quote_id || "";
      case "booking_id": return updatedBooking.booking_id || "";
      case "lead_id": return updatedBooking.lead_id || "";
      case "client_id": return updatedBooking.client_id || "";
      case "customer_name": return updatedBooking.customer_name || "";
      case "phone": return updatedBooking.phone || "";
      case "email": return updatedBooking.email || "";
      case "address": return updatedBooking.address || "";
      case "job_type_id": return updatedBooking.job_type_id || "";
      case "status": return updatedBooking.status || "";
      case "scheduled_datetime": return updatedBooking.scheduled_datetime || "";
      case "schedule_block": return updatedBooking.schedule_block || "";
      case "assigned_tech_id": return updatedBooking.assigned_tech_id || "";
      case "assigned_tech_ids": return updatedBooking.assigned_tech_ids || "";
      case "assigned_crew_names": return assignedCrewNames;
      case "final_price": return updatedBooking.final_price || "";
      case "duration_minutes": return updatedBooking.duration_minutes || "";
      case "snapshot_json": return JSON.stringify(snapshotState);
      default: return "";
    }
  });

  await sheets.spreadsheets.values.append({
    spreadsheetId,
    range: "QuoteSnapshots!A:AZ",
    valueInputOption: "RAW",
    insertDataOption: "INSERT_ROWS",
    requestBody: { values: [outRow] },
  });
  updatedBooking.assigned_crew_names = assignedCrewNames;
  console.log("[schedule-booking-patch] QuoteSnapshots appended tech_assigned event:", { eventId, booking_id: updatedBooking.booking_id, quote_id: updatedBooking.quote_id, assigned_crew_names: assignedCrewNames });
  return eventId;
}

async function mirrorAssignmentToLead({ sheets, spreadsheetId, updatedBooking }) {
  const quoteId = String(updatedBooking.quote_id || "").trim();
  if (!quoteId) return;
  const leadsResp = await sheets.spreadsheets.values.get({ spreadsheetId, range: "Leads!A:AZ" }).catch(() => ({ data: { values: [] } }));
  const rows = leadsResp.data.values || [];
  if (rows.length < 2) return;
  const headers = rows[0];
  const idx = Object.fromEntries(headers.map((h, i) => [h, i]));
  const qIdx = idx.last_quote_id;
  if (qIdx == null) return;
  let rowIdx = -1;
  for (let i = 1; i < rows.length; i++) {
    if (String(rows[i][qIdx] || "").trim() === quoteId) { rowIdx = i; break; }
  }
  if (rowIdx < 0) return;
  const row = [...rows[rowIdx]];
  while (row.length < headers.length) row.push("");
  if (idx.assigned_to != null) row[idx.assigned_to] = updatedBooking.assigned_crew_names || "";
  if (idx.status != null && String(row[idx.status] || "").trim().toLowerCase() !== "scheduled") row[idx.status] = "Scheduled";
  const sheetRow = rowIdx + 1;
  const endCol = colToLetter(headers.length - 1);
  await sheets.spreadsheets.values.update({ spreadsheetId, range: `Leads!A${sheetRow}:${endCol}${sheetRow}`, valueInputOption: "RAW", requestBody: { values: [row] } });
}

// ── SMS assigned tech when job is marked complete ─────────────────────────────
async function smsTechOnComplete(booking, sheets, spreadsheetId) {
  const techId = booking.assigned_tech_id || "";
  if (!techId) {
    console.log("[sms-on-complete] No assigned_tech_id — skipping SMS");
    return;
  }

  // Read Staff tab to find the tech's phone and first name (Staff lives on CRM sheet)
  let staffRows = [];
  try {
    const staffResp = await sheets.spreadsheets.values.get({
      spreadsheetId: SPREADSHEET_ID(),
      range: "Staff!A:Z",
    });
    staffRows = staffResp.data.values || [];
  } catch (err) {
    console.warn("[sms-on-complete] Could not read Staff tab:", err.message);
    return;
  }
  if (staffRows.length < 2) return;

  const [sHeaders, ...sData] = staffRows;
  const si  = Object.fromEntries(sHeaders.map((h, i) => [h, i]));
  const sGet = r => col => String(r[si[col] ?? -1] ?? "").trim();

  const techRow = sData.find(r => sGet(r)("staff_id") === techId);
  if (!techRow) {
    console.log(`[sms-on-complete] Staff ${techId} not found — skipping SMS`);
    return;
  }

  const techPhone = sGet(techRow)("phone");
  const firstName = sGet(techRow)("first_name") || "Crew";

  if (!techPhone) {
    console.log("[sms-on-complete] Tech has no phone — skipping SMS");
    return;
  }

  // Build the crew portal URL for the tech to generate the invoice
  const domain  = process.env.REPLIT_DEV_DOMAIN
    || (process.env.REPLIT_DOMAINS || "").split(",")[0].trim()
    || "";
  const crewUrl = domain ? `https://${domain}/crew` : "/crew";

  const address = booking.address || booking.booking_id;
  const msgBody = buildMessage(INVOICE_TEMPLATES.INVOICE_TECH_PROMPT, {
    tech_first_name: firstName,
    address,
    crew_url: crewUrl,
  });

  const sent = await sendSms(techPhone, msgBody).catch(() => false);
  console.log(`[sms-on-complete] SMS to ${techPhone} (${firstName}): ${sent ? "sent" : "failed"}`);
}

module.exports = { handlePatchBooking };


async function resolveTechIdsFromMixedValues(sheets, spreadsheetId, values) {
  if (!values.length) return [];
  const staffResp = await sheets.spreadsheets.values.get({ spreadsheetId: SPREADSHEET_ID(), range: "Staff!A:Z" }).catch(() => ({ data: { values: [] } }));
  const rows = staffResp.data.values || [];
  if (rows.length < 2) return values;
  const [headers, ...data] = rows;
  const idx = Object.fromEntries(headers.map((h, i) => [h, i]));
  const byId = new Map();
  const byName = new Map();
  for (const r of data) {
    const id = String(r[idx.staff_id] || "").trim();
    const name = `${String(r[idx.first_name] || "").trim()} ${String(r[idx.last_name] || "").trim()}`.trim().toLowerCase();
    if (id) byId.set(id, id);
    if (id && name) byName.set(name, id);
  }
  const out = [];
  for (const v of values) {
    if (byId.has(v)) out.push(v);
    else {
      const mapped = byName.get(String(v).toLowerCase());
      out.push(mapped || v);
    }
  }
  return Array.from(new Set(out.filter(Boolean)));
}

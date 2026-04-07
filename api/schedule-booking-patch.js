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

const { getSheetsClient }  = require("../lib/sheets");
const { ensureTabHeaders } = require("../lib/sheetsSchema");

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
    const endCol   = String.fromCharCode(65 + headers.length - 1); // e.g. Q
    await sheets.spreadsheets.values.update({
      spreadsheetId:    id,
      range:            `Bookings!A${sheetRow}:${endCol}${sheetRow}`,
      valueInputOption: "RAW",
      requestBody:      { majorDimension: "ROWS", values: [row.slice(0, headers.length)] },
    });

    const updated = Object.fromEntries(headers.map((h, i) => [h, row[i] || ""]));
    console.log(`[schedule-booking-patch] Updated booking ${bookingId}:`, updates);
    json(res, 200, { ok: true, booking: updated });
  } catch (err) {
    console.error("[schedule-booking-patch]", err.message);
    json(res, 500, { ok: false, error: err.message });
  }
}

module.exports = { handlePatchBooking };

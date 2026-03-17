// api/schedule-admin.js
// GET /api/schedule/bookings — admin endpoint, returns all bookings from Bookings sheet.
// Auth-protected (behind requireAuth in index.js routing order).

const { getSheetsClient } = require("../lib/sheets");
const { ensureTabHeaders } = require("../lib/sheetsSchema");

const SPREADSHEET_ID = () => process.env.CRM_SHEET_ID;

function json(res, status, payload) {
  res.writeHead(status, { "Content-Type": "application/json", "Cache-Control": "no-store" });
  res.end(JSON.stringify(payload));
}

function rowsToObjects(rows) {
  if (!rows || rows.length < 2) return [];
  const [headers, ...data] = rows;
  return data.map(r => Object.fromEntries(headers.map((h, i) => [h, r[i] || ""])));
}

async function handleGetBookings(req, res) {
  try {
    await ensureTabHeaders("Bookings");
    const sheets = await getSheetsClient();
    const r = await sheets.spreadsheets.values.get({
      spreadsheetId: SPREADSHEET_ID(),
      range: "Bookings!A:M",
    });
    const bookings = rowsToObjects(r.data.values || []);

    // Optional filter: ?status=confirmed
    const url    = new URL(req.url, "http://localhost");
    const status = url.searchParams.get("status");
    const filtered = status ? bookings.filter(b => b.status === status) : bookings;

    json(res, 200, { ok: true, bookings: filtered, count: filtered.length });
  } catch (err) {
    console.error("[schedule-admin]", err.message);
    json(res, 500, { ok: false, error: err.message });
  }
}

module.exports = { handleGetBookings };

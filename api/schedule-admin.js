// api/schedule-admin.js
// GET /api/schedule/bookings — admin endpoint, returns all bookings from Bookings sheet.
// Auth-protected (behind requireAuth in index.js routing order).
//
// Leads is the canonical lifecycle row. Bookings remains the scheduler/capacity
// table, then gets overlaid with Lead data before the CRM sees it.

const { getSheetsClient } = require("../lib/sheets");
const { ensureTabHeaders } = require("../lib/sheetsSchema");
const { hrSpreadsheetId }  = require("../lib/hrSheetClient");
const { enrichBookingsFromLeads } = require("../lib/leadLifecycle");

const SPREADSHEET_ID    = () => process.env.CRM_SHEET_ID;
const HR_SPREADSHEET_ID = () => hrSpreadsheetId();

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
    await ensureTabHeaders("Leads");

    const sheets = await getSheetsClient();
    const spreadsheetId = SPREADSHEET_ID();
    const [r, staffResp] = await Promise.all([
      sheets.spreadsheets.values.get({ spreadsheetId, range: "Bookings!A:Z" }),
      sheets.spreadsheets.values.get({ spreadsheetId: HR_SPREADSHEET_ID(), range: "Staff!A:Z" }).catch(() => ({ data: { values: [] } })),
    ]);

    let bookings = rowsToObjects(r.data.values || []);
    const staffRows = staffResp.data.values || [];
    const staffMap = {};
    if (staffRows.length > 1) {
      const [sh, ...sd] = staffRows;
      const si = Object.fromEntries(sh.map((h, i) => [h, i]));
      sd.forEach((row) => {
        const sid = String(row[si.staff_id] || "").trim();
        const name = `${String(row[si.first_name] || "").trim()} ${String(row[si.last_name] || "").trim()}`.trim();
        if (sid) staffMap[sid] = name || sid;
      });
    }

    bookings.forEach((b) => {
      const ids = String(b.assigned_tech_ids || b.assigned_tech_id || "").split(",").map(s => s.trim()).filter(Boolean);
      b.assigned_crew_names = ids.map(id => staffMap[id] || id).join(", ");
    });

    // Canonical overlay: customer/job/status/assignment fields come from Leads.
    bookings = await enrichBookingsFromLeads({ sheets, spreadsheetId, bookings });

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

// api/crew.js — lightweight helpers for the Crew Portal
// GET /api/crew/members — returns list of crew member names from Config tab
// GET /api/crew/today  — returns today's bookings (date-filtered, public endpoint)

const { getSheetsClient } = require("../lib/sheets");
const { getConfig } = require("../lib/config");

function json(res, status, data) {
  res.writeHead(status, { "Content-Type": "application/json", "Cache-Control": "no-store" });
  res.end(JSON.stringify(data));
}

function todayLocalStr() {
  // Orange TX is CST/CDT (UTC-6/UTC-5). Use a simple local date string.
  const d = new Date();
  const offset = d.getTimezoneOffset(); // minutes
  const local = new Date(d.getTime() - offset * 60000);
  return local.toISOString().slice(0, 10); // "YYYY-MM-DD"
}

async function handleGetCrewMembers(req, res) {
  try {
    const cfg = await getConfig();
    const raw = cfg.crew_members || "";
    const members = raw
      .split(",")
      .map(s => s.trim())
      .filter(Boolean);
    json(res, 200, { ok: true, members });
  } catch (err) {
    json(res, 500, { ok: false, error: err.message, members: [] });
  }
}

async function handleGetTodayJobs(req, res) {
  try {
    const sheets = await getSheetsClient();
    const spreadsheetId = process.env.CRM_SHEET_ID;
    if (!spreadsheetId) return json(res, 200, { ok: true, jobs: [] });

    const resp = await sheets.spreadsheets.values.get({
      spreadsheetId,
      range: "Bookings!A:P",
    });

    const rows = resp.data.values || [];
    if (rows.length < 2) return json(res, 200, { ok: true, jobs: [] });

    const [headers, ...data] = rows;
    const idx = Object.fromEntries(headers.map((h, i) => [h, i]));

    const today = todayLocalStr();

    const jobs = data
      .map(r => {
        const get = col => String(r[idx[col] ?? -1] ?? "").trim();
        const dt = get("scheduled_datetime");
        const dateStr = dt ? dt.slice(0, 10) : "";
        return {
          booking_id:    get("booking_id"),
          quote_id:      get("quote_id"),
          customer_name: get("customer_name"),
          address:       get("address"),
          scheduled_datetime: dt,
          date:          dateStr,
          schedule_block: get("schedule_block"),
          duration_minutes: Number(r[idx["duration_minutes"] ?? -1] || 0),
          status:        get("status"),
        };
      })
      .filter(j => j.date === today && j.status !== "cancelled")
      .sort((a, b) => a.scheduled_datetime.localeCompare(b.scheduled_datetime));

    json(res, 200, { ok: true, jobs, today });
  } catch (err) {
    json(res, 500, { ok: false, error: err.message, jobs: [] });
  }
}

module.exports = { handleGetCrewMembers, handleGetTodayJobs };

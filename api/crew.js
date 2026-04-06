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

    // Fetch bookings and quote snapshots in parallel
    const [bookingsResp, quotesResp] = await Promise.all([
      sheets.spreadsheets.values.get({ spreadsheetId, range: "Bookings!A:Z" }),
      sheets.spreadsheets.values.get({ spreadsheetId, range: "QuoteSnapshots!A:Z" }).catch(() => ({ data: { values: [] } })),
    ]);

    const rows = bookingsResp.data.values || [];
    if (rows.length < 2) return json(res, 200, { ok: true, jobs: [] });

    const [headers, ...data] = rows;
    const idx = Object.fromEntries(headers.map((h, i) => [h, i]));

    // Build a notes lookup from QuoteSnapshots keyed by quote_id
    const qRows = quotesResp.data.values || [];
    const notesMap = {};
    if (qRows.length > 1) {
      const [qHeaders, ...qData] = qRows;
      const qi = Object.fromEntries(qHeaders.map((h, i) => [h, i]));
      qData.forEach(r => {
        const qid   = String(r[qi["quote_id"] ?? -1] ?? "").trim();
        const notes = String(r[qi["notes"]    ?? -1] ?? "").trim();
        if (qid && notes && !notesMap[qid]) notesMap[qid] = notes;
      });
    }

    const today = todayLocalStr();

    const jobs = data
      .map(r => {
        const get = col => String(r[idx[col] ?? -1] ?? "").trim();
        const dt      = get("scheduled_datetime");
        const dateStr = dt ? dt.slice(0, 10) : "";
        const qid     = get("quote_id");
        return {
          booking_id:       get("booking_id"),
          quote_id:         qid,
          customer_name:    get("customer_name"),
          address:          get("address"),
          phone:            get("phone"),
          email:            get("email"),
          scheduled_datetime: dt,
          date:             dateStr,
          schedule_block:   get("schedule_block"),
          duration_minutes: Number(r[idx["duration_minutes"] ?? -1] || 0),
          status:           get("status"),
          final_price:      get("final_price"),
          job_type_id:      get("job_type_id"),
          scope_of_work:    get("scope_of_work") || notesMap[qid] || "",
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

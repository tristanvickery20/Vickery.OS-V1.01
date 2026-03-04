// api/schedule-slots.js
// GET /api/schedule/slots?quote_id=QT-...   (locked quote — existing)
// GET /api/schedule/slots?minutes=N          (browse before lock — new)

const { getSheetsClient } = require("../lib/sheets");
const { ensureTabHeaders }  = require("../lib/sheetsSchema");
const { generateSlots }     = require("../lib/slotEngine");

const SPREADSHEET_ID = () => process.env.CRM_SHEET_ID;

const SCHEDULER_DEFAULTS = [
  "America/Chicago", "24", "30", "180",
  "08:00", "17:00", "09:00", "13:00",
  "FALSE", "3",
];

function json(res, status, payload) {
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(JSON.stringify(payload));
}

function rowsToObjects(rows) {
  if (!rows || rows.length < 2) return [];
  const [headers, ...data] = rows;
  return data.map(r => Object.fromEntries(headers.map((h, i) => [h, r[i] || ""])));
}

async function ensureSchedulerRules(sheets, id) {
  await ensureTabHeaders("SchedulerRules");
  const r = await sheets.spreadsheets.values.get({ spreadsheetId: id, range: "SchedulerRules!A1:J3" });
  const rows = r.data.values || [];
  if (rows.length < 2 || !rows[1]?.some(v => v)) {
    await sheets.spreadsheets.values.update({
      spreadsheetId: id, range: "SchedulerRules!A2", valueInputOption: "RAW",
      requestBody: { majorDimension: "ROWS", values: [SCHEDULER_DEFAULTS] },
    });
    console.log("[SchedulerRules] Default row written.");
    rows[1] = SCHEDULER_DEFAULTS;
  }
  return rows;
}

async function loadSchedulerRules(sheets, id) {
  const rows = await ensureSchedulerRules(sheets, id);
  const [headers, data] = rows;
  return Object.fromEntries((headers || []).map((h, i) => [h, (data || [])[i] || ""]));
}

async function loadBookings(sheets, id) {
  try {
    const r = await sheets.spreadsheets.values.get({ spreadsheetId: id, range: "Bookings!A:H" });
    return rowsToObjects(r.data.values || []);
  } catch { return []; }
}

async function loadLockedSnapshot(sheets, id, quoteId) {
  const r = await sheets.spreadsheets.values.get({ spreadsheetId: id, range: "QuoteSnapshots!A:U" });
  const rows = rowsToObjects(r.data.values || []);
  return rows.filter(r => r.quote_id === quoteId && r.event_type === "locked").pop() || null;
}

async function loadJobType(sheets, id, jobTypeId) {
  try {
    const r = await sheets.spreadsheets.values.get({ spreadsheetId: id, range: "JobTypes!A:Z" });
    const rows = rowsToObjects(r.data.values || []);
    return rows.find(r => r.job_type_id === jobTypeId) || null;
  } catch { return null; }
}

async function handleGetSlots(req, res) {
  try {
    const url          = new URL(req.url, "http://localhost");
    const quoteId      = url.searchParams.get("quote_id");
    const minutesParam = url.searchParams.get("minutes");

    if (!quoteId && !minutesParam) {
      return json(res, 400, { ok: false, error: "quote_id or minutes required" });
    }

    const sheets = await getSheetsClient();
    const id     = SPREADSHEET_ID();

    const [rules, bookings] = await Promise.all([
      loadSchedulerRules(sheets, id),
      loadBookings(sheets, id),
    ]);

    // Default duration comes from ?minutes param (pre-lock browsing)
    let duration = minutesParam ? Math.max(30, Number(minutesParam) || 90) : 90;
    let quote    = null;

    // If a quote_id was provided, try to resolve a locked snapshot for authoritative duration
    if (quoteId) {
      const snapshot = await loadLockedSnapshot(sheets, id, quoteId);
      if (snapshot) {
        const jobType = snapshot.job_type_id
          ? await loadJobType(sheets, id, snapshot.job_type_id)
          : null;
        duration = Number(jobType?.default_duration_minutes) || 90;
        quote = {
          quote_id:      quoteId,
          job_type_id:   snapshot.job_type_id,
          final_price:   snapshot.final_price,
          customer_name: snapshot.customer_name,
          address:       snapshot.address,
        };
      }
    }

    const slots = generateSlots(rules, bookings, duration, new Date());

    json(res, 200, {
      ok: true,
      slots,
      timezone:         rules.timezone || "America/Chicago",
      duration_minutes: duration,
      quote,
    });
  } catch (err) {
    console.error("[schedule-slots]", err.message);
    json(res, 500, { ok: false, error: err.message });
  }
}

module.exports = { handleGetSlots };

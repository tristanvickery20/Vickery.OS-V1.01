// api/schedule-blocks.js
// GET /api/schedule/blocks
//
// Returns available Morning / Afternoon contractor windows for the next N
// business days. This is the customer-facing availability endpoint used by
// the quote flow. It does NOT use the granular slotEngine — it works at the
// block level only.
//
// Response:
// {
//   ok: true, timezone: "America/Chicago",
//   blocks: [
//     { date: "2026-03-18", day_label: "Wednesday", block: "Morning",
//       display: "Wednesday Morning",
//       start_time: "08:00", end_time: "12:00",
//       window_label: "8 AM – 12 PM",
//       start_iso: "2026-03-18T08:00:00-05:00",
//       capacity: 3, booked: 1, available: true },
//     ...
//   ]
// }

const { getSheetsClient } = require("../lib/sheets");
const { ensureTabHeaders }  = require("../lib/sheetsSchema");

const SPREADSHEET_ID = () => process.env.CRM_SHEET_ID;

const BLOCK_DEFS = [
  { block: "Morning",   start: "08:00", end: "12:00", window_label: "8 AM – 12 PM" },
  { block: "Afternoon", start: "13:00", end: "17:00", window_label: "1 PM – 5 PM" },
];

const DAY_NAMES = ["Sunday","Monday","Tuesday","Wednesday","Thursday","Friday","Saturday"];

function json(res, status, payload) {
  res.writeHead(status, { "Content-Type": "application/json", "Cache-Control": "no-store" });
  res.end(JSON.stringify(payload));
}

function rowsToObjects(rows) {
  if (!rows || rows.length < 2) return [];
  const [headers, ...data] = rows;
  return data.map(r => Object.fromEntries(headers.map((h, i) => [h, r[i] || ""])));
}

// Parse YYYY-MM-DD date string into { year, month, day } without timezone shift
function parseDateStr(str) {
  const [y, m, d] = str.split("-").map(Number);
  return { year: y, month: m, day: d };
}

// Get local YYYY-MM-DD for a Date in a given timezone
function toLocalDateStr(date, tz) {
  const fmt = new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" });
  return fmt.format(date); // returns YYYY-MM-DD
}

// Get day-of-week (0=Sun) for a local date string in a given timezone
function getDowForDate(dateStr, tz) {
  const fmt = new Intl.DateTimeFormat("en-US", { timeZone: tz, weekday: "short" });
  // Use noon UTC of that date to avoid DST edge cases
  const { year, month, day } = parseDateStr(dateStr);
  const d = new Date(Date.UTC(year, month - 1, day, 12, 0, 0));
  const parts = fmt.formatToParts(d);
  const dow = parts.find(p => p.type === "weekday")?.value || "Mon";
  return ["Sun","Mon","Tue","Wed","Thu","Fri","Sat"].indexOf(dow);
}

// Convert "HH:MM" + YYYY-MM-DD to an ISO string in the local timezone
function toLocalIso(dateStr, timeStr, tz) {
  const { year, month, day } = parseDateStr(dateStr);
  const [h, m] = timeStr.split(":").map(Number);
  // Guess UTC from local time, then adjust
  const guess = new Date(Date.UTC(year, month - 1, day, h, m, 0));
  const fmtOffset = new Intl.DateTimeFormat("en-US", {
    timeZone: tz, hour: "2-digit", minute: "2-digit", hour12: false,
  });
  const parts = fmtOffset.formatToParts(guess);
  const lh = Number(parts.find(p => p.type === "hour")?.value || h);
  const lm = Number(parts.find(p => p.type === "minute")?.value || m);
  const diffMs = ((h - lh) * 60 + (m - lm)) * 60000;
  return new Date(guess.getTime() + diffMs).toISOString();
}

async function handleGetBlocks(req, res) {
  try {
    const url   = new URL(req.url, "http://localhost");
    const limit = Math.min(30, Math.max(5, Number(url.searchParams.get("days") || 14)));

    const sheets = await getSheetsClient();
    const id     = SPREADSHEET_ID();

    // Ensure headers exist on both tabs
    await Promise.all([
      ensureTabHeaders("SchedulerRules"),
      ensureTabHeaders("Bookings"),
    ]);

    const [rulesRes, bookingsRes] = await Promise.all([
      sheets.spreadsheets.values.get({ spreadsheetId: id, range: "SchedulerRules!A1:N3" }),
      sheets.spreadsheets.values.get({ spreadsheetId: id, range: "Bookings!A:M" }),
    ]);

    // Parse rules
    const rulesRows    = rulesRes.data.values || [];
    const rulesHeaders = rulesRows[0] || [];
    const rulesData    = rulesRows[1] || [];
    const rules = Object.fromEntries(rulesHeaders.map((h, i) => [h, rulesData[i] || ""]));

    const tz            = rules.timezone       || "America/Chicago";
    const leadHours     = Number(rules.lead_time_hours || 24);
    const satEnabled    = String(rules.saturday_start || "").length > 0;
    const sunEnabled    = String(rules.sunday_enabled || "").toLowerCase() === "true";
    const mornCap       = Number(rules.morning_capacity   || 3);
    const aftnCap       = Number(rules.afternoon_capacity || 3);

    // Build booking counts: { "YYYY-MM-DD:Morning": N, "YYYY-MM-DD:Afternoon": N }
    const bookings = rowsToObjects(bookingsRes.data.values || []);
    const blockCounts = {};
    for (const bk of bookings) {
      if (!bk.scheduled_datetime || bk.status === "cancelled") continue;
      if (bk.schedule_block) {
        // New-style booking — trust the block field directly
        const dt      = new Date(bk.scheduled_datetime);
        const dateKey = toLocalDateStr(dt, tz);
        const key     = `${dateKey}:${bk.schedule_block}`;
        blockCounts[key] = (blockCounts[key] || 0) + 1;
      } else {
        // Legacy booking (exact time) — infer block from start time
        const dt   = new Date(bk.scheduled_datetime);
        if (isNaN(dt.getTime())) continue;
        const fmt  = new Intl.DateTimeFormat("en-US", { timeZone: tz, hour: "numeric", hour12: false });
        const hr   = Number(fmt.format(dt));
        const blk  = hr < 13 ? "Morning" : "Afternoon";
        const dateKey = toLocalDateStr(dt, tz);
        const key     = `${dateKey}:${blk}`;
        blockCounts[key] = (blockCounts[key] || 0) + 1;
      }
    }

    // Generate blocks
    const now         = new Date();
    const earliest    = new Date(now.getTime() + leadHours * 3600000);
    const blocks      = [];
    let daysChecked   = 0;
    let di            = 0;

    while (daysChecked < limit && di < 90) {
      di++;
      const candidateDate = new Date(now.getTime() + di * 86400000);
      const dateStr       = toLocalDateStr(candidateDate, tz);
      const dow           = getDowForDate(dateStr, tz);

      // Skip weekends unless enabled
      if (dow === 0 && !sunEnabled) continue;
      if (dow === 6 && !satEnabled) continue;

      let dayHadBlock = false;
      for (const def of BLOCK_DEFS) {
        const cap  = def.block === "Morning" ? mornCap : aftnCap;
        const startIso = toLocalIso(dateStr, def.start, tz);
        const startDt  = new Date(startIso);

        // Must be after earliest booking time
        if (startDt < earliest) continue;

        const key    = `${dateStr}:${def.block}`;
        const booked = blockCounts[key] || 0;

        blocks.push({
          date:         dateStr,
          day_label:    DAY_NAMES[dow],
          block:        def.block,
          display:      `${DAY_NAMES[dow]} ${def.block}`,
          start_time:   def.start,
          end_time:     def.end,
          window_label: def.window_label,
          start_iso:    startIso,
          capacity:     cap,
          booked,
          available:    booked < cap,
        });
        dayHadBlock = true;
      }

      if (dayHadBlock) daysChecked++;
    }

    json(res, 200, {
      ok:       true,
      timezone: tz,
      blocks,
      config: {
        morning_capacity:   mornCap,
        afternoon_capacity: aftnCap,
        lead_time_hours:    leadHours,
      },
    });
  } catch (err) {
    console.error("[schedule-blocks]", err.message);
    json(res, 500, { ok: false, error: err.message });
  }
}

module.exports = { handleGetBlocks };

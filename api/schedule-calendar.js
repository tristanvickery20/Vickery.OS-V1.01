// api/schedule-calendar.js
// GET /api/schedule/calendar?start=YYYY-MM-DD&end=YYYY-MM-DD
//
// Returns bookings shaped for the visual calendar:
//   - bookings[]   : scheduled bookings with local date + hour computed
//   - unscheduled[]: bookings with no scheduled_datetime
//   - staff[]      : active Staff rows for Day/Dispatch view
//   - timezone     : from SchedulerRules (default America/Chicago)

const { getSheetsClient }  = require("../lib/sheets");
const { ensureTabHeaders } = require("../lib/sheetsSchema");

const SPREADSHEET_ID = () => process.env.CRM_SHEET_ID;

function json(res, status, payload) {
  res.writeHead(status, { "Content-Type": "application/json", "Cache-Control": "no-store" });
  res.end(JSON.stringify(payload));
}

function rowsToObjects(rows) {
  if (!rows || rows.length < 2) return [];
  const [headers, ...data] = rows;
  return data.map(r => Object.fromEntries(headers.map((h, i) => [h, r[i] ?? ""])));
}

// If a datetime string has no timezone indicator (no Z, no +HH:MM) it was stored
// as a naive local time in the business timezone (e.g. "2026-04-08 13:00:00" means
// 1 PM CDT, NOT 1 PM UTC). Convert it to an unambiguous UTC ISO string so that
// Intl.DateTimeFormat produces the correct local hour everywhere.
function normalizeToUtc(str, tz) {
  if (!str) return str;
  const s = String(str).trim();
  // Already explicit UTC or has a UTC offset — leave as-is
  if (s.endsWith("Z") || /[+-]\d{2}:?\d{2}$/.test(s)) return s;
  try {
    // Parse treating the naive time as if it were UTC to get the raw milliseconds
    const naive = new Date(s.replace(" ", "T") + "Z");
    if (isNaN(naive.getTime())) return s;
    // Find what this UTC instant looks like in the target timezone
    const fmtOpts = {
      timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit",
      hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false,
    };
    const p = Object.fromEntries(
      new Intl.DateTimeFormat("en-US", fmtOpts).formatToParts(naive).map(x => [x.type, x.value])
    );
    // Build a UTC Date that represents that same moment-in-TZ
    const tzEquiv = new Date(`${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}:${p.second}Z`);
    // Offset = how far the TZ-display is from what we assumed (UTC)
    const offset = naive.getTime() - tzEquiv.getTime();
    return new Date(naive.getTime() + offset).toISOString();
  } catch { return s; }
}

function toLocalDate(isoStr, tz) {
  if (!isoStr) return "";
  try {
    return new Intl.DateTimeFormat("en-CA", { timeZone: tz }).format(new Date(isoStr));
  } catch { return String(isoStr).slice(0, 10); }
}

function toLocalHour(isoStr, tz) {
  if (!isoStr) return 0;
  try {
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone: tz, hour: "numeric", hour12: false,
    }).formatToParts(new Date(isoStr));
    return Number(parts.find(p => p.type === "hour")?.value || 0);
  } catch { return 0; }
}

function toLocalMinute(isoStr, tz) {
  if (!isoStr) return 0;
  try {
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone: tz, minute: "numeric",
    }).formatToParts(new Date(isoStr));
    return Number(parts.find(p => p.type === "minute")?.value || 0);
  } catch { return 0; }
}

function shapeBooking(b, tz) {
  const dtRaw = b.scheduled_datetime ? String(b.scheduled_datetime).trim() : "";
  const dt    = dtRaw ? normalizeToUtc(dtRaw, tz) : "";   // canonical UTC ISO
  const isScheduled = dt.length > 0;
  const localDate = isScheduled ? toLocalDate(dt, tz) : "";
  const localHour = isScheduled ? toLocalHour(dt, tz) : 0;
  const localMin  = isScheduled ? toLocalMinute(dt, tz) : 0;
  return {
    booking_id:           b.booking_id   || "",
    quote_id:             b.quote_id     || "",
    created_at:           b.created_at   || "",
    scheduled_datetime:   dt,
    duration_minutes:     Number(b.duration_minutes) || 60,
    address:              b.address      || "",
    customer_name:        b.customer_name || "",
    status:               (b.status      || "pending").toLowerCase(),
    schedule_block:       b.schedule_block || "",
    job_type_id:          b.job_type_id  || "",
    final_price:          b.final_price  || "",
    phone:                b.phone        || "",
    email:                b.email        || "",
    block_allocated_minutes: Number(b.block_allocated_minutes) || 0,
    booking_group_id:     b.booking_group_id || "",
    is_continuation:      String(b.is_continuation || "").toLowerCase() === "true",
    assigned_tech_id:     b.assigned_tech_id || "",
    assigned_tech_ids:    b.assigned_tech_ids || "",
    assigned_tech_name:   "",
    assigned_tech_names:  [],
    lat:                  b.lat ? parseFloat(b.lat) : null,
    lng:                  b.lng ? parseFloat(b.lng) : null,
    local_date:           localDate,
    local_hour:           localHour,
    local_min:            localMin,
  };
}

async function handleGetCalendar(req, res) {
  try {
    const url   = new URL(req.url, "http://localhost");
    const start = url.searchParams.get("start") || "";
    const end   = url.searchParams.get("end")   || "";

    const sheets = await getSheetsClient();
    const id     = SPREADSHEET_ID();

    await ensureTabHeaders("Bookings");

    let staffError = null;
    const [rulesRes, bookingsRes, staffRes] = await Promise.all([
      sheets.spreadsheets.values.get({ spreadsheetId: id, range: "SchedulerRules!A1:O3" })
        .catch(() => ({ data: { values: [] } })),
      sheets.spreadsheets.values.get({ spreadsheetId: id, range: "Bookings!A:Z" }),
      sheets.spreadsheets.values.get({ spreadsheetId: require("../lib/hrSheetClient").hrSpreadsheetId(), range: "Staff!A:Z" })
        .catch(err => {
          staffError = err.message;
          console.error("[schedule-calendar] Staff read failed:", err.message);
          return { data: { values: [] } };
        }),
    ]);

    const rulesRows = rulesRes.data.values || [];
    const rulesHdrs = rulesRows[0] || [];
    const rulesData = rulesRows[1] || [];
    const rules     = Object.fromEntries(rulesHdrs.map((h, i) => [h, rulesData[i] || ""]));
    const tz        = rules.timezone || "America/Chicago";

    const rawBookings = rowsToObjects(bookingsRes.data.values || []);
    const rawStaff    = rowsToObjects(staffRes.data.values   || []);

    // Build tech lookup for assigned_tech_name
    const techMap = {};
    for (const s of rawStaff) {
      if (s.staff_id) {
        techMap[s.staff_id] = `${s.first_name || ""} ${s.last_name || ""}`.trim();
      }
    }

    // Shape all bookings
    const shaped = rawBookings
      .filter(b => b.booking_id)
      .map(b => {
        const sh = shapeBooking(b, tz);
        // Primary single tech name
        if (sh.assigned_tech_id && techMap[sh.assigned_tech_id]) {
          sh.assigned_tech_name = techMap[sh.assigned_tech_id];
        }
        // Multi-tech names from assigned_tech_ids (comma-separated)
        if (sh.assigned_tech_ids) {
          sh.assigned_tech_names = sh.assigned_tech_ids
            .split(",").map(id => id.trim()).filter(Boolean)
            .map(id => techMap[id] || id);
        }
        return sh;
      });

    // Filter by date range if provided
    const scheduled   = [];
    const unscheduled = [];
    for (const b of shaped) {
      if (!b.local_date) {
        unscheduled.push(b);
        continue;
      }
      if (start && b.local_date < start) continue;
      if (end   && b.local_date > end)   continue;
      scheduled.push(b);
    }

    // Also include unscheduled regardless of date range
    const staffOut = rawStaff
      .filter(s => s.staff_id && (
        !s.status ||
        s.status === "active" || s.status === "approved" ||
        // HR module uses employment_status instead of status
        s.employment_status === "active" || s.employment_status === "employed" ||
        s.employment_status === "full_time" || s.employment_status === "part_time"
      ))
      .map(s => ({
        staff_id:   s.staff_id,
        first_name: s.first_name || "",
        last_name:  s.last_name  || "",
        name:       `${s.first_name || ""} ${s.last_name || ""}`.trim(),
        role:       s.role        || "crew",
        phone:      s.phone       || "",
      }));

    // Group scheduled bookings by local date for task-contract compliance
    const byDate = {};
    for (const b of scheduled) {
      if (!byDate[b.local_date]) byDate[b.local_date] = [];
      byDate[b.local_date].push(b);
    }

    json(res, 200, {
      ok:             true,
      timezone:       tz,
      bookings:       scheduled,    // flat list (frontend convenience)
      by_date:        byDate,       // grouped by local date (API contract)
      unscheduled:    unscheduled,
      staff:          staffOut,
      staff_degraded: staffError !== null,
      staff_error:    staffError || undefined,
    });
  } catch (err) {
    console.error("[schedule-calendar]", err.message);
    json(res, 500, { ok: false, error: err.message });
  }
}

module.exports = { handleGetCalendar };

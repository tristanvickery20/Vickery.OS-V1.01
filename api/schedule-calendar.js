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
  const dt = b.scheduled_datetime ? String(b.scheduled_datetime).trim() : "";
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
    assigned_tech_name:   "",
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

    const [rulesRes, bookingsRes, staffRes] = await Promise.all([
      sheets.spreadsheets.values.get({ spreadsheetId: id, range: "SchedulerRules!A1:O3" })
        .catch(() => ({ data: { values: [] } })),
      sheets.spreadsheets.values.get({ spreadsheetId: id, range: "Bookings!A:Z" }),
      sheets.spreadsheets.values.get({ spreadsheetId: id, range: "Staff!A:Z" })
        .catch(() => ({ data: { values: [] } })),
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
        const shaped = shapeBooking(b, tz);
        if (shaped.assigned_tech_id && techMap[shaped.assigned_tech_id]) {
          shaped.assigned_tech_name = techMap[shaped.assigned_tech_id];
        }
        return shaped;
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
      .filter(s => s.staff_id && (s.status === "active" || s.status === "approved" || !s.status))
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
      ok:          true,
      timezone:    tz,
      bookings:    scheduled,    // flat list (frontend convenience)
      by_date:     byDate,       // grouped by local date (API contract)
      unscheduled: unscheduled,
      staff:       staffOut,
    });
  } catch (err) {
    console.error("[schedule-calendar]", err.message);
    json(res, 500, { ok: false, error: err.message });
  }
}

module.exports = { handleGetCalendar };

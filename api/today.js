// api/today.js — /api/today and /api/week endpoints for the Today/This Week dashboard
const { getSheetsClient } = require("../lib/sheets");

function num(x) {
  const n = Number(x);
  return Number.isFinite(n) ? n : 0;
}

function parseDate(s) {
  if (!s) return null;
  const str = String(s).trim();
  const d = new Date(str.includes("T") ? str : str + "T00:00:00Z");
  return isNaN(d.getTime()) ? null : d;
}

function todayLocal() {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, "0");
  const d = String(now.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function dateStr(d) {
  if (!d) return "";
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  const day = String(d.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

async function fetchRows(sheets, spreadsheetId, range) {
  try {
    const resp = await sheets.spreadsheets.values.get({ spreadsheetId, range });
    const vals = resp.data.values || [];
    if (vals.length < 2) return { headers: vals[0] || [], rows: [] };
    return { headers: vals[0], rows: vals.slice(1) };
  } catch {
    return { headers: [], rows: [] };
  }
}

function mapRow(headers, row) {
  const obj = {};
  headers.forEach((h, i) => { obj[h] = row[i] ?? ""; });
  return obj;
}

// Build a 7-day strip starting from today (UTC)
function buildWeekDays(todayStr) {
  const days = [];
  const base = new Date(todayStr + "T00:00:00Z");
  for (let i = 0; i < 7; i++) {
    const d = new Date(base.getTime() + i * 86400000);
    days.push({
      date: dateStr(d),
      label: d.toLocaleDateString("en-US", { weekday: "short", timeZone: "UTC" }),
      day:   d.toLocaleDateString("en-US", { day: "numeric", timeZone: "UTC" }),
      event_count: 0,
      task_count: 0,
      is_today: i === 0,
    });
  }
  return days;
}

async function handleToday(req, res) {
  try {
    const sheets = await getSheetsClient();
    const spreadsheetId = process.env.CRM_SHEET_ID;

    const [leadsData, tasksData, bookingsData] = await Promise.all([
      fetchRows(sheets, spreadsheetId, "Leads!A1:Z"),
      fetchRows(sheets, spreadsheetId, "Tasks!A1:L5000"),
      fetchRows(sheets, spreadsheetId, "Bookings!A1:Z").catch(() => ({ headers: [], rows: [] })),
    ]);

    const today = todayLocal();
    const todayMs = new Date(today + "T00:00:00Z").getTime();

    // ── Parse leads ──
    const leads = leadsData.rows
      .filter((r) => r.some((c) => String(c || "").trim()))
      .map((r) => mapRow(leadsData.headers, r))
      .map((l) => {
        l.estimated_value = num(l.estimated_value);
        l.quoted_price    = num(l.quoted_price);
        return l;
      });

    // ── Parse bookings (from schedule system) ──
    const bookings = bookingsData.rows
      .filter((r) => r.some((c) => String(c || "").trim()))
      .map((r) => mapRow(bookingsData.headers, r))
      .filter((b) => {
        const s = String(b.status || "").toLowerCase();
        return s !== "cancelled" && s !== "canceled";
      });

    // ── Parse tasks ──
    const tasks = tasksData.rows
      .filter((r) => r.some((c) => String(c || "").trim()))
      .map((r) => mapRow(tasksData.headers, r))
      .map((t) => ({
        task_id:     t.task_id || "",
        title:       t.title || "",
        due_date:    t.due_date || "",
        assigned_to: t.assigned_to || "",
        priority:    t.priority || "medium",
        notes:       t.notes || "",
        status:      String(t.status || "Open").toLowerCase(),
        related_lead_id: t.related_lead_id || "",
        type:        t.type || "Task",
      }))
      .filter((t) => t.status !== "done" && t.status !== "complete" && t.status !== "closed");

    // ── Today events from Leads ──
    const todayLeads = leads.filter((l) => {
      const d = parseDate(l.scheduled_date);
      return d && dateStr(d) === today;
    });

    // ── Overdue leads (past scheduled_date, still open) ──
    const overdueStatuses = new Set(["overdue"]);
    const openStatuses    = new Set(["scheduled", "in_progress", "active", "approved", "deposit_required"]);
    const overdueLeads = leads.filter((l) => {
      const d = parseDate(l.scheduled_date);
      if (!d) return false;
      const s = String(l.status || "").toLowerCase();
      return d.getTime() < todayMs && (overdueStatuses.has(s) || openStatuses.has(s));
    });

    // ── Today bookings (from Bookings sheet) ──
    const todayBookings = bookings.filter((b) => {
      const dt = b.scheduled_datetime || b.date || "";
      const d = parseDate(dt.split("T")[0] || dt);
      return d && dateStr(d) === today;
    });

    // ── Build timed_events (leads + bookings for today) ──
    const timedEventsMap = new Map();

    for (const l of todayLeads) {
      const timeHint = String(l.scheduled_time || l.start_time || "").trim();
      timedEventsMap.set("lead_" + l.id, {
        id:           l.id || "",
        type:         "lead",
        event_type:   l.job_type || "Job",
        name:         l.name || "(No name)",
        address:      l.address || "",
        assigned_to:  l.assigned_to || "",
        status:       l.status || "",
        value:        l.quoted_price || l.estimated_value || 0,
        scheduled_date: l.scheduled_date || "",
        time_hint:    timeHint,
        sort_key:     timeHint || "23:59",
        link:         "/crm/lead?id=" + encodeURIComponent(l.id || ""),
      });
    }

    for (const b of todayBookings) {
      const dt = b.scheduled_datetime || "";
      const timePart = dt.includes("T") ? dt.split("T")[1].slice(0, 5) : "";
      timedEventsMap.set("booking_" + (b.booking_id || b.id), {
        id:           b.booking_id || b.id || "",
        type:         "booking",
        event_type:   b.job_type || "Booking",
        name:         b.customer_name || b.name || "(No name)",
        address:      b.address || "",
        assigned_to:  b.assigned_tech || b.assigned_to || "",
        status:       b.status || "Scheduled",
        value:        num(b.final_price || b.estimated_price || 0),
        scheduled_date: (dt || "").split("T")[0],
        time_hint:    timePart,
        sort_key:     timePart || "23:59",
        link:         "/crm/schedule",
      });
    }

    const timed_events = Array.from(timedEventsMap.values())
      .sort((a, b) => a.sort_key.localeCompare(b.sort_key));

    // ── Overdue tasks ──
    const overdue_tasks = tasks.filter((t) => {
      if (!t.due_date) return false;
      const d = parseDate(t.due_date);
      return d && d.getTime() < todayMs;
    }).sort((a, b) => {
      const pa = { high: 0, medium: 1, low: 2 }[a.priority] ?? 1;
      const pb = { high: 0, medium: 1, low: 2 }[b.priority] ?? 1;
      return pa - pb;
    });

    // ── Unscheduled tasks (open, no past due_date, or due today) ──
    const unscheduled_tasks = tasks.filter((t) => {
      if (!t.due_date) return true;
      const d = parseDate(t.due_date);
      if (!d) return true;
      return d.getTime() >= todayMs;
    }).sort((a, b) => {
      if (a.due_date && !b.due_date) return -1;
      if (!a.due_date && b.due_date) return 1;
      if (a.due_date && b.due_date) return a.due_date.localeCompare(b.due_date);
      const pa = { high: 0, medium: 1, low: 2 }[a.priority] ?? 1;
      const pb = { high: 0, medium: 1, low: 2 }[b.priority] ?? 1;
      return pa - pb;
    });

    // ── Sidebar overdue count (overdue tasks + leads past scheduled date that are still open) ──
    const overdue_count = overdue_tasks.length + overdueLeads.length;

    // ── Week strip (next 7 days) ──
    const week_days = buildWeekDays(today);
    for (const day of week_days) {
      // Count leads scheduled on that day
      day.event_count = leads.filter((l) => {
        const d = parseDate(l.scheduled_date);
        return d && dateStr(d) === day.date;
      }).length + bookings.filter((b) => {
        const dt = b.scheduled_datetime || b.date || "";
        const d = parseDate(dt.split("T")[0] || dt);
        return d && dateStr(d) === day.date;
      }).length;

      // Count open tasks due on that day
      day.task_count = tasks.filter((t) => {
        if (!t.due_date) return false;
        const d = parseDate(t.due_date);
        return d && dateStr(d) === day.date;
      }).length;
    }

    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({
      ok: true,
      today,
      timed_events,
      overdue_tasks,
      unscheduled_tasks,
      overdue_count,
      week_days,
    }));
  } catch (e) {
    console.error("[api/today] error:", e);
    res.writeHead(500, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ ok: false, error: e.message }));
  }
}

// GET /api/week?date=YYYY-MM-DD — returns full event+task detail for a specific day
async function handleWeekDay(req, res) {
  try {
    const sheets = await getSheetsClient();
    const spreadsheetId = process.env.CRM_SHEET_ID;
    const url = new URL("http://x" + req.url);
    const date = url.searchParams.get("date") || todayLocal();

    const [leadsData, tasksData, bookingsData] = await Promise.all([
      fetchRows(sheets, spreadsheetId, "Leads!A1:Z"),
      fetchRows(sheets, spreadsheetId, "Tasks!A1:L5000"),
      fetchRows(sheets, spreadsheetId, "Bookings!A1:Z").catch(() => ({ headers: [], rows: [] })),
    ]);

    const leads = leadsData.rows
      .filter((r) => r.some((c) => String(c || "").trim()))
      .map((r) => mapRow(leadsData.headers, r));

    const bookings = bookingsData.rows
      .filter((r) => r.some((c) => String(c || "").trim()))
      .map((r) => mapRow(bookingsData.headers, r))
      .filter((b) => {
        const s = String(b.status || "").toLowerCase();
        return s !== "cancelled" && s !== "canceled";
      });

    const tasks = tasksData.rows
      .filter((r) => r.some((c) => String(c || "").trim()))
      .map((r) => mapRow(tasksData.headers, r))
      .filter((t) => {
        const s = String(t.status || "Open").toLowerCase();
        return s !== "done" && s !== "complete" && s !== "closed";
      });

    const dayLeads = leads
      .filter((l) => {
        const d = parseDate(l.scheduled_date);
        return d && dateStr(d) === date;
      })
      .map((l) => ({
        id: l.id || "",
        type: "lead",
        event_type: l.job_type || "Job",
        name: l.name || "(No name)",
        address: l.address || "",
        assigned_to: l.assigned_to || "",
        status: l.status || "",
        value: num(l.quoted_price || l.estimated_value || 0),
        time_hint: String(l.scheduled_time || l.start_time || "").trim(),
        link: "/crm/lead?id=" + encodeURIComponent(l.id || ""),
      }));

    const dayBookings = bookings
      .filter((b) => {
        const dt = b.scheduled_datetime || b.date || "";
        const d = parseDate(dt.split("T")[0] || dt);
        return d && dateStr(d) === date;
      })
      .map((b) => {
        const dt = b.scheduled_datetime || "";
        const timePart = dt.includes("T") ? dt.split("T")[1].slice(0, 5) : "";
        return {
          id: b.booking_id || b.id || "",
          type: "booking",
          event_type: b.job_type || "Booking",
          name: b.customer_name || b.name || "(No name)",
          address: b.address || "",
          assigned_to: b.assigned_tech || b.assigned_to || "",
          status: b.status || "Scheduled",
          value: num(b.final_price || b.estimated_price || 0),
          time_hint: timePart,
          link: "/crm/schedule",
        };
      });

    const events = [...dayLeads, ...dayBookings].sort((a, b) =>
      (a.time_hint || "23:59").localeCompare(b.time_hint || "23:59")
    );

    const dayTasks = tasks
      .filter((t) => {
        if (!t.due_date) return false;
        const d = parseDate(t.due_date);
        return d && dateStr(d) === date;
      });

    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ ok: true, date, events, tasks: dayTasks }));
  } catch (e) {
    console.error("[api/week] error:", e);
    res.writeHead(500, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ ok: false, error: e.message }));
  }
}

module.exports = { handleToday, handleWeekDay };

const { getSheetsClient } = require("../lib/sheets");

function num(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

function parseDateStr(s) {
  if (!s) return null;
  const str = String(s).trim();
  if (!str) return null;
  const d = new Date(str.includes("T") ? str : str + "T00:00:00Z");
  return isNaN(d.getTime()) ? null : d;
}

function startOfWeekUTC(offsetWeeks = 0) {
  const now = new Date();
  const day = now.getUTCDay();
  const diffToMonday = day === 0 ? 6 : day - 1;
  const monday = new Date(Date.UTC(
    now.getUTCFullYear(), now.getUTCMonth(),
    now.getUTCDate() - diffToMonday - offsetWeeks * 7,
    0, 0, 0, 0
  ));
  return monday;
}

function endOfWeekUTC(startMonday) {
  return new Date(startMonday.getTime() + 7 * 24 * 60 * 60 * 1000 - 1);
}

function isoDate(d) {
  return d.toISOString().slice(0, 10);
}

function weekLabel(startMonday) {
  const end = endOfWeekUTC(startMonday);
  const fmt = (d) => d.toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
  return `${fmt(startMonday)} – ${fmt(end)}`;
}

async function fetchTabRows(sheets, spreadsheetId, range) {
  try {
    const resp = await sheets.spreadsheets.values.get({ spreadsheetId, range });
    const values = resp.data.values || [];
    if (values.length < 2) return { headers: values[0] || [], rows: [] };
    return { headers: values[0], rows: values.slice(1) };
  } catch {
    return { headers: [], rows: [] };
  }
}

function parseRows(headers, rows) {
  return rows
    .filter(r => r && r.some(c => String(c || "").trim() !== ""))
    .map(r => {
      const obj = {};
      headers.forEach((h, i) => { obj[h] = r[i] ?? ""; });
      return obj;
    });
}

async function handleWeeklyPulse(req, res) {
  const jsonOut = (code, data) => {
    res.writeHead(code, { "Content-Type": "application/json" });
    res.end(JSON.stringify(data));
  };

  try {
    const sheets = await getSheetsClient();
    const sheetId = process.env.CRM_SHEET_ID;

    const [invData, leadsData, clientsData, bookingsData] = await Promise.all([
      fetchTabRows(sheets, sheetId, "Invoices!A1:AZ5000"),
      fetchTabRows(sheets, sheetId, "Leads!A1:Z5000"),
      fetchTabRows(sheets, sheetId, "Clients!A1:ZZ5000").catch(() => ({ headers: [], rows: [] })),
      fetchTabRows(sheets, sheetId, "Bookings!A1:Z5000").catch(() => ({ headers: [], rows: [] })),
    ]);

    const invoices = parseRows(invData.headers, invData.rows);
    const leads    = parseRows(leadsData.headers, leadsData.rows);
    const clients  = parseRows(clientsData.headers, clientsData.rows);
    const bookings = parseRows(bookingsData.headers, bookingsData.rows);

    // Client name lookup
    const clientMap = {};
    for (const c of clients) {
      const id = String(c.id || c.client_id || "").trim();
      if (id) clientMap[id] = String(c.name || "").trim();
    }

    // Lead name lookup
    const leadMap = {};
    for (const l of leads) {
      const id = String(l.id || "").trim();
      if (id) leadMap[id] = { name: String(l.name || "").trim(), status: String(l.status || ""), scheduled_date: l.scheduled_date };
    }

    // ── Week windows (current + 3 prior) ──────────────────────────────────────
    const weeks = [3, 2, 1, 0].map(offset => {
      const start = startOfWeekUTC(offset);
      const end   = endOfWeekUTC(start);
      return { start, end, label: weekLabel(start), offset };
    });
    const thisWeek = weeks[3]; // offset=0

    const today = new Date();
    const todayStr = isoDate(today);
    const next7end = new Date(today.getTime() + 7 * 24 * 60 * 60 * 1000);

    // ── Revenue collected per week (from invoices.paid_at + paid_amount) ──────
    const weekRevenue = weeks.map(() => 0);
    const agedReceivables = [];

    for (const inv of invoices) {
      const paidAmt   = num(inv.paid_amount);
      const totalAmt  = num(inv.total);
      const balanceDue = num(inv.balance_due || (totalAmt - paidAmt));
      const paidAt    = parseDateStr(inv.paid_at);
      const issuedAt  = parseDateStr(inv.issued_at || inv.created_at || inv.sent_at);
      const statusCode = String(inv.status_code || "").toLowerCase().trim();

      // Revenue collected — bucketed by paid_at date
      if (paidAmt > 0 && paidAt) {
        weeks.forEach((w, wi) => {
          if (paidAt >= w.start && paidAt <= w.end) {
            weekRevenue[wi] += paidAmt;
          }
        });
      }

      // Aged receivables — sent invoice with outstanding balance > 10 days ago
      if (
        balanceDue > 0.01 &&
        issuedAt &&
        (statusCode === "sent" || statusCode === "partial" || statusCode === "overdue")
      ) {
        const daysAgo = Math.floor((today - issuedAt) / (1000 * 60 * 60 * 24));
        if (daysAgo >= 10) {
          const clientId = String(inv.client_id || "").trim();
          const leadId   = String(inv.lead_id || "").trim();
          const leadInfo = leadMap[leadId] || {};
          const clientName = clientMap[clientId] || leadInfo.name || "";
          agedReceivables.push({
            invoice_id:     inv.id || "",
            invoice_number: inv.invoice_number || "",
            client_name:    clientName,
            balance_due:    Math.round(balanceDue * 100) / 100,
            issued_at:      isoDate(issuedAt),
            days_outstanding: daysAgo,
            status_code:    statusCode,
          });
        }
      }
    }

    // Sort aged receivables by days outstanding descending
    agedReceivables.sort((a, b) => b.days_outstanding - a.days_outstanding);

    // ── Jobs completed this week ──────────────────────────────────────────────
    const completedStatuses = new Set(["complete", "paid", "closed"]);
    const completedThisWeek = leads.filter(l => {
      if (!completedStatuses.has(String(l.status || "").toLowerCase().trim())) return false;
      const d = parseDateStr(l.paid_date || l.invoice_date || l.updated_at);
      return d && d >= thisWeek.start && d <= thisWeek.end;
    });

    // ── Upcoming jobs — next 7 days (from leads + bookings) ─────────────────
    const upcomingLeads = leads
      .filter(l => {
        if (completedStatuses.has(String(l.status || "").toLowerCase().trim())) return false;
        const d = parseDateStr(l.scheduled_date);
        if (!d) return false;
        return d >= today && d <= next7end;
      })
      .map(l => ({
        source: "lead",
        id:     l.id || "",
        name:   l.name || "",
        date:   l.scheduled_date || "",
        assigned_to: l.assigned_to || "",
        value: num(l.quoted_price || l.estimated_value || 0),
        status: l.status || "",
      }));

    const upcomingBookings = bookings
      .filter(b => {
        const d = parseDateStr(b.scheduled_date || b.date);
        if (!d) return false;
        const status = String(b.status || "").toLowerCase().trim();
        if (status === "cancelled" || status === "canceled" || status === "complete") return false;
        return d >= today && d <= next7end;
      })
      .map(b => ({
        source: "booking",
        id:     b.id || b.booking_id || "",
        name:   b.name || b.client_name || "",
        date:   b.scheduled_date || b.date || "",
        assigned_to: b.assigned_to || b.tech_name || "",
        value: num(b.quoted_price || b.estimated_value || 0),
        status: b.status || "",
      }));

    // Deduplicate by date + name (bookings and leads may overlap)
    const seen = new Set();
    const upcomingAll = [...upcomingLeads, ...upcomingBookings].filter(j => {
      const key = `${j.date}|${String(j.name || j.id).toLowerCase()}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    }).sort((a, b) => new Date(a.date) - new Date(b.date));

    // ── Revenue this week summary ──────────────────────────────────────────────
    const revenueThisWeek = Math.round(weekRevenue[3] * 100) / 100;

    // Revenue status flag
    let revenueStatus;
    if (revenueThisWeek >= 2000) revenueStatus = "green";
    else if (revenueThisWeek >= 1000) revenueStatus = "yellow";
    else revenueStatus = "red";

    // ── Build response ────────────────────────────────────────────────────────
    const payload = {
      ok: true,
      generated_at: new Date().toISOString(),
      week_label: thisWeek.label,

      revenue_this_week:   revenueThisWeek,
      revenue_status:      revenueStatus,

      jobs_completed_week: completedThisWeek.length,
      aged_receivables_count: agedReceivables.length,
      aged_receivables_total: Math.round(agedReceivables.reduce((s, a) => s + a.balance_due, 0) * 100) / 100,

      upcoming_jobs_count: upcomingAll.length,

      four_week_chart: weeks.map((w, wi) => ({
        label:   w.label,
        revenue: Math.round(weekRevenue[wi] * 100) / 100,
        offset:  w.offset,
      })),

      aged_receivables:  agedReceivables.slice(0, 20),
      upcoming_jobs:     upcomingAll.slice(0, 15),
    };

    return jsonOut(200, payload);
  } catch (err) {
    console.error("[weekly-pulse]", err);
    return jsonOut(500, { ok: false, error: err.message });
  }
}

module.exports = { handleWeeklyPulse };

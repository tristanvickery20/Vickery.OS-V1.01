const { getSheetsClient } = require("../lib/sheets");
const { getConfig } = require("../lib/config");

function num(x) {
  const n = Number(x);
  return Number.isFinite(n) ? n : 0;
}

function st(lead) {
  return String(lead.status || "").toLowerCase().trim();
}

function isClosed(status) {
  const s = String(status || "").toLowerCase();
  return s === "closed" || s === "paid";
}

function needsDeposit(lead) {
  const est = num(lead.estimated_value);
  const jobType = String(lead.job_type || "").toLowerCase();
  const depReq = lead.deposit_required === true || String(lead.deposit_required).toLowerCase() === "true";
  return depReq || jobType === "project" || est >= 500;
}

function parseLeadRow(headers, row) {
  const obj = {};
  headers.forEach((h, i) => (obj[h] = row[i] ?? ""));
  obj.estimated_value = num(obj.estimated_value);
  obj.deposit_received = num(obj.deposit_received);
  obj.invoiced_amount = num(obj.invoiced_amount);
  obj.paid_amount = num(obj.paid_amount);
  obj.quoted_price = num(obj.quoted_price);
  obj.deposit_required = obj.deposit_required === true || String(obj.deposit_required).toLowerCase() === "true";
  return obj;
}

function getCurrentWeekUTC() {
  const now = new Date();
  const day = now.getUTCDay();
  const diffToMonday = day === 0 ? 6 : day - 1;
  const monday = new Date(Date.UTC(
    now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - diffToMonday,
    0, 0, 0, 0
  ));
  const sunday = new Date(monday.getTime() + 7 * 24 * 60 * 60 * 1000 - 1);
  return { start: monday, end: sunday };
}

function todayUTC() {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
}

function nDaysAgo(n) {
  const d = todayUTC();
  d.setUTCDate(d.getUTCDate() - n);
  return d;
}

function nDaysFromNow(n) {
  const d = todayUTC();
  d.setUTCDate(d.getUTCDate() + n);
  return d;
}

function parseDateStr(s) {
  if (!s) return null;
  const d = new Date(String(s).includes("T") ? s : s + "T00:00:00Z");
  return isNaN(d.getTime()) ? null : d;
}

function isDateInWeek(dateStr, week) {
  if (!dateStr) return false;
  const d = new Date(dateStr + "T00:00:00Z");
  return d >= week.start && d <= week.end;
}

async function fetchTabRows(sheets, spreadsheetId, tabRange) {
  try {
    const resp = await sheets.spreadsheets.values.get({ spreadsheetId, range: tabRange });
    const values = resp.data.values || [];
    if (values.length < 2) return { headers: values[0] || [], rows: [] };
    return { headers: values[0], rows: values.slice(1) };
  } catch {
    return { headers: [], rows: [] };
  }
}

async function handleDashboard(req, res) {
  try {
    const sheets = await getSheetsClient();
    const spreadsheetId = process.env.CRM_SHEET_ID;

    const [leadsData, timeData, expData, quotesData, snapshotsData, config] = await Promise.all([
      fetchTabRows(sheets, spreadsheetId, "Leads!A1:Z"),
      fetchTabRows(sheets, spreadsheetId, "Time!A1:H2000"),
      fetchTabRows(sheets, spreadsheetId, "Expenses!A1:J2000"),
      fetchTabRows(sheets, spreadsheetId, "Quotes!A1:G2000"),
      fetchTabRows(sheets, spreadsheetId, "QuoteSnapshots!A1:Z"),
      getConfig(),
    ]);

    const laborRateTech = Number(config.labor_rate_tech || 50);

    const leads = leadsData.rows
      .filter((r) => r.some((cell) => String(cell || "").trim() !== ""))
      .map((r) => parseLeadRow(leadsData.headers, r));

    const today = todayUTC();
    const week = getCurrentWeekUTC();
    const ago7 = nDaysAgo(7);
    const ago30 = nDaysAgo(30);
    const next7 = nDaysFromNow(7);

    // ── Today Summary ──
    const todayStr = today.toISOString().split("T")[0];
    const todayLeads = leads.filter((l) => {
      const d = parseDateStr(l.scheduled_date);
      return d && d.toISOString().split("T")[0] === todayStr;
    });
    const todayCompleted = todayLeads.filter((l) => {
      const s = st(l);
      return s === "complete" || s === "closed" || s === "paid";
    }).length;
    const todayPipelineValue = todayLeads.reduce((s, l) => s + (l.quoted_price || l.estimated_value || 0), 0);
    const today_summary = {
      scheduled: todayLeads.length,
      completed: todayCompleted,
      pending: todayLeads.length - todayCompleted,
      pipeline_value: todayPipelineValue,
    };

    // ── Pipeline card ──
    const openLeads = leads.filter((l) => !isClosed(l.status));
    const awaitingApprovalStatuses = new Set(["estimate_sent", "approved", "deposit_required", "awaiting_response", "new"]);
    const activeStatuses = new Set(["scheduled", "in_progress", "active"]);
    const pipeline_card = {
      total_leads: leads.length,
      awaiting_approval: leads.filter((l) => awaitingApprovalStatuses.has(st(l))).length,
      active: leads.filter((l) => activeStatuses.has(st(l))).length,
    };

    // ── Money card ──
    const quotesHeaders = quotesData.headers;
    const qCreatedIdx = quotesHeaders.indexOf("created_at");
    const qPriceIdx = quotesHeaders.indexOf("quoted_price");
    let quoted_7d = 0;
    // Old quote system (Quotes tab)
    for (const row of quotesData.rows) {
      const d = parseDateStr(row[qCreatedIdx]);
      if (d && d >= ago7) quoted_7d += num(row[qPriceIdx]);
    }
    // New quote engine (QuoteSnapshots tab) — count only "locked" events, deduplicate by quote_id
    {
      const sh = snapshotsData.headers;
      const sEventTypeIdx  = sh.indexOf("event_type");
      const sCreatedIdx    = sh.indexOf("created_at");
      const sFinalPriceIdx = sh.indexOf("final_price");
      const sQuoteIdIdx    = sh.indexOf("quote_id");
      const seenQuoteIds   = new Set();
      for (const row of snapshotsData.rows) {
        if (sEventTypeIdx >= 0 && String(row[sEventTypeIdx] || "").trim() !== "locked") continue;
        const qid = String(row[sQuoteIdIdx] || "").trim();
        if (!qid || seenQuoteIds.has(qid)) continue;
        const d = parseDateStr(row[sCreatedIdx]);
        if (d && d >= ago7) {
          seenQuoteIds.add(qid);
          quoted_7d += num(row[sFinalPriceIdx]);
        }
      }
    }

    let invoiced_7d = 0;
    let paid_7d = 0;
    for (const l of leads) {
      const invD = parseDateStr(l.invoice_date);
      if (invD && invD >= ago7) invoiced_7d += l.invoiced_amount;
      const paidD = parseDateStr(l.paid_date);
      if (paidD && paidD >= ago7) paid_7d += l.paid_amount;
    }

    const money_card = {
      quoted_7d: Math.round(quoted_7d * 100) / 100,
      invoiced_7d: Math.round(invoiced_7d * 100) / 100,
      paid_7d: Math.round(paid_7d * 100) / 100,
    };

    // ── Operations card ──
    const scheduledNext7 = leads.filter((l) => {
      const d = parseDateStr(l.scheduled_date);
      return d && d >= today && d <= next7 && activeStatuses.has(st(l));
    }).length;
    const overdueCount = leads.filter((l) => st(l) === "overdue").length;
    const unassignedCount = leads.filter((l) => {
      const s = st(l);
      return !l.assigned_to && (s === "scheduled" || s === "in_progress");
    }).length;
    const ops_card = {
      scheduled_7d: scheduledNext7,
      overdue: overdueCount,
      unassigned: unassignedCount,
    };

    // ── Closeout card ──
    const completedStatuses = new Set(["complete", "paid", "closed"]);
    const completed_7d = leads.filter((l) => {
      const d = parseDateStr(l.paid_date) || parseDateStr(l.invoice_date);
      return completedStatuses.has(st(l)) && d && d >= ago7;
    }).length;
    const invoiced_not_paid = leads.filter((l) => l.invoiced_amount > l.paid_amount && l.invoiced_amount > 0).length;
    const closed_30d = leads.filter((l) => {
      const d = parseDateStr(l.paid_date) || parseDateStr(l.invoice_date);
      return completedStatuses.has(st(l)) && d && d >= ago30;
    }).length;
    const closeout_card = {
      completed_7d,
      invoiced_not_paid,
      closed_30d,
    };

    // ── Today's Schedule list ──
    const today_schedule = todayLeads
      .sort((a, b) => {
        const da = parseDateStr(a.scheduled_date) || new Date(0);
        const db = parseDateStr(b.scheduled_date) || new Date(0);
        return da - db;
      })
      .map((l) => ({
        id: l.id || "",
        name: l.name || "",
        status: l.status || "",
        scheduled_date: l.scheduled_date || "",
        value: l.quoted_price || l.estimated_value || 0,
        assigned_to: l.assigned_to || "",
        address: l.address || "",
      }));

    // ── Build QuoteSnapshot name lookup (quote_id → customer_name) ──
    const snapshotNameByQuoteId = {};
    {
      const sh = snapshotsData.headers;
      const sQid   = sh.indexOf("quote_id");
      const sName  = sh.indexOf("customer_name");
      for (const row of snapshotsData.rows) {
        const qid = String(row[sQid] || "").trim();
        const nm  = String(row[sName] || "").trim();
        if (qid && nm && !snapshotNameByQuoteId[qid]) snapshotNameByQuoteId[qid] = nm;
      }
    }

    function resolveName(l) {
      if (l.name) return l.name;
      // Try last_quote_id → QuoteSnapshots customer_name
      if (l.last_quote_id && snapshotNameByQuoteId[l.last_quote_id]) return snapshotNameByQuoteId[l.last_quote_id];
      // Try quote_snapshot_json embedded name (old quote engine format)
      try {
        const snap = JSON.parse(l.quote_snapshot_json || "{}");
        return snap?.lead?.name || snap?.customer_name || "";
      } catch { return ""; }
    }

    // ── Recent Activity ──
    const recent_activity = leads
      .filter((l) => l.created_at)
      .sort((a, b) => {
        const da = parseDateStr(a.last_activity_at) || parseDateStr(a.updated_at) || parseDateStr(a.created_at) || new Date(0);
        const db = parseDateStr(b.last_activity_at) || parseDateStr(b.updated_at) || parseDateStr(b.created_at) || new Date(0);
        return db - da;
      })
      .slice(0, 10)
      .map((l) => ({
        id: l.id || "",
        name: resolveName(l),
        status: l.status || "",
        last_activity_at: l.last_activity_at || l.updated_at || l.created_at || "",
      }));

    // ── Existing KPIs (preserved) ──
    const pipeline_estimated = openLeads.reduce((s, l) => s + num(l.estimated_value), 0);
    const deposits_held = leads.reduce((s, l) => s + num(l.deposit_received), 0);
    const invoiced_total = leads.reduce((s, l) => s + num(l.invoiced_amount), 0);
    const paid_total = leads.reduce((s, l) => s + num(l.paid_amount), 0);
    const receivables = Math.max(0, invoiced_total - paid_total);

    const risk = leads.filter((l) => {
      const s = st(l);
      if (s !== "scheduled" && s !== "in_progress") return false;
      if (!needsDeposit(l)) return false;
      if (num(l.deposit_received) > 0) return false;
      const override = String(l.deposit_override || "").toLowerCase() === "true";
      if (override) return false;
      return true;
    });

    const timeHeaders = timeData.headers;
    const dateIdx = timeHeaders.indexOf("date");
    const minIdx = timeHeaders.indexOf("minutes");
    let hours_this_week = 0;
    for (const row of timeData.rows) {
      if (dateIdx >= 0 && isDateInWeek(row[dateIdx], week)) {
        hours_this_week += num(row[minIdx]);
      }
    }
    hours_this_week = Math.round((hours_this_week / 60) * 100) / 100;

    const expHeaders = expData.headers;
    const eDateIdx = expHeaders.indexOf("date");
    const eAmtIdx = expHeaders.indexOf("amount");
    const eTypeIdx = expHeaders.indexOf("type");
    let expenses_this_week = 0;
    let gas_this_week = 0;
    for (const row of expData.rows) {
      if (eDateIdx >= 0 && isDateInWeek(row[eDateIdx], week)) {
        const amt = num(row[eAmtIdx]);
        expenses_this_week += amt;
        if (String(row[eTypeIdx] || "").toLowerCase() === "gas") gas_this_week += amt;
      }
    }
    expenses_this_week = Math.round(expenses_this_week * 100) / 100;
    gas_this_week = Math.round(gas_this_week * 100) / 100;

    const completed_not_invoiced = leads.filter((l) => st(l) === "complete").length;

    const tLeadIdx = timeData.headers.indexOf("lead_id");
    const tMinIdx2 = timeData.headers.indexOf("minutes");
    const laborMinByLead = {};
    for (const row of timeData.rows) {
      const lid = String(row[tLeadIdx] || "").trim();
      if (!lid) continue;
      laborMinByLead[lid] = (laborMinByLead[lid] || 0) + num(row[tMinIdx2]);
    }

    const eLeadIdx2 = expData.headers.indexOf("lead_id");
    const eAmtIdx2 = expData.headers.indexOf("amount");
    const expCostByLead = {};
    for (const row of expData.rows) {
      const lid = String(row[eLeadIdx2] || "").trim();
      if (!lid) continue;
      expCostByLead[lid] = (expCostByLead[lid] || 0) + num(row[eAmtIdx2]);
    }

    let total_labor_cost_this_week = 0;
    for (const row of timeData.rows) {
      if (dateIdx >= 0 && isDateInWeek(row[dateIdx], week)) {
        total_labor_cost_this_week += num(row[tMinIdx2]);
      }
    }
    total_labor_cost_this_week = Math.round(((total_labor_cost_this_week / 60) * laborRateTech) * 100) / 100;

    let totalRevenue = 0;
    let totalCost = 0;
    for (const l of leads) {
      const rev = num(l.invoiced_amount) > 0 ? num(l.invoiced_amount) : num(l.quoted_price);
      const labMin = laborMinByLead[l.id] || 0;
      const labCost = (labMin / 60) * laborRateTech;
      const expCost = expCostByLead[l.id] || 0;
      totalRevenue += rev;
      totalCost += labCost + expCost;
    }
    const gross_profit_total = Math.round((totalRevenue - totalCost) * 100) / 100;
    const gross_margin_pct_total = totalRevenue > 0
      ? Math.round(((totalRevenue - totalCost) / totalRevenue) * 10000) / 100
      : null;

    const kpis = {
      open_leads_count: openLeads.length,
      pipeline_estimated,
      deposits_held,
      invoiced_total,
      paid_total,
      receivables,
      deposit_risk_count: risk.length,
      hours_this_week,
      expenses_this_week,
      gas_this_week,
      completed_not_invoiced,
      total_labor_cost_this_week,
      total_expense_cost_this_week: expenses_this_week,
      gross_profit_total,
      gross_margin_pct_total,
    };

    res.writeHead(200, { "Content-Type": "application/json" });
    return res.end(JSON.stringify({
      ok: true,
      kpis,
      risk,
      today_summary,
      pipeline_card,
      money_card,
      ops_card,
      closeout_card,
      today_schedule,
      recent_activity,
    }));
  } catch (e) {
    res.writeHead(500, { "Content-Type": "application/json" });
    return res.end(JSON.stringify({ ok: false, error: e.message }));
  }
}

module.exports = { handleDashboard };

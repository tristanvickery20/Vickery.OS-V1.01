const { getSheetsClient } = require("../lib/sheets");
const { getConfig } = require("../lib/config");

function num(x) {
  const n = Number(x);
  return Number.isFinite(n) ? n : 0;
}

function isClosed(status) {
  return status === "Closed" || status === "Paid";
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
  // Normalize some fields
  obj.estimated_value = num(obj.estimated_value);
  obj.deposit_received = num(obj.deposit_received);
  obj.invoiced_amount = num(obj.invoiced_amount);
  obj.paid_amount = num(obj.paid_amount);
  obj.deposit_required = obj.deposit_required === true || String(obj.deposit_required).toLowerCase() === "true";
  return obj;
}

/**
 * "This week" = Monday 00:00 UTC through Sunday 23:59 UTC.
 * Returns { start: Date, end: Date } for the current UTC week.
 */
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

    const [leadsData, timeData, expData, config] = await Promise.all([
      fetchTabRows(sheets, spreadsheetId, "Leads!A1:Z"),
      fetchTabRows(sheets, spreadsheetId, "Time!A1:H2000"),
      fetchTabRows(sheets, spreadsheetId, "Expenses!A1:J2000"),
      getConfig(),
    ]);

    const laborRateTech = Number(config.labor_rate_tech || 50);

    const leads = leadsData.rows
      .filter((r) => r.some((cell) => String(cell || "").trim() !== ""))
      .map((r) => parseLeadRow(leadsData.headers, r));

    const openLeads = leads.filter((l) => !isClosed(String(l.status || "")));

    const pipeline_estimated = openLeads.reduce((s, l) => s + num(l.estimated_value), 0);
    const deposits_held = leads.reduce((s, l) => s + num(l.deposit_received), 0);
    const invoiced_total = leads.reduce((s, l) => s + num(l.invoiced_amount), 0);
    const paid_total = leads.reduce((s, l) => s + num(l.paid_amount), 0);
    const receivables = Math.max(0, invoiced_total - paid_total);

    const risk = leads.filter((l) => {
      const st = String(l.status || "");
      if (st !== "Scheduled" && st !== "In Progress") return false;
      if (!needsDeposit(l)) return false;
      if (num(l.deposit_received) > 0) return false;
      const override = String(l.deposit_override || "").toLowerCase() === "true";
      if (override) return false;
      return true;
    });

    const week = getCurrentWeekUTC();

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
        if (String(row[eTypeIdx] || "").toLowerCase() === "gas") {
          gas_this_week += amt;
        }
      }
    }
    expenses_this_week = Math.round(expenses_this_week * 100) / 100;
    gas_this_week = Math.round(gas_this_week * 100) / 100;

    const completed_not_invoiced = leads.filter((l) => {
      return String(l.status || "") === "Complete";
    }).length;

    // ── Job Costing KPIs ──
    // Build per-lead labor minutes and expense cost lookups
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

    // Weekly labor and expense costs (using existing week window)
    let total_labor_cost_this_week = 0;
    for (const row of timeData.rows) {
      if (dateIdx >= 0 && isDateInWeek(row[dateIdx], week)) {
        total_labor_cost_this_week += num(row[tMinIdx2]);
      }
    }
    total_labor_cost_this_week = Math.round(((total_labor_cost_this_week / 60) * laborRateTech) * 100) / 100;

    let total_expense_cost_this_week = expenses_this_week;

    // Total gross profit and margin across all leads with revenue
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
    const gross_margin_pct_total = totalRevenue > 0 ? Math.round(((totalRevenue - totalCost) / totalRevenue) * 10000) / 100 : null;

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
      total_expense_cost_this_week,
      gross_profit_total,
      gross_margin_pct_total,
    };

    res.writeHead(200, { "Content-Type": "application/json" });
    return res.end(JSON.stringify({ ok: true, kpis, risk }));
  } catch (e) {
    res.writeHead(500, { "Content-Type": "application/json" });
    return res.end(JSON.stringify({ ok: false, error: e.message }));
  }
}

module.exports = { handleDashboard };
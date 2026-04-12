const { getSheetsClient } = require("../lib/sheets");
const { getConfig } = require("../lib/config");
const provider = require("../lib/accounting");

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

    const [leadsData, timeData, expData, quotesData, snapshotsData, config, attachData, clientsData] = await Promise.all([
      fetchTabRows(sheets, spreadsheetId, "Leads!A1:Z"),
      fetchTabRows(sheets, spreadsheetId, "Time!A1:H2000"),
      fetchTabRows(sheets, spreadsheetId, "Expenses!A1:J2000"),
      fetchTabRows(sheets, spreadsheetId, "Quotes!A1:G2000"),
      fetchTabRows(sheets, spreadsheetId, "QuoteSnapshots!A1:Z"),
      getConfig(),
      fetchTabRows(sheets, spreadsheetId, "Attachments!A1:K5000").catch(() => ({ headers: [], rows: [] })),
      fetchTabRows(sheets, spreadsheetId, "Clients!A1:ZZ5000").catch(() => ({ headers: [], rows: [] })),
    ]);

    const laborRateTech = Number(config.labor_rate_tech || 50);
    const burdenPct     = Number(config.burden_pct || 0);
    const loadedRate    = laborRateTech * (1 + burdenPct / 100);

    const leads = leadsData.rows
      .filter((r) => r.some((cell) => String(cell || "").trim() !== ""))
      .map((r) => parseLeadRow(leadsData.headers, r));

    // Build a combined lead set for bonus/profit-share computations (Leads tab + Clients tab)
    const clientLeadsForBonus = (clientsData.rows || [])
      .filter((r) => r && r.some((cell) => String(cell || "").trim() !== ""))
      .map((r) => {
        const obj = {};
        (clientsData.headers || []).forEach((h, i) => { obj[h] = r[i] ?? ""; });
        obj.id              = String(obj.lead_id || obj.id || "").trim();
        obj.paid_amount     = num(obj.paid_amount);
        obj.invoiced_amount = num(obj.invoiced_amount);
        obj.quoted_price    = num(obj.quoted_price);
        // Normalize status: prefer status_code, fall back to status column
        obj.status = String(obj.status_code || obj.status || "").toLowerCase().trim();
        return obj;
      })
      .filter((r) => r.id);

    const leadsTabIds    = new Set(leads.map((l) => l.id));
    const allLeadsForBonus = [...leads, ...clientLeadsForBonus.filter((c) => !leadsTabIds.has(c.id))];

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
    const qPriceIdx   = quotesHeaders.indexOf("quoted_price");
    const qIdIdx      = quotesHeaders.indexOf("quote_id");
    let quoted_7d = 0;
    // Shared deduplication set spans BOTH sources to prevent double-counting
    // (old api/quotes.js writes to Quotes tab; new quote-engine writes to QuoteSnapshots)
    const seenQuoteIds = new Set();

    // Old quote system (Quotes tab)
    for (const row of quotesData.rows) {
      const qid = qIdIdx >= 0 ? String(row[qIdIdx] || "").trim() : "";
      if (qid && seenQuoteIds.has(qid)) continue;
      const d = parseDateStr(row[qCreatedIdx]);
      if (d && d >= ago7) {
        if (qid) seenQuoteIds.add(qid);
        quoted_7d += num(row[qPriceIdx]);
      }
    }

    // New quote engine (QuoteSnapshots tab) — count only "locked" events
    {
      const sh = snapshotsData.headers;
      const sEventTypeIdx  = sh.indexOf("event_type");
      const sCreatedIdx    = sh.indexOf("created_at");
      const sFinalPriceIdx = sh.indexOf("final_price");
      const sQuoteIdIdx    = sh.indexOf("quote_id");
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

    // ── Labor minutes (work category only, excluding drive/admin) ──
    const tLeadIdx    = timeData.headers.indexOf("lead_id");
    const tMinIdx2    = timeData.headers.indexOf("minutes");
    const tCatIdx2    = timeData.headers.indexOf("category");
    const NON_WORK_D  = new Set(["drive", "travel", "admin", "overhead"]);
    const laborMinByLead = {};
    for (const row of timeData.rows) {
      const lid = String(row[tLeadIdx] || "").trim();
      if (!lid) continue;
      const cat = tCatIdx2 >= 0 ? String(row[tCatIdx2] || "").trim().toLowerCase() : "";
      if (NON_WORK_D.has(cat)) continue;
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

    // ── Photos per lead from Attachments tab ──
    const aEntityIdIdx = attachData.headers.indexOf("entity_id");
    const aFileUrlIdx  = attachData.headers.indexOf("file_url");
    const photosPerLead = {};
    if (aEntityIdIdx >= 0 && aFileUrlIdx >= 0) {
      for (const row of attachData.rows) {
        const lid  = String(row[aEntityIdIdx] || "").trim();
        if (!lid) continue;
        const url2 = String(row[aFileUrlIdx] || "").toLowerCase();
        if (/\.(png|jpg|jpeg|webp|gif)(\?|$)/.test(url2)) {
          photosPerLead[lid] = (photosPerLead[lid] || 0) + 1;
        }
      }
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

    // ── Bonus Tracker (all 4 tests, current-month payroll period) ──
    function bonusTierAmt(collected) {
      if (collected < 1000) return 50;
      if (collected < 5000) return 100;
      return 150;
    }
    // Profit-share tiers by Adjusted Net Profit — verify breakpoints against Exhibit A
    function profitShareTier(anp) {
      if (anp <= 0)        return { pct: 0,  label: "0%" };
      if (anp < 50000)     return { pct: 1,  label: "1%" };
      if (anp < 100000)    return { pct: 2,  label: "2%" };
      if (anp < 200000)    return { pct: 3,  label: "3%" };
      return               { pct: 6,  label: "6%" };
    }

    const nowD = new Date();
    const thisMonthYear = nowD.getUTCFullYear();
    const thisMonth     = nowD.getUTCMonth();
    const thisYear      = nowD.getUTCFullYear();

    const bonusDoneStatus = new Set(["complete", "closed", "paid"]);
    let bonusEarned = 0, bonusPending = 0, bonusMarginFail = 0, bonusDocFail = 0;
    let bonusTotalEarned = 0, bonusEarnedThisMonth = 0;

    // YTD profit-share accumulation
    let ytdCollected = 0, ytdDirectCost = 0;

    for (const l of allLeadsForBonus) {
      const lStatus = st(l);

      // YTD profit-share: all paid jobs this calendar year
      const paidDateStr = String(l.paid_date || "");
      const paidDate    = paidDateStr ? new Date(paidDateStr.includes("T") ? paidDateStr : paidDateStr + "T00:00:00Z") : null;
      if (paidDate && paidDate.getUTCFullYear() === thisYear) {
        const coll      = num(l.paid_amount);
        const labMin    = laborMinByLead[l.id] || 0;
        const labCost   = (labMin / 60) * loadedRate;
        const expCost   = expCostByLead[l.id] || 0;
        ytdCollected   += coll;
        ytdDirectCost  += labCost + expCost;
      }

      if (!bonusDoneStatus.has(lStatus)) continue;

      const collected = num(l.paid_amount) > 0 ? num(l.paid_amount) : num(l.invoiced_amount);
      const labMin    = laborMinByLead[l.id] || 0;
      const labCost   = (labMin / 60) * loadedRate;
      const expCost   = expCostByLead[l.id] || 0;
      const totalC    = labCost + expCost;
      const marginPct = collected > 0 ? ((collected - totalC) / collected) * 100 : null;
      const marginOk  = marginPct !== null && marginPct >= 40;
      const hasTime   = labMin > 0;
      const hasPhoto  = (photosPerLead[l.id] || 0) >= 1;
      const docOk     = hasTime && hasPhoto;
      const noDeviation = !(String(l.unauthorized_deviation || "").toLowerCase() === "true");

      const compDateStr = String(l.paid_date || l.scheduled_date || "");
      const compDate    = compDateStr ? new Date(compDateStr.includes("T") ? compDateStr : compDateStr + "T00:00:00Z") : null;
      const daysSince   = compDate ? (nowD.getTime() - compDate.getTime()) / (1000 * 60 * 60 * 24) : null;
      const qualityOk   = daysSince !== null && daysSince >= 14;

      if (!marginOk || !noDeviation) {
        bonusMarginFail++;
      } else if (!docOk) {
        bonusDocFail++;
      } else if (!qualityOk) {
        bonusPending++;
      } else {
        const earnedAmt = bonusTierAmt(collected);
        bonusEarned++;
        bonusTotalEarned += earnedAmt;
        // This payroll period = completion in current calendar month
        if (compDate && compDate.getUTCFullYear() === thisMonthYear && compDate.getUTCMonth() === thisMonth) {
          bonusEarnedThisMonth += earnedAmt;
        }
      }
    }

    const ytdANP    = Math.round((ytdCollected - ytdDirectCost) * 100) / 100;
    const psTier    = profitShareTier(ytdANP);
    const psAmount  = Math.round(ytdANP * (psTier.pct / 100) * 100) / 100;

    const bonus_tracker = {
      earned_count:         bonusEarned,
      pending_count:        bonusPending,
      margin_fail_count:    bonusMarginFail,
      doc_fail_count:       bonusDocFail,
      total_earned_bonus:   bonusTotalEarned,
      earned_this_month:    bonusEarnedThisMonth,
    };
    const profit_share = {
      ytd_collected_revenue: Math.round(ytdCollected * 100) / 100,
      ytd_direct_job_cost:   Math.round(ytdDirectCost * 100) / 100,
      ytd_adjusted_net_profit: ytdANP,
      projected_tier_pct:    psTier.pct,
      projected_tier_label:  psTier.label,
      projected_share_amount: psAmount,
    };

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
      bonus_tracker,
      profit_share,
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

// GET /api/dashboard/financials
// Returns AR summary and cash snapshot from the accounting provider.
// Uses mock-computed totals from Invoices/Payments sheets by default.
// When QuickBooks is connected, the same endpoint returns live QB data.
async function handleDashboardFinancials(req, res) {
  try {
    const [arResult, cashResult] = await Promise.all([
      provider.getARSummary().catch(err => ({ ok: false, error: err.message })),
      provider.getCashSnapshot().catch(err => ({ ok: false, error: err.message })),
    ]);

    const arOk = arResult.ok !== false;
    const cashOk = cashResult.ok !== false;
    const partial = !arOk || !cashOk;
    const errors = [];
    if (!arOk) errors.push("ar: " + (arResult.error || "unknown"));
    if (!cashOk) errors.push("cash: " + (cashResult.error || "unknown"));

    res.writeHead(200, { "Content-Type": "application/json" });
    return res.end(JSON.stringify({
      ok: !partial,
      partial: partial,
      errors: errors.length ? errors : undefined,
      provider: provider.name,
      open_ar:             arResult.open_ar            || 0,
      invoiced_this_month: arResult.invoiced_this_month || 0,
      aging:               arResult.aging              || { current: 0, days_30: 0, days_60: 0, days_90_plus: 0 },
      collected_this_month: cashResult.collected_this_month || 0,
      collected_ytd:        cashResult.collected_ytd        || 0,
    }));
  } catch (e) {
    res.writeHead(500, { "Content-Type": "application/json" });
    return res.end(JSON.stringify({ ok: false, error: e.message }));
  }
}

module.exports = { handleDashboard, handleDashboardFinancials };

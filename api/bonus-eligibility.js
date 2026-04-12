const { getSheetsClient } = require("../lib/sheets");
const { getConfig } = require("../lib/config");

function num(x) {
  const n = Number(x);
  return Number.isFinite(n) ? n : 0;
}

async function fetchTabRows(sheets, spreadsheetId, range) {
  const resp = await sheets.spreadsheets.values.get({ spreadsheetId, range });
  const values = resp.data.values || [];
  if (!values.length) return { headers: [], rows: [] };
  const headers = values[0].map((h) => String(h || "").trim().toLowerCase());
  const rows = values.slice(1).filter((r) => r && r.some((c) => String(c || "").trim() !== ""));
  return { headers, rows };
}

function getCell(row, headers, col) {
  const i = headers.indexOf(col);
  return i >= 0 ? String(row[i] ?? "") : "";
}

function parseDate(str) {
  if (!str) return null;
  const d = new Date(str);
  return isNaN(d.getTime()) ? null : d;
}

function daysBetween(dateA, dateB) {
  const ms = Math.abs(dateB.getTime() - dateA.getTime());
  return ms / (1000 * 60 * 60 * 24);
}

function bonusTier(collectedRevenue) {
  if (collectedRevenue < 1000) return { label: "< $1k", amount: 50 };
  if (collectedRevenue < 5000) return { label: "$1k – $4,999", amount: 100 };
  return { label: "$5k+", amount: 150 };
}

const MATERIAL_TYPES = new Set(["material", "materials", "parts", "part", "equipment", "supply", "supplies"]);
const PERMIT_TYPES   = new Set(["permit", "permits", "inspection", "fee", "fees"]);
const SUB_TYPES      = new Set(["subcontractor", "sub", "subcontract"]);

async function handleBonusEligibility(req, res) {
  function json(code, data) {
    res.writeHead(code, { "Content-Type": "application/json" });
    res.end(JSON.stringify(data));
  }

  const url = new URL(req.url, "http://localhost");
  const leadId = url.searchParams.get("lead_id") || "";
  if (!leadId) return json(400, { ok: false, error: "lead_id is required" });

  try {
    const sheets = await getSheetsClient();
    const sid    = process.env.CRM_SHEET_ID;

    const [config, timeData, expData, clientsData, attachData] = await Promise.all([
      getConfig(),
      fetchTabRows(sheets, sid, "Time!A1:L2000"),
      fetchTabRows(sheets, sid, "Expenses!A1:J2000"),
      fetchTabRows(sheets, sid, "Clients!A1:ZZ5000"),
      fetchTabRows(sheets, sid, "Attachments!A1:K5000").catch(() => ({ headers: [], rows: [] })),
    ]);

    const laborRateTech = num(config.labor_rate_tech || 50);
    const burdenPct     = num(config.burden_pct     || 0);
    const loadedRate    = laborRateTech * (1 + burdenPct / 100);

    // ── Time: sum WORK minutes for this lead (exclude drive/admin) ──
    const tLeadIdx  = timeData.headers.indexOf("lead_id");
    const tMinIdx   = timeData.headers.indexOf("minutes");
    const tCatIdx   = timeData.headers.indexOf("category");
    const NON_WORK  = new Set(["drive", "travel", "admin", "overhead"]);
    let totalMinutes  = 0;
    let timeEntries   = 0;
    if (tLeadIdx >= 0 && tMinIdx >= 0) {
      for (const row of timeData.rows) {
        if (String(row[tLeadIdx] || "").trim() !== leadId) continue;
        const cat = tCatIdx >= 0 ? String(row[tCatIdx] || "").trim().toLowerCase() : "";
        if (NON_WORK.has(cat)) continue;
        totalMinutes += num(row[tMinIdx]);
        timeEntries++;
      }
    }
    const laborCost = Math.round(((totalMinutes / 60) * loadedRate) * 100) / 100;

    // ── Expenses: split by type for this lead ──
    const eLeadIdx = expData.headers.indexOf("lead_id");
    const eAmtIdx  = expData.headers.indexOf("amount");
    const eTypeIdx = expData.headers.indexOf("type");
    let directMaterials = 0;
    let directPermits   = 0;
    let directSub       = 0;
    if (eLeadIdx >= 0 && eAmtIdx >= 0) {
      for (const row of expData.rows) {
        if (String(row[eLeadIdx] || "").trim() !== leadId) continue;
        const amt  = num(row[eAmtIdx]);
        const type = String(row[eTypeIdx] || "").trim().toLowerCase();
        if (MATERIAL_TYPES.has(type))  directMaterials += amt;
        else if (PERMIT_TYPES.has(type)) directPermits += amt;
        else if (SUB_TYPES.has(type))   directSub     += amt;
      }
    }
    directMaterials = Math.round(directMaterials * 100) / 100;
    directPermits   = Math.round(directPermits * 100) / 100;
    directSub       = Math.round(directSub * 100) / 100;
    const directJobCost = Math.round((laborCost + directMaterials + directPermits + directSub) * 100) / 100;

    // ── Attachments: count photos for this lead ──
    let photoCount = 0;
    const aEntityTypeIdx = attachData.headers.indexOf("entity_type");
    const aEntityIdIdx   = attachData.headers.indexOf("entity_id");
    const aFileUrlIdx    = attachData.headers.indexOf("file_url");
    if (aEntityIdIdx >= 0) {
      for (const row of attachData.rows) {
        if (String(row[aEntityIdIdx] || "").trim() !== leadId) continue;
        const url2 = String(row[aFileUrlIdx] || "").toLowerCase();
        if (/\.(png|jpg|jpeg|webp|gif)(\?|$)/.test(url2)) photoCount++;
      }
    }

    // ── Lead record: find by id ──
    const cIdx = {};
    (clientsData.headers || []).forEach((h, i) => { cIdx[h] = i; });
    let lead = null;
    for (const row of clientsData.rows || []) {
      const lid = String(row[cIdx["lead_id"]] ?? row[cIdx["id"]] ?? "").trim();
      if (lid === leadId) {
        lead = row;
        break;
      }
    }

    const collectedRevenue = lead
      ? Math.max(num(lead[cIdx["paid_amount"]] || 0), num(lead[cIdx["invoiced_amount"]] || 0))
      : 0;

    const leadStatus = lead ? String(lead[cIdx["status_code"]] || lead[cIdx["status"]] || "").toLowerCase() : "";
    const isComplete = ["complete", "closed", "paid"].includes(leadStatus);
    const unauthorizedDeviation = lead
      ? (String(lead[cIdx["unauthorized_deviation"]] || "").toLowerCase() === "true")
      : false;

    // Completion date: prefer paid_date → scheduled_date
    const completionDateStr = lead
      ? (String(lead[cIdx["paid_date"]] || "") || String(lead[cIdx["scheduled_date"]] || ""))
      : "";
    const completionDate = parseDate(completionDateStr);
    const now = new Date();
    const daysSinceCompletion = completionDate ? daysBetween(completionDate, now) : null;

    // ── Gross margin ──
    const grossMarginPct = collectedRevenue > 0
      ? Math.round(((collectedRevenue - directJobCost) / collectedRevenue) * 10000) / 100
      : null;

    // ── 4 bonus tests ──
    const marginOk = grossMarginPct !== null && grossMarginPct >= 40;
    const docOk    = timeEntries > 0 && photoCount >= 1;
    const budgetOk = !unauthorizedDeviation;

    // quality_ok = job done AND 14-day window has passed
    let qualityStatus = "pending";
    if (!isComplete) {
      qualityStatus = "not_complete";
    } else if (daysSinceCompletion !== null && daysSinceCompletion >= 14) {
      qualityStatus = "passed";
    } else {
      qualityStatus = "window_open";
    }
    const qualityOk = qualityStatus === "passed";

    const allPass    = marginOk && docOk && qualityOk && budgetOk;
    const tier       = allPass ? bonusTier(collectedRevenue) : null;
    const bonusAmt   = tier ? tier.amount : 0;

    // ── Compute overall status ──
    let status;
    if (!isComplete)               status = "not_complete";
    else if (!marginOk)            status = "margin_fail";
    else if (!docOk)               status = "doc_fail";
    else if (!budgetOk)            status = "budget_fail";
    else if (!qualityOk)           status = "pending_quality";
    else                           status = "earned";

    const daysRemainingInWindow = (isComplete && qualityStatus === "window_open" && daysSinceCompletion !== null)
      ? Math.max(0, Math.ceil(14 - daysSinceCompletion))
      : null;

    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({
      ok: true,
      lead_id:               leadId,
      loaded_rate:           loadedRate,
      total_minutes:         totalMinutes,
      time_entries:          timeEntries,
      labor_cost:            laborCost,
      direct_materials:      directMaterials,
      direct_permits:        directPermits,
      direct_sub:            directSub,
      direct_job_cost:       directJobCost,
      collected_revenue:     collectedRevenue,
      gross_margin_pct:      grossMarginPct,
      photo_count:           photoCount,
      completion_date:       completionDateStr || null,
      days_since_completion: daysSinceCompletion !== null ? Math.floor(daysSinceCompletion) : null,
      days_remaining_in_quality_window: daysRemainingInWindow,
      is_complete:           isComplete,
      tests: {
        margin_ok:  marginOk,
        doc_ok:     docOk,
        quality_ok: qualityOk,
        budget_ok:  budgetOk,
      },
      all_pass:    allPass,
      bonus_amount: bonusAmt,
      bonus_tier:   tier,
      status,
    }));
  } catch (err) {
    res.writeHead(500, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ ok: false, error: err.message }));
  }
}

module.exports = { handleBonusEligibility };

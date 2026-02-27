const { getSheetsClient } = require("../lib/sheets");
const { getConfig } = require("../lib/config");

const SPREADSHEET_ID = () => process.env.CRM_SHEET_ID;
const ROLLUP_TAB = "Actuals_Rollup_30D";
const COMPLETE_STATUSES = new Set(["complete", "paid", "closed"]);

function toNum(v) {
  const n = parseFloat(String(v || "").replace(/[^0-9.-]/g, ""));
  return Number.isFinite(n) ? n : 0;
}

function toRows(sheetValues, headers) {
  const rows = sheetValues || [];
  return rows.map(row =>
    Object.fromEntries(headers.map((h, i) => [h, String(row[i] || "").trim()]))
  );
}

async function readTab(sheets, tab) {
  try {
    const resp = await sheets.spreadsheets.values.get({
      spreadsheetId: SPREADSHEET_ID(),
      range: `${tab}!A1:Z2000`,
    });
    const all = resp.data.values || [];
    if (!all.length) return [];
    const [headers, ...data] = all;
    return toRows(data, headers);
  } catch {
    return [];
  }
}

function pickDate(row) {
  return row.paid_date || row.invoice_date || row.scheduled_date || "";
}

function isWithinDays(dateStr, days) {
  if (!dateStr) return false;
  const d = new Date(dateStr);
  if (isNaN(d.getTime())) return false;
  const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
  return d >= cutoff;
}

function bucketFor(revenue) {
  if (revenue < 300) return "small";
  if (revenue < 1000) return "medium";
  return "large";
}

async function ensureRollupTab(sheets) {
  try {
    const meta = await sheets.spreadsheets.get({ spreadsheetId: SPREADSHEET_ID() });
    const names = (meta.data.sheets || []).map(s => s.properties.title);
    if (!names.includes(ROLLUP_TAB)) {
      await sheets.spreadsheets.batchUpdate({
        spreadsheetId: SPREADSHEET_ID(),
        requestBody: { requests: [{ addSheet: { properties: { title: ROLLUP_TAB } } }] },
      });
      await sheets.spreadsheets.values.update({
        spreadsheetId: SPREADSHEET_ID(),
        range: `${ROLLUP_TAB}!A1`,
        valueInputOption: "RAW",
        requestBody: { majorDimension: "ROWS", values: [["Key", "Value"]] },
      });
    }
  } catch { /* non-fatal */ }
}

async function writeRollup(sheets, rollup) {
  try {
    const rows = [["Key", "Value"], ...Object.entries(rollup).map(([k, v]) => [k, v])];
    await sheets.spreadsheets.values.update({
      spreadsheetId: SPREADSHEET_ID(),
      range: `${ROLLUP_TAB}!A1`,
      valueInputOption: "RAW",
      requestBody: { majorDimension: "ROWS", values: rows },
    });
  } catch { /* non-fatal */ }
}

async function readTimeSources(sheets) {
  // Prefer TimeEntries tab (has hours column); fall back to Time tab (has minutes)
  const timeEntries = await readTab(sheets, "TimeEntries");
  const timeFallback = await readTab(sheets, "Time");

  // Normalize both into { lead_id, minutes } objects
  const normalize = (row) => {
    const lid = row.lead_id;
    if (!lid) return null;
    let minutes = 0;
    if (row.hours !== undefined && row.hours !== "") {
      minutes = toNum(row.hours) * 60;
    } else if (row.minutes !== undefined && row.minutes !== "") {
      minutes = toNum(row.minutes);
    } else if (row.start_time && row.end_time) {
      // Fallback: compute from timestamps
      const s = new Date(row.start_time), e = new Date(row.end_time);
      if (!isNaN(s) && !isNaN(e) && e > s) minutes = (e - s) / 60000;
    }
    return { lead_id: lid, minutes, category: row.category || "" };
  };

  // Merge: use TimeEntries if it has any data, otherwise use Time
  const source = timeEntries.length > 0 ? timeEntries : timeFallback;
  return source.map(normalize).filter(Boolean);
}

async function computeRollup(windowDays) {
  const sheets = await getSheetsClient();
  await ensureRollupTab(sheets);

  const [leads, timeEntries, expenses, cfg] = await Promise.all([
    readTab(sheets, "Leads"),
    readTimeSources(sheets),
    readTab(sheets, "Expenses"),
    getConfig(),
  ]);

  const journeymanBurden = toNum(cfg.labor_rate_tech || cfg.journeymanLaborBurden || "50");
  const apprenticeBurden = toNum(cfg.labor_rate_apprentice || cfg.apprenticeLaborBurden || "30");
  const materialsMarkupPct = toNum(cfg.materials_markup_pct || "0");

  // Completed jobs within window
  const completedLeads = leads.filter(row => {
    const status = (row.status || "").toLowerCase().trim();
    if (!COMPLETE_STATUSES.has(status)) return false;
    return isWithinDays(pickDate(row), windowDays);
  });

  // Index time entries by lead_id
  const timeByLead = {};
  for (const t of timeEntries) {
    const lid = t.lead_id;
    if (!lid) continue;
    if (!timeByLead[lid]) timeByLead[lid] = 0;
    timeByLead[lid] += toNum(t.minutes);
  }

  // Index material expenses by lead_id (check both type and category columns)
  const materialsByLead = {};
  for (const e of expenses) {
    const lid = e.lead_id;
    const type = (e.type || "").toLowerCase();
    const category = (e.category || "").toLowerCase();
    const isMaterial = type.includes("material") || category.includes("material");
    if (!lid || !isMaterial) continue;
    if (!materialsByLead[lid]) materialsByLead[lid] = 0;
    materialsByLead[lid] += toNum(e.amount);
  }

  // Bucket completed jobs
  const buckets = { small: [], medium: [], large: [] };
  for (const row of completedLeads) {
    const revenue = toNum(row.quoted_price) || toNum(row.estimated_value);
    const bucket = bucketFor(revenue);
    const leadId = row.id;
    const hours = (timeByLead[leadId] || 0) / 60;
    const matCost = materialsByLead[leadId]
      ? (materialsMarkupPct > 0
          ? materialsByLead[leadId] / (1 + materialsMarkupPct / 100)
          : materialsByLead[leadId])
      : 0;
    buckets[bucket].push({ hours, matCost });
  }

  const avg = (arr, fn) => arr.length ? arr.reduce((s, x) => s + fn(x), 0) / arr.length : 0;
  const total = completedLeads.length;

  const smallCount = buckets.small.length;
  const mediumCount = buckets.medium.length;
  const largeCount = buckets.large.length;

  const pct = (n) => total > 0 ? Math.round((n / total) * 100) : 0;

  // Utilization: total on-site hours across period / potential hours
  const totalHours = Object.values(timeByLead).reduce((s, m) => s + m / 60, 0);
  const daysInWindow = windowDays;
  // Try to infer crew size from Config; fall back to 1
  const numJourneymen = toNum(cfg.numJourneymen || "1");
  const numApprentices = toNum(cfg.numApprentices || "1");
  const crewCount = toNum(cfg.crewCount || "1");
  const workersForUtil = Math.max(1, numJourneymen + numApprentices);
  const potentialHours = workersForUtil * 8 * 5 * (daysInWindow / 7);
  const utilPct = potentialHours > 0
    ? Math.min(100, Math.round((totalHours / potentialHours) * 100))
    : 87;

  const rollup = {
    // Labor / ops
    numJourneymen,
    numApprentices,
    crewCount,
    hoursPerWorkerPerDay: toNum(cfg.hoursPerWorkerPerDay || "8"),
    daysPerWeek: toNum(cfg.daysPerWeek || "5"),
    utilizationPct: utilPct,

    // Job mix
    smallJobMix: pct(smallCount),
    mediumJobMix: pct(mediumCount),
    largeJobMix: pct(largeCount),

    // Per-job averages
    smallJobHours: Math.round(avg(buckets.small, x => x.hours) * 10) / 10,
    mediumJobHours: Math.round(avg(buckets.medium, x => x.hours) * 10) / 10,
    largeJobHours: Math.round(avg(buckets.large, x => x.hours) * 10) / 10,
    smallJobMaterials: Math.round(avg(buckets.small, x => x.matCost) * 100) / 100,
    mediumJobMaterials: Math.round(avg(buckets.medium, x => x.matCost) * 100) / 100,
    largeJobMaterials: Math.round(avg(buckets.large, x => x.matCost) * 100) / 100,

    // Labor burden
    journeymanLaborBurden: journeymanBurden,
    apprenticeLaborBurden: apprenticeBurden,

    // Overhead (from Config, 0 if not set)
    vehicleInsurance: toNum(cfg.vehicleInsurance || cfg.overhead_vehicle_insurance || "0"),
    fuelCost: toNum(cfg.fuelCost || cfg.overhead_fuel || "0"),
    vehicleMaintenance: toNum(cfg.vehicleMaintenance || cfg.overhead_vehicle_maint || "0"),
    generalLiability: toNum(cfg.generalLiability || cfg.overhead_gen_liability || "0"),
    toolRepair: toNum(cfg.toolRepair || cfg.overhead_tool_repair || "0"),
    loanPayments: toNum(cfg.loanPayments || cfg.overhead_loan_payments || "0"),
    softwarePayments: toNum(cfg.softwarePayments || cfg.overhead_software || "0"),
    marketingCost: toNum(cfg.marketingCost || cfg.overhead_marketing || "0"),
    ownerSalary: toNum(cfg.ownerSalary || cfg.overhead_owner_salary || "0"),

    // Optional financial knobs
    taxRate: toNum(cfg.taxRate || cfg.tax_rate || "25"),
    targetProfitMargin: toNum(cfg.targetProfitMargin || cfg.target_profit_margin || "30"),
    bidAccuracy: toNum(cfg.bidAccuracy || cfg.bid_accuracy || "10"),
    annualGrowthRate: toNum(cfg.annualGrowthRate || cfg.annual_growth_rate || "10"),
  };

  // Write back to Actuals_Rollup_30D asynchronously (best-effort)
  writeRollup(sheets, rollup).catch(() => {});

  return rollup;
}

async function handleActualsRollup(req, res) {
  try {
    const url = new URL(req.url, "http://localhost");
    const windowDays = parseInt(url.searchParams.get("windowDays") || "30", 10) || 30;

    if (!SPREADSHEET_ID()) {
      res.writeHead(200, { "Content-Type": "application/json" });
      return res.end(JSON.stringify({}));
    }

    const rollup = await computeRollup(windowDays);
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify(rollup));
  } catch (err) {
    console.error("[actuals-rollup] error:", err.message);
    res.writeHead(500, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: err.message }));
  }
}

module.exports = { handleActualsRollup };

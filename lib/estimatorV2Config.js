// lib/estimatorV2Config.js
// Loads Instant Estimator v2 sheet, caches, and returns the same shape as
// getQuoteConfig() so the rest of the stack stays unchanged.
// Falls back to v1 automatically when ESTIMATOR_V2_SHEET_ID is not set.

const { getSheetsClient }     = require("./sheets");
const { getQuoteConfig }      = require("./sheetsConfig");
const { buildServiceAreasMap } = require("./serviceArea");

const SHEET_ID_V2  = () => process.env.ESTIMATOR_V2_SHEET_ID;
const SHEET_ID_CRM = () => process.env.CRM_SHEET_ID;

const DEFAULT_TTL_MS = 12 * 60 * 60 * 1000; // 12 hours default

let _cache    = null;
let _cacheAt  = 0;
let _cacheTtl = DEFAULT_TTL_MS;

// ── Helpers ───────────────────────────────────────────────────────────────────
function toNum(v)  { const n = parseFloat(v); return Number.isFinite(n) ? n : 0; }
function toBool(v) { return String(v || "").toLowerCase().trim() === "true" || v === "1"; }

async function readTab(sheets, spreadsheetId, tab) {
  try {
    const resp = await sheets.spreadsheets.values.get({
      spreadsheetId,
      range: `${tab}!A1:Z3000`,
    });
    const values = resp.data.values || [];
    if (values.length < 2) return [];
    const [headers, ...rows] = values;
    return rows.map(row =>
      Object.fromEntries(headers.map((h, i) => [String(h).trim(), String(row[i] ?? "").trim()]))
    );
  } catch {
    return [];
  }
}

// Parse a key | value tab into a plain object
function parseKeyValue(rows) {
  const out = {};
  for (const r of rows) {
    const key = String(r.key || r.Key || "").trim();
    const val = String(r.value || r.Value || r.val || "").trim();
    if (key) out[key] = val;
  }
  return out;
}

function parseCrewMix(str) {
  let jw = 1, ap = 0;
  if (str) {
    const jwM = str.match(/(\d+)JW/i);
    const apM = str.match(/(\d+)AP/i);
    if (jwM) jw = Number(jwM[1]);
    if (apM) ap = Number(apM[1]);
  }
  return { jw, ap };
}

// ── Main loader ───────────────────────────────────────────────────────────────
async function loadV2Config() {
  const v2Id  = SHEET_ID_V2();
  const crmId = SHEET_ID_CRM();
  const sheets = await getSheetsClient();

  const [
    assemblyRows,
    assemblyItemRows,
    taskRows,
    materialRows,
    driverRows,
    multiplierRows,
    rateRows,
    configRows,
    areaRows,
  ] = await Promise.all([
    readTab(sheets, v2Id,  "Assemblies"),
    readTab(sheets, v2Id,  "AssemblyItems"),
    readTab(sheets, v2Id,  "Tasks_Labor"),
    readTab(sheets, v2Id,  "Materials"),
    readTab(sheets, v2Id,  "Scenario_Drivers"),
    readTab(sheets, v2Id,  "Driver_Multipliers"),
    readTab(sheets, v2Id,  "Rates_Rules"),
    readTab(sheets, v2Id,  "Config"),
    readTab(sheets, crmId, "ServiceAreas"),
  ]);

  // ── Parse Config and Rates key-value tabs ──────────────────────────────────
  const v2Config = parseKeyValue(configRows);
  const v2Rates  = parseKeyValue(rateRows);

  // Update cache TTL from Config.refreshIntervalHrs
  const refreshHrs = Number(v2Config.refreshIntervalHrs) || 12;
  _cacheTtl = refreshHrs * 60 * 60 * 1000;

  // ── Build lookup maps ──────────────────────────────────────────────────────
  const materialsMap = {};
  for (const m of materialRows) {
    if (m.material_id) {
      materialsMap[m.material_id] = {
        base_cost: toNum(m.base_cost),
        taxable:   toBool(m.taxable),
      };
    }
  }

  const tasksMap = {};
  for (const t of taskRows) {
    if (t.task_id) {
      tasksMap[t.task_id] = { hours_per_unit: toNum(t.hours_per_unit) };
    }
  }

  const assemblyItemsByAssembly = {};
  for (const item of assemblyItemRows) {
    if (!item.assembly_id) continue;
    if (!assemblyItemsByAssembly[item.assembly_id]) assemblyItemsByAssembly[item.assembly_id] = [];
    assemblyItemsByAssembly[item.assembly_id].push(item);
  }

  // ── Derived scalar config ──────────────────────────────────────────────────
  const minPrice = toNum(v2Rates.minimumServiceFee);
  const minTotal = toNum(v2Config.minQuoteTotal);

  // Compute crew loaded hourly for jobType base_hours reference
  const crewMix         = v2Config.defaultLaborMix || "1JW";
  const crew            = parseCrewMix(crewMix);
  const crewLoadedHrly  =
    crew.jw * toNum(v2Rates.journeymanLaborBurden) +
    crew.ap * toNum(v2Rates.apprenticeLaborBurden);

  // ── jobTypes from Assemblies ───────────────────────────────────────────────
  // Normalize serviceType: sheet stores lowercase ("residential") → capitalize
  function capitalizeFirst(s) {
    if (!s) return "";
    return s.charAt(0).toUpperCase() + s.slice(1).toLowerCase();
  }

  const jobTypes = assemblyRows
    .filter(a => a.assembly_id && toBool(a.active !== "" ? a.active : "true"))
    .map(a => {
      const baseHours  = toNum(a.blended_labor_hours) || toNum(a.baseline_labor_hours) || 0;
      // Total scheduled block = job hours + round-trip drive + 15 min admin wrap-up
      const driveHours = toNum(a.drive_time_hours) || 0.25;
      const totalHours = baseHours + (driveHours * 2) + 0.25;
      const durMin     = Math.max(60, Math.ceil((totalHours * 60) / 30) * 30);
      return {
        job_type_id:              a.assembly_id,
        name_public:              a.niche_name || a.assembly_id,
        segment:                  capitalizeFirst(a.serviceType) || "Residential",
        category:                 a.category || "",
        base_hours:               baseHours,
        min_price:                minPrice,
        default_duration_minutes: durMin,
        requires_photo:           false,
        instant_book_allowed:     String(a.quote_class || "").toUpperCase() === "INSTANT",
        material_allowance:       0,
        _v2assemblyId:            a.assembly_id,
      };
    });

  // ── Scenario_Drivers → questionsByType (same for all assemblies) ───────────
  // Sheet uses "question" column (not "prompt"); no sort_order column
  const allDrivers = driverRows
    .filter(d => d.driver_id)
    .map((d, i) => ({
      question_id: d.driver_id,
      prompt:      d.question || d.prompt || d.driver_id,
      input_type:  d.input_type === "bucket" ? "radio" : (d.input_type || "radio"),
      required:    toBool(d.required),
      sort_order:  toNum(d.sort_order) || i,
    }))
    .sort((a, b) => a.sort_order - b.sort_order);

  const questionsByType = {};
  for (const jt of jobTypes) {
    questionsByType[jt.job_type_id] = allDrivers;
  }

  // ── Driver_Multipliers → optionsByQuestion ─────────────────────────────────
  // Sheet uses: driver_id, option (label), labor_mult, material_mult
  const optionsByQuestion = {};
  for (let i = 0; i < multiplierRows.length; i++) {
    const m = multiplierRows[i];
    if (!m.driver_id) continue;
    if (!optionsByQuestion[m.driver_id]) optionsByQuestion[m.driver_id] = [];
    const label     = m.option || m.label || "";
    const optionId  = m.multiplier_id || m.option_id ||
      (m.driver_id + "_" + label.replace(/\s+/g, "_").toLowerCase());
    optionsByQuestion[m.driver_id].push({
      option_id:    optionId,
      label,
      effect_type:  "MULTIPLY_HOURS",
      effect_value: toNum(m.labor_mult || m.labor_multiplier || "1"),
    });
  }

  // ── ServiceAreas — hardcoded baseline merged with any sheet overrides ─────
  // buildServiceAreasMap seeds from serviceArea.js (source of truth) and then
  // applies any per-ZIP overrides found in the CRM sheet's ServiceAreas tab.
  const serviceAreas = buildServiceAreasMap(areaRows);

  // ── Rates shape (compatible with quoteEngineV2 needs) ─────────────────────
  const rates = {
    crew_loaded_hourly:     crewLoadedHrly,
    overhead_per_hour:      0,
    target_margin:          0.30,
    service_minimum:        minPrice,
    commute_assumed_minutes: 15,
    default_disclaimer_fee: 25,
    pricing_version:        "v2",
  };

  return {
    // Public shape — identical to what getQuoteConfig() returns
    jobTypes,
    questionsByType,
    optionsByQuestion,
    addonsByType: {},
    rates,
    serviceAreas,
    // V2 internals — used only by quoteEngineV2
    _v2: {
      assemblies:               assemblyRows,
      assemblyItemsByAssembly,
      materialsMap,
      tasksMap,
      v2Config,
      v2Rates,
      minPrice,
      minTotal,
    },
  };
}

// ── Public API ────────────────────────────────────────────────────────────────

/** Returns true when ESTIMATOR_V2_SHEET_ID is configured. */
function isV2Mode() {
  return Boolean(process.env.ESTIMATOR_V2_SHEET_ID);
}

/**
 * Returns the active quote config — V2 when ESTIMATOR_V2_SHEET_ID is set
 * AND the Assemblies tab has data.  Falls back to V1 automatically when
 * the sheet is missing, empty, or mis-configured.
 */
async function getActiveConfig() {
  if (!isV2Mode()) return getQuoteConfig();

  if (_cache && Date.now() - _cacheAt < _cacheTtl) return _cache;

  try {
    const cfg = await loadV2Config();
    if (!cfg.jobTypes || cfg.jobTypes.length === 0) {
      console.warn("[EstimatorV2] Assemblies tab is empty — falling back to V1 engine.");
      return getQuoteConfig();
    }
    _cache   = cfg;
    _cacheAt = Date.now();
    return _cache;
  } catch (err) {
    console.error("[EstimatorV2] Failed to load V2 config, falling back to V1:", err.message);
    return getQuoteConfig();
  }
}

function invalidateV2Cache() {
  _cache   = null;
  _cacheAt = 0;
}

module.exports = { getActiveConfig, isV2Mode, invalidateV2Cache };

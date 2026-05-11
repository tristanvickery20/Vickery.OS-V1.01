// lib/estimatorV2Config.js
// Loads Instant Estimator v2 sheet, caches, and returns the same shape as
// getQuoteConfig() so the rest of the stack stays unchanged.
// Falls back to v1 automatically when ESTIMATOR_V2_SHEET_ID is not set.

const { getSheetsClient }                     = require("./sheets");
const { getQuoteConfig }                      = require("./sheetsConfig");
const { buildServiceAreasMap }                = require("./serviceArea");
const { resolveServiceId, getClassification } = require("./serviceClassification");

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

  // ── Enrich jobTypes with photoGate metadata from service classification ───────
  for (const jt of jobTypes) {
    const sid = resolveServiceId(jt.job_type_id);
    const cls = getClassification(sid);
    if (cls && cls.photoGate) {
      // Support both photoGateModules (array) and legacy photoGateModule (single string)
      const modules = cls.photoGateModules
        || (cls.photoGateModule ? [cls.photoGateModule] : []);
      jt.photo_gate_modules = modules;
      jt.photo_gate_prompt  = cls.photoGatePrompt  || null;
      jt.photo_gate_prompts = cls.photoGatePrompts || null;
    }
  }

  // ── Scenario_Drivers → questionsByType (filtered by service category) ────────
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

  // ── Category → allowed driver IDs ────────────────────────────────────────────
  // Only driver IDs that are genuinely relevant to each work category are shown.
  // Using a Set for both exact matches and common naming variants (CEILING_HT /
  // CEILING_HEIGHT) since the sheet's column values may vary across deployments.
  const CATEGORY_DRIVERS = {
    // Lighting installs — ceiling height and attic access affect staging & routing
    LIGHTING: new Set(["CEILING_HT", "CEILING_HEIGHT", "ATTIC_ACCESS", "HOME_AGE",
                        "EXISTING_BOX", "CIRCUIT_SCOPE"]),
    // Ceiling fan installs — same environment factors + existing wiring state
    FAN:      new Set(["CEILING_HT", "CEILING_HEIGHT", "ATTIC_ACCESS", "HOME_AGE",
                        "EXISTING_BOX", "FAN_EXISTING_WIRING"]),
    // Outlets / switches — wall type, circuit scope, panel distance
    OUTLET:   new Set(["CIRCUIT_SCOPE", "DEDICATED_CIRCUIT_DISTANCE",
                        "DISTANCE_FROM_PANEL", "WALL_TYPE", "HOME_AGE"]),
    SWITCH:   new Set(["CIRCUIT_SCOPE", "WALL_TYPE", "HOME_AGE"]),
    // EV charger — panel capacity & conduit run distance are the key variables
    EV:       new Set(["DEDICATED_CIRCUIT_DISTANCE", "DISTANCE_FROM_PANEL", "HOME_AGE"]),
    // Panel / breaker work — home age helps assess wiring era & compatibility
    PANEL:    new Set(["HOME_AGE"]),
    // Circuits (dedicated / appliance / hot-tub) — run distance matters
    CIRCUIT:  new Set(["DEDICATED_CIRCUIT_DISTANCE", "DISTANCE_FROM_PANEL", "HOME_AGE"]),
    // All remaining categories show no online questions — site visit required
    WIRING:      new Set(),
    GENERATOR:   new Set(),
    DIAGNOSTICS: new Set(),
    COMMERCIAL:  new Set(),
    OTHER:       new Set(),
  };

  // ── Service ID → category ────────────────────────────────────────────────────
  // Covers every assembly in ASSEMBLY_TO_SERVICE plus known extra service IDs.
  // Services not listed here fall through to an empty question set (safe default).
  const SERVICE_TO_CATEGORY = {
    // ── Lighting ──────────────────────────────────────────────────────────────
    RECESSED_LIGHTING:          "LIGHTING",
    LIGHT_FIXTURE_INSTALL:      "LIGHTING",
    LED_RETROFIT:               "LIGHTING",
    OUTDOOR_LIGHTING:           "LIGHTING",  // MANUAL_QUOTE_ONLY — no online q's matter, but category needed for blocklist
    MOTION_SECURITY_LIGHT:      "LIGHTING",  // MANUAL_QUOTE_ONLY — same
    // ── Fans ──────────────────────────────────────────────────────────────────
    CEILING_FAN_INSTALL:        "FAN",
    // ── Outlets ───────────────────────────────────────────────────────────────
    OUTLET_INSTALL:             "OUTLET",
    GFCI_OUTLET:                "OUTLET",
    // ── Switches / Dimmers ────────────────────────────────────────────────────
    DIMMER_SWITCH:              "SWITCH",
    SMART_SWITCH:               "SWITCH",
    // ── Circuits ──────────────────────────────────────────────────────────────
    DEDICATED_CIRCUIT:          "CIRCUIT",
    HOT_TUB_CIRCUIT:            "CIRCUIT",
    APPLIANCE_CIRCUIT:          "CIRCUIT",
    // ── EV Charger ────────────────────────────────────────────────────────────
    EV_CHARGER:                 "EV",
    // ── Panel / Breaker ───────────────────────────────────────────────────────
    PANEL_UPGRADE:              "PANEL",
    SUBPANEL_INSTALL:           "PANEL",
    FUSE_BOX_CONVERSION:        "PANEL",
    PANEL_BREAKER_REPAIR:       "PANEL",
    SURGE_PROTECTOR:            "PANEL",
    // ── Diagnostics — no online questions; site visit required by design ──────
    BREAKER_TRIPPING:           "DIAGNOSTICS",
    TROUBLESHOOT_FLICKER:       "DIAGNOSTICS",
    SMOKE_CO_DETECTOR:          "DIAGNOSTICS",
    CODE_COMPLIANCE:            "DIAGNOSTICS",
    GFCI_DIAGNOSTIC:            "DIAGNOSTICS",
    CIRCUIT_DIAGNOSTIC:         "DIAGNOSTICS",
    // ── Wiring ────────────────────────────────────────────────────────────────
    REWIRE_WHOLE_HOUSE:         "WIRING",
    REWIRE_PARTIAL:             "WIRING",
    REWIRE_COMMERCIAL:          "COMMERCIAL",
    // ── Generators ────────────────────────────────────────────────────────────
    GENERATOR_STANDBY:          "GENERATOR",
    GENERATOR_TRANSFER_SWITCH:  "GENERATOR",
    GENERATOR_BACKUP:           "GENERATOR",
    // ── Commercial ────────────────────────────────────────────────────────────
    COMM_LIGHTING_RETROFIT:     "COMMERCIAL",
    BALLAST_REPLACE:            "COMMERCIAL",
    EXIT_EMERGENCY_LIGHTS:      "COMMERCIAL",
    TRANSFORMER_INSTALL:        "COMMERCIAL",
    FIRE_ALARM:                 "COMMERCIAL",
    // ── Other ─────────────────────────────────────────────────────────────────
    HOME_AUTOMATION:            "OTHER",
  };

  const questionsByType = {};
  const _unmappedAssemblies = [];
  for (const jt of jobTypes) {
    // Resolve service ID (handles assembly IDs like "A001" → "RECESSED_LIGHTING")
    const serviceId = resolveServiceId(jt.job_type_id);
    const category  = SERVICE_TO_CATEGORY[serviceId];
    if (!category) {
      // Unknown assembly — default to empty to avoid irrelevant questions.
      // Collect for a one-shot warning after the loop.
      questionsByType[jt.job_type_id] = [];
      _unmappedAssemblies.push(`${jt.job_type_id}/${jt.name_public}`);
      continue;
    }
    const allowed = CATEGORY_DRIVERS[category] || new Set();
    questionsByType[jt.job_type_id] = allowed.size === 0
      ? []
      : allDrivers.filter(d => allowed.has(d.question_id));
  }
  if (_unmappedAssemblies.length > 0) {
    console.warn(
      `[EstimatorV2] ${_unmappedAssemblies.length} active assemblies not in SERVICE_TO_CATEGORY ` +
      `(defaulting to empty questions): ${_unmappedAssemblies.join(", ")}`
    );
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
 * Mutates config.jobTypes in place to add photo_gate_modules / photo_gate_prompt /
 * photo_gate_prompts from serviceClassification. Called on V1 configs since V2
 * gets this enrichment during loadV2Config(). Safe to call multiple times.
 */
function applyPhotoGateMetadata(config) {
  for (const jt of (config.jobTypes || [])) {
    if (jt.photo_gate_modules) continue;  // already enriched (V2 path)
    const sid = resolveServiceId(jt.job_type_id);
    const cls = getClassification(sid);
    if (cls && cls.photoGate) {
      const modules = cls.photoGateModules || (cls.photoGateModule ? [cls.photoGateModule] : []);
      jt.photo_gate_modules = modules;
      jt.photo_gate_prompt  = cls.photoGatePrompt  || null;
      jt.photo_gate_prompts = cls.photoGatePrompts || null;
    }
  }
  return config;
}

/**
 * Returns the active quote config — V2 when ESTIMATOR_V2_SHEET_ID is set
 * AND the Assemblies tab has data.  Falls back to V1 automatically when
 * the sheet is missing, empty, or mis-configured.
 */
async function getActiveConfig() {
  if (!isV2Mode()) return applyPhotoGateMetadata(await getQuoteConfig());

  if (_cache && Date.now() - _cacheAt < _cacheTtl) return _cache;

  try {
    const cfg = await loadV2Config();
    if (!cfg.jobTypes || cfg.jobTypes.length === 0) {
      console.warn("[EstimatorV2] Assemblies tab is empty — falling back to V1 engine.");
      return applyPhotoGateMetadata(await getQuoteConfig());
    }
    _cache   = cfg;
    _cacheAt = Date.now();
    return _cache;
  } catch (err) {
    console.error("[EstimatorV2] Failed to load V2 config, falling back to V1:", err.message);
    return applyPhotoGateMetadata(await getQuoteConfig());
  }
}

function invalidateV2Cache() {
  _cache   = null;
  _cacheAt = 0;
}

module.exports = { getActiveConfig, isV2Mode, invalidateV2Cache };

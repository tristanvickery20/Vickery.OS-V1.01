// lib/sheetsConfig.js
// Reads quote-engine tabs from the spreadsheet. Caches for CACHE_TTL_MS.
// Returns structured config used by /api/quote/config and the future quote UI.

const { getSheetsClient } = require("./sheets");

const SPREADSHEET_ID = () => process.env.CRM_SHEET_ID;
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

let _cache = null;
let _cacheAt = 0;

// ── V1 baseline seed ─────────────────────────────────────────────────────────
// Embedded fallback so cold-start quota failures still return a usable config.
// Used ONLY when sheets return empty AND no stale cache is available.
const V1_BASELINE = {
  jobTypes: [
    { job_type_id: "REPLACE_DEVICE",    name_public: "Replace outlet or switch",       segment: "Residential", category: "Outlets & Switches", base_hours: 0.75, min_price: 205, default_duration_minutes: 60,  requires_photo: false, instant_book_allowed: true, material_allowance: 10  },
    { job_type_id: "ADD_OUTLET",        name_public: "Install a new standard outlet",  segment: "Residential", category: "Outlets & Switches", base_hours: 1.5,  min_price: 310, default_duration_minutes: 120, requires_photo: false, instant_book_allowed: true, material_allowance: 25  },
    { job_type_id: "REPLACE_FIXTURE",   name_public: "Replace a light fixture",        segment: "Residential", category: "Lighting & Fans",    base_hours: 1,    min_price: 245, default_duration_minutes: 90,  requires_photo: false, instant_book_allowed: true, material_allowance: 15  },
    { job_type_id: "INSTALL_FAN",       name_public: "Install a ceiling fan",          segment: "Residential", category: "Lighting & Fans",    base_hours: 1.5,  min_price: 330, default_duration_minutes: 120, requires_photo: false, instant_book_allowed: true, material_allowance: 20  },
    { job_type_id: "REPLACE_BATH_FAN",  name_public: "Replace bathroom exhaust fan",   segment: "Residential", category: "Ventilation",        base_hours: 2,    min_price: 450, default_duration_minutes: 180, requires_photo: false, instant_book_allowed: true, material_allowance: 25  },
    { job_type_id: "SURGE_PROTECTOR",   name_public: "Install whole-home surge protector", segment: "Residential", category: "Panel & Protection", base_hours: 1, min_price: 350, default_duration_minutes: 90, requires_photo: true, instant_book_allowed: true, material_allowance: 120 },
    { job_type_id: "TROUBLESHOOT",      name_public: "Electrical troubleshooting",     segment: "Residential", category: "Diagnostics",        base_hours: 2,    min_price: 410, default_duration_minutes: 120, requires_photo: false, instant_book_allowed: true, material_allowance: 10  },
    { job_type_id: "INSTALL_GFCI_BREAKER", name_public: "Install GFCI/AFCI breaker",  segment: "Residential", category: "Panel & Protection", base_hours: 1,    min_price: 275, default_duration_minutes: 90,  requires_photo: true,  instant_book_allowed: true, material_allowance: 0   },
    { job_type_id: "EV_CHARGER_STD",    name_public: "Install EV charger",            segment: "Residential", category: "EV Charging",        base_hours: 3.5,  min_price: 850, default_duration_minutes: 240, requires_photo: true,  instant_book_allowed: true, material_allowance: 75  },
    { job_type_id: "PANEL_LABEL",       name_public: "Panel labeling",                segment: "Residential", category: "Panel & Protection", base_hours: 1.5,  min_price: 325, default_duration_minutes: 120, requires_photo: true,  instant_book_allowed: true, material_allowance: 10  },
  ],
  questionsByType:  {},
  optionsByQuestion: {},
  addonsByType:     {},
  rates: { crew_loaded_hourly: 0, overhead_per_hour: 0, target_margin: 0, service_minimum: 150, commute_assumed_minutes: 0, default_disclaimer_fee: 0, pricing_version: "1" },
  serviceAreas:     {},
  _fromSeed:        true,
};

function toRows(values) {
  if (!values || values.length < 1) return [];
  const [headers, ...data] = values;
  return data.map(row =>
    Object.fromEntries(headers.map((h, i) => [String(h).trim(), String(row[i] ?? "").trim()]))
  );
}

function toNum(v) {
  const n = parseFloat(v);
  return Number.isFinite(n) ? n : 0;
}

function toBool(v) {
  return String(v).toLowerCase().trim() === "true" || v === "1" || v === 1;
}

async function readTab(sheets, tab) {
  try {
    const resp = await sheets.spreadsheets.values.get({
      spreadsheetId: SPREADSHEET_ID(),
      range: `${tab}!A1:Z2000`,
    });
    return toRows(resp.data.values);
  } catch (err) {
    console.warn(`[sheetsConfig] Tab "${tab}" read failed (quota or network): ${err.message}`);
    return [];
  }
}

async function loadConfig() {
  const sheets = await getSheetsClient();

  // Read sequentially to avoid quota spikes on startup
  const jobTypeRows  = await readTab(sheets, "JobTypes");
  const questionRows = await readTab(sheets, "Questions");
  const optionRows   = await readTab(sheets, "AnswerOptions");
  const addonRows    = await readTab(sheets, "AddOns");
  const rateRows     = await readTab(sheets, "Rates");
  const areaRows     = await readTab(sheets, "ServiceAreas");

  // JobTypes — filter active only
  const jobTypes = jobTypeRows
    .filter(r => r.job_type_id && toBool(r.active !== "" ? r.active : "true"))
    .map(r => ({
      job_type_id: r.job_type_id,
      name_public: r.name_public,
      segment: r.segment || "Residential",
      category: r.category || "",
      base_hours: toNum(r.base_hours),
      min_price: toNum(r.min_price),
      default_duration_minutes: toNum(r.default_duration_minutes),
      requires_photo: toBool(r.requires_photo),
      instant_book_allowed: toBool(r.instant_book_allowed),
      material_allowance: toNum(r.material_allowance),
    }));

  // Questions — grouped by job_type_id, sorted by sort_order
  const questionsByType = {};
  for (const r of questionRows) {
    if (!r.question_id || !r.job_type_id) continue;
    if (!questionsByType[r.job_type_id]) questionsByType[r.job_type_id] = [];
    questionsByType[r.job_type_id].push({
      question_id: r.question_id,
      prompt: r.prompt,
      input_type: r.input_type,
      required: toBool(r.required),
      sort_order: toNum(r.sort_order),
    });
  }
  for (const k of Object.keys(questionsByType)) {
    questionsByType[k].sort((a, b) => a.sort_order - b.sort_order);
  }

  // AnswerOptions — grouped by question_id
  const VALID_EFFECTS = new Set([
    "ADD_HOURS", "ADD_FEE", "MULTIPLY_HOURS", "REQUIRE_PHOTO", "FLAG_EVALUATION",
  ]);
  const optionsByQuestion = {};
  for (const r of optionRows) {
    if (!r.option_id || !r.question_id) continue;
    if (!optionsByQuestion[r.question_id]) optionsByQuestion[r.question_id] = [];
    optionsByQuestion[r.question_id].push({
      option_id: r.option_id,
      label: r.label,
      effect_type: VALID_EFFECTS.has(r.effect_type) ? r.effect_type : null,
      effect_value: toNum(r.effect_value),
    });
  }

  // AddOns — grouped by job_type_id, filter active
  const addonsByType = {};
  for (const r of addonRows) {
    if (!r.addon_id || !r.job_type_id) continue;
    if (!toBool(r.active !== "" ? r.active : "true")) continue;
    if (!addonsByType[r.job_type_id]) addonsByType[r.job_type_id] = [];
    addonsByType[r.job_type_id].push({
      addon_id: r.addon_id,
      name_public: r.name_public,
      add_hours: toNum(r.add_hours),
      add_fee: toNum(r.add_fee),
      material_allowance: toNum(r.material_allowance),
    });
  }

  // Rates — first data row (single-row config)
  const rr = rateRows[0] || {};
  const rates = {
    crew_loaded_hourly: toNum(rr.crew_loaded_hourly),
    overhead_per_hour: toNum(rr.overhead_per_hour),
    target_margin: toNum(rr.target_margin),
    service_minimum: toNum(rr.service_minimum),
    commute_assumed_minutes: toNum(rr.commute_assumed_minutes),
    default_disclaimer_fee: toNum(rr.default_disclaimer_fee),
    pricing_version: rr.pricing_version || "1",
  };

  // ServiceAreas — zip -> { zone, travel_fee }
  const serviceAreas = {};
  for (const r of areaRows) {
    if (!r.zip) continue;
    serviceAreas[r.zip.trim()] = {
      zone: r.zone,
      travel_fee: toNum(r.travel_fee),
    };
  }

  return { jobTypes, questionsByType, optionsByQuestion, addonsByType, rates, serviceAreas };
}

async function getQuoteConfig() {
  if (_cache && Date.now() - _cacheAt < CACHE_TTL_MS) return _cache;

  const result = await loadConfig();

  if (result.jobTypes.length > 0) {
    // Good data — update cache
    _cache = result;
    _cacheAt = Date.now();
    return result;
  }

  // Empty result — quota spike or sheet read failure for all tabs.
  // Don't cache empty data; serve stale cache if available.
  if (_cache) {
    console.warn("[sheetsConfig] All tabs returned empty — serving stale cache.");
    return _cache;
  }

  // No cache at all — fall back to embedded V1 baseline so the wizard still renders.
  console.warn("[sheetsConfig] No cache and sheets returned empty — using V1_BASELINE seed (quota or connectivity issue).");
  return V1_BASELINE;
}

function invalidateCache() {
  _cache = null;
  _cacheAt = 0;
}

module.exports = { getQuoteConfig, invalidateCache };

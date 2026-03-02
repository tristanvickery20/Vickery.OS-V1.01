// lib/sheetsConfig.js
// Reads quote-engine tabs from the spreadsheet. Caches for CACHE_TTL_MS.
// Returns structured config used by /api/quote/config and the future quote UI.

const { getSheetsClient } = require("./sheets");

const SPREADSHEET_ID = () => process.env.CRM_SHEET_ID;
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

let _cache = null;
let _cacheAt = 0;

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
  } catch {
    return [];
  }
}

async function loadConfig() {
  const sheets = await getSheetsClient();

  const [jobTypeRows, questionRows, optionRows, addonRows, rateRows, areaRows] =
    await Promise.all([
      readTab(sheets, "JobTypes"),
      readTab(sheets, "Questions"),
      readTab(sheets, "AnswerOptions"),
      readTab(sheets, "AddOns"),
      readTab(sheets, "Rates"),
      readTab(sheets, "ServiceAreas"),
    ]);

  // JobTypes — filter active only
  const jobTypes = jobTypeRows
    .filter(r => r.job_type_id && toBool(r.active !== "" ? r.active : "true"))
    .map(r => ({
      job_type_id: r.job_type_id,
      name_public: r.name_public,
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
  _cache = await loadConfig();
  _cacheAt = Date.now();
  return _cache;
}

function invalidateCache() {
  _cache = null;
  _cacheAt = 0;
}

module.exports = { getQuoteConfig, invalidateCache };

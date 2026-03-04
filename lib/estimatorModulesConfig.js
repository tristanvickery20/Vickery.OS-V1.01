// lib/estimatorModulesConfig.js
// Loads Estimator_Modules + Estimator_ServiceMatrix from the Estimator sheet.
// Seeds both tabs on first request if empty.
// Caches for CACHE_TTL_MS.

const { getSheetsClient }  = require("./sheets");
const { ensureTabHeaders } = require("./sheetsSchema");
const { MODULES, SERVICES } = require("./estimatorSeedData");

function SPREADSHEET_ID() {
  const id = process.env.ESTIMATOR_V2_SHEET_ID;
  if (!id) throw new Error("Estimator sheet not configured. Set ESTIMATOR_V2_SHEET_ID.");
  return id;
}

const CACHE_TTL_MS = Number(process.env.ESTIMATOR_CONFIG_CACHE_MS) || 5 * 60 * 1000;

let _cache   = null;
let _cacheAt = 0;

function toRows(values) {
  if (!values || values.length < 1) return [];
  const [headers, ...data] = values;
  return data.map(row =>
    Object.fromEntries(headers.map((h, i) => [String(h).trim(), String(row[i] ?? "").trim()]))
  );
}

async function readTab(sheets, tab) {
  try {
    const r = await sheets.spreadsheets.values.get({
      spreadsheetId: SPREADSHEET_ID(),
      range: `${tab}!A1:Z2000`,
    });
    return toRows(r.data.values);
  } catch { return []; }
}

async function appendRows(sheets, tab, rows) {
  if (!rows.length) return;
  const id = SPREADSHEET_ID();
  const headerResp = await sheets.spreadsheets.values.get({
    spreadsheetId: id, range: `${tab}!1:1`,
  });
  const headers = (headerResp.data.values?.[0] || []).map(h => String(h).trim());
  if (!headers.length) {
    console.warn(`[estimatorModulesConfig] No headers found in ${tab}, skipping seed.`);
    return;
  }
  const values = rows.map(r => headers.map(h => String(r[h] ?? "")));
  await sheets.spreadsheets.values.append({
    spreadsheetId: id,
    range: `${tab}!A1`,
    valueInputOption: "RAW",
    insertDataOption: "INSERT_ROWS",
    requestBody: { majorDimension: "ROWS", values },
  });
  console.log(`[${tab}] Seeded ${rows.length} rows.`);
}

async function ensureAndSeed(sheets) {
  const sheetId = SPREADSHEET_ID();
  await ensureTabHeaders("Estimator_Modules",      sheetId);
  await ensureTabHeaders("Estimator_ServiceMatrix", sheetId);
  await ensureTabHeaders("Leads_QuoteSnapshots",    sheetId);

  const [existingModules, existingServices] = await Promise.all([
    readTab(sheets, "Estimator_Modules"),
    readTab(sheets, "Estimator_ServiceMatrix"),
  ]);

  const seedPromises = [];
  if (existingModules.filter(r => r.module_id).length === 0) {
    seedPromises.push(appendRows(sheets, "Estimator_Modules", MODULES));
  }
  if (existingServices.filter(r => r.service_id).length === 0) {
    const svcRows = SERVICES.map(s => ({
      ...s,
      qty_min: "",
      qty_max: "",
      disqualify_rules_json: "[]",
    }));
    seedPromises.push(appendRows(sheets, "Estimator_ServiceMatrix", svcRows));
  }
  await Promise.all(seedPromises);
}

async function loadConfig() {
  const sheets = await getSheetsClient();
  await ensureAndSeed(sheets);

  const [modRows, svcRows] = await Promise.all([
    readTab(sheets, "Estimator_Modules"),
    readTab(sheets, "Estimator_ServiceMatrix"),
  ]);

  const modulesById = {};
  for (const r of modRows) {
    if (!r.module_id) continue;
    let options = [];
    try { options = JSON.parse(r.options_json || "[]"); } catch { options = []; }
    modulesById[r.module_id] = {
      module_id:  r.module_id,
      question:   r.question,
      input_type: r.input_type,
      options,
      applies_to: r.applies_to,
    };
  }

  const services = svcRows
    .filter(r => r.service_id && String(r.enabled).toUpperCase() !== "FALSE")
    .map(r => ({
      service_id:       r.service_id,
      service_name:     r.service_name,
      segment:          r.segment,
      tier:             r.tier,
      modules_csv:      r.modules_csv,
      qty_min:          r.qty_min ? Number(r.qty_min) : null,
      qty_max:          r.qty_max ? Number(r.qty_max) : null,
      base_price_mode:  r.base_price_mode,
    }));

  return { modulesById, services, updatedAt: new Date().toISOString() };
}

async function getEstimatorConfig() {
  if (_cache && Date.now() - _cacheAt < CACHE_TTL_MS) return _cache;
  _cache   = await loadConfig();
  _cacheAt = Date.now();
  return _cache;
}

function invalidateEstimatorCache() {
  _cache   = null;
  _cacheAt = 0;
}

function getCacheAge() {
  return _cacheAt ? Date.now() - _cacheAt : null;
}

module.exports = { getEstimatorConfig, invalidateEstimatorCache, getCacheAge };

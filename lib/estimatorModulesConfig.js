// lib/estimatorModulesConfig.js
// Loads Estimator_Modules + Estimator_ServiceMatrix from the V2 Estimator sheet.
// ESTIMATOR_V2_SHEET_ID is required — falls back to embedded seed data only when
// the sheet tabs are empty (first boot), not when the env var is missing.

const { getSheetsClient }  = require("./sheets");
const { ensureTabHeaders } = require("./sheetsSchema");
const { MODULES, SERVICES } = require("./estimatorSeedData");

const CACHE_TTL_MS = Number(process.env.ESTIMATOR_CONFIG_CACHE_MS) || 5 * 60 * 1000;

let _cache   = null;
let _cacheAt = 0;

// ── Helpers ─────────────────────────────────────────────────────────────────

function toRows(values) {
  if (!values || values.length < 1) return [];
  const [headers, ...data] = values;
  return data.map(row =>
    Object.fromEntries(headers.map((h, i) => [String(h).trim(), String(row[i] ?? "").trim()]))
  );
}

// ── Seed-data fallback (empty sheet tabs on first boot) ───────────────────────
// Builds the same shape as loadConfigFromSheet() from local MODULES/SERVICES constants.
function loadConfigFromSeed() {
  const modulesById = {};
  for (const m of MODULES) {
    let options = [];
    try { options = typeof m.options_json === "string" ? JSON.parse(m.options_json) : (m.options_json || []); } catch { options = []; }
    modulesById[m.module_id] = {
      module_id:  m.module_id,
      question:   m.question,
      input_type: m.input_type,
      options,
      applies_to: m.applies_to || "all",
    };
  }

  const services = SERVICES
    .filter(s => String(s.enabled ?? "TRUE").toUpperCase() !== "FALSE")
    .map(s => {
      let conditional_rules = null;
      if (s.conditional_rules_json) {
        try { conditional_rules = JSON.parse(s.conditional_rules_json); } catch { conditional_rules = null; }
      }
      return {
        service_id:        s.service_id,
        service_name:      s.service_name,
        segment:           s.segment,
        tier:              s.tier,
        modules_csv:       s.modules_csv || "",
        qty_min:           s.qty_min ? Number(s.qty_min) : null,
        qty_max:           s.qty_max ? Number(s.qty_max) : null,
        base_price_mode:   s.base_price_mode,
        conditional_rules: conditional_rules,
      };
    });

  console.log(`[estimatorModulesConfig] Loaded from seed data: ${Object.keys(modulesById).length} modules, ${services.length} services`);
  return { modulesById, services, updatedAt: new Date().toISOString(), _fromSeed: true };
}

// ── Sheet-backed loader ────────────────────────────────────────────────────────

function SPREADSHEET_ID() {
  const id = process.env.ESTIMATOR_V2_SHEET_ID;
  if (!id) throw new Error("[FATAL] ESTIMATOR_V2_SHEET_ID is not configured. Set this environment variable.");
  return id;
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

// Minimum row counts to consider seed data current.
// SEED_SERVICE_MIN = 36 matches the 36 rows seeded: 35 active services + 1 disabled
// seed-version marker (_SEED_VER_20260513 in estimatorSeedData.js). On first boot the
// sheet has fewer rows → stale → clears both tabs and re-seeds.
// After re-seed: 36 rows ≥ 36 → stable, no further clearing.
//
// To force a future re-seed: add a new disabled version-marker service to SERVICES in
// estimatorSeedData.js (e.g. _SEED_VER_20260601), then bump SEED_SERVICE_MIN to 37.
// The sheet will have 36 rows < 37 → stale → clears and re-seeds with 37 rows → stable.
// Same pattern for SEED_MODULE_MIN when new modules are added.
const SEED_MODULE_MIN  = 52;
const SEED_SERVICE_MIN = 36;

async function clearTabData(sheets, tab) {
  try {
    await sheets.spreadsheets.values.clear({
      spreadsheetId: SPREADSHEET_ID(),
      range: `${tab}!2:10000`,
    });
    console.log(`[estimatorModulesConfig] Cleared stale data rows from ${tab}.`);
  } catch (e) {
    console.warn(`[estimatorModulesConfig] Could not clear ${tab}: ${e.message}`);
  }
}

async function ensureAndSeed(sheets) {
  const sheetId = SPREADSHEET_ID();
  // Both tabs live exclusively on the V2 estimator sheet
  await ensureTabHeaders("Estimator_Modules",      sheetId);
  await ensureTabHeaders("Estimator_ServiceMatrix", sheetId);

  const [existingModules, existingServices] = await Promise.all([
    readTab(sheets, "Estimator_Modules"),
    readTab(sheets, "Estimator_ServiceMatrix"),
  ]);

  const validModules  = existingModules.filter(r => r.module_id).length;
  const validServices = existingServices.filter(r => r.service_id).length;

  // Detect stale seed: old seed had 20 modules / 25 services.
  // If either tab is below the minimum, clear both and re-seed fresh.
  const isStale = validModules < SEED_MODULE_MIN || validServices < SEED_SERVICE_MIN;
  if (isStale && (validModules > 0 || validServices > 0)) {
    console.log(
      `[estimatorModulesConfig] Stale seed detected ` +
      `(${validModules} modules, ${validServices} services — need ≥${SEED_MODULE_MIN}/${SEED_SERVICE_MIN}). ` +
      `Clearing and re-seeding.`
    );
    await Promise.all([
      clearTabData(sheets, "Estimator_Modules"),
      clearTabData(sheets, "Estimator_ServiceMatrix"),
    ]);
  }

  const needsModuleSeed  = isStale || validModules  === 0;
  const needsServiceSeed = isStale || validServices === 0;

  const seedPromises = [];
  if (needsModuleSeed) {
    seedPromises.push(appendRows(sheets, "Estimator_Modules", MODULES));
  }
  if (needsServiceSeed) {
    const svcRows = SERVICES.map(s => ({
      ...s,
      qty_min: "",
      qty_max: "",
      disqualify_rules_json: "[]",
    }));
    seedPromises.push(appendRows(sheets, "Estimator_ServiceMatrix", svcRows));
  }
  if (seedPromises.length) await Promise.all(seedPromises);
}

async function loadConfigFromSheet() {
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

  // Build a seed-data lookup for conditional_rules fallback.
  // The Estimator_ServiceMatrix sheet may not have a conditional_rules_json
  // column yet (it was added after initial seeding). When the column is absent
  // the sheet row returns an empty string; the seed lookup ensures the rules
  // still flow without requiring a forced re-seed.
  const _seedConditionalRules = {};
  for (const s of SERVICES) {
    if (s.conditional_rules_json) {
      try { _seedConditionalRules[s.service_id] = JSON.parse(s.conditional_rules_json); } catch { /* ignore */ }
    }
  }

  const services = svcRows
    .filter(r => r.service_id && String(r.enabled).toUpperCase() !== "FALSE")
    .map(r => {
      let conditional_rules = null;
      if (r.conditional_rules_json) {
        try { conditional_rules = JSON.parse(r.conditional_rules_json); } catch { conditional_rules = null; }
      }
      // Fall back to seed data when the sheet column is missing / empty
      if (!conditional_rules && _seedConditionalRules[r.service_id]) {
        conditional_rules = _seedConditionalRules[r.service_id];
      }
      return {
        service_id:        r.service_id,
        service_name:      r.service_name,
        segment:           r.segment,
        tier:              r.tier,
        modules_csv:       r.modules_csv,
        qty_min:           r.qty_min ? Number(r.qty_min) : null,
        qty_max:           r.qty_max ? Number(r.qty_max) : null,
        base_price_mode:   r.base_price_mode,
        conditional_rules: conditional_rules,
      };
    });

  return { modulesById, services, updatedAt: new Date().toISOString() };
}

// ── Public API ─────────────────────────────────────────────────────────────────

async function getEstimatorConfig() {
  if (_cache && Date.now() - _cacheAt < CACHE_TTL_MS) return _cache;

  if (!process.env.ESTIMATOR_V2_SHEET_ID) {
    throw new Error(
      "[FATAL] ESTIMATOR_V2_SHEET_ID is required. The V1 estimator engine has been removed. " +
      "Set this environment variable to point to your V2 estimator Google Sheet."
    );
  }

  _cache   = await loadConfigFromSheet();
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

// api/estimator-config.js
// GET  /api/estimator/config  — normalized config for frontend
// GET  /api/estimator/health  — diagnostics
// POST /api/estimator/quote   — full pricing engine

const crypto = require("crypto");
const { getEstimatorConfig, getCacheAge } = require("../lib/estimatorModulesConfig");
const { evaluateService, computePrice, getBasePrice } = require("../lib/estimatorEngine");
const { writeLeadSnapshot } = require("../lib/estimatorSnapshot");

const NO_CACHE = { "Content-Type": "application/json", "Cache-Control": "no-store, max-age=0" };

function json(res, status, payload, headers = {}) {
  res.writeHead(status, { "Content-Type": "application/json", ...headers });
  res.end(JSON.stringify(payload));
}

function readBody(req) {
  return new Promise(resolve => {
    let buf = "";
    req.on("data", c => (buf += c));
    req.on("end", () => { try { resolve(JSON.parse(buf)); } catch { resolve({}); } });
  });
}

// ── Normalize config into the frontend-safe shape ────────────────────────────
function normalizeConfig(raw) {
  const modules = raw.modulesById || {};
  const services = (raw.services || []).map(s => ({
    service_id:      s.service_id,
    service_name:    s.service_name,
    segment:         s.segment,
    tier:            s.tier,
    enabled:         String(s.enabled ?? "TRUE").toUpperCase() !== "FALSE",
    qty_min:         s.qty_min || null,
    qty_max:         s.qty_max || null,
    base_price_mode: s.base_price_mode,
    modules_csv:     s.modules_csv,
    modules:         (s.modules_csv || "").split(",").map(m => m.trim()).filter(Boolean),
  }));
  return { updatedAt: raw.updatedAt, modules, services };
}

// ── GET /api/estimator/config ────────────────────────────────────────────────
async function handleEstimatorConfig(req, res) {
  try {
    const raw  = await getEstimatorConfig();
    const cfg  = normalizeConfig(raw);
    json(res, 200, { ok: true, ...cfg }, NO_CACHE);
  } catch (err) {
    console.error("[estimator-config]", err.message);
    json(res, 500, { ok: false, error: err.message }, NO_CACHE);
  }
}

// ── GET /api/estimator/health ────────────────────────────────────────────────
async function handleEstimatorHealth(req, res) {
  try {
    const sheetId = process.env.ESTIMATOR_V2_SHEET_ID;
    if (!sheetId) {
      return json(res, 500, { ok: false, error: "Estimator sheet not configured. Set ESTIMATOR_V2_SHEET_ID.", warnings: [] }, NO_CACHE);
    }

    // Fetch sheet name from API metadata
    let sheet_name = "unknown";
    try {
      const { getSheetsClient } = require("../lib/sheets");
      const sheets = await getSheetsClient();
      const meta   = await sheets.spreadsheets.get({ spreadsheetId: sheetId });
      sheet_name   = meta.data.properties?.title || "unknown";
    } catch { /* non-fatal */ }

    const raw  = await getEstimatorConfig();
    const cfg  = normalizeConfig(raw);
    const warnings = [];

    if (!cfg.services.length)             warnings.push("Estimator_ServiceMatrix is empty — no services loaded.");
    if (!Object.keys(cfg.modules).length) warnings.push("Estimator_Modules is empty — no modules loaded.");

    for (const svc of cfg.services) {
      for (const mid of svc.modules) {
        if (!cfg.modules[mid]) warnings.push(`Service "${svc.service_id}" references unknown module "${mid}".`);
      }
    }

    const sample_service = cfg.services[0]
      ? { service_id: cfg.services[0].service_id, service_name: cfg.services[0].service_name,
          modules_csv: cfg.services[0].modules_csv, tier: cfg.services[0].tier }
      : null;
    const modVals = Object.values(cfg.modules);
    const sample_module = modVals[0]
      ? { module_id: modVals[0].module_id, question: modVals[0].question, input_type: modVals[0].input_type }
      : null;

    json(res, 200, {
      ok: true,
      sheet_name,
      sheet_id: sheetId,
      cache_age_ms: getCacheAge(),
      services_count: cfg.services.length,
      modules_count: Object.keys(cfg.modules).length,
      sample_service,
      sample_module,
      warnings,
    }, NO_CACHE);
  } catch (err) {
    json(res, 500, { ok: false, error: err.message, warnings: [err.message] }, NO_CACHE);
  }
}

// ── POST /api/estimator/quote ────────────────────────────────────────────────
async function handleEstimatorQuote(req, res) {
  const lead_id    = "LE-" + crypto.randomBytes(5).toString("hex").toUpperCase();
  const created_at = new Date().toISOString();
  const snapBase   = { lead_id, created_at_iso: created_at };

  try {
    const body = await readBody(req);
    const { segment, service_id, service_name, qty = 1,
            answersByModule = {}, photoCount = 0,
            customer_name = "", customer_phone = "", customer_email = "" } = body;

    if (!segment || !service_id) {
      await writeLeadSnapshot({ ...snapBase, service_id, segment, status: "error",
        snapshot_json: JSON.stringify({ error: "Missing segment or service_id" }) });
      return json(res, 400, { ok: false, error: "segment and service_id are required" });
    }

    const raw     = await getEstimatorConfig();
    const service = (raw.services || []).find(s => s.service_id === service_id);
    if (!service) {
      await writeLeadSnapshot({ ...snapBase, service_id, segment, status: "error",
        snapshot_json: JSON.stringify({ error: "Unknown service_id" }) });
      return json(res, 400, { ok: false, error: `Unknown service: ${service_id}` });
    }

    const eval_ = evaluateService(raw.modulesById, service, answersByModule, photoCount);
    const { tier_result, reasons, risk_multiplier, contingency_pct } = eval_;

    let basePrice = 0, priceSource = "placeholder";
    if (tier_result !== "needs_site_visit") {
      const bp = await getBasePrice(service_id, service_name || service.service_name, qty);
      basePrice = bp.final_price; priceSource = bp.source;
    }

    const { subtotal, total } = computePrice(basePrice, risk_multiplier, contingency_pct);
    const canPrice = !["needs_site_visit","needs_photos"].includes(tier_result);
    const status   = tier_result === "needs_site_visit"   ? "needs_site_visit"
                   : tier_result === "needs_photos"        ? "needs_photos"
                   : priceSource === "placeholder"         ? "quoted_placeholder"
                   : "quoted";

    const snapshot = { config_version: raw.updatedAt, service, qty, segment,
      answersByModule, photoCount, risk_multiplier, contingency_pct,
      basePrice, priceSource, subtotal: canPrice?subtotal:0, total: canPrice?total:0,
      tier_result, reasons };

    await writeLeadSnapshot({ ...snapBase, customer_name, customer_phone, customer_email,
      segment, service_id, service_name: service.service_name, tier_result, risk_multiplier,
      contingency_pct, subtotal: canPrice?subtotal:0, total: canPrice?total:0,
      answers_json: JSON.stringify(answersByModule), snapshot_json: JSON.stringify(snapshot),
      photo_urls_json: "[]", status });

    const message = tier_result === "needs_site_visit"
      ? "Based on your answers, an on-site assessment is required before we can provide a firm quote."
      : tier_result === "needs_photos"
      ? "Photos are required for this service to proceed with an instant quote."
      : priceSource === "placeholder"
      ? `Thank you! We'll contact you to confirm pricing for your ${service.service_name}.`
      : "Your estimate is ready! Pricing reflects job complexity and site conditions.";

    console.log(`[estimator/quote] lead=${lead_id} svc=${service_id} tier=${tier_result} total=${canPrice?total:0}`);
    json(res, 200, { ok:true, lead_id, tier_result, reasons, risk_multiplier, contingency_pct,
      subtotal: canPrice?subtotal:0, total: canPrice?total:0, price_source: priceSource, status, message });

  } catch (err) {
    console.error("[estimator/quote]", err.message);
    await writeLeadSnapshot({ ...snapBase, status: "error",
      snapshot_json: JSON.stringify({ error: err.message }) }).catch(() => {});
    json(res, 500, { ok: false, error: err.message });
  }
}

module.exports = { handleEstimatorConfig, handleEstimatorHealth, handleEstimatorQuote };

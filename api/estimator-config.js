// api/estimator-config.js
// GET  /api/estimator/config          — normalized config for frontend
// GET  /api/estimator/health          — diagnostics
// GET  /api/estimator/classification  — internal/admin classification map (auth-protected)
// POST /api/estimator/quote           — full pricing engine
//
// Stabilization (2026-03-18):
//   Item 1 — instant_with_safeguards returns a price range, not a firm price
//   Item 3 — service_id normalized via SERVICE_ID_ALIASES before lookup
//   Item 4 — UNCERTAINTY_BUFFER coerced to valid enum before evaluation
//   Item 5 — every response includes an internal _audit trace
//   Item 6 — sanity bands force review_required when total is out of range

const crypto = require("crypto");
const { getEstimatorConfig, getCacheAge } = require("../lib/estimatorModulesConfig");
const { evaluateService, computePrice, getBasePrice } = require("../lib/estimatorEngine");
const { getAllClassifications } = require("../lib/serviceClassification");
const { writeLeadSnapshot } = require("../lib/estimatorSnapshot");
const { normalizeServiceId, coerceAnswers, checkSanityBand } = require("../lib/estimatorGuardrails");
const { getFlaggedReport } = require("../lib/flaggedMaterials");

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

function r5(n) { return Math.round(n / 5) * 5; }

// ── Normalize config into the frontend-safe shape ────────────────────────────
function normalizeConfig(raw) {
  const modules  = raw.modulesById || {};
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
    const raw = await getEstimatorConfig();
    const cfg = normalizeConfig(raw);
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
      sheet_id:        sheetId,
      cache_age_ms:    getCacheAge(),
      services_count:  cfg.services.length,
      modules_count:   Object.keys(cfg.modules).length,
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
    const {
      segment, qty = 1,
      photoCount = 0,
      customer_name = "", customer_phone = "", customer_email = "",
    } = body;
    // Accept both "answersByModule" (canonical) and "answers" (legacy alias)
    const answersByModule = body.answersByModule || body.answers || {};

    // ── Item 3: normalize service_id ─────────────────────────────────────────
    const raw_service_id = body.service_id;
    const service_id     = normalizeServiceId(raw_service_id);
    const service_name   = body.service_name;

    if (!segment || !service_id) {
      await writeLeadSnapshot({ ...snapBase, service_id, segment, status: "error",
        snapshot_json: JSON.stringify({ error: "Missing segment or service_id" }) });
      return json(res, 400, { ok: false, error: "segment and service_id are required" });
    }

    const raw     = await getEstimatorConfig();
    const service = (raw.services || []).find(s => s.service_id === service_id);
    if (!service) {
      await writeLeadSnapshot({ ...snapBase, service_id, segment, status: "error",
        snapshot_json: JSON.stringify({ error: "Unknown service_id", raw_service_id }) });
      return json(res, 400, { ok: false, error: `Unknown service: ${service_id} (raw: ${raw_service_id})` });
    }

    // ── Item 4: coerce UNCERTAINTY_BUFFER to valid enum ───────────────────────
    const { coercedAnswers, fixes: invalidAnswersFix } = coerceAnswers(answersByModule, service_id);

    const eval_ = evaluateService(raw.modulesById, service, coercedAnswers, photoCount);
    const { tier_result, reasons, risk_multiplier, contingency_pct, photo_warning } = eval_;

    let basePrice = 0, priceSource = "placeholder", debugDrivers = [], debugBreakdown = null,
        reviewFlag = false, materialDisclosure = null, excludedMaterials = [];

    if (tier_result !== "needs_site_visit") {
      const bp = await getBasePrice(
        service_id, service_name || service.service_name, qty,
        coercedAnswers, raw.modulesById, service.modules_csv
      );
      basePrice          = bp.final_price;
      priceSource        = bp.source;
      debugDrivers       = bp.debug_drivers || [];
      debugBreakdown     = bp.debug_breakdown || null;
      reviewFlag         = bp.review_flag    || false;
      materialDisclosure = bp.material_disclosure || null;
      excludedMaterials  = bp.excluded_materials  || [];
    }

    const { subtotal, total } = computePrice(basePrice, risk_multiplier, contingency_pct);
    const canPrice = tier_result !== "needs_site_visit";

    // ── Item 6: sanity band check ─────────────────────────────────────────────
    let sanityBreach = null;
    if (canPrice && priceSource === "v2" && total > 0) {
      const check = checkSanityBand(service_id, total);
      if (!check.ok) {
        sanityBreach = check.reason;
        console.warn(`[estimator/quote] sanity breach lead=${lead_id} svc=${service_id}: ${check.reason}`);
      }
    }

    // Determine final status
    const isReviewRequired = sanityBreach != null || reviewFlag;
    const status = tier_result === "needs_site_visit"  ? "needs_site_visit"
                 : sanityBreach != null                 ? "review_required"
                 : priceSource === "placeholder"        ? "quoted_placeholder"
                 : "quoted";

    // ── Item 1: price range for instant_with_safeguards ───────────────────────
    // We do NOT expose a hard sell price for instant_with_safeguards.
    // Return an estimated range (±15%) and let the sales team confirm.
    let display_mode     = "hidden";
    let estimated_low    = 0;
    let estimated_high   = 0;
    if (canPrice && priceSource === "v2" && !sanityBreach) {
      if (tier_result === "instant") {
        display_mode   = "exact";
        estimated_low  = total;
        estimated_high = total;
      } else if (tier_result === "instant_with_safeguards") {
        display_mode   = "range";
        estimated_low  = r5(total * 0.90);
        estimated_high = r5(total * 1.15);
      }
    }

    // ── Item 5: internal audit trace ─────────────────────────────────────────
    const review_flags = [];
    if (photo_warning)  review_flags.push("photo_warning");
    if (reviewFlag)     review_flags.push("material_data_incomplete");
    if (sanityBreach)   review_flags.push("sanity_band_breach");

    const _audit = {
      service_id,
      normalized_service_id:   service_id !== raw_service_id ? service_id : null,
      original_service_id:     raw_service_id,
      qty,
      base_price_raw:          basePrice,
      labor_subtotal:          debugBreakdown?.labor_cost        ?? null,
      material_subtotal:       debugBreakdown?.material_allowance ?? null,
      markup_pct:              25,
      risk_multiplier_applied: risk_multiplier,
      contingency_pct_applied: contingency_pct,
      driver_multipliers_used: debugDrivers,
      invalid_answers_fixed:   invalidAnswersFix,
      subtotal:                canPrice ? subtotal : 0,
      final_total:             canPrice ? total    : 0,
      display_mode,
      estimated_low:           display_mode === "range" ? estimated_low  : null,
      estimated_high:          display_mode === "range" ? estimated_high : null,
      sanity_breach:           sanityBreach,
      review_flags,
      excluded_materials:      excludedMaterials,
      tier_result,
      price_source:            priceSource,
      status,
      generated_at:            created_at,
    };

    // Lead snapshot
    const snapshot = {
      config_version: raw.updatedAt,
      service, qty, segment,
      answersByModule: coercedAnswers, photoCount, photo_warning,
      risk_multiplier, contingency_pct,
      basePrice, priceSource,
      subtotal:         canPrice ? subtotal : 0,
      total:            canPrice ? total    : 0,
      estimated_low, estimated_high, display_mode,
      tier_result, reasons,
      sanity_breach:    sanityBreach,
      invalid_answers_fixed: invalidAnswersFix,
    };

    await writeLeadSnapshot({
      ...snapBase,
      customer_name, customer_phone, customer_email,
      segment, service_id, service_name: service.service_name,
      tier_result, risk_multiplier, contingency_pct,
      subtotal:       canPrice ? subtotal : 0,
      total:          canPrice ? total    : 0,
      answers_json:   JSON.stringify(coercedAnswers),
      snapshot_json:  JSON.stringify(snapshot),
      photo_urls_json: "[]",
      status,
    });

    // Customer-facing message
    const message = tier_result === "needs_site_visit"
      ? "Based on your answers, an on-site assessment is required before we can provide a firm quote."
      : sanityBreach
      ? "Your job has a few details we'd like to confirm. Our team will reach out with a firm quote."
      : priceSource === "placeholder"
      ? `Thank you! We'll contact you to confirm pricing for your ${service.service_name}.`
      : tier_result === "instant_with_safeguards"
      ? "Your estimate is ready! Pricing is an estimated range based on job complexity and site conditions."
      : "Your estimate is ready! Pricing reflects job complexity and site conditions.";

    console.log(`[estimator/quote] lead=${lead_id} svc=${service_id} tier=${tier_result} display=${display_mode} low=${estimated_low} high=${estimated_high} total=${canPrice?total:0} cont=${Math.round(contingency_pct*100)}% drivers=[${debugDrivers.join(",")}] fixes=[${invalidAnswersFix.join(",")}]`);

    const response = {
      ok:            true,
      lead_id,
      tier_result,
      reasons,
      risk_multiplier,
      contingency_pct,
      photo_warning: photo_warning || false,
      // ── Item 1: range-mode pricing ───────────────────────────────────────────
      display_mode,
      estimated_low,
      estimated_high,
      // Raw totals kept for internal use (not shown to customer as firm price)
      subtotal:      canPrice ? subtotal : 0,
      total:         canPrice ? total    : 0,
      price_source:  priceSource,
      status,
      message,
      debug_drivers: debugDrivers,
      // ── Item 5: audit trace ──────────────────────────────────────────────────
      _audit,
    };

    if (reviewFlag)         response.review_flag         = true;
    if (materialDisclosure) response.material_disclosure = materialDisclosure;
    if (sanityBreach)       response.sanity_breach       = sanityBreach;
    if (debugBreakdown)     response.debug_breakdown     = debugBreakdown;

    json(res, 200, response);

  } catch (err) {
    console.error("[estimator/quote]", err.message);
    await writeLeadSnapshot({ ...snapBase, status: "error",
      snapshot_json: JSON.stringify({ error: err.message }) }).catch(() => {});
    json(res, 500, { ok: false, error: err.message });
  }
}

// ── GET /api/estimator/classification ────────────────────────────────────────
// Internal/admin endpoint. Returns live classification map for all services.
async function handleEstimatorClassification(req, res) {
  try {
    const raw    = await getEstimatorConfig();
    const allCls = getAllClassifications();

    const services = (raw.services || []).map(s => {
      const svcId = s.service_id;
      const cls   = allCls[svcId] || {
        status: "UNCLASSIFIED", quoteAllowed: true, reviewFlag: false,
        stackCap: null, materialGap: "unknown", blockerReason: null,
      };
      return {
        service_id:       svcId,
        service_name:     s.service_name,
        segment:          s.segment,
        tier:             s.tier,
        classification:   cls.status,
        quote_allowed:    cls.quoteAllowed,
        review_flag:      cls.reviewFlag,
        material_gap:     cls.materialGap,
        stack_cap_active: cls.stackCap != null,
        stack_cap_value:  cls.stackCap,
        blocker_reason:   cls.blockerReason || null,
        material_note:    cls.materialNote  || null,
      };
    });

    const summary = {
      PRODUCTION_READY:       services.filter(s => s.classification === "PRODUCTION_READY").length,
      READY_WITH_REVIEW_FLAG: services.filter(s => s.classification === "READY_WITH_REVIEW_FLAG").length,
      MANUAL_QUOTE_ONLY:      services.filter(s => s.classification === "MANUAL_QUOTE_ONLY").length,
      UNCLASSIFIED:           services.filter(s => s.classification === "UNCLASSIFIED").length,
    };

    // Include flagged materials report
    const flagged_materials = getFlaggedReport();

    json(res, 200, {
      ok:           true,
      generated_at: new Date().toISOString(),
      source:       "lib/serviceClassification.js",
      summary,
      services,
      flagged_materials,
      assembly_to_service_map: allCls._assemblyToService || {},
    }, NO_CACHE);
  } catch (err) {
    console.error("[estimator/classification]", err.message);
    json(res, 500, { ok: false, error: err.message }, NO_CACHE);
  }
}

module.exports = { handleEstimatorConfig, handleEstimatorHealth, handleEstimatorQuote, handleEstimatorClassification };

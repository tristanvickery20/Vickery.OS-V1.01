// lib/estimatorEngine.js
// Pure evaluation + pricing logic for the instant estimator.
// No I/O — all data passed in.
//
// Design notes:
//   - risk_multiplier is always 1.0. Module option multipliers apply exactly once,
//     inside getBasePrice() → calculateQuoteV2() as MULTIPLY_HOURS drivers.
//   - All module processing scoped to service.modules_csv allowed set.
//   - Photo check is a soft photo_warning flag, not a hard-stop tier.
//   - UNCERTAINTY_BUFFER controls contingency_pct only — never sent as a
//     MULTIPLY_HOURS driver (would double-count uncertainty in final price).
//   - Option-level disqualify (disqualify:true in options_json) is the primary
//     mechanism. Hardcoded business rules below handle compound conditions only.

const PHOTO_MODULES = new Set(["PANEL_PHOTO", "WORK_AREA_PHOTO", "CEILING_PHOTO", "OUTLET_PHOTO", "SWITCH_PHOTO", "OUTDOOR_PHOTO"]);
const { getClassification } = require("./serviceClassification");

// ── Explicit service → assembly mapping ───────────────────────────────────────
// Only services listed here get instant pricing from the V2 engine.
// No fuzzy fallback — missing entry returns placeholder and logs it.
const SERVICE_TO_ASSEMBLY = {
  CEILING_FAN_INSTALL:    "A004",
  LIGHT_FIXTURE_INSTALL:  "A003",
  RECESSED_LIGHTING:      "A001",
  DIMMER_SWITCH:          "A008",
  SMART_SWITCH:           "A008",
  OUTLET_INSTALL:         "A011",
  GFCI_OUTLET:            "A012",
  PANEL_UPGRADE:          "A019",
  SUBPANEL_INSTALL:       "A020",
  SURGE_PROTECTOR:        "A024",
  EV_CHARGER:             "A028",
  HOT_TUB_CIRCUIT:        "A029",
  OUTDOOR_LIGHTING:       "A005",
  MOTION_SECURITY_LIGHT:  "A006",
  SMOKE_CO_DETECTOR:      "A030",
  COMM_LIGHTING_RETROFIT: "A037",
  BALLAST_REPLACE:        "A036",
  EXIT_EMERGENCY_LIGHTS:  "A034",
};

/**
 * evaluateService — compute tier_result, contingency, reasons.
 *
 * Disqualify cascade:
 *  1. Service tier === "site_visit_required" → always disqualify
 *  2. Classification === MANUAL_QUOTE_ONLY   → always disqualify
 *  3. Option-level disqualify (disqualify:true in options_json) per module answer
 *  4. Compound business rules below
 */
function evaluateService(modulesById, service, answersByModule, photoCount) {
  const modules    = (service.modules_csv || "").split(",").map(m => m.trim()).filter(Boolean);
  const allowedSet = new Set(modules);
  const reasons    = [];

  let disqualified = service.tier === "site_visit_required";
  if (disqualified) reasons.push("Service type requires on-site assessment.");

  // ── Classification gate: MANUAL_QUOTE_ONLY ────────────────────────────────
  const cls = getClassification(service.service_id);
  if (cls.status === "MANUAL_QUOTE_ONLY" && !disqualified) {
    disqualified = true;
    reasons.push(cls.blockerReason || "Service requires manual quote — instant pricing not available.");
  }

  // risk_multiplier is always 1.0 — module multipliers flow through getBasePrice()
  const risk_multiplier = 1.0;

  // ── Option-level disqualify (primary mechanism) ───────────────────────────
  // Checks every module in the allowed set whose answer has disqualify:true in options_json
  for (const mid of modules) {
    const mod = modulesById[mid];
    if (!mod) continue;
    const val = answersByModule[mid];
    if (!val) continue;
    const opt = (mod.options || []).find(o => o.value === val);
    if (!opt) continue;
    if (opt.disqualify) {
      disqualified = true;
      reasons.push(`${mod.question || mid}: "${opt.label}" requires site visit.`);
    }
  }

  // ── Compound business rules ───────────────────────────────────────────────
  // These catch conditions that can't be expressed as a single option.

  // Pre-1950 homes: disqualify panel/circuit services (knob-and-tube risk)
  // Note: "pre_1950" must match the HOME_AGE option value in estimatorSeedData.js
  const age = allowedSet.has("HOME_AGE") ? answersByModule["HOME_AGE"] : null;
  if (age === "pre_1950") {
    const isPanel = /PANEL|REWIRE|CIRCUIT|EV|HOT_TUB|SUBPANEL|SURGE/.test(service.service_id);
    if (isPanel) {
      disqualified = true;
      reasons.push("Homes built before 1950 require site visit for panel/circuit work (possible knob-and-tube).");
    }
  }

  // Recessed lighting: no attic access + vaulted ceiling = too many unknowns
  // Either condition alone is priceable; together they are not (scaffold + remodel cans + fishing = wildcard)
  if (service.service_id === "RECESSED_LIGHTING") {
    const attic   = allowedSet.has("ATTIC_ACCESS")   ? answersByModule["ATTIC_ACCESS"]   : null;
    const ceiling = allowedSet.has("CEILING_HEIGHT")  ? answersByModule["CEILING_HEIGHT"]  : null;
    if (attic === "no" && ceiling === "vaulted") {
      disqualified = true;
      reasons.push("Vaulted ceilings with no attic access require site visit — scaffolding and open-ceiling work scope is too variable.");
    }
  }

  // ── Photo gate → soft warning, not a hard-stop ────────────────────────────
  const hasPhotoModule = modules.some(m => PHOTO_MODULES.has(m));
  const photo_warning  = hasPhotoModule && (photoCount || 0) === 0;
  if (photo_warning) {
    reasons.push("No photos provided — estimate may be less accurate. A tech may follow up to confirm scope.");
  }

  // ── Contingency from UNCERTAINTY_BUFFER (scoped to allowed modules) ───────
  const hasUnsure = modules.some(mid => answersByModule[mid] === "_unsure");
  const ub        = allowedSet.has("UNCERTAINTY_BUFFER") ? answersByModule["UNCERTAINTY_BUFFER"] : null;
  let contingency_pct = 0;
  if (hasUnsure || ub === "complex")  contingency_pct = 0.15;
  else if (ub === "moderate")         contingency_pct = 0.10;

  const tier_result = disqualified
    ? "needs_site_visit"
    : service.tier === "instant" ? "instant"
    : "instant_with_safeguards";

  return { tier_result, reasons, risk_multiplier, contingency_pct, photo_warning };
}

/**
 * computePrice — apply risk + contingency to a base price.
 * risk_multiplier is always 1.0 but kept for backward compatibility.
 */
function computePrice(baseSubtotal, risk_multiplier, contingency_pct) {
  const subtotal = Math.round((baseSubtotal * risk_multiplier) / 5) * 5;
  const total    = Math.round((subtotal * (1 + contingency_pct)) / 5) * 5;
  return { subtotal, total };
}

/**
 * getBasePrice — V2 assembly pricing via explicit map.
 * Answers filtered to allowedModulesCsv set before building driver options.
 * Uses SERVICE_TO_ASSEMBLY; no fuzzy fallback.
 *
 * @param {string} serviceId
 * @param {string} serviceName
 * @param {number} qty
 * @param {object} answersByModule      — { module_id: answer_value }
 * @param {object} modulesById          — module definitions keyed by module_id
 * @param {string} [allowedModulesCsv]  — comma-separated list of allowed module IDs
 */
async function getBasePrice(serviceId, serviceName, qty, answersByModule, modulesById, allowedModulesCsv) {
  // ── Classification enforcement ────────────────────────────────────────────
  const cls = getClassification(serviceId);
  if (!cls.quoteAllowed) {
    console.log(`[getBasePrice] BLOCKED service=${serviceId} status=${cls.status} reason=${cls.blockerReason}`);
    return {
      final_price:            0,
      source:                 "manual_quote_only",
      debug_drivers:          [],
      manual_review_required: true,
      classification_trace: {
        service_id:     serviceId,
        classification: cls.status,
        quote_allowed:  false,
        blocker:        cls.blockerReason,
        material_gap:   cls.materialGap,
      },
    };
  }

  // ── Filter answers to allowed modules ─────────────────────────────────────
  const allowedModules = new Set(
    (allowedModulesCsv || "").split(",").map(m => m.trim()).filter(Boolean)
  );
  const filteredAnswers = allowedModules.size > 0
    ? Object.fromEntries(Object.entries(answersByModule || {}).filter(([mid]) => allowedModules.has(mid)))
    : (answersByModule || {});
  const ignoredAnswers  = allowedModules.size > 0
    ? Object.keys(answersByModule || {}).filter(mid => !allowedModules.has(mid))
    : [];

  try {
    const { getActiveConfig, isV2Mode } = require("./estimatorV2Config");
    if (!isV2Mode()) {
      return { final_price: 0, source: "placeholder", classification_trace: { classification: "UNCLASSIFIED" } };
    }

    const config     = await getActiveConfig();
    const assemblies = config._v2?.assemblies || [];

    // ── Explicit assembly lookup — no fuzzy fallback ──────────────────────────
    const targetAssemblyId = SERVICE_TO_ASSEMBLY[serviceId];
    if (!targetAssemblyId) {
      console.log(`[getBasePrice] No explicit assembly mapping for service=${serviceId} — returning placeholder`);
      return {
        final_price: 0,
        source:      "placeholder",
        classification_trace: {
          service_id:     serviceId,
          classification: cls.status,
          note:           "no explicit assembly mapping — add to SERVICE_TO_ASSEMBLY in estimatorEngine.js",
        },
      };
    }

    const assembly = assemblies.find(a => a.assembly_id === targetAssemblyId);
    if (!assembly) {
      console.log(`[getBasePrice] Assembly ${targetAssemblyId} not found in sheet for service=${serviceId}`);
      return {
        final_price: 0,
        source:      "placeholder",
        classification_trace: {
          service_id:     serviceId,
          assembly_id:    targetAssemblyId,
          classification: cls.status,
          note:           "assembly ID not found in Assemblies sheet",
        },
      };
    }

    // ── Build MULTIPLY_HOURS driver options from filtered answers ─────────────
    // UNCERTAINTY_BUFFER is intentionally excluded — it controls contingency_pct
    // only via evaluateService(). Including it here would double-count uncertainty.
    const selectedDriverOptions = [];
    const processedAnswers      = {};
    const mods = modulesById || {};
    for (const [mid, val] of Object.entries(filteredAnswers)) {
      if (mid === "UNCERTAINTY_BUFFER") continue;
      if (!val || val === "_unsure") continue;
      const mod = mods[mid];
      if (!mod) continue;
      const opt = (mod.options || []).find(o => o.value === val);
      if (!opt || opt.multiplier == null) continue;
      const mult = Number(opt.multiplier);
      if (!isFinite(mult) || mult === 1.0) continue;
      selectedDriverOptions.push({
        effect_type:   "MULTIPLY_HOURS",
        effect_value:  mult,
        _debug_source: `${mid}:${val}(×${mult})`,
      });
      processedAnswers[mid] = { value: val, multiplier: mult };
    }

    const { calculateQuoteV2 } = require("./quoteEngineV2");
    const result = calculateQuoteV2({
      assembly,
      qty:                  Math.max(1, qty || 1),
      selectedDriverOptions,
      v2Data:               config._v2,
      serviceAreas:         config.serviceAreas || {},
      zip:                  null,
      stackCap:             cls.stackCap,
    });

    const debug_drivers = selectedDriverOptions.map(d => d._debug_source);
    if (debug_drivers.length) {
      console.log(`[getBasePrice] ${serviceId} drivers: ${debug_drivers.join(", ")}`);
    }
    if (result.stack_cap_trace?.cap_applied) {
      console.log(`[getBasePrice] stackCap ${serviceId}: uncapped=${result.stack_cap_trace.uncapped_multiplier} → capped=${result.stack_cap_trace.applied_multiplier}`);
    }

    const out = {
      final_price:  result.final_price || 0,
      source:       "v2",
      debug_drivers,
      classification_trace: {
        service_id:           serviceId,
        assembly_id:          targetAssemblyId,
        classification:       cls.status,
        quote_allowed:        true,
        review_flag:          cls.reviewFlag,
        material_gap:         cls.materialGap,
        stack_cap_configured: cls.stackCap,
        uncapped_multiplier:  result.stack_cap_trace?.uncapped_multiplier,
        capped_multiplier:    result.stack_cap_trace?.applied_multiplier,
        cap_applied:          result.stack_cap_trace?.cap_applied,
      },
    };

    // ── Debug breakdown (ESTIMATOR_DEBUG=true) ────────────────────────────────
    if (process.env.ESTIMATOR_DEBUG === "true") {
      out.debug_breakdown = {
        service_id:                  serviceId,
        assembly_id:                 targetAssemblyId,
        allowed_modules:             [...allowedModules],
        processed_answers:           processedAnswers,
        ignored_answers:             ignoredAnswers,
        selected_driver_options:     debug_drivers,
        stack_cap_trace:             result.stack_cap_trace,
        base_price_before_contingency: result.final_price,
        risk_multiplier:             1.0,
        contingency_pct:             null,
        subtotal:                    result.final_price,
        total:                       result.final_price,
        material_allowance:          result.material_allowance,
        labor_cost:                  result.labor_cost,
        overhead_cost:               result.overhead_cost,
        travel_fee:                  result.travel_fee,
        classification:              cls.status,
      };
    }

    // Attach review flags for READY_WITH_REVIEW_FLAG services
    if (cls.reviewFlag) {
      out.review_flag         = true;
      out.material_disclosure = cls.materialNote
        || "Material allowance is $0 (placeholder data). Materials to be confirmed and added at actuals.";
    }

    return out;
  } catch (err) {
    console.error("[getBasePrice]", err.message);
    return {
      final_price: 0,
      source:      "placeholder",
      classification_trace: { service_id: serviceId, classification: cls.status, error: err.message },
    };
  }
}

module.exports = { evaluateService, computePrice, getBasePrice, SERVICE_TO_ASSEMBLY };

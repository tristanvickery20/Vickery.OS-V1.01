// lib/estimatorEngine.js
// Pure evaluation + pricing logic for the instant estimator.
// No I/O — all data passed in.
//
// Bug 1 fix: risk_multiplier is always 1.0 — module option multipliers apply
//   exactly once, inside getBasePrice() → calculateQuoteV2() as MULTIPLY_HOURS.
// Bug 2 fix: all module processing scoped to service.modules_csv allowed set.
// Bug 3 fix: explicit SERVICE_TO_ASSEMBLY map replaces fuzzy niche_name match.
// Bug 5 fix: photo check is a soft photo_warning flag, not a hard-stop tier.
// Bug 6 fix: debug breakdown attached when ESTIMATOR_DEBUG=true.
// Stabilization: UNCERTAINTY_BUFFER excluded from MULTIPLY_HOURS drivers — UB
//   only controls contingency_pct via evaluateService(). Sending it as a labor
//   hours multiplier AND a contingency surcharge was double-counting uncertainty.

const PHOTO_MODULES = new Set(["PANEL_PHOTO", "WORK_AREA_PHOTOS"]);
const { getClassification } = require("./serviceClassification");

// ── Explicit service → assembly mapping (Bug 3) ───────────────────────────────
// Only services listed here get instant pricing from the V2 engine.
// No fuzzy fallback — missing entry returns placeholder and logs it.
const SERVICE_TO_ASSEMBLY = {
  CEILING_FAN_INSTALL:    "A004",
  LIGHT_FIXTURE_INSTALL:  "A003",
  RECESSED_LIGHTING:      "A001",
  DIMMER_SWITCH:          "A008",
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
 * Bug 1: risk_multiplier is always 1.0. Module option multipliers flow
 *   through getBasePrice() → calculateQuoteV2() only.
 * Bug 2: module processing and business-rule checks are scoped to the
 *   allowed modules set derived from service.modules_csv.
 * Bug 5: photo check returns photo_warning (soft) instead of needs_photos (hard-stop).
 */
function evaluateService(modulesById, service, answersByModule, photoCount) {
  const modules    = (service.modules_csv || "").split(",").map(m => m.trim()).filter(Boolean);
  const allowedSet = new Set(modules);
  const reasons    = [];

  let disqualified = service.tier === "site_visit_required";
  if (disqualified) reasons.push("Service type requires on-site assessment by default.");

  // ── Classification gate: MANUAL_QUOTE_ONLY ───────────────────────────────────
  const cls = getClassification(service.service_id);
  if (cls.status === "MANUAL_QUOTE_ONLY" && !disqualified) {
    disqualified = true;
    reasons.push(cls.blockerReason || "Service requires manual quote — instant pricing not available.");
  }

  // ── Bug 1: risk_multiplier fixed at 1.0 ──────────────────────────────────────
  // Module option multipliers are applied once in getBasePrice() → calculateQuoteV2().
  const risk_multiplier = 1.0;

  // ── Disqualify checks from module options (scoped to allowed modules) ─────────
  for (const mid of modules) {
    const mod = modulesById[mid];
    if (!mod) continue;
    const val = answersByModule[mid];
    if (!val) continue;
    const opt = (mod.options || []).find(o => o.value === val);
    if (!opt) continue;
    if (opt.disqualify) {
      disqualified = true;
      reasons.push(`${mid}: "${opt.label}" requires site visit.`);
    }
  }

  // ── Mandatory business rules (Bug 2: each gated on allowedSet membership) ─────
  const wall = allowedSet.has("WALL_TYPE") ? answersByModule["WALL_TYPE"] : null;
  if (wall === "brick") {
    disqualified = true;
    reasons.push("Brick/masonry walls require site assessment.");
  }

  const ceiling = allowedSet.has("CEILING_HEIGHT") ? answersByModule["CEILING_HEIGHT"] : null;
  if (ceiling === "gt20") {
    disqualified = true;
    reasons.push("Ceilings over 20 ft require site assessment.");
  }

  const age = allowedSet.has("HOME_AGE") ? answersByModule["HOME_AGE"] : null;
  if (age === "pre_1950") {
    const isPanel = /PANEL|REWIRE|CIRCUIT|EV|HOT_TUB|SUBPANEL|SURGE/.test(service.service_id);
    if (isPanel) {
      disqualified = true;
      reasons.push("Pre-1960 homes require site visit for panel/circuit work.");
    }
  }

  const panelSpace = allowedSet.has("PANEL_SPACE") ? answersByModule["PANEL_SPACE"] : null;
  if (panelSpace === "no" && service.service_id !== "SUBPANEL_INSTALL") {
    const needsCircuit = /EV_CHARGER|HOT_TUB_CIRCUIT|NEW_CIRCUIT/.test(service.service_id);
    if (needsCircuit) {
      disqualified = true;
      reasons.push("Full panel with no space requires subpanel — site visit needed.");
    }
  }

  // ── Bug 5: Photo gate → soft warning, not hard-stop ──────────────────────────
  const hasPhotoModule = modules.some(m => PHOTO_MODULES.has(m));
  const photo_warning  = hasPhotoModule && (photoCount || 0) === 0;
  if (photo_warning) {
    reasons.push("No photos provided — estimate may be less precise. A tech may follow up to confirm scope.");
  }

  // ── Contingency (UNCERTAINTY_BUFFER) — scoped to allowed modules ─────────────
  // _unsure counts any module in the allowed set that was answered "_unsure"
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
 * After Bug 1 fix risk_multiplier is always 1.0, but the parameter is kept
 * for backward compatibility with existing call sites.
 */
function computePrice(baseSubtotal, risk_multiplier, contingency_pct) {
  const subtotal = Math.round((baseSubtotal * risk_multiplier) / 5) * 5;
  const total    = Math.round((subtotal * (1 + contingency_pct)) / 5) * 5;
  return { subtotal, total };
}

/**
 * getBasePrice — V2 assembly pricing via explicit map.
 * Bug 2: answers filtered to allowedModulesCsv set before building driver options.
 * Bug 3: uses SERVICE_TO_ASSEMBLY; no fuzzy fallback.
 * Bug 6: attaches debug_breakdown when ESTIMATOR_DEBUG=true.
 *
 * @param {string} serviceId
 * @param {string} serviceName
 * @param {number} qty
 * @param {object} answersByModule      — { module_id: answer_value }
 * @param {object} modulesById          — module definitions keyed by module_id
 * @param {string} [allowedModulesCsv]  — comma-separated list of allowed module IDs
 */
async function getBasePrice(serviceId, serviceName, qty, answersByModule, modulesById, allowedModulesCsv) {
  // ── Classification enforcement ───────────────────────────────────────────────
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

  // ── Bug 2: filter answers to allowed modules ──────────────────────────────────
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

    // ── Bug 3: explicit assembly lookup — no fuzzy fallback ──────────────────────
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

    // ── Build MULTIPLY_HOURS driver options from filtered answers only ────────────
    // NOTE: UNCERTAINTY_BUFFER is intentionally excluded here.
    // UB controls contingency_pct only (evaluateService). Sending it as a
    // MULTIPLY_HOURS driver would double-count uncertainty in the final price.
    const selectedDriverOptions = [];
    const processedAnswers      = {};
    const mods = modulesById || {};
    for (const [mid, val] of Object.entries(filteredAnswers)) {
      if (mid === "UNCERTAINTY_BUFFER") continue;  // handled as contingency_pct only
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

    // ── Bug 6: debug breakdown ────────────────────────────────────────────────────
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

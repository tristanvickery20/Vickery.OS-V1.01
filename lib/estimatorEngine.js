// lib/estimatorEngine.js
// Pure evaluation + pricing logic for the instant estimator.
// No I/O — all data passed in.

const PHOTO_MODULES = new Set(["PANEL_PHOTO", "WORK_AREA_PHOTOS"]);

/**
 * evaluateService — compute tier_result, risk_multiplier, contingency, reasons
 * @param {object}  modulesById     — from getEstimatorConfig()
 * @param {object}  service         — service row from Estimator_ServiceMatrix
 * @param {object}  answersByModule — { module_id: answer_value }
 * @param {number}  photoCount      — how many photos the user provided
 * @returns {{ tier_result, reasons, risk_multiplier, contingency_pct, required_photos_missing }}
 */
function evaluateService(modulesById, service, answersByModule, photoCount) {
  const modules = (service.modules_csv || "").split(",").map(m => m.trim()).filter(Boolean);
  const reasons = [];
  let disqualified = service.tier === "site_visit_required";
  if (disqualified) reasons.push("Service type requires on-site assessment by default.");

  // ── Risk multiplier from answer options ────────────────────────────────────
  let risk_multiplier = 1.0;
  for (const mid of modules) {
    const mod = modulesById[mid];
    if (!mod) continue;
    const val = answersByModule[mid];
    if (!val) continue;
    const opt = (mod.options || []).find(o => o.value === val);
    if (!opt) continue;
    if (opt.multiplier && opt.multiplier !== 1.0) risk_multiplier *= opt.multiplier;
    if (opt.disqualify) { disqualified = true; reasons.push(`${mid}: "${opt.label}" requires site visit.`); }
  }

  // ── Mandatory business rules ───────────────────────────────────────────────
  const wall = answersByModule["WALL_TYPE"];
  if (wall === "brick") {
    disqualified = true;
    reasons.push("Brick/masonry walls require site assessment.");
  }

  const ceiling = answersByModule["CEILING_HEIGHT"];
  if (ceiling === "gt20") {
    disqualified = true;
    reasons.push("Ceilings over 20 ft require site assessment.");
  }

  const age = answersByModule["HOME_AGE"];
  if (age === "pre_1950") {
    const isPanel = /PANEL|REWIRE|CIRCUIT|EV|HOT_TUB|SUBPANEL|SURGE/.test(service.service_id);
    if (isPanel) { disqualified = true; reasons.push("Pre-1960 homes require site visit for panel/circuit work."); }
  }

  const panelSpace = answersByModule["PANEL_SPACE"];
  if (panelSpace === "no" && service.service_id !== "SUBPANEL_INSTALL") {
    const needsCircuit = /EV_CHARGER|HOT_TUB_CIRCUIT|NEW_CIRCUIT/.test(service.service_id);
    if (needsCircuit) { disqualified = true; reasons.push("Full panel with no space requires subpanel — site visit needed."); }
  }

  // ── Photo gate ────────────────────────────────────────────────────────────
  const hasPhotoModule = modules.some(m => PHOTO_MODULES.has(m));
  const required_photos_missing = hasPhotoModule && (photoCount || 0) === 0;

  // ── Contingency (UNCERTAINTY_BUFFER) ──────────────────────────────────────
  const hasUnsure = Object.values(answersByModule).some(v => v === "_unsure");
  const ub = answersByModule["UNCERTAINTY_BUFFER"];
  let contingency_pct = 0;
  if (hasUnsure || ub === "complex")   contingency_pct = 0.15;
  else if (ub === "moderate")          contingency_pct = 0.10;

  // Cap risk multiplier
  risk_multiplier = Math.min(2.0, Math.round(risk_multiplier * 1000) / 1000);

  const tier_result = disqualified        ? "needs_site_visit"
                    : required_photos_missing ? "needs_photos"
                    : service.tier === "instant" ? "instant"
                    : "instant_with_safeguards";

  return { tier_result, reasons, risk_multiplier, contingency_pct, required_photos_missing };
}

/**
 * computePrice — apply risk + contingency to a base price
 */
function computePrice(baseSubtotal, risk_multiplier, contingency_pct) {
  const subtotal = Math.round((baseSubtotal * risk_multiplier) / 5) * 5;
  const total    = Math.round((subtotal * (1 + contingency_pct)) / 5) * 5;
  return { subtotal, total };
}

/**
 * getBasePrice — best-effort V2 assembly lookup → calcPrice.
 * @param {string} serviceId
 * @param {string} serviceName
 * @param {number} qty
 * @param {object} answersByModule  — { module_id: answer_value } from instant-estimate form
 * @param {object} modulesById      — module definitions keyed by module_id
 * Returns { final_price, source, debug_drivers } where source is "v2" or "placeholder".
 */
async function getBasePrice(serviceId, serviceName, qty, answersByModule, modulesById) {
  try {
    const { getActiveConfig, isV2Mode } = require("./estimatorV2Config");
    if (!isV2Mode()) return { final_price: 0, source: "placeholder" };

    const config   = await getActiveConfig();
    const assemblies = config._v2?.assemblies || [];

    // 1. Exact match on assembly_id
    let assembly = assemblies.find(a => a.assembly_id === serviceId);

    // 2. Fuzzy match on niche_name using keywords from service name
    if (!assembly) {
      const kws = (serviceName || "").toLowerCase().split(/[\s/-]+/).filter(w => w.length > 3);
      assembly = assemblies.find(a => {
        const n = (a.niche_name || "").toLowerCase();
        return kws.some(kw => n.includes(kw));
      });
    }

    if (!assembly) return { final_price: 0, source: "placeholder" };

    // Convert module answers → selectedDriverOptions for V2 engine.
    // Each module option with a multiplier != 1.0 becomes a MULTIPLY_HOURS driver.
    const selectedDriverOptions = [];
    const mods = modulesById || {};
    for (const [mid, val] of Object.entries(answersByModule || {})) {
      if (!val || val === "_unsure") continue;
      const mod = mods[mid];
      if (!mod) continue;
      const opt = (mod.options || []).find(o => o.value === val);
      if (!opt || opt.multiplier == null) continue;
      const mult = Number(opt.multiplier);
      if (!isFinite(mult) || mult === 1.0) continue;
      selectedDriverOptions.push({
        effect_type:  "MULTIPLY_HOURS",
        effect_value: mult,
        _debug_source: `${mid}:${val}(×${mult})`,
      });
    }

    const { calculateQuoteV2 } = require("./quoteEngineV2");
    const result = calculateQuoteV2({
      assembly, qty: Math.max(1, qty || 1),
      selectedDriverOptions,
      v2Data:       config._v2,
      serviceAreas: config.serviceAreas || {},
      zip:          null,
    });

    const debug_drivers = selectedDriverOptions.map(d => d._debug_source);
    if (debug_drivers.length) {
      console.log(`[getBasePrice] ${serviceId} drivers applied: ${debug_drivers.join(", ")}`);
    }

    return { final_price: result.final_price || 0, source: "v2", debug_drivers };
  } catch (err) {
    console.error("[getBasePrice]", err.message);
    return { final_price: 0, source: "placeholder" };
  }
}

module.exports = { evaluateService, computePrice, getBasePrice };

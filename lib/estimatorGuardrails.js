// lib/estimatorGuardrails.js
// Launch-protection guardrails for the estimator engine.
//   Item 3 — service ID normalization map
//   Item 4 — UNCERTAINTY_BUFFER enum coercion
//   Item 6 — per-service sanity bands (price-floor / price-ceiling)

// ── Item 3: Service ID normalization ─────────────────────────────────────────
// Maps bad/alias IDs seen in UI snapshots → canonical service_id in the sheet.
const SERVICE_ID_ALIASES = {
  RECESSED_LIGHTING_INSTALL: "RECESSED_LIGHTING",
  GFCI_OUTLET_INSTALL:       "GFCI_OUTLET",
  CEILING_FAN:               "CEILING_FAN_INSTALL",
  LIGHT_FIXTURE:             "LIGHT_FIXTURE_INSTALL",
  OUTLET:                    "OUTLET_INSTALL",
  DIMMER:                    "DIMMER_SWITCH",
  SMART_DIMMER:              "DIMMER_SWITCH",
  OUTDOOR_LIGHT:             "OUTDOOR_LIGHTING",
  MOTION_LIGHT:              "MOTION_SECURITY_LIGHT",
};

/**
 * normalizeServiceId(serviceId)
 * Returns the canonical service_id, or the original if no alias exists.
 */
function normalizeServiceId(serviceId) {
  if (!serviceId) return serviceId;
  const norm = SERVICE_ID_ALIASES[serviceId];
  if (norm) {
    console.warn(`[guardrails] Normalized service_id: "${serviceId}" → "${norm}"`);
    return norm;
  }
  return serviceId;
}

// ── Item 4: UNCERTAINTY_BUFFER enum coercion ─────────────────────────────────
const VALID_UB_VALUES = new Set(["simple", "moderate", "complex"]);
const UB_DEFAULT = "simple";

/**
 * coerceAnswers(answers, serviceId)
 * Validates and coerces UNCERTAINTY_BUFFER to a known value.
 * Returns { coercedAnswers, fixes } where fixes is a string[] of what was changed.
 */
function coerceAnswers(answers, serviceId) {
  const fixes = [];
  const out   = { ...(answers || {}) };
  const key   = "UNCERTAINTY_BUFFER";

  if (key in out) {
    const val = out[key];
    if (!VALID_UB_VALUES.has(val)) {
      out[key] = UB_DEFAULT;
      const fix = `${key}: "${val}" → "${UB_DEFAULT}"`;
      fixes.push(fix);
      console.warn(`[guardrails] ${serviceId || "?"}: ${fix}`);
    }
  }

  return { coercedAnswers: out, fixes };
}

// ── Item 6: Per-service sanity bands ─────────────────────────────────────────
// [min_total, max_total] for common residential services.
// Totals outside this range are forced to review_required.
// Caps are intentionally generous to avoid false positives on multi-unit jobs.
const SANITY_BANDS = {
  CEILING_FAN_INSTALL:   { min: 100, max: 1800 },
  LIGHT_FIXTURE_INSTALL: { min: 100, max: 2200 },
  RECESSED_LIGHTING:     { min: 200, max: 6500 },
  OUTLET_INSTALL:        { min:  90, max: 1200 },
  GFCI_OUTLET:           { min:  80, max:  900 },
  DIMMER_SWITCH:         { min:  80, max:  950 },
  OUTDOOR_LIGHTING:      { min: 150, max: 3000 },
  MOTION_SECURITY_LIGHT: { min: 150, max: 1500 },
  SMOKE_CO_DETECTOR:     { min:  50, max:  700 },
  SURGE_PROTECTOR:       { min: 100, max:  900 },
};

/**
 * checkSanityBand(serviceId, total)
 * Returns { ok: true } or { ok: false, reason, band } if out of range.
 */
function checkSanityBand(serviceId, total) {
  const band = SANITY_BANDS[serviceId];
  if (!band) return { ok: true, band: null };
  if (total < band.min) {
    return {
      ok:     false,
      band,
      reason: `Computed total $${total} is below minimum expected ($${band.min}) for ${serviceId}.`,
    };
  }
  if (total > band.max) {
    return {
      ok:     false,
      band,
      reason: `Computed total $${total} exceeds maximum expected ($${band.max}) for ${serviceId}.`,
    };
  }
  return { ok: true, band };
}

module.exports = { normalizeServiceId, coerceAnswers, checkSanityBand, SANITY_BANDS, SERVICE_ID_ALIASES };

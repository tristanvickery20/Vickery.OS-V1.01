// lib/serviceClassification.js
// Single source of truth for estimator service production classifications.
//
// Stack caps recalibrated for the v2 module set (CIRCUIT_SCOPE fork, new modules).
// Worst-case multiplier products computed per service; caps applied where stacked
// product exceeds ~3.0× (above which labor estimate loses accuracy).
//
// Classification levels:
//   PRODUCTION_READY       — instant quote allowed, no flags
//   READY_WITH_REVIEW_FLAG — instant quote allowed, material-gap disclosure required
//   MANUAL_QUOTE_ONLY      — instant pricing blocked; site visit or manual quote required

const CLASSIFICATIONS = {
  // ── PRODUCTION_READY ────────────────────────────────────────────────────────
  // Simple swaps / standard services with low module stacking risk.
  SURGE_PROTECTOR: {
    status:          "PRODUCTION_READY",
    quoteAllowed:    true,
    reviewFlag:      false,
    stackCap:        null,   // HOME_AGE max = 1.45× — no stacking risk
    materialGap:     "low-risk",
    blockerReason:   null,
  },
  SMOKE_CO_DETECTOR: {
    status:          "PRODUCTION_READY",
    quoteAllowed:    true,
    reviewFlag:      false,
    stackCap:        2.5,    // SMOKE_TYPE(1.0) × CEILING_HEIGHT(1.55) × HOME_AGE(1.45) = 2.25 max
    materialGap:     "low-risk",
    blockerReason:   null,
  },

  // ── READY_WITH_REVIEW_FLAG ──────────────────────────────────────────────────
  // Materials not yet in assembly ($0) — disclosure required so customer understands
  // that materials will be added at actuals. Labor pricing is sound.
  CEILING_FAN_INSTALL: {
    status:          "READY_WITH_REVIEW_FLAG",
    quoteAllowed:    true,
    reviewFlag:      true,
    // FAN_EXISTING_WIRING(1.55) × CEILING_HEIGHT(1.55) × HOME_AGE(1.45) × EXISTING_BOX(1.2) = 4.19
    stackCap:        3.0,
    materialGap:     "understated",
    materialNote:    "Material allowance is $0 (placeholder data). Fan mounting hardware and wire (~$15–$40) will be confirmed at actuals.",
    blockerReason:   null,
  },
  LIGHT_FIXTURE_INSTALL: {
    status:          "READY_WITH_REVIEW_FLAG",
    quoteAllowed:    true,
    reviewFlag:      true,
    // EXISTING_BOX(1.2) × CEILING_HEIGHT(1.55) × FIXTURE_WEIGHT(1.15) × HOME_AGE(1.45) × CIRCUIT_SCOPE(1.5) = 4.77
    stackCap:        3.25,
    materialGap:     "understated",
    materialNote:    "Material allowance is $0 (placeholder data). Fixture mounting materials (~$20–$60) will be added at actuals.",
    blockerReason:   null,
  },
  RECESSED_LIGHTING: {
    status:          "READY_WITH_REVIEW_FLAG",
    quoteAllowed:    true,
    reviewFlag:      true,
    // Worst non-disqualified: ATTIC_ACCESS(1.9) × CEILING_HEIGHT(1.25) × CIRCUIT_SCOPE(1.5) × HOME_AGE(1.45) = 5.18
    // Compound rule disqualifies: no-attic + vaulted (reduces max to ~3.99 but still high)
    stackCap:        3.0,
    materialGap:     "understated",
    materialNote:    "Material allowance is $0 (placeholder data). Recessed cans + trim (~$20–$60 per light) will be added at actuals.",
    blockerReason:   null,
  },
  DIMMER_SWITCH: {
    status:          "READY_WITH_REVIEW_FLAG",
    quoteAllowed:    true,
    reviewFlag:      true,
    // CIRCUIT_SCOPE(1.5) × WALL_TYPE(1.2) × HOME_AGE(1.45) = 2.61 max
    stackCap:        3.0,   // safety ceiling
    materialGap:     "understated",
    materialNote:    "Material allowance is $0 (placeholder data). Dimmer switch (~$22–$45) will be added at actuals.",
    blockerReason:   null,
  },
  OUTLET_INSTALL: {
    status:          "READY_WITH_REVIEW_FLAG",
    quoteAllowed:    true,
    reviewFlag:      true,
    // CIRCUIT_SCOPE(1.5) × WALL_TYPE(1.2) × DISTANCE(1.45) × HOME_AGE(1.45) = 3.77
    stackCap:        3.25,
    materialGap:     "understated",
    materialNote:    "Material allowance is $0 (placeholder data). Outlet + box + wire (~$20–$40) will be added at actuals.",
    blockerReason:   null,
  },
  GFCI_OUTLET: {
    status:          "READY_WITH_REVIEW_FLAG",
    quoteAllowed:    true,
    reviewFlag:      true,
    // CIRCUIT_SCOPE(1.5) × WALL_TYPE(1.2) × HOME_AGE(1.45) = 2.61 max
    stackCap:        3.0,   // safety ceiling
    materialGap:     "understated",
    materialNote:    "Material allowance is $0 (placeholder data). GFCI device + box (~$25–$45) will be added at actuals.",
    blockerReason:   null,
  },
  OUTDOOR_LIGHTING: {
    status:          "READY_WITH_REVIEW_FLAG",
    quoteAllowed:    true,
    reviewFlag:      true,
    // OUTDOOR_MOUNTING(1.15) × OUTDOOR_CIRCUIT(1.45) × HOME_AGE(1.45) = 2.42 max
    stackCap:        3.0,
    materialGap:     "understated",
    materialNote:    "Material allowance is $0 (placeholder data). Outdoor fixture + weatherproof box (~$50–$150) will be added at actuals.",
    blockerReason:   null,
  },
  MOTION_SECURITY_LIGHT: {
    status:          "READY_WITH_REVIEW_FLAG",
    quoteAllowed:    true,
    reviewFlag:      true,
    // OUTDOOR_MOUNTING(1.15) × OUTDOOR_CIRCUIT(1.45) × HOME_AGE(1.45) = 2.42 max
    stackCap:        3.0,
    materialGap:     "understated",
    materialNote:    "Material allowance is $0 (placeholder data). Motion security fixture + weatherproof materials (~$35–$100) will be added at actuals.",
    blockerReason:   null,
  },

  // ── MANUAL_QUOTE_ONLY — residential high-cost / high-variability ─────────────
  EV_CHARGER: {
    status:          "MANUAL_QUOTE_ONLY",
    quoteAllowed:    false,
    reviewFlag:      false,
    stackCap:        null,
    materialGap:     "blocking",
    blockerReason:   "EV charger installation requires site visit: panel capacity check, conduit run distance, and charger model selection must be confirmed before pricing.",
  },
  HOT_TUB_CIRCUIT: {
    status:          "MANUAL_QUOTE_ONLY",
    quoteAllowed:    false,
    reviewFlag:      false,
    stackCap:        null,
    materialGap:     "blocking",
    blockerReason:   "Hot tub / spa circuit requires site visit: dedicated 240V run, GFCI disconnect location, and conduit path must be assessed on-site.",
  },
  PANEL_UPGRADE: {
    status:          "MANUAL_QUOTE_ONLY",
    quoteAllowed:    false,
    reviewFlag:      false,
    stackCap:        null,
    materialGap:     "blocking",
    blockerReason:   "Panel upgrade requires site visit: utility coordination, main breaker sizing, meter base, and grounding system must be assessed before pricing.",
  },
  SUBPANEL_INSTALL: {
    status:          "MANUAL_QUOTE_ONLY",
    quoteAllowed:    false,
    reviewFlag:      false,
    stackCap:        null,
    materialGap:     "blocking",
    blockerReason:   "Subpanel installation requires site visit: feeder cable run, panel location, and main panel capacity must be assessed on-site.",
  },

  // ── MANUAL_QUOTE_ONLY — commercial ──────────────────────────────────────────
  COMM_LIGHTING_RETROFIT: {
    status:          "MANUAL_QUOTE_ONLY",
    quoteAllowed:    false,
    reviewFlag:      false,
    stackCap:        null,
    materialGap:     "blocking",
    blockerReason:   "Commercial service — site visit required for fixture count, control scope, and permitting.",
  },
  BALLAST_REPLACE: {
    status:          "MANUAL_QUOTE_ONLY",
    quoteAllowed:    false,
    reviewFlag:      false,
    stackCap:        null,
    materialGap:     "blocking",
    blockerReason:   "Commercial service — site visit required to assess fixture type and ballast compatibility.",
  },
  EXIT_EMERGENCY_LIGHTS: {
    status:          "MANUAL_QUOTE_ONLY",
    quoteAllowed:    false,
    reviewFlag:      false,
    stackCap:        null,
    materialGap:     "blocking",
    blockerReason:   "Commercial service — site visit required for code compliance assessment and fixture count.",
  },

  // ── MANUAL_QUOTE_ONLY — site-visit by design ─────────────────────────────────
  TROUBLESHOOT_FLICKER: {
    status: "MANUAL_QUOTE_ONLY", quoteAllowed: false, reviewFlag: false, stackCap: null,
    materialGap: "n/a", blockerReason: "Diagnostic service — site visit required by design.",
  },
  REWIRE_WHOLE_HOUSE: {
    status: "MANUAL_QUOTE_ONLY", quoteAllowed: false, reviewFlag: false, stackCap: null,
    materialGap: "n/a", blockerReason: "Full rewire — site visit required by design.",
  },
  REWIRE_PARTIAL: {
    status: "MANUAL_QUOTE_ONLY", quoteAllowed: false, reviewFlag: false, stackCap: null,
    materialGap: "n/a", blockerReason: "Partial rewire — site visit required by design.",
  },
  REWIRE_COMMERCIAL: {
    status: "MANUAL_QUOTE_ONLY", quoteAllowed: false, reviewFlag: false, stackCap: null,
    materialGap: "n/a", blockerReason: "Commercial rewire — site visit required by design.",
  },
  FIRE_ALARM: {
    status: "MANUAL_QUOTE_ONLY", quoteAllowed: false, reviewFlag: false, stackCap: null,
    materialGap: "n/a", blockerReason: "Fire alarm — site visit and permit required by design.",
  },
  TRANSFORMER_INSTALL: {
    status: "MANUAL_QUOTE_ONLY", quoteAllowed: false, reviewFlag: false, stackCap: null,
    materialGap: "n/a", blockerReason: "Transformer installation — site visit required by design.",
  },
  GENERATOR_STANDBY: {
    status: "MANUAL_QUOTE_ONLY", quoteAllowed: false, reviewFlag: false, stackCap: null,
    materialGap: "n/a", blockerReason: "Standby generator — site visit required by design.",
  },
  GENERATOR_BACKUP: {
    status: "MANUAL_QUOTE_ONLY", quoteAllowed: false, reviewFlag: false, stackCap: null,
    materialGap: "n/a", blockerReason: "Backup generator — site visit required by design.",
  },
};

// ── Assembly-ID → Service-ID mapping ─────────────────────────────────────────
const ASSEMBLY_TO_SERVICE = {
  A001: "RECESSED_LIGHTING",
  A003: "LIGHT_FIXTURE_INSTALL",
  A004: "CEILING_FAN_INSTALL",
  A005: "OUTDOOR_LIGHTING",
  A006: "MOTION_SECURITY_LIGHT",
  A008: "DIMMER_SWITCH",
  A011: "OUTLET_INSTALL",
  A012: "GFCI_OUTLET",
  A019: "PANEL_UPGRADE",
  A020: "SUBPANEL_INSTALL",
  A024: "SURGE_PROTECTOR",
  A028: "EV_CHARGER",
  A029: "HOT_TUB_CIRCUIT",
  A030: "SMOKE_CO_DETECTOR",
  A034: "EXIT_EMERGENCY_LIGHTS",
  A036: "BALLAST_REPLACE",
  A037: "COMM_LIGHTING_RETROFIT",
  A015: "REWIRE_WHOLE_HOUSE",
  A016: "REWIRE_PARTIAL",
  A040: "REWIRE_COMMERCIAL",
  A053: "GENERATOR_BACKUP",
  A046: "TRANSFORMER_INSTALL",
};

// ── Public helpers ─────────────────────────────────────────────────────────────

/**
 * getClassification(serviceId) — returns classification entry or a safe default.
 * Accepts service_id (e.g. "CEILING_FAN_INSTALL") or assembly_id (e.g. "A004").
 */
function getClassification(serviceId) {
  if (CLASSIFICATIONS[serviceId]) return CLASSIFICATIONS[serviceId];
  const mapped = ASSEMBLY_TO_SERVICE[serviceId];
  if (mapped && CLASSIFICATIONS[mapped]) return { ...CLASSIFICATIONS[mapped], _resolvedFrom: mapped };
  return {
    status:        "UNCLASSIFIED",
    quoteAllowed:  true,
    reviewFlag:    false,
    stackCap:      null,
    materialGap:   "unknown",
    blockerReason: null,
  };
}

/**
 * resolveServiceId(jobTypeId) — converts assembly ID to service ID if known.
 */
function resolveServiceId(jobTypeId) {
  return ASSEMBLY_TO_SERVICE[jobTypeId] || jobTypeId;
}

/**
 * getAllClassifications() — returns full map for admin/debug use.
 */
function getAllClassifications() {
  const out = {};
  for (const [sid, cls] of Object.entries(CLASSIFICATIONS)) {
    out[sid] = { ...cls };
  }
  out._assemblyToService = { ...ASSEMBLY_TO_SERVICE };
  return out;
}

module.exports = { getClassification, resolveServiceId, getAllClassifications, CLASSIFICATIONS, ASSEMBLY_TO_SERVICE };

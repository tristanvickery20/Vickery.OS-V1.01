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
//
// Optional flags:
//   photoGate: true        — customer must upload the required photo before price is shown
//   photoGatePrompt: "…"  — message displayed in the questions step when photo is required
//   ballparkRange: { low, high, note } — shown to customer when service is MANUAL_QUOTE_ONLY

const CLASSIFICATIONS = {
  // ── PRODUCTION_READY ────────────────────────────────────────────────────────
  // Simple swaps / standard services with low module stacking risk.
  SURGE_PROTECTOR: {
    status:          "PRODUCTION_READY",
    quoteAllowed:    true,
    reviewFlag:      false,
    stackCap:        null,
    materialGap:     "low-risk",
    blockerReason:   null,
    photoGate:       true,
    photoGateModule: "PANEL_PHOTO",
    photoGatePrompt: "We need a photo of your electrical panel before we can show you an accurate price for whole-home surge protection. Open the panel door and snap a clear photo of the breakers.",
  },
  SMOKE_CO_DETECTOR: {
    status:          "PRODUCTION_READY",
    quoteAllowed:    true,
    reviewFlag:      false,
    stackCap:        2.5,
    materialGap:     "low-risk",
    blockerReason:   null,
  },
  GFCI_OUTLET: {
    status:          "PRODUCTION_READY",
    quoteAllowed:    true,
    reviewFlag:      false,
    stackCap:        3.0,
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
    materialNote:    "Material estimate included in price. Fan hardware and wire will be verified on-site; final invoice reflects actual quantities.",
    blockerReason:   null,
  },
  LIGHT_FIXTURE_INSTALL: {
    status:          "READY_WITH_REVIEW_FLAG",
    quoteAllowed:    true,
    reviewFlag:      true,
    // EXISTING_BOX(1.2) × CEILING_HEIGHT(1.55) × FIXTURE_WEIGHT(1.15) × HOME_AGE(1.45) × CIRCUIT_SCOPE(1.5) = 4.77
    stackCap:        3.25,
    materialGap:     "understated",
    materialNote:    "Material estimate included in price. Fixture and mounting hardware verified on-site; final invoice reflects actual quantities.",
    blockerReason:   null,
  },
  RECESSED_LIGHTING: {
    status:          "READY_WITH_REVIEW_FLAG",
    quoteAllowed:    true,
    reviewFlag:      true,
    // Worst non-disqualified: ATTIC_ACCESS(1.9) × CEILING_HEIGHT(1.25) × CIRCUIT_SCOPE(1.5) × HOME_AGE(1.45) = 5.18
    stackCap:        3.0,
    materialGap:     "understated",
    materialNote:    "Material estimate included in price. Can count and trim selection verified on-site; final invoice reflects actual quantities.",
    blockerReason:   null,
  },
  DIMMER_SWITCH: {
    status:          "READY_WITH_REVIEW_FLAG",
    quoteAllowed:    true,
    reviewFlag:      true,
    // CIRCUIT_SCOPE(1.5) × WALL_TYPE(1.2) × HOME_AGE(1.45) = 2.61 max
    stackCap:        3.0,
    materialGap:     "understated",
    materialNote:    "Material estimate included in price. Dimmer switch selection confirmed on-site; final invoice reflects actual quantities.",
    blockerReason:   null,
  },
  OUTLET_INSTALL: {
    status:          "READY_WITH_REVIEW_FLAG",
    quoteAllowed:    true,
    reviewFlag:      true,
    // CIRCUIT_SCOPE(1.5) × WALL_TYPE(1.2) × DISTANCE(1.45) × HOME_AGE(1.45) = 3.77
    stackCap:        3.25,
    materialGap:     "understated",
    materialNote:    "Material estimate included in price. Outlet, box, and wire verified on-site; final invoice reflects actual quantities.",
    blockerReason:   null,
  },
  OUTDOOR_LIGHTING: {
    status:          "READY_WITH_REVIEW_FLAG",
    quoteAllowed:    true,
    reviewFlag:      true,
    // OUTDOOR_MOUNTING(1.15) × OUTDOOR_CIRCUIT(1.45) × HOME_AGE(1.45) = 2.42 max
    stackCap:        3.0,
    materialGap:     "understated",
    materialNote:    "Material estimate included in price. Outdoor fixture and weatherproof box verified on-site; final invoice reflects actual quantities.",
    blockerReason:   null,
    photoGate:       true,
    photoGateModule: "WORK_AREA_PHOTOS",
    photoGatePrompt: "A photo of the outdoor installation area is required before we can calculate your price. Show us where the fixture will mount and any existing wiring or outlet nearby.",
  },
  MOTION_SECURITY_LIGHT: {
    status:          "READY_WITH_REVIEW_FLAG",
    quoteAllowed:    true,
    reviewFlag:      true,
    // OUTDOOR_MOUNTING(1.15) × OUTDOOR_CIRCUIT(1.45) × HOME_AGE(1.45) = 2.42 max
    stackCap:        3.0,
    materialGap:     "understated",
    materialNote:    "Material estimate included in price. Security fixture and weatherproof materials verified on-site; final invoice reflects actual quantities.",
    blockerReason:   null,
  },

  // ── READY_WITH_REVIEW_FLAG — EV Charger (photo gate required) ───────────────
  // Moved from MANUAL_QUOTE_ONLY — with panel + location photos we can give a firm
  // labor estimate. Materials (wire gauge, conduit) verified on-site.
  EV_CHARGER: {
    status:          "READY_WITH_REVIEW_FLAG",
    quoteAllowed:    true,
    reviewFlag:      true,
    // PANEL_SPACE(1.1) × DISTANCE(1.45) × CONDUIT(1.45) × HOME_AGE(1.45) = 3.35 max
    stackCap:        3.0,
    materialGap:     "understated",
    materialNote:    "Labor estimate included. Wire gauge, conduit run, and charger hardware confirmed on-site; final invoice reflects actual quantities.",
    blockerReason:   null,
    photoGate:       true,
    photoGateModules: ["PANEL_PHOTO", "WORK_AREA_PHOTOS"],
    photoGatePrompt: "We need two photos before we can price your EV charger installation: your electrical panel and the charger location.",
    photoGatePrompts: {
      PANEL_PHOTO:      "Open the panel door so the breakers are visible. This lets us verify available capacity and breaker space.",
      WORK_AREA_PHOTOS: "Show us where the charger will mount — the garage wall, existing outlet, or planned conduit path.",
    },
  },

  // ── MANUAL_QUOTE_ONLY — residential high-cost / high-variability ─────────────
  HOT_TUB_CIRCUIT: {
    status:          "MANUAL_QUOTE_ONLY",
    quoteAllowed:    false,
    reviewFlag:      false,
    stackCap:        null,
    materialGap:     "blocking",
    blockerReason:   "Hot tub / spa circuit requires site visit: dedicated 240V run, GFCI disconnect location, and conduit path must be assessed on-site.",
    ballparkRange:   { low: 900, high: 2500, note: "Depends on distance from panel, conduit routing, and disconnect location." },
  },
  PANEL_UPGRADE: {
    status:          "MANUAL_QUOTE_ONLY",
    quoteAllowed:    false,
    reviewFlag:      false,
    stackCap:        null,
    materialGap:     "blocking",
    blockerReason:   "Panel upgrade requires site visit: utility coordination, main breaker sizing, meter base, and grounding system must be assessed before pricing.",
    ballparkRange:   { low: 1800, high: 4500, note: "Depends on service size (100A vs 200A), meter base condition, and utility coordination required." },
  },
  SUBPANEL_INSTALL: {
    status:          "MANUAL_QUOTE_ONLY",
    quoteAllowed:    false,
    reviewFlag:      false,
    stackCap:        null,
    materialGap:     "blocking",
    blockerReason:   "Subpanel installation requires site visit: feeder cable run, panel location, and main panel capacity must be assessed on-site.",
    ballparkRange:   { low: 1200, high: 3500, note: "Depends on feeder distance, subpanel size, and whether the main panel has capacity." },
  },

  // ── MANUAL_QUOTE_ONLY — commercial ──────────────────────────────────────────
  COMM_LIGHTING_RETROFIT: {
    status:          "MANUAL_QUOTE_ONLY",
    quoteAllowed:    false,
    reviewFlag:      false,
    stackCap:        null,
    materialGap:     "blocking",
    blockerReason:   "Commercial service — site visit required for fixture count, control scope, and permitting.",
    ballparkRange:   { low: 800, high: 8000, note: "Depends on fixture count, building size, and control requirements." },
  },
  BALLAST_REPLACE: {
    status:          "MANUAL_QUOTE_ONLY",
    quoteAllowed:    false,
    reviewFlag:      false,
    stackCap:        null,
    materialGap:     "blocking",
    blockerReason:   "Commercial service — site visit required to assess fixture type and ballast compatibility.",
    ballparkRange:   { low: 150, high: 600, note: "Per fixture; depends on ballast type and quantity." },
  },
  EXIT_EMERGENCY_LIGHTS: {
    status:          "MANUAL_QUOTE_ONLY",
    quoteAllowed:    false,
    reviewFlag:      false,
    stackCap:        null,
    materialGap:     "blocking",
    blockerReason:   "Commercial service — site visit required for code compliance assessment and fixture count.",
    ballparkRange:   { low: 300, high: 2500, note: "Depends on fixture count and code compliance requirements." },
  },

  // ── MANUAL_QUOTE_ONLY — site-visit by design ─────────────────────────────────
  TROUBLESHOOT_FLICKER: {
    status: "MANUAL_QUOTE_ONLY", quoteAllowed: false, reviewFlag: false, stackCap: null,
    materialGap: "n/a", blockerReason: "Diagnostic service — site visit required by design.",
    ballparkRange: { low: 95, high: 195, note: "Diagnostic visit fee covers the assessment. Repair cost is quoted separately once the cause is identified." },
  },
  REWIRE_WHOLE_HOUSE: {
    status: "MANUAL_QUOTE_ONLY", quoteAllowed: false, reviewFlag: false, stackCap: null,
    materialGap: "n/a", blockerReason: "Full rewire — site visit required by design.",
    ballparkRange: { low: 8000, high: 25000, note: "Depends on home size, current wiring condition, wall material, and access availability." },
  },
  REWIRE_PARTIAL: {
    status: "MANUAL_QUOTE_ONLY", quoteAllowed: false, reviewFlag: false, stackCap: null,
    materialGap: "n/a", blockerReason: "Partial rewire — site visit required by design.",
    ballparkRange: { low: 2500, high: 8000, note: "Depends on number of rooms, wall access, and current wiring condition." },
  },
  REWIRE_COMMERCIAL: {
    status: "MANUAL_QUOTE_ONLY", quoteAllowed: false, reviewFlag: false, stackCap: null,
    materialGap: "n/a", blockerReason: "Commercial rewire — site visit required by design.",
    ballparkRange: { low: 5000, high: 40000, note: "Highly variable by building size, scope, and permitting requirements." },
  },
  FIRE_ALARM: {
    status: "MANUAL_QUOTE_ONLY", quoteAllowed: false, reviewFlag: false, stackCap: null,
    materialGap: "n/a", blockerReason: "Fire alarm — site visit and permit required by design.",
    ballparkRange: { low: 1500, high: 8000, note: "Depends on building size, zone count, and panel type." },
  },
  TRANSFORMER_INSTALL: {
    status: "MANUAL_QUOTE_ONLY", quoteAllowed: false, reviewFlag: false, stackCap: null,
    materialGap: "n/a", blockerReason: "Transformer installation — site visit required by design.",
    ballparkRange: { low: 2000, high: 12000, note: "Depends on KVA rating and installation complexity." },
  },
  GENERATOR_STANDBY: {
    status: "MANUAL_QUOTE_ONLY", quoteAllowed: false, reviewFlag: false, stackCap: null,
    materialGap: "n/a", blockerReason: "Standby generator — site visit required by design.",
    ballparkRange: { low: 4500, high: 15000, note: "Depends on generator size, transfer switch type, and gas line hookup." },
  },
  GENERATOR_BACKUP: {
    status: "MANUAL_QUOTE_ONLY", quoteAllowed: false, reviewFlag: false, stackCap: null,
    materialGap: "n/a", blockerReason: "Backup generator — site visit required by design.",
    ballparkRange: { low: 800, high: 2500, note: "Transfer switch installation; depends on number of circuits and panel location." },
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
  A014: "SMART_SWITCH",
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

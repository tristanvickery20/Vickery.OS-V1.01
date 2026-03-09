// lib/serviceClassification.js
// Single source of truth for estimator service production classifications.
//
// Sources:
//   - estimator_service_classification.md (classifications)
//   - estimator_scenario_validation_report.md (stack cap values from STACK_EXPLODES findings)
//   - estimator_material_readiness_report.md (material gap status)
//
// Classification levels:
//   PRODUCTION_READY       — instant quote allowed, no flags required
//   READY_WITH_REVIEW_FLAG — instant quote allowed, material-gap disclosure required in response
//   MANUAL_QUOTE_ONLY      — instant pricing blocked, manual-review response returned
//
// Stack caps (combined MULTIPLY_HOURS multiplier ceiling):
//   Applied only to services where scenario testing found stacked explosion (>5× baseline).
//   Configurable per-service; null = no cap.
//   Default safe range per QC findings: 3.5–3.75.

const CLASSIFICATIONS = {
  // ── PRODUCTION_READY ────────────────────────────────────────────────────────
  CEILING_FAN_INSTALL: {
    status:          "PRODUCTION_READY",
    quoteAllowed:    true,
    reviewFlag:      false,
    stackCap:        null,
    materialGap:     "low-risk",
    blockerReason:   null,
  },
  SURGE_PROTECTOR: {
    status:          "PRODUCTION_READY",
    quoteAllowed:    true,
    reviewFlag:      false,
    stackCap:        null,
    materialGap:     "low-risk",
    blockerReason:   null,
  },
  SMOKE_CO_DETECTOR: {
    status:          "PRODUCTION_READY",
    quoteAllowed:    true,
    reviewFlag:      false,
    stackCap:        null,
    materialGap:     "low-risk",
    blockerReason:   null,
  },

  // ── READY_WITH_REVIEW_FLAG ──────────────────────────────────────────────────
  // All materials $0 — labor-only pricing. Disclosure required.
  // Stack caps applied to services where QC found >5× stacked ratio.
  LIGHT_FIXTURE_INSTALL: {
    status:          "READY_WITH_REVIEW_FLAG",
    quoteAllowed:    true,
    reviewFlag:      true,
    stackCap:        3.75,   // QC found 6.3× uncapped — capped at 3.75×
    materialGap:     "understated",
    materialNote:    "Material allowance is $0 (placeholder data). Materials will be confirmed and added separately at actuals. Typical gap: $40–$120 per fixture.",
    blockerReason:   null,
  },
  RECESSED_LIGHTING: {
    status:          "READY_WITH_REVIEW_FLAG",
    quoteAllowed:    true,
    reviewFlag:      true,
    stackCap:        3.5,    // QC found 7.05× uncapped — capped at 3.5×
    materialGap:     "understated",
    materialNote:    "Material allowance is $0 (placeholder data). Materials will be confirmed and added separately at actuals. Typical gap: $20–$60 per light.",
    blockerReason:   null,
  },
  DIMMER_SWITCH: {
    status:          "READY_WITH_REVIEW_FLAG",
    quoteAllowed:    true,
    reviewFlag:      true,
    stackCap:        null,   // QC found 2.03× — no cap needed
    materialGap:     "understated",
    materialNote:    "Material allowance is $0 (placeholder data). Dimmer switch cost (~$22–$45) will be added at actuals.",
    blockerReason:   null,
  },
  OUTLET_INSTALL: {
    status:          "READY_WITH_REVIEW_FLAG",
    quoteAllowed:    true,
    reviewFlag:      true,
    stackCap:        null,   // QC found 2.34× — no cap needed
    materialGap:     "understated",
    materialNote:    "Material allowance is $0 (placeholder data). Outlet + box + wire materials (~$20–$35) will be added at actuals.",
    blockerReason:   null,
  },
  GFCI_OUTLET: {
    status:          "READY_WITH_REVIEW_FLAG",
    quoteAllowed:    true,
    reviewFlag:      true,
    stackCap:        null,   // QC found 2.46× — no cap needed
    materialGap:     "understated",
    materialNote:    "Material allowance is $0 (placeholder data). GFCI device + box (~$25–$45) will be added at actuals.",
    blockerReason:   null,
  },
  OUTDOOR_LIGHTING: {
    status:          "READY_WITH_REVIEW_FLAG",
    quoteAllowed:    true,
    reviewFlag:      true,
    stackCap:        3.75,   // QC found 5.45× uncapped — capped at 3.75×
    materialGap:     "understated",
    materialNote:    "Material allowance is $0 (placeholder data). Outdoor fixture + weatherproof materials (~$50–$150) will be added at actuals.",
    blockerReason:   null,
  },
  MOTION_SECURITY_LIGHT: {
    status:          "READY_WITH_REVIEW_FLAG",
    quoteAllowed:    true,
    reviewFlag:      true,
    stackCap:        3.75,   // QC found 6.59× uncapped — capped at 3.75×
    materialGap:     "understated",
    materialNote:    "Material allowance is $0 (placeholder data). Motion light fixture + weatherproof materials (~$35–$100) will be added at actuals.",
    blockerReason:   null,
  },

  // ── MANUAL_QUOTE_ONLY — residential ─────────────────────────────────────────
  EV_CHARGER: {
    status:          "MANUAL_QUOTE_ONLY",
    quoteAllowed:    false,
    reviewFlag:      false,
    stackCap:        null,
    materialGap:     "blocking",
    blockerReason:   "Instant pricing blocked: ~$230 in sell price understated from missing WIR-011 (10/2 cable) + DEV-008 (EV receptacle). Manual quote required.",
  },
  HOT_TUB_CIRCUIT: {
    status:          "MANUAL_QUOTE_ONLY",
    quoteAllowed:    false,
    reviewFlag:      false,
    stackCap:        null,
    materialGap:     "blocking",
    blockerReason:   "Instant pricing blocked: ~$200 in missing materials (WIR-011, PNL-007). Partial material data present but unreliable at scale. Manual quote required.",
  },
  PANEL_UPGRADE: {
    status:          "MANUAL_QUOTE_ONLY",
    quoteAllowed:    false,
    reviewFlag:      false,
    stackCap:        null,
    materialGap:     "blocking",
    blockerReason:   "Instant pricing blocked: panel materials (PNL-005, PNL-006, WIR-009) have ~$350+ gap at retail sell price. Labor-only quote would lose money. Manual quote required.",
  },
  SUBPANEL_INSTALL: {
    status:          "MANUAL_QUOTE_ONLY",
    quoteAllowed:    false,
    reviewFlag:      false,
    stackCap:        null,
    materialGap:     "blocking",
    blockerReason:   "Instant pricing blocked: subpanel + feeder cable (WIR-012) materials missing. Manual quote required.",
  },

  // ── MANUAL_QUOTE_ONLY — commercial ──────────────────────────────────────────
  COMM_LIGHTING_RETROFIT: {
    status:          "MANUAL_QUOTE_ONLY",
    quoteAllowed:    false,
    reviewFlag:      false,
    stackCap:        null,
    materialGap:     "blocking",
    blockerReason:   "Commercial service: all materials $0 + site-visit required for scope + permitting.",
  },
  BALLAST_REPLACE: {
    status:          "MANUAL_QUOTE_ONLY",
    quoteAllowed:    false,
    reviewFlag:      false,
    stackCap:        null,
    materialGap:     "blocking",
    blockerReason:   "Commercial service: all materials $0 + site-visit required for scope.",
  },
  EXIT_EMERGENCY_LIGHTS: {
    status:          "MANUAL_QUOTE_ONLY",
    quoteAllowed:    false,
    reviewFlag:      false,
    stackCap:        null,
    materialGap:     "blocking",
    blockerReason:   "Commercial service: all materials $0 + HIGH risk class + site-visit required.",
  },

  // ── MANUAL_QUOTE_ONLY — site-visit by design ────────────────────────────────
  TROUBLESHOOT_FLICKER: {
    status: "MANUAL_QUOTE_ONLY", quoteAllowed: false, reviewFlag: false, stackCap: null,
    materialGap: "n/a", blockerReason: "By design — tier=site_visit_required.",
  },
  REWIRE_WHOLE_HOUSE: {
    status: "MANUAL_QUOTE_ONLY", quoteAllowed: false, reviewFlag: false, stackCap: null,
    materialGap: "n/a", blockerReason: "By design — tier=site_visit_required.",
  },
  REWIRE_PARTIAL: {
    status: "MANUAL_QUOTE_ONLY", quoteAllowed: false, reviewFlag: false, stackCap: null,
    materialGap: "n/a", blockerReason: "By design — tier=site_visit_required.",
  },
  REWIRE_COMMERCIAL: {
    status: "MANUAL_QUOTE_ONLY", quoteAllowed: false, reviewFlag: false, stackCap: null,
    materialGap: "n/a", blockerReason: "By design — tier=site_visit_required.",
  },
  FIRE_ALARM: {
    status: "MANUAL_QUOTE_ONLY", quoteAllowed: false, reviewFlag: false, stackCap: null,
    materialGap: "n/a", blockerReason: "By design — tier=site_visit_required.",
  },
  TRANSFORMER_INSTALL: {
    status: "MANUAL_QUOTE_ONLY", quoteAllowed: false, reviewFlag: false, stackCap: null,
    materialGap: "n/a", blockerReason: "By design — tier=site_visit_required.",
  },
  GENERATOR_STANDBY: {
    status: "MANUAL_QUOTE_ONLY", quoteAllowed: false, reviewFlag: false, stackCap: null,
    materialGap: "n/a", blockerReason: "By design — tier=site_visit_required.",
  },
  GENERATOR_BACKUP: {
    status: "MANUAL_QUOTE_ONLY", quoteAllowed: false, reviewFlag: false, stackCap: null,
    materialGap: "n/a", blockerReason: "By design — tier=site_visit_required.",
  },
};

// ── Assembly-ID → Service-ID mapping ─────────────────────────────────────────
// Used in the /quote path where requests arrive with V2 assembly IDs (A001-A056).
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

// ── Public helpers ────────────────────────────────────────────────────────────

/**
 * getClassification(serviceId) — returns classification entry or a safe default.
 * @param {string} serviceId — service_id (e.g. "CEILING_FAN_INSTALL") or assembly_id (e.g. "A004")
 */
function getClassification(serviceId) {
  // Direct lookup
  if (CLASSIFICATIONS[serviceId]) return CLASSIFICATIONS[serviceId];
  // Assembly-id lookup
  const mapped = ASSEMBLY_TO_SERVICE[serviceId];
  if (mapped && CLASSIFICATIONS[mapped]) return { ...CLASSIFICATIONS[mapped], _resolvedFrom: mapped };
  // Unknown — not classified, allow quote with no flags (raw V2 assembly, no estimator service entry)
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
 * getAllClassifications() — returns full classification map for admin/debug output.
 */
function getAllClassifications() {
  const out = {};
  for (const [sid, cls] of Object.entries(CLASSIFICATIONS)) {
    out[sid] = { ...cls };
  }
  // Also expose the assembly map
  out._assemblyToService = { ...ASSEMBLY_TO_SERVICE };
  return out;
}

module.exports = { getClassification, resolveServiceId, getAllClassifications, CLASSIFICATIONS, ASSEMBLY_TO_SERVICE };

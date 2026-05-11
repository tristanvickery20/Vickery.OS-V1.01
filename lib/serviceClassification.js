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
  GFCI_OUTLET: {
    status:          "READY_WITH_REVIEW_FLAG",
    quoteAllowed:    true,
    reviewFlag:      true,
    stackCap:        3.0,
    materialGap:     "understated",
    materialNote:    "Material estimate included in price. GFCI device and wire confirmed on-site; final invoice reflects actual quantities.",
    blockerReason:   null,
    photoGate:        true,
    photoGateModules: ["OUTLET_PHOTO"],
    photoGatePrompt:  "A close-up photo of the existing outlet — or the location where the GFCI will go — helps us confirm box condition and wiring before we arrive.",
    photoGatePrompts: {
      OUTLET_PHOTO: "Photograph the outlet or wall location where the GFCI will be installed. A close-up showing the outlet face or box opening, plus a wider shot showing the surrounding wall, gives us everything we need.",
    },
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
    photoGate:        true,
    photoGateModules: ["CEILING_PHOTO"],
    photoGatePrompt:  "Please share a photo of the ceiling location where the fan will mount — existing light fixture, junction box (if any), and the ceiling height are all helpful.",
    photoGatePrompts: {
      CEILING_PHOTO: "Tilt your phone up and photograph the ceiling where the fan will go. If there's already a fixture or outlet box there, center it in the frame. A clear view of the ceiling height helps us confirm the right mount kit.",
    },
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
    photoGate:        true,
    photoGateModules: ["CEILING_PHOTO"],
    photoGatePrompt:  "Please photograph the ceiling mounting location — the existing box or ceiling area where the new fixture will go.",
    photoGatePrompts: {
      CEILING_PHOTO: "Tilt your phone up and frame the current ceiling box or mounting spot for the new fixture. If you're replacing an existing light, center it in the shot.",
    },
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
    photoGate:        true,
    photoGateModules: ["CEILING_PHOTO"],
    photoGatePrompt:  "A photo of the ceiling area where you'd like recessed lights installed helps us assess attic access and plan the layout.",
    photoGatePrompts: {
      CEILING_PHOTO: "Photograph the ceiling area where you'd like the recessed lights. Step back to show several feet of ceiling on all sides. If you have attic access above, a second shot of the attic hatch is a big help.",
    },
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
    photoGate:        true,
    photoGateModules: ["SWITCH_PHOTO"],
    photoGatePrompt:  "A photo of the existing switch (cover plate and surrounding wall) helps us confirm box size, wiring, and dimmer compatibility before we arrive.",
    photoGatePrompts: {
      SWITCH_PHOTO: "Step back 2–3 feet and photograph the switch cover plate and the wall around it. If you can safely remove the cover plate to show the wiring inside, that's a big help for confirming neutral wire availability.",
    },
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
    photoGate:        true,
    photoGateModules: ["OUTLET_PHOTO"],
    photoGatePrompt:  "A photo of the target wall area — with the spot marked and any nearby existing outlets in frame — helps us confirm the circuit run before we arrive.",
    photoGatePrompts: {
      OUTLET_PHOTO: "Stand back 3–4 feet and photograph the wall where the new outlet will go. Mark the exact spot with a piece of tape in an X, and make sure any nearby existing outlets are visible in the frame.",
    },
  },
  SMART_SWITCH: {
    status:          "READY_WITH_REVIEW_FLAG",
    quoteAllowed:    true,
    reviewFlag:      true,
    stackCap:        3.0,
    materialGap:     "understated",
    materialNote:    "Material estimate included in price. Smart switch compatibility verified on-site; final invoice reflects actual quantities.",
    blockerReason:   null,
    photoGate:        true,
    photoGateModules: ["SWITCH_PHOTO"],
    photoGatePrompt:  "A photo of the existing switch — ideally with the cover plate removed — tells us whether a neutral wire is present, which is required for most smart switches.",
    photoGatePrompts: {
      SWITCH_PHOTO: "Step back and photograph the switch cover plate and surrounding wall. If safe, remove the cover plate to show the wiring inside — the presence of a neutral (white) wire is the most important thing to confirm for smart switch compatibility.",
    },
  },
  LED_RETROFIT: {
    status:          "READY_WITH_REVIEW_FLAG",
    quoteAllowed:    true,
    reviewFlag:      true,
    stackCap:        2.5,
    materialGap:     "understated",
    materialNote:    "Material estimate included in price. Bulb/fixture count and type verified on-site; final invoice reflects actual quantities.",
    blockerReason:   null,
    photoGate:        true,
    photoGateModules: ["CEILING_PHOTO"],
    photoGatePrompt:  "A quick photo of one of the existing fixtures helps us confirm the fixture type and order the right retrofit kit before we arrive.",
    photoGatePrompts: {
      CEILING_PHOTO: "Photograph one of the existing fixtures you'd like retrofitted — show the full fixture face and, if possible, the fixture housing/can from below. This helps us confirm the retrofit kit compatibility.",
    },
  },
  DEDICATED_CIRCUIT: {
    status:          "READY_WITH_REVIEW_FLAG",
    quoteAllowed:    true,
    reviewFlag:      true,
    stackCap:        3.0,
    materialGap:     "understated",
    materialNote:    "Material estimate included in price. Wire gauge and run length verified on-site; final invoice reflects actual quantities.",
    blockerReason:   null,
  },

  // ── READY_WITH_REVIEW_FLAG — EV Charger (photo gate required) ───────────────
  // With panel + location photos we can give a firm labor estimate.
  // Materials (wire gauge, conduit) verified on-site.
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
    photoGateModules: ["PANEL_PHOTO", "WORK_AREA_PHOTO"],
    photoGatePrompt: "We need two photos before we can price your EV charger installation: your electrical panel and the charger location.",
    photoGatePrompts: {
      PANEL_PHOTO:     "Open the panel door so the breakers are visible. This lets us verify available capacity and breaker space.",
      WORK_AREA_PHOTO: "Show us where the charger will mount — the garage wall, existing outlet, or planned conduit path.",
    },
  },

  // ── MANUAL_QUOTE_ONLY — panel work ───────────────────────────────────────────
  PANEL_UPGRADE: {
    status:          "MANUAL_QUOTE_ONLY",
    quoteAllowed:    false,
    reviewFlag:      false,
    stackCap:        null,
    materialGap:     "blocking",
    blockerReason:   "Panel upgrade requires site visit: utility coordination, main breaker sizing, meter base, and grounding system must be assessed before pricing.",
    ballparkRange:   { low: 1800, high: 4500, note: "Depends on service size (100A vs 200A), meter base condition, and utility coordination required." },
    photoGate:        true,
    photoGateModules: ["PANEL_PHOTO"],
    photoGatePrompt:  "Please photograph your current electrical panel with the door open — breaker labels, main breaker amperage, and panel brand all visible. This helps us prepare your upgrade estimate before the visit.",
    photoGatePrompts: {
      PANEL_PHOTO: "Open the panel door and photograph all breakers, the main breaker amperage label, and the panel brand. This lets us spec your upgrade and prepare materials in advance.",
    },
  },
  SUBPANEL_INSTALL: {
    status:          "MANUAL_QUOTE_ONLY",
    quoteAllowed:    false,
    reviewFlag:      false,
    stackCap:        null,
    materialGap:     "blocking",
    blockerReason:   "Subpanel installation requires site visit: feeder cable run, panel location, and main panel capacity must be assessed on-site.",
    ballparkRange:   { low: 1200, high: 3500, note: "Depends on feeder distance, subpanel size, and whether the main panel has capacity." },
    photoGate:        true,
    photoGateModules: ["PANEL_PHOTO"],
    photoGatePrompt:  "Please photograph your main electrical panel with the door open so we can confirm available capacity and plan the feeder for your new subpanel.",
    photoGatePrompts: {
      PANEL_PHOTO: "Open the main panel door so all breakers and the main breaker amperage are visible. We need to confirm remaining capacity before sizing your subpanel feeder.",
    },
  },
  FUSE_BOX_CONVERSION: {
    status:          "MANUAL_QUOTE_ONLY",
    quoteAllowed:    false,
    reviewFlag:      false,
    stackCap:        null,
    materialGap:     "blocking",
    blockerReason:   "Fuse-box-to-breaker conversion requires site visit: service size, wiring condition, and utility coordination must be assessed on-site.",
    ballparkRange:   { low: 2000, high: 5500, note: "Depends on service size and condition of existing wiring." },
    photoGate:        true,
    photoGateModules: ["PANEL_PHOTO"],
    photoGatePrompt:  "Please photograph your existing fuse box with the cover removed so all fuses and wiring are visible. This helps us assess the scope of work before your appointment.",
    photoGatePrompts: {
      PANEL_PHOTO: "Remove the fuse box cover and photograph the fuses and any visible wiring. This lets us assess service size and wiring condition before we arrive.",
    },
  },
  BREAKER_TRIPPING: {
    status:          "MANUAL_QUOTE_ONLY",
    quoteAllowed:    false,
    reviewFlag:      false,
    stackCap:        null,
    materialGap:     "blocking",
    blockerReason:   "Breaker tripping diagnosis requires site visit: root cause (overload, short, failing breaker) must be identified before any pricing.",
    ballparkRange:   { low: 150, high: 1200, note: "Diagnostic visit included; repair cost depends on root cause." },
    photoGate:        true,
    photoGateModules: ["PANEL_PHOTO"],
    photoGatePrompt:  "A panel photo helps us arrive prepared — please photograph your electrical panel with the door open and all breakers visible.",
    photoGatePrompts: {
      PANEL_PHOTO: "Open the panel door so all breakers are fully visible. This lets our tech assess your panel type and load before the visit.",
    },
  },
  BREAKER_PANEL_REPAIR: {
    status:          "MANUAL_QUOTE_ONLY",
    quoteAllowed:    false,
    reviewFlag:      false,
    stackCap:        null,
    materialGap:     "blocking",
    blockerReason:   "Panel or breaker repair requires site visit: breaker type, panel brand, and fault condition must be confirmed on-site.",
    ballparkRange:   { low: 150, high: 750, note: "Depends on breaker type and panel accessibility." },
    photoGate:        true,
    photoGateModules: ["PANEL_PHOTO"],
    photoGatePrompt:  "A panel photo helps us arrive prepared — please photograph your electrical panel with the door open and all breakers visible.",
    photoGatePrompts: {
      PANEL_PHOTO: "Open the panel door so all breakers are fully visible. This lets our tech assess your panel type and capacity before the visit.",
    },
  },
  SURGE_PROTECTOR: {
    status:          "READY_WITH_REVIEW_FLAG",
    quoteAllowed:    true,
    reviewFlag:      true,
    stackCap:        2.5,
    materialGap:     "understated",
    materialNote:    "Material estimate included in price. Surge device brand and panel breaker space confirmed on-site; final invoice reflects actual quantities.",
    blockerReason:   null,
    photoGate:        true,
    photoGateModules: ["PANEL_PHOTO"],
    photoGatePrompt:  "Please photograph your electrical panel with the door open so we can confirm available breaker space and grounding before your appointment.",
    photoGatePrompts: {
      PANEL_PHOTO: "Open the panel door so all breakers and any open slots are visible. This lets us confirm the right surge device for your panel brand and confirm there's room to install it.",
    },
  },

  // ── MANUAL_QUOTE_ONLY — outdoor / lighting requiring conduit assessment ───────
  OUTDOOR_LIGHTING: {
    status:          "READY_WITH_REVIEW_FLAG",
    quoteAllowed:    true,
    reviewFlag:      true,
    stackCap:        3.0,
    materialGap:     "understated",
    materialNote:    "Material estimate included in price. Conduit routing and fixture mounting confirmed on-site; final invoice reflects actual quantities.",
    blockerReason:   null,
    photoGate:        true,
    photoGateModules: ["OUTDOOR_PHOTO"],
    photoGatePrompt:  "Please share a photo of the outdoor area where the lighting will go — driveway, porch, eave, or yard — so we can plan conduit routing before the visit.",
    photoGatePrompts: {
      OUTDOOR_PHOTO: "Step back and photograph the wall, eave, or area where you'd like the outdoor lighting installed. Show the mounting surface and any existing outdoor outlets or conduit nearby.",
    },
  },
  MOTION_SECURITY_LIGHT: {
    status:          "READY_WITH_REVIEW_FLAG",
    quoteAllowed:    true,
    reviewFlag:      true,
    stackCap:        3.0,
    materialGap:     "understated",
    materialNote:    "Material estimate included in price. Fixture type and conduit path confirmed on-site; final invoice reflects actual quantities.",
    blockerReason:   null,
    photoGate:        true,
    photoGateModules: ["OUTDOOR_PHOTO"],
    photoGatePrompt:  "Please photograph the location where the motion/security light will mount so we can assess the conduit path and nearest circuit before the visit.",
    photoGatePrompts: {
      OUTDOOR_PHOTO: "Show us the mounting spot — the soffit, eave, or wall where the light will go. Step back far enough to show the full mounting area and surrounding siding or soffit so we can plan the conduit path.",
    },
  },

  // ── MANUAL_QUOTE_ONLY — high-variability residential ─────────────────────────
  HOT_TUB_CIRCUIT: {
    status:          "MANUAL_QUOTE_ONLY",
    quoteAllowed:    false,
    reviewFlag:      false,
    stackCap:        null,
    materialGap:     "blocking",
    blockerReason:   "Hot tub / spa circuit requires site visit: dedicated 240V run, GFCI disconnect location, and conduit path must be assessed on-site.",
    ballparkRange:   { low: 900, high: 2500, note: "Depends on distance from panel, conduit routing, and disconnect location." },
  },
  SMOKE_CO_DETECTOR: {
    status:          "READY_WITH_REVIEW_FLAG",
    quoteAllowed:    true,
    reviewFlag:      true,
    stackCap:        2.5,
    materialGap:     "understated",
    materialNote:    "Material estimate included in price. Detector count and interconnection type confirmed on-site; final invoice reflects actual quantities.",
    blockerReason:   null,
  },
  APPLIANCE_CIRCUIT: {
    status:          "MANUAL_QUOTE_ONLY",
    quoteAllowed:    false,
    reviewFlag:      false,
    stackCap:        null,
    materialGap:     "blocking",
    blockerReason:   "New appliance circuit requires site visit: appliance amperage, panel capacity, and run distance must be confirmed on-site.",
    ballparkRange:   { low: 300, high: 1100, note: "Depends on appliance type, amperage, and distance from panel." },
    photoGate:        true,
    photoGateModules: ["PANEL_PHOTO", "WORK_AREA_PHOTO"],
    photoGatePrompt:  "Two photos help us prepare your estimate: the electrical panel and the location where the appliance will be installed.",
    photoGatePrompts: {
      PANEL_PHOTO:      "Open the panel door so all breakers are visible. We need to confirm remaining capacity and space for the new circuit.",
      WORK_AREA_PHOTO:  "Show us the wall or area where the appliance will be located. Include any existing outlets or wiring nearby.",
    },
  },
  HOME_AUTOMATION: {
    status:          "MANUAL_QUOTE_ONLY",
    quoteAllowed:    false,
    reviewFlag:      false,
    stackCap:        null,
    materialGap:     "blocking",
    blockerReason:   "Home automation scope varies too widely for online pricing: device count, hub brand, and wiring compatibility must be assessed on-site.",
    ballparkRange:   { low: 400, high: 3500, note: "Highly variable by device count, brand, and integration complexity." },
  },
  CODE_COMPLIANCE: {
    status:          "MANUAL_QUOTE_ONLY",
    quoteAllowed:    false,
    reviewFlag:      false,
    stackCap:        null,
    materialGap:     "blocking",
    blockerReason:   "Code compliance work requires site visit: violation type, scope, and permit requirements must be identified before pricing.",
    ballparkRange:   { low: 300, high: 4500, note: "Depends on violation type, scope, and whether permits are required." },
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
  GENERATOR_TRANSFER_SWITCH: {
    status: "MANUAL_QUOTE_ONLY", quoteAllowed: false, reviewFlag: false, stackCap: null,
    materialGap: "n/a", blockerReason: "Transfer switch / portable generator hookup — site visit required to confirm switch type and panel compatibility.",
    ballparkRange: { low: 850, high: 2800, note: "Transfer switch type (manual vs. automatic) and panel location affect cost." },
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
  A007: "LED_RETROFIT",
  A008: "DIMMER_SWITCH",
  A010: "TROUBLESHOOT_FLICKER",
  A011: "OUTLET_INSTALL",
  A012: "GFCI_OUTLET",
  A014: "SMART_SWITCH",
  A015: "REWIRE_WHOLE_HOUSE",
  A016: "REWIRE_PARTIAL",
  A017: "DEDICATED_CIRCUIT",
  A018: "CODE_COMPLIANCE",
  A019: "PANEL_UPGRADE",
  A020: "SUBPANEL_INSTALL",
  A021: "FUSE_BOX_CONVERSION",
  A022: "BREAKER_TRIPPING",
  A023: "PANEL_BREAKER_REPAIR",
  A024: "SURGE_PROTECTOR",
  A025: "APPLIANCE_CIRCUIT",
  A026: "GENERATOR_STANDBY",
  A027: "GENERATOR_TRANSFER_SWITCH",
  A028: "EV_CHARGER",
  A029: "HOT_TUB_CIRCUIT",
  A030: "SMOKE_CO_DETECTOR",
  A031: "HOME_AUTOMATION",
  A034: "EXIT_EMERGENCY_LIGHTS",
  A036: "BALLAST_REPLACE",
  A037: "COMM_LIGHTING_RETROFIT",
  A040: "REWIRE_COMMERCIAL",
  A046: "TRANSFORMER_INSTALL",
  A053: "GENERATOR_BACKUP",
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

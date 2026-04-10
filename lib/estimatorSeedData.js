// lib/estimatorSeedData.js
// Seed data for Estimator_Modules and Estimator_ServiceMatrix.
//
// Design principles:
//   1. Service-specific module lists — no blanket modules on everything.
//   2. CIRCUIT_SCOPE is the primary price fork for device services.
//      device_swap (existing circuit, device only) vs new location (full run).
//   3. Multiplier values calibrated to NEE 2025 productivity data.
//   4. disqualify:true in options_json → caught at quote-engine level, no site visit needed.
//   5. Hardcoded business rules in estimatorEngine.js handle compound disqualifies.
//   6. HOME_AGE values use "pre_1950" to match engine rule exactly.
//   7. CEILING_HEIGHT uses "extreme" for >20 ft so engine disqualify fires correctly.

const MODULES = [

  // ── UNIVERSAL / SHARED ─────────────────────────────────────────────────────

  {
    module_id:  "PROPERTY_TYPE",
    question:   "What type of property is this?",
    input_type: "single_select",
    options_json: JSON.stringify([
      { value: "residential", label: "Residential home",    multiplier: 1.0 },
      { value: "commercial",  label: "Commercial building", multiplier: 1.15 },
    ]),
    applies_to: "all",
    notes: "Segment routing; commercial multiplier reflects code complexity.",
  },

  {
    module_id:  "HOME_AGE",
    question:   "How old is the home or building?",
    input_type: "single_select",
    options_json: JSON.stringify([
      { value: "pre_1950",  label: "Before 1950",      multiplier: 1.45, disqualify: false },
      { value: "1950_1970", label: "1950–1970",         multiplier: 1.25, disqualify: false },
      { value: "1970_1990", label: "1970–1990",         multiplier: 1.12, disqualify: false },
      { value: "1990_2005", label: "1990–2005",         multiplier: 1.05, disqualify: false },
      { value: "2005plus",  label: "2005 or newer",     multiplier: 1.0,  disqualify: false },
    ]),
    applies_to: "all",
    notes: "Pre-1950 disqualifies panel/circuit work via engine rule. Others add labor for outdated wiring conditions.",
  },

  {
    module_id:  "WORK_AREA_PHOTOS",
    question:   "Upload 1–3 photos of the work area (optional — helps us confirm the estimate)",
    input_type: "photo",
    options_json: "[]",
    applies_to: "all",
    notes: "Soft gate — no photos = photo_warning flag, not a hard stop.",
  },

  {
    module_id:  "UNCERTAINTY_BUFFER",
    question:   "Overall, how straightforward does this job seem to you?",
    input_type: "single_select",
    options_json: JSON.stringify([
      { value: "simple",   label: "Very straightforward — nothing unusual", multiplier: 1.0 },
      { value: "moderate", label: "A few unknowns or an older home",        multiplier: 1.1 },
      { value: "complex",  label: "Multiple unknowns / I'm not sure",       multiplier: 1.2 },
    ]),
    applies_to: "all",
    notes: "Controls contingency_pct only (0 / 10 / 15%). Not applied as MULTIPLY_HOURS driver.",
  },

  // ── CEILING / ACCESS ───────────────────────────────────────────────────────

  {
    module_id:  "CEILING_HEIGHT",
    question:   "What is the ceiling height where the work will be done?",
    input_type: "single_select",
    options_json: JSON.stringify([
      { value: "standard", label: "Standard — 8 to 10 ft",      multiplier: 1.0,  disqualify: false },
      { value: "tall",     label: "Tall — 10 to 15 ft",         multiplier: 1.25, disqualify: false },
      { value: "vaulted",  label: "Vaulted — 15 to 20 ft",      multiplier: 1.55, disqualify: false },
      { value: "extreme",  label: "Very high — over 20 ft",     multiplier: 1.0,  disqualify: true  },
    ]),
    applies_to: "lighting,fans,detectors",
    notes: "Extreme (>20 ft) triggers site visit — ladder safety and staging required. 15–20 ft is priceable with tall ladder.",
  },

  {
    module_id:  "ATTIC_ACCESS",
    question:   "Is there accessible attic space directly above the work area?",
    input_type: "single_select",
    options_json: JSON.stringify([
      { value: "yes",     label: "Yes — open attic, easy access",         multiplier: 1.0  },
      { value: "partial", label: "Limited — low clearance or blown-in insulation", multiplier: 1.45 },
      { value: "no",      label: "No attic access above (finished above)", multiplier: 1.9  },
    ]),
    applies_to: "lighting,ceiling",
    notes: "Biggest single labor driver for recessed lighting. No attic = work from below, remodel cans, wire fishing from below.",
  },

  // ── WALL / STRUCTURE ───────────────────────────────────────────────────────

  {
    module_id:  "WALL_TYPE",
    question:   "What is the wall construction where the outlet or switch will go?",
    input_type: "single_select",
    options_json: JSON.stringify([
      { value: "drywall", label: "Drywall — standard",           multiplier: 1.0,  disqualify: false },
      { value: "plaster", label: "Plaster walls",                multiplier: 1.35, disqualify: false },
      { value: "brick",   label: "Brick or concrete block",      multiplier: 1.0,  disqualify: true  },
      { value: "other",   label: "Other / not sure",             multiplier: 1.15, disqualify: false },
    ]),
    applies_to: "outlets,switches",
    notes: "Brick disqualifies — masonry anchors, sealing, and wall penetration require on-site assessment. Plaster adds ~35% labor.",
  },

  // ── CIRCUIT SCOPE — primary price fork for device services ─────────────────

  {
    module_id:  "CIRCUIT_SCOPE",
    question:   "Is this replacing an existing device, or installing in a new location?",
    input_type: "single_select",
    options_json: JSON.stringify([
      { value: "device_swap",       label: "Replacing an existing device at the same location", multiplier: 0.45 },
      { value: "extend_existing",   label: "New location — tapping into a nearby existing circuit", multiplier: 1.0 },
      { value: "new_circuit",       label: "New location — running a new circuit from the panel", multiplier: 1.5  },
    ]),
    applies_to: "outlets,switches,lighting",
    notes: "Device swap is ~45% of baseline (no fishing, no circuit work). New circuit from panel is 150% of baseline.",
  },

  // ── DISTANCE / PANEL ───────────────────────────────────────────────────────

  {
    module_id:  "DISTANCE_FROM_PANEL",
    question:   "Roughly how far is the work area from your electrical panel?",
    input_type: "single_select",
    options_json: JSON.stringify([
      { value: "under15",  label: "Under 15 ft",   multiplier: 1.0  },
      { value: "15to40",   label: "15–40 ft",      multiplier: 1.1  },
      { value: "40to75",   label: "40–75 ft",      multiplier: 1.25 },
      { value: "over75",   label: "Over 75 ft",    multiplier: 1.45 },
    ]),
    applies_to: "circuits,new_location",
    notes: "Only meaningful when CIRCUIT_SCOPE = new_circuit or for dedicated circuits.",
  },

  {
    module_id:  "PANEL_SPACE",
    question:   "Are there open breaker slots in your electrical panel?",
    input_type: "single_select",
    options_json: JSON.stringify([
      { value: "yes",     label: "Yes — open slots available",     multiplier: 1.0 },
      { value: "tandem",  label: "Full, but tandem slots available", multiplier: 1.1 },
      { value: "no",      label: "Panel is completely full",        multiplier: 1.0, disqualify: true  },
      { value: "unknown", label: "Not sure",                        multiplier: 1.05 },
    ]),
    applies_to: "circuits,panel,ev,surge",
    notes: "Full panel = site visit to assess options (tandem, subpanel, etc.).",
  },

  {
    module_id:  "PANEL_PHOTO",
    question:   "Please upload a photo of your electrical panel (door open, breakers visible)",
    input_type: "photo",
    options_json: "[]",
    applies_to: "circuits,panel,ev,surge",
    notes: "Required for accurate panel-related assessment. Missing photo = photo_warning.",
  },

  // ── FAN-SPECIFIC ───────────────────────────────────────────────────────────

  {
    module_id:  "FAN_EXISTING_WIRING",
    question:   "Is there already an electrical box (and wiring) at the fan location?",
    input_type: "single_select",
    options_json: JSON.stringify([
      { value: "yes_fan_box",   label: "Yes — fan-rated box already there (ceiling fan or light)", multiplier: 1.0  },
      { value: "yes_light_box", label: "Yes — light box exists but it's not fan-rated",            multiplier: 1.1  },
      { value: "no_box",        label: "No box at all — new location",                             multiplier: 1.55 },
    ]),
    applies_to: "fans",
    notes: "Fan-rated box is required. Non-fan-rated box needs replacement. No box = fishing new wire from switch.",
  },

  {
    module_id:  "FIXTURE_WEIGHT",
    question:   "Is the fixture unusually heavy? (chandeliers, large fans)",
    input_type: "single_select",
    options_json: JSON.stringify([
      { value: "standard",   label: "Standard weight — under 35 lbs",              multiplier: 1.0, disqualify: false },
      { value: "heavy",      label: "Heavy — 35 to 70 lbs (fan-rated box required)", multiplier: 1.15, disqualify: false },
      { value: "chandelier", label: "Very heavy — over 70 lbs or requires ceiling blocking", multiplier: 1.0, disqualify: true },
    ]),
    applies_to: "fans,lighting",
    notes: "Fixtures over 70 lbs require ceiling blocking or medallion mount — site visit required.",
  },

  // ── OUTDOOR ────────────────────────────────────────────────────────────────

  {
    module_id:  "OUTDOOR_MOUNTING",
    question:   "What surface will the outdoor fixture mount to?",
    input_type: "single_select",
    options_json: JSON.stringify([
      { value: "wood_soffit",  label: "Wood soffit or wood siding",         multiplier: 1.0,  disqualify: false },
      { value: "vinyl_soffit", label: "Vinyl soffit",                       multiplier: 1.1,  disqualify: false },
      { value: "stucco",       label: "Stucco / EIFS",                      multiplier: 1.3,  disqualify: false },
      { value: "brick_block",  label: "Brick or concrete block",            multiplier: 1.0,  disqualify: true  },
    ]),
    applies_to: "outdoor",
    notes: "Brick/masonry requires anchors, sealing, and conduit routing — site visit required.",
  },

  {
    module_id:  "OUTDOOR_CIRCUIT",
    question:   "Is there an existing exterior outlet or circuit near the fixture location?",
    input_type: "single_select",
    options_json: JSON.stringify([
      { value: "yes_nearby",    label: "Yes — existing outdoor circuit within 20 ft",   multiplier: 1.0  },
      { value: "yes_interior",  label: "Circuit is interior and needs to pass through wall", multiplier: 1.15 },
      { value: "no_new_run",    label: "No — needs full new circuit from panel",         multiplier: 1.45 },
    ]),
    applies_to: "outdoor",
    notes: "Outdoor circuits typically need GFCI protection and weatherproof covers.",
  },

  // ── SMOKE / CO DETECTOR ────────────────────────────────────────────────────

  {
    module_id:  "SMOKE_TYPE",
    question:   "What kind of smoke / CO detector work is this?",
    input_type: "single_select",
    options_json: JSON.stringify([
      { value: "battery_swap",        label: "Battery-only replacement (no wiring)",              multiplier: 0.3, disqualify: false },
      { value: "hardwired_swap",      label: "Replace hardwired unit like-for-like (same location)", multiplier: 0.65, disqualify: false },
      { value: "new_location",        label: "Install at a new location (new wiring run)",         multiplier: 1.0, disqualify: false },
      { value: "interconnected_new",  label: "New interconnected system across multiple rooms",     multiplier: 1.0, disqualify: true  },
    ]),
    applies_to: "detectors",
    notes: "Interconnected new systems require full planning — site visit. Battery swap and hardwired swap are fast and predictable.",
  },

  // ── CRAWLSPACE ─────────────────────────────────────────────────────────────

  {
    module_id:  "CRAWLSPACE_ACCESS",
    question:   "Is there crawlspace or basement access below the work area?",
    input_type: "single_select",
    options_json: JSON.stringify([
      { value: "yes", label: "Yes — accessible crawlspace or basement", multiplier: 1.0  },
      { value: "no",  label: "No — slab foundation",                   multiplier: 1.2  },
    ]),
    applies_to: "outlets,circuits",
    notes: "Slab adds fishing difficulty for lower-floor outlet work.",
  },

  // ── CONDUIT / WIRING METHOD ────────────────────────────────────────────────

  {
    module_id:  "CONDUIT_REQUIRED",
    question:   "Does the circuit run require exposed conduit (garage, outdoor, or exposed wall)?",
    input_type: "single_select",
    options_json: JSON.stringify([
      { value: "concealed_nm",   label: "No — concealed in wall or ceiling (NM cable)",   multiplier: 1.0  },
      { value: "short_conduit",  label: "Short exposed conduit run — under 20 ft",        multiplier: 1.2  },
      { value: "long_conduit",   label: "Long exposed conduit run — 20 ft or more",       multiplier: 1.45 },
    ]),
    applies_to: "circuits,ev,outdoor",
    notes: "Conduit adds material and labor over NM cable runs.",
  },

  // ── EXISTING BOX ───────────────────────────────────────────────────────────

  {
    module_id:  "EXISTING_BOX",
    question:   "Is there an existing electrical box at the fixture location?",
    input_type: "single_select",
    options_json: JSON.stringify([
      { value: "yes", label: "Yes — existing box in place", multiplier: 1.0  },
      { value: "no",  label: "No — new box must be cut and set", multiplier: 1.2 },
    ]),
    applies_to: "lighting",
    notes: "New box adds ~15–20 min. For recessed lights this is typically always a new hole.",
  },

  // ── ROOM TYPE (routing context, modest multipliers) ────────────────────────

  {
    module_id:  "ROOM_TYPE",
    question:   "Which room or area is this in?",
    input_type: "single_select",
    options_json: JSON.stringify([
      { value: "bedroom",       label: "Bedroom",                multiplier: 1.0  },
      { value: "living_family", label: "Living / family room",   multiplier: 1.0  },
      { value: "kitchen",       label: "Kitchen",                multiplier: 1.1  },
      { value: "bathroom",      label: "Bathroom",               multiplier: 1.1  },
      { value: "garage",        label: "Garage",                 multiplier: 1.05 },
      { value: "basement",      label: "Basement / utility room", multiplier: 1.05 },
    ]),
    applies_to: "outlets,switches",
    notes: "Kitchen and bathroom add ~10% for tighter access and code requirements.",
  },
];


// ── SERVICE MATRIX ────────────────────────────────────────────────────────────
//
// modules_csv rules:
//   - Only list modules that ACTUALLY affect pricing for this service.
//   - First module is shown first on the form.
//   - UNCERTAINTY_BUFFER always last if included.
//   - WORK_AREA_PHOTOS always last or second-to-last.
//   - Site-visit services: collect enough to hand off to a tech for callback.

const SERVICES = [

  // ── SITE VISIT REQUIRED — by design, no price given ───────────────────────

  {
    service_id:   "TROUBLESHOOT_FLICKER",
    service_name: "Electrical Troubleshooting",
    segment:      "residential",
    tier:         "site_visit_required",
    modules_csv:  "PROPERTY_TYPE,HOME_AGE,WORK_AREA_PHOTOS",
    base_price_mode: "existing_calculator",
    enabled: "TRUE",
  },
  {
    service_id:   "REWIRE_WHOLE_HOUSE",
    service_name: "Whole-House Rewiring",
    segment:      "residential",
    tier:         "site_visit_required",
    modules_csv:  "PROPERTY_TYPE,HOME_AGE,PANEL_PHOTO,WORK_AREA_PHOTOS",
    base_price_mode: "existing_calculator",
    enabled: "TRUE",
  },
  {
    service_id:   "REWIRE_PARTIAL",
    service_name: "Partial Home Rewiring",
    segment:      "residential",
    tier:         "site_visit_required",
    modules_csv:  "PROPERTY_TYPE,HOME_AGE,ATTIC_ACCESS,PANEL_PHOTO,WORK_AREA_PHOTOS",
    base_price_mode: "existing_calculator",
    enabled: "TRUE",
  },
  {
    service_id:   "REWIRE_COMMERCIAL",
    service_name: "Commercial Rewiring",
    segment:      "commercial",
    tier:         "site_visit_required",
    modules_csv:  "PROPERTY_TYPE,CEILING_HEIGHT,PANEL_PHOTO,WORK_AREA_PHOTOS",
    base_price_mode: "existing_calculator",
    enabled: "TRUE",
  },
  {
    service_id:   "FIRE_ALARM",
    service_name: "Fire Alarm System",
    segment:      "commercial",
    tier:         "site_visit_required",
    modules_csv:  "PROPERTY_TYPE,CEILING_HEIGHT,WORK_AREA_PHOTOS",
    base_price_mode: "placeholder",
    enabled: "TRUE",
  },
  {
    service_id:   "TRANSFORMER_INSTALL",
    service_name: "Transformer Installation",
    segment:      "commercial",
    tier:         "site_visit_required",
    modules_csv:  "PROPERTY_TYPE,WORK_AREA_PHOTOS",
    base_price_mode: "placeholder",
    enabled: "TRUE",
  },
  {
    service_id:   "GENERATOR_STANDBY",
    service_name: "Standby Generator Installation",
    segment:      "residential",
    tier:         "site_visit_required",
    modules_csv:  "PROPERTY_TYPE,HOME_AGE,PANEL_SPACE,PANEL_PHOTO,WORK_AREA_PHOTOS",
    base_price_mode: "existing_calculator",
    enabled: "TRUE",
  },
  {
    service_id:   "GENERATOR_BACKUP",
    service_name: "Backup Generator Hookup",
    segment:      "residential",
    tier:         "site_visit_required",
    modules_csv:  "PROPERTY_TYPE,HOME_AGE,PANEL_SPACE,PANEL_PHOTO,WORK_AREA_PHOTOS",
    base_price_mode: "existing_calculator",
    enabled: "TRUE",
  },

  // ── MANUAL QUOTE — too many variables for instant pricing ─────────────────
  // Tier = site_visit_required so the engine routes them correctly.
  // Classification in serviceClassification.js = MANUAL_QUOTE_ONLY.

  {
    service_id:   "PANEL_UPGRADE",
    service_name: "Electrical Panel Upgrade",
    segment:      "residential",
    tier:         "site_visit_required",
    // Collect key info so the tech callback is informed.
    modules_csv:  "PROPERTY_TYPE,HOME_AGE,PANEL_PHOTO,WORK_AREA_PHOTOS",
    base_price_mode: "existing_calculator",
    enabled: "TRUE",
  },
  {
    service_id:   "SUBPANEL_INSTALL",
    service_name: "Sub-Panel Installation",
    segment:      "residential",
    tier:         "site_visit_required",
    modules_csv:  "PROPERTY_TYPE,HOME_AGE,PANEL_SPACE,PANEL_PHOTO,DISTANCE_FROM_PANEL,WORK_AREA_PHOTOS",
    base_price_mode: "existing_calculator",
    enabled: "TRUE",
  },
  {
    service_id:   "EV_CHARGER",
    service_name: "EV Charger Installation",
    segment:      "residential",
    tier:         "site_visit_required",
    modules_csv:  "PROPERTY_TYPE,HOME_AGE,PANEL_SPACE,PANEL_PHOTO,DISTANCE_FROM_PANEL,CONDUIT_REQUIRED,WORK_AREA_PHOTOS",
    base_price_mode: "existing_calculator",
    enabled: "TRUE",
  },
  {
    service_id:   "HOT_TUB_CIRCUIT",
    service_name: "Hot Tub / Spa Electrical Circuit",
    segment:      "residential",
    tier:         "site_visit_required",
    modules_csv:  "PROPERTY_TYPE,HOME_AGE,PANEL_SPACE,PANEL_PHOTO,DISTANCE_FROM_PANEL,CONDUIT_REQUIRED,WORK_AREA_PHOTOS",
    base_price_mode: "existing_calculator",
    enabled: "TRUE",
  },

  // ── INSTANT — residential ─────────────────────────────────────────────────

  {
    service_id:   "CEILING_FAN_INSTALL",
    service_name: "Ceiling Fan Installation",
    segment:      "residential",
    tier:         "instant",
    // Key drivers: existing wiring, ceiling height, fixture weight.
    // Customer typically supplies the fan (we supply hardware).
    modules_csv:  "FAN_EXISTING_WIRING,CEILING_HEIGHT,FIXTURE_WEIGHT,HOME_AGE,WORK_AREA_PHOTOS,UNCERTAINTY_BUFFER",
    base_price_mode: "existing_calculator",
    enabled: "TRUE",
  },

  {
    service_id:   "LIGHT_FIXTURE_INSTALL",
    service_name: "Light Fixture Installation",
    segment:      "residential",
    tier:         "instant_with_safeguards",
    // Key drivers: existing box, ceiling height, fixture weight, circuit scope.
    modules_csv:  "CIRCUIT_SCOPE,EXISTING_BOX,CEILING_HEIGHT,FIXTURE_WEIGHT,HOME_AGE,WORK_AREA_PHOTOS,UNCERTAINTY_BUFFER",
    base_price_mode: "existing_calculator",
    enabled: "TRUE",
  },

  {
    service_id:   "RECESSED_LIGHTING",
    service_name: "Recessed Lighting Installation",
    segment:      "residential",
    tier:         "instant_with_safeguards",
    // Attic access is the dominant driver. Ceiling height secondary.
    // New circuit vs. tie-in affects price significantly.
    modules_csv:  "ATTIC_ACCESS,CEILING_HEIGHT,CIRCUIT_SCOPE,HOME_AGE,WORK_AREA_PHOTOS,UNCERTAINTY_BUFFER",
    base_price_mode: "existing_calculator",
    enabled: "TRUE",
  },

  {
    service_id:   "DIMMER_SWITCH",
    service_name: "Dimmer / Smart Switch Installation",
    segment:      "residential",
    tier:         "instant",
    // Most common case: swap existing switch for dimmer. Fast and predictable.
    // Wall type matters for any new-location work.
    modules_csv:  "CIRCUIT_SCOPE,WALL_TYPE,HOME_AGE,WORK_AREA_PHOTOS,UNCERTAINTY_BUFFER",
    base_price_mode: "existing_calculator",
    enabled: "TRUE",
  },

  {
    service_id:   "OUTLET_INSTALL",
    service_name: "Outlet / Receptacle Installation",
    segment:      "residential",
    tier:         "instant_with_safeguards",
    // CIRCUIT_SCOPE is the primary price fork (swap vs. new).
    // Distance matters for new circuit runs.
    modules_csv:  "CIRCUIT_SCOPE,WALL_TYPE,CRAWLSPACE_ACCESS,DISTANCE_FROM_PANEL,ROOM_TYPE,HOME_AGE,WORK_AREA_PHOTOS,UNCERTAINTY_BUFFER",
    base_price_mode: "existing_calculator",
    enabled: "TRUE",
  },

  {
    service_id:   "GFCI_OUTLET",
    service_name: "GFCI Outlet Installation",
    segment:      "residential",
    tier:         "instant",
    // GFCI swap is one of the most predictable jobs we do.
    // New-location GFCI still very predictable.
    modules_csv:  "CIRCUIT_SCOPE,WALL_TYPE,ROOM_TYPE,HOME_AGE,WORK_AREA_PHOTOS,UNCERTAINTY_BUFFER",
    base_price_mode: "existing_calculator",
    enabled: "TRUE",
  },

  {
    service_id:   "SURGE_PROTECTOR",
    service_name: "Whole-Home Surge Protector",
    segment:      "residential",
    tier:         "instant",
    // Breaker-mounted whole-home surge protector.
    // Panel must have space — full panel disqualifies.
    modules_csv:  "PANEL_SPACE,PANEL_PHOTO,HOME_AGE,WORK_AREA_PHOTOS,UNCERTAINTY_BUFFER",
    base_price_mode: "existing_calculator",
    enabled: "TRUE",
  },

  {
    service_id:   "OUTDOOR_LIGHTING",
    service_name: "Outdoor / Landscape Lighting",
    segment:      "residential",
    tier:         "instant_with_safeguards",
    // Mounting surface and circuit source are dominant drivers.
    modules_csv:  "OUTDOOR_MOUNTING,OUTDOOR_CIRCUIT,HOME_AGE,WORK_AREA_PHOTOS,UNCERTAINTY_BUFFER",
    base_price_mode: "existing_calculator",
    enabled: "TRUE",
  },

  {
    service_id:   "MOTION_SECURITY_LIGHT",
    service_name: "Motion / Security Light Installation",
    segment:      "residential",
    tier:         "instant",
    // Like outdoor lighting but simpler scope (typically replacing existing).
    modules_csv:  "OUTDOOR_MOUNTING,OUTDOOR_CIRCUIT,HOME_AGE,WORK_AREA_PHOTOS,UNCERTAINTY_BUFFER",
    base_price_mode: "existing_calculator",
    enabled: "TRUE",
  },

  {
    service_id:   "SMOKE_CO_DETECTOR",
    service_name: "Smoke / CO Detector Installation",
    segment:      "residential",
    tier:         "instant",
    // SMOKE_TYPE drives everything — battery swap is 30% of new-location labor.
    modules_csv:  "SMOKE_TYPE,CEILING_HEIGHT,HOME_AGE,WORK_AREA_PHOTOS,UNCERTAINTY_BUFFER",
    base_price_mode: "existing_calculator",
    enabled: "TRUE",
  },

  // ── COMMERCIAL ────────────────────────────────────────────────────────────

  {
    service_id:   "COMM_LIGHTING_RETROFIT",
    service_name: "Commercial Lighting Retrofit",
    segment:      "commercial",
    tier:         "site_visit_required",
    modules_csv:  "PROPERTY_TYPE,CEILING_HEIGHT,WORK_AREA_PHOTOS",
    base_price_mode: "existing_calculator",
    enabled: "TRUE",
  },
  {
    service_id:   "BALLAST_REPLACE",
    service_name: "Ballast / Bulb Replacement",
    segment:      "commercial",
    tier:         "instant_with_safeguards",
    modules_csv:  "CEILING_HEIGHT,HOME_AGE,WORK_AREA_PHOTOS,UNCERTAINTY_BUFFER",
    base_price_mode: "existing_calculator",
    enabled: "TRUE",
  },
  {
    service_id:   "EXIT_EMERGENCY_LIGHTS",
    service_name: "Exit / Emergency Light Installation",
    segment:      "commercial",
    tier:         "instant_with_safeguards",
    modules_csv:  "CEILING_HEIGHT,WORK_AREA_PHOTOS,UNCERTAINTY_BUFFER",
    base_price_mode: "existing_calculator",
    enabled: "TRUE",
  },
];

module.exports = { MODULES, SERVICES };

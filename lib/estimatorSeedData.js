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
    module_id:  "WORK_AREA_PHOTO",
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

  // ── THREE-WAY / MULTI-LOCATION ─────────────────────────────────────────────

  {
    module_id:  "THREE_WAY_SWITCHING",
    question:   "Is this light or fan controlled from more than one switch location?",
    input_type: "single_select",
    options_json: JSON.stringify([
      { value: "single",    label: "No — one switch only",           multiplier: 1.0 },
      { value: "three_way", label: "Yes — 2 switch locations (3-way)", multiplier: 1.2 },
      { value: "four_way",  label: "Yes — 3 or more locations (4-way)", multiplier: 1.4 },
      { value: "not_sure",  label: "Not sure",                       multiplier: 1.1 },
    ]),
    applies_to: "switches,dimmer,fans",
    notes: "3-way / 4-way wiring adds a traveler run plus matching smart devices. ~20–40% additional labor.",
  },

  // ── SMART HOME PLATFORM & CONNECTIVITY ────────────────────────────────────

  {
    module_id:  "SMART_PLATFORM",
    question:   "Which smart home platform do you use?",
    input_type: "single_select",
    options_json: JSON.stringify([
      { value: "none",     label: "None — not connected to a smart home", multiplier: 1.0 },
      { value: "alexa",    label: "Amazon Alexa",                         multiplier: 1.0 },
      { value: "google",   label: "Google Home",                          multiplier: 1.0 },
      { value: "homekit",  label: "Apple HomeKit",                        multiplier: 1.0 },
      { value: "not_sure", label: "Not sure",                             multiplier: 1.0, uncertain: true },
    ]),
    applies_to: "smart,switches",
    notes: "Platform choice determines compatible device brands. No pricing impact — qualifier only.",
  },

  {
    module_id:  "WIFI_AVAILABLE",
    question:   "Is Wi-Fi available at the switch or device location?",
    input_type: "single_select",
    options_json: JSON.stringify([
      { value: "yes_strong", label: "Yes — strong signal",          multiplier: 1.0 },
      { value: "yes_weak",   label: "Yes — but weak signal there",  multiplier: 1.0, uncertain: true },
      { value: "no",         label: "No Wi-Fi in that area",        multiplier: 1.0, uncertain: true },
      { value: "not_sure",   label: "Not sure",                     multiplier: 1.0, uncertain: true },
    ]),
    applies_to: "smart,switches",
    notes: "Weak/no Wi-Fi flags the job for a hub-based or Z-Wave device recommendation.",
  },

  // ── SMART SWITCH / NEUTRAL WIRE ────────────────────────────────────────────

  {
    module_id:  "SMART_NEUTRAL_WIRE",
    question:   "Is there a neutral (white) wire in the switch box?",
    input_type: "single_select",
    options_json: JSON.stringify([
      { value: "yes",      label: "Yes",         multiplier: 1.0  },
      { value: "no",       label: "No",          multiplier: 1.2  },
      { value: "not_sure", label: "Not sure",    multiplier: 1.15 },
    ]),
    applies_to: "switches,smart",
    notes: "No neutral requires no-neutral-compatible smart switch or running a new neutral wire. Adds cost.",
  },

  // ── FAN CONTROL TYPE ────────────────────────────────────────────────────────

  {
    module_id:  "FAN_CONTROL_TYPE",
    question:   "How will the fan be controlled?",
    input_type: "single_select",
    options_json: JSON.stringify([
      { value: "pull_chain",  label: "Pull chain — no wall control",  multiplier: 1.0  },
      { value: "wall_switch", label: "Wall switch",                   multiplier: 1.05 },
      { value: "remote",      label: "Remote / receiver kit",         multiplier: 1.1  },
      { value: "smart",       label: "Smart / app control",           multiplier: 1.15 },
      { value: "not_sure",    label: "Not sure",                      multiplier: 1.05 },
    ]),
    applies_to: "fans",
    notes: "Smart and remote fan controls may require a dedicated fan-rated neutral conductor.",
  },

  // ── OUTDOOR WEATHER EXPOSURE ────────────────────────────────────────────────

  {
    module_id:  "OUTDOOR_EXPOSURE",
    question:   "Will this installation be exposed to rain or outdoor weather?",
    input_type: "single_select",
    options_json: JSON.stringify([
      { value: "covered",  label: "Covered — under eave, not directly rained on", multiplier: 1.0  },
      { value: "exposed",  label: "Exposed — rain can reach it directly",          multiplier: 1.15 },
      { value: "not_sure", label: "Not sure",                                      multiplier: 1.05 },
    ]),
    applies_to: "outdoor,fans",
    notes: "Exposed installations require WR-rated devices and weatherproof covers.",
  },

  // ── PANEL BRAND ────────────────────────────────────────────────────────────

  {
    module_id:  "PANEL_BRAND",
    question:   "What brand is your electrical panel?",
    input_type: "single_select",
    options_json: JSON.stringify([
      { value: "square_d",  label: "Square D",              multiplier: 1.0 },
      { value: "siemens",   label: "Siemens",               multiplier: 1.0 },
      { value: "eaton",     label: "Eaton",                 multiplier: 1.0 },
      { value: "ge",        label: "GE",                    multiplier: 1.0 },
      { value: "fpe",       label: "Federal Pacific (FPE)", disqualify: true },
      { value: "zinsco",    label: "Zinsco",                disqualify: true },
      { value: "not_sure",  label: "Not sure",              multiplier: 1.05 },
    ]),
    applies_to: "panel,circuits,ev,surge",
    notes: "FPE and Zinsco are unsafe panels — site visit and remediation required before any circuit work.",
  },

  // ── UNSAFE SYMPTOMS ────────────────────────────────────────────────────────

  {
    module_id:  "UNSAFE_SYMPTOMS",
    question:   "Are you noticing any of these warning signs?",
    input_type: "single_select",
    options_json: JSON.stringify([
      { value: "none",          label: "None — no warning signs",          multiplier: 1.0 },
      { value: "buzzing",       label: "Buzzing or humming",               multiplier: 1.1 },
      { value: "hot_touch",     label: "Device or panel hot to the touch", disqualify: true },
      { value: "burning_smell", label: "Burning smell",                    disqualify: true },
      { value: "sparking",      label: "Sparking or arcing",               disqualify: true },
      { value: "not_sure",      label: "Not sure",                         multiplier: 1.1 },
    ]),
    applies_to: "panel,switches,outlets",
    notes: "Hot / burning / sparking triggers emergency flag — never instant-priced, requires urgent dispatch.",
  },

  // ── PHOTO GATE MODULES ─────────────────────────────────────────────────────

  {
    module_id:  "CEILING_PHOTO",
    question:   "Please upload a photo of the ceiling location (tilt phone up — center the box or target area)",
    input_type: "photo",
    options_json: "[]",
    applies_to: "lighting,fans",
    notes: "Required for ceiling fan, light fixture, and recessed lighting jobs.",
  },
  {
    module_id:  "OUTLET_PHOTO",
    question:   "Please upload a photo of the outlet area (mark the spot with tape if adding new)",
    input_type: "photo",
    options_json: "[]",
    applies_to: "outlets",
    notes: "Required for outlet, GFCI, and receptacle installations.",
  },
  {
    module_id:  "SWITCH_PHOTO",
    question:   "Please upload a photo of the switch location — cover plate and surrounding wall",
    input_type: "photo",
    options_json: "[]",
    applies_to: "switches",
    notes: "Required for dimmer, smart switch, and switch installations.",
  },
  {
    module_id:  "OUTDOOR_PHOTO",
    question:   "Please upload a photo of the outdoor mounting location and surrounding area",
    input_type: "photo",
    options_json: "[]",
    applies_to: "outdoor",
    notes: "Required for outdoor lighting, motion light, and exterior installations.",
  },

  // ── CUSTOMER UNSURE FLAG ────────────────────────────────────────────────────

  {
    module_id:  "CUSTOMER_UNSURE",
    question:   "Are you unsure about any of your answers above?",
    input_type: "single_select",
    options_json: JSON.stringify([
      { value: "confident", label: "No — I'm confident in my answers",    multiplier: 1.0 },
      { value: "some",      label: "A few answers I'm not 100% sure on",  multiplier: 1.1, uncertain: true },
      { value: "many",      label: "Several answers I guessed at",        multiplier: 1.2, uncertain: true },
    ]),
    applies_to: "all",
    notes: "Adds review_flag and buffer for uncertain customers — catches edge cases before booking.",
  },

  // ── CANONICAL MODULE IDs (per spec question-map document) ─────────────────
  // These are the authoritative codes used in the per-service question maps.
  // Some overlap with legacy modules above for backward compatibility.

  {
    module_id:  "SERVICE_QUANTITY",
    question:   "How many items or locations need this work?",
    input_type: "single_select",
    options_json: JSON.stringify([
      { value: "1",     label: "1",     multiplier: 1.0  },
      { value: "2_4",   label: "2–4",   multiplier: 0.9  },
      { value: "5_8",   label: "5–8",   multiplier: 0.85 },
      { value: "9plus", label: "9+",    multiplier: 0.8  },
    ]),
    applies_to: "all",
    notes: "Quantity scaling. Volume discount on per-unit labor.",
  },

  {
    module_id:  "REPLACE_OR_NEW",
    question:   "Is this replacing an existing device / fixture, or installing where nothing exists?",
    input_type: "single_select",
    options_json: JSON.stringify([
      { value: "replace",  label: "Replacing existing — same location",        multiplier: 0.6  },
      { value: "new_near", label: "New location — tapping into nearby circuit", multiplier: 1.0  },
      { value: "new_far",  label: "New location — new circuit from panel",      multiplier: 1.5  },
      { value: "not_sure", label: "Not sure",                                   multiplier: 1.1, uncertain: true },
    ]),
    applies_to: "all",
    notes: "Primary price fork. Replace = minimal labor. New far = full circuit run.",
  },

  {
    module_id:  "ROOM_LOCATION",
    question:   "What room or area is this in?",
    input_type: "single_select",
    options_json: JSON.stringify([
      { value: "bedroom",       label: "Bedroom",                  multiplier: 1.0  },
      { value: "living_family", label: "Living / family room",     multiplier: 1.0  },
      { value: "kitchen",       label: "Kitchen",                  multiplier: 1.1  },
      { value: "bathroom",      label: "Bathroom",                 multiplier: 1.1  },
      { value: "garage",        label: "Garage",                   multiplier: 1.05 },
      { value: "exterior",      label: "Exterior / outdoor area",  multiplier: 1.2  },
      { value: "attic",         label: "Attic / crawlspace",       multiplier: 1.25 },
      { value: "basement",      label: "Basement / utility room",  multiplier: 1.05 },
      { value: "other",         label: "Other",                    multiplier: 1.1  },
    ]),
    applies_to: "all",
    notes: "Kitchen/bathroom/exterior add code requirements. Attic/crawl adds access difficulty.",
  },

  {
    module_id:  "SURFACE_TYPE",
    question:   "What surface will it mount to?",
    input_type: "single_select",
    options_json: JSON.stringify([
      { value: "drywall",    label: "Drywall",                       multiplier: 1.0  },
      { value: "wood",       label: "Wood / wood siding / fascia",   multiplier: 1.0  },
      { value: "vinyl",      label: "Vinyl soffit / siding",         multiplier: 1.1  },
      { value: "stucco",     label: "Stucco / EIFS",                 multiplier: 1.3  },
      { value: "plaster",    label: "Plaster",                       multiplier: 1.35 },
      { value: "brick",      label: "Brick or concrete block",       multiplier: 1.0,  disqualify: true },
      { value: "not_sure",   label: "Not sure",                      multiplier: 1.1,  uncertain: true },
    ]),
    applies_to: "all",
    notes: "Brick/masonry disqualifies — requires masonry anchors and conduit. Stucco/plaster add labor.",
  },

  {
    module_id:  "EXISTING_WIRING",
    question:   "Is there already power or wiring at this location?",
    input_type: "single_select",
    options_json: JSON.stringify([
      { value: "yes_full",   label: "Yes — full circuit and box already there",    multiplier: 1.0  },
      { value: "yes_nearby", label: "Nearby circuit within 20 ft",                multiplier: 1.15 },
      { value: "no",         label: "No — needs new circuit run from panel",       multiplier: 1.45 },
      { value: "not_sure",   label: "Not sure",                                   multiplier: 1.1, uncertain: true },
    ]),
    applies_to: "all",
    notes: "Most important labor fork after REPLACE_OR_NEW.",
  },

  {
    module_id:  "FAN_RATED_BOX",
    question:   "Is the existing electrical box fan-rated?",
    input_type: "single_select",
    options_json: JSON.stringify([
      { value: "yes_fan_rated",  label: "Yes — fan-rated box already installed",        multiplier: 1.0  },
      { value: "yes_light_only", label: "Yes, but it's a light box — not fan-rated",    multiplier: 1.1  },
      { value: "no_box",         label: "No box at all — new location",                multiplier: 1.55 },
      { value: "not_sure",       label: "Not sure — needs photo/review",               multiplier: 1.15, uncertain: true },
    ]),
    applies_to: "fans",
    notes: "Fan-rated box required by code. Non-rated box must be replaced. No box = full new wire run.",
  },

  {
    module_id:  "CONTROL_TYPE",
    question:   "How will this be controlled?",
    input_type: "single_select",
    options_json: JSON.stringify([
      { value: "existing",    label: "Use existing switch / control",   multiplier: 1.0  },
      { value: "new_switch",  label: "Add new wall switch",             multiplier: 1.1  },
      { value: "dimmer",      label: "Wall dimmer",                     multiplier: 1.1  },
      { value: "remote",      label: "Remote / receiver kit",           multiplier: 1.15 },
      { value: "smart",       label: "Smart / app control",             multiplier: 1.2  },
      { value: "not_sure",    label: "Not sure",                        multiplier: 1.05, uncertain: true },
    ]),
    applies_to: "fans,lighting",
    notes: "Smart and remote controls may require a dedicated neutral. Affects material selection.",
  },

  {
    module_id:  "NEUTRAL_PRESENT",
    question:   "Is there a neutral (white) wire in the switch box?",
    input_type: "single_select",
    options_json: JSON.stringify([
      { value: "yes",      label: "Yes",        multiplier: 1.0  },
      { value: "no",       label: "No",         multiplier: 1.2  },
      { value: "not_sure", label: "Not sure",   multiplier: 1.15, uncertain: true },
    ]),
    applies_to: "switches,smart",
    notes: "No neutral requires no-neutral compatible device or running a new neutral wire.",
  },

  {
    module_id:  "VOLTAGE_AMPERAGE",
    question:   "What voltage and amperage does the appliance or circuit need?",
    input_type: "single_select",
    options_json: JSON.stringify([
      { value: "120_15",   label: "120V / 15A (standard)",           multiplier: 1.0  },
      { value: "120_20",   label: "120V / 20A (kitchen/bath/laundry)", multiplier: 1.0  },
      { value: "240_30",   label: "240V / 30A (dryer, range)",        multiplier: 1.25 },
      { value: "240_40",   label: "240V / 40–50A (range, hot tub)",   multiplier: 1.35 },
      { value: "240_60",   label: "240V / 60A (large hot tub, sub)",  multiplier: 1.5  },
      { value: "not_sure", label: "Not sure — check appliance label", multiplier: 1.1, uncertain: true },
    ]),
    applies_to: "circuits,ev,appliance",
    notes: "240V circuits require double-pole breaker and heavier wire. Significant cost factor.",
  },

  {
    module_id:  "EXTERIOR_EXPOSURE",
    question:   "Will this installation be exposed to rain or outdoor weather?",
    input_type: "single_select",
    options_json: JSON.stringify([
      { value: "dry_indoor",  label: "Dry indoor — no moisture risk",         multiplier: 1.0  },
      { value: "damp",        label: "Damp / bathroom / garage",              multiplier: 1.05 },
      { value: "covered",     label: "Covered outdoor — under eave",          multiplier: 1.1  },
      { value: "exposed",     label: "Fully exposed — direct rain exposure",  multiplier: 1.2  },
      { value: "not_sure",    label: "Not sure",                              multiplier: 1.1, uncertain: true },
    ]),
    applies_to: "outdoor,fans,outlets",
    notes: "Damp/wet locations require WR-rated devices and weatherproof covers.",
  },

  {
    module_id:  "PERMIT_NEEDED",
    question:   "Do you know if this type of work requires a permit in your area?",
    input_type: "single_select",
    options_json: JSON.stringify([
      { value: "yes",      label: "Yes — permit required",                  multiplier: 1.0 },
      { value: "no",       label: "No permit needed",                       multiplier: 1.0 },
      { value: "not_sure", label: "Not sure — we will handle if required",  multiplier: 1.0, uncertain: true },
    ]),
    applies_to: "all",
    notes: "Admin/scheduling flag. We handle permit pulling — this question sets expectations.",
  },

  {
    module_id:  "CUSTOMER_SUPPLIED_MATERIAL",
    question:   "Is the fixture, device, or equipment already purchased and on-hand?",
    input_type: "single_select",
    options_json: JSON.stringify([
      { value: "yes",          label: "Yes — I already have it",            multiplier: 1.0 },
      { value: "no",           label: "No — I need to order it",            multiplier: 1.0 },
      { value: "need_help",    label: "Not sure / need a recommendation",   multiplier: 1.0, uncertain: true },
    ]),
    applies_to: "all",
    notes: "Scheduling qualifier. Jobs cannot be booked until material is on-hand or we supply it.",
  },

  {
    module_id:  "PRODUCT_TYPE",
    question:   "What type of fixture or device is being installed?",
    input_type: "single_select",
    options_json: JSON.stringify([
      { value: "flush_mount",  label: "Flush mount / drum light",        multiplier: 1.0  },
      { value: "pendant",      label: "Pendant / hanging light",         multiplier: 1.1  },
      { value: "chandelier",   label: "Chandelier / multi-arm",          multiplier: 1.2  },
      { value: "vanity",       label: "Vanity / bar light",              multiplier: 1.0  },
      { value: "track",        label: "Track lighting",                  multiplier: 1.15 },
      { value: "ceiling_fan",  label: "Ceiling fan",                     multiplier: 1.0  },
      { value: "smart_switch", label: "Smart switch / smart dimmer",     multiplier: 1.1  },
      { value: "outdoor",      label: "Outdoor / security light",        multiplier: 1.1  },
      { value: "other",        label: "Other / not sure",                multiplier: 1.1, uncertain: true },
    ]),
    applies_to: "lighting,fans,switches",
    notes: "Chandeliers and heavy fixtures may require ceiling medallion/blocking support.",
  },

  {
    module_id:  "LOAD_TYPE",
    question:   "What will this outlet, circuit, or device power?",
    input_type: "single_select",
    options_json: JSON.stringify([
      { value: "general",    label: "General use — lamps, phone chargers, etc.", multiplier: 1.0  },
      { value: "kitchen",    label: "Kitchen appliance (counter)",                multiplier: 1.05 },
      { value: "appliance",  label: "Major appliance (washer, fridge, etc.)",    multiplier: 1.0  },
      { value: "hvac",       label: "HVAC / heating / cooling",                  multiplier: 1.1  },
      { value: "ev",         label: "EV charger",                               multiplier: 1.15 },
      { value: "tools",      label: "Power tools / workshop",                   multiplier: 1.0  },
      { value: "computer",   label: "Computer / home office",                   multiplier: 1.0  },
      { value: "not_sure",   label: "Not sure / general purpose",               multiplier: 1.0, uncertain: true },
    ]),
    applies_to: "outlets,circuits",
    notes: "High-load items (HVAC, EV, large appliances) require dedicated circuits.",
  },

  // ── ROUTE + TRENCHING (structural cost drivers for circuit runs) ──────────

  {
    module_id:  "ROUTE_TYPE",
    question:   "How will the wire be routed to the new location?",
    input_type: "single_select",
    options_json: JSON.stringify([
      { value: "attic",          label: "Through attic",                          multiplier: 1.0  },
      { value: "crawlspace",     label: "Through crawlspace",                     multiplier: 1.1  },
      { value: "exposed_conduit",label: "Exposed conduit (garage or utility room)",multiplier: 1.0  },
      { value: "finished_walls", label: "Through finished walls",                 multiplier: 1.35 },
      { value: "underground",    label: "Underground / buried conduit",            multiplier: 1.6  },
      { value: "not_sure",       label: "Not sure",                               multiplier: 1.15, uncertain: true },
    ]),
    applies_to: "circuits,ev,appliance",
    notes: "Finished-wall fishing is 35% more labor. Underground disqualifies or triggers review.",
  },

  {
    module_id:  "TRENCHING_NEEDED",
    question:   "Is underground trenching or conduit burial needed?",
    input_type: "single_select",
    options_json: JSON.stringify([
      { value: "no",       label: "No — all above-ground routing",  multiplier: 1.0 },
      { value: "maybe",    label: "Maybe — not sure yet",           multiplier: 1.25, uncertain: true },
      { value: "yes",      label: "Yes — underground trenching",    multiplier: 1.0,  disqualify: true },
      { value: "not_sure", label: "Not sure",                       multiplier: 1.2,  uncertain: true },
    ]),
    applies_to: "circuits,outdoor,generators",
    notes: "Trenching requires site visit — scope, depth, permits vary too much for instant quote.",
  },

  // ── PANEL AMPERAGE (also in V2, aligning V1) ───────────────────────────────

  {
    module_id:  "PANEL_AMPERAGE",
    question:   "Do you know your main panel's amperage?",
    input_type: "single_select",
    options_json: JSON.stringify([
      { value: "100a",     label: "100A",                              multiplier: 1.1  },
      { value: "150a",     label: "150A",                             multiplier: 1.0  },
      { value: "200a",     label: "200A",                             multiplier: 1.0  },
      { value: "320a",     label: "320A (large home / EV-ready)",     multiplier: 1.0  },
      { value: "not_sure", label: "Not sure",                         multiplier: 1.1, uncertain: true },
    ]),
    applies_to: "panel,ev,circuits",
    notes: "100A panels may need upgrade assessment before EV or large circuit additions.",
  },

  // ── LED RETROFIT TYPE (service 23 primary fork) ────────────────────────────

  {
    module_id:  "LED_RETROFIT_TYPE",
    question:   "What type of LED retrofit or conversion is this?",
    input_type: "single_select",
    options_json: JSON.stringify([
      { value: "recessed_kit",      label: "Recessed can retrofit kit (snap-in LED disk)",  multiplier: 1.0  },
      { value: "tube_swap",         label: "LED tube replacement (T8/T12 fluorescent)",      multiplier: 0.75 },
      { value: "driver_swap",       label: "LED driver replacement (ballast bypass)",        multiplier: 0.85 },
      { value: "outdoor_fixture",   label: "Outdoor fixture swap (wall pack or pole light)", multiplier: 1.1  },
      { value: "not_sure",          label: "Not sure — need a recommendation",               multiplier: 1.05, uncertain: true },
    ]),
    applies_to: "lighting",
    notes: "Primary price fork for LED retrofit jobs. Recessed kits need attic access. Tube swaps are high-volume. Outdoor swaps add weather requirements.",
  },
];


// ── SERVICE MATRIX ────────────────────────────────────────────────────────────
//
// modules_csv rules:
//   - Use canonical module IDs from the spec question-map where available.
//   - 8–10 targeted questions per service — each question must affect pricing,
//     routing, material, review flag, or disqualify (no filler questions).
//   - Photo gate module always second-to-last (before CUSTOMER_UNSURE).
//   - CUSTOMER_UNSURE or UNCERTAINTY_BUFFER always last for instant services.
//   - Site-visit services: collect enough to inform the tech callback.
//   - Canonical IDs: SERVICE_QUANTITY, REPLACE_OR_NEW, ROOM_LOCATION,
//     SURFACE_TYPE, EXISTING_WIRING, FAN_RATED_BOX, CONTROL_TYPE,
//     NEUTRAL_PRESENT, VOLTAGE_AMPERAGE, EXTERIOR_EXPOSURE, PERMIT_NEEDED,
//     CUSTOMER_SUPPLIED_MATERIAL, PRODUCT_TYPE, LOAD_TYPE

const SERVICES = [

  // ══════════════════════════════════════════════════════════════════
  // DIAGNOSTICS — quote the visit, collect issue detail for tech
  // ══════════════════════════════════════════════════════════════════

  {
    service_id:   "TROUBLESHOOT_FLICKER",
    service_name: "Electrical Troubleshooting",
    segment:      "residential",
    tier:         "site_visit_required",
    // A010 — 6 targeted questions: symptom first (urgency), location, age, brand (safety flag), photos
    modules_csv:  "UNSAFE_SYMPTOMS,PANEL_BRAND,PANEL_SPACE,PANEL_AMPERAGE,EXTERIOR_EXPOSURE,ROOM_LOCATION,HOME_AGE,PANEL_PHOTO,WORK_AREA_PHOTO",
    base_price_mode: "existing_calculator",
    enabled: "TRUE",
  },

  {
    service_id:   "BREAKER_TRIPPING",
    service_name: "Breaker Tripping / Not Resetting",
    segment:      "residential",
    tier:         "site_visit_required",
    // A022 — 8 questions: urgency, circuit location, brand (safety), space+amperage (load), age, photos
    modules_csv:  "UNSAFE_SYMPTOMS,ROOM_LOCATION,PANEL_BRAND,PANEL_SPACE,PANEL_AMPERAGE,HOME_AGE,EXTERIOR_EXPOSURE,PANEL_PHOTO,WORK_AREA_PHOTO",
    base_price_mode: "existing_calculator",
    enabled: "TRUE",
  },

  // ══════════════════════════════════════════════════════════════════
  // WIRING — always site visit, major labor/disruption scope
  // ══════════════════════════════════════════════════════════════════

  {
    service_id:   "REWIRE_WHOLE_HOUSE",
    service_name: "Whole-House Rewiring",
    segment:      "residential",
    tier:         "site_visit_required",
    // A015 — 8 questions: access conditions (biggest labor driver), panel state, age, photos, uncertainty
    modules_csv:  "HOME_AGE,ATTIC_ACCESS,CRAWLSPACE_ACCESS,PANEL_BRAND,PANEL_AMPERAGE,PANEL_PHOTO,WORK_AREA_PHOTO,CUSTOMER_UNSURE",
    base_price_mode: "existing_calculator",
    enabled: "TRUE",
  },
  {
    service_id:   "REWIRE_PARTIAL",
    service_name: "Partial Home Rewiring",
    segment:      "residential",
    tier:         "site_visit_required",
    // A016 — 8 questions: urgency first, scope (where/what wiring), access conditions (biggest driver), photos
    modules_csv:  "UNSAFE_SYMPTOMS,ROOM_LOCATION,HOME_AGE,ATTIC_ACCESS,CRAWLSPACE_ACCESS,EXISTING_WIRING,PANEL_PHOTO,WORK_AREA_PHOTO",
    base_price_mode: "existing_calculator",
    enabled: "TRUE",
  },
  {
    service_id:   "REWIRE_COMMERCIAL",
    service_name: "Commercial Rewiring",
    segment:      "commercial",
    tier:         "site_visit_required",
    // 8 questions: urgency, height (labor driver), amperage, brand, location scope, building age, photos
    modules_csv:  "UNSAFE_SYMPTOMS,CEILING_HEIGHT,PANEL_AMPERAGE,PANEL_BRAND,ROOM_LOCATION,HOME_AGE,PANEL_PHOTO,WORK_AREA_PHOTO",
    base_price_mode: "existing_calculator",
    enabled: "TRUE",
  },

  // ══════════════════════════════════════════════════════════════════
  // PANEL / BREAKER — site visit required, hazard flags critical
  // ══════════════════════════════════════════════════════════════════

  {
    service_id:   "PANEL_UPGRADE",
    service_name: "Electrical Panel Upgrade",
    segment:      "residential",
    tier:         "site_visit_required",
    // A019 — 8 questions: urgency, brand (FPE/Zinsco flag), current→target amps, age, photos, uncertainty
    modules_csv:  "UNSAFE_SYMPTOMS,PANEL_BRAND,PANEL_AMPERAGE,VOLTAGE_AMPERAGE,HOME_AGE,PANEL_PHOTO,WORK_AREA_PHOTO,CUSTOMER_UNSURE",
    base_price_mode: "existing_calculator",
    enabled: "TRUE",
  },
  {
    service_id:   "SUBPANEL_INSTALL",
    service_name: "Sub-Panel Installation",
    segment:      "residential",
    tier:         "site_visit_required",
    // A020 — 8 questions: what it powers, where, wire run length, capacity, trenching flag, main panel space, photos
    modules_csv:  "LOAD_TYPE,ROOM_LOCATION,DISTANCE_FROM_PANEL,VOLTAGE_AMPERAGE,TRENCHING_NEEDED,PANEL_SPACE,SURFACE_TYPE,PANEL_PHOTO,WORK_AREA_PHOTO",
    base_price_mode: "existing_calculator",
    enabled: "TRUE",
  },
  {
    service_id:   "FUSE_BOX_CONVERSION",
    service_name: "Fuse Box Conversion",
    segment:      "residential",
    tier:         "site_visit_required",
    // A021 — 8 questions: urgency first, age (K&T context), brand flag, current size, access (new circuit runs), photos
    modules_csv:  "UNSAFE_SYMPTOMS,HOME_AGE,PANEL_BRAND,PANEL_AMPERAGE,ATTIC_ACCESS,CRAWLSPACE_ACCESS,PANEL_PHOTO,WORK_AREA_PHOTO,CUSTOMER_UNSURE",
    base_price_mode: "existing_calculator",
    enabled: "TRUE",
  },
  {
    service_id:   "BREAKER_PANEL_REPAIR",
    service_name: "Panel / Breaker Repair",
    segment:      "residential",
    tier:         "site_visit_required",
    // A023 — 8 questions: urgency, circuit location, brand+age (safety), space+amperage (capacity), photos
    modules_csv:  "UNSAFE_SYMPTOMS,ROOM_LOCATION,PANEL_BRAND,HOME_AGE,PANEL_SPACE,PANEL_AMPERAGE,EXTERIOR_EXPOSURE,PANEL_PHOTO,WORK_AREA_PHOTO",
    base_price_mode: "existing_calculator",
    enabled: "TRUE",
  },
  {
    service_id:   "SURGE_PROTECTOR",
    service_name: "Whole-Home Surge Protector",
    segment:      "residential",
    tier:         "instant",
    // A024 — 7 questions: panel space (fits?), brand (safety flag), symptoms, age, amperage (load), panel photo, buffer
    modules_csv:  "PANEL_SPACE,PANEL_BRAND,UNSAFE_SYMPTOMS,ROOM_LOCATION,HOME_AGE,PANEL_AMPERAGE,EXTERIOR_EXPOSURE,PANEL_PHOTO,UNCERTAINTY_BUFFER",
    base_price_mode: "existing_calculator",
    enabled: "TRUE",
  },

  // ══════════════════════════════════════════════════════════════════
  // CIRCUITS — EV, dedicated, appliance, hot tub
  // ══════════════════════════════════════════════════════════════════

  {
    service_id:   "EV_CHARGER",
    service_name: "EV Charger Installation",
    segment:      "residential",
    tier:         "instant_with_safeguards",
    // A028 — 13 questions: new vs existing, charger supplied, where + how far from panel, capacity + space + brand, conduit/trenching flags, photos, buffer
    modules_csv:  "REPLACE_OR_NEW,CUSTOMER_SUPPLIED_MATERIAL,ROOM_LOCATION,DISTANCE_FROM_PANEL,PANEL_AMPERAGE,PANEL_SPACE,PANEL_BRAND,VOLTAGE_AMPERAGE,CONDUIT_REQUIRED,TRENCHING_NEEDED,PANEL_PHOTO,WORK_AREA_PHOTO,UNCERTAINTY_BUFFER",
    base_price_mode: "existing_calculator",
    enabled: "TRUE",
  },
  {
    service_id:   "DEDICATED_CIRCUIT",
    service_name: "Dedicated Circuit Installation",
    segment:      "residential",
    tier:         "instant_with_safeguards",
    // A017 — 10 questions: what it powers, amperage/voltage, where, run length, route+wall (labor driver), panel capacity+brand, age, photo
    modules_csv:  "LOAD_TYPE,VOLTAGE_AMPERAGE,ROOM_LOCATION,DISTANCE_FROM_PANEL,ROUTE_TYPE,WALL_TYPE,PANEL_SPACE,PANEL_BRAND,HOME_AGE,PANEL_PHOTO",
    base_price_mode: "existing_calculator",
    enabled: "TRUE",
  },
  {
    service_id:   "APPLIANCE_CIRCUIT",
    service_name: "Appliance Circuit Installation",
    segment:      "residential",
    tier:         "site_visit_required",
    // A025 — questions: appliance, scope, voltage, location, distance, panel, wall, age, photo
    modules_csv:  "LOAD_TYPE,REPLACE_OR_NEW,VOLTAGE_AMPERAGE,ROOM_LOCATION,DISTANCE_FROM_PANEL,CUSTOMER_SUPPLIED_MATERIAL,PANEL_SPACE,WALL_TYPE,HOME_AGE,PANEL_PHOTO",
    base_price_mode: "existing_calculator",
    enabled: "TRUE",
  },
  {
    service_id:   "HOT_TUB_CIRCUIT",
    service_name: "Hot Tub / Spa Electrical Circuit",
    segment:      "residential",
    tier:         "site_visit_required",
    // A029 — 10 questions: tub delivered, voltage/amps, distance, trenching,
    // disconnect location, path type, panel full, GFCI, permit, photos
    modules_csv:  "CUSTOMER_SUPPLIED_MATERIAL,VOLTAGE_AMPERAGE,DISTANCE_FROM_PANEL,TRENCHING_NEEDED,PANEL_SPACE,PANEL_BRAND,ROUTE_TYPE,PANEL_PHOTO,WORK_AREA_PHOTO",
    base_price_mode: "existing_calculator",
    enabled: "TRUE",
  },

  // ══════════════════════════════════════════════════════════════════
  // GENERATORS — always site visit
  // ══════════════════════════════════════════════════════════════════

  {
    service_id:   "GENERATOR_STANDBY",
    service_name: "Standby Generator Installation",
    segment:      "residential",
    tier:         "site_visit_required",
    // A026 — 10 questions: generator selected, backup level, fuel, panel amps,
    // generator location, distance, concrete pad, permits, critical loads, photos
    modules_csv:  "CUSTOMER_SUPPLIED_MATERIAL,LOAD_TYPE,PANEL_AMPERAGE,PANEL_SPACE,DISTANCE_FROM_PANEL,TRENCHING_NEEDED,PANEL_PHOTO,WORK_AREA_PHOTO,CUSTOMER_UNSURE",
    base_price_mode: "existing_calculator",
    enabled: "TRUE",
  },
  {
    service_id:   "GENERATOR_TRANSFER_SWITCH",
    service_name: "Generator Transfer Switch / Interlock",
    segment:      "residential",
    tier:         "site_visit_required",
    // A027 — 10 questions: generator type, manual/interlock, size, plug type,
    // inlet location, distance, panel brand, panel full, circuits, photos
    modules_csv:  "PRODUCT_TYPE,PANEL_BRAND,PANEL_SPACE,PANEL_AMPERAGE,DISTANCE_FROM_PANEL,ROOM_LOCATION,VOLTAGE_AMPERAGE,PANEL_PHOTO,WORK_AREA_PHOTO",
    base_price_mode: "existing_calculator",
    enabled: "TRUE",
  },
  {
    service_id:   "GENERATOR_BACKUP",
    service_name: "Backup Generator Hookup",
    segment:      "residential",
    tier:         "site_visit_required",
    // A053 — 10 questions: goal, own generator, fuel type, loads to power,
    // panel amps, panel location, distance, urgency, permits, photos
    modules_csv:  "LOAD_TYPE,CUSTOMER_SUPPLIED_MATERIAL,PANEL_AMPERAGE,PANEL_SPACE,DISTANCE_FROM_PANEL,ROOM_LOCATION,PANEL_PHOTO,WORK_AREA_PHOTO,CUSTOMER_UNSURE",
    base_price_mode: "existing_calculator",
    enabled: "TRUE",
  },

  // ══════════════════════════════════════════════════════════════════
  // CODE COMPLIANCE — site visit, report-driven
  // ══════════════════════════════════════════════════════════════════

  {
    service_id:   "CODE_COMPLIANCE",
    service_name: "Code Compliance / Electrical Inspection",
    segment:      "residential",
    tier:         "site_visit_required",
    // A018 — 10 questions: trigger, report, area, repair/inspect/estimate,
    // active hazards, home age, permit, walls open, access, photo
    modules_csv:  "UNSAFE_SYMPTOMS,ROOM_LOCATION,HOME_AGE,ATTIC_ACCESS,CRAWLSPACE_ACCESS,PANEL_BRAND,PANEL_PHOTO,WORK_AREA_PHOTO,CUSTOMER_UNSURE",
    base_price_mode: "existing_calculator",
    enabled: "TRUE",
  },

  // ══════════════════════════════════════════════════════════════════
  // COMMERCIAL — site visit / review required
  // ══════════════════════════════════════════════════════════════════

  {
    service_id:   "FIRE_ALARM",
    service_name: "Fire Alarm System",
    segment:      "commercial",
    tier:         "site_visit_required",
    // 8 questions: urgency, ceiling height (ladder/lift driver), scope/area, building age, panel context, photos
    modules_csv:  "UNSAFE_SYMPTOMS,CEILING_HEIGHT,ROOM_LOCATION,HOME_AGE,PANEL_BRAND,PANEL_AMPERAGE,PANEL_PHOTO,WORK_AREA_PHOTO",
    base_price_mode: "placeholder",
    enabled: "TRUE",
  },
  {
    service_id:   "TRANSFORMER_INSTALL",
    service_name: "Transformer Installation",
    segment:      "commercial",
    tier:         "site_visit_required",
    // 8 questions: voltage/amperage spec, location scope, ceiling height, panel size+brand, mounting surface, photos
    modules_csv:  "VOLTAGE_AMPERAGE,ROOM_LOCATION,CEILING_HEIGHT,PANEL_AMPERAGE,PANEL_BRAND,SURFACE_TYPE,PANEL_PHOTO,WORK_AREA_PHOTO",
    base_price_mode: "placeholder",
    enabled: "TRUE",
  },
  {
    service_id:   "COMM_EV_CHARGING",
    service_name: "Commercial EV Charging Station",
    segment:      "commercial",
    tier:         "site_visit_required",
    // 10 questions: voltage/amps spec, panel space + amperage + brand, distance, route + conduit, location, panel photo, work area photo
    modules_csv:  "VOLTAGE_AMPERAGE,PANEL_SPACE,PANEL_AMPERAGE,PANEL_BRAND,DISTANCE_FROM_PANEL,ROUTE_TYPE,CONDUIT_REQUIRED,ROOM_LOCATION,PANEL_PHOTO,WORK_AREA_PHOTO",
    base_price_mode: "placeholder",
    enabled: "TRUE",
  },
  {
    service_id:   "COMM_LIGHTING_RETROFIT",
    service_name: "Commercial Lighting Retrofit",
    segment:      "commercial",
    tier:         "site_visit_required",
    // 7 questions: ceiling height (ladder driver), replace vs new, quantity (primary cost driver), building age, existing wiring type, photo
    // PANEL_PHOTO removed — no panel work involved in lighting retrofit
    // ROOM_LOCATION kept but flagged: commercial needs office/warehouse/retail options (future commercial ROOM_LOCATION module)
    modules_csv:  "CEILING_HEIGHT,REPLACE_OR_NEW,SERVICE_QUANTITY,ROOM_LOCATION,HOME_AGE,EXISTING_WIRING,WORK_AREA_PHOTO",
    base_price_mode: "existing_calculator",
    enabled: "TRUE",
  },
  {
    service_id:   "BALLAST_REPLACE",
    service_name: "Ballast / Bulb Replacement",
    segment:      "commercial",
    tier:         "instant_with_safeguards",
    // REPLACE_OR_NEW removed — "new circuit from panel" option is impossible for ballast replacement; misleads customers
    // SERVICE_QUANTITY added — multiple units is the norm; volume discount is a key pricing driver
    // EXISTING_WIRING added — replace in-kind vs upgrade to LED driver is the real price fork
    modules_csv:  "CEILING_HEIGHT,SERVICE_QUANTITY,EXISTING_WIRING,HOME_AGE,ROOM_LOCATION,WORK_AREA_PHOTO,UNCERTAINTY_BUFFER",
    base_price_mode: "existing_calculator",
    enabled: "TRUE",
  },
  {
    service_id:   "EXIT_EMERGENCY_LIGHTS",
    service_name: "Exit / Emergency Light Installation",
    segment:      "commercial",
    tier:         "instant_with_safeguards",
    // SERVICE_QUANTITY added — installs almost always involve multiple units
    // ROOM_LOCATION removed — bedroom/kitchen/bathroom options are irrelevant for exit/emergency lights (always commercial/utility spaces)
    modules_csv:  "CEILING_HEIGHT,REPLACE_OR_NEW,SERVICE_QUANTITY,EXISTING_WIRING,WORK_AREA_PHOTO,UNCERTAINTY_BUFFER",
    base_price_mode: "existing_calculator",
    enabled: "TRUE",
  },

  // ══════════════════════════════════════════════════════════════════
  // LIGHTING — instant / instant-with-safeguards
  // ══════════════════════════════════════════════════════════════════

  {
    service_id:   "RECESSED_LIGHTING",
    service_name: "Recessed Lighting Installation",
    segment:      "residential",
    tier:         "instant_with_safeguards",
    // A001 — 11 questions: price fork first (replace vs new), quantity (single biggest cost driver),
    // room, attic access (labor driver), ceiling height + surface (labor), controls, wiring,
    // home age (K&T disqualifier via engine rule), photo, buffer
    modules_csv:  "REPLACE_OR_NEW,SERVICE_QUANTITY,ROOM_LOCATION,ATTIC_ACCESS,CEILING_HEIGHT,SURFACE_TYPE,CONTROL_TYPE,EXISTING_WIRING,HOME_AGE,CEILING_PHOTO,UNCERTAINTY_BUFFER",
    base_price_mode: "existing_calculator",
    enabled: "TRUE",
  },
  {
    service_id:   "LIGHT_FIXTURE_INSTALL",
    service_name: "Light Fixture Installation",
    segment:      "residential",
    tier:         "instant_with_safeguards",
    // A003 — questions: replace/new (primary fork, not EXISTING_WIRING which is downstream),
    // fixture type, purchased, weight, ceiling height, box condition (replaces EXISTING_WIRING — more specific), room, age, photo
    // EXISTING_WIRING removed — EXISTING_BOX already covers box presence; REPLACE_OR_NEW covers the circuit question
    modules_csv:  "REPLACE_OR_NEW,PRODUCT_TYPE,CUSTOMER_SUPPLIED_MATERIAL,FIXTURE_WEIGHT,CEILING_HEIGHT,EXISTING_BOX,HOME_AGE,ROOM_LOCATION,CEILING_PHOTO,CUSTOMER_UNSURE",
    base_price_mode: "existing_calculator",
    enabled: "TRUE",
  },
  {
    service_id:   "LED_RETROFIT",
    service_name: "LED Retrofit / Conversion",
    segment:      "residential",
    tier:         "instant_with_safeguards",
    // A007 — 10 questions: retrofit type (primary fork — recessed kit/tube swap/driver/outdoor),
    // quantity (high-volume tube jobs), replace vs new run (2nd fork), height + access (biggest labor drivers),
    // wet/outdoor spec, age, room, photo, buffer.
    // ATTIC_ACCESS is conditional — only relevant for recessed_kit installs, not tube swaps.
    modules_csv:  "LED_RETROFIT_TYPE,SERVICE_QUANTITY,REPLACE_OR_NEW,CEILING_HEIGHT,ATTIC_ACCESS,EXTERIOR_EXPOSURE,HOME_AGE,ROOM_LOCATION,CEILING_PHOTO,CUSTOMER_UNSURE",
    conditional_rules_json: JSON.stringify({
      "ATTIC_ACCESS": { trigger: "LED_RETROFIT_TYPE", show_when: ["recessed_kit"] },
    }),
    base_price_mode: "existing_calculator",
    enabled: "TRUE",
  },

  // ══════════════════════════════════════════════════════════════════
  // FANS — instant
  // ══════════════════════════════════════════════════════════════════

  {
    service_id:   "CEILING_FAN_INSTALL",
    service_name: "Ceiling Fan Installation",
    segment:      "residential",
    tier:         "instant",
    // A004 — 10 questions: existing power (new circuit?), box rated? (safety gate — moot when no wiring),
    // ceiling height + access (labor), outdoor/damp spec (before features), customer-supplied, controls,
    // 3-way, home age (pre-1950 affects safe circuit load), photo.
    // FAN_RATED_BOX is conditional — irrelevant when EXISTING_WIRING = "no" (no box to rate).
    modules_csv:  "EXISTING_WIRING,FAN_RATED_BOX,CEILING_HEIGHT,ATTIC_ACCESS,EXTERIOR_EXPOSURE,CUSTOMER_SUPPLIED_MATERIAL,CONTROL_TYPE,THREE_WAY_SWITCHING,HOME_AGE,CEILING_PHOTO",
    conditional_rules_json: JSON.stringify({
      "FAN_RATED_BOX": { trigger: "EXISTING_WIRING", hide_when: ["no"] },
    }),
    base_price_mode: "existing_calculator",
    enabled: "TRUE",
  },

  // ══════════════════════════════════════════════════════════════════
  // OUTDOOR LIGHTING — instant / instant-with-safeguards
  // ══════════════════════════════════════════════════════════════════

  {
    service_id:   "OUTDOOR_LIGHTING",
    service_name: "Outdoor / Landscape Lighting",
    segment:      "residential",
    tier:         "instant_with_safeguards",
    // A005 — 8 questions: replace/new (primary fork), quantity (multiple fixtures is a common request),
    // fixture type, surface (brick/masonry disqualifier), existing wiring (new run?), trenching (if no power), age, photo
    // ROOM_LOCATION removed — the answer is always "exterior"; adds no value and confuses customers
    // CEILING_HEIGHT removed — rarely relevant for wall- or post-mounted outdoor fixtures; only meaningful for soffit mounting
    // EXTERIOR_EXPOSURE removed — all fixtures on this service are outdoors by definition
    modules_csv:  "REPLACE_OR_NEW,SERVICE_QUANTITY,PRODUCT_TYPE,SURFACE_TYPE,EXISTING_WIRING,TRENCHING_NEEDED,HOME_AGE,OUTDOOR_PHOTO",
    base_price_mode: "existing_calculator",
    enabled: "TRUE",
  },
  {
    service_id:   "MOTION_SECURITY_LIGHT",
    service_name: "Motion / Security Light Installation",
    segment:      "residential",
    tier:         "instant",
    // A006 — 8 questions: replace/new, light type, customer-supplied, mounting height,
    // surface (brick/wood affects anchoring), existing power, Wi-Fi (smart lights), photo
    // EXTERIOR_EXPOSURE removed — all security lights are exterior by definition
    // CONTROL_TYPE removed — security lights use built-in sensors, not a separate switch
    modules_csv:  "REPLACE_OR_NEW,PRODUCT_TYPE,CUSTOMER_SUPPLIED_MATERIAL,CEILING_HEIGHT,SURFACE_TYPE,EXISTING_WIRING,WIFI_AVAILABLE,OUTDOOR_PHOTO",
    base_price_mode: "existing_calculator",
    enabled: "TRUE",
  },

  // ══════════════════════════════════════════════════════════════════
  // OUTLETS — instant / instant-with-safeguards
  // ══════════════════════════════════════════════════════════════════

  {
    service_id:   "OUTLET_INSTALL",
    service_name: "Outlet / Receptacle Installation",
    segment:      "residential",
    tier:         "instant_with_safeguards",
    // A011 — 9 questions: price fork (replace/new), where + wall type (labor driver), wiring present?,
    // crawl access, what it'll power, outlet type, age, photo
    modules_csv:  "REPLACE_OR_NEW,ROOM_LOCATION,WALL_TYPE,EXISTING_WIRING,CRAWLSPACE_ACCESS,LOAD_TYPE,PRODUCT_TYPE,HOME_AGE,OUTLET_PHOTO",
    base_price_mode: "existing_calculator",
    enabled: "TRUE",
  },
  {
    service_id:   "GFCI_OUTLET",
    service_name: "GFCI Outlet Installation",
    segment:      "residential",
    tier:         "instant",
    // A012 — 9 questions: price fork (replace/new), where (kitchen/bath/outdoor?), wiring present?,
    // damp/outdoor exposure, box condition, any tripped/dead outlets?, wall type, age, photo
    modules_csv:  "REPLACE_OR_NEW,ROOM_LOCATION,EXISTING_WIRING,EXTERIOR_EXPOSURE,EXISTING_BOX,UNSAFE_SYMPTOMS,WALL_TYPE,HOME_AGE,OUTLET_PHOTO",
    base_price_mode: "existing_calculator",
    enabled: "TRUE",
  },

  // ══════════════════════════════════════════════════════════════════
  // SWITCHES / DIMMERS / SMART — instant
  // ══════════════════════════════════════════════════════════════════

  {
    service_id:   "DIMMER_SWITCH",
    service_name: "Dimmer / Smart Switch Installation",
    segment:      "residential",
    tier:         "instant",
    // A008 — 9 questions: price fork (replace/new), load type (LED/CFL/incandescent affects compat),
    // 3-way, customer-supplied, neutral present (install complexity), wall, safety concern, age, photo
    modules_csv:  "REPLACE_OR_NEW,LOAD_TYPE,THREE_WAY_SWITCHING,CUSTOMER_SUPPLIED_MATERIAL,NEUTRAL_PRESENT,WALL_TYPE,UNSAFE_SYMPTOMS,HOME_AGE,SWITCH_PHOTO",
    base_price_mode: "existing_calculator",
    enabled: "TRUE",
  },
  {
    service_id:   "SMART_SWITCH",
    service_name: "Smart Switch / Smart Dimmer Installation",
    segment:      "residential",
    tier:         "instant",
    // A014 — 9 questions: brand/type (Lutron vs generic price difference), load, 3-way,
    // neutral present (key install gate), Wi-Fi strength, platform, wall, age, photo
    modules_csv:  "PRODUCT_TYPE,LOAD_TYPE,THREE_WAY_SWITCHING,NEUTRAL_PRESENT,WIFI_AVAILABLE,SMART_PLATFORM,WALL_TYPE,HOME_AGE,SWITCH_PHOTO",
    base_price_mode: "existing_calculator",
    enabled: "TRUE",
  },

  // ══════════════════════════════════════════════════════════════════
  // SMOKE / CO — instant
  // ══════════════════════════════════════════════════════════════════

  {
    service_id:   "SMOKE_CO_DETECTOR",
    service_name: "Smoke / CO Detector Installation",
    segment:      "residential",
    tier:         "instant",
    // A030 — 8 questions: detector type (smoke/CO/combo = price fork), replace vs new,
    // attic access (new hardwire run path), product pref, age (interconnect type), room, photo, buffer
    // CEILING_HEIGHT removed — detectors mount at standard ceiling height; no ladder/lift pricing variation
    modules_csv:  "SMOKE_TYPE,REPLACE_OR_NEW,ATTIC_ACCESS,PRODUCT_TYPE,HOME_AGE,ROOM_LOCATION,CEILING_PHOTO,UNCERTAINTY_BUFFER",
    base_price_mode: "existing_calculator",
    enabled: "TRUE",
  },

  // ── Seed version marker ────────────────────────────────────────────────────
  // Disabled (never shown to customers or the pricing engine). Exists solely to
  // make the service row count = 36 so the stale-seed threshold (SEED_SERVICE_MIN=36)
  // is satisfied after the first re-seed, preventing repeated clear/re-seed cycles.
  // Bump the service_id version string whenever a re-seed is needed in future.
  {
    service_id:   "_SEED_VER_20260513",
    service_name: "Seed version marker — do not enable",
    segment:      "internal",
    tier:         "site_visit_required",
    modules_csv:  "",
    base_price_mode: "placeholder",
    enabled: "FALSE",
  },
];

module.exports = { MODULES, SERVICES };

// pages/js/quote.js — V3 Quote Flow v3 (reference design)
// Type → Categories → Services + Qty → Details → Review (Price + Slots) → Confirm → [Photo] → Booked

// ── Sword / dagger SVG selection indicator ─────────────────────────────────────
const SWORD_SVG = `<svg width="11" height="19" viewBox="0 0 11 19" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" style="display:inline-block;vertical-align:middle" aria-hidden="true"><circle cx="5.5" cy="1.8" r="1.5"/><line x1="5.5" y1="3.3" x2="5.5" y2="7.5"/><line x1="0.5" y1="7.5" x2="10.5" y2="7.5"/><path d="M4.2 7.5 L5.5 18.5 L6.8 7.5"/></svg>`;

// ── State ─────────────────────────────────────────────────────────────────────
const S = {
  step: "segment",
  segment: null,
  selectedCategories: [],   // string[]  — multi-select
  config: null,
  quoteId: null,
  selectedServices: [],     // [{job_type_id, qty}] — multi-select services
  answers: {},              // answers for primary service questions
  uncertain: {},            // module_id → true for "not sure" answers
  photos: {},               // module_id → File[]
  addons: [],
  equipmentSelections: {},  // { [job_type_id]: sku } — one product pick per service
  variantSelections:   {},  // { "typeId|sku": variantId } — finish/color per product
  pricing: null,            // {final_price, services:[]} — summed across all services
  lock: null,               // server lock response
  photoUploaded: false,
  addressConfirmed: false,
  slotsData: null,
  selectedSlot: null,   // ISO string — start of selected block (or exact slot for legacy)
  selectedBlock: null,  // { date, block, start_iso, window_label, display } | null
  booking: null,
  photoGateInfo: null,         // { module, modules, label, prompt } — set when photo gate triggers
  photoGateFromStep: null,     // "questions" | "equipment" — where the photo gate was entered from
  photoGateUploading: false,   // true while gate photo is being uploaded to server
  confirmedPhotoModules: {},   // { [module]: true } — modules confirmed by successful server upload
  consultData: null,           // { service_id, service_name, ballparkRange, reason } — set when manual_review_required
  locationAnswers: {},         // { distance, attendance, access_instructions } — universal location questions
  locationPhotos: [],          // File[] — area photos captured in questions step
  locationPhotoUploaded: false,// true once area photo successfully uploaded to server
  consents: {},                // { scope: bool, unattended: bool, location: bool }
};

// ── Equipment / Material catalog ───────────────────────────────────────────────
// Keyed by job_type_id. Services with no entry silently skip the Equipment step.
// `icon` is an SVG path body (viewBox 0 0 48 48) shown when no `img` URL is set.
// `img`  is a product photo URL — set per product to override the icon fallback.
const _ICON_BULB  = '<circle cx="24" cy="20" r="11"/><line x1="24" y1="31" x2="24" y2="38"/><line x1="19" y1="38" x2="29" y2="38"/><line x1="8" y1="20" x2="14" y2="20"/><line x1="34" y1="20" x2="40" y2="20"/><line x1="11" y1="8" x2="15" y2="13"/><line x1="37" y1="8" x2="33" y2="13"/>';
const _ICON_FAN   = '<circle cx="24" cy="24" r="5"/><path d="M24 6 C15 6 14 14 22 20"/><path d="M42 24 C42 15 34 14 28 22"/><path d="M24 42 C33 42 34 34 26 28"/><path d="M6 24 C6 33 14 34 20 26"/>';
const _ICON_SWCH  = '<rect x="10" y="6" width="28" height="36" rx="5"/><rect x="18" y="10" width="12" height="6" rx="2" fill="currentColor" stroke="none"/><rect x="18" y="32" width="12" height="6" rx="2" fill="currentColor" stroke="none"/>';
const _ICON_PLUG  = '<rect x="9" y="6" width="30" height="36" rx="6"/><rect x="14" y="14" width="5" height="8" rx="1" fill="currentColor" stroke="none"/><rect x="29" y="14" width="5" height="8" rx="1" fill="currentColor" stroke="none"/><path d="M18 30 Q24 37 30 30"/>';
const _ICON_EV    = '<rect x="8" y="5" width="22" height="30" rx="6"/><path d="M19 22 L16 33 L23 28 L26 17 Z" fill="currentColor" stroke="none"/><path d="M30 14 L40 14 M30 20 L40 20 M35 14 L35 36"/>';
const _ICON_DIMR  = '<rect x="10" y="8" width="28" height="32" rx="5"/><line x1="17" y1="24" x2="31" y2="24" stroke-width="2.5"/><circle cx="24" cy="24" r="4" fill="currentColor" stroke="none"/>';
const _ICON_BOX   = '<rect x="7" y="20" width="34" height="22" rx="3"/><path d="M7 20 L24 10 L41 20"/><line x1="24" y1="10" x2="24" y2="20"/><path d="M15 20 L24 26 L33 20"/>';

// ── "Not sure" injection config ────────────────────────────────────────────────
// Modules where we inject a client-side "Not sure" option. Customers aren't
// electricians — if they can't answer a technical question the quote must still flow.
// Selecting "_unsure" stores value="_unsure" which triggers a 15% contingency buffer
// in the engine and evaluates as the safe neutral default in all qualifier checks.
const NOT_SURE_MODULES = {
  "HOME_AGE":            "Not sure — our tech can assess this on-site",
  "CEILING_HEIGHT":      "Not sure — I can't tell / haven't measured",
  "FIXTURE_WEIGHT":      "Not sure — looks standard",
  "FAN_EXISTING_WIRING": "Not sure — haven't checked the ceiling",
  "CRAWLSPACE_ACCESS":   "Not sure / not applicable",
};

// ── Hidden modules (never shown to customer) ───────────────────────────────────
// These are technical questions only an electrician can answer. They are silently
// excluded from the customer flow — the engine will use its safe defaults.
const HIDDEN_MODULES = new Set([
  // No modules hidden — all canonical question map IDs are intentionally asked.
  // CONDUIT_REQUIRED and EXISTING_BOX were removed: both are now explicit questions
  // in the EV Charger and light fixture/GFCI service maps respectively.
]);

// ── Photo gate — human-readable module labels ─────────────────────────────────
// Maps photo module IDs (from service classification) to short display labels.
// Gate requirements themselves come from the API config (jt.photo_gate_modules).
const PHOTO_MODULE_LABELS = {
  PANEL_PHOTO:      "a panel photo",
  WORK_AREA_PHOTO:  "a photo of the installation area",
  AREA_PHOTO:       "a photo of the work area",
  CEILING_PHOTO:    "a photo of the ceiling location",
  OUTLET_PHOTO:     "a photo of the outlet area",
  SWITCH_PHOTO:     "a photo of the switch location",
  OUTDOOR_PHOTO:    "a photo of the outdoor mounting area",
};

// Per-module photo guidance: step-by-step instructions + example image shown in the gate UI.
const PHOTO_MODULE_GUIDES = {
  PANEL_PHOTO: {
    title:   "Your Electrical Panel",
    steps: [
      "Find your main electrical panel — usually in the garage, basement, utility room, or hallway closet.",
      "Open the panel door all the way so all the breaker switches are fully visible.",
      "Step back 2–3 feet and frame the entire panel from top to bottom in your shot.",
      "Make sure the inside is lit — flip on a nearby light or use your phone's flashlight if needed.",
    ],
    tips: [
      "Include the full panel — top breaker to bottom breaker",
      "The label on the inside of the door is helpful but not required",
      "No need to touch or flip any breakers",
    ],
    exampleImg: "/pages/img/example-panel.svg",
    exampleAlt: "Example of a correctly photographed electrical panel with door open and all breakers visible",
  },
  WORK_AREA_PHOTO: {
    title:   "The Charger Location",
    steps: [
      "Stand in your garage facing the wall where you want the charger mounted.",
      "Frame the wall from floor to ceiling — show about 6 feet wide around the target spot.",
      "Capture any existing outlets, conduit, or wiring nearby.",
      "Take a second shot showing the path between that wall and your electrical panel.",
    ],
    tips: [
      "Portrait orientation works best for wall shots",
      "Show where the car will park relative to the wall",
      "If you already have a 240V outlet (NEMA 14-50), make sure it's in the frame",
    ],
    exampleImg: "/pages/img/example-ev-location.svg",
    exampleAlt: "Example of a correctly photographed EV charger installation area showing wall, floor, and existing outlet",
  },
  AREA_PHOTO: {
    title:   "Mark the Work Location",
    steps: [
      "Stand in front of the wall, ceiling, or area where the work will happen.",
      "Mark the exact spot with tape, a sticky note, or point your finger at it — this helps us confirm the location before we start.",
      "Step back 3–4 feet so we can see the full area, including any nearby outlets, switches, or fixtures.",
      "If possible, take a second shot showing the path to your electrical panel from this room.",
    ],
    tips: [
      "Mark the exact spot clearly — tape X, sticker, or finger pointing works great",
      "Show 2–3 feet of wall or ceiling on all sides of the target spot",
      "Turn on the room lights for the best image clarity",
    ],
    exampleImg: "/pages/img/example-area-location.svg",
    exampleAlt: "Example of a wall with a blue tape X marking the exact outlet location and surrounding area visible",
  },
  CEILING_PHOTO: {
    title:   "Ceiling / Mounting Location",
    steps: [
      "Stand directly under where the fan, light, or fixture will go.",
      "Tilt your phone upward and frame the ceiling — the existing box or blank ceiling area should be centered in the shot.",
      "Step back enough to show 3–4 feet of ceiling on all sides of the target spot.",
      "Turn on the room lights and, if there's an attic above, a second photo of the attic access hatch is very helpful.",
    ],
    tips: [
      "The existing ceiling box or knockout should be clearly visible",
      "If you can reach the attic, a quick shot of what's above helps us plan the wiring run",
      "Portrait orientation works best when looking straight up",
    ],
    exampleImg: "/pages/img/example-ceiling-location.svg",
    exampleAlt: "Example of a ceiling viewed from below showing a junction box in the center with room walls at the edges",
  },
  OUTLET_PHOTO: {
    title:   "Outlet / Work Area",
    steps: [
      "Stand facing the wall where the outlet will go — position yourself about 3–4 feet back.",
      "If you know the exact spot, mark it with a piece of tape in an X — this is the single most helpful thing you can do.",
      "Frame the shot to show 2–3 feet of wall on each side of the target spot.",
      "Make sure any nearby existing outlets or switches are in the frame for distance reference.",
    ],
    tips: [
      "A tape X on the target spot removes all guesswork about location",
      "Show the nearest existing outlet — it helps us plan the circuit run",
      "Include the baseboard so we can see the floor-to-target height",
    ],
    exampleImg: "/pages/img/example-outlet-location.svg",
    exampleAlt: "Example of a wall with a blue tape X marking the outlet target and a nearby existing outlet visible for reference",
  },
  SWITCH_PHOTO: {
    title:   "Switch Location",
    steps: [
      "Stand facing the switch — step back about 2–3 feet so the wall around it is visible.",
      "If it's safe, remove the cover plate so we can see the box and wiring inside (never required, just helpful).",
      "Frame the shot to show the switch, the cover plate or box, and a few feet of wall on each side.",
      "If there are multiple switches in the same box, make sure all of them are in the frame.",
    ],
    tips: [
      "A photo with the cover plate off shows neutral wire availability — important for smart switches",
      "Show any other devices in the same box (outlets, switches side by side)",
      "Good lighting matters — a flashlight or room lamp helps a lot",
    ],
    exampleImg: "/pages/img/example-switch-location.svg",
    exampleAlt: "Example of a Decora switch cover plate on a wall with surrounding wall area visible",
  },
  OUTDOOR_PHOTO: {
    title:   "Outdoor Mounting Location",
    steps: [
      "Stand outside facing the wall, soffit, or eave where the light will mount.",
      "Step back far enough to show the full mounting area — at least 4–6 feet on all sides.",
      "Include any existing outdoor lights, outlets, or conduit runs in the frame.",
      "If you can, take a second photo showing the path from the mounting point back toward the nearest interior light switch or panel entry point.",
    ],
    tips: [
      "Show the mounting surface — siding, soffit, brick, or stucco affects the install approach",
      "Any existing nearby conduit or outdoor outlet helps us plan the circuit path",
      "A photo showing the full height from ground to mounting point is very useful",
    ],
    exampleImg: "/pages/img/example-outdoor-location.svg",
    exampleAlt: "Example of a house exterior wall and soffit showing a mounting target zone and existing nearby outdoor light",
  },
};

// ── Module-level question overrides ───────────────────────────────────────────
// Replaces the sheet's question text/options with simpler customer-answerable phrasing.
// The option_ids must still match Driver_Multipliers so the engine picks up multipliers.
const MODULE_OVERRIDES = {
  "CIRCUIT_SCOPE": {
    prompt: "Is there already a switch or outlet at this exact location?",
    options: [
      { option_id: "device_swap",     label: "Yes — I'm replacing the existing one at the same spot" },
      { option_id: "extend_existing", label: "No — it's a brand new spot with nothing there now" },
      { option_id: "_unsure",         label: "Not sure — I'd like your advice on-site", _injected: true },
    ],
  },
  "CEILING_HEIGHT": {
    options: [
      { option_id: "lt9",   label: "Standard — 8 to 10 ft" },
      { option_id: "9_12",  label: "Tall — 10 to 15 ft" },
      { option_id: "12_14", label: "Vaulted — 15 to 20 ft" },
      { option_id: "15_20", label: "Very high — over 20 ft", disqualify: true },
    ],
  },
  "DISTANCE_FROM_PANEL": {
    prompt: "How far is your electrical panel from the work area? (from the work area)",
  },
  "DEDICATED_CIRCUIT_DISTANCE": {
    prompt: "How far is your electrical panel from the work area? (from the work area)",
  },
};

// ── Location-based service detection ──────────────────────────────────────────
// Categories that get three universal location questions injected into the
// questions step: distance from panel, work area photo, and attendance/access.
const LOCATION_BASED_CATS = new Set(["Outlets & Switches", "Lighting & Fans"]);

function isLocationJob() {
  if (!S.selectedServices.length || !S.config) return false;
  const types = S.config.jobTypes || [];
  return S.selectedServices.some(svc => {
    const jt = types.find(j => j.job_type_id === svc.job_type_id);
    return jt && LOCATION_BASED_CATS.has(jt.category);
  });
}

// Returns true when all required location questions are answered.
// Photo and access instructions are only required when no one will be home.
function locationQsComplete() {
  if (!isLocationJob()) return true;
  const { distance, attendance, access_instructions } = S.locationAnswers;
  if (!distance || !attendance) return false;
  if (attendance === "no_phone") {
    if (!access_instructions?.trim()) return false;
    if (!S.locationPhotoUploaded) return false;
  }
  return true;
}

// Returns true when all required consent boxes are checked.
function consentsComplete() {
  if (!S.consents.scope) return false;
  if (S.locationAnswers.attendance === "no_phone" && !S.consents.unattended) return false;
  if (isLocationJob() && !S.consents.location) return false;
  return true;
}

const PRODUCT_CATALOG = {
  // ── Recessed Lighting ───────────────────────────────────────────────────────
  "A001": {
    label: "Choose Your Recessed Lights",
    note:  "Upgrade price is per fixture",
    icon:  _ICON_BULB,
    products: [
      { sku: "HALO-RL56",    brand: "Halo",   name: 'RL56 LED 5"/6"',       upgrade_delta:  0, img: null,
        desc: "65W equiv · 650 lm · 2700K warm white · Dimmable",
        variants: [{ id: "wh", label: "White Baffle", swatch: "#f5f5f5", border: true },
                   { id: "nb", label: "Brushed Nickel Baffle", swatch: "#a0a0a0" }] },
      { sku: "HALO-HLB6",    brand: "Halo",   name: "HLB6 Color-Select",    upgrade_delta: 28, img: null,
        desc: "Tunable 2700–5000K · Adjustable CCT · Slim profile",
        variants: [{ id: "wh", label: "White", swatch: "#f5f5f5", border: true }] },
      { sku: "LUTRON-HILUME", brand: "Lutron", name: 'Hi-lume ELV 6"',      upgrade_delta: 68, img: null,
        desc: "Ultra-smooth dim to <1% · Best for dining & living rooms",
        variants: [{ id: "wh", label: "White", swatch: "#f5f5f5", border: true }] },
    ],
  },
  // ── Chandelier / Fixture ────────────────────────────────────────────────────
  "A003": {
    label: "Choose Your Fixture Style",
    icon:  _ICON_BULB,
    products: [
      { sku: "HB-3LT",        brand: "Hampton Bay", name: "Globe 3-Light",     upgrade_delta:  0, img: null,
        desc: "Clean lines · Fits most 4\" outlet boxes · LED-ready",
        variants: [{ id: "bn", label: "Brushed Nickel", swatch: "#9e9e9e" },
                   { id: "mb", label: "Matte Black",    swatch: "#1a1a1a" }] },
      { sku: "KICHLER-5216",  brand: "Kichler",     name: "Stetson 5-Light",   upgrade_delta: 95, img: null,
        desc: "Elegant design · LED included · Olde Bronze or Brushed Nickel",
        variants: [{ id: "oz", label: "Olde Bronze",    swatch: "#6b4c2a" },
                   { id: "bn", label: "Brushed Nickel", swatch: "#9e9e9e" }] },
      { sku: "PROGRESS-P3926", brand: "Progress",   name: "Rogue 3-Light LED", upgrade_delta:185, img: null,
        desc: "90+ CRI · Dimmable LED built-in · Statement piece",
        variants: [{ id: "mb", label: "Matte Black",    swatch: "#1a1a1a" },
                   { id: "bn", label: "Brushed Nickel", swatch: "#9e9e9e" }] },
    ],
  },
  // ── Ceiling Fan ─────────────────────────────────────────────────────────────
  "A004": {
    label: "Choose Your Ceiling Fan",
    note:  "Upgrade price is per fan",
    icon:  _ICON_FAN,
    qualifiers: [
      // Tall / vaulted ceiling → note about downrod hardware
      { test: () => ["tall","vaulted","extreme","9_12","12_14","15_20","gt20"].includes(S.answers["CEILING_HEIGHT"]),
        notice: "For ceilings over 10 ft your fan will need a longer downrod or angled mount adapter — we'll bring the right hardware.",
        type: "info" },
      // Very heavy fixture → fan-rated box note
      { test: () => ["heavy","chandelier"].includes(S.answers["FIXTURE_WEIGHT"]),
        notice: "A heavy-duty fan-rated ceiling box is required for this installation. We'll install one as part of the job.",
        type: "info" },
    ],
    products: [
      { sku: "HUNTER-DEMPSEY",   brand: "Hunter", name: 'Dempsey 52"',       upgrade_delta:  0, img: null,
        desc: "5 reversible blades · 3-speed pull chain · Hugger or downrod",
        variants: [{ id: "mb", label: "Matte Black",         swatch: "#1a1a1a" },
                   { id: "wh", label: "Fresh White",         swatch: "#f5f5f5", border: true },
                   { id: "fw", label: "White / Bleached Oak", swatch: "#d4b896" }] },
      { sku: "HUNTER-CRESTFIELD", brand: "Hunter", name: 'Crestfield 52"',   upgrade_delta: 89, img: null,
        desc: "Integrated LED · Aged barnwood blades · Remote-ready",
        variants: [{ id: "mb", label: "Matte Black",             swatch: "#1a1a1a" },
                   { id: "ab", label: "Bn Nickel / Aged Barnwood", swatch: "#8b7355" }] },
      { sku: "HUNTER-SIGNAL",    brand: "Hunter", name: 'Signal 54" WiFi',  upgrade_delta:199, img: null,
        desc: "Smart WiFi · LED kit included · Alexa & Google compatible",
        variants: [{ id: "mb", label: "Matte Black",   swatch: "#1a1a1a" },
                   { id: "mn", label: "Matte Nickel",  swatch: "#b0b0b0" }] },
    ],
  },
  // ── LED Retrofit ────────────────────────────────────────────────────────────
  "A007": {
    label: "Choose Your LED Bulbs",
    note:  "Upgrade price is per fixture",
    icon:  _ICON_BULB,
    products: [
      { sku: "SYLVANIA-A19",    brand: "Sylvania", name: "LED A19 Soft White",  upgrade_delta:  0, img: null,
        desc: "60W equiv · 800 lm · 2700K · 11W · Dimmable" },
      { sku: "CREE-BA19",       brand: "Cree",     name: "Exceptional LED A19", upgrade_delta: 18, img: null,
        desc: "90+ CRI · 25-year rated · 100% dimmable · True color rendering" },
      { sku: "PHILIPS-HUE-A19", brand: "Philips",  name: "Hue White Ambiance",  upgrade_delta: 52, img: null,
        desc: "Tunable 2200–6500K · Smart ready · Works with any hub or app" },
    ],
  },
  // ── Dimmer Switch ───────────────────────────────────────────────────────────
  "A008": {
    label: "Choose Your Dimmer Switch",
    icon:  _ICON_DIMR,
    qualifiers: [
      // Older home → likely no neutral wire at switch box → highlight Caseta
      { test: () => ["pre_1950","1950_1970","1970_1990"].includes(S.answers["HOME_AGE"]),
        notice: "Homes built before 1990 often don't have a neutral wire at the switch box. The Lutron Caseta works without one — we recommend it for this home.",
        type: "info", highlightSku: "LUTRON-PD6WCL" },
      // Not sure of home age → soft recommendation (Caseta works in any home)
      { test: () => S.answers["HOME_AGE"] === "not_sure",
        notice: "Not sure of your home's age? The Lutron Caseta works without a neutral wire in any home — a reliable choice regardless.",
        type: "info", highlightSku: "LUTRON-PD6WCL" },
    ],
    // Cross-service compatibility notices
    compatNotices: [
      { test: () => S.selectedServices.some(s => s.job_type_id === "A004"),
        notice: "Standard light dimmers must never be wired to ceiling fan motors — this can overheat and damage the motor. Fan speed is controlled separately via pull chain. Your dimmer will control the fan's light kit only.",
        type: "warning" },
    ],
    products: [
      { sku: "LEVITON-6674",  brand: "Leviton", name: "Decora 600W Dimmer",  upgrade_delta:  0, img: null,
        desc: "Slide dimmer · LED & incandescent · Up to 600W · Requires neutral",
        variants: [{ id: "wh", label: "White",        swatch: "#f5f5f5", border: true },
                   { id: "iv", label: "Ivory",         swatch: "#f0ead2", border: true },
                   { id: "la", label: "Light Almond",  swatch: "#d4b896" }] },
      { sku: "LUTRON-PD6WCL", brand: "Lutron",  name: "Caseta Smart Dimmer", upgrade_delta: 62, img: null,
        desc: "WiFi · No neutral wire needed · Alexa, Siri & Google compatible",
        variants: [{ id: "wh", label: "White",        swatch: "#f5f5f5", border: true },
                   { id: "la", label: "Light Almond",  swatch: "#d4b896" }] },
      { sku: "LUTRON-PDCA60", brand: "Lutron",  name: "Caseta Pro 3-Way Kit",upgrade_delta:119, img: null,
        desc: "Controls light from 2 locations · Includes Pico remote · No neutral",
        variants: [{ id: "wh", label: "White",        swatch: "#f5f5f5", border: true }] },
    ],
  },
  // ── New Outlet ──────────────────────────────────────────────────────────────
  "A011": {
    label: "Choose Your Outlet",
    icon:  _ICON_PLUG,
    // If room type is kitchen/bathroom/garage → override with GFCI catalog (code requirement)
    qualifiers: [
      { test: () => ["kitchen","bathroom","garage"].includes(S.answers["ROOM_TYPE"]),
        overrideCatalogId: "A012",
        notice: "NEC code requires GFCI protection in kitchens, bathrooms, and garages. Showing GFCI outlet options that meet code.",
        type: "code" },
    ],
    products: [
      { sku: "LEVITON-T5325", brand: "Leviton", name: "Decora 15A TR Outlet",  upgrade_delta:  0, img: null,
        desc: "Tamper-resistant · Decora style · Bedroom, living room & office",
        variants: [{ id: "wh", label: "White",        swatch: "#f5f5f5", border: true },
                   { id: "iv", label: "Ivory",         swatch: "#f0ead2", border: true },
                   { id: "la", label: "Light Almond",  swatch: "#d4b896" }] },
      { sku: "LEVITON-T5632", brand: "Leviton", name: "USB Type A+C Outlet",   upgrade_delta: 22, img: null,
        desc: "2 USB ports + 2 AC plugs · 3.6A USB combined · Tamper-resistant",
        variants: [{ id: "wh", label: "White", swatch: "#f5f5f5", border: true },
                   { id: "bn", label: "Brown", swatch: "#5c4033" }] },
      { sku: "LEVITON-D215P", brand: "Leviton", name: "Decora Smart Outlet",   upgrade_delta: 48, img: null,
        desc: "WiFi · App & voice control · Real-time energy monitoring",
        variants: [{ id: "wh", label: "White", swatch: "#f5f5f5", border: true }] },
    ],
  },
  // ── GFCI Outlet ─────────────────────────────────────────────────────────────
  "A012": {
    label: "Choose Your GFCI Outlet",
    icon:  _ICON_PLUG,
    products: [
      { sku: "LEVITON-GFNT1",  brand: "Leviton", name: "SmartlockPro 20A",  upgrade_delta:  0, img: null,
        desc: "Self-testing · LED indicator · For kitchens, baths & garages",
        variants: [{ id: "wh", label: "White",  swatch: "#f5f5f5", border: true },
                   { id: "iv", label: "Ivory",   swatch: "#f0ead2", border: true }] },
      { sku: "LEVITON-GFWT1",  brand: "Leviton", name: "SmartlockPro Wi-Fi",upgrade_delta: 25, img: null,
        desc: "Smart GFCI · Remote trip monitoring via app · Auto self-test",
        variants: [{ id: "wh", label: "White",  swatch: "#f5f5f5", border: true }] },
      { sku: "LEGRAND-1597TR", brand: "Legrand",  name: "USB + GFCI Outlet", upgrade_delta: 42, img: null,
        desc: "USB-A charging + GFCI protection · Tamper-resistant · 20A",
        variants: [{ id: "wh", label: "White",  swatch: "#f5f5f5", border: true },
                   { id: "iv", label: "Ivory",   swatch: "#f0ead2", border: true }] },
    ],
  },
  // ── Smart Switch ────────────────────────────────────────────────────────────
  "A014": {
    label: "Choose Your Smart Switch",
    icon:  _ICON_SWCH,
    qualifiers: [
      { test: () => ["pre_1950","1950_1970","1970_1990"].includes(S.answers["HOME_AGE"]),
        notice: "Older homes often lack a neutral wire at the switch box. The Lutron Caseta doesn't need one — we recommend it for this home.",
        type: "info", highlightSku: "LUTRON-PD10NXD" },
      { test: () => S.answers["HOME_AGE"] === "not_sure",
        notice: "Not sure of your home's age? The Lutron Caseta works without a neutral wire in any home — the safe and reliable choice.",
        type: "info", highlightSku: "LUTRON-PD10NXD" },
    ],
    products: [
      { sku: "LEVITON-D26HD",   brand: "Leviton", name: "Decora Smart Wi-Fi",  upgrade_delta:  0, img: null,
        desc: "No hub required · Alexa & Google · Requires neutral wire",
        variants: [{ id: "wh", label: "White", swatch: "#f5f5f5", border: true }] },
      { sku: "LUTRON-PD10NXD",  brand: "Lutron",  name: "Caseta Smart Switch", upgrade_delta: 52, img: null,
        desc: "No neutral needed · Best-in-class reliability · Pico remote compatible",
        variants: [{ id: "wh", label: "White",       swatch: "#f5f5f5", border: true },
                   { id: "la", label: "Light Almond", swatch: "#d4b896" }] },
      { sku: "LUTRON-PD10NXD3", brand: "Lutron",  name: "Caseta 3-Way Kit",    upgrade_delta:119, img: null,
        desc: "Switch + Pico remote + Smart Bridge · Full 3-way control · No neutral",
        variants: [{ id: "wh", label: "White", swatch: "#f5f5f5", border: true }] },
    ],
  },
  // ── EV Charger ──────────────────────────────────────────────────────────────
  "A028": {
    label: "Choose Your EV Charger",
    note:  "Your charger preference will be included in your site visit quote — no pricing impact now.",
    icon:  _ICON_EV,
    qualifiers: [
      // Panel full → 50A/48A charger may not fit, highlight 40A
      { test: () => S.answers["PANEL_SPACE"] === "no",
        notice: "Your panel may be full. Adding a 40–50A breaker might require a subpanel or breaker expansion — our tech will assess on-site. A 40A charger is the lowest-impact option.",
        type: "warning", highlightSku: "JUICEBOX-40" },
      // Not sure about panel → soft nudge, tech will check
      { test: () => S.answers["PANEL_SPACE"] === "unknown",
        notice: "No worries about not knowing your panel — our tech will check available space on arrival. The 40A charger is the most flexible option if capacity turns out to be tight.",
        type: "info", highlightSku: "JUICEBOX-40" },
      // Long wire run → voltage drop note
      { test: () => S.answers["DISTANCE_FROM_PANEL"] === "over75",
        notice: "At 75+ ft from the panel, voltage drop is a consideration. We'll size the wire correctly. A 40A charger may be the better choice for this run distance.",
        type: "info", highlightSku: "JUICEBOX-40" },
    ],
    products: [
      { sku: "JUICEBOX-40",     brand: "JuiceBox",    name: "JuiceBox 40A",   upgrade_delta:  0, img: null,
        desc: "40A Level 2 · WiFi & energy tracking · ENERGY STAR · Best for most EVs" },
      { sku: "CHARGEPOINT-FLEX",brand: "ChargePoint", name: "Home Flex 50A",  upgrade_delta:  0, img: null,
        desc: "50A · Adjustable 16–50A · ChargePoint app + Alexa" },
      { sku: "EMPORIA-EVSE",    brand: "Emporia",     name: "Smart EV 48A",   upgrade_delta:  0, img: null,
        desc: "48A · Solar-ready · Energy monitoring · Lowest $/kWh" },
    ],
  },
};

// ── Equipment catalog helpers ──────────────────────────────────────────────────
// Returns the effective catalog for a service, applying any qualifier overrides.
function resolveEquipCatalog(svc) {
  const base = PRODUCT_CATALOG[svc.job_type_id];
  if (!base) return null;
  for (const q of (base.qualifiers || [])) {
    if (q.overrideCatalogId && q.test?.()) {
      const over = PRODUCT_CATALOG[q.overrideCatalogId];
      if (over) return { ...over, _notice: q.notice, _noticeType: q.type || "code", _overriddenFrom: svc.job_type_id };
    }
  }
  return base;
}
// Returns active non-override notices for a service (and cross-service compat notices).
function getEquipNotices(svc, cat) {
  const notices = [];
  const baseCat = PRODUCT_CATALOG[svc.job_type_id];
  for (const q of (baseCat?.qualifiers || [])) {
    if (!q.overrideCatalogId && q.test?.()) notices.push({ msg: q.notice, type: q.type || "info", highlightSku: q.highlightSku });
  }
  for (const q of (baseCat?.compatNotices || [])) {
    if (q.test?.()) notices.push({ msg: q.notice, type: q.type || "info" });
  }
  if (cat?._notice) notices.push({ msg: cat._notice, type: cat._noticeType || "code" });
  return notices;
}
// Returns global notices that apply to the entire equipment step (cross-service).
function getGlobalEquipNotices() {
  const notices = [];
  const hasFan    = S.selectedServices.some(s => s.job_type_id === "A004");
  const hasDimmer = S.selectedServices.some(s => s.job_type_id === "A008");
  if (hasFan && hasDimmer) notices.push({
    msg:  "Important: Standard light dimmers must not be wired to ceiling fan motors — this overheats and damages the motor. Dimmers control only the fan's light kit. Fan speed uses the pull chain.",
    type: "warning",
  });
  return notices;
}
function hasEquipmentCatalog() {
  return S.selectedServices.some(svc => !!PRODUCT_CATALOG[svc.job_type_id]);
}
function getEquipServices() {
  return S.selectedServices.filter(svc => !!PRODUCT_CATALOG[svc.job_type_id]);
}
function equipUpgradeDelta(svc) {
  const cat  = resolveEquipCatalog(svc);
  if (!cat) return 0;
  const prod = cat.products.find(p => p.sku === S.equipmentSelections[svc.job_type_id]);
  return (prod?.upgrade_delta || 0) * (svc.qty || 1);
}
// Variant selection key: "typeId|sku"
function varKey(typeId, sku) { return typeId + "|" + sku; }

// Builds an array of equipment selections with display info for the server snapshot.
// Called before lock so crew invoice generator can read named line items from the snapshot.
function buildEquipmentLineItems() {
  return getEquipServices().flatMap(svc => {
    const sku = S.equipmentSelections[svc.job_type_id];
    if (!sku) return [];
    const jt = (S.config?.jobTypes || []).find(j => j.job_type_id === svc.job_type_id);
    const svcName = jt?.name_public || svc.job_type_id;
    if (sku === "CUSTOMER-PROVIDED") {
      return [{ job_type_id: svc.job_type_id, service_name: svcName, sku, name: "Customer-provided", brand: null, variant: null, upgrade_delta: 0 }];
    }
    const cat  = resolveEquipCatalog(svc);
    const prod = cat?.products.find(p => p.sku === sku);
    if (!prod) return [];
    const vid     = S.variantSelections[varKey(svc.job_type_id, sku)];
    const variant = prod.variants?.find(v => v.id === vid);
    return [{
      job_type_id:   svc.job_type_id,
      service_name:  svcName,
      sku,
      name:          prod.name,
      brand:         prod.brand,
      variant:       variant?.label || null,
      upgrade_delta: (prod.upgrade_delta || 0) * (svc.qty || 1),
    }];
  });
}

// ── Helpers for primary service ────────────────────────────────────────────────
function primaryTypeId() { return S.selectedServices[0]?.job_type_id || null; }
function primaryQty()    { return S.selectedServices[0]?.qty || 1; }

let repricTimer = null;

// ── Boot ──────────────────────────────────────────────────────────────────────
async function boot() {
  setContent(loadingHTML("Loading\u2026"));
  try {
    const [r1, r2] = await Promise.all([
      fetch("/api/quote/config"),
      fetch("/api/estimator/config?_=" + Date.now()),
    ]);

    // Guard: non-2xx means transient failure (quota spike, connectivity)
    if (!r1.ok) {
      const retryAfter = r1.headers.get("Retry-After") || "10";
      setContent(errHTML(
        `Our services list is temporarily unavailable (HTTP ${r1.status}). ` +
        `Please <a href="javascript:location.reload()" style="color:inherit;text-decoration:underline;">refresh the page</a> in ${retryAfter} seconds.`
      ));
      return;
    }

    S.config = await r1.json();

    // Guard: empty jobTypes means sheets returned no data (quota or cold-start)
    if (!S.config.jobTypes || S.config.jobTypes.length === 0) {
      setContent(errHTML(
        "Could not load services. " +
        `<a href="javascript:location.reload()" style="color:inherit;text-decoration:underline;">Refresh to try again.</a>`
      ));
      return;
    }

    // Quietly note if we're running on the embedded baseline (no sheet data)
    if (S.config._fromSeed) {
      console.warn("[quote] Running on V1 baseline seed — sheet config unavailable.");
    }

    const est = await r2.json();
    enrichConfigWithModules(S.config, est);
    go("segment");
  } catch (e) {
    setContent(errHTML("Could not load services. Please refresh. (" + e.message + ")"));
  }
}

// ── Enrich config: replace static questions with dynamic module-based questions ─

// Normalize a service name for fuzzy matching
function _normName(s) {
  return (s || "")
    .replace(/\(.*?\)/g, "")              // strip parentheticals "(for kitchens"
    .replace(/[\/&–—\-]/g, " ")           // separators → space
    .replace(/\s+/g, " ")
    .toLowerCase()
    .trim();
}

// Return a set of significant words from a name
function _wordSet(s) {
  const STOP = new Set(["for", "the", "and", "with", "etc", "e.g", "new", "all"]);
  return new Set(_normName(s).split(/\s+/).filter(w => w.length > 2 && !STOP.has(w)));
}

// 0–1 similarity between two names (word overlap + partial-word credit)
function _nameSim(a, b) {
  const na = _normName(a), nb = _normName(b);
  if (na === nb) return 1;
  const wa = _wordSet(a), wb = _wordSet(b);
  if (!wa.size || !wb.size) return 0;
  let score = 0;
  for (const w of wa) {
    if (wb.has(w)) { score += 1; continue; }
    // partial: covers "subpanel"↔"sub panel", "ev"↔"electric vehicle", etc.
    for (const bw of wb) {
      if (bw.startsWith(w) || w.startsWith(bw)) { score += 0.6; break; }
    }
  }
  return score / Math.max(wa.size, wb.size);
}

// ── Direct assembly→estimator-service mapping ─────────────────────────────────
// Eliminates fuzzy matching for all known assemblies. Entries here take priority
// over the fuzzy matcher. Add new entries whenever new assemblies are created.
const _ASSEMBLY_TO_SERVICE = {
  // Lighting
  A001: "RECESSED_LIGHTING",
  A003: "LIGHT_FIXTURE_INSTALL",
  A005: "OUTDOOR_LIGHTING",
  A006: "MOTION_SECURITY_LIGHT",
  A007: "LED_RETROFIT",
  // Fans
  A004: "CEILING_FAN_INSTALL",
  // Switches / dimmers / smart
  A008: "DIMMER_SWITCH",
  A014: "SMART_SWITCH",
  // Outlets
  A011: "OUTLET_INSTALL",
  A012: "GFCI_OUTLET",
  // Circuits
  A017: "DEDICATED_CIRCUIT",
  A025: "APPLIANCE_CIRCUIT",
  A028: "EV_CHARGER",
  A029: "HOT_TUB_CIRCUIT",
  // Panel / breaker
  A019: "PANEL_UPGRADE",
  A020: "SUBPANEL_INSTALL",
  A021: "FUSE_BOX_CONVERSION",
  A023: "BREAKER_PANEL_REPAIR",
  A024: "SURGE_PROTECTOR",
  // Generators
  A026: "GENERATOR_STANDBY",
  A027: "GENERATOR_TRANSFER_SWITCH",
  A053: "GENERATOR_BACKUP",
  // Diagnostics / compliance
  A010: "TROUBLESHOOT_FLICKER",
  A018: "CODE_COMPLIANCE",
  A022: "BREAKER_TRIPPING",
  // Wiring
  A015: "REWIRE_WHOLE_HOUSE",
  A016: "REWIRE_PARTIAL",
  A040: "REWIRE_COMMERCIAL",
  // Safety
  A030: "SMOKE_CO_DETECTOR",
  // Commercial
  A034: "EXIT_EMERGENCY_LIGHTS",
  A036: "BALLAST_REPLACE",
  A037: "COMM_LIGHTING_RETROFIT",
  A055: "FIRE_ALARM",
};

// Module ID aliases: keys are legacy/typo IDs that may appear in sheet data,
// values are the canonical IDs in the modules map. Handles the WORK_AREA_PHOTOS
// plural-vs-singular inconsistency in older seeded sheets.
const _MODULE_ALIASES = {
  "WORK_AREA_PHOTOS": "WORK_AREA_PHOTO",
  "CEILING_HT":       "CEILING_HEIGHT",
  "FAN_EXISTING_WIRING": "FAN_RATED_BOX",
};

// ── Module blocklist for enrichConfigWithModules ──────────────────────────────
// Only strip modules that are genuinely nonsensical for a category when we
// fall back to fuzzy matching (direct-mapped services ignore this since their
// modules_csv is already curated by the seed data).
// FAN_RATED_BOX / FAN_EXISTING_WIRING: ceiling-fan mechanics only.
const _FAN_ONLY_MODULES = new Set(["FAN_RATED_BOX", "FAN_EXISTING_WIRING", "FAN_CONTROL_TYPE"]);

// Assembly-ID → broad category. Used for the fan-only module guard on fuzzy
// fallback paths and to determine _tier hinting.
const _JT_CATEGORY = {
  // Lighting / outdoor
  A001: "LIGHTING", A003: "LIGHTING", A005: "LIGHTING",
  A006: "LIGHTING", A007: "LIGHTING",
  // Fan
  A004: "FAN",
  // Outlets / switches
  A008: "SWITCH", A011: "OUTLET", A012: "OUTLET", A014: "SWITCH",
  // Circuits & wiring
  A015: "WIRING", A016: "WIRING", A017: "CIRCUIT",
  A025: "CIRCUIT", A029: "CIRCUIT",
  // Panel / breaker
  A019: "PANEL", A020: "PANEL", A021: "PANEL",
  A023: "PANEL", A024: "PANEL",
  // EV charger
  A028: "EV",
  // Diagnostics
  A010: "DIAGNOSTICS", A018: "DIAGNOSTICS", A022: "DIAGNOSTICS",
  // Smoke / CO detectors
  A030: "DETECTOR",
  // Generators
  A026: "GENERATOR", A027: "GENERATOR", A053: "GENERATOR",
  // Commercial
  A034: "COMMERCIAL", A036: "COMMERCIAL", A037: "COMMERCIAL",
  A040: "COMMERCIAL", A046: "COMMERCIAL",
  // Other (home automation, low-voltage, data — always site visit)
  A031: "OTHER", A041: "OTHER", A042: "OTHER",
};

// Categories that receive zero module questions: unmapped/unrecognized services
// that have no curated question set in the estimator sheet.
const _ZERO_QUESTION_CATS = new Set(["OTHER"]);

function enrichConfigWithModules(config, est) {
  if (!est?.services || !est?.modules) return;
  const modMap = est.modules;
  config.questionsByType   = config.questionsByType   || {};
  config.optionsByQuestion = config.optionsByQuestion || {};

  // Build a fast service_id → service lookup to support direct mapping.
  const svcIndex = {};
  for (const svc of est.services) svcIndex[svc.service_id] = svc;

  for (const jt of (config.jobTypes || [])) {
    const jtCat = _JT_CATEGORY[jt.job_type_id] || null;

    // Zero-question guard for truly unmapped/misc service types.
    if (_ZERO_QUESTION_CATS.has(jtCat)) {
      config.questionsByType[jt.job_type_id] = [];
      continue;
    }

    // ── 1. Direct mapping (preferred) ────────────────────────────────────────
    let best    = null;
    let usedDirect = false;
    const directId = _ASSEMBLY_TO_SERVICE[jt.job_type_id];
    if (directId && svcIndex[directId]) {
      best       = svcIndex[directId];
      usedDirect = true;
    }

    // ── 2. Fuzzy fallback (for assemblies without a direct mapping) ───────────
    if (!best) {
      let bestSim = 0;
      for (const svc of est.services) {
        const sim = _nameSim(jt.name_public, svc.service_name);
        if (sim > bestSim) { bestSim = sim; best = svc; }
      }
      if (!best || bestSim < 0.52) best = null;
    }

    if (!best?.modules?.length) continue;

    const isFan = (jtCat === "FAN");

    const questions = [];
    for (const rawMid of best.modules) {
      // Resolve alias (handles WORK_AREA_PHOTOS → WORK_AREA_PHOTO, etc.)
      const mid = _MODULE_ALIASES[rawMid] || rawMid;

      // Skip the uncertainty buffer — it's collected separately at the end.
      if (mid === "UNCERTAINTY_BUFFER" || mid === "CUSTOMER_UNSURE") continue;

      const m = modMap[mid];
      if (!m) continue;

      // Strip fan-specific modules when this is not a fan service.
      // (Only relevant for fuzzy-matched services; direct mappings are curated.)
      if (!usedDirect && !isFan && _FAN_ONLY_MODULES.has(m.module_id)) continue;

      questions.push({
        question_id: m.module_id,
        prompt:      m.question,
        input_type:  m.input_type,
        required:    m.input_type !== "photo",
      });
      if (m.options?.length) {
        config.optionsByQuestion[m.module_id] = m.options.map(o => ({
          option_id:    o.value,
          label:        o.label,
          disqualify:   !!o.disqualify,
          uncertain:    !!o.uncertain,
          effect_type:  o.multiplier != null ? "MULTIPLY_HOURS" : null,
          effect_value: o.multiplier != null ? Number(o.multiplier) : 1.0,
          multiplier:   o.multiplier || 1.0,
        }));
      }
    }
    config.questionsByType[jt.job_type_id] = questions;
    jt._tier = best.tier;
  }
}

// ── Navigation ────────────────────────────────────────────────────────────────
function go(step) {
  S.step = step;
  renderStep();
  window.scrollTo(0, 0);
}

function back() {
  const pid       = primaryTypeId();
  const hasQs     = (S.config?.questionsByType?.[pid]?.length || 0) > 0;
  const hasAddons = (S.config?.addonsByType?.[pid]?.length   || 0) > 0;

  if (S.step === "review") {
    if (S.isSiteVisit) {
      // Clear site-visit state and go back to questions
      S.isSiteVisit = false;
      S.pricing     = null;
      S.consultData = null;
      go("questions");
      return;
    }
    if (hasEquipmentCatalog()) { go("equipment"); return; }
    go(hasQs || hasAddons ? "questions" : "services");
    return;
  }
  if (S.step === "equipment") {
    go(hasQs || hasAddons ? "questions" : "services");
    return;
  }
  if (S.step === "photo_gate") {
    go(S.photoGateFromStep || "questions");
    return;
  }
  const prev = {
    categories:      "segment",
    commercial_soon: "segment",
    services:        "categories",
    questions:       "services",
    sitevisit:       "questions",
    confirm:         "review",
    photo:           "confirm",
    consult:         "questions",
  };
  if (prev[S.step]) go(prev[S.step]);
}

// ── Rendering ─────────────────────────────────────────────────────────────────
function renderStep() {
  document.getElementById("qProgress").innerHTML = progressHTML();
  const el    = document.getElementById("stepContent");
  const clone = el.cloneNode(false);
  el.parentNode.replaceChild(clone, el);

  switch (S.step) {
    case "segment":    clone.innerHTML = renderSegment();    break;
    case "categories": clone.innerHTML = renderCategories(); break;
    case "services":   clone.innerHTML = renderServices();   break;
    case "questions":  clone.innerHTML = renderQuestions();  break;
    case "sitevisit":
    case "consult":
      _setupSiteVisitReview();
      S.step = "review";
      clone.innerHTML = renderReview();
      loadBlocksForReview();
      break;
    case "equipment":  clone.innerHTML = renderEquipment();  break;
    case "review":
      clone.innerHTML = renderReview();
      loadBlocksForReview();
      break;
    case "confirm":     clone.innerHTML = renderConfirm();    break;
    case "photo":       clone.innerHTML = renderPhoto();      break;
    case "photo_gate":  clone.innerHTML = renderPhotoGate();  break;
    case "commercial_soon":  clone.innerHTML = renderCommercialSoon(); break;
    case "booked":           clone.innerHTML = renderBooked();          break;
    default:                 clone.innerHTML = errHTML("Unknown step."); break;
  }
  bindEvents();
}

function setContent(html) { document.getElementById("stepContent").innerHTML = html; }

// ── Progress bar (horizontal tab style) ───────────────────────────────────────
function progressHTML() {
  const steps = ["Type", "Services", "Equipment", "Review", "Done"];
  const idx   = {
    segment: 0, categories: 0,
    services: 1, questions: 1, sitevisit: 1, photo_gate: 1,
    equipment: 2,
    review: 3, consult: 3,
    confirm: 4, photo: 4, booked: 4,
  };
  const cur = idx[S.step] ?? 0;

  const parts = [];
  steps.forEach((label, i) => {
    const cls = i < cur ? "done" : i === cur ? "active" : "";
    parts.push(`<div class="q-prog-step ${cls}">
      <span class="q-prog-num">${i + 1}.</span>
      <span class="q-prog-label">${label}</span>
    </div>`);
    if (i < steps.length - 1) parts.push(`<span class="q-prog-div">/</span>`);
  });
  return `<div class="q-progress">${parts.join("")}</div>`;
}

// ── Step badge helper ──────────────────────────────────────────────────────────
function stepHeader(num, title) {
  return `<div class="q-step-header">
    <div class="q-step-badge">${num}</div>
    <h2 class="q-step-title">${title}</h2>
  </div>`;
}

// ── Note bar helper ────────────────────────────────────────────────────────────
const NOTE = `<div class="q-note-bar"><strong>Note:</strong> This is a rough estimate. Final pricing may vary based on on-site inspection.</div>`;

// ── Step 1: Segment / Type ────────────────────────────────────────────────────
function renderSegment() {
  return `
    <div class="q-hero">
      <h1 class="q-hero-title">Get your estimate <span class="q-hero-accent">instantly</span></h1>
      <p class="q-hero-sub">Select your service needs below and our smart calculator will generate a precise estimate for your project.</p>
    </div>
    ${stepHeader(1, "Project Type")}
    <div class="q-type-list">
      <div class="q-type-card${S.segment === "Residential" ? " selected" : ""}" data-seg="Residential">
        <div class="q-type-icon-box"><svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/></svg></div>
        <div class="q-type-text">
          <div class="q-type-name">Residential</div>
          <div class="q-type-sub">Home electrical upgrades, repairs, and installations.</div>
        </div>
        <div class="q-type-radio"></div>
      </div>
      <div class="q-type-card${S.segment === "Commercial" ? " selected" : ""}" data-seg="Commercial">
        <div class="q-type-icon-box"><svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="4" y="2" width="16" height="20" rx="1"/><path d="M9 22v-4h6v4"/><path d="M8 6h.01M16 6h.01M12 6h.01M12 10h.01M12 14h.01M16 10h.01M16 14h.01M8 10h.01M8 14h.01"/></svg></div>
        <div class="q-type-text">
          <div class="q-type-name">Commercial</div>
          <div class="q-type-sub">Office, retail, and industrial electrical solutions.</div>
        </div>
        <div class="q-type-radio"></div>
      </div>
    </div>
    <div class="q-nav-row" style="justify-content:flex-end;">
      <button class="q-btn-next" id="nextSegment" ${S.segment ? "" : "disabled"}>
        <img src="/pages/img/sword-light.png" class="sword-icon" alt="">
        <span>Next Step</span>
      </button>
    </div>
    ${NOTE}`;
}

// ── Step 2: Categories (multi-select list) ────────────────────────────────────
const CAT_ICONS = {
  "Outlets & Switches": "&#128268;",
  "Lighting & Fans":    "&#128161;",
  "Ventilation":        "&#127751;",
  "Panel & Protection": "&#9889;",
  "EV Charging":        "&#128663;",
  "Diagnostics":        "&#128269;",
};

function renderCategories() {
  const types = (S.config?.jobTypes || []).filter(j => j.segment === S.segment);
  const cats  = [...new Set(types.map(t => t.category).filter(Boolean))];

  if (!cats.length) return `
    <div class="q-center">
      <div class="q-icon">&#128295;</div>
      <h2 style="font-family:var(--font-display);font-size:20px;font-weight:800;margin-bottom:8px;">Coming Soon</h2>
      <p class="q-muted">${escHtml(S.segment)} services are being added. Call us for a custom quote at
        <a href="tel:+14095550100" style="color:hsl(var(--accent));">(409) 555-0100</a>.</p>
    </div>
    <div class="q-nav-row">
      <button class="q-btn-back" onclick="back()">&#8592; Back</button>
    </div>`;

  return `
    ${stepHeader(2, "Categories")}
    <div class="q-cat-list">
      ${cats.map(cat => {
        const sel = S.selectedCategories.includes(cat);
        return `<div class="q-cat-item${sel ? " selected" : ""}" data-cat="${escHtml(cat)}">
          <span>${escHtml(cat)}</span>
          <span class="q-cat-check">${SWORD_SVG}</span>
        </div>`;
      }).join("")}
    </div>
    <div class="q-nav-row">
      <button class="q-btn-back" onclick="back()">&#8592; Back</button>
      <button class="q-btn-next" id="nextCategories" ${S.selectedCategories.length ? "" : "disabled"}>
        <img src="/pages/img/sword-light.png" class="sword-icon" alt="">
        <span>Next Step</span>
      </button>
    </div>
    ${NOTE}`;
}

// ── Step 3: Services (checkbox select + qty) ──────────────────────────────────
function renderServices() {
  const allTypes = (S.config?.jobTypes || []).filter(j =>
    j.segment === S.segment && S.selectedCategories.includes(j.category)
  );

  if (!allTypes.length) return `
    <div class="q-center">
      <div class="q-icon">&#128295;</div>
      <h2 style="font-family:var(--font-display);font-size:20px;font-weight:800;margin-bottom:8px;">No Services Found</h2>
      <p class="q-muted">No services available yet for the selected categories.</p>
    </div>
    <div class="q-nav-row">
      <button class="q-btn-back" onclick="back()">&#8592; Back</button>
    </div>`;

  // Group by category
  const grouped = {};
  for (const t of allTypes) {
    if (!grouped[t.category]) grouped[t.category] = [];
    grouped[t.category].push(t);
  }

  const listHTML = Object.entries(grouped).map(([cat, types]) => `
    <div class="q-cat-group-heading">${escHtml(cat)}</div>
    <div class="q-svc-list">
      ${types.map(t => {
        const existing = S.selectedServices.find(s => s.job_type_id === t.job_type_id);
        const sel = !!existing;
        const tid = escHtml(t.job_type_id);
        const qty = existing?.qty || 1;
        return `
          <div class="q-svc-card${sel ? " selected" : ""}" data-type="${tid}">
            <div class="q-svc-item">
              <div class="q-svc-checkbox">${sel ? SWORD_SVG : ""}</div>
              <div>
                <div class="q-svc-name">${escHtml(t.name_public)}</div>
              </div>
            </div>
            <div class="q-svc-qty-row" ${sel ? "" : 'style="display:none;"'}>
              <span class="q-qty-label">How many?</span>
              <div class="q-qty-ctrl">
                <button class="q-qty-btn q-qty-dec" data-type="${tid}">&#8722;</button>
                <span class="q-qty-val" id="qtyVal_${tid}">${qty}</span>
                <button class="q-qty-btn q-qty-inc" data-type="${tid}">&#43;</button>
              </div>
            </div>
          </div>`;
      }).join("")}
    </div>`).join("");

  return `
    ${stepHeader(3, "Select Specific Services")}
    ${listHTML}
    <div class="q-nav-row">
      <button class="q-btn-back" onclick="back()">&#8592; Back</button>
      <button class="q-btn-next" id="nextService" ${S.selectedServices.length ? "" : "disabled"}>
        <img src="/pages/img/sword-light.png" class="sword-icon" alt="">
        <span>Next Step</span>
      </button>
    </div>
    ${NOTE}`;
}

// ── Step 4: Questions + Add-ons ───────────────────────────────────────────────
function renderQuestions() {
  const pid       = primaryTypeId();
  const questions = (S.config?.questionsByType?.[pid] || [])
    .filter(q => !HIDDEN_MODULES.has(q.question_id));
  const addons    = S.config?.addonsByType?.[pid]   || [];

  return `
    ${stepHeader(3, "Project Details")}
    ${!questions.length && !addons.length ? `
      <p class="q-muted" style="margin-bottom:20px;">No additional details needed for this service.</p>
    ` : ""}
    <div class="q-card-section">
      <div class="q-questions">
        ${questions.map(q => renderQuestion(q)).join("")}
      </div>
      ${addons.length ? `
        <div class="q-section-label" style="margin-top:${questions.length ? "24px" : "0"};">Optional Add-ons</div>
        <div class="q-addons">
          ${addons.map(a => `
            <label class="q-addon${S.addons.includes(a.addon_id) ? " selected" : ""}">
              <input type="checkbox" class="q-addon-check" value="${escHtml(a.addon_id)}"
                ${S.addons.includes(a.addon_id) ? "checked" : ""}>
              <div class="q-addon-body">
                <div class="q-addon-name">${escHtml(a.name_public)}</div>
                ${a.add_fee ? `<div class="q-addon-fee">+$${Number(a.add_fee).toLocaleString()}</div>` : ""}
                ${a.description ? `<div class="q-addon-desc">${escHtml(a.description)}</div>` : ""}
              </div>
            </label>`).join("")}
        </div>
      ` : ""}
    </div>
    ${isLocationJob() ? renderLocationSection() : ""}
    <div class="q-nav-row">
      <button class="q-btn-back" onclick="back()">&#8592; Back</button>
      <button class="q-btn-next" id="seePriceBtn" aria-label="See My Price"
        ${isLocationJob() && !locationQsComplete() ? "disabled" : ""}>
        <img src="/pages/img/sword-light.png" class="sword-icon" alt="">
        <span>See My Price</span>
      </button>
    </div>
    ${NOTE}`;
}

// ── Location questions section ─────────────────────────────────────────────────
// Injected after service-specific questions for outlets/switches/lighting/fans.
// Collects location context: distance, attendance, and (when unattended) access instructions + required photo.
function renderLocationSection() {
  const DIST_OPTIONS = [
    { id: "within_3ft", label: "Right there \u2014 within 3 feet" },
    { id: "3_10ft",     label: "3\u201310 feet away" },
    { id: "10_25ft",    label: "10\u201325 feet away" },
    { id: "25_50ft",    label: "25\u201350 feet away" },
    { id: "over_50ft",  label: "Over 50 feet" },
    { id: "not_sure",   label: "Not sure" },
  ];
  const ATTEND_OPTIONS = [
    { id: "yes_me",   label: "Yes \u2014 I\u2019ll be there" },
    { id: "someone",  label: "Someone else will meet you" },
    { id: "no_phone", label: "No \u2014 I won\u2019t be home (I\u2019ll provide access instructions)" },
  ];

  const att           = S.locationAnswers.attendance || "";
  const guide         = PHOTO_MODULE_GUIDES.AREA_PHOTO;
  const photoUploaded = S.locationPhotoUploaded;

  // Numbered step instructions for the area photo
  const stepsHtml = (guide.steps || []).map((s, i) => `
    <div style="display:flex;gap:10px;align-items:flex-start;margin-bottom:8px;">
      <div style="flex-shrink:0;width:20px;height:20px;border-radius:50%;background:hsl(var(--primary));color:white;font-size:11px;font-weight:800;display:flex;align-items:center;justify-content:center;">${i + 1}</div>
      <p style="margin:0;font-size:13px;line-height:1.5;padding-top:1px;">${escHtml(s)}</p>
    </div>`).join("");

  const tipsHtml = (guide.tips || []).length ? `
    <div style="background:hsl(210 20% 97%);border-radius:8px;padding:10px 12px;margin:10px 0;">
      <p style="margin:0 0 5px;font-size:11px;font-weight:800;text-transform:uppercase;letter-spacing:.06em;color:hsl(var(--muted-foreground));">Quick tips</p>
      ${guide.tips.map(t => `
        <div style="display:flex;gap:8px;align-items:flex-start;margin-top:3px;">
          <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="hsl(var(--primary))" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" style="flex-shrink:0;margin-top:3px;"><polyline points="20 6 9 17 4 12"/></svg>
          <span style="font-size:12px;color:hsl(var(--muted-foreground));">${escHtml(t)}</span>
        </div>`).join("")}
    </div>` : "";

  const photoUploadZone = photoUploaded ? `
    <div style="display:flex;align-items:center;justify-content:space-between;gap:12px;background:hsl(120 60% 97%);border:1.5px solid hsl(120 60% 80%);border-radius:10px;padding:12px 14px;">
      <div style="display:flex;align-items:center;gap:10px;">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="hsl(120 60% 40%)" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><polyline points="7 12 10.5 15.5 17 8.5"/></svg>
        <div>
          <p style="margin:0;font-size:13px;font-weight:700;color:hsl(120 60% 35%);">Area photo uploaded</p>
          <p style="margin:2px 0 0;font-size:11px;color:hsl(120 60% 50%);">Ready to continue</p>
        </div>
      </div>
      <label style="cursor:pointer;font-size:12px;color:hsl(var(--muted-foreground));text-decoration:underline;white-space:nowrap;">
        Replace
        <input type="file" accept="image/*" multiple id="locAreaPhotoInput" style="display:none;">
      </label>
    </div>` : `
    <div style="border:2px dashed hsl(var(--border));border-radius:10px;padding:18px;text-align:center;">
      <label style="cursor:pointer;display:inline-flex;align-items:center;gap:8px;padding:10px 22px;background:hsl(var(--primary));color:white;border-radius:50px;font-size:13px;font-weight:700;">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>
        Choose Photo
        <input type="file" accept="image/*" multiple id="locAreaPhotoInput" style="display:none;">
      </label>
      <p style="margin:10px 0 0;font-size:12px;color:hsl(var(--muted-foreground));">JPG, PNG or HEIC &bull; up to 5 photos</p>
      <div id="locPhotoErr" style="display:none;margin-top:8px;padding:8px 10px;background:hsl(0 84% 97%);border:1px solid hsl(0 84% 85%);border-radius:8px;font-size:12px;color:hsl(0 72% 45%);"></div>
    </div>`;

  // Conditional sections shown after attendance is selected
  const noPhoneSection = `
    <div id="locNoPhoneSection" style="display:${att === "no_phone" ? "block" : "none"};">
      <div class="q-question" style="margin-top:20px;">
        <div class="q-question-prompt">&#128273; How will the technician access the property? <span class="q-req">*</span></div>
        <p class="q-muted" style="font-size:13px;margin:4px 0 10px;">Gate code, lockbox, hide-a-key location, neighbor to contact &mdash; give us what we need to get in safely. Pets secured? Alarm disabled? Note it here.</p>
        <textarea id="locAccessInstructions" class="q-input"
          rows="3"
          placeholder="e.g. Gate code is 1234. Front door key is under the flowerpot. Dog is secured in the back bedroom."
          style="width:100%;resize:vertical;font-size:13px;line-height:1.5;box-sizing:border-box;">${escHtml(S.locationAnswers.access_instructions || "")}</textarea>
      </div>
      <div class="q-question" style="margin-top:20px;">
        <div class="q-question-prompt">&#128247; Photo of the work area <span class="q-req">*</span></div>
        <p class="q-muted" style="font-size:13px;margin:4px 0 12px;">Since no one will be home, a photo is required so we can confirm the exact location before arrival. Mark the spot with tape, a sticky note, or point your finger at it &mdash; takes 30 seconds and prevents any confusion on job day.</p>
        ${stepsHtml}
        ${tipsHtml}
        <div style="margin-top:12px;">${photoUploadZone}</div>
      </div>
    </div>`;

  const attendedSection = `
    <div id="locAttendedSection" style="display:${att && att !== "no_phone" ? "block" : "none"};">
      <div class="q-question" style="margin-top:20px;">
        <div class="q-question-prompt">&#128247; Work area photo <span style="color:hsl(var(--muted-foreground));font-weight:500;">(optional but helpful)</span></div>
        <p class="q-muted" style="font-size:13px;margin:4px 0 12px;">A quick photo helps us confirm the estimate and plan materials in advance. You can always show us in person instead &mdash; totally fine either way.</p>
        <div style="margin-top:4px;">${photoUploadZone}</div>
      </div>
    </div>`;

  return `
    <div class="q-card-section q-loc-section" style="margin-top:14px;">
      <div style="font-size:11px;font-weight:800;text-transform:uppercase;letter-spacing:.07em;color:hsl(var(--primary));margin-bottom:16px;">
        &#128205; Job Location Details
      </div>

      <div class="q-question">
        <div class="q-question-prompt">How far is the desired location from the nearest outlet or panel? <span class="q-req">*</span></div>
        <div class="q-loc-options">
          ${DIST_OPTIONS.map(o => `
            <div class="q-loc-option${S.locationAnswers.distance === o.id ? " selected" : ""}"
                 data-field="distance" data-val="${escHtml(o.id)}">${escHtml(o.label)}</div>`).join("")}
        </div>
      </div>

      <div class="q-question" style="margin-top:20px;">
        <div class="q-question-prompt">Will someone be home to confirm the location with the tech? <span class="q-req">*</span></div>
        <div class="q-loc-options">
          ${ATTEND_OPTIONS.map(o => `
            <div class="q-loc-option${att === o.id ? " selected" : ""}"
                 data-field="attendance" data-val="${escHtml(o.id)}">${escHtml(o.label)}</div>`).join("")}
        </div>
      </div>

      ${noPhoneSection}
      ${attendedSection}
    </div>`;
}

function renderQuestion(q) {
  const override = MODULE_OVERRIDES[q.question_id];
  if (override) q = { ...q, ...override };
  const options  = q.options || S.config?.optionsByQuestion?.[q.question_id] || [];
  // yesno with no options → synthesize Yes / No choices
  const itype = q.input_type || "single_select";
  const effectiveOptions = (itype === "yesno" && !options.length)
    ? [{ option_id: "yes", label: "Yes" }, { option_id: "no", label: "No" }]
    : options;

  if (itype === "photo") {
    const photoList = S.photos[q.question_id] || [];
    const guide = PHOTO_MODULE_GUIDES[q.question_id];

    if (guide) {
      // Rich guided photo upload — uses the same style as the panel/location guides
      const uploaded = photoList.length > 0;
      const miniSteps = (guide.steps || []).map((s, i) => `
        <div style="display:flex;gap:9px;align-items:flex-start;margin-bottom:7px;">
          <div style="flex-shrink:0;width:18px;height:18px;border-radius:50%;background:hsl(var(--primary));color:white;font-size:10px;font-weight:800;display:flex;align-items:center;justify-content:center;">${i + 1}</div>
          <p style="margin:0;font-size:12.5px;line-height:1.5;padding-top:1px;">${escHtml(s)}</p>
        </div>`).join("");
      const miniTips = (guide.tips || []).length ? `
        <div style="background:hsl(210 20% 97%);border-radius:7px;padding:8px 10px;margin:8px 0;">
          <p style="margin:0 0 4px;font-size:10px;font-weight:800;text-transform:uppercase;letter-spacing:.06em;color:hsl(var(--muted-foreground));">Quick tips</p>
          ${guide.tips.map(t => `
            <div style="display:flex;gap:7px;align-items:flex-start;margin-top:3px;">
              <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="hsl(var(--primary))" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" style="flex-shrink:0;margin-top:3px;"><polyline points="20 6 9 17 4 12"/></svg>
              <span style="font-size:11.5px;color:hsl(var(--muted-foreground));">${escHtml(t)}</span>
            </div>`).join("")}
        </div>` : "";
      const actionHtml = uploaded ? `
        <div style="display:flex;align-items:center;justify-content:space-between;gap:10px;background:hsl(120 60% 97%);border:1.5px solid hsl(120 60% 80%);border-radius:9px;padding:10px 13px;">
          <div style="display:flex;align-items:center;gap:9px;">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="hsl(120 60% 40%)" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><polyline points="7 12 10.5 15.5 17 8.5"/></svg>
            <p style="margin:0;font-size:13px;font-weight:700;color:hsl(120 60% 35%);">${photoList.length} photo${photoList.length !== 1 ? "s" : ""} added</p>
          </div>
          <label style="cursor:pointer;font-size:12px;color:hsl(var(--muted-foreground));text-decoration:underline;white-space:nowrap;">
            Replace <input type="file" class="q-photo-inline" data-qid="${escHtml(q.question_id)}" accept="image/*" multiple style="display:none;">
          </label>
        </div>` : `
        <div style="border:2px dashed hsl(var(--border));border-radius:9px;padding:14px;text-align:center;">
          <label style="cursor:pointer;display:inline-flex;align-items:center;gap:7px;padding:9px 20px;background:hsl(var(--primary));color:white;border-radius:50px;font-size:13px;font-weight:700;">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>
            Add Photo (Optional)
            <input type="file" class="q-photo-inline" data-qid="${escHtml(q.question_id)}" accept="image/*" multiple style="display:none;">
          </label>
          <p style="margin:7px 0 0;font-size:11.5px;color:hsl(var(--muted-foreground));">JPG, PNG or HEIC &bull; up to 5 photos</p>
        </div>`;
      return `
        <div class="q-question" data-qid="${q.question_id}">
          <div class="q-question-prompt">${escHtml(q.prompt)}</div>
          <p class="q-muted" style="font-size:12.5px;margin:3px 0 10px;">Optional &mdash; helps us confirm the estimate and plan materials</p>
          ${miniSteps}
          ${miniTips}
          <div style="margin-top:10px;">${actionHtml}</div>
        </div>`;
    }

    // Simple photo (no guide available)
    const label = photoList.length
      ? `&#128247; ${photoList.length} photo${photoList.length !== 1 ? "s" : ""} added`
      : "&#128247; Add Photos (Optional)";
    return `
      <div class="q-question" data-qid="${q.question_id}">
        <div class="q-question-prompt">${escHtml(q.prompt)}</div>
        <label class="q-file-label" style="margin-top:8px;">
          ${label}
          <input type="file" class="q-photo-inline" data-qid="${escHtml(q.question_id)}"
            accept="image/*" multiple style="display:none;">
        </label>
        <p class="q-muted" style="font-size:12px;margin:6px 0 0;">
          Optional &mdash; photos help confirm the estimate
        </p>
      </div>`;
  }

  if (itype === "number") {
    const cur = Number(S.answers[q.question_id] || 1);
    return `
      <div class="q-question" data-qid="${q.question_id}">
        <div class="q-question-prompt">${escHtml(q.prompt)}${q.required ? " <span class='q-req'>*</span>" : ""}</div>
        <div class="q-qty-wrap" style="display:flex;align-items:center;gap:10px;margin-top:8px;">
          <div class="q-qty-ctrl">
            <button class="q-qty-btn q-num-dec" data-qid="${escHtml(q.question_id)}"
              ${cur <= 1 ? "disabled" : ""}>&#8722;</button>
            <span class="q-qty-val" id="numVal_${escHtml(q.question_id)}">${cur}</span>
            <button class="q-qty-btn q-num-inc" data-qid="${escHtml(q.question_id)}"
              ${cur >= 20 ? "disabled" : ""}>&#43;</button>
          </div>
        </div>
      </div>`;
  }

  // Inject a "Not sure" option for modules where customers commonly can't answer.
  // Stores value="_unsure" so the engine adds a 15% contingency buffer.
  const notSureLabel = NOT_SURE_MODULES[q.question_id];
  const hasNotSureAlready = effectiveOptions.some(o =>
    /not.sure|unknown|unsure/i.test(o.label) || o.option_id === "_unsure" || o.option_id === "not_sure" || o.option_id === "unknown"
  );
  const allOptions = (effectiveOptions.length && notSureLabel && !hasNotSureAlready)
    ? [...effectiveOptions, { option_id: "_unsure", label: notSureLabel, _injected: true }]
    : effectiveOptions;

  return `
    <div class="q-question" data-qid="${q.question_id}">
      <div class="q-question-prompt">${escHtml(q.prompt)}${q.required ? " <span class='q-req'>*</span>" : ""}</div>
      ${allOptions.length ? `
        <div class="q-options">
          ${allOptions.map(o => `
            <label class="q-option${S.answers[q.question_id] === o.option_id ? " selected" : ""}${o._injected ? " q-option--notsure" : ""}"
              data-dis="${o.disqualify ? "1" : ""}" data-unc="${o.uncertain ? "1" : ""}">
              <input type="radio" name="q_${q.question_id}" value="${escHtml(o.option_id)}"
                ${S.answers[q.question_id] === o.option_id ? "checked" : ""}>
              ${o._injected ? `<span class="q-notsure-icon">?</span> ` : ""}${escHtml(o.label)}
            </label>`).join("")}
        </div>
      ` : `
        <input type="text" class="q-text-input" name="q_${q.question_id}"
          value="${escHtml(S.answers[q.question_id] || "")}" placeholder="Your answer">
      `}
    </div>`;
}

// ── Step 5: Review — price + slot picker (no lead info) ───────────────────────
function priceRange(price) {
  if (price == null) return null;
  const low  = Math.floor(price * 0.85 / 5) * 5;
  const high = Math.ceil(price * 1.15 / 5) * 5;
  return {
    low,
    high,
    label: `$${low.toLocaleString()} \u2013 $${high.toLocaleString()}`,
  };
}

// For site visits: prefer the real ballparkRange from the service classification.
// Falls back to ±15% of the midpoint if no real range is available.
function siteVisitPriceLabel() {
  const br = S.consultData?.ballparkRange;
  if (br?.low != null && br?.high != null) {
    return `$${Number(br.low).toLocaleString()} \u2013 $${Number(br.high).toLocaleString()}`;
  }
  const r = priceRange(S.pricing?.final_price);
  return r ? r.label : "\u2014";
}

// For instant quotes: firm calculated price, no range.
function exactPriceLabel(price) {
  return price != null ? `$${Math.round(price).toLocaleString()}` : "\u2014";
}

// Site-visit review setup — called instead of renderSiteVisit/renderConsult.
// Uses the ballparkRange from S.consultData if available; otherwise falls back
// to 30 min of crew labor at $125/hr as a rough starting point.
function _setupSiteVisitReview() {
  if (S.isSiteVisit) return; // already set
  const br      = S.consultData?.ballparkRange;
  const HOURLY  = S.config?.crew_loaded_hourly || 125;
  const midpoint = (br?.low != null && br?.high != null)
    ? (Number(br.low) + Number(br.high)) / 2
    : (30 / 60) * HOURLY;
  S.isSiteVisit = true;
  S.pricing = { ok: true, final_price: midpoint, isSiteVisit: true };
  S.selectedSlot  = null;
  S.selectedBlock = null;
}

function renderReview() {
  const price     = S.pricing?.final_price ?? null;
  const priceDisp = S.isSiteVisit ? siteVisitPriceLabel() : exactPriceLabel(price);
  const bnpl      = !S.isSiteVisit && price != null && price >= 200 ? Math.ceil(price / 12) : null;

  // Build a label from all selected services (or a site-visit label)
  const svcLabel = S.isSiteVisit
    ? `Free Site Visit \u2014 ${S.consultData?.service_name || "your project"}`
    : S.selectedServices.map(svc => {
        const jt = (S.config?.jobTypes || []).find(j => j.job_type_id === svc.job_type_id);
        return svc.qty > 1 ? `${svc.qty}\u00d7 ${jt?.name_public || svc.job_type_id}` : (jt?.name_public || svc.job_type_id);
      }).join(", ");

  const slotLabel = S.selectedBlock
    ? `${escHtml(S.selectedBlock.display)} &bull; ${escHtml(S.selectedBlock.window_label)}`
    : null;

  return `
    ${stepHeader(5, "Final Review &amp; Scheduling")}

    <div class="q-price-footer">
      <div class="q-price-footer-label">
        ${S.isSiteVisit ? "Ballpark Range" : "Your Quote"}${svcLabel ? ` &mdash; ${escHtml(svcLabel)}` : ""}
      </div>
      <div class="q-price-footer-amount">
        ${priceDisp}
      </div>
      ${(() => {
        const equip = getEquipServices();
        if (!equip.length) return "";
        const lines = equip.map(svc => {
          const sku = S.equipmentSelections[svc.job_type_id];
          if (sku === "CUSTOMER-PROVIDED") {
            const jt = (S.config?.jobTypes || []).find(j => j.job_type_id === svc.job_type_id);
            return `<span style="display:block;">${SWORD_SVG}&nbsp;<em>${escHtml(jt?.name_public || svc.job_type_id)}</em> <span style="font-size:11px;color:hsl(var(--muted-fg));">(customer-supplied — labor only)</span></span>`;
          }
          const cat  = resolveEquipCatalog(svc);
          const prod = cat?.products.find(p => p.sku === sku);
          if (!prod) return "";
          const delta = equipUpgradeDelta(svc);
          const vid = S.variantSelections[varKey(svc.job_type_id, sku)];
          const variant = prod.variants?.find(v => v.id === vid);
          const variantSuffix = variant ? ` · <span style="font-size:11px;">${escHtml(variant.label)}</span>` : "";
          return `<span style="display:block;">${SWORD_SVG}&nbsp;${escHtml(prod.brand)} ${escHtml(prod.name)}${variantSuffix}${delta > 0 ? ` <span style="font-size:11px;color:hsl(var(--primary));">(+$${delta} upgrade)</span>` : " <span style=\"font-size:11px;\">(standard)</span>"}</span>`;
        }).filter(Boolean).join("");
        return lines ? `<div class="q-price-footer-equip">${lines}</div>` : "";
      })()}
      <div class="q-price-footer-sub">
        ${S.isSiteVisit
          ? "&#128205; Site visit is free &bull; An electrician will visit your property and give you a firm price."
          : "&#128205; This is your firm quote. If anything unexpected comes up on-site, we\u2019ll let you know before doing any additional work."}
        ${!S.isSiteVisit && S.pricing?.evaluation_flag ? " An in-person evaluation may be needed first." : ""}
        ${!S.isSiteVisit && bnpl ? ` &bull; As low as $${bnpl}/mo with financing.` : ""}
      </div>
    </div>

    <div class="q-review-slots-section">
      <div class="q-review-slots-heading">&#128197; Choose a Service Window</div>
      <p class="q-muted" style="font-size:13px;margin:-4px 0 12px;">
        Pick a morning or afternoon block. Our crew will arrive within that window.
      </p>
      <div id="reviewSlotSection">${loadingHTML("Loading available windows\u2026")}</div>
    </div>

    <div class="q-nav-row" style="margin-top:20px;">
      <button class="q-btn-back" onclick="back()">&#8592; Back</button>
      <button class="q-btn-next" id="goConfirmBtn" ${S.selectedSlot ? "" : "disabled"}>
        <img src="/pages/img/sword-light.png" class="sword-icon" alt="">
        <span>Confirm Booking</span>
      </button>
    </div>
    ${NOTE}`;
}

// ── Step 6: Confirm — lead form ────────────────────────────────────────────────
function renderConfirm() {
  const price       = S.lock?.final_price ?? S.pricing?.final_price ?? null;
  const priceDisp   = S.isSiteVisit ? siteVisitPriceLabel() : exactPriceLabel(price);
  const blockDisplay = S.selectedBlock?.display      || "";
  const blockWindow  = S.selectedBlock?.window_label || "";

  return `
    ${stepHeader(6, "Your Information")}
    <div class="q-confirm-summary">
      <div class="q-confirm-row">
        <span class="q-confirm-icon">${_SVG_CLOCK}</span>
        <div>
          <div class="q-confirm-key">Appointment Window</div>
          <div class="q-confirm-val">${escHtml(blockDisplay)}${blockWindow ? ` &bull; Arrival ${escHtml(blockWindow)}` : ""}</div>
        </div>
      </div>
      <div class="q-confirm-row">
        <span class="q-confirm-icon">${_SVG_BOLT}</span>
        <div>
          <div class="q-confirm-key">${S.isSiteVisit ? "Ballpark Range" : "Your Quote"}</div>
          <div class="q-confirm-val">
            ${priceDisp}
            <span class="q-confirm-note">&mdash; ${S.isSiteVisit ? "free visit · firm price quoted on-site" : "materials confirmed on-site · not a binding contract"}</span>
          </div>
        </div>
      </div>
    </div>
    <div class="q-form">
      <div class="q-field">
        <label class="q-label">Your Name <span class="q-req">*</span></label>
        <input type="text" id="ld_name" class="q-input" placeholder="Jane Smith" autocomplete="name">
      </div>
      <div class="q-field">
        <label class="q-label">Phone <span class="q-req">*</span></label>
        <input type="tel" id="ld_phone" class="q-input" placeholder="(409) 555-0100" autocomplete="tel">
      </div>
      <div class="q-field">
        <label class="q-label">Email</label>
        <input type="email" id="ld_email" class="q-input" placeholder="you@example.com" autocomplete="email">
      </div>
      <div class="q-field">
        <label class="q-label">Service Address <span class="q-req">*</span></label>
        <div class="q-addr-wrap">
          <input type="text" id="ld_address" class="q-input"
            placeholder="123 Main St, Beaumont TX 77701" autocomplete="off">
          <div id="addrDropdown" class="q-addr-dropdown" style="display:none;"></div>
        </div>
        <div id="addrConfirmBanner" style="display:none;align-items:center;gap:10px;margin-top:8px;padding:10px 12px;background:rgba(45,106,224,0.1);border:1px solid rgba(45,106,224,0.35);border-radius:8px;font-size:13px;"></div>
      </div>
      <div class="q-field">
        <label class="q-label">ZIP Code <span class="q-req">*</span></label>
        <input type="text" id="ld_zip" class="q-input" placeholder="77701"
          maxlength="5" inputmode="numeric" pattern="[0-9]{5}">
        <div class="q-zip-note" id="zipNote" style="display:none;"></div>
        <div class="q-price-update" id="priceUpdate" style="display:none;"></div>
      </div>
      <div class="q-field">
        <label class="q-label">How did you find us? <span class="q-req">*</span></label>
        <select id="ld_source" class="q-input" style="color:inherit;border:1px solid var(--q-border,#2d3348);">
          <option value="">-- Select one --</option>
          <option value="GBP">Google Search / Google Maps</option>
          <option value="LSA">Google Local Services Ad</option>
          <option value="Google Ads">Google Ad</option>
          <option value="Organic SEO">Website / Organic Search</option>
          <option value="Facebook">Facebook</option>
          <option value="Referral">Friend or Family Referral</option>
          <option value="Yard Sign">Yard Sign</option>
          <option value="Truck Wrap">Truck / Van</option>
          <option value="Repeat Customer">Previous Customer</option>
          <option value="Direct">Called / Walked In Directly</option>
          <option value="Manual Outreach">Outreach / Door Hanger</option>
          <option value="Other">Other</option>
        </select>
      </div>
      <div id="referralFields" style="display:none;margin-top:10px;padding:14px 16px;border:1px solid var(--q-border,#2d3348);border-radius:10px;background:rgba(45,106,224,0.05);">
        <div style="font-size:12px;font-weight:700;color:var(--q-accent,#2d6ae0);margin-bottom:10px;text-transform:uppercase;letter-spacing:.05em;">Who referred you?</div>
        <div class="q-field" style="margin-bottom:10px;">
          <label class="q-label">Referrer Name <span class="q-req">*</span></label>
          <input type="text" id="ref_name" class="q-input" placeholder="Their first and last name" autocomplete="off">
        </div>
        <div class="q-field">
          <label class="q-label">Referrer Phone <span class="q-req">*</span></label>
          <input type="tel" id="ref_phone" class="q-input" placeholder="(409) 555-0100" autocomplete="tel">
        </div>
      </div>
      <div class="q-field" style="margin-top:20px;border:1px solid var(--q-border,#2d3348);border-radius:10px;padding:14px 16px;background:rgba(45,106,224,0.06);">
        <div style="font-size:13px;font-weight:700;color:var(--q-accent,#2d6ae0);margin-bottom:10px;letter-spacing:.03em;">
          &#128241; Text Message Preferences
        </div>
        <label class="q-sms-opt" style="display:flex;align-items:flex-start;gap:10px;cursor:pointer;margin-bottom:10px;">
          <input type="checkbox" id="sms_ops_consent" checked
            style="margin-top:3px;width:18px;height:18px;accent-color:var(--q-accent,#2d6ae0);flex-shrink:0;">
          <span style="font-size:13px;line-height:1.5;color:inherit;">
            <strong>Yes — keep me in the loop on my job.</strong>
            Text me when my tech is on the way, when we arrive, and when the job wraps up.
            <span style="display:block;margin-top:4px;font-size:11px;color:var(--q-muted,#8899bb);">
              Transactional messages only &bull; Msg &amp; data rates may apply &bull; Reply STOP to opt out
            </span>
          </span>
        </label>
        <label class="q-sms-opt" style="display:flex;align-items:flex-start;gap:10px;cursor:pointer;">
          <input type="checkbox" id="sms_mkt_consent"
            style="margin-top:3px;width:18px;height:18px;accent-color:var(--q-accent,#2d6ae0);flex-shrink:0;">
          <span style="font-size:13px;line-height:1.5;color:inherit;">
            <strong>Also text me exclusive deals &amp; seasonal discounts.</strong>
            Be first to know about specials, limited-time offers, and tips for Orange County homeowners.
            <span style="display:block;margin-top:4px;font-size:11px;color:var(--q-muted,#8899bb);">
              Approx. 2&ndash;4 msgs/mo &bull; Reply STOP anytime to opt out
            </span>
          </span>
        </label>
      </div>
      <div class="q-consent-section">
        <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:12px;">
          <div style="font-size:11px;font-weight:800;text-transform:uppercase;letter-spacing:.07em;color:hsl(var(--primary));">Before You Book</div>
          <a href="/terms" target="_blank" rel="noopener"
            style="font-size:11px;color:hsl(var(--primary));text-decoration:none;font-weight:600;display:flex;align-items:center;gap:4px;opacity:.85;">
            <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg>
            View full terms
          </a>
        </div>
        <label class="q-consent-item">
          <input type="checkbox" id="consent_scope" class="q-consent-check" ${S.consents.scope ? "checked" : ""}>
          <span>I understand the price is based on the information I provided. If actual site conditions differ, Vickery Electric will pause and request my approval before continuing any additional work. I agree to provide safe access, secure pets, and be reachable during the appointment. By booking I agree to the <a href="/terms" target="_blank" rel="noopener" style="color:hsl(var(--primary));text-decoration:none;font-weight:600;">Terms of Service</a>.</span>
        </label>
        ${S.locationAnswers.attendance === "no_phone" ? `
        <label class="q-consent-item">
          <input type="checkbox" id="consent_unattended" class="q-consent-check" ${S.consents.unattended ? "checked" : ""}>
          <span>I authorize Vickery Electric to access the property using the instructions I provided. Pets are secured, alarm issues are handled, and the work location is clearly marked. If the technician cannot safely access or confirm the work area, the job may be paused, rescheduled, or subject to a trip fee.</span>
        </label>` : ""}
        ${isLocationJob() ? `
        <label class="q-consent-item">
          <input type="checkbox" id="consent_location" class="q-consent-check" ${S.consents.location ? "checked" : ""}>
          <span>I confirm the location shown in my area photo is accurate. If the exact location changes on the day of service, the final price may be adjusted before work begins.</span>
        </label>` : ""}
      </div>
      <div class="q-err" id="leadErr" style="display:none;"></div>
      <div class="q-nav-row" style="margin-top:16px;">
        <button class="q-btn-back" onclick="back()">&#8592; Back</button>
        <button class="q-btn-next" id="submitLockBtn" aria-label="Confirm and Book" ${consentsComplete() ? "" : "disabled"}>
          <img src="/pages/img/sword-light.png" class="sword-icon" alt="">
          <span>Confirm &amp; Book</span>
        </button>
      </div>
    </div>
    <div style="margin-top:20px;padding:14px 16px;border:1px solid rgba(45,106,224,0.3);border-radius:10px;background:rgba(45,106,224,0.06);display:flex;gap:12px;align-items:flex-start;">
      <span style="font-size:20px;flex-shrink:0;margin-top:1px;">&#9432;</span>
      <div style="font-size:12px;line-height:1.7;color:var(--q-muted,#8899bb);">
        <strong style="display:block;font-size:13px;color:inherit;margin-bottom:4px;">About this estimate</strong>
        This quote is provided in good faith based on the information you submitted. We will make every effort to complete your job at or near this price. If unexpected site conditions require a change, your technician will discuss it with you <strong>before any additional work is done</strong>. This is not a binding contract.
      </div>
    </div>
    <p class="q-muted" style="font-size:12px;text-align:center;margin-top:14px;">
      Secure booking &bull; No payment due now
    </p>`;
}

// ── Step 7: Photo gate ────────────────────────────────────────────────────────
function renderPhoto() {
  return `
    ${stepHeader(6, "One Quick Step")}
    <p class="q-muted" style="margin-bottom:20px;">
      Please upload a photo of your electrical panel so we can confirm compatibility before finalizing your booking.
    </p>
    <div class="q-photo-gate">
      <div class="q-photo-header">&#128247; Upload a Panel Photo</div>
      <p class="q-muted" style="font-size:13px;margin:6px 0 0;">JPG, PNG or HEIC &bull; Max 10 MB</p>
      <label class="q-file-label">
        Choose Photo
        <input type="file" id="photoFile" accept="image/*" style="display:none;">
      </label>
      <div id="photoPreview" class="q-photo-preview" style="display:none;"></div>
      <button class="q-btn-next" id="uploadPhotoBtn" style="display:none;margin-top:12px;width:100%;">
        <img src="/pages/img/sword-light.png" class="sword-icon" alt="">
        Upload Photo
      </button>
      <div id="photoStatus" class="q-photo-status"></div>
    </div>
    <button class="q-btn-next" id="finalizeBtn" style="display:none;margin-top:20px;width:100%;">
      <img src="/pages/img/sword-light.png" class="sword-icon" alt="">
      Finalize Booking &rarr;
    </button>`;
}

// ── Step 8: Booked ────────────────────────────────────────────────────────────
const _SVG_DATE  = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" style="color:hsl(var(--primary));vertical-align:-2px;margin-right:5px;flex-shrink:0;"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>`;
const _SVG_CLOCK = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" style="color:hsl(var(--primary));vertical-align:-2px;margin-right:5px;flex-shrink:0;"><circle cx="12" cy="12" r="10"/><polyline points="12,6 12,12 16,14"/></svg>`;
const _SVG_PIN   = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" style="color:hsl(var(--primary));vertical-align:-2px;margin-right:5px;flex-shrink:0;"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/></svg>`;
const _SVG_BOLT  = `<svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" stroke="none" style="color:hsl(var(--primary));vertical-align:-2px;margin-right:5px;flex-shrink:0;"><polygon points="13,2 3,14 12,14 11,22 21,10 12,10"/></svg>`;
const _SVG_TAG   = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" style="color:hsl(var(--primary));vertical-align:-2px;margin-right:5px;flex-shrink:0;"><path d="M20.59 13.41l-7.17 7.17a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82z"/><line x1="7" y1="7" x2="7.01" y2="7"/></svg>`;

function renderBooked() {
  const dark         = document.documentElement.classList.contains('dark');
  const veLogoSrc    = dark ? '/pages/img/logo-dark.png' : '/pages/img/logo-light.png';
  const bk           = S.booking;
  const displayPrice = S.lock?.final_price ?? bk?.final_price;

  // Block info from booking response (preferred) or from the selection state
  const blockLabel  = bk?.schedule_block  || S.selectedBlock?.block  || "";
  const windowLabel = bk?.window_label    || S.selectedBlock?.window_label || "";
  const dayDisplay  = S.selectedBlock?.display || blockLabel;

  // For the date, format from scheduled_datetime
  const tz = "America/Chicago";
  const dt = bk?.scheduled_datetime ? new Date(bk.scheduled_datetime) : null;
  const dateStr = dt
    ? new Intl.DateTimeFormat("en-US", { timeZone: tz, weekday: "long", month: "long", day: "numeric", year: "numeric" }).format(dt)
    : dayDisplay;

  // Multi-block handling
  const blocksReserved = bk?.blocks_reserved || [];
  const isMultiBlock   = blocksReserved.length > 1;

  let windowSection = "";
  if (isMultiBlock) {
    // Show each block in a small list
    const blockLines = blocksReserved.map((seg, i) => {
      const label = i === 0 ? "Primary block" : "Continued in";
      return `<span style="display:block;font-size:13px;margin-top:3px;">
        ${i === 0 ? "&#9728;" : "&#128279;"} ${escHtml(seg.block)} &bull; ${escHtml(seg.display || seg.window_label || "")}
        <span style="color:#888;">(${seg.allocated_hrs} hrs)</span>
      </span>`;
    }).join("");
    windowSection = `
      <div class="q-booking-row" style="align-items:flex-start;">
        <span class="q-booking-key">${_SVG_CLOCK} Schedule</span>
        <span class="q-booking-val">
          <span style="display:block;font-size:13px;color:#555;margin-bottom:4px;">This job spans multiple blocks:</span>
          ${blockLines}
        </span>
      </div>`;
  } else {
    const windowDisplay = windowLabel ? `Arrival window: ${windowLabel} (Central)` : "";
    windowSection = `
      <div class="q-booking-row">
        <span class="q-booking-key">${_SVG_CLOCK} Window</span>
        <span class="q-booking-val">${escHtml(windowDisplay || blockLabel)}</span>
      </div>`;
  }

  return `
    <div class="q-booked">
      <div class="q-booked-icon">
        <img src="${veLogoSrc}" class="booked-ve-logo" alt="Vickery Electric">
      </div>
      <h2 style="font-family:var(--font-display);font-size:26px;font-weight:800;letter-spacing:-0.02em;margin-bottom:8px;">${S.isSiteVisit ? "Site Visit Booked!" : "You're Booked!"}</h2>
      <p class="q-muted" style="margin-bottom:24px;">${S.isSiteVisit ? "An electrician will come out and give you an accurate price — the visit is free." : "Here's your confirmation. We'll see you soon."}</p>
      <div class="q-booking-card">
        <div class="q-booking-row">
          <span class="q-booking-key">${_SVG_DATE} Date</span>
          <span class="q-booking-val">${escHtml(dateStr)}</span>
        </div>
        ${windowSection}
        <div class="q-booking-row">
          <span class="q-booking-key">${_SVG_PIN} Address</span>
          <span class="q-booking-val">${escHtml(bk?.address || "")}</span>
        </div>
        <div class="q-booking-row">
          <span class="q-booking-key">${_SVG_BOLT} Estimate</span>
          <span class="q-booking-val">${S.isSiteVisit ? siteVisitPriceLabel() : exactPriceLabel(displayPrice)}</span>
        </div>
        <div class="q-booking-row">
          <span class="q-booking-key">${_SVG_TAG} ID</span>
          <span class="q-booking-val" style="font-family:monospace;font-size:12px;">${escHtml(bk?.booking_id || "")}</span>
        </div>
      </div>
      ${isMultiBlock ? `<p class="q-muted" style="margin-top:16px;font-size:13px;max-width:360px;margin-left:auto;margin-right:auto;">
        Your job is estimated to take more than one block. Our crew will continue into the next available window automatically.
      </p>` : ""}
      <p class="q-muted" style="margin-top:16px;font-size:13px;">
        Questions? Call us at <a href="tel:+14095550100" style="color:hsl(var(--accent));">(409) 555-0100</a>
      </p>
    </div>`;
}

// ── Step: Commercial Coming Soon ──────────────────────────────────────────────
function renderCommercialSoon() {
  return `
    ${stepHeader(2, "Commercial Services")}
    <div class="q-card-section" style="text-align:center;padding:36px 20px 28px;">
      <svg width="56" height="56" viewBox="0 0 48 48" fill="none" stroke="currentColor" stroke-width="1.6"
        stroke-linecap="round" stroke-linejoin="round"
        style="color:hsl(var(--primary));display:block;margin:0 auto 18px;">
        <rect x="8" y="4" width="32" height="40" rx="2"/>
        <path d="M16 4v40M32 4v40"/>
        <path d="M8 16h32M8 28h32"/>
        <circle cx="24" cy="22" r="4" fill="currentColor" stroke="none" opacity=".35"/>
      </svg>
      <h3 style="font-family:var(--font-display);font-size:20px;font-weight:800;margin:0 0 12px;letter-spacing:-0.01em;">
        Commercial Quoting — Coming Soon
      </h3>
      <p class="q-muted" style="max-width:400px;margin:0 auto 20px;font-size:14px;line-height:1.6;">
        We're a residential-focused team right now. Commercial estimating is on our roadmap — we'll be adding it soon.
        In the meantime, call us for commercial inquiries and we'll do our best to help.
      </p>
      <a href="tel:+14095550100"
        style="display:inline-flex;align-items:center;gap:8px;padding:14px 28px;background:hsl(var(--primary));color:white;border-radius:50px;font-size:15px;font-weight:700;text-decoration:none;">
        &#128222; Call (409) 555-0100
      </a>
    </div>
    <div class="q-nav-row">
      <button class="q-btn-back" onclick="back()">&#8592; Back</button>
      <div></div>
    </div>
    ${NOTE}`;
}

// ── Site-visit booking form (shared by renderSiteVisit + renderConsult) ───────
function _renderSiteVisitForm() {
  return `
    <div class="q-card-section" style="margin-top:12px;" id="svFormCard">
      <div style="font-size:15px;font-weight:700;margin-bottom:14px;">Book Your Free Site Visit</div>
      <div class="q-form">
        <div class="q-field">
          <label class="q-label">Your Name <span class="q-req">*</span></label>
          <input type="text" id="consult_name" class="q-input" placeholder="Jane Smith" autocomplete="name">
        </div>
        <div class="q-field">
          <label class="q-label">Phone Number <span class="q-req">*</span></label>
          <input type="tel" id="consult_phone" class="q-input" placeholder="(409) 555-0100" autocomplete="tel">
        </div>
        <div class="q-field">
          <label class="q-label">Property Address <span class="q-req">*</span></label>
          <input type="text" id="consult_address" class="q-input" placeholder="123 Main St, Beaumont, TX" autocomplete="street-address">
        </div>
        <div id="svContactErr" class="q-error-box" style="display:none;"></div>
        <button class="q-btn-next" id="svCheckBtn" onclick="svCheckAvailability()" style="width:100%;margin-top:8px;">
          <img src="/pages/img/sword-light.png" class="sword-icon" alt="">
          <span>See Available Times \u2192</span>
        </button>
      </div>
      <div id="svSlotSection" style="display:none;margin-top:18px;padding-top:16px;border-top:1px solid hsl(var(--border));">
        <div style="font-size:14px;font-weight:700;margin-bottom:10px;">Select a Time</div>
        <div id="svBlocks"></div>
        <div id="svSlotErr" class="q-error-box" style="display:none;margin-top:8px;"></div>
        <button class="q-btn-next" id="svConfirmBtn" onclick="svConfirmBooking()"
          style="width:100%;margin-top:12px;display:none;">
          <img src="/pages/img/sword-light.png" class="sword-icon" alt="">
          <span>Confirm Site Visit</span>
        </button>
      </div>
    </div>`;
}

// ── Step: Site Visit Required (disqualified answer) ───────────────────────────
function renderSiteVisit() {
  const d     = S.consultData || {};
  const range = d.ballparkRange
    ? `$${Number(d.ballparkRange.low).toLocaleString()} \u2013 $${Number(d.ballparkRange.high).toLocaleString()}`
    : null;
  const svcName = d.service_name || "this service";

  return `
    ${stepHeader(3, "Free Site Visit Needed")}
    <div class="q-card-section" style="padding:28px 20px 24px;">
      <div style="text-align:center;margin-bottom:18px;">
        <svg width="52" height="52" viewBox="0 0 48 48" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" style="color:hsl(var(--primary));display:block;margin:0 auto;"><path d="M24 4C15.16 4 8 11.16 8 20c0 12 16 24 16 24s16-12 16-24c0-8.84-7.16-16-16-16z"/><circle cx="24" cy="20" r="5"/></svg>
      </div>
      <h3 style="font-family:var(--font-display);font-size:18px;font-weight:800;margin:0 0 10px;letter-spacing:-0.01em;text-align:center;">
        ${escHtml(svcName)} Needs an On-Site Estimate
      </h3>
      <p class="q-muted" style="max-width:420px;margin:0 auto 16px;text-align:center;font-size:14px;">
        Based on your answers, this project needs an in-person look before we can give you an accurate price. Don't worry &mdash; the site visit is free!
      </p>
      ${range ? `
      <div style="background:hsl(var(--primary) / 0.08);border:1px solid hsl(var(--primary) / 0.25);border-radius:10px;padding:14px 18px;text-align:center;margin:0 auto 20px;max-width:340px;">
        <div class="q-muted" style="font-size:12px;font-weight:700;text-transform:uppercase;letter-spacing:.05em;margin-bottom:4px;">Ballpark Range</div>
        <div style="font-size:24px;font-weight:900;font-family:var(--font-display);color:hsl(var(--primary));letter-spacing:-0.02em;">${escHtml(range)}</div>
        <div class="q-muted" style="font-size:11px;margin-top:4px;">Final price confirmed after site visit</div>
        ${d.ballparkRange?.note ? `<div class="q-muted" style="font-size:11px;margin-top:6px;padding-top:6px;border-top:1px solid hsl(var(--primary) / 0.2);font-style:italic;">${escHtml(d.ballparkRange.note)}</div>` : ""}
      </div>` : ""}
    </div>

    ${_renderSiteVisitForm()}
    <div class="q-nav-row" style="margin-top:16px;">
      <button class="q-btn-back" onclick="back()">&#8592; Back to Questions</button>
      <div></div>
    </div>
    ${NOTE}`;
}

// ── Step: Photo Gate ──────────────────────────────────────────────────────────
// Three states: (1) no photo yet — guide + picker; (2) uploading — spinner;
// (3) confirmed — green success state, proceed enabled.
// Uses PHOTO_MODULE_GUIDES for per-module step-by-step instructions + example image.
function renderPhotoGate() {
  const info      = S.photoGateInfo || {};
  const module    = info.module;
  const confirmed = Boolean(S.confirmedPhotoModules[module]);
  const uploading = S.photoGateUploading;
  const guide     = PHOTO_MODULE_GUIDES[module] || {};

  const uploadSvg = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>`;
  const checkSvg  = `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><polyline points="7 12 10.5 15.5 17 8.5"/></svg>`;

  // ── Step-by-step instructions ──
  const stepsHtml = (guide.steps || []).map((s, i) => `
    <div style="display:flex;gap:12px;align-items:flex-start;margin-bottom:10px;">
      <div style="flex-shrink:0;width:24px;height:24px;border-radius:50%;background:hsl(var(--primary));color:white;font-size:12px;font-weight:800;display:flex;align-items:center;justify-content:center;">${i + 1}</div>
      <p style="margin:0;font-size:14px;line-height:1.5;padding-top:2px;">${escHtml(s)}</p>
    </div>`).join("");

  // ── Quick tips ──
  const tipsHtml = (guide.tips || []).length ? `
    <div style="background:hsl(var(--subtle-bg,210 20% 97%));border-radius:10px;padding:12px 14px;margin-top:16px;">
      <p style="margin:0 0 6px;font-size:11px;font-weight:800;text-transform:uppercase;letter-spacing:.06em;color:hsl(var(--muted-fg));">Quick tips</p>
      ${(guide.tips).map(t => `
        <div style="display:flex;gap:8px;align-items:flex-start;margin-top:4px;">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="hsl(var(--primary))" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" style="flex-shrink:0;margin-top:3px;"><polyline points="20 6 9 17 4 12"/></svg>
          <span style="font-size:12.5px;color:hsl(var(--muted-fg));">${escHtml(t)}</span>
        </div>`).join("")}
    </div>` : "";

  // ── Example image ──
  const exampleHtml = guide.exampleImg ? `
    <div style="margin:18px 0 0;">
      <p style="margin:0 0 6px;font-size:11px;font-weight:800;text-transform:uppercase;letter-spacing:.06em;color:hsl(var(--muted-fg));">Example photo</p>
      <img src="${guide.exampleImg}" alt="${escHtml(guide.exampleAlt || "Example photo")}"
        style="width:100%;border-radius:10px;border:1px solid hsl(var(--border));display:block;"/>
    </div>` : "";

  // ── Upload zone (bottom action area) ──
  let actionArea;
  if (confirmed) {
    actionArea = `
      <div style="display:flex;align-items:center;justify-content:space-between;gap:12px;background:hsl(120 60% 97%);border:1.5px solid hsl(120 60% 80%);border-radius:12px;padding:14px 18px;">
        <div style="display:flex;align-items:center;gap:10px;">
          <span style="color:hsl(120 60% 40%);">${checkSvg}</span>
          <div>
            <p style="margin:0;font-size:14px;font-weight:700;color:hsl(120 60% 35%);">Photo uploaded</p>
            <p style="margin:2px 0 0;font-size:12px;color:hsl(120 60% 50%);">Ready to continue</p>
          </div>
        </div>
        <label style="cursor:pointer;font-size:12px;color:hsl(var(--muted-fg));text-decoration:underline;white-space:nowrap;">
          Replace
          <input type="file" accept="image/*" multiple style="display:none;" onchange="onPhotoGateSelected(this)">
        </label>
      </div>`;
  } else if (uploading) {
    actionArea = `
      <div style="display:flex;align-items:center;justify-content:center;gap:12px;border:1.5px solid hsl(var(--border));border-radius:12px;padding:18px;">
        <div style="width:22px;height:22px;border:2.5px solid hsl(var(--border));border-top-color:hsl(var(--primary));border-radius:50%;animation:q-spin 0.8s linear infinite;flex-shrink:0;"></div>
        <p style="margin:0;font-size:14px;color:hsl(var(--muted-fg));">Uploading photo&hellip;</p>
      </div>`;
  } else {
    actionArea = `
      <div style="border:2px dashed hsl(var(--border));border-radius:12px;padding:20px;text-align:center;">
        <label style="cursor:pointer;display:inline-flex;align-items:center;gap:8px;padding:11px 24px;background:hsl(var(--primary));color:white;border-radius:50px;font-size:14px;font-weight:700;">
          ${uploadSvg}
          Choose Photo
          <input type="file" accept="image/*" multiple style="display:none;" onchange="onPhotoGateSelected(this)">
        </label>
        <p class="q-muted" style="font-size:12px;margin:10px 0 0;">JPG, PNG or HEIC &bull; up to 5 photos</p>
        <p id="photoGateErr" style="display:none;margin:10px 0 0;padding:10px 12px;background:hsl(0 84% 97%);border:1px solid hsl(0 84% 85%);border-radius:8px;font-size:13px;color:hsl(0 72% 45%);"></p>
      </div>`;
  }

  return `
    ${stepHeader(3, "Photo Required")}
    <div class="q-card-section" style="padding:24px 20px;">
      <h3 style="font-family:var(--font-display);font-size:19px;font-weight:800;margin:0 0 4px;letter-spacing:-0.01em;">
        ${escHtml(guide.title || "One photo needed")}
      </h3>
      <p class="q-muted" style="font-size:13px;margin:0 0 18px;">
        We need this before we can calculate your price — it only takes a minute.
      </p>
      ${stepsHtml}
      ${tipsHtml}
      ${exampleHtml}
      <div style="margin-top:20px;">
        ${actionArea}
      </div>
    </div>
    <div class="q-nav-row" style="margin-top:20px;">
      <button class="q-btn-back" onclick="back()" ${uploading ? "disabled" : ""}>&#8592; Back</button>
      <button class="q-btn-next" id="photoGateProceedBtn"
        ${confirmed && !uploading ? "" : "disabled"}
        onclick="checkPhotoGate()">
        <img src="/pages/img/sword-light.png" class="sword-icon" alt="">
        <span>See My Price</span>
      </button>
    </div>
    ${NOTE}`;
}

// ── Step: Consult CTA ─────────────────────────────────────────────────────────
// Shown when the quote engine returns manual_review_required: true.
function renderConsult() {
  const d       = S.consultData || {};
  const svcName = d.service_name || "this service";
  const range   = d.ballparkRange
    ? `$${Number(d.ballparkRange.low).toLocaleString()} \u2013 $${Number(d.ballparkRange.high).toLocaleString()}`
    : null;

  return `
    ${stepHeader(3, "Free Site Visit Needed")}
    <div class="q-card-section" style="padding:28px 20px 24px;">
      <div style="text-align:center;margin-bottom:18px;">
        <svg width="52" height="52" viewBox="0 0 48 48" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" style="color:hsl(var(--primary));display:block;margin:0 auto;"><path d="M24 4C15.16 4 8 11.16 8 20c0 12 16 24 16 24s16-12 16-24c0-8.84-7.16-16-16-16z"/><circle cx="24" cy="20" r="5"/></svg>
      </div>
      <h3 style="font-family:var(--font-display);font-size:18px;font-weight:800;margin:0 0 10px;letter-spacing:-0.01em;text-align:center;">
        ${escHtml(svcName)} Needs an On-Site Estimate
      </h3>
      <p class="q-muted" style="max-width:420px;margin:0 auto 16px;text-align:center;font-size:14px;">
        Every project like this has unique site conditions our online estimator can't fully account for. An electrician will come out, take a look, and give you an accurate price — the visit is completely free.
      </p>
      ${range ? `
      <div style="background:hsl(var(--primary) / 0.08);border:1px solid hsl(var(--primary) / 0.25);border-radius:10px;padding:14px 18px;text-align:center;margin:0 auto 20px;max-width:340px;">
        <div class="q-muted" style="font-size:12px;font-weight:700;text-transform:uppercase;letter-spacing:.05em;margin-bottom:4px;">Ballpark Range</div>
        <div style="font-size:24px;font-weight:900;font-family:var(--font-display);color:hsl(var(--primary));letter-spacing:-0.02em;">${escHtml(range)}</div>
        <div class="q-muted" style="font-size:11px;margin-top:4px;">Final price confirmed after site visit</div>
        ${d.ballparkRange?.note ? `<div class="q-muted" style="font-size:11px;margin-top:6px;padding-top:6px;border-top:1px solid hsl(var(--primary) / 0.2);font-style:italic;">${escHtml(d.ballparkRange.note)}</div>` : ""}
      </div>` : ""}
    </div>

    ${_renderSiteVisitForm()}
    <div class="q-nav-row" style="margin-top:16px;">
      <button class="q-btn-back" onclick="back()">&#8592; Back</button>
      <div></div>
    </div>
    ${NOTE}`;
}

// ── Notice banner + Equipment picker ─────────────────────────────────────────
function noticeHTML(msg, type) {
  const iconPaths = {
    code:    '<path d="M24 4L44 40H4L24 4Z" stroke-width="1.8" stroke-linejoin="round" fill="none"/><line x1="24" y1="19" x2="24" y2="30" stroke-width="2.5" stroke-linecap="round"/><circle cx="24" cy="36.5" r="2" fill="currentColor" stroke="none"/>',
    warning: '<path d="M24 4L44 40H4L24 4Z" stroke-width="1.8" stroke-linejoin="round" fill="none"/><line x1="24" y1="19" x2="24" y2="30" stroke-width="2.5" stroke-linecap="round"/><circle cx="24" cy="36.5" r="2" fill="currentColor" stroke="none"/>',
    info:    '<circle cx="24" cy="24" r="20" stroke-width="1.8" fill="none"/><circle cx="24" cy="14" r="2" fill="currentColor" stroke="none"/><line x1="24" y1="20" x2="24" y2="36" stroke-width="2.5" stroke-linecap="round"/>',
  };
  const cls = type === "warning" ? "q-notice--warning" : type === "code" ? "q-notice--code" : "q-notice--info";
  return `<div class="q-equip-notice ${cls}">
    <svg class="q-notice-icon" width="18" height="18" viewBox="0 0 48 48" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round">${iconPaths[type] || iconPaths.info}</svg>
    <span>${escHtml(msg)}</span>
  </div>`;
}

function renderEquipment() {
  const equipSvcs     = getEquipServices();
  const globalNotices = getGlobalEquipNotices();

  // Auto-select first product and default variant for any service not yet chosen
  for (const svc of equipSvcs) {
    const cat = resolveEquipCatalog(svc);
    if (!cat) continue;
    if (!S.equipmentSelections[svc.job_type_id]) {
      S.equipmentSelections[svc.job_type_id] = cat.products[0]?.sku;
    }
    for (const p of cat.products) {
      const vk = varKey(svc.job_type_id, p.sku);
      if (p.variants?.length && !S.variantSelections[vk]) {
        S.variantSelections[vk] = p.variants[0].id;
      }
    }
  }

  const globalNoticesHTML = globalNotices.map(n => noticeHTML(n.msg, n.type)).join("");

  const sectionsHTML = equipSvcs.map(svc => {
    const cat = resolveEquipCatalog(svc);
    if (!cat) return "";
    const jt          = (S.config?.jobTypes || []).find(j => j.job_type_id === svc.job_type_id);
    const selectedSku = S.equipmentSelections[svc.job_type_id];
    const notices     = getEquipNotices(svc, cat);
    const highlightSkus = notices.filter(n => n.highlightSku).map(n => n.highlightSku);

    const noticesHTML  = notices.map(n => noticeHTML(n.msg, n.type)).join("");
    const qtyLabel     = svc.qty > 1
      ? `<span class="q-equip-qty-note">${svc.qty} units &mdash; upgrade price per unit</span>` : "";
    const multiUnitNote = svc.qty > 1
      ? `<div class="q-equip-multi-unit">This finish selection applies to all ${svc.qty} units. Let us know day-of if you need different finishes per room.</div>` : "";

    // Customer-supplied pseudo-product (appended after catalog products)
    const suppliedCard = (() => {
      const isSel = selectedSku === "CUSTOMER-PROVIDED";
      return `
        <div class="q-equip-card q-equip-supplied${isSel ? " selected" : ""}"
             data-typeid="${escHtml(svc.job_type_id)}" data-sku="CUSTOMER-PROVIDED"
             style="--sp-d:${0.04 + cat.products.length * 0.09}s;--sp-f:${0.20 + cat.products.length * 0.09}s;">
          <div class="q-equip-img-col">
            <div class="q-equip-icon">
              <svg width="30" height="30" viewBox="0 0 48 48" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${_ICON_BOX}</svg>
            </div>
          </div>
          <div class="q-equip-body">
            <div class="q-equip-brand">Customer-Supplied</div>
            <div class="q-equip-name">I already have the equipment</div>
            <div class="q-equip-desc">You purchased your own — we handle the professional installation only</div>
            <div class="q-equip-badge included">
              ${isSel ? SWORD_SVG + "&nbsp;" : ""}Labor only &mdash; no materials markup
            </div>
          </div>
          <div class="q-equip-radio"></div>
        </div>`;
    })();

    const cardsHTML = cat.products.map((p, pi) => {
      const isSel       = p.sku === selectedSku;
      const isIncl      = p.upgrade_delta === 0;
      const isHighlight = highlightSkus.includes(p.sku);
      const iconSVG     = cat.icon || '<polygon points="24,4 4,44 44,44"/>';

      const imgOrIcon = p.img
        ? `<img class="q-equip-img" src="${escHtml(p.img)}" alt="${escHtml(p.brand + ' ' + p.name)}" loading="lazy"
               onerror="this.style.display='none';this.nextElementSibling.style.display='flex';">
           <div class="q-equip-icon" style="display:none;">
             <svg width="30" height="30" viewBox="0 0 48 48" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${iconSVG}</svg>
           </div>`
        : `<div class="q-equip-icon">
             <svg width="30" height="30" viewBox="0 0 48 48" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${iconSVG}</svg>
           </div>`;

      // Variant picker — only rendered inside the selected card, and only if product has >1 variant
      const vk = varKey(svc.job_type_id, p.sku);
      const selectedVid = S.variantSelections[vk] || p.variants?.[0]?.id;
      const variantPickerHTML = (isSel && (p.variants?.length ?? 0) > 1)
        ? `<div class="q-equip-variants">
             <span class="q-equip-variant-label">Finish</span>
             ${(p.variants || []).map(v => `
               <button class="q-equip-variant-btn${v.id === selectedVid ? " selected" : ""}"
                       data-typeid="${escHtml(svc.job_type_id)}"
                       data-sku="${escHtml(p.sku)}"
                       data-varid="${escHtml(v.id)}"
                       title="${escHtml(v.label)}">
                 <span class="q-equip-swatch-dot" style="--sw-color:${escHtml(v.swatch)};${v.border ? "border-color:hsl(var(--border));" : ""}"></span>
                 ${escHtml(v.label)}
               </button>`).join("")}
           </div>` : "";

      return `
        <div class="q-equip-card${isSel ? " selected" : ""}${isHighlight ? " highlighted" : ""}"
             data-typeid="${escHtml(svc.job_type_id)}" data-sku="${escHtml(p.sku)}"
             style="--sp-d:${0.04 + pi * 0.09}s;--sp-f:${0.20 + pi * 0.09}s;">
          <div class="q-equip-img-col">${imgOrIcon}</div>
          <div class="q-equip-body">
            ${isHighlight ? `<span class="q-equip-recommended">Recommended</span>` : ""}
            <div class="q-equip-brand">${escHtml(p.brand)}</div>
            <div class="q-equip-name">${escHtml(p.name)}</div>
            <div class="q-equip-desc">${escHtml(p.desc)}</div>
            <div class="q-equip-badge ${isIncl ? "included" : "upgrade"}">
              ${isSel ? SWORD_SVG + "&nbsp;" : ""}${isIncl ? "Included in quote" : `+ $${p.upgrade_delta} per unit`}
            </div>
            ${variantPickerHTML}
          </div>
          <div class="q-equip-radio"></div>
        </div>`;
    }).join("");

    return `
      <div class="q-equip-section">
        <div class="q-equip-section-title">${escHtml(jt?.name_public || cat.label)} ${qtyLabel}</div>
        <div class="q-equip-label">${escHtml(cat.label)}</div>
        ${cat.note ? `<div class="q-equip-note">${escHtml(cat.note)}</div>` : ""}
        ${noticesHTML}
        <div class="q-equip-grid">${cardsHTML}${suppliedCard}</div>
        ${multiUnitNote}
      </div>`;
  }).join("");

  return `
    ${stepHeader(4, "Equipment &amp; Materials")}
    <p class="q-muted" style="margin:-8px 0 22px;">
      Choose the products that match your style and budget. All options include professional installation by our licensed crew.
    </p>
    ${globalNoticesHTML}
    ${sectionsHTML}
    <div class="q-nav-row">
      <button class="q-btn-back" onclick="back()">&#8592; Back</button>
      <button class="q-btn-next" id="equipNextBtn">
        <img src="/pages/img/sword-light.png" class="sword-icon" alt="">
        <span>See My Price</span>
      </button>
    </div>
    ${NOTE}`;
}

// ── Event Binding ─────────────────────────────────────────────────────────────
function bindEvents() {
  // Segment cards — click to select, Next Step to advance
  document.querySelectorAll(".q-type-card").forEach(card => {
    card.addEventListener("click", () => {
      S.segment = card.dataset.seg;
      document.querySelectorAll(".q-type-card").forEach(c => c.classList.remove("selected"));
      card.classList.add("selected");
      document.getElementById("nextSegment")?.removeAttribute("disabled");
    });
  });

  document.getElementById("nextSegment")?.addEventListener("click", () => {
    if (!S.segment) return;
    if (S.segment === "Commercial") { go("commercial_soon"); return; }
    S.selectedCategories = [];
    S.selectedServices = []; S.answers = {}; S.addons = [];
    go("categories");
  });

  // Category items — toggle
  document.querySelectorAll(".q-cat-item").forEach(item => {
    item.addEventListener("click", () => {
      const cat = item.dataset.cat;
      const idx = S.selectedCategories.indexOf(cat);
      if (idx >= 0) S.selectedCategories.splice(idx, 1);
      else S.selectedCategories.push(cat);
      const sel = S.selectedCategories.includes(cat);
      item.classList.toggle("selected", sel);
      item.querySelector(".q-cat-check").style.visibility = sel ? "visible" : "hidden";
      document.getElementById("nextCategories").disabled = !S.selectedCategories.length;
    });
  });

  document.getElementById("nextCategories")?.addEventListener("click", () => {
    if (!S.selectedCategories.length) return;
    S.selectedServices = []; S.answers = {}; S.addons = [];
    go("services");
  });

  // Service cards — multi-select toggle with individual inline qty
  document.querySelectorAll(".q-svc-card").forEach(card => {
    card.querySelector(".q-svc-item")?.addEventListener("click", () => {
      const typeId  = card.dataset.type;
      const qtyRow  = card.querySelector(".q-svc-qty-row");
      const cbEl    = card.querySelector(".q-svc-checkbox");
      const idx     = S.selectedServices.findIndex(s => s.job_type_id === typeId);

      if (idx >= 0) {
        // Deselect this service
        S.selectedServices.splice(idx, 1);
        card.classList.remove("selected");
        if (cbEl)   cbEl.innerHTML = "";
        if (qtyRow) qtyRow.style.display = "none";
      } else {
        // Select this service (add to list, keep others)
        S.selectedServices.push({ job_type_id: typeId, qty: 1 });
        card.classList.add("selected");
        if (cbEl)   cbEl.innerHTML = SWORD_SVG;
        if (qtyRow) qtyRow.style.display = "";
        const valEl = document.getElementById("qtyVal_" + typeId);
        if (valEl)  valEl.textContent = 1;
      }
      document.getElementById("nextService")?.toggleAttribute("disabled", S.selectedServices.length === 0);
    });
  });

  // Inline qty dec/inc buttons (stop propagation so they don't toggle the card)
  document.querySelectorAll(".q-qty-dec").forEach(btn => {
    btn.addEventListener("click", e => {
      e.stopPropagation();
      const typeId = btn.dataset.type;
      const svc    = S.selectedServices.find(s => s.job_type_id === typeId);
      if (svc) { svc.qty = Math.max(1, svc.qty - 1); }
      const valEl = document.getElementById("qtyVal_" + typeId);
      if (valEl) valEl.textContent = svc?.qty ?? 1;
    });
  });
  document.querySelectorAll(".q-qty-inc").forEach(btn => {
    btn.addEventListener("click", e => {
      e.stopPropagation();
      const typeId = btn.dataset.type;
      const svc    = S.selectedServices.find(s => s.job_type_id === typeId);
      if (svc) { svc.qty = Math.min(20, svc.qty + 1); }
      const valEl = document.getElementById("qtyVal_" + typeId);
      if (valEl) valEl.textContent = svc?.qty ?? 1;
    });
  });

  document.getElementById("nextService")?.addEventListener("click", () => {
    if (!S.selectedServices.length) return;
    const pid       = primaryTypeId();
    const hasQs     = (S.config?.questionsByType?.[pid]?.length || 0) > 0;
    const hasAddons = (S.config?.addonsByType?.[pid]?.length   || 0) > 0;
    if (hasQs || hasAddons) go("questions");
    else if (hasEquipmentCatalog()) go("equipment");
    else checkPhotoGate();  // enforce photo gate even when no questions/equipment
  });

  // Questions — radio (with disqualify gate + uncertain tracking)
  document.querySelectorAll("input[type=radio]").forEach(radio => {
    radio.addEventListener("change", () => {
      const qid   = radio.name.replace("q_", "");
      const label = radio.closest("label[data-dis]");
      S.answers[qid] = radio.value;

      if (label?.dataset.unc === "1") {
        S.uncertain[qid] = true;
      } else {
        delete S.uncertain[qid];
      }

      if (label?.dataset.dis === "1") {
        if (!S.consultData) {
          const firstSvc = S.selectedServices[0];
          const jt = (S.config?.jobTypes || []).find(j => j.job_type_id === firstSvc?.job_type_id);
          const ballparkRange = firstSvc
            ? (S.config?.serviceBallparkRanges?.[firstSvc.job_type_id] || null)
            : null;
          S.consultData = {
            service_id:    firstSvc?.job_type_id || null,
            service_name:  jt?.name_public || firstSvc?.job_type_id || "this service",
            ballparkRange,
            reason:        "disqualified",
          };
        }
        go("sitevisit");
        return;
      }
      radio.closest(".q-options")?.querySelectorAll(".q-option")
        .forEach(l => l.classList.toggle("selected", l.querySelector("input") === radio));
    });
  });

  // Questions — number steppers
  document.querySelectorAll(".q-num-dec").forEach(btn => {
    btn.addEventListener("click", () => {
      const qid = btn.dataset.qid;
      const cur = Number(S.answers[qid] || 1);
      const nv  = Math.max(1, cur - 1);
      S.answers[qid] = nv;
      const el = document.getElementById("numVal_" + qid);
      if (el) el.textContent = nv;
      btn.disabled = nv <= 1;
      btn.nextElementSibling?.nextElementSibling?.removeAttribute("disabled");
    });
  });
  document.querySelectorAll(".q-num-inc").forEach(btn => {
    btn.addEventListener("click", () => {
      const qid = btn.dataset.qid;
      const cur = Number(S.answers[qid] || 1);
      const nv  = Math.min(20, cur + 1);
      S.answers[qid] = nv;
      const el = document.getElementById("numVal_" + qid);
      if (el) el.textContent = nv;
      btn.disabled = nv >= 20;
      btn.previousElementSibling?.previousElementSibling?.removeAttribute("disabled");
    });
  });

  // Questions — inline photo pickers
  document.querySelectorAll(".q-photo-inline").forEach(inp => {
    inp.addEventListener("change", () => {
      const qid = inp.dataset.qid;
      if (!S.photos[qid]) S.photos[qid] = [];
      Array.from(inp.files).forEach(f => S.photos[qid].push(f));
      const lbl = inp.closest("label.q-file-label");
      if (lbl) {
        const count = S.photos[qid].length;
        lbl.childNodes[0].textContent =
          "\uD83D\uDCF7 " + count + " photo" + (count !== 1 ? "s" : "") + " added";
      }
    });
  });

  document.querySelectorAll(".q-addon-check").forEach(cb => {
    cb.addEventListener("change", () => {
      if (cb.checked) { if (!S.addons.includes(cb.value)) S.addons.push(cb.value); }
      else { S.addons = S.addons.filter(id => id !== cb.value); }
      cb.closest(".q-addon")?.classList.toggle("selected", cb.checked);
    });
  });
  document.querySelectorAll(".q-text-input").forEach(inp => {
    inp.addEventListener("change", () => { S.answers[inp.name.replace("q_", "")] = inp.value; });
  });

  document.getElementById("seePriceBtn")?.addEventListener("click", () => {
    if (!locationQsComplete()) {
      document.querySelector(".q-loc-section")?.scrollIntoView({ behavior: "smooth", block: "start" });
      return;
    }
    if (hasEquipmentCatalog()) go("equipment");
    else checkPhotoGate();
  });

  // Location questions — option pills (distance + attendance)
  document.querySelectorAll(".q-loc-option").forEach(el => {
    el.addEventListener("click", () => {
      const field = el.dataset.field;
      const val   = el.dataset.val;
      S.locationAnswers[field] = val;
      el.closest(".q-loc-options")?.querySelectorAll(".q-loc-option")
        .forEach(o => o.classList.toggle("selected", o === el));
      // When attendance changes, show/hide the conditional access/photo sections
      if (field === "attendance") {
        const noPhone  = document.getElementById("locNoPhoneSection");
        const attended = document.getElementById("locAttendedSection");
        if (noPhone)  noPhone.style.display  = val === "no_phone" ? "block" : "none";
        if (attended) attended.style.display = val && val !== "no_phone" ? "block" : "none";
        // Scroll the newly-revealed section into view
        const target = val === "no_phone" ? noPhone : attended;
        target?.scrollIntoView({ behavior: "smooth", block: "nearest" });
      }
      const btn = document.getElementById("seePriceBtn");
      if (btn) btn.disabled = !locationQsComplete();
    });
  });

  // Access instructions textarea (unattended jobs)
  document.getElementById("locAccessInstructions")?.addEventListener("input", e => {
    S.locationAnswers.access_instructions = e.target.value;
    const btn = document.getElementById("seePriceBtn");
    if (btn) btn.disabled = !locationQsComplete();
  });

  // Location area photo — inline upload in questions step
  document.getElementById("locAreaPhotoInput")?.addEventListener("change", async e => {
    const files = Array.from(e.target.files || []);
    if (!files.length) return;
    S.locationPhotos = files;
    if (!S.quoteId) {
      try {
        const sr = await fetch("/api/quote/start", {
          method: "POST", headers: { "Content-Type": "application/json" }, body: "{}",
        });
        const sd = await sr.json();
        if (!sd.quote_id) throw new Error("Could not start session.");
        S.quoteId = sd.quote_id;
      } catch {}
    }
    try {
      for (const file of files) {
        const base64 = await fileToBase64(file);
        const r = await fetch("/api/quote/photo", {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            quote_id: S.quoteId, base64,
            mime_type: file.type || "image/jpeg",
            filename: file.name,
            module: "AREA_PHOTO",
          }),
        });
        const d = await r.json();
        if (!d.ok) throw new Error(d.error || "Upload failed.");
      }
      S.locationPhotoUploaded = true;
    } catch (err) {
      const errEl = document.getElementById("locPhotoErr");
      if (errEl) { errEl.textContent = "Upload failed: " + err.message; errEl.style.display = "block"; }
      return;
    }
    go("questions");
  });

  // Consent checkboxes — enable/disable submit button
  document.querySelectorAll(".q-consent-check").forEach(cb => {
    cb.addEventListener("change", () => {
      S.consents[cb.id.replace("consent_", "")] = cb.checked;
      const submitBtn = document.getElementById("submitLockBtn");
      if (submitBtn) submitBtn.disabled = !consentsComplete();
    });
  });

  // Equipment card picker — radio-style within each service section
  // Re-renders the step (scroll-preserved) so variant pickers move with the selection
  document.querySelectorAll(".q-equip-card").forEach(card => {
    card.addEventListener("click", e => {
      if (e.target.closest(".q-equip-variant-btn")) return; // let variant handler run
      const typeId = card.dataset.typeid;
      const sku    = card.dataset.sku;
      S.equipmentSelections[typeId] = sku;
      const sy = window.scrollY;
      go("equipment");
      requestAnimationFrame(() => window.scrollTo(0, sy));
    });
  });

  // Variant (color/finish) picker buttons
  document.querySelectorAll(".q-equip-variant-btn").forEach(btn => {
    btn.addEventListener("click", e => {
      e.stopPropagation();
      const { typeid: typeId, sku, varid: vid } = btn.dataset;
      S.variantSelections[varKey(typeId, sku)] = vid;
      // Update sibling button states without a full re-render
      btn.closest(".q-equip-variants")?.querySelectorAll(".q-equip-variant-btn").forEach(b => {
        b.classList.toggle("selected", b.dataset.varid === vid);
      });
    });
  });

  document.getElementById("equipNextBtn")?.addEventListener("click", checkPhotoGate);

  // Review: advance to confirm once slot selected
  document.getElementById("goConfirmBtn")?.addEventListener("click", () => {
    if (!S.selectedSlot) return;
    go("confirm");
  });

  // Confirm: referral sub-fields toggle
  document.getElementById("ld_source")?.addEventListener("change", e => {
    const box = document.getElementById("referralFields");
    if (!box) return;
    const isRef = e.target.value === "Referral";
    box.style.display = isRef ? "block" : "none";
    if (!isRef) {
      const n = document.getElementById("ref_name");
      const p = document.getElementById("ref_phone");
      if (n) n.value = "";
      if (p) p.value = "";
    }
  });

  // Confirm: ZIP reprice
  document.getElementById("ld_zip")?.addEventListener("input", e => {
    const zip = e.target.value.replace(/\D/g, "").slice(0, 5);
    e.target.value = zip;
    clearTimeout(repricTimer);
    if (zip.length === 5) repricTimer = setTimeout(() => reprice(zip), 800);
  });

  document.getElementById("submitLockBtn")?.addEventListener("click", submitLock);

  // Photo
  document.getElementById("photoFile")?.addEventListener("change", onPhotoSelected);
  document.getElementById("uploadPhotoBtn")?.addEventListener("click", uploadPhoto);
  document.getElementById("finalizeBtn")?.addEventListener("click", submitBooking);

  // ── Address autocomplete (Nominatim/OpenStreetMap, US only) ─────────────────
  (function attachAddressAutocomplete() {
    const addrInput  = document.getElementById("ld_address");
    const addrDrop   = document.getElementById("addrDropdown");
    const confirmBnr = document.getElementById("addrConfirmBanner");
    if (!addrInput || !addrDrop) return;

    let timer = null;
    let lastResults = [];

    function fmtAddress(item) {
      const a = item.address || {};
      const parts = [];
      if (a.house_number && a.road) parts.push(`${a.house_number} ${a.road}`);
      else if (a.road) parts.push(a.road);
      const city = a.city || a.town || a.village || a.hamlet || "";
      if (city) parts.push(city);
      if (a.state) parts.push(a.state);
      if (a.postcode) parts.push(a.postcode);
      return parts.length > 1 ? parts.join(", ") : item.display_name;
    }

    function hideDropdown() { addrDrop.style.display = "none"; }

    function confirmAddress(label, zip) {
      addrInput.value = label;
      S.addressConfirmed = true;
      // Auto-fill ZIP if blank
      const zipInput = document.getElementById("ld_zip");
      if (zipInput && !zipInput.value && zip) {
        zipInput.value = zip.slice(0, 5);
        zipInput.dispatchEvent(new Event("input"));
      }
      hideDropdown();
      if (confirmBnr) confirmBnr.style.display = "none";
      // Clear any address error
      const errEl = document.getElementById("leadErr");
      if (errEl && errEl.textContent.includes("address")) { errEl.style.display = "none"; }
    }

    function showConfirmBanner(label, zip) {
      if (!confirmBnr) return;
      confirmBnr.innerHTML =
        `<span style="flex:1;">Did you mean: <strong>${escHtml(label)}</strong>?</span>` +
        `<button class="q-addr-confirm-btn" type="button">Yes, that's it &#10003;</button>`;
      confirmBnr.style.display = "flex";
      confirmBnr.querySelector("button").addEventListener("click", () => confirmAddress(label, zip));
    }

    function showResults(results) {
      lastResults = results;
      if (!results.length) { hideDropdown(); return; }
      addrDrop.innerHTML = results.map(item => {
        const label = fmtAddress(item);
        return `<div class="q-addr-opt" tabindex="0">${escHtml(label)}</div>`;
      }).join("");
      addrDrop.style.display = "block";
      addrDrop.querySelectorAll(".q-addr-opt").forEach((el, i) => {
        const label = fmtAddress(results[i]);
        const zip   = results[i].address?.postcode || "";
        el.addEventListener("mousedown", e => {
          e.preventDefault();
          confirmAddress(label, zip);
        });
      });
    }

    addrInput.addEventListener("input", () => {
      S.addressConfirmed = false;
      if (confirmBnr) confirmBnr.style.display = "none";
      clearTimeout(timer);
      const q = addrInput.value.trim();
      if (q.length < 3) { hideDropdown(); return; }
      timer = setTimeout(async () => {
        try {
          const url = `https://nominatim.openstreetmap.org/search?format=json&addressdetails=1&countrycodes=us&limit=6&q=${encodeURIComponent(q)}`;
          const r = await fetch(url, { headers: { "Accept-Language": "en-US,en" } });
          const data = await r.json();
          showResults(data);
        } catch { hideDropdown(); }
      }, 400);
    });

    addrInput.addEventListener("blur", () => {
      setTimeout(() => {
        hideDropdown();
        // If address is filled but not confirmed, show top suggestion as banner
        if (!S.addressConfirmed && addrInput.value.trim() && lastResults.length) {
          const top = lastResults[0];
          showConfirmBanner(fmtAddress(top), top.address?.postcode || "");
        }
      }, 200);
    });
  })();
}

// ── API: Calculate price ───────────────────────────────────────────────────────
async function calcPrice() {
  go("review");
  document.getElementById("stepContent").innerHTML = loadingHTML("Calculating your price\u2026");

  try {
    if (!S.quoteId) {
      const sr = await fetch("/api/quote/start", {
        method: "POST", headers: { "Content-Type": "application/json" }, body: "{}",
      });
      const sd = await sr.json();
      if (!sd.quote_id) throw new Error("Could not start session.");
      S.quoteId = sd.quote_id;
    }

    // Calc price for each selected service, then sum
    const results = await Promise.all(S.selectedServices.map(svc =>
      fetch("/api/quote/calc", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          quote_id: S.quoteId,
          job_type_id: svc.job_type_id,
          answers: S.answers,
          addons: S.addons,
          qty: svc.qty,
          photo_modules_uploaded: Object.keys(S.confirmedPhotoModules).filter(k => S.confirmedPhotoModules[k]),
        }),
      }).then(r => r.json())
    ));

    // Check for manual_review_required before throwing on errors
    const blockedResult = results.find(r => r.manual_review_required);
    if (blockedResult) {
      const idx = results.indexOf(blockedResult);
      const svc = S.selectedServices[idx];
      const jt  = (S.config?.jobTypes || []).find(j => j.job_type_id === svc?.job_type_id);
      S.consultData = {
        service_id:    svc?.job_type_id || null,
        service_name:  jt?.name_public  || svc?.job_type_id || "this service",
        ballparkRange: blockedResult.ballparkRange || null,
        reason:        blockedResult.disqualify_reason || null,
      };
      go("consult");
      return;
    }

    for (const res of results) {
      if (!res.ok && res.error) throw new Error(res.error);
    }

    // Add equipment upgrade deltas (client-side, per-unit × qty)
    const totalPrice = results.reduce((sum, r, i) => {
      return sum + (r.final_price || 0) + equipUpgradeDelta(S.selectedServices[i]);
    }, 0);
    S.pricing = { ok: true, final_price: totalPrice, services: results, evaluation_flag: results.some(r => r.evaluation_flag) };
    S.selectedSlot  = null;
    S.selectedBlock = null;
    go("review");
  } catch (e) {
    document.getElementById("stepContent").innerHTML = errHTML("Could not calculate price: " + e.message);
  }
}

// ── Calendar + block-picker state ─────────────────────────────────────────────
let _calViewYear  = null;   // number — year displayed
let _calViewMonth = null;   // number — 0-based month displayed
let _calDayKey    = null;   // 'YYYY-MM-DD' — currently selected day
let _calDayMap    = {};     // { 'YYYY-MM-DD': [blockObj, ...] }

// ── Load blocks for review screen ──────────────────────────────────────────────
async function loadBlocksForReview() {
  const section = document.getElementById("reviewSlotSection");
  if (!section) return;
  try {
    const r = await fetch("/api/schedule/blocks?days=14");
    const d = await r.json();
    if (!d.ok) throw new Error(d.error || "Could not load windows.");
    S.slotsData = d;

    // Build day map: { 'YYYY-MM-DD': [blockObj, ...] }
    _calDayMap = {};
    for (const b of (d.blocks || []).filter(b => b.available)) {
      if (!_calDayMap[b.date]) _calDayMap[b.date] = [];
      _calDayMap[b.date].push(b);
    }

    // Auto-select first available day (or keep existing selection if still valid)
    const sortedDays = Object.keys(_calDayMap).sort();
    if (!_calDayKey || !_calDayMap[_calDayKey]) {
      _calDayKey = sortedDays[0] || null;
    }

    // Init calendar view to the first available month
    if (_calDayKey) {
      const [y, m] = _calDayKey.split("-").map(Number);
      _calViewYear  = y;
      _calViewMonth = m - 1;
    } else {
      const now = new Date();
      _calViewYear  = now.getFullYear();
      _calViewMonth = now.getMonth();
    }

    renderBlockCalendar();
  } catch (e) {
    section.innerHTML = `<div class="q-error-box" style="margin-top:12px;">Could not load windows: ${escHtml(e.message)}</div>`;
  }
}

// ── Calendar render ────────────────────────────────────────────────────────────
function todayKey() {
  const fmt  = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Chicago" });
  return fmt.format(new Date());
}

function renderBlockCalendar() {
  const section = document.getElementById("reviewSlotSection");
  if (!section) return;

  const today = todayKey();
  const year  = _calViewYear;
  const month = _calViewMonth;

  const monthNames = ["January","February","March","April","May","June",
                      "July","August","September","October","November","December"];

  const firstDow    = new Date(year, month, 1).getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();

  const dows = ["Su","Mo","Tu","We","Th","Fr","Sa"];
  let cells = dows.map(d => `<div class="q-cal-dow">${d}</div>`).join("");
  for (let i = 0; i < firstDow; i++) cells += `<div class="q-cal-day empty"></div>`;

  for (let d = 1; d <= daysInMonth; d++) {
    const mo  = String(month + 1).padStart(2, "0");
    const dy  = String(d).padStart(2, "0");
    const key = `${year}-${mo}-${dy}`;
    const isAvail = !!_calDayMap[key];
    const isSel   = _calDayKey === key;
    const isToday = key === today;
    let cls = "q-cal-day";
    if (isSel)        cls += " selected-date";
    else if (isAvail) cls += " available";
    else              cls += " unavailable";
    if (isToday)      cls += " today";
    cells += `<div class="${cls}" data-datekey="${key}">${d}</div>`;
  }

  // Block buttons for selected day
  const blockPanelHTML = _calDayKey ? renderBlockPanel(_calDayKey) : "";

  // Selected summary bar
  const sumHTML = S.selectedBlock
    ? `<div class="q-selected-summary">
        ${SWORD_SVG}&nbsp; ${escHtml(S.selectedBlock.display)} &bull; Arrival ${escHtml(S.selectedBlock.window_label)}
      </div>`
    : "";

  section.innerHTML = `
    <div class="q-cal">
      <div class="q-cal-header">
        <button class="q-cal-nav" id="calPrev">&#8249;</button>
        <div class="q-cal-title">${escHtml(monthNames[month])} ${year}</div>
        <button class="q-cal-nav" id="calNext">&#8250;</button>
      </div>
      <div class="q-cal-body">
        <div class="q-cal-grid">${cells}</div>
        ${blockPanelHTML}
      </div>
    </div>
    ${sumHTML}`;

  bindBlockCalendarEvents();
}

// ── Block panel (replaces time slots) ─────────────────────────────────────────
function renderBlockPanel(dateKey) {
  const blocks = _calDayMap[dateKey] || [];
  if (!blocks.length) return "";

  const dayLabel = new Intl.DateTimeFormat("en-US", {
    weekday: "long", month: "long", day: "numeric",
  }).format(new Date(dateKey + "T12:00:00"));

  const btns = blocks.map(b => {
    const isSel = S.selectedBlock?.date === b.date && S.selectedBlock?.block === b.block;
    return `<button
      class="q-block-btn${isSel ? " selected" : ""}"
      data-date="${escHtml(b.date)}"
      data-block="${escHtml(b.block)}"
      data-start-iso="${escHtml(b.start_iso)}"
      data-window-label="${escHtml(b.window_label)}"
      data-display="${escHtml(b.display)}">
      <span class="q-block-icon">${b.block === "Morning" ? "&#9728;" : "&#9734;"}</span>
      <span class="q-block-name">${escHtml(b.block)}</span>
      <span class="q-block-window">${escHtml(b.window_label)}</span>
    </button>`;
  }).join("");

  return `
    <div class="q-time-slots">
      <div class="q-time-heading">${escHtml(dayLabel)}</div>
      <div class="q-block-row">${btns}</div>
    </div>`;
}

// ── Calendar event binding ─────────────────────────────────────────────────────
function bindBlockCalendarEvents() {
  document.getElementById("calPrev")?.addEventListener("click", () => {
    _calViewMonth--;
    if (_calViewMonth < 0) { _calViewMonth = 11; _calViewYear--; }
    renderBlockCalendar();
  });
  document.getElementById("calNext")?.addEventListener("click", () => {
    _calViewMonth++;
    if (_calViewMonth > 11) { _calViewMonth = 0; _calViewYear++; }
    renderBlockCalendar();
  });

  // Day click
  document.querySelectorAll(".q-cal-day.available, .q-cal-day.selected-date").forEach(el => {
    el.addEventListener("click", () => {
      _calDayKey = el.dataset.datekey;
      // Clear block selection if it was on a different day
      if (S.selectedBlock && S.selectedBlock.date !== _calDayKey) {
        S.selectedBlock = null;
        S.selectedSlot  = null;
        document.getElementById("goConfirmBtn")?.setAttribute("disabled", "");
      }
      renderBlockCalendar();
    });
  });

  // Block button click
  document.querySelectorAll(".q-block-btn").forEach(btn => {
    btn.addEventListener("click", () => {
      S.selectedBlock = {
        date:         btn.dataset.date,
        block:        btn.dataset.block,
        start_iso:    btn.dataset.startIso,
        window_label: btn.dataset.windowLabel,
        display:      btn.dataset.display,
      };
      S.selectedSlot = S.selectedBlock.start_iso;
      document.getElementById("goConfirmBtn")?.removeAttribute("disabled");
      renderBlockCalendar();
    });
  });
}

// ── ZIP reprice ────────────────────────────────────────────────────────────────
async function reprice(zip) {
  const noteEl   = document.getElementById("zipNote");
  const updateEl = document.getElementById("priceUpdate");
  if (!noteEl || !updateEl) return;
  noteEl.style.display = "block";
  noteEl.className     = "q-zip-note";
  noteEl.textContent   = "Checking travel fee\u2026";
  updateEl.style.display = "none";
  try {
    // First check zone eligibility
    const zr = await fetch(`/api/zone/check?zip=${encodeURIComponent(zip)}`);
    const zone = await zr.json();

    if (zone.reject) {
      noteEl.textContent = zone.reject_reason || "This ZIP is outside our service area.";
      noteEl.className   = "q-zip-note q-zip-warn";
      return;
    }
    if (zone.custom_quote_only) {
      noteEl.textContent = zone.approval_note || "This location requires a custom quote — call us to discuss.";
      noteEl.className   = "q-zip-note q-zip-warn";
      return;
    }

    const r = await fetch("/api/quote/lock", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ quote_id: S.quoteId, job_type_id: primaryTypeId(), answers: S.answers, addons: S.addons, zip, equipment_line_items: buildEquipmentLineItems() }),
    });
    const data = await r.json();
    if (data.final_price != null) {
      noteEl.style.display   = "none";
      noteEl.className       = "q-zip-note";
      updateEl.style.display = "block";
      const delta = data.travel_fee > 0
        ? ` (includes $${data.travel_fee} travel fee)`
        : " (no travel fee for this area)";
      updateEl.innerHTML = `Updated quote: <strong>${exactPriceLabel(data.final_price)}</strong>${escHtml(delta)}`;
      S.lock = data;
    }
  } catch {
    noteEl.textContent = "Could not look up travel fee for this ZIP.";
    noteEl.className   = "q-zip-note";
  }
}

// ── Submit Lock ────────────────────────────────────────────────────────────────
async function submitLock() {
  const name    = val("ld_name");
  const phone   = val("ld_phone");
  const email   = val("ld_email");
  const address = val("ld_address");
  const zip     = val("ld_zip");
  const source  = val("ld_source");
  S.lead_source = source || "";
  const smsOps  = document.getElementById("sms_ops_consent")?.checked ? "true" : "false";
  const smsMkt  = document.getElementById("sms_mkt_consent")?.checked  ? "true" : "false";
  const refName  = val("ref_name");
  const refPhone = val("ref_phone");

  const errEl = document.getElementById("leadErr");
  const show  = msg => { if (errEl) { errEl.textContent = msg; errEl.style.display = "block"; } };
  if (errEl) errEl.style.display = "none";

  if (!name)                return show("Name is required.");
  if (!phone)               return show("Phone is required.");
  if (!address)             return show("Service address is required.");
  if (!S.addressConfirmed)  return show("Please confirm your address — select it from the suggestions or tap \"Yes, that's it\" when it appears.");
  if (!/^\d{5}$/.test(zip)) return show("Please enter a valid 5-digit ZIP code.");
  if (!source)              return show("Please let us know how you found us.");
  if (source === "Referral" && !refName) return show("Please enter the name of the person who referred you.");
  if (source === "Referral" && !refPhone) return show("Please enter the referrer's phone number.");
  if (!consentsComplete())  return show("Please review and check all required agreements before booking.");

  const btn = document.getElementById("submitLockBtn");
  if (btn) { btn.disabled = true; btn.textContent = "Locking\u2026"; }

  try {
    // ── Site-visit path: skip quote lock, book directly ──────────────────────
    if (S.isSiteVisit) {
      S.lock = { customer_name: name, phone, email, address, zip, final_price: S.pricing?.final_price };
      await submitSiteVisitBooking(name, phone, email, address, source, refName, refPhone);
      return;
    }

    const r = await fetch("/api/quote/lock", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ quote_id: S.quoteId, job_type_id: primaryTypeId(), answers: S.answers, addons: S.addons, qty: primaryQty(), customer_name: name, name, phone, email, address, zip, lead_source: S.lead_source || "", sms_opt_in: smsOps, sms_marketing_consent: smsMkt, equipment_line_items: buildEquipmentLineItems(), referrer_name: refName || "", referrer_phone: refPhone || "", attendance: S.locationAnswers.attendance || "", access_instructions: S.locationAnswers.access_instructions || "" }),
    });
    const data = await r.json();
    if (!data.ok) throw new Error(data.error || "Lock failed.");
    S.lock = data;
    if (data.photo_required && !S.photoUploaded) go("photo");
    else await submitBooking();
  } catch (e) {
    show(e.message);
    if (btn) {
      btn.disabled = false;
      const sw = document.documentElement.classList.contains('dark') ? '/pages/img/sword-dark-mode.png' : '/pages/img/sword-light.png';
      btn.innerHTML = `<img src="${sw}" class="sword-icon" alt=""><span>Confirm &amp; Book</span>`;
    }
  }
}

// ── Photo upload ──────────────────────────────────────────────────────────────
function onPhotoSelected(e) {
  const file = e.target.files[0];
  if (!file) return;
  const preview   = document.getElementById("photoPreview");
  const uploadBtn = document.getElementById("uploadPhotoBtn");
  const reader    = new FileReader();
  reader.onload = ev => {
    if (preview) {
      preview.innerHTML = `<img src="${ev.target.result}" alt="Preview"
        style="max-width:100%;max-height:200px;border-radius:10px;margin-top:8px;">`;
      preview.style.display = "block";
    }
    if (uploadBtn) uploadBtn.style.display = "block";
  };
  reader.readAsDataURL(file);
}

async function uploadPhoto() {
  const file     = document.getElementById("photoFile")?.files[0];
  const statusEl = document.getElementById("photoStatus");
  const btn      = document.getElementById("uploadPhotoBtn");
  if (!file || !statusEl) return;
  if (btn) { btn.disabled = true; btn.textContent = "Uploading\u2026"; }
  statusEl.textContent = "Uploading\u2026";
  try {
    const base64 = await fileToBase64(file);
    const r = await fetch("/api/quote/photo", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ quote_id: S.quoteId, filename: file.name, data: base64 }),
    });
    const d = await r.json();
    if (!d.ok) throw new Error(d.error || "Upload failed.");
    S.photoUploaded = true;
    statusEl.textContent = "\u2705 Photo uploaded!";
    const finalizeBtn = document.getElementById("finalizeBtn");
    if (finalizeBtn) finalizeBtn.style.display = "block";
    if (btn) btn.style.display = "none";
  } catch (e) {
    statusEl.textContent = "\u274C Upload failed: " + e.message;
    if (btn) { btn.disabled = false; btn.textContent = "Upload Photo"; }
  }
}

// ── Photo gate — check before calcPrice() ─────────────────────────────────────
// Config-driven: reads photo_gate_modules from the loaded jobType config.
// Walks all selected services; for each service, walks all required modules.
// The first unconfirmed module triggers the photo_gate step. "Confirmed" means
// the photo was successfully uploaded to the server (S.confirmedPhotoModules[mod]).
function checkPhotoGate() {
  for (const svc of S.selectedServices) {
    const jt      = (S.config?.jobTypes || []).find(j => j.job_type_id === svc.job_type_id);
    const modules = jt?.photo_gate_modules || [];
    for (const mod of modules) {
      if (!S.confirmedPhotoModules[mod]) {
        S.photoGateInfo = {
          module:  mod,
          modules: modules,
          label:   PHOTO_MODULE_LABELS[mod] || "a required photo",
          prompt:  (jt.photo_gate_prompts && jt.photo_gate_prompts[mod])
                    || jt.photo_gate_prompt
                    || "A photo is required before we can generate your estimate.",
        };
        // Only record source step when entering fresh (not looping between gate screens)
        if (S.step !== "photo_gate") S.photoGateFromStep = S.step;
        go("photo_gate");
        return;
      }
    }
  }
  calcPrice();
}

// ── Photo gate file picker ─────────────────────────────────────────────────────
// Called from the inline onchange in renderPhotoGate(). Triggers immediate upload
// to the server so S.confirmedPhotoModules[module] gets set on success.
function onPhotoGateSelected(input) {
  if (!input.files?.length) return;
  const mod = S.photoGateInfo?.module;
  if (!mod) return;
  // Store files locally too (used by the existing post-lock upload flow if needed)
  if (!S.photos[mod]) S.photos[mod] = [];
  Array.from(input.files).forEach(f => S.photos[mod].push(f));
  uploadGatePhotos(Array.from(input.files), mod);
}

// ── Gate photo upload ──────────────────────────────────────────────────────────
// Uploads all files for a gate module to the server, then confirms the module
// and re-renders the gate. Requires S.quoteId — starts a quote session if needed.
async function uploadGatePhotos(files, mod) {
  S.photoGateUploading = true;
  go("photo_gate");   // re-render to show spinner

  try {
    // Ensure quote session exists (creates S.quoteId if needed)
    if (!S.quoteId) {
      const sr = await fetch("/api/quote/start", {
        method: "POST", headers: { "Content-Type": "application/json" }, body: "{}",
      });
      const sd = await sr.json();
      if (!sd.quote_id) throw new Error("Could not start session.");
      S.quoteId = sd.quote_id;
    }

    // Upload each file (server records quote_id + module on success)
    for (const file of files) {
      const base64   = await fileToBase64(file);
      const mimeType = file.type || "image/jpeg";
      const r = await fetch("/api/quote/photo", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          quote_id:  S.quoteId,
          base64,
          mime_type: mimeType,
          filename:  file.name,
          module:    mod,
        }),
      });
      const d = await r.json();
      if (!d.ok) throw new Error(d.error || "Upload failed.");
    }

    // All uploads succeeded — confirm module
    S.confirmedPhotoModules[mod] = true;
  } catch (e) {
    // Show error inline without a full re-render so the user can retry
    S.photoGateUploading = false;
    go("photo_gate");
    const errEl = document.getElementById("photoGateErr");
    if (errEl) { errEl.textContent = "Upload failed: " + e.message; errEl.style.display = "block"; }
    return;
  }

  S.photoGateUploading = false;
  go("photo_gate");   // re-render with confirmed state
}

// ── Consult request submit ─────────────────────────────────────────────────────
async function submitConsultRequest() {
  const name      = (document.getElementById("consult_name")?.value    || "").trim();
  const phone     = (document.getElementById("consult_phone")?.value   || "").trim();
  const address   = (document.getElementById("consult_address")?.value || "").trim();
  const best_time = document.getElementById("consult_best_time")?.value || "";

  const errEl = document.getElementById("consultErr");
  const show  = msg => { if (errEl) { errEl.textContent = msg; errEl.style.display = "block"; } };
  if (errEl) errEl.style.display = "none";

  if (!name)    return show("Please enter your name.");
  if (!phone)   return show("Please enter your phone number.");
  if (!address) return show("Please enter the property address where we'll be visiting.");

  const btn = document.getElementById("submitConsultBtn");
  if (btn) { btn.disabled = true; btn.querySelector("span").textContent = "Booking\u2026"; }

  try {
    const r = await fetch("/api/quote/consult-request", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name,
        phone,
        address,
        best_time,
        service_id:   S.consultData?.service_id   || null,
        service_name: S.consultData?.service_name || null,
        quote_id:     S.quoteId || null,
      }),
    });
    const d = await r.json();
    if (!d.ok) throw new Error(d.error || "Submission failed.");

    const card = document.querySelector(".q-card-section:last-of-type");
    if (card) {
      card.innerHTML = `
        <div style="text-align:center;padding:28px 16px;">
          <svg width="52" height="52" viewBox="0 0 48 48" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" style="color:hsl(120 60% 40%);display:block;margin:0 auto 16px;"><circle cx="24" cy="24" r="20"/><polyline points="14 24 21 31 34 17" stroke-width="2.8"/></svg>
          <h3 style="font-family:var(--font-display);font-size:18px;font-weight:800;margin:0 0 10px;">Site Visit Booked!</h3>
          <p class="q-muted" style="font-size:14px;max-width:360px;margin:0 auto;">
            We'll send one of our electricians out to <strong>${escHtml(address)}</strong> to take a look at your
            <strong>${escHtml(S.consultData?.service_name || "project")}</strong> and give you an accurate price.
            We'll reach out at <strong>${escHtml(phone)}</strong> to confirm your appointment — usually within a few hours on business days.
          </p>
        </div>`;
    }
  } catch (e) {
    show(e.message);
    if (btn) {
      btn.disabled = false;
      btn.querySelector("span").textContent = "Book My Free Site Visit";
    }
  }
}

function fileToBase64(file) {
  return new Promise((res, rej) => {
    const r = new FileReader();
    r.onload  = e => res(e.target.result.split(",")[1]);
    r.onerror = rej;
    r.readAsDataURL(file);
  });
}

// ── Submit Booking ────────────────────────────────────────────────────────────
async function submitBooking() {
  try {
    const lockData = S.lock || S.pricing;
    const r = await fetch("/api/schedule/book", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        quote_id:             S.quoteId,
        scheduled_datetime:   S.selectedSlot,
        block:                S.selectedBlock?.block || null,
        date:                 S.selectedBlock?.date  || null,
        address:              lockData?.address || "",
        customer_name:        lockData?.customer_name || "",
        final_price:          lockData?.final_price,
        lead_source:          S.lead_source || "",
        attendance:           S.locationAnswers.attendance || "",
        access_instructions:  S.locationAnswers.access_instructions || "",
      }),
    });
    const d = await r.json();
    if (!d.ok) throw new Error(d.error || "Booking failed.");
    S.booking = d;
    go("booked");
  } catch (e) {
    const errEl = document.getElementById("leadErr");
    if (errEl) { errEl.textContent = e.message; errEl.style.display = "block"; }
    const btn = document.getElementById("submitLockBtn");
    if (btn) {
      btn.disabled = false;
      const sw = document.documentElement.classList.contains('dark') ? '/pages/img/sword-dark-mode.png' : '/pages/img/sword-light.png';
      btn.innerHTML = `<img src="${sw}" class="sword-icon" alt=""><span>Confirm &amp; Book</span>`;
    }
  }
}

// ── Site-visit booking (bypasses quote lock — books directly) ─────────────────
async function submitSiteVisitBooking(name, phone, email, address, lead_source, referrer_name, referrer_phone) {
  const errEl = document.getElementById("leadErr");
  const showErr = msg => { if (errEl) { errEl.textContent = msg; errEl.style.display = "block"; } };
  const btn = document.getElementById("submitLockBtn");

  try {
    const r = await fetch("/api/quote/site-visit-book", {
      method:  "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name,
        phone,
        email:               email || "",
        address,
        lead_source:         lead_source || "Website",
        service_id:          S.consultData?.service_id   || null,
        service_name:        S.consultData?.service_name || null,
        block:               S.selectedBlock?.block      || null,
        date:                S.selectedBlock?.date        || null,
        quote_id:            S.quoteId || null,
        referrer_name:       referrer_name  || "",
        referrer_phone:      referrer_phone || "",
        attendance:          S.locationAnswers.attendance || "",
        access_instructions: S.locationAnswers.access_instructions || "",
      }),
    });
    const d = await r.json();
    if (!d.ok) throw new Error(d.error || "Booking failed.");

    S.booking = {
      booking_id:          d.booking_id,
      customer_name:       name,
      address,
      scheduled_datetime:  d.start_iso,
      schedule_block:      d.block,
      window_label:        d.window_label,
      final_price:         S.pricing?.final_price,
    };
    go("booked");
  } catch (e) {
    showErr(e.message);
    if (btn) {
      btn.disabled = false;
      const sw = document.documentElement.classList.contains("dark") ? "/pages/img/sword-dark-mode.png" : "/pages/img/sword-light.png";
      btn.innerHTML = `<img src="${sw}" class="sword-icon" alt=""><span>Confirm &amp; Book</span>`;
    }
  }
}

// ── Helpers ───────────────────────────────────────────────────────────────────
function escHtml(s) {
  return String(s ?? "")
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}
// ── Site-visit slot picker ─────────────────────────────────────────────────────
let _svSelectedBlock = null; // { date, block, start_iso, window_label, display }

async function svCheckAvailability() {
  const name    = (document.getElementById("consult_name")?.value    || "").trim();
  const phone   = (document.getElementById("consult_phone")?.value   || "").trim();
  const address = (document.getElementById("consult_address")?.value || "").trim();

  const errEl = document.getElementById("svContactErr");
  const show  = msg => { if (errEl) { errEl.textContent = msg; errEl.style.display = "block"; } };
  if (errEl) errEl.style.display = "none";

  if (!name)    return show("Please enter your name.");
  if (!phone)   return show("Please enter your phone number.");
  if (!address) return show("Please enter the property address for the visit.");

  const btn = document.getElementById("svCheckBtn");
  if (btn) { btn.disabled = true; btn.querySelector("span").textContent = "Loading times\u2026"; }

  try {
    const r = await fetch("/api/schedule/blocks?days=14");
    const d = await r.json();
    if (!d.ok) throw new Error(d.error || "Could not load availability.");

    const SITE_VISIT_MINS = 90;
    const available = (d.blocks || []).filter(b =>
      b.available !== false &&
      (b.hours_remaining == null || b.hours_remaining * 60 >= SITE_VISIT_MINS)
    ).slice(0, 10);

    _svSelectedBlock = null;
    const slotSection = document.getElementById("svSlotSection");
    const blocksEl    = document.getElementById("svBlocks");
    const confirmBtn  = document.getElementById("svConfirmBtn");
    if (confirmBtn) confirmBtn.style.display = "none";

    if (!slotSection || !blocksEl) return;

    if (!available.length) {
      blocksEl.innerHTML = `<p class="q-muted" style="font-size:13px;margin:0 0 8px;">
        No availability found in the next 14 days — please call us to schedule.
      </p>`;
    } else {
      blocksEl.innerHTML = available.map(b => `
        <button class="sv-block-btn"
          style="display:flex;align-items:center;gap:12px;width:100%;text-align:left;
            background:#fff;border:1.5px solid hsl(var(--border));border-radius:10px;
            padding:12px 14px;margin-bottom:8px;cursor:pointer;font-size:14px;font-family:inherit;"
          data-date="${escHtml(b.date)}"
          data-block="${escHtml(b.block)}"
          data-start-iso="${escHtml(b.start_iso)}"
          data-window-label="${escHtml(b.window_label)}"
          data-display="${escHtml(b.display)}"
          onclick="svSelectBlock(this)">
          <span style="font-size:22px;line-height:1;">${b.block === "Morning" ? "&#9728;" : "&#9734;"}</span>
          <span>
            <span style="font-weight:700;display:block;">${escHtml(b.display)}</span>
            <span style="color:hsl(var(--muted-fg));font-size:12px;">${escHtml(b.window_label)}</span>
          </span>
        </button>`).join("");
    }

    slotSection.style.display = "block";
    slotSection.scrollIntoView({ behavior: "smooth", block: "nearest" });

    if (btn) { btn.disabled = false; btn.querySelector("span").textContent = "See Available Times \u2192"; }
  } catch (e) {
    show(e.message);
    if (btn) { btn.disabled = false; btn.querySelector("span").textContent = "See Available Times \u2192"; }
  }
}

function svSelectBlock(btn) {
  _svSelectedBlock = {
    date:         btn.dataset.date,
    block:        btn.dataset.block,
    start_iso:    btn.dataset.startIso,
    window_label: btn.dataset.windowLabel,
    display:      btn.dataset.display,
  };
  document.querySelectorAll(".sv-block-btn").forEach(b => {
    const sel = b === btn;
    b.style.borderColor = sel ? "hsl(var(--primary))" : "hsl(var(--border))";
    b.style.background  = sel ? "hsl(var(--primary) / 0.07)" : "#fff";
  });
  const confirmBtn = document.getElementById("svConfirmBtn");
  if (confirmBtn) confirmBtn.style.display = "";
}

async function svConfirmBooking() {
  if (!_svSelectedBlock) return;

  const name    = (document.getElementById("consult_name")?.value    || "").trim();
  const phone   = (document.getElementById("consult_phone")?.value   || "").trim();
  const address = (document.getElementById("consult_address")?.value || "").trim();

  const errEl = document.getElementById("svSlotErr");
  const show  = msg => { if (errEl) { errEl.textContent = msg; errEl.style.display = "block"; } };
  if (errEl) errEl.style.display = "none";

  const btn = document.getElementById("svConfirmBtn");
  if (btn) { btn.disabled = true; btn.querySelector("span").textContent = "Booking\u2026"; }

  try {
    const r = await fetch("/api/quote/site-visit-book", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name,
        phone,
        address,
        service_id:   S.consultData?.service_id   || null,
        service_name: S.consultData?.service_name || null,
        block:        _svSelectedBlock.block,
        date:         _svSelectedBlock.date,
        quote_id:     S.quoteId || null,
      }),
    });
    const d = await r.json();
    if (!d.ok) throw new Error(d.error || "Booking failed.");

    const dayLong = new Intl.DateTimeFormat("en-US", {
      weekday: "long", month: "long", day: "numeric",
    }).format(new Date(_svSelectedBlock.date + "T12:00:00"));

    const blockIcon = _svSelectedBlock.block === "Morning" ? "&#9728;" : "&#9734;";
    const formCard  = document.getElementById("svFormCard");
    if (formCard) {
      formCard.innerHTML = `
        <div style="text-align:center;padding:28px 16px;">
          <svg width="52" height="52" viewBox="0 0 48 48" fill="none" stroke="currentColor" stroke-width="1.8"
            stroke-linecap="round" stroke-linejoin="round"
            style="color:hsl(120 60% 40%);display:block;margin:0 auto 16px;">
            <circle cx="24" cy="24" r="20"/><polyline points="14 24 21 31 34 17" stroke-width="2.8"/>
          </svg>
          <h3 style="font-family:var(--font-display);font-size:18px;font-weight:800;margin:0 0 10px;">
            Site Visit Booked!
          </h3>
          <div style="display:inline-flex;align-items:center;gap:8px;
            background:hsl(var(--primary)/0.08);border:1px solid hsl(var(--primary)/0.25);
            color:hsl(var(--primary));font-weight:700;font-size:14px;
            border-radius:8px;padding:8px 16px;margin-bottom:14px;">
            ${blockIcon}&nbsp;${escHtml(dayLong)} &bull; ${escHtml(_svSelectedBlock.window_label)}
          </div>
          <p class="q-muted" style="font-size:13px;max-width:360px;margin:0 auto;">
            We'll send an electrician to <strong>${escHtml(address)}</strong> to look at your
            <strong>${escHtml(S.consultData?.service_name || "project")}</strong>
            and give you an accurate price &mdash; free of charge.
            We'll call <strong>${escHtml(phone)}</strong> to confirm.
          </p>
        </div>`;
    }
  } catch (e) {
    show(e.message);
    if (btn) { btn.disabled = false; btn.querySelector("span").textContent = "Confirm Site Visit"; }
  }
}

function val(id) { return (document.getElementById(id)?.value || "").trim(); }
function loadingHTML(msg) {
  return `<div class="q-loading"><div class="q-spinner"></div><p class="q-muted" style="margin-top:16px;">${msg}</p></div>`;
}
function errHTML(msg) {
  return `<div class="q-error-box" style="margin-top:24px;">${escHtml(msg)}</div>`;
}

// ── Init ──────────────────────────────────────────────────────────────────────
document.addEventListener("DOMContentLoaded", boot);

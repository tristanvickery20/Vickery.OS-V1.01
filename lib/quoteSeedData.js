// lib/quoteSeedData.js — V3 Quote Machine seed data (idempotent)

const RATE_H = ["crew_loaded_hourly","overhead_per_hour","target_margin","service_minimum","commute_assumed_minutes","default_disclaimer_fee","pricing_version"];
const RATES  = [125, 25, 0.275, 205, 45, 25, 1];

const SCHED_H = ["timezone","lead_time_hours","buffer_minutes","horizon_days","workday_start","workday_end","saturday_start","saturday_end","sunday_enabled","max_bookings_per_day"];
const SCHED   = ["America/Chicago", 24, 30, 14, "08:00", "17:00", "09:00", "13:00", "FALSE", 3];

const JT_H = ["job_type_id","name_public","base_hours","min_price","default_duration_minutes","requires_photo","instant_book_allowed","material_allowance","active","segment","category"];
const JOB_TYPES = [
  ["REPLACE_DEVICE",    "Replace outlet or switch (1 device)",           0.75, 205, 60,  "FALSE","TRUE",10, "TRUE","Residential","Outlets & Switches"],
  ["ADD_OUTLET",        "Install a new standard outlet",                  1.50, 310, 120, "FALSE","TRUE",25, "TRUE","Residential","Outlets & Switches"],
  ["REPLACE_FIXTURE",   "Replace a light fixture (existing box)",         1.00, 245, 90,  "FALSE","TRUE",15, "TRUE","Residential","Lighting & Fans"],
  ["INSTALL_FAN",       "Install a ceiling fan (existing rated box)",     1.50, 330, 120, "FALSE","TRUE",20, "TRUE","Residential","Lighting & Fans"],
  ["REPLACE_BATH_FAN",  "Replace bathroom exhaust fan (existing location)",2.00, 450, 180, "FALSE","TRUE",25, "TRUE","Residential","Ventilation"],
  ["SURGE_PROTECTOR",   "Install whole-home surge protector",             1.00, 350, 90,  "TRUE", "TRUE",120,"TRUE","Residential","Panel & Protection"],
  ["TROUBLESHOOT",      "Electrical troubleshooting (business hours)",    2.00, 410, 120, "FALSE","TRUE",10, "TRUE","Residential","Diagnostics"],
  ["INSTALL_GFCI_BREAKER","Install GFCI/AFCI breaker (panel access)",    1.00, 275, 90,  "TRUE", "TRUE",0,  "TRUE","Residential","Panel & Protection"],
  ["EV_CHARGER_STD",    "Install EV charger (standard garage)",           3.50, 850, 240, "TRUE", "TRUE",75, "TRUE","Residential","EV Charging"],
  ["PANEL_LABEL",       "Panel labeling + minor cleanup",                 1.50, 325, 120, "TRUE", "TRUE",10, "TRUE","Residential","Panel & Protection"],
];

const SA_H = ["zip","zone","travel_fee"];
const SERVICE_AREAS = [
  // ── Tier 1 CORE — instant quote, no travel fee ────────────────────────────
  ["77630","CORE",0],   // Orange TX
  ["77631","CORE",0],   // Orange TX (PO / alt)
  ["77632","CORE",0],   // Orange TX
  ["77611","CORE",0],   // Bridge City TX (~14 min)
  ["77662","CORE",0],   // Vidor TX (~23 min)
  // ── Tier 2 EXT — instant quote + $25 travel fee ───────────────────────────
  ["77708","EXT",25],   // Beaumont TX (~25 min)
  ["77713","EXT",25],   // Beaumont TX (~25 min)
  ["77701","EXT",25],   // Beaumont TX (~27 min)
  ["77702","EXT",25],   // Beaumont TX (~27 min)
  ["77703","EXT",25],   // Beaumont TX (~27 min)
  ["77704","EXT",25],   // Beaumont TX (~27 min)
  ["77705","EXT",25],   // Beaumont TX (~29 min)
  ["77706","EXT",25],   // Beaumont TX (~29 min)
  ["77707","EXT",25],   // Beaumont TX (~29 min)
  ["77619","EXT",25],   // Groves TX (~22 min)
  ["77640","EXT",25],   // Port Arthur TX (~29 min)
  ["77641","EXT",25],   // Port Arthur TX (~29 min)
  ["77642","EXT",25],   // Port Arthur TX (~31 min)
  ["77643","EXT",25],   // Port Arthur TX (~31 min)
  ["77627","EXT",25],   // Nederland TX (~33 min)
  // ── Tier 3 OUTER — custom quote only, $50 travel fee, $1,000 min ─────────
  ["77657","OUTER",50], // Lumberton TX (~42 min)
  ["77656","OUTER",50], // Silsbee TX (~45 min)
];

const Q_H = ["question_id","job_type_id","prompt","input_type","required","sort_order"];
const QUESTIONS = [
  ["ADDOUTLET_DIST",   "ADD_OUTLET",          "About how far is the new outlet from your electrical panel?", "select","TRUE",1],
  ["ADDOUTLET_ACCESS", "ADD_OUTLET",          "Is there attic or crawlspace access near the outlet location?","select","TRUE",2],
  ["ADDOUTLET_LOC",    "ADD_OUTLET",          "Is this outlet indoors or outdoors?",                         "select","TRUE",3],
  ["ADDOUTLET_DRYWALL","ADD_OUTLET",          "Are you okay with small drywall openings if needed?",         "select","TRUE",4],
  ["FIXTURE_HEIGHT",   "REPLACE_FIXTURE",     "Is the fixture at a standard height or a high ceiling?",      "select","TRUE",1],
  ["FIXTURE_LOC",      "REPLACE_FIXTURE",     "Is this fixture indoors or outdoors?",                        "select","TRUE",2],
  ["FAN_HEIGHT",       "INSTALL_FAN",         "Is the fan location a standard height or high ceiling?",      "select","TRUE",1],
  ["FAN_BOX",          "INSTALL_FAN",         "Is there already a fan-rated ceiling box installed?",         "select","TRUE",2],
  ["BATH_ACCESS",      "REPLACE_BATH_FAN",    "Is there attic access above the bathroom?",                   "select","TRUE",1],
  ["BATH_SAMESIZE",    "REPLACE_BATH_FAN",    "Is this a same-size replacement (no ceiling cutting)?",       "select","TRUE",2],
  ["TS_HAZARD",        "TROUBLESHOOT",        "Is there any smoke/burning smell/sparking right now?",        "select","TRUE",1],
  ["TS_SCOPE",         "TROUBLESHOOT",        "What's the main issue?",                                      "select","TRUE",2],
  ["EV_DIST",          "EV_CHARGER_STD",      "How far is the charger location from your electrical panel?", "select","TRUE",1],
  ["EV_TRENCH",        "EV_CHARGER_STD",      "Will this require trenching or running underground?",         "select","TRUE",2],
  ["EV_SPACES",        "EV_CHARGER_STD",      "Do you have at least two open breaker spaces in your panel?", "select","TRUE",3],
  ["LABEL_COUNT",      "PANEL_LABEL",         "About how many circuits are in your panel?",                  "select","TRUE",1],
];

const AO_H = ["option_id","question_id","label","effect_type","effect_value"];
const ANSWER_OPTIONS = [
  ["DIST_SAME","ADDOUTLET_DIST","Same room","ADD_HOURS",0],
  ["DIST_ADJ", "ADDOUTLET_DIST","Adjacent room","ADD_HOURS",0.5],
  ["DIST_2ROOM","ADDOUTLET_DIST","2–3 rooms away","ADD_HOURS",1],
  ["DIST_FAR", "ADDOUTLET_DIST","Other side of house","ADD_HOURS",1.5],
  ["ACC_YES",  "ADDOUTLET_ACCESS","Yes","ADD_HOURS",0],
  ["ACC_NS",   "ADDOUTLET_ACCESS","Not sure","ADD_HOURS",0.5],
  ["ACC_NO",   "ADDOUTLET_ACCESS","No","ADD_HOURS",1],
  ["LOC_IN",   "ADDOUTLET_LOC","Indoors","ADD_HOURS",0],
  ["LOC_OUT",  "ADDOUTLET_LOC","Outdoors","ADD_HOURS",0.5],
  ["DW_OK",    "ADDOUTLET_DRYWALL","Yes","ADD_HOURS",0],
  ["DW_MIN",   "ADDOUTLET_DRYWALL","Prefer minimal cutting","ADD_HOURS",0.5],
  ["DW_NS",    "ADDOUTLET_DRYWALL","Not sure","ADD_HOURS",0.5],
  ["H_STD",    "FIXTURE_HEIGHT","Standard height","ADD_HOURS",0],
  ["H_HIGH",   "FIXTURE_HEIGHT","High ceiling","ADD_HOURS",0.5],
  ["H_VHIGH",  "FIXTURE_HEIGHT","Very high ceiling","ADD_HOURS",1],
  ["F_IN",     "FIXTURE_LOC","Indoors","ADD_HOURS",0],
  ["F_OUT",    "FIXTURE_LOC","Outdoors","ADD_HOURS",0.5],
  ["FH_STD",   "FAN_HEIGHT","Standard height","ADD_HOURS",0],
  ["FH_HIGH",  "FAN_HEIGHT","High ceiling","ADD_HOURS",0.5],
  ["FH_VHIGH", "FAN_HEIGHT","Very high ceiling","ADD_HOURS",1],
  ["FB_YES",   "FAN_BOX","Yes","ADD_HOURS",0],
  ["FB_NS",    "FAN_BOX","Not sure","REQUIRE_PHOTO",1],
  ["FB_NS_H",  "FAN_BOX","Not sure (add time)","ADD_HOURS",0.5],
  ["FB_NO",    "FAN_BOX","No","REQUIRE_PHOTO",1],
  ["FB_NO_H",  "FAN_BOX","No (add time)","ADD_HOURS",1],
  ["BA_YES",   "BATH_ACCESS","Yes","ADD_HOURS",0],
  ["BA_NS",    "BATH_ACCESS","Not sure","ADD_HOURS",0.5],
  ["BA_NO",    "BATH_ACCESS","No","ADD_HOURS",1],
  ["BS_YES",   "BATH_SAMESIZE","Yes","ADD_HOURS",0],
  ["BS_NS",    "BATH_SAMESIZE","Not sure","ADD_HOURS",0.5],
  ["BS_NO",    "BATH_SAMESIZE","No","ADD_HOURS",1],
  ["HZ_NO",    "TS_HAZARD","No","ADD_HOURS",0],
  ["HZ_YES",   "TS_HAZARD","Yes","FLAG_EVALUATION",1],
  ["TS_NOPWR", "TS_SCOPE","No power to an area","ADD_HOURS",0],
  ["TS_TRIP",  "TS_SCOPE","Breaker keeps tripping","ADD_HOURS",0],
  ["TS_FLICK", "TS_SCOPE","Flickering lights","ADD_HOURS",0],
  ["TS_OTHER", "TS_SCOPE","Other / not sure","ADD_HOURS",0.5],
  ["EVD_NEAR", "EV_DIST","Same garage wall / very close","ADD_HOURS",0],
  ["EVD_GAR",  "EV_DIST","Across the garage","ADD_HOURS",0.5],
  ["EVD_ATTIC","EV_DIST","Needs attic run","ADD_HOURS",1],
  ["EVD_FAR",  "EV_DIST","Far / through house","ADD_HOURS",2],
  ["EVT_NO",   "EV_TRENCH","No","ADD_HOURS",0],
  ["EVT_YES",  "EV_TRENCH","Yes","FLAG_EVALUATION",1],
  ["EVS_YES",  "EV_SPACES","Yes","ADD_HOURS",0],
  ["EVS_NS",   "EV_SPACES","Not sure","ADD_HOURS",0.5],
  ["EVS_NS_P", "EV_SPACES","Not sure (photo needed)","REQUIRE_PHOTO",1],
  ["EVS_NO",   "EV_SPACES","No","FLAG_EVALUATION",1],
  ["LC_12",    "LABEL_COUNT","12 or fewer circuits","ADD_HOURS",0],
  ["LC_24",    "LABEL_COUNT","13–24 circuits","ADD_HOURS",0.5],
  ["LC_40",    "LABEL_COUNT","25–40 circuits","ADD_HOURS",1],
  ["LC_40P",   "LABEL_COUNT","More than 40 circuits","ADD_HOURS",1.5],
];

const ADDON_H = ["addon_id","job_type_id","name_public","add_hours","add_fee","material_allowance","active"];
const ADD_ONS = [
  ["ADDON_USB",     "REPLACE_DEVICE",  "Upgrade to USB outlet",                      0.25,0,15, "TRUE"],
  ["ADDON_TR",      "REPLACE_DEVICE",  "Upgrade to tamper-resistant device",          0.25,0,5,  "TRUE"],
  ["ADDON_WEATHER", "REPLACE_DEVICE",  "Add weatherproof in-use cover (if outdoors)", 0.25,0,20, "TRUE"],
  ["ADDON_SURGE_RD","REPLACE_DEVICE",  "Add whole-home surge protector",              1,   0,120,"TRUE"],
  ["ADDON_SURGE_AO","ADD_OUTLET",      "Add whole-home surge protector",              1,   0,120,"TRUE"],
  ["ADDON_LABEL_AO","ADD_OUTLET",      "Add panel labeling + cleanup",                1,   0,10, "TRUE"],
  ["ADDON_SURGE_RF","REPLACE_FIXTURE", "Add whole-home surge protector",              1,   0,120,"TRUE"],
  ["ADDON_SURGE_FAN","INSTALL_FAN",    "Add whole-home surge protector",              1,   0,120,"TRUE"],
  ["ADDON_SURGE_BF","REPLACE_BATH_FAN","Add whole-home surge protector",              1,   0,120,"TRUE"],
  ["ADDON_SURGE_TS","TROUBLESHOOT",    "Add whole-home surge protector",              1,   0,120,"TRUE"],
  ["ADDON_LABEL_TS","TROUBLESHOOT",    "Add panel labeling + cleanup",                1,   0,10, "TRUE"],
  ["ADDON_SURGE_EV","EV_CHARGER_STD",  "Add whole-home surge protector",              1,   0,120,"TRUE"],
  ["ADDON_SURGE_PL","PANEL_LABEL",     "Add whole-home surge protector",              1,   0,120,"TRUE"],
];

module.exports = {
  RATE_H, RATES,
  SCHED_H, SCHED,
  JT_H, JOB_TYPES,
  SA_H, SERVICE_AREAS,
  Q_H, QUESTIONS,
  AO_H, ANSWER_OPTIONS,
  ADDON_H, ADD_ONS,
};

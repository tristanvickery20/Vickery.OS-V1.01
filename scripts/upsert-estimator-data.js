// scripts/upsert-estimator-data.js
// Upserts 51 modules into Estimator_Modules and updates modules_csv on all
// services in Estimator_ServiceMatrix using keyword-based assignment rules.
// Run: node scripts/upsert-estimator-data.js
"use strict";

const { getSheetsClient } = require("../lib/sheets");

const SHEET_ID = process.env.ESTIMATOR_V2_SHEET_ID;
if (!SHEET_ID) { console.error("ESTIMATOR_V2_SHEET_ID not set"); process.exit(1); }

// ─── Module Library (51 modules) ─────────────────────────────────────────────
const MODULES_LIBRARY = [
  // ── Universal ──────────────────────────────────────────────────────────────
  { module_id:"PROPERTY_TYPE", question:"What type of property is this?", input_type:"single_select",
    options:[{value:"single_family",label:"Single-family home"},{value:"townhome_duplex",label:"Townhome / Duplex"},{value:"apartment_condo",label:"Apartment / Condo"},{value:"detached_building",label:"Detached garage / workshop"},{value:"commercial",label:"Commercial building",disqualify:true}] },
  { module_id:"HOME_AGE", question:"How old is the home or building?", input_type:"single_select",
    options:[{value:"2000_plus",label:"2000 or newer",multiplier:1.0},{value:"1980_1999",label:"1980–1999",multiplier:1.05},{value:"1950_1979",label:"1950–1979",multiplier:1.15},{value:"pre_1950",label:"Before 1950",multiplier:1.25,uncertain:true},{value:"not_sure",label:"Not sure",multiplier:1.10,uncertain:true}] },
  { module_id:"OCCUPIED", question:"Will the home be occupied during the work?", input_type:"single_select",
    options:[{value:"yes",label:"Yes"},{value:"no",label:"No"}] },
  { module_id:"ACCESS_DIFFICULTY", question:"How easy is access to the work area?", input_type:"single_select",
    options:[{value:"easy",label:"Easy access",multiplier:1.0},{value:"some_obstacles",label:"Some obstacles",multiplier:1.1},{value:"tight_hard",label:"Tight / hard access",multiplier:1.25},{value:"not_sure",label:"Not sure",multiplier:1.1,uncertain:true}] },
  { module_id:"CEILING_HEIGHT", question:"What is the ceiling height in the work area?", input_type:"single_select",
    options:[{value:"lt9",label:"Under 9 ft",multiplier:1.0},{value:"9_12",label:"9–12 ft",multiplier:1.1},{value:"12_18",label:"12–18 ft",multiplier:1.4},{value:"gt18",label:"Over 18 ft",disqualify:true},{value:"not_sure",label:"Not sure",multiplier:1.15,uncertain:true}] },
  { module_id:"ATTIC_ACCESS", question:"Is there accessible attic space above the work area?", input_type:"single_select",
    options:[{value:"full",label:"Yes — full attic access",multiplier:1.0},{value:"limited",label:"Yes — limited access",multiplier:1.25},{value:"none",label:"No attic access",multiplier:1.5},{value:"not_sure",label:"Not sure",multiplier:1.2,uncertain:true}] },
  { module_id:"CRAWLSPACE_ACCESS", question:"Is there crawlspace access below the work area?", input_type:"single_select",
    options:[{value:"yes",label:"Yes"},{value:"no",label:"No"},{value:"not_sure",label:"Not sure",uncertain:true}] },
  { module_id:"WALL_TYPE", question:"What is the wall construction type?", input_type:"single_select",
    options:[{value:"drywall",label:"Drywall",multiplier:1.0},{value:"plaster",label:"Plaster",multiplier:1.3},{value:"brick",label:"Brick / masonry",disqualify:true},{value:"tile",label:"Tile",multiplier:1.5},{value:"wood",label:"Wood / paneling",multiplier:1.15},{value:"not_sure",label:"Not sure",multiplier:1.15,uncertain:true}] },
  { module_id:"PANEL_LOCATION", question:"Where is the electrical panel relative to the work area?", input_type:"single_select",
    options:[{value:"same_room",label:"Same room",multiplier:1.0},{value:"nearby",label:"Nearby",multiplier:1.1},{value:"far",label:"Far / across the house",multiplier:1.25},{value:"detached",label:"Detached building",disqualify:true},{value:"not_sure",label:"Not sure",multiplier:1.15,uncertain:true}] },
  { module_id:"PANEL_PHOTO", question:"Please upload a photo of your electrical panel (open the inner door).", input_type:"photo", options:[] },
  { module_id:"WORK_AREA_PHOTOS", question:"Upload 1–3 photos of the work area (helps us confirm the estimate).", input_type:"photo", options:[] },
  { module_id:"EXISTING_POWER_PRESENT", question:"Is there existing power or wiring at the work location?", input_type:"single_select",
    options:[{value:"yes",label:"Yes"},{value:"no",label:"No",multiplier:1.25},{value:"not_sure",label:"Not sure",multiplier:1.15,uncertain:true}] },
  { module_id:"DRYWALL_REPAIR_NEEDED", question:"Are small drywall cuts and patching acceptable?", input_type:"single_select",
    options:[{value:"ok",label:"Yes, small drywall cuts/patching is okay"},{value:"no",label:"No",disqualify:true},{value:"not_sure",label:"Not sure",uncertain:true}] },
  { module_id:"PERMIT_ALLOWED", question:"Is pulling a permit acceptable for this job?", input_type:"single_select",
    options:[{value:"yes",label:"Yes"},{value:"no",label:"No",disqualify:true},{value:"not_sure",label:"Not sure",uncertain:true}] },
  { module_id:"UNCERTAINTY_BUFFER", question:"If anything is unknown, we include a contingency to protect accuracy.", input_type:"single_select",
    options:[{value:"auto",label:"Auto",multiplier:1.0}] },

  // ── Tailored — Lighting ────────────────────────────────────────────────────
  { module_id:"LIGHTING_EXISTING_LOCATION", question:"Is this replacing an existing light or a brand-new location?", input_type:"single_select",
    options:[{value:"replace",label:"Replace existing light",multiplier:1.0},{value:"new",label:"New location",multiplier:1.25},{value:"not_sure",label:"Not sure",multiplier:1.1,uncertain:true}] },
  { module_id:"RECESSED_LIGHT_CEILING_TYPE", question:"What is the ceiling material?", input_type:"single_select",
    options:[{value:"drywall",label:"Drywall",multiplier:1.0},{value:"plaster",label:"Plaster",multiplier:1.3},{value:"drop",label:"Drop ceiling",multiplier:1.15},{value:"wood",label:"Wood",multiplier:1.15},{value:"not_sure",label:"Not sure",multiplier:1.1,uncertain:true}] },
  { module_id:"RECESSED_LIGHT_INSULATION", question:"Is there insulation above the ceiling?", input_type:"single_select",
    options:[{value:"yes",label:"Yes",multiplier:1.1},{value:"no",label:"No",multiplier:1.0},{value:"not_sure",label:"Not sure",multiplier:1.1,uncertain:true}] },
  { module_id:"RECESSED_LIGHT_COUNT", question:"How many recessed lights do you need?", input_type:"number", options:[] },
  { module_id:"UNDERCABINET_POWER", question:"Is power already available under the cabinet?", input_type:"single_select",
    options:[{value:"yes",label:"Yes, power is available",multiplier:1.0},{value:"no",label:"No, power is not available",multiplier:1.25},{value:"not_sure",label:"Not sure",multiplier:1.1,uncertain:true}] },
  { module_id:"UNDERCABINET_TYPE", question:"Do you want plug-in or hardwired under-cabinet lighting?", input_type:"single_select",
    options:[{value:"plugin",label:"Plug-in",multiplier:1.0},{value:"hardwired",label:"Hardwired",multiplier:1.15},{value:"not_sure",label:"Not sure",multiplier:1.05,uncertain:true}] },
  { module_id:"FIXTURE_SUPPLIED_BY", question:"Will you supply the fixture, or should we?", input_type:"single_select",
    options:[{value:"customer",label:"Customer provides",multiplier:1.0},{value:"electrician",label:"Electrician supplies",multiplier:1.0},{value:"not_sure",label:"Not sure",uncertain:true}] },
  { module_id:"FIXTURE_WEIGHT", question:"How heavy is the fixture?", input_type:"single_select",
    options:[{value:"standard",label:"Standard",multiplier:1.0},{value:"heavy",label:"Heavy / oversized (needs extra support)",multiplier:1.35},{value:"not_sure",label:"Not sure",multiplier:1.15,uncertain:true}] },

  // ── Tailored — Fans ───────────────────────────────────────────────────────
  { module_id:"FAN_EXISTING_BOX", question:"Is there an existing rated electrical box at the fan location?", input_type:"single_select",
    options:[{value:"yes",label:"Yes",multiplier:1.0},{value:"no",label:"No",multiplier:1.25},{value:"not_sure",label:"Not sure",multiplier:1.15,uncertain:true}] },
  { module_id:"FAN_CONTROL_TYPE", question:"How will the fan be controlled?", input_type:"single_select",
    options:[{value:"pull",label:"Pull chain",multiplier:1.0},{value:"wall",label:"Wall switch",multiplier:1.05},{value:"remote",label:"Remote / receiver kit",multiplier:1.1},{value:"not_sure",label:"Not sure",multiplier:1.05,uncertain:true}] },

  // ── Tailored — Outdoor / Motion ───────────────────────────────────────────
  { module_id:"OUTDOOR_EXPOSURE", question:"Is this an outdoor or weather-exposed installation?", input_type:"single_select",
    options:[{value:"yes",label:"Yes, exposed to rain/weather",multiplier:1.2},{value:"some",label:"Some exposure",multiplier:1.1},{value:"no",label:"No",multiplier:1.0},{value:"not_sure",label:"Not sure",multiplier:1.1,uncertain:true}] },
  { module_id:"MOTION_SENSOR_LOCATION_HEIGHT", question:"How high up will the sensor be mounted?", input_type:"single_select",
    options:[{value:"lt10",label:"Under 10 ft",multiplier:1.0},{value:"10_18",label:"10–18 ft",multiplier:1.2},{value:"gt18",label:"Over 18 ft",disqualify:true},{value:"not_sure",label:"Not sure",multiplier:1.15,uncertain:true}] },

  // ── Tailored — Dimmers & Devices ─────────────────────────────────────────
  { module_id:"DIMMER_LOAD_TYPE", question:"What type of load will the dimmer control?", input_type:"single_select",
    options:[{value:"led",label:"LED lights",multiplier:1.0},{value:"incandescent",label:"Incandescent / halogen",multiplier:1.0},{value:"fan_motor",label:"Fan motor",multiplier:1.15},{value:"not_sure",label:"Not sure",multiplier:1.1,uncertain:true}] },
  { module_id:"DIMMER_LED_COMPAT", question:"Are your light fixtures using dimmable LEDs?", input_type:"single_select",
    options:[{value:"yes",label:"Yes, dimmable LEDs",multiplier:1.0},{value:"no",label:"No / not sure if dimmable",multiplier:1.1,uncertain:true},{value:"not_sure",label:"Not sure",multiplier:1.1,uncertain:true}] },
  { module_id:"DIMMER_STYLE", question:"What style dimmer switch do you prefer?", input_type:"single_select",
    options:[{value:"toggle_slider",label:"Toggle + slider",multiplier:1.0},{value:"paddle",label:"Paddle",multiplier:1.0},{value:"smart_dimmer",label:"Smart dimmer",multiplier:1.1},{value:"not_sure",label:"Not sure",uncertain:true}] },
  { module_id:"DEVICE_BRAND", question:"Do you have a preferred device brand?", input_type:"single_select",
    options:[{value:"lutron",label:"Lutron",multiplier:1.0},{value:"leviton",label:"Leviton",multiplier:1.0},{value:"eaton",label:"Eaton",multiplier:1.0},{value:"any",label:"Any / no preference",multiplier:1.0},{value:"not_sure",label:"Not sure",uncertain:true}] },

  // ── Tailored — Smart Home ─────────────────────────────────────────────────
  { module_id:"SMART_PLATFORM", question:"Which smart home platform do you use?", input_type:"single_select",
    options:[{value:"none",label:"None"},{value:"alexa",label:"Alexa"},{value:"google",label:"Google Home"},{value:"homekit",label:"Apple HomeKit"},{value:"not_sure",label:"Not sure",uncertain:true}] },
  { module_id:"SMART_NEUTRAL_WIRE", question:"Is there a neutral wire in the switch box?", input_type:"single_select",
    options:[{value:"yes",label:"Yes",multiplier:1.0},{value:"no",label:"No",multiplier:1.2},{value:"not_sure",label:"Not sure",multiplier:1.15,uncertain:true}] },

  // ── Tailored — Outlets & GFCI ────────────────────────────────────────────
  { module_id:"OUTLET_LOCATION_TYPE", question:"Where will the outlet be installed?", input_type:"single_select",
    options:[{value:"general",label:"General room",multiplier:1.0},{value:"kitchen",label:"Kitchen / countertop",multiplier:1.1},{value:"bath",label:"Bathroom",multiplier:1.1},{value:"garage",label:"Garage",multiplier:1.1},{value:"outdoor",label:"Outdoor",multiplier:1.2},{value:"not_sure",label:"Not sure",multiplier:1.1,uncertain:true}] },
  { module_id:"GFCI_EXISTING", question:"Is this replacing an existing GFCI or adding a new one?", input_type:"single_select",
    options:[{value:"replace",label:"Replacing existing GFCI",multiplier:1.0},{value:"add_new",label:"Adding new GFCI",multiplier:1.15},{value:"not_sure",label:"Not sure",multiplier:1.1,uncertain:true}] },

  // ── Tailored — Dedicated Circuits ────────────────────────────────────────
  { module_id:"DEDICATED_CIRCUIT_APPLIANCE", question:"What appliance or equipment needs the dedicated circuit?", input_type:"single_select",
    options:[{value:"microwave",label:"Microwave"},{value:"dishwasher",label:"Dishwasher"},{value:"disposal",label:"Garbage disposal"},{value:"refrigerator",label:"Refrigerator"},{value:"dryer",label:"Dryer"},{value:"range",label:"Range / oven"},{value:"water_heater",label:"Water heater"},{value:"hvac",label:"HVAC"},{value:"other",label:"Other / not sure",uncertain:true}] },
  { module_id:"DEDICATED_CIRCUIT_VOLTAGE", question:"What voltage does the appliance require?", input_type:"single_select",
    options:[{value:"120",label:"120V",multiplier:1.0},{value:"240",label:"240V",multiplier:1.15},{value:"not_sure",label:"Not sure",multiplier:1.1,uncertain:true}] },
  { module_id:"DEDICATED_CIRCUIT_DISTANCE", question:"How far is the appliance from the electrical panel?", input_type:"single_select",
    options:[{value:"lt25",label:"Under 25 ft",multiplier:1.0},{value:"25_50",label:"25–50 ft",multiplier:1.1},{value:"50_100",label:"50–100 ft",multiplier:1.25},{value:"gt100",label:"Over 100 ft",multiplier:1.5},{value:"not_sure",label:"Not sure",multiplier:1.15,uncertain:true}] },

  // ── Tailored — EV Chargers ───────────────────────────────────────────────
  { module_id:"EV_CHARGER_TYPE", question:"What level of EV charger do you need?", input_type:"single_select",
    options:[{value:"lvl1",label:"Level 1 (120V — standard outlet)",multiplier:1.0},{value:"lvl2",label:"Level 2 (240V — faster charging)",multiplier:1.2},{value:"not_sure",label:"Not sure",multiplier:1.1,uncertain:true}] },
  { module_id:"EV_HARDWIRE_OR_PLUG", question:"Should the charger be hardwired or use a plug-in outlet?", input_type:"single_select",
    options:[{value:"hardwired",label:"Hardwired",multiplier:1.0},{value:"plug_in",label:"Plug-in (NEMA outlet)",multiplier:1.1},{value:"not_sure",label:"Not sure",multiplier:1.05,uncertain:true}] },
  { module_id:"EV_PANEL_CAPACITY", question:"Does your panel have available capacity for an EV charger?", input_type:"single_select",
    options:[{value:"yes",label:"Yes",multiplier:1.0},{value:"no",label:"No — panel is full",disqualify:true},{value:"not_sure",label:"Not sure",multiplier:1.1,uncertain:true}] },

  // ── Tailored — Hot Tub / Pool ────────────────────────────────────────────
  { module_id:"HOT_TUB_POOL_EQUIPMENT", question:"What equipment needs electrical service?", input_type:"single_select",
    options:[{value:"hot_tub",label:"Hot tub"},{value:"pool_pump",label:"Pool pump"},{value:"heater",label:"Pool/spa heater"},{value:"combo",label:"More than one",multiplier:1.25},{value:"not_sure",label:"Not sure",uncertain:true}] },

  // ── Tailored — Generators ────────────────────────────────────────────────
  { module_id:"GENERATOR_TYPE", question:"What type of generator do you have or need?", input_type:"single_select",
    options:[{value:"portable",label:"Portable w/ transfer switch",multiplier:1.0},{value:"standby",label:"Standby whole-home",disqualify:true},{value:"not_sure",label:"Not sure",uncertain:true}] },
  { module_id:"TRANSFER_SWITCH_LOCATION", question:"Where will the transfer switch be installed?", input_type:"single_select",
    options:[{value:"near_panel",label:"Near the panel",multiplier:1.0},{value:"garage",label:"Garage",multiplier:1.1},{value:"exterior",label:"Exterior wall",multiplier:1.15},{value:"not_sure",label:"Not sure",multiplier:1.1,uncertain:true}] },

  // ── Tailored — Surge / Panel ─────────────────────────────────────────────
  { module_id:"SURGE_TYPE", question:"What type of surge protection are you looking for?", input_type:"single_select",
    options:[{value:"whole_home",label:"Whole-home (at panel)",multiplier:1.0},{value:"point_of_use",label:"Point-of-use",multiplier:1.0},{value:"not_sure",label:"Not sure",uncertain:true}] },
  { module_id:"PANEL_WORK_TYPE", question:"What type of panel work is needed?", input_type:"single_select",
    options:[{value:"add_breaker",label:"Add a breaker",multiplier:1.0},{value:"replace_breaker",label:"Replace a breaker",multiplier:1.0},{value:"subpanel",label:"Install a subpanel",multiplier:1.25},{value:"upgrade",label:"Upgrade main panel / service entrance",disqualify:true},{value:"not_sure",label:"Not sure",uncertain:true}] },
  { module_id:"PANEL_BRAND", question:"What brand is your electrical panel?", input_type:"single_select",
    options:[{value:"square_d",label:"Square D"},{value:"siemens",label:"Siemens"},{value:"eaton",label:"Eaton"},{value:"ge",label:"GE"},{value:"fpe",label:"Federal Pacific (FPE)",disqualify:true},{value:"zinsco",label:"Zinsco",disqualify:true},{value:"not_sure",label:"Not sure",uncertain:true}] },

  // ── Tailored — Troubleshooting ───────────────────────────────────────────
  { module_id:"TROUBLESHOOTING_SYMPTOM", question:"What electrical issue are you experiencing?", input_type:"single_select",
    options:[{value:"flicker",label:"Flickering lights"},{value:"dead",label:"Dead outlet / circuit"},{value:"trips",label:"Breaker trips frequently"},{value:"burning",label:"Burning smell / hot devices",disqualify:true},{value:"partial",label:"Partial power in house"},{value:"other",label:"Other / not sure",uncertain:true}] },

  // ── Tailored — Commercial ─────────────────────────────────────────────────
  { module_id:"COMMERCIAL_CEILING_TYPE", question:"What type of ceiling does the space have?", input_type:"single_select",
    options:[{value:"open",label:"Open ceiling"},{value:"drop",label:"Drop ceiling"},{value:"hard_lid",label:"Hard lid"},{value:"not_sure",label:"Not sure",uncertain:true}] },
  { module_id:"COMMERCIAL_WORKING_HOURS", question:"When is work available to be performed?", input_type:"single_select",
    options:[{value:"business",label:"Business hours"},{value:"after_hours",label:"After-hours",multiplier:1.25},{value:"weekend",label:"Weekend",multiplier:1.25},{value:"not_sure",label:"Not sure",uncertain:true}] },
  { module_id:"FIRE_ALARM_SCOPE", question:"What fire alarm work is needed?", input_type:"single_select",
    options:[{value:"new",label:"New install",disqualify:true},{value:"repair",label:"Repair / service",disqualify:true},{value:"inspect",label:"Inspection / testing",disqualify:true},{value:"not_sure",label:"Not sure",disqualify:true}] },
];

// ─── Service assignment rules ─────────────────────────────────────────────────
function assignModules(service_name, current_tier, segment) {
  const n = service_name.toLowerCase();
  const isCommercial = segment === "commercial";

  // 1. Troubleshooting / diagnostic
  if (/troubleshoot|flickering|breaker trip|issues/.test(n)) {
    return { tier:"site_visit_required",
      modules_csv:"PROPERTY_TYPE,HOME_AGE,PANEL_PHOTO,TROUBLESHOOTING_SYMPTOM,WORK_AREA_PHOTOS,UNCERTAINTY_BUFFER" };
  }

  // 2. Rewiring / heavy commercial
  if (/rewir|transformer|bus duct|heavy machine|fire alarm|\bups\b/.test(n)) {
    const m = isCommercial
      ? "PROPERTY_TYPE,HOME_AGE,PANEL_PHOTO,WORK_AREA_PHOTOS,COMMERCIAL_WORKING_HOURS,COMMERCIAL_CEILING_TYPE,UNCERTAINTY_BUFFER"
      : "PROPERTY_TYPE,HOME_AGE,PANEL_PHOTO,WORK_AREA_PHOTOS,UNCERTAINTY_BUFFER";
    return { tier:"site_visit_required", modules_csv:m };
  }

  // 4. Ceiling fans (before lighting to avoid "fixture" conflict)
  if (/ceiling fan/.test(n)) {
    return { tier:null,
      modules_csv:"PROPERTY_TYPE,HOME_AGE,CEILING_HEIGHT,ATTIC_ACCESS,FAN_EXISTING_BOX,FAN_CONTROL_TYPE,FIXTURE_SUPPLIED_BY,WORK_AREA_PHOTOS,UNCERTAINTY_BUFFER" };
  }

  // 5. Dimmers (before smart — "Dimmer / Smart Switch" → dimmer rule wins)
  if (/dimmer/.test(n)) {
    return { tier:null,
      modules_csv:"PROPERTY_TYPE,HOME_AGE,WALL_TYPE,DIMMER_LOAD_TYPE,DIMMER_LED_COMPAT,DIMMER_STYLE,DEVICE_BRAND,FIXTURE_SUPPLIED_BY,WORK_AREA_PHOTOS,UNCERTAINTY_BUFFER" };
  }

  // 6. Smart switches / home automation
  if (/\bsmart\b|home automation/.test(n)) {
    return { tier:null,
      modules_csv:"PROPERTY_TYPE,HOME_AGE,WALL_TYPE,SMART_PLATFORM,SMART_NEUTRAL_WIRE,DEVICE_BRAND,FIXTURE_SUPPLIED_BY,WORK_AREA_PHOTOS,UNCERTAINTY_BUFFER" };
  }

  // 3. Lighting installs (after fans/dimmers)
  if (/lighting|chandelier|fixture|recessed|can light|under.?cabinet|ballast|bulb|retrofit|timer|light install/.test(n)) {
    const mods = ["PROPERTY_TYPE","HOME_AGE","CEILING_HEIGHT","WALL_TYPE","ATTIC_ACCESS",
      "LIGHTING_EXISTING_LOCATION","FIXTURE_SUPPLIED_BY"];
    if (/recessed|can light/.test(n))
      mods.push("RECESSED_LIGHT_CEILING_TYPE","RECESSED_LIGHT_INSULATION","RECESSED_LIGHT_COUNT");
    if (/under.?cabinet/.test(n))
      mods.push("UNDERCABINET_POWER","UNDERCABINET_TYPE");
    if (/chandelier|fixture install/.test(n))
      mods.push("FIXTURE_WEIGHT");
    if (/motion|security|outdoor|landscape/.test(n))
      mods.push("OUTDOOR_EXPOSURE");
    if (/motion|security/.test(n))
      mods.push("MOTION_SENSOR_LOCATION_HEIGHT");
    if (isCommercial)
      mods.push("COMMERCIAL_WORKING_HOURS","COMMERCIAL_CEILING_TYPE");
    mods.push("WORK_AREA_PHOTOS","UNCERTAINTY_BUFFER");
    return { tier:null, modules_csv:mods.join(",") };
  }

  // Motion / security lights (if not caught by lighting rule above)
  if (/motion|security light/.test(n)) {
    return { tier:null,
      modules_csv:"PROPERTY_TYPE,HOME_AGE,CEILING_HEIGHT,LIGHTING_EXISTING_LOCATION,FIXTURE_SUPPLIED_BY,OUTDOOR_EXPOSURE,MOTION_SENSOR_LOCATION_HEIGHT,WORK_AREA_PHOTOS,UNCERTAINTY_BUFFER" };
  }

  // 9. EV chargers (before dedicated circuits)
  if (/\bev\b|electric vehicle/.test(n)) {
    return { tier:null,
      modules_csv:"PROPERTY_TYPE,HOME_AGE,PANEL_PHOTO,EV_CHARGER_TYPE,EV_HARDWIRE_OR_PLUG,EV_PANEL_CAPACITY,DEDICATED_CIRCUIT_DISTANCE,WORK_AREA_PHOTOS,UNCERTAINTY_BUFFER" };
  }

  // 10. Hot tub / pool / spa
  if (/hot tub|pool|spa circuit/.test(n)) {
    return { tier:null,
      modules_csv:"PROPERTY_TYPE,HOME_AGE,PANEL_PHOTO,HOT_TUB_POOL_EQUIPMENT,DEDICATED_CIRCUIT_DISTANCE,WORK_AREA_PHOTOS,UNCERTAINTY_BUFFER" };
  }

  // 7. Outlets / GFCI / switch (not transfer switch)
  if (/(outlet|gfci|receptacle|switch)/.test(n) && !/transfer switch/.test(n)) {
    const mods = ["PROPERTY_TYPE","HOME_AGE","WALL_TYPE","OUTLET_LOCATION_TYPE",
      "EXISTING_POWER_PRESENT","FIXTURE_SUPPLIED_BY"];
    if (/gfci/.test(n)) mods.push("GFCI_EXISTING");
    mods.push("WORK_AREA_PHOTOS","UNCERTAINTY_BUFFER");
    return { tier:null, modules_csv:mods.join(",") };
  }

  // 8. Dedicated circuits / new circuits / appliances / HVAC
  if (/dedicated|new circuit|appliance|\bhvac\b/.test(n)) {
    return { tier:null,
      modules_csv:"PROPERTY_TYPE,HOME_AGE,PANEL_LOCATION,PANEL_PHOTO,DEDICATED_CIRCUIT_APPLIANCE,DEDICATED_CIRCUIT_VOLTAGE,DEDICATED_CIRCUIT_DISTANCE,WORK_AREA_PHOTOS,UNCERTAINTY_BUFFER" };
  }

  // 11. Surge protection
  if (/surge/.test(n)) {
    return { tier:null,
      modules_csv:"PROPERTY_TYPE,HOME_AGE,PANEL_PHOTO,SURGE_TYPE,PANEL_BRAND,WORK_AREA_PHOTOS,UNCERTAINTY_BUFFER" };
  }

  // 13. Generators / transfer switch
  if (/generator|transfer switch/.test(n)) {
    const isStandby = /standby|backup/.test(n);
    return { tier: isStandby ? "site_visit_required" : null,
      modules_csv:"PROPERTY_TYPE,HOME_AGE,PANEL_PHOTO,GENERATOR_TYPE,TRANSFER_SWITCH_LOCATION,WORK_AREA_PHOTOS,UNCERTAINTY_BUFFER" };
  }

  // 12. Panel / subpanel / breaker / fuse box / service upgrade
  if (/panel|subpanel|fuse box|breaker|service upgrade/.test(n)) {
    return { tier:null,
      modules_csv:"PROPERTY_TYPE,HOME_AGE,PANEL_PHOTO,PANEL_WORK_TYPE,PANEL_BRAND,WORK_AREA_PHOTOS,UNCERTAINTY_BUFFER" };
  }

  // Smoke / CO detectors
  if (/smoke|detector|\bco\b/.test(n)) {
    return { tier:null,
      modules_csv:"PROPERTY_TYPE,HOME_AGE,EXISTING_POWER_PRESENT,WORK_AREA_PHOTOS,UNCERTAINTY_BUFFER" };
  }

  // Default
  return { tier:null,
    modules_csv:"PROPERTY_TYPE,HOME_AGE,WORK_AREA_PHOTOS,UNCERTAINTY_BUFFER" };
}

// ─── Helpers ──────────────────────────────────────────────────────────────────
function toRows(values) {
  if (!values || values.length < 1) return { headers:[], rows:[] };
  const [headers, ...data] = values;
  const rows = data.map((row, i) => ({
    _rowNum: i + 2, // 1-indexed, +1 for header row, +1 for 1-indexing
    ...Object.fromEntries(headers.map((h, j) => [String(h).trim(), String(row[j] ?? "").trim()])),
  }));
  return { headers: headers.map(h=>String(h).trim()), rows };
}

function colLetter(idx) {
  let s = "", n = idx;
  while (n >= 0) { s = String.fromCharCode(65 + (n % 26)) + s; n = Math.floor(n / 26) - 1; }
  return s;
}

// ─── Main ─────────────────────────────────────────────────────────────────────
async function main() {
  const sheets = await getSheetsClient();
  let modulesAdded = 0, modulesUpdated = 0, servicesUpdated = 0;

  // ── A) Upsert Estimator_Modules ───────────────────────────────────────────
  const modResp = await sheets.spreadsheets.values.get({
    spreadsheetId: SHEET_ID, range: "Estimator_Modules!A1:Z2000",
  });
  const { headers: modHeaders, rows: modRows } = toRows(modResp.data.values);
  console.log(`\nEstimator_Modules: ${modRows.length} existing rows, headers: ${modHeaders.join(", ")}`);

  const midCol   = modHeaders.indexOf("module_id");
  const qCol     = modHeaders.indexOf("question");
  const itCol    = modHeaders.indexOf("input_type");
  const ojCol    = modHeaders.indexOf("options_json");

  // Build lookup: module_id → row
  const existingMap = {};
  modRows.forEach(r => { if (r.module_id) existingMap[r.module_id] = r; });

  const updateRanges = [];
  const newRows = [];

  for (const mod of MODULES_LIBRARY) {
    const oj = JSON.stringify(mod.options);
    const existing = existingMap[mod.module_id];

    if (existing) {
      // Determine new question value
      let newQ = mod.question;
      if (existing.question && existing.question !== mod.question) {
        console.warn(`  [WARN] ${mod.module_id}: existing question differs — keeping existing.`);
        console.warn(`    existing: "${existing.question}"`);
        console.warn(`    new:      "${mod.question}"`);
        newQ = existing.question; // keep existing
      }

      // Always update input_type and options_json; conditionally update question
      const rowNum = existing._rowNum;
      updateRanges.push({ range: `Estimator_Modules!${colLetter(qCol)}${rowNum}`,  values: [[newQ]] });
      updateRanges.push({ range: `Estimator_Modules!${colLetter(itCol)}${rowNum}`, values: [[mod.input_type]] });
      updateRanges.push({ range: `Estimator_Modules!${colLetter(ojCol)}${rowNum}`, values: [[oj]] });
      modulesUpdated++;
    } else {
      // Build new row in header order
      const newRow = modHeaders.map(h => {
        if (h === "module_id")   return mod.module_id;
        if (h === "question")    return mod.question;
        if (h === "input_type")  return mod.input_type;
        if (h === "options_json") return oj;
        if (h === "applies_to")  return "all";
        return "";
      });
      newRows.push(newRow);
      modulesAdded++;
    }
  }

  // Execute batch update for existing modules
  if (updateRanges.length) {
    await sheets.spreadsheets.values.batchUpdate({
      spreadsheetId: SHEET_ID,
      requestBody: { valueInputOption: "RAW", data: updateRanges },
    });
    console.log(`Updated ${modulesUpdated} existing modules.`);
  }

  // Append new modules
  if (newRows.length) {
    await sheets.spreadsheets.values.append({
      spreadsheetId: SHEET_ID,
      range: "Estimator_Modules!A1",
      valueInputOption: "RAW",
      insertDataOption: "INSERT_ROWS",
      requestBody: { majorDimension: "ROWS", values: newRows },
    });
    console.log(`Appended ${modulesAdded} new modules.`);
  }

  // ── B) Update Estimator_ServiceMatrix ─────────────────────────────────────
  const svcResp = await sheets.spreadsheets.values.get({
    spreadsheetId: SHEET_ID, range: "Estimator_ServiceMatrix!A1:Z2000",
  });
  const { headers: svcHeaders, rows: svcRows } = toRows(svcResp.data.values);
  console.log(`\nEstimator_ServiceMatrix: ${svcRows.length} services, headers: ${svcHeaders.join(", ")}`);

  const mcCol   = svcHeaders.indexOf("modules_csv");
  const tierCol = svcHeaders.indexOf("tier");

  if (mcCol < 0)   { console.error("modules_csv column not found in ServiceMatrix"); process.exit(1); }
  if (tierCol < 0) { console.error("tier column not found in ServiceMatrix"); process.exit(1); }

  const svcUpdates = [];
  for (const svc of svcRows) {
    if (!svc.service_id) continue;
    const { tier: newTier, modules_csv } = assignModules(svc.service_name, svc.tier, svc.segment);
    const rn = svc._rowNum;

    svcUpdates.push({ range: `Estimator_ServiceMatrix!${colLetter(mcCol)}${rn}`, values: [[modules_csv]] });
    if (newTier) {
      svcUpdates.push({ range: `Estimator_ServiceMatrix!${colLetter(tierCol)}${rn}`, values: [[newTier]] });
    }

    console.log(`  ${svc.service_name} → ${modules_csv.split(",").length} modules${newTier?" [tier→"+newTier+"]":""}`);
    servicesUpdated++;
  }

  if (svcUpdates.length) {
    await sheets.spreadsheets.values.batchUpdate({
      spreadsheetId: SHEET_ID,
      requestBody: { valueInputOption: "RAW", data: svcUpdates },
    });
  }

  console.log(`\n─── Summary ───`);
  console.log(`Modules added:     ${modulesAdded}`);
  console.log(`Modules updated:   ${modulesUpdated}`);
  console.log(`Services updated:  ${servicesUpdated}`);
}

main().catch(err => { console.error("Script failed:", err.message); process.exit(1); });

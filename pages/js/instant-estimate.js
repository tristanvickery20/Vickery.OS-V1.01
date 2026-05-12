// pages/js/instant-estimate.js — Instant Estimate Wizard (v2026-04-11)
"use strict";

// ── State ─────────────────────────────────────────────────────────────────────
const S = {
  config: null,
  segment: null,
  service: null,
  qty: 1,
  moduleList: [],
  idx: 0,
  answers: {},
  photos: {},
  productSelections: {},   // { all: prodId } or { 0: prodId, 1: prodId, … }
  sameForAll: true,
  activeUnit: 0,
  uncertain: null,
  consents: {},           // { ie_scope: bool } — pre-booking consent
};

// ── Product Catalog ───────────────────────────────────────────────────────────
// Keyed by canonical service_id. getCatalogForService() also does pattern matching.
const PRODUCT_CATALOG = {

  CEILING_FAN_INSTALL: {
    label: "Ceiling Fan",
    icon: "fan",
    note: "All fans include installation of fan-rated box, canopy, and balancing.",
    products: [
      {
        id: "FAN_HAMPTON_WINDWARD",
        brand: "Hampton Bay", name: "Windward II 52\"", model: "AF156WH",
        price_delta: 0, badge: "Best Value",
        features: ["52\" blade span", "Reversible motor", "3-speed pull chain", "LED compatible"],
      },
      {
        id: "FAN_HUNTER_ORIGINAL",
        brand: "Hunter", name: "Original 52\"", model: "21895",
        price_delta: 30, badge: null,
        features: ["52\" span", "WhisperWind motor", "5 reversible blades", "Lifetime warranty"],
      },
      {
        id: "FAN_HUNTER_SENTINEL",
        brand: "Hunter", name: "Sentinel 54\" Smart", model: "59544",
        price_delta: 75, badge: "Most Popular",
        features: ["54\" span", "Wi-Fi + voice control", "Dimmable LED kit", "Works with Alexa & Google"],
      },
      {
        id: "FAN_PROGRESS_AIRPRO",
        brand: "Progress Lighting", name: "AirPro 52\"", model: "P2500-20",
        price_delta: 95, badge: "Premium",
        features: ["52\" span", "Commercial-grade motor", "Remote included", "Energy Star rated"],
      },
    ],
  },

  OUTLET_INSTALL: {
    label: "Outlet / Receptacle",
    icon: "outlet",
    note: "All outlets are tamper-resistant and include a matching decorator cover plate.",
    products: [
      {
        id: "OUT_LEVITON_15TR",
        brand: "Leviton", name: "15A Tamper-Resistant", model: "T5320-W",
        price_delta: 0, badge: "Standard",
        features: ["15A / 125V", "Tamper-resistant slots", "White finish", "UL listed"],
      },
      {
        id: "OUT_LEVITON_20TR",
        brand: "Leviton", name: "20A Tamper-Resistant", model: "T5362-W",
        price_delta: 8, badge: null,
        features: ["20A / 125V", "T-slot configuration", "Commercial grade", "Tamper-resistant"],
      },
      {
        id: "OUT_LEVITON_DECORA",
        brand: "Leviton", name: "Decora 15A", model: "DR15-1WZ",
        price_delta: 14, badge: "Most Popular",
        features: ["Decorator-style face", "15A / 125V", "Tamper-resistant", "Smooth modern look"],
      },
      {
        id: "OUT_LEVITON_USB",
        brand: "Leviton", name: "Decora USB-A + Outlet", model: "USB2A-W",
        price_delta: 38, badge: "Upgrade",
        features: ["2× USB-A ports", "3.6A combined USB", "15A standard outlet", "White Decora face"],
      },
    ],
  },

  GFCI_OUTLET: {
    label: "GFCI Outlet",
    icon: "outlet",
    note: "All GFCI outlets include self-test technology and a matching cover plate.",
    products: [
      {
        id: "GFCI_LEVITON_15",
        brand: "Leviton", name: "15A GFCI", model: "N7599-W",
        price_delta: 0, badge: "Standard",
        features: ["15A / 125V", "LED indicator", "Tamper-resistant", "Self-test built-in"],
      },
      {
        id: "GFCI_LEVITON_20",
        brand: "Leviton", name: "20A GFCI", model: "N7898-W",
        price_delta: 14, badge: null,
        features: ["20A / 125V", "Self-test", "Commercial-rated", "Auto-monitoring"],
      },
      {
        id: "GFCI_LEVITON_SLP",
        brand: "Leviton", name: "SmartlockPro Self-Test", model: "GFNT2-W",
        price_delta: 20, badge: "Most Popular",
        features: ["Automatic self-test", "Trip LED indicator", "15A", "Meets 2023 NEC"],
      },
      {
        id: "GFCI_LUTRON_CLARO",
        brand: "Lutron", name: "Claro 15A GFCI", model: "CA-GFI15-WH",
        price_delta: 30, badge: "Designer",
        features: ["Screwless cover plate", "Wide rocker style", "15A", "White satin finish"],
      },
    ],
  },

  DIMMER_INSTALL: {
    label: "Dimmer Switch",
    icon: "dimmer",
    note: "Verify your bulb wattage before choosing — all dimmers are LED compatible.",
    products: [
      {
        id: "DIM_LEVITON_6674",
        brand: "Leviton", name: "600W Slide Dimmer", model: "6674-P0W",
        price_delta: 0, badge: "Standard",
        features: ["600W incandescent", "Slide + rocker", "LED compatible", "White finish"],
      },
      {
        id: "DIM_LUTRON_DIVA",
        brand: "Lutron", name: "Diva 150W LED", model: "DVCL-153P-WH",
        price_delta: 18, badge: "Most Popular",
        features: ["150W LED / CFL", "Rocker + slide design", "No neutral wire needed", "White"],
      },
      {
        id: "DIM_LEVITON_SMART",
        brand: "Leviton", name: "Decora Smart Wi-Fi", model: "DSL06-1LZ",
        price_delta: 52, badge: "Smart",
        features: ["Wi-Fi — no hub", "Alexa & Google", "Schedule & scenes", "Neutral required"],
      },
      {
        id: "DIM_LUTRON_CASETA",
        brand: "Lutron", name: "Caséta Wireless Pro", model: "PD-10NXD-WH",
        price_delta: 68, badge: "Premium",
        features: ["No neutral wire", "Smart Bridge compatible", "Siri / Alexa / Google", "Industry-leading reliability"],
      },
    ],
  },

  RECESSED_LIGHTING: {
    label: "Recessed Light Fixture",
    icon: "recessed",
    note: "Price shown is per fixture. All fixtures are IC-rated and air-tight.",
    products: [
      {
        id: "REC_HALO_H6ICAT",
        brand: "Halo", name: "6\" LED Recessed", model: "H6ICAT",
        price_delta: 0, badge: "Standard",
        features: ["6\" aperture", "IC rated / airtight", "800 lumens", "2700K warm white"],
      },
      {
        id: "REC_NICOR_SLIM",
        brand: "NICOR", name: "6\" Slim LED", model: "NDS6-10-2-4KSF",
        price_delta: 22, badge: "Best Value",
        features: ["0.5\" thin profile", "No housing can", "3000K or 4000K", "Damp rated"],
      },
      {
        id: "REC_HALO_CCT",
        brand: "Halo", name: "5/6\" Selectable CCT", model: "RL56069S1EWHR",
        price_delta: 32, badge: "Most Popular",
        features: ["5\" or 6\" trim", "2700K–5000K dial", "Dimmable", "12-year warranty"],
      },
      {
        id: "REC_PHILIPS_HUE",
        brand: "Philips Hue", name: "White Ambiance 5/6\"", model: "470292",
        price_delta: 68, badge: "Smart",
        features: ["App controlled", "2200K–6500K range", "Dimmable", "Alexa / Siri / Google"],
      },
    ],
  },

  EV_CHARGER_INSTALL: {
    label: "EV Charging Station",
    icon: "evcharger",
    note: "All units are hardwired 240V Level 2 installations. Permit and inspection included.",
    products: [
      {
        id: "EV_EATON_30A",
        brand: "Eaton", name: "30A Level 2 EVSE", model: "EVSP30SW",
        price_delta: 0, badge: "Standard",
        features: ["30A / 240V", "25 ft cable", "Hardwired", "Energy Star"],
      },
      {
        id: "EV_JUICEBOX_40",
        brand: "JuiceBox", name: "40A Smart Charger", model: "JB-40A",
        price_delta: 120, badge: "Most Popular",
        features: ["40A / 240V", "Smart scheduling", "App monitoring", "25 ft cable"],
      },
      {
        id: "EV_CHARGEPOINT_50",
        brand: "ChargePoint", name: "Home Flex 50A", model: "CPH50-NEMA14-50",
        price_delta: 185, badge: "Premium",
        features: ["50A / 240V", "Wi-Fi + app", "23 ft cable", "Works with any EV"],
      },
      {
        id: "EV_TESLA_WC",
        brand: "Tesla", name: "Wall Connector Gen 3", model: "1457768-05-E",
        price_delta: 205, badge: "Tesla",
        features: ["48A / 240V", "24 ft cable", "Auto load balancing", "Wi-Fi connected"],
      },
    ],
  },

  LIGHT_FIXTURE: {
    label: "Light Fixture",
    icon: "fixture",
    note: "Fixture must be selected and on-site at time of install — or we can source it.",
    products: [
      {
        id: "FIX_HAMPTON_BASIC",
        brand: "Hampton Bay", name: "LED Flush Mount", model: "HB6088",
        price_delta: 0, badge: "Standard",
        features: ["LED integrated", "Flush ceiling mount", "3000K", "Dimmable"],
      },
      {
        id: "FIX_PROGRESS_GATHER",
        brand: "Progress Lighting", name: "Gather 1-Light Pendant", model: "P500157-031",
        price_delta: 42, badge: "Modern",
        features: ["Pendant style", "Adjustable cord", "Matte black finish", "E26 medium base"],
      },
      {
        id: "FIX_KICHLER_BARRE",
        brand: "Kichler", name: "Barre 3-Light Linear", model: "42045NI",
        price_delta: 78, badge: "Most Popular",
        features: ["3-light bar", "Brushed nickel", "Dimmable", "Vanity or kitchen bar"],
      },
      {
        id: "FIX_HINKLEY_HOVER",
        brand: "Hinkley", name: "Hover LED Flush", model: "900742F",
        price_delta: 115, badge: "Premium",
        features: ["Integrated LED", "Satin black", "1600 lumens", "Modern low-profile"],
      },
    ],
  },

  LIGHT_FIXTURE_INSTALL: {
    label: "Light Fixture",
    icon: "fixture",
    note: "Fixture must be selected and on-site at time of install — or we can source it.",
    products: [], // aliased from LIGHT_FIXTURE below
  },

  SMART_SWITCH: {
    label: "Smart Switch",
    icon: "smartswitch",
    note: "Confirm whether your circuit has a neutral wire before selecting a model.",
    products: [
      {
        id: "SS_LEVITON_D215S",
        brand: "Leviton", name: "Decora Smart Wi-Fi", model: "D215S-1BW",
        price_delta: 0, badge: "Standard",
        features: ["Wi-Fi 2.4GHz", "No hub required", "15A", "Alexa & Google"],
      },
      {
        id: "SS_GE_CYNC",
        brand: "GE CYNC", name: "Smart Switch", model: "BRSW-ON/OFF-V20N",
        price_delta: 18, badge: "Best Value",
        features: ["Bluetooth + Wi-Fi", "15A", "Schedule & scenes", "Neutral required"],
      },
      {
        id: "SS_LUTRON_CASETA",
        brand: "Lutron", name: "Caséta Wireless", model: "PD-6ANS-WH",
        price_delta: 48, badge: "Most Popular",
        features: ["No neutral wire", "Smart Bridge ready", "Alexa / Siri / Google", "Pro-grade reliability"],
      },
      {
        id: "SS_LUTRON_RADIORA",
        brand: "Lutron", name: "RadioRA 3 Switch", model: "RR-15APS-WH",
        price_delta: 98, badge: "Premium",
        features: ["Whole-home system", "No neutral needed", "LED status display", "15A"],
      },
    ],
  },

  SMART_SWITCH_INSTALL: {
    label: "Smart Switch",
    icon: "smartswitch",
    note: "Confirm whether your circuit has a neutral wire before selecting a model.",
    products: [], // aliased from SMART_SWITCH below
  },

  USB_OUTLET: {
    label: "USB Outlet",
    icon: "outlet",
    note: "USB outlets replace a standard outlet — no new circuit required.",
    products: [
      {
        id: "USB_LEVITON_AA",
        brand: "Leviton", name: "USB-A + USB-A", model: "USB2A-W",
        price_delta: 0, badge: "Standard",
        features: ["2× USB-A", "3.6A combined", "15A outlet", "White Decora"],
      },
      {
        id: "USB_LEVITON_CC",
        brand: "Leviton", name: "USB-C + USB-C", model: "USB2C-W",
        price_delta: 18, badge: "Modern",
        features: ["2× USB-C", "4.2A combined", "15A outlet", "Power Delivery"],
      },
      {
        id: "USB_LEVITON_AC",
        brand: "Leviton", name: "USB-A + USB-C", model: "USBAC-W",
        price_delta: 14, badge: "Most Popular",
        features: ["1× USB-A + 1× USB-C", "3.6A total", "15A outlet", "Universal compatibility"],
      },
      {
        id: "USB_LEGRAND_W",
        brand: "Legrand", name: "radiant USB-C 30W", model: "RUSB30CC2W",
        price_delta: 38, badge: "Fast Charge",
        features: ["USB-C 30W PD", "Single high-power port", "15A outlet", "White finish"],
      },
    ],
  },

};

// Alias empty catalogs to their parent
PRODUCT_CATALOG.LIGHT_FIXTURE_INSTALL.products = PRODUCT_CATALOG.LIGHT_FIXTURE.products;
PRODUCT_CATALOG.SMART_SWITCH_INSTALL.products   = PRODUCT_CATALOG.SMART_SWITCH.products;
PRODUCT_CATALOG.DIMMER_SWITCH                   = PRODUCT_CATALOG.DIMMER_INSTALL;
PRODUCT_CATALOG.DIMMER_SWITCH_INSTALL           = PRODUCT_CATALOG.DIMMER_INSTALL;
PRODUCT_CATALOG.GFCI_INSTALL                    = PRODUCT_CATALOG.GFCI_OUTLET;
PRODUCT_CATALOG.EV_CHARGER                      = PRODUCT_CATALOG.EV_CHARGER_INSTALL;

// ── Helpers ───────────────────────────────────────────────────────────────────
const $   = id => document.getElementById(id);
const esc = s  => String(s||"").replace(/[&<>"']/g, c =>
  ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":'&#39;'}[c]));

function setProgress(n) {
  ["ps1","ps2","ps3","ps4","ps5"].forEach((id,i) => {
    const el = $(id); if (!el) return;
    el.className = "progress-step" + (i+1 < n ? " done" : i+1 === n ? " active" : "");
  });
}

function show(html) { $("stepContent").innerHTML = html; }

function statusMsg(msg, isErr) {
  show(`<div class="status-msg${isErr?" error-msg":""}">${esc(msg)}</div>`);
}

function reset() {
  Object.assign(S, {
    segment: null, service: null, qty: 1,
    moduleList: [], idx: 0, answers: {}, photos: {},
    productSelections: {}, sameForAll: true, activeUnit: 0, uncertain: null,
  });
}

// ── Config normalization (defensive — handles both shapes) ─────────────────────
function normalize(d) {
  const modules = d.modules || d.modulesById || {};
  for (const [mid, mod] of Object.entries(modules)) {
    if (!mod) continue;
    if (!Array.isArray(mod.options)) {
      try { mod.options = JSON.parse(mod.options_json || "[]"); } catch { mod.options = []; }
    }
    mod.module_id = mod.module_id || mid;
  }
  const services = (d.services || []).map(s => ({
    ...s,
    modules: Array.isArray(s.modules)
      ? s.modules
      : (s.modules_csv || s.modulesCsv || "").split(",").map(m => m.trim()).filter(Boolean),
    enabled: String(s.enabled ?? "true").toUpperCase() !== "FALSE",
  }));
  return { modules, services, updatedAt: d.updatedAt };
}

// ── Debug accordion ───────────────────────────────────────────────────────────
function renderDebug() {
  const cfg = S.config;
  const svcCount = cfg?.services?.length ?? 0;
  const modCount = Object.keys(cfg?.modules ?? {}).length;
  const selMods  = S.service?.modules ?? [];
  return `
  <details class="debug-box" style="margin-top:28px">
    <summary class="debug-toggle">Debug info</summary>
    <div class="debug-body">
      <div class="debug-row"><span>Config loaded</span><span>${esc(cfg?.updatedAt ?? "—")}</span></div>
      <div class="debug-row"><span>Services</span><span>${svcCount}</span></div>
      <div class="debug-row"><span>Modules</span><span>${modCount}</span></div>
      <div class="debug-row"><span>Selected service</span><span>${esc(S.service?.service_id ?? "—")}</span></div>
      <div class="debug-row"><span>Selected modules</span><span>${selMods.length ? esc(selMods.join(", ")) : "—"}</span></div>
      <div class="debug-row"><span>Catalog match</span><span>${getCatalogForService() ? "yes — " + esc(getCatalogForService()?.label) : "none (step skipped)"}</span></div>
      <div class="debug-row"><span>Product selections</span><span>${esc(JSON.stringify(S.productSelections))}</span></div>
      <div class="debug-row"><span>Uncertain answers</span><span>${Object.keys(S.uncertain||{}).join(", ")||"none"}</span></div>
      <details style="margin-top:8px"><summary style="cursor:pointer;color:var(--muted);font-size:.75rem">Raw config JSON</summary>
        <pre class="debug-pre">${esc(JSON.stringify(cfg, null, 2))}</pre>
      </details>
    </div>
  </details>`;
}

// ── Product catalog lookup ────────────────────────────────────────────────────
function getCatalogForService() {
  const sid = S.service?.service_id || "";
  if (!sid) return null;

  // Exact match
  if (PRODUCT_CATALOG[sid]) return PRODUCT_CATALOG[sid];

  // Pattern matching for variant naming conventions
  const patterns = [
    ["CEILING_FAN",   "CEILING_FAN_INSTALL"],
    ["EV_CHARGER",    "EV_CHARGER_INSTALL"],
    ["GFCI",          "GFCI_OUTLET"],
    ["DIMMER",        "DIMMER_INSTALL"],
    ["RECESSED",      "RECESSED_LIGHTING"],
    ["LIGHT_FIX",     "LIGHT_FIXTURE"],
    ["SMART_SWITCH",  "SMART_SWITCH"],
    ["USB_OUTLET",    "USB_OUTLET"],
    ["OUTLET",        "OUTLET_INSTALL"],
  ];
  for (const [pat, key] of patterns) {
    if (sid.includes(pat) && PRODUCT_CATALOG[key]) return PRODUCT_CATALOG[key];
  }
  return null;
}

// ── Product SVG icons (one per category) ─────────────────────────────────────
function getProdIcon(type) {
  const icons = {
    fan: `<svg width="72" height="72" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round">
      <circle cx="12" cy="12" r="2"/>
      <path d="M12 10c0-3-2-6-4-6-1.5 0-2.5 1.5-1.5 3.5S10 10 10 12"/>
      <path d="M14 12c3 0 6-2 6-4 0-1.5-1.5-2.5-3.5-1.5S14 10 12 10"/>
      <path d="M12 14c0 3 2 6 4 6 1.5 0 2.5-1.5 1.5-3.5S14 14 14 12"/>
      <path d="M10 12c-3 0-6 2-6 4 0 1.5 1.5 2.5 3.5 1.5S10 14 12 14"/>
    </svg>`,
    outlet: `<svg width="72" height="72" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round">
      <rect x="2" y="2" width="20" height="20" rx="3"/>
      <circle cx="12" cy="13" r="3"/>
      <line x1="10" y1="7" x2="10" y2="9.5"/>
      <line x1="14" y1="7" x2="14" y2="9.5"/>
    </svg>`,
    dimmer: `<svg width="72" height="72" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round">
      <rect x="2" y="2" width="20" height="20" rx="3"/>
      <line x1="6" y1="12" x2="18" y2="12"/>
      <circle cx="14" cy="12" r="2.5"/>
      <line x1="12" y1="6" x2="12" y2="8"/>
      <line x1="12" y1="16" x2="12" y2="18"/>
    </svg>`,
    recessed: `<svg width="72" height="72" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round">
      <circle cx="12" cy="12" r="5"/>
      <line x1="12" y1="2" x2="12" y2="5"/>
      <line x1="12" y1="19" x2="12" y2="22"/>
      <line x1="2" y1="12" x2="5" y2="12"/>
      <line x1="19" y1="12" x2="22" y2="12"/>
      <line x1="4.93" y1="4.93" x2="7.05" y2="7.05"/>
      <line x1="16.95" y1="16.95" x2="19.07" y2="19.07"/>
      <line x1="4.93" y1="19.07" x2="7.05" y2="16.95"/>
      <line x1="16.95" y1="7.05" x2="19.07" y2="4.93"/>
    </svg>`,
    evcharger: `<svg width="72" height="72" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round">
      <rect x="4" y="2" width="16" height="20" rx="3"/>
      <path d="M13 2v4h4l-6 9v-5H7l6-8z"/>
      <line x1="7" y1="22" x2="17" y2="22"/>
    </svg>`,
    fixture: `<svg width="72" height="72" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round">
      <line x1="12" y1="2" x2="12" y2="5"/>
      <path d="M9 5h6a1 1 0 0 1 1 1v3a5 5 0 0 1-10 0V6a1 1 0 0 1 1-1z"/>
      <line x1="9" y1="17" x2="15" y2="17"/>
      <line x1="10" y1="19.5" x2="14" y2="19.5"/>
      <line x1="11" y1="22" x2="13" y2="22"/>
    </svg>`,
    smartswitch: `<svg width="72" height="72" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round">
      <rect x="2" y="2" width="20" height="20" rx="3"/>
      <path d="M8.56 2.75c4.37 6.03 6.02 9.42 8.03 17.72"/>
      <path d="M2 12.9c3.5-.93 6.63-.82 8.94 0 2.58.92 5.01 2.86 7.44 6.32"/>
    </svg>`,
  };
  return icons[type] || icons.outlet;
}

// ── Badge CSS class helper ─────────────────────────────────────────────────────
function badgeClass(badge) {
  if (!badge) return "";
  const map = {
    "Most Popular": "bd-popular",
    "Best Value":   "bd-value",
    "Standard":     "bd-std",
    "Premium":      "bd-prem",
    "Smart":        "bd-smart",
    "Tesla":        "bd-special",
    "Upgrade":      "bd-prem",
    "Fast Charge":  "bd-smart",
    "Modern":       "bd-value",
    "Designer":     "bd-prem",
  };
  return map[badge] || "bd-std";
}

// ── Step 1: Segment ───────────────────────────────────────────────────────────
function renderSegment() {
  setProgress(1);
  show(`
    <div class="seg-grid">
      ${["residential","commercial"].map(seg => `
        <div class="seg-card${S.segment===seg?" picked":""}" data-seg="${seg}">
          <div class="icon">${seg==="residential"
            ? '<svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/></svg>'
            : '<svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="4" y="2" width="16" height="20" rx="1"/><path d="M9 22v-4h6v4"/><path d="M8 6h.01M16 6h.01M12 6h.01M12 10h.01M12 14h.01M16 10h.01M16 14h.01M8 10h.01M8 14h.01"/></svg>'}</div>
          <div class="label">${seg==="residential"?"Residential":"Commercial"}</div>
          <div class="desc">${seg==="residential"?"Home upgrades, repairs & installations":"Office, retail & industrial solutions"}</div>
        </div>`).join("")}
    </div>
    <div class="actions"><button class="btn btn-primary" id="nextSeg"${S.segment?"":" disabled"}>Next →</button></div>
    ${renderDebug()}`);
  document.querySelectorAll(".seg-card").forEach(c =>
    c.addEventListener("click", () => { S.segment = c.dataset.seg; renderSegment(); }));
  $("nextSeg")?.addEventListener("click", renderService);
}

// ── Step 2: Service ───────────────────────────────────────────────────────────
function renderService() {
  setProgress(2);
  const all  = (S.config.services||[]).filter(sv => sv.segment===S.segment && sv.enabled!==false);
  const TC   = { instant:"tier-instant", instant_with_safeguards:"tier-safeguards", site_visit_required:"tier-site-visit" };
  const TL   = { instant:"Instant", instant_with_safeguards:"Instant Quote", site_visit_required:"Site Visit" };
  const isInstant = s => s.tier !== "site_visit_required";
  const instant   = all.filter(isInstant);
  const siteVisit = all.filter(s => !isInstant(s));
  const svcs      = [...instant, ...siteVisit];

  if (!svcs.length) {
    show(`<div class="warn-banner"><svg-warn/> No services found for segment "${esc(S.segment)}".</div>
      <div class="actions"><button class="btn btn-ghost" id="bkSeg">← Back</button></div>${renderDebug()}`);
    $("bkSeg").addEventListener("click", renderSegment);
    return;
  }

  const WARN_SVG = `<span style="display:inline-flex;align-items:center;gap:4px;vertical-align:middle"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg></span>`;
  const BOLT_SVG = `<span style="display:inline-flex;align-items:center;gap:5px;vertical-align:middle"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/></svg></span>`;
  const CLIP_SVG = `<span style="display:inline-flex;align-items:center;gap:5px;vertical-align:middle"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"/><rect x="8" y="2" width="8" height="4" rx="1"/></svg></span>`;

  function svcCard(sv) {
    return `<div class="svc-card${S.service?.service_id===sv.service_id?" picked":""}" data-id="${sv.service_id}">
      <span class="svc-name">${esc(sv.service_name)}</span>
      <span class="tier-badge ${TC[sv.tier]||""}">${TL[sv.tier]||sv.tier}</span>
    </div>`;
  }

  const listHtml = [
    instant.length   ? `<div class="svc-section-label">${BOLT_SVG} Instant Quote Available</div>${instant.map(svcCard).join("")}` : "",
    siteVisit.length ? `<div class="svc-section-label">${CLIP_SVG} Requires Site Visit</div>${siteVisit.map(svcCard).join("")}` : "",
  ].join("");

  show(`
    <input class="search-box" id="svcSearch" placeholder="Search services…" autocomplete="off"/>
    <div class="service-list" id="svcList">${listHtml}</div>
    ${S.service?.tier==="site_visit_required"
      ? `<div class="site-visit-notice">${WARN_SVG} This service needs an on-site assessment — no instant questions, but we'll call to schedule a free visit.</div>`
      : ""}
    <div class="actions">
      <button class="btn btn-ghost" id="backSeg">← Back</button>
      <button class="btn btn-primary" id="nextSvc"${S.service?"":" disabled"}>Next →</button>
    </div>
    ${renderDebug()}`);

  $("svcSearch").addEventListener("input", function() {
    const q = this.value.toLowerCase();
    document.querySelectorAll(".svc-card").forEach(c => {
      c.style.display = c.querySelector(".svc-name").textContent.toLowerCase().includes(q) ? "" : "none";
    });
    document.querySelectorAll(".svc-section-label").forEach(lbl => {
      const sibs = [];
      let el = lbl.nextElementSibling;
      while (el && el.classList.contains("svc-card")) { sibs.push(el); el = el.nextElementSibling; }
      lbl.style.display = sibs.some(c => c.style.display !== "none") ? "" : "none";
    });
  });

  document.querySelectorAll(".svc-card").forEach(c => c.addEventListener("click", () => {
    S.service = svcs.find(sv => sv.service_id === c.dataset.id);
    renderService();
  }));
  $("backSeg").addEventListener("click", renderSegment);
  $("nextSvc")?.addEventListener("click", startModules);
}

// ── Step 3: Modules ───────────────────────────────────────────────────────────
function startModules() {
  const mids = S.service?.modules || [];

  if (S.service?.tier === "site_visit_required") {
    S.moduleList = [];
    renderResult(true);
    return;
  }

  const warnings = [];
  S.moduleList = mids.map(mid => {
    const mod = S.config.modules?.[mid];
    if (!mod) { warnings.push(`Config error: module "${mid}" missing in Estimator_Modules.`); return null; }
    return mod;
  }).filter(Boolean);

  if (!mids.length) warnings.push("This service has no modules configured (modules_csv empty).");

  S.idx = 0; S.answers = {}; S.photos = {};

  const WARN_SVG = `<span style="display:inline-flex;align-items:center;gap:4px;vertical-align:middle"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg></span>`;
  const warnBlock = (msgs) =>
    `<div class="warn-banner">${msgs.map(w=>`<div>${WARN_SVG} ${esc(w)}</div>`).join("")}</div>`;

  if (warnings.length && !S.moduleList.length) {
    show(`${warnBlock(warnings)}
      <div class="actions"><button class="btn btn-ghost" id="bkSvc2">← Back</button>
      <button class="btn btn-primary" id="skipToResult">Get Estimate →</button></div>${renderDebug()}`);
    $("bkSvc2").addEventListener("click", renderService);
    $("skipToResult").addEventListener("click", () => renderEquipment());
    return;
  }

  if (warnings.length) {
    $("stepContent").insertAdjacentHTML("afterbegin", warnBlock(warnings));
  }

  renderModule();
}

function renderModule() {
  setProgress(3);
  const m = S.moduleList[S.idx];
  if (!m) { renderEquipment(); return; }  // hand off to equipment step

  const body = m.input_type === "photo"  ? renderPhotoModule(m)
             : m.input_type === "number" ? renderNumberModule(m)
             : renderSelectModule(m);

  show(`
    <div class="module-header">
      <div class="module-progress">${esc(S.service.service_name)} · Question ${S.idx+1} of ${S.moduleList.length}</div>
      <h2 class="module-question">${esc(m.question)}</h2>
    </div>
    <div id="moduleBody">${body}</div>
    <div class="actions" style="justify-content:space-between">
      <button class="btn btn-ghost" id="modBack">${S.idx===0?"← Service":"← Back"}</button>
      <button class="btn btn-primary" id="modNext" disabled>Next →</button>
    </div>
    ${renderDebug()}`);

  bindModuleEvents(m);
}

function renderSelectModule(m) {
  const opts = [...(m.options||[])];
  if (!opts.some(o => /not sure|unknown|unsure/i.test(o.label||"")))
    opts.push({ value:"_unsure", label:"Not sure / skip", multiplier:1.1, uncertain:true });
  return `<div class="option-grid">${opts.map(o =>
    `<button class="option-btn${S.answers[m.module_id]===o.value?" selected":""}"
      data-val="${esc(o.value)}"
      data-dis="${o.disqualify?"1":""}"
      data-unc="${o.uncertain?"1":""}">${esc(o.label)}</button>`
  ).join("")}</div>`;
}

function renderNumberModule(m) {
  const min = parseInt(S.service.qty_min, 10) || 1;
  const max = parseInt(S.service.qty_max, 10) || 20;
  const cur = S.answers[m.module_id] != null ? parseInt(S.answers[m.module_id], 10) : min;
  return `<div class="qty-stepper">
    <button class="qty-btn" id="qtyDec"${cur<=min?" disabled":""}>−</button>
    <span class="qty-val" id="qtyVal">${cur}</span>
    <button class="qty-btn" id="qtyInc"${cur>=max?" disabled":""}>+</button>
  </div>`;
}

function renderPhotoModule(m) {
  const stored = S.photos[m.module_id]||[];
  const CAM_SVG = `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/><circle cx="12" cy="13" r="4"/></svg>`;
  return `<div class="photo-zone">
    <label class="photo-label" for="photoInput">
      <span style="display:inline-flex;align-items:center;gap:6px;vertical-align:middle">${CAM_SVG}</span> Tap to add photos
      <input type="file" id="photoInput" accept="image/*" multiple style="display:none"/>
    </label>
    <div class="thumb-row" id="thumbRow">
      ${stored.map((f,i) =>
        `<div class="thumb-wrap"><img class="thumb" src="${f._url}" alt="${esc(f.name)}"/>
        <button class="thumb-remove" data-idx="${i}">✕</button></div>`
      ).join("")}
    </div>
    <p class="photo-hint">${stored.length ? stored.length+" photo(s) added — or tap Next to continue." : "Optional — photos help us confirm the estimate, but you can skip."}</p>
  </div>`;
}

function bindModuleEvents(m) {
  const nextBtn = $("modNext");
  const check = () => {
    nextBtn.disabled = m.input_type==="number" ? false
                     : m.input_type==="photo"  ? false
                     : !S.answers[m.module_id];
  };

  if (m.input_type !== "photo" && m.input_type !== "number") {
    document.querySelectorAll(".option-btn").forEach(btn => btn.addEventListener("click", () => {
      if (btn.dataset.dis === "1") {
        S.answers[m.module_id] = btn.dataset.val;
        document.querySelectorAll(".option-btn").forEach(b => b.classList.remove("selected"));
        btn.classList.add("selected");
        setTimeout(() => renderResult(true), 400);
        return;
      }
      S.answers[m.module_id] = btn.dataset.val;
      if (btn.dataset.unc === "1") {
        if (!S.uncertain) S.uncertain = {};
        S.uncertain[m.module_id] = true;
      } else {
        if (S.uncertain) delete S.uncertain[m.module_id];
      }
      document.querySelectorAll(".option-btn").forEach(b => b.classList.remove("selected"));
      btn.classList.add("selected");
      check();
    }));
  }
  if (m.input_type === "number") {
    const min = parseInt(S.service.qty_min, 10) || 1;
    const max = parseInt(S.service.qty_max, 10) || 20;
    let cur = S.answers[m.module_id] != null ? parseInt(S.answers[m.module_id], 10) : min;
    const refresh = () => {
      $("qtyVal").textContent = cur; $("qtyDec").disabled = cur<=min; $("qtyInc").disabled = cur>=max;
      S.answers[m.module_id] = cur; S.qty = cur; check();
    };
    $("qtyDec").addEventListener("click", () => { if(cur>min){cur--;refresh();} });
    $("qtyInc").addEventListener("click", () => { if(cur<max){cur++;refresh();} });
    refresh();
  }
  if (m.input_type === "photo") {
    if (!S.photos[m.module_id]) S.photos[m.module_id] = [];
    $("photoInput").addEventListener("change", async function() {
      for (const f of this.files) { f._url = await readFileURL(f); S.photos[m.module_id].push(f); }
      renderModule();
    });
    document.querySelectorAll(".thumb-remove").forEach(btn => btn.addEventListener("click", () => {
      S.photos[m.module_id].splice(Number(btn.dataset.idx), 1); renderModule();
    }));
  }
  nextBtn.addEventListener("click", () => { S.idx++; renderModule(); });
  $("modBack").addEventListener("click", () => { S.idx===0 ? renderService() : (S.idx--, renderModule()); });
  check();
}

function readFileURL(f) {
  return new Promise(r => { const fr=new FileReader(); fr.onload=e=>r(e.target.result); fr.readAsDataURL(f); });
}

// ── Step 4: Equipment selection ───────────────────────────────────────────────
function renderEquipment() {
  const cat = getCatalogForService();
  if (!cat) { renderResult(false); return; }  // no catalog for this service → skip step

  setProgress(4);
  // Initialize selections for current qty if not set
  if (S.sameForAll) {
    if (S.productSelections["all"] === undefined) S.productSelections = {};
  } else {
    for (let i = 0; i < S.qty; i++) {
      if (S.productSelections[i] === undefined) S.productSelections[i] = null;
    }
  }
  renderEquipmentView();
}

function renderEquipmentView() {
  const cat = getCatalogForService();
  const qty = S.qty;
  const sfa = S.sameForAll !== false;
  const sn  = S.service.service_name;

  const pickerKey  = (qty <= 1 || sfa) ? "all" : S.activeUnit;
  const allSelected = _allSelected(qty, sfa);

  const headerHtml = `
    <div class="prod-step-header">
      <div class="prod-step-meta">${esc(sn)} · ${qty > 1 ? qty + " units" : "1 unit"}</div>
      <div class="prod-step-title">Choose your ${esc(cat.label)}</div>
      ${cat.note ? `<div style="font-size:.8rem;color:var(--muted);margin-top:4px">${esc(cat.note)}</div>` : ""}
    </div>`;

  const toggleHtml = qty > 1 ? `
    <label class="same-for-all">
      <input type="checkbox" id="sfaToggle" ${sfa ? "checked" : ""}>
      <span>Apply same selection to all ${qty} unit${qty>1?"s":""}</span>
    </label>` : "";

  const unitTabsHtml = (qty > 1 && !sfa) ? `
    <div class="unit-tabs">
      ${Array.from({length: qty}, (_,i) => {
        const done = !!S.productSelections[i];
        return `<button class="unit-tab${S.activeUnit===i?" active":done?" done":""}" data-unit="${i}">
          Unit ${i+1}${done?" ✓":""}
        </button>`;
      }).join("")}
    </div>` : "";

  const gridHtml = renderProductGrid(cat, pickerKey);

  show(`
    ${headerHtml}
    ${toggleHtml}
    ${unitTabsHtml}
    <div id="prodGrid">${gridHtml}</div>
    <div class="actions" style="justify-content:space-between;margin-top:20px">
      <button class="btn btn-ghost" id="equipBack">← Back</button>
      <button class="btn btn-primary" id="equipNext" ${allSelected ? "" : "disabled"}>Get Estimate →</button>
    </div>
    ${renderDebug()}`);

  bindEquipmentEvents(qty, sfa);
}

function _allSelected(qty, sfa) {
  if (qty <= 1 || sfa) return !!S.productSelections["all"];
  return Array.from({length: qty}, (_,i) => i).every(i => !!S.productSelections[i]);
}

function renderProductGrid(cat, pickerKey) {
  const CHECK_SVG = `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="20 6 9 17 4 12"/></svg>`;
  return `<div class="prod-grid">
    ${cat.products.map(p => {
      const picked = S.productSelections[pickerKey] === p.id;
      const bc = badgeClass(p.badge);
      return `<div class="prod-card${picked?" picked":""}" data-id="${esc(p.id)}" role="button" tabindex="0" aria-pressed="${picked}">
        <div class="prod-check">${CHECK_SVG}</div>
        <div class="prod-img">
          ${getProdIcon(cat.icon)}
          ${p.badge ? `<div class="prod-badge ${bc}">${esc(p.badge)}</div>` : ""}
        </div>
        <div class="prod-body">
          <div class="prod-brand">${esc(p.brand)}</div>
          <div class="prod-name">${esc(p.name)}</div>
          <div class="prod-model">#${esc(p.model)}</div>
          <div class="prod-feats">${p.features.map(f=>`<span class="feat">${esc(f)}</span>`).join("")}</div>
          <span class="prod-price-tag ${p.price_delta===0?"inc":"upg"}">${p.price_delta===0?"Included":"+$"+p.price_delta}</span>
        </div>
      </div>`;
    }).join("")}
  </div>`;
}

function bindEquipmentEvents(qty, sfa) {
  // Product card selection
  document.querySelectorAll(".prod-card").forEach(c => {
    c.addEventListener("click", () => {
      const key = (qty <= 1 || sfa) ? "all" : S.activeUnit;
      S.productSelections[key] = c.dataset.id;

      // Auto-advance to next unselected unit
      if (qty > 1 && !sfa) {
        const nextUnpicked = Array.from({length: qty}, (_,i) => i).find(i => i > S.activeUnit && !S.productSelections[i]);
        if (nextUnpicked !== undefined) {
          S.activeUnit = nextUnpicked;
        }
      }
      renderEquipmentView();
    });
    // keyboard support
    c.addEventListener("keydown", e => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); c.click(); } });
  });

  // Same-for-all toggle
  const sfaEl = $("sfaToggle");
  if (sfaEl) {
    sfaEl.addEventListener("change", () => {
      S.sameForAll = sfaEl.checked;
      if (sfaEl.checked) {
        // Collapse per-unit back to one selection (use unit 0's or existing "all")
        const cur = S.productSelections[0] || S.productSelections["all"] || null;
        S.productSelections = cur ? { all: cur } : {};
      } else {
        // Expand: pre-fill each unit with the current "all" selection if available
        const cur = S.productSelections["all"] || null;
        S.productSelections = {};
        for (let i = 0; i < qty; i++) S.productSelections[i] = cur;
      }
      S.activeUnit = 0;
      renderEquipmentView();
    });
  }

  // Unit tabs
  document.querySelectorAll(".unit-tab").forEach(tab => {
    tab.addEventListener("click", () => {
      S.activeUnit = parseInt(tab.dataset.unit, 10);
      renderEquipmentView();
    });
  });

  // Back — return to last module (or service if no modules)
  $("equipBack").addEventListener("click", () => {
    if (S.moduleList.length > 0) {
      S.idx = S.moduleList.length - 1;
      renderModule();
    } else {
      renderService();
    }
  });

  // Next → result
  $("equipNext").addEventListener("click", () => renderResult(false));
}

// ── Helpers: describe selected products for result display ────────────────────
function buildEquipmentSummaryHtml() {
  const cat = getCatalogForService();
  if (!cat) return "";
  const qty = S.qty;
  const sfa = S.sameForAll !== false;

  const lookup = id => cat.products.find(p => p.id === id);

  let rows = "";
  if (qty <= 1 || sfa) {
    const prod = lookup(S.productSelections["all"]);
    if (!prod) return "";
    rows = `<div class="equip-row">
      <span class="equip-unit">${qty > 1 ? "All "+qty : "Selected"}</span>
      <span class="equip-prod">${esc(prod.name)}<br><span class="equip-brand">${esc(prod.brand)} · #${esc(prod.model)}</span></span>
      <span class="equip-delta ${prod.price_delta===0?"inc":"upg"}">${prod.price_delta===0?"Included":"+$"+prod.price_delta+" ea"}</span>
    </div>`;
  } else {
    for (let i = 0; i < qty; i++) {
      const prod = lookup(S.productSelections[i]);
      if (!prod) continue;
      rows += `<div class="equip-row">
        <span class="equip-unit">Unit ${i+1}</span>
        <span class="equip-prod">${esc(prod.name)}<br><span class="equip-brand">${esc(prod.brand)} · #${esc(prod.model)}</span></span>
        <span class="equip-delta ${prod.price_delta===0?"inc":"upg"}">${prod.price_delta===0?"Incl.":"+$"+prod.price_delta}</span>
      </div>`;
    }
  }

  if (!rows) return "";
  return `<div class="equip-summary">
    <div class="equip-summary-title">Selected Equipment — ${esc(cat.label)}</div>
    ${rows}
  </div>`;
}

// ── Step 5: Result ────────────────────────────────────────────────────────────
async function renderResult(siteVisitForced) {
  setProgress(5);
  show(`<div class="status-msg">Processing…</div>`);
  const photoCount = Object.values(S.photos).reduce((s,a) => s+a.length, 0);
  const retryBtn   = `<button class="btn btn-ghost" onclick="reset();renderSegment()">← Start Over</button>`;

  // Build equipment delta for total display
  const cat = getCatalogForService();
  let equipDelta = 0;
  if (cat) {
    const sfa = S.sameForAll !== false;
    const qty = S.qty;
    const lookup = id => cat.products.find(p => p.id === id);
    if (qty <= 1 || sfa) {
      const prod = lookup(S.productSelections["all"]);
      if (prod) equipDelta = prod.price_delta * qty;
    } else {
      for (let i = 0; i < qty; i++) {
        const prod = lookup(S.productSelections[i]);
        if (prod) equipDelta += prod.price_delta;
      }
    }
  }

  const summary = `<div class="result-summary">
    <div class="rs-row"><span class="rs-lbl">Service</span><span>${esc(S.service.service_name)}</span></div>
    <div class="rs-row"><span class="rs-lbl">Qty</span><span>${S.qty}</span></div>
    <div class="rs-row"><span class="rs-lbl">Photos</span><span>${photoCount} attached</span></div>
    ${Object.entries(S.answers).map(([k,v]) =>
      `<div class="rs-row"><span class="rs-lbl">${esc(k)}</span><span>${esc(v)}</span></div>`
    ).join("")}
  </div>`;

  const equipSummary = buildEquipmentSummaryHtml();

  const WARN_SVG = `<span style="display:inline-flex;align-items:center;gap:5px;vertical-align:middle"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg></span>`;
  const CAM_SVG  = `<span style="display:inline-flex;align-items:center;gap:5px;vertical-align:middle"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/><circle cx="12" cy="13" r="4"/></svg></span>`;
  const DOC_SVG  = `<span style="display:inline-flex;align-items:center;gap:5px;vertical-align:middle"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/></svg></span>`;

  try {
    const r = await fetch("/api/estimator/quote", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        segment: S.segment,
        service_id: S.service.service_id,
        service_name: S.service.service_name,
        qty: S.qty,
        answersByModule: S.answers,
        uncertainModules: S.uncertain || {},
        photoCount,
        productSelections: S.productSelections,
        sameForAll: S.sameForAll,
        equipmentUpgradeDelta: equipDelta,
        ...getIeUtmPayload(),
      }),
    });
    const d = await r.json();
    const tier = d.tier_result || (siteVisitForced ? "needs_site_visit" : "instant_with_safeguards");

    if (tier === "needs_site_visit") {
      const CLIP_SVG = `<svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"/><rect x="8" y="2" width="8" height="4" rx="1"/></svg>`;
      show(`<div class="outcome-card outcome-site-visit">
        <div class="outcome-icon">${CLIP_SVG}</div><h2>Site Visit Required</h2>
        <p>${esc(d.message||"An on-site assessment is required before we can quote this job.")}</p>
        ${d.reasons?.length ? `<ul class="reason-list">${d.reasons.map(r=>`<li>${esc(r)}</li>`).join("")}</ul>` : ""}
        ${summary}
        <div class="actions" style="justify-content:center">${retryBtn}
          <a class="btn btn-gold" href="/contact">Request Free Site Visit →</a></div>
      </div>${renderDebug()}`);
      return;
    }

    const hasPricing = d.total > 0;
    const contPct    = d.contingency_pct ? Math.round(d.contingency_pct * 100) : 0;
    const displayTotal = hasPricing ? d.total + equipDelta : 0;

    const photoWarn  = d.photo_warning
      ? `<div class="warn-banner" style="margin-bottom:12px;">${CAM_SVG} Adding photos would help us confirm this estimate — our tech may follow up to verify scope.</div>` : "";
    const reviewWarn = d.review_flag
      ? `<div class="warn-banner" style="margin-bottom:12px;">${DOC_SVG} ${esc(d.material_disclosure||"Material costs will be confirmed and added separately at actuals.")}</div>` : "";

    const CHECK_ICON = `<svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>`;
    show(`<div class="outcome-card outcome-instant">
      <div class="outcome-icon">${CHECK_ICON}</div><h2>Estimate Ready</h2>
      <p>${esc(d.message||"Your estimate has been generated!")}</p>
      ${photoWarn}${reviewWarn}
      ${hasPricing ? `<div class="price-preview">
        <div class="price-line"><span>Base estimate</span><span>$${d.subtotal?.toLocaleString()||"—"}</span></div>
        ${equipDelta > 0 ? `<div class="price-line muted"><span>Equipment upgrade</span><span>+$${equipDelta.toLocaleString()}</span></div>` : ""}
        ${contPct ? `<div class="price-line muted"><span>Contingency buffer</span><span>+${contPct}%</span></div>` : ""}
        <div class="price-line total-line"><span>Estimated Total</span><span>$${displayTotal.toLocaleString()}</span></div>
        <div style="font-size:.75rem;color:var(--muted);margin-top:8px">Final pricing confirmed at booking. Travel fee may apply.</div>
      </div>` : `<div class="price-preview">Our team will confirm pricing when we reach out to schedule.</div>`}
      ${equipSummary}
      ${summary}
      <div style="font-size:.75rem;color:var(--muted);margin-bottom:16px">Reference: ${esc(d.lead_id||"")}</div>
      <div class="ie-consent-section" style="margin:16px 0 4px;padding:14px 16px;border:1px solid rgba(255,255,255,0.13);border-radius:12px;background:rgba(255,255,255,0.06);">
        <div style="font-size:11px;font-weight:800;text-transform:uppercase;letter-spacing:.07em;color:var(--accent);margin-bottom:10px;">Before You Book</div>
        <label style="display:flex;align-items:flex-start;gap:10px;cursor:pointer;">
          <input type="checkbox" id="ie_consent_scope" style="margin-top:3px;width:18px;height:18px;accent-color:var(--accent);flex-shrink:0;cursor:pointer;">
          <span style="font-size:13px;line-height:1.55;color:var(--muted);">I understand the estimate is based on the information I provided. If actual site conditions differ — location, access, wiring, wall type, or scope — Vickery Electric will pause and discuss any price change before continuing. I agree to provide safe access and be reachable during the appointment.</span>
        </label>
      </div>
      <div class="actions" style="justify-content:center">${retryBtn}
        <button class="btn btn-primary" id="ieBookBtn" disabled>Book Appointment →</button></div>
    </div>${renderDebug()}`);
    document.getElementById("ie_consent_scope")?.addEventListener("change", e => {
      S.consents.ie_scope = e.target.checked;
      const btn = document.getElementById("ieBookBtn");
      if (btn) btn.disabled = !e.target.checked;
    });
    document.getElementById("ieBookBtn")?.addEventListener("click", () => {
      if (S.consents.ie_scope) window.location.href = "/contact";
    });
  } catch (e) {
    show(`<div class="status-msg error-msg">Network error: ${esc(e.message)}</div>${renderDebug()}`);
  }
}

// ── UTM / attribution capture ──────────────────────────────────────────────────
(function captureIeUtms() {
  try {
    const p = new URLSearchParams(window.location.search);
    const utm_source   = p.get("utm_source")   || sessionStorage.getItem("utm_source")   || "";
    const utm_medium   = p.get("utm_medium")   || sessionStorage.getItem("utm_medium")   || "";
    const utm_campaign = p.get("utm_campaign") || sessionStorage.getItem("utm_campaign") || "";
    const utm_content  = p.get("utm_content")  || sessionStorage.getItem("utm_content")  || "";
    const gclid        = p.get("gclid")        || sessionStorage.getItem("gclid")        || "";
    if (utm_source)   sessionStorage.setItem("utm_source",   utm_source);
    if (utm_medium)   sessionStorage.setItem("utm_medium",   utm_medium);
    if (utm_campaign) sessionStorage.setItem("utm_campaign", utm_campaign);
    if (utm_content)  sessionStorage.setItem("utm_content",  utm_content);
    if (gclid)        sessionStorage.setItem("gclid",        gclid);
    if (!sessionStorage.getItem("landing_page")) {
      sessionStorage.setItem("landing_page", window.location.href);
    }
    if (!sessionStorage.getItem("referrer_url") && document.referrer) {
      sessionStorage.setItem("referrer_url", document.referrer);
    }
  } catch (_) { /* non-fatal */ }
})();

function getIeUtmPayload() {
  try {
    return {
      utm_source:   sessionStorage.getItem("utm_source")   || "",
      utm_medium:   sessionStorage.getItem("utm_medium")   || "",
      utm_campaign: sessionStorage.getItem("utm_campaign") || "",
      utm_content:  sessionStorage.getItem("utm_content")  || "",
      gclid:        sessionStorage.getItem("gclid")        || "",
      landing_page: sessionStorage.getItem("landing_page") || "",
      referrer_url: sessionStorage.getItem("referrer_url") || "",
    };
  } catch (_) { return {}; }
}

// ── Boot ──────────────────────────────────────────────────────────────────────
async function init() {
  try {
    const r = await fetch("/api/estimator/config?_=" + Date.now());
    const d = await r.json();
    if (!d.ok) throw new Error(d.error || "Config load failed");
    S.config = normalize(d);
    const WARN_SVG = `<span style="display:inline-flex;align-items:center;gap:4px;vertical-align:middle"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg></span>`;
    if (!S.config.services.length) {
      show(`<div class="warn-banner">${WARN_SVG} No services loaded from Google Sheets. Check Estimator_ServiceMatrix tab.</div>${renderDebug()}`);
      return;
    }
    if (!Object.keys(S.config.modules).length) {
      show(`<div class="warn-banner">${WARN_SVG} No modules loaded from Google Sheets. Check Estimator_Modules tab.</div>${renderDebug()}`);
      return;
    }
    renderSegment();
  } catch(e) {
    show(`<div class="status-msg error-msg">Could not load estimator config: ${esc(e.message)}</div>
      <div style="text-align:center;margin-top:12px"><a href="/api/estimator/health" target="_blank" style="color:var(--accent);font-size:.85rem">Check health endpoint →</a></div>`);
  }
}
init();

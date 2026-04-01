// lib/serviceArea.js
// Vickery Electric — authoritative service-area configuration
// Headquarters: Orange, TX 77630
//
// Tier 1 (CORE)  — instant quote, $0 travel fee
//   Orange, West Orange, Bridge City, Vidor
//
// Tier 2 (EXT)   — instant quote + $25 travel fee
//   Beaumont, Groves, Port Arthur, Nederland
//   NOTE (as of Apr 2026): Rainbow Bridge closure adds ~15 min to Port Arthur /
//   Nederland / Groves routes. Keep EXT but be conservative on scheduling.
//
// Tier 3 (OUTER) — custom quote only, $50 travel fee, $1,000 minimum
//   Lumberton, Silsbee (39–50 min one-way from Orange)
//
// REJECT — beyond 50 minutes one-way, or below OUTER minimums without batching

// ── Zone travel fees ──────────────────────────────────────────────────────────
const ZONE_FEES = { CORE: 0, EXT: 25, OUTER: 50 };

// ── ZIP → zone + drive-time table ─────────────────────────────────────────────
// drive_minutes = estimated one-way from Orange TX HQ (I-10 corridor baseline)
const ZIP_ZONE_MAP = {
  // ── TIER 1 (CORE) ───────────────────────────────────────────────────────────
  "77630": { zone: "CORE", city: "Orange",       drive_minutes: 0  },
  "77631": { zone: "CORE", city: "Orange",       drive_minutes: 0  },
  "77632": { zone: "CORE", city: "Orange",       drive_minutes: 0  },
  "77611": { zone: "CORE", city: "Bridge City",  drive_minutes: 14 },
  "77662": { zone: "CORE", city: "Vidor",        drive_minutes: 23 },
  // West Orange shares the 77630 ZIP with Orange

  // ── TIER 2 (EXT) ────────────────────────────────────────────────────────────
  "77708": { zone: "EXT",  city: "Beaumont",     drive_minutes: 25 },
  "77713": { zone: "EXT",  city: "Beaumont",     drive_minutes: 25 },
  "77701": { zone: "EXT",  city: "Beaumont",     drive_minutes: 27 },
  "77702": { zone: "EXT",  city: "Beaumont",     drive_minutes: 27 },
  "77703": { zone: "EXT",  city: "Beaumont",     drive_minutes: 27 },
  "77704": { zone: "EXT",  city: "Beaumont",     drive_minutes: 27 },
  "77705": { zone: "EXT",  city: "Beaumont",     drive_minutes: 29 },
  "77706": { zone: "EXT",  city: "Beaumont",     drive_minutes: 29 },
  "77707": { zone: "EXT",  city: "Beaumont",     drive_minutes: 29 },
  "77619": { zone: "EXT",  city: "Groves",       drive_minutes: 22 },
  "77640": { zone: "EXT",  city: "Port Arthur",  drive_minutes: 29 },
  "77641": { zone: "EXT",  city: "Port Arthur",  drive_minutes: 29 },
  "77642": { zone: "EXT",  city: "Port Arthur",  drive_minutes: 31 },
  "77643": { zone: "EXT",  city: "Port Arthur",  drive_minutes: 31 },
  "77627": { zone: "EXT",  city: "Nederland",    drive_minutes: 33 },

  // ── TIER 3 (OUTER) ──────────────────────────────────────────────────────────
  "77657": { zone: "OUTER", city: "Lumberton",   drive_minutes: 42 },
  "77656": { zone: "OUTER", city: "Silsbee",     drive_minutes: 45 },
};

// ── City name → zone (fallback when no ZIP provided) ──────────────────────────
const CITY_ZONE_MAP = {
  "orange":       "CORE",
  "west orange":  "CORE",
  "westorange":   "CORE",
  "bridge city":  "CORE",
  "bridgecity":   "CORE",
  "vidor":        "CORE",
  "beaumont":     "EXT",
  "groves":       "EXT",
  "port arthur":  "EXT",
  "portarthur":   "EXT",
  "nederland":    "EXT",
  "lumberton":    "OUTER",
  "silsbee":      "OUTER",
};

// ── Drive-time caps by job class ──────────────────────────────────────────────
// service_call  = diagnostics, small repairs (target 25 min, hard cap 35 min)
// normal_install = standard installs (hard cap 35 min)
// large_install  = clear-scope $5k+ jobs (hard cap 50 min)
const DRIVE_CAPS_MINUTES = {
  service_call:   { target: 25, hard_cap: 35 },
  normal_install: { target: 35, hard_cap: 35 },
  large_install:  { target: 50, hard_cap: 50 },
};

// ── Zone business rules ───────────────────────────────────────────────────────
const ZONE_RULES = {
  CORE: {
    label:             "Tier 1 — Core Service Area",
    instant_pricing:   true,
    travel_fee:        0,
    min_ticket:        0,
    min_ticket_batched: 0,
    approval_note:     null,
    custom_quote_only: false,
  },
  EXT: {
    label:             "Tier 2 — Extended Service Area",
    instant_pricing:   true,
    travel_fee:        25,
    min_ticket:        0,
    min_ticket_batched: 0,
    approval_note:     "A $25 travel fee applies for this location. Pricing shown includes travel.",
    custom_quote_only: false,
  },
  OUTER: {
    label:             "Tier 3 — Outer Zone",
    instant_pricing:   false,
    travel_fee:        50,
    min_ticket:        1000,
    min_ticket_batched: 750,
    approval_note:     "This location requires a custom quote. Minimum job value $1,000 (or $750 if grouped with nearby work or a repeat customer).",
    custom_quote_only: true,
  },
};

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Look up a 5-digit ZIP string. Returns { zone, city, drive_minutes } or null.
 */
function lookupZip(zip) {
  if (!zip) return null;
  const key = String(zip).replace(/\D/g, "").slice(0, 5);
  return ZIP_ZONE_MAP[key] || null;
}

/**
 * Look up a city name (case-insensitive). Returns { zone } or null.
 */
function lookupCity(city) {
  if (!city) return null;
  const key = String(city).trim().toLowerCase().replace(/\s+/g, " ");
  const zone = CITY_ZONE_MAP[key];
  return zone ? { zone } : null;
}

/**
 * Return the ZONE_RULES object for a given zone string. Returns null if unknown.
 */
function getZoneRules(zone) {
  return ZONE_RULES[String(zone || "").toUpperCase()] || null;
}

/**
 * Resolve zone from ZIP (then city as fallback).
 * Returns { zone, rules, drive_minutes, city } or null when out-of-area.
 */
function resolveZone(zip, city) {
  const byZip = lookupZip(zip);
  if (byZip) {
    const rules = getZoneRules(byZip.zone);
    return { zone: byZip.zone, rules, drive_minutes: byZip.drive_minutes, city: byZip.city };
  }
  const byCity = lookupCity(city);
  if (byCity) {
    const rules = getZoneRules(byCity.zone);
    return { zone: byCity.zone, rules, drive_minutes: null, city: String(city || "").trim() };
  }
  return null;
}

/**
 * Determine whether a job should be rejected outright.
 * @param {object} opts
 * @param {string|null} opts.zone             — resolved zone string (CORE/EXT/OUTER/null)
 * @param {number|null} opts.drive_minutes    — estimated one-way drive time
 * @param {number|null} opts.estimated_total  — job estimated total (before travel fee)
 * @param {boolean}     opts.batched          — true if grouped with another nearby job
 * @returns {{ reject: boolean, reason?: string }}
 */
function shouldReject({ zone, drive_minutes, estimated_total, batched }) {
  if (!zone) {
    return { reject: true, reason: "Location is outside our current service area. Please call for a custom quote." };
  }
  const HARD_CAP = 50;
  if (drive_minutes != null && drive_minutes > HARD_CAP) {
    return { reject: true, reason: `Drive time (~${drive_minutes} min) exceeds our ${HARD_CAP}-minute service limit.` };
  }
  if (zone === "OUTER") {
    const minimum = batched ? 750 : 1000;
    if (estimated_total != null && estimated_total < minimum) {
      return {
        reject: true,
        reason: `Jobs in this zone require a minimum of $${minimum}${batched ? " (grouped/batched)" : ""}. This estimate ($${estimated_total}) falls below that threshold.`,
      };
    }
  }
  return { reject: false };
}

/**
 * Build the serviceAreas lookup map expected by quoteEngine.js / quoteEngineV2.js.
 * Merges any rows from the Google Sheet on top of the hardcoded defaults.
 * Sheet rows (if provided) take precedence — useful for one-off overrides.
 * @param {Array<{zip,zone,travel_fee}>} sheetRows — raw rows from ServiceAreas tab (may be [])
 * @returns {{ [zip: string]: { zone: string, travel_fee: number } }}
 */
function buildServiceAreasMap(sheetRows) {
  const map = {};
  // Seed from hardcoded ZIP table
  for (const [zip, entry] of Object.entries(ZIP_ZONE_MAP)) {
    map[zip] = { zone: entry.zone, travel_fee: ZONE_FEES[entry.zone] ?? 0 };
  }
  // Override with any sheet rows (allows per-ZIP travel_fee overrides)
  for (const row of (sheetRows || [])) {
    if (row.zip && row.zone) {
      const z = String(row.zone).toUpperCase().trim();
      map[String(row.zip).trim()] = {
        zone:       z,
        travel_fee: row.travel_fee != null ? Number(row.travel_fee) : (ZONE_FEES[z] ?? 0),
      };
    }
  }
  return map;
}

module.exports = {
  ZONE_FEES,
  ZIP_ZONE_MAP,
  CITY_ZONE_MAP,
  ZONE_RULES,
  DRIVE_CAPS_MINUTES,
  lookupZip,
  lookupCity,
  getZoneRules,
  resolveZone,
  shouldReject,
  buildServiceAreasMap,
};

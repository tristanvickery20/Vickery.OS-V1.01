// lib/quoteEngine.js
// Pure pricing function — no I/O. Takes resolved config objects, returns pricing payload.

const ZONE_FEES = { CORE: 0, EXT: 25, OUTER: 50 };

/**
 * calculateQuote
 * @param {object} jobType     — row from JobTypes (already parsed)
 * @param {object[]} selectedOptions — AnswerOption rows matching answers
 * @param {object[]} selectedAddons  — AddOn rows matching addons
 * @param {object} rates        — Rates row
 * @param {object} serviceAreas — { zip: { zone, travel_fee } }
 * @param {string|null} zip     — optional ZIP to look up travel fee
 * @returns {object}
 */
function calculateQuote({ jobType, selectedOptions, selectedAddons, rates, serviceAreas, zip }) {
  // ── Hours & Fees ──────────────────────────────────────────────────────────
  let hours = Number(jobType.base_hours) || 0;
  let fees = 0;
  let photo_required = jobType.requires_photo === true || jobType.requires_photo === "true";
  let evaluation_flag = false;

  // Apply effects in deterministic order: ADD_HOURS → MULTIPLY_HOURS → ADD_FEE → flags
  for (const o of selectedOptions) {
    if (o.effect_type === "ADD_HOURS") hours += Number(o.effect_value) || 0;
  }
  for (const o of selectedOptions) {
    if (o.effect_type === "MULTIPLY_HOURS") {
      const factor = Number(o.effect_value);
      if (factor > 0) hours *= factor;
    }
  }
  for (const o of selectedOptions) {
    if (o.effect_type === "ADD_FEE") fees += Number(o.effect_value) || 0;
    if (o.effect_type === "REQUIRE_PHOTO") photo_required = true;
    if (o.effect_type === "FLAG_EVALUATION") evaluation_flag = true;
  }

  // ── Add-ons ───────────────────────────────────────────────────────────────
  let materialAllowance = Number(jobType.material_allowance) || 0;
  for (const addon of selectedAddons) {
    hours += Number(addon.add_hours) || 0;
    fees += Number(addon.add_fee) || 0;
    materialAllowance += Number(addon.material_allowance) || 0;
  }

  // ── Core Pricing ──────────────────────────────────────────────────────────
  const rateHourly = Number(rates.crew_loaded_hourly) || 0;
  const rateOverhead = Number(rates.overhead_per_hour) || 0;
  const laborCost = hours * rateHourly;
  const overheadCost = hours * rateOverhead;
  const trueCost = laborCost + overheadCost + materialAllowance + fees;

  const margin = Math.min(0.99, Math.max(0, Number(rates.target_margin) || 0));
  let sellPrice = margin > 0 ? trueCost / (1 - margin) : trueCost;

  // ── Minimums ──────────────────────────────────────────────────────────────
  const serviceMin = Number(rates.service_minimum) || 0;
  const jobMin = Number(jobType.min_price) || 0;
  sellPrice = Math.max(sellPrice, serviceMin, jobMin);

  // ── Travel Fee ────────────────────────────────────────────────────────────
  let travelFee = 0;
  let disclaimer = null;
  let travel_note = null;
  let assumed_commute_minutes = null;
  const address_provided = Boolean(zip && String(zip).trim());

  if (address_provided) {
    const key = String(zip).trim();
    const area = serviceAreas[key];
    if (area) {
      const zone = String(area.zone || "").toUpperCase().trim();
      travelFee = zone in ZONE_FEES ? ZONE_FEES[zone] : (Number(area.travel_fee) || 25);
    } else {
      travelFee = 25;
      travel_note = `ZIP ${key} not in service area table — EXT rate ($25) applied.`;
    }
  } else {
    const disclaimerFee = Number(rates.default_disclaimer_fee) || 25;
    disclaimer = `A $${disclaimerFee} travel fee may be applied once address is confirmed.`;
    assumed_commute_minutes = Number(rates.commute_assumed_minutes) || null;
  }

  sellPrice += travelFee;

  // ── Round to nearest $5 ───────────────────────────────────────────────────
  const final_price = Math.round(sellPrice / 5) * 5;

  const result = {
    final_price,
    hours,
    labor_cost: Math.round(laborCost * 100) / 100,
    overhead_cost: Math.round(overheadCost * 100) / 100,
    material_allowance: Math.round(materialAllowance * 100) / 100,
    fees: Math.round(fees * 100) / 100,
    travel_fee: travelFee,
    address_provided,
    photo_required,
    evaluation_flag,
    pricing_version: String(rates.pricing_version || "1"),
  };

  if (disclaimer) result.disclaimer = disclaimer;
  if (travel_note) result.travel_note = travel_note;
  if (assumed_commute_minutes !== null) result.assumed_commute_minutes = assumed_commute_minutes;

  return result;
}

module.exports = { calculateQuote };

// lib/quoteEngineV2.js
// Pure V2 pricing function — no I/O. Returns the same JSON shape as quoteEngine.js.

const ZONE_FEES = { CORE: 0, EXT: 25, OUTER: 50 };

function n(v) { return Number(v) || 0; }

function parseCrewMix(str) {
  let jw = 1, ap = 0;
  if (str) {
    const jwM = str.match(/(\d+)JW/i);
    const apM = str.match(/(\d+)AP/i);
    if (jwM) jw = Number(jwM[1]);
    if (apM) ap = Number(apM[1]);
  }
  return { jw, ap };
}

function getRiskMultiplier(riskClass, v2Rates) {
  const rc = String(riskClass || "").toLowerCase();
  if (rc === "high") return n(v2Rates.riskHigh)   || 1.25;
  if (rc === "medium" || rc === "med") return n(v2Rates.riskMedium) || 1.10;
  return n(v2Rates.riskLow) || 1.0;
}

function getDriveHours(assembly, v2Rates) {
  const explicit = n(assembly.drive_time_hours);
  if (explicit > 0) return explicit;
  const zone = String(assembly.travel_zone || "").toUpperCase();
  if (zone === "FAR"   || zone === "OUTER") return n(v2Rates.driveTimeFar)   || 1.0;
  if (zone === "MID"   || zone === "EXT")   return n(v2Rates.driveTimeMid)   || 0.5;
  if (zone === "LOCAL" || zone === "CORE")  return n(v2Rates.driveTimeLocal) || 0.25;
  return 0.25;
}

/**
 * calculateQuoteV2
 *
 * @param {object} assembly          — Assemblies row (from V2 sheet)
 * @param {number} qty               — quantity (1–20)
 * @param {object[]} selectedDriverOptions — resolved Driver_Multiplier rows
 * @param {object} v2Data            — { assemblyItemsByAssembly, materialsMap, tasksMap, v2Config, v2Rates, minPrice, minTotal }
 * @param {object} serviceAreas      — { zip: { zone, travel_fee } }
 * @param {string|null} zip
 * @param {number|null} stackCap     — optional combined multiplier ceiling (e.g. 3.5). null = no cap.
 * @returns {object}                 — same keys as calculateQuote() + stack_cap_trace
 */
function calculateQuoteV2({ assembly, qty, selectedDriverOptions, v2Data, serviceAreas, zip, stackCap }) {
  const { assemblyItemsByAssembly, materialsMap, v2Config, v2Rates, minPrice, minTotal } = v2Data;

  qty = Math.max(1, Math.round(Number(qty) || 1));

  // ── 1. Labor hours — compute combined multiplier then apply cap ────────────
  const laborUnit = n(assembly.blended_labor_hours) || n(assembly.baseline_labor_hours);
  let laborHours  = laborUnit * qty;

  // Compute combined driver multiplier (product of all MULTIPLY_HOURS factors)
  let combinedMultiplier = 1.0;
  for (const opt of (selectedDriverOptions || [])) {
    if (opt.effect_type === "MULTIPLY_HOURS") {
      const factor = n(opt.effect_value);
      if (factor > 0) combinedMultiplier *= factor;
    }
  }

  // Apply stack cap if configured
  const uncappedMultiplier = combinedMultiplier;
  let capApplied = false;
  if (stackCap != null && combinedMultiplier > stackCap) {
    console.log(
      `[quoteV2/stackCap] assembly=${assembly.assembly_id} uncapped=${uncappedMultiplier.toFixed(3)} cap=${stackCap} → applying cap`
    );
    combinedMultiplier = stackCap;
    capApplied = true;
  }

  laborHours *= combinedMultiplier;

  // ── 2. Drive hours (not multiplied by qty) ─────────────────────────────────
  const driveHours = getDriveHours(assembly, v2Rates);
  const totalHours = laborHours + driveHours;

  // ── 3. Crew rate ───────────────────────────────────────────────────────────
  const crew             = parseCrewMix(v2Config.defaultLaborMix || "1JW");
  const crewLoadedHourly =
    crew.jw * n(v2Rates.journeymanLaborBurden) +
    crew.ap * n(v2Rates.apprenticeLaborBurden);
  const laborCost = totalHours * crewLoadedHourly;

  // ── 4. Materials (AssemblyItems where item_type = "material") ──────────────
  const items = assemblyItemsByAssembly[assembly.assembly_id] || [];
  let rawMaterialCost = 0;
  for (const item of items) {
    if (String(item.item_type || "").toLowerCase() !== "material") continue;
    const mat = materialsMap[item.item_ref_id];
    if (!mat) continue;
    rawMaterialCost += n(item.qty_per_unit) * qty * n(mat.base_cost);
  }

  const wastePctRaw   = n(v2Config.materialWastePct || "5");
  const wastePct      = wastePctRaw > 1 ? wastePctRaw / 100 : wastePctRaw;
  const markupPct     = n(v2Rates.materialsMarkup || "25") / 100;
  const materialSell  = rawMaterialCost * (1 + wastePct) * (1 + markupPct);

  // ── 5. Overhead (% of cost) ────────────────────────────────────────────────
  const overheadRate = n(v2Rates.overheadRate || "12") / 100;
  const overheadCost = (laborCost + materialSell) * overheadRate;

  // ── 6. Risk ────────────────────────────────────────────────────────────────
  const riskClassMult = getRiskMultiplier(assembly.risk_class, v2Rates);
  const dynamicMult   = n(assembly.dynamic_risk_multiplier) || 1;
  const riskMult      = riskClassMult * dynamicMult;
  const riskCostAdd   = (laborCost + materialSell) * Math.max(0, riskMult - 1);

  // ── 7. Assembly base fee ───────────────────────────────────────────────────
  const baseFee = n(assembly.base_fee);

  // ── 8. True cost → sell price ──────────────────────────────────────────────
  // Bug 7 fix: read targetMargin from sheet config; fall back to 0.30.
  const trueCost     = laborCost + materialSell + overheadCost + riskCostAdd + baseFee;
  const targetMargin = n(v2Config.targetMargin) || n(v2Rates.targetMargin) || 0.30;
  let sellPrice      = targetMargin > 0 ? trueCost / (1 - targetMargin) : trueCost;

  // Minimums
  sellPrice = Math.max(sellPrice, n(minPrice), n(minTotal));

  // ── 9. Travel fee (same logic as V1) ──────────────────────────────────────
  let travelFee         = 0;
  let disclaimer        = null;
  let travel_note       = null;
  const address_provided = Boolean(zip && String(zip).trim());

  if (address_provided) {
    const key  = String(zip).trim();
    const area = serviceAreas[key];
    if (area) {
      const zone = String(area.zone || "").toUpperCase().trim();
      travelFee = zone in ZONE_FEES ? ZONE_FEES[zone] : (Number(area.travel_fee) || 25);
    } else {
      travelFee  = 25;
      travel_note = `ZIP ${key} not in service area table — EXT rate ($25) applied.`;
    }
  } else {
    disclaimer = "A $25 travel fee may be applied once address is confirmed.";
  }

  sellPrice += travelFee;

  // ── 10. Round to nearest $5 ────────────────────────────────────────────────
  const final_price = Math.round(sellPrice / 5) * 5;

  const result = {
    final_price,
    hours:              Math.round(totalHours * 100) / 100,
    labor_cost:         Math.round(laborCost   * 100) / 100,
    overhead_cost:      Math.round(overheadCost * 100) / 100,
    material_allowance: Math.round(materialSell * 100) / 100,
    fees:               Math.round(baseFee      * 100) / 100,
    travel_fee:         travelFee,
    address_provided,
    photo_required:     false,
    evaluation_flag:    false,
    pricing_version:    "v2",
    // ── Stack cap trace (always included for auditability) ──────────────────
    stack_cap_trace: {
      uncapped_multiplier: Math.round(uncappedMultiplier * 1000) / 1000,
      applied_multiplier:  Math.round(combinedMultiplier * 1000) / 1000,
      cap_configured:      stackCap ?? null,
      cap_applied:         capApplied,
    },
  };

  if (disclaimer)  result.disclaimer  = disclaimer;
  if (travel_note) result.travel_note = travel_note;

  return result;
}

module.exports = { calculateQuoteV2 };

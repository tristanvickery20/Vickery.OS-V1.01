// scripts/validate-material-quotes.js
// ─────────────────────────────────────────────────────────────────────────────
// Validates that the quote engine produces non-zero raw_material_cost for key
// assemblies after scripts/seed-material-costs.js has been applied.
//
// The engine returns raw_material_cost (cost basis, before waste/markup) and
// material_allowance (sell price = raw × 1.08 waste × 1.20 markup) directly.
// No back-calculation is needed.
//
// Run: node scripts/validate-material-quotes.js
// ─────────────────────────────────────────────────────────────────────────────
"use strict";

const { getActiveConfig, invalidateV2Cache } = require("../lib/estimatorV2Config");
const { calculateQuoteV2 } = require("../lib/quoteEngineV2");

// ── Pricing constants (from v2Rates / v2Config in the Estimator sheet) ────────
// These must match the values in the sheet; asserted at runtime below.
const EXPECTED_WASTE_PCT   = 8;   // materialWastePct
const EXPECTED_MARKUP_PCT  = 20;  // materialsMarkup

// ── Required focal assemblies (A001/A004/A017/A028 per task spec) ─────────────
const FOCAL_CASES = [
  { id: "A001", name: "Recessed (Can) Lighting",           expectRawGt:  5 },
  { id: "A004", name: "Ceiling Fan Install",               expectRawGt:  1 },
  { id: "A017", name: "Dedicated Circuits",                expectRawGt: 20 },
  { id: "A028", name: "EV Charger Installation",           expectRawGt: 30 },
];

// ── Extended validation set ───────────────────────────────────────────────────
const EXTENDED_CASES = [
  { id: "A006", name: "Motion Sensor Lighting",            expectRawGt: 20 },
  { id: "A008", name: "Dimmer Switch",                     expectRawGt:  5 },
  { id: "A011", name: "New Outlet",                        expectRawGt:  2 },
  { id: "A012", name: "GFCI Outlet",                       expectRawGt:  5 },
  { id: "A013", name: "Switch & Outlet Repair",            expectRawGt:  2 },
  { id: "A019", name: "Service Panel Upgrade",             expectRawGt: 50 },
  { id: "A020", name: "Subpanel Installation",             expectRawGt: 50 },
  { id: "A026", name: "Standby Generator",                 expectRawGt: 50 },
  { id: "A027", name: "Portable Generator Transfer",       expectRawGt: 50 },
];

// ─────────────────────────────────────────────────────────────────────────────

async function run() {
  invalidateV2Cache();
  console.log("Loading fresh V2 config from sheet…");
  const cfg = await getActiveConfig();
  const v2  = cfg._v2;

  // ── Assert pricing constants match sheet ─────────────────────────────────
  const sheetWaste  = parseFloat(v2.v2Config.materialWastePct || "0");
  const sheetMarkup = parseFloat(v2.v2Rates.materialsMarkup   || "0");
  if (sheetWaste !== EXPECTED_WASTE_PCT || sheetMarkup !== EXPECTED_MARKUP_PCT) {
    console.error(
      `ERROR: Expected waste=${EXPECTED_WASTE_PCT}% markup=${EXPECTED_MARKUP_PCT}%` +
      ` but sheet has waste=${sheetWaste}% markup=${sheetMarkup}%`
    );
    process.exit(1);
  }
  console.log(`Pricing constants confirmed: waste=${sheetWaste}%, markup=${sheetMarkup}%`);

  const v2Data = {
    assemblyItemsByAssembly: v2.assemblyItemsByAssembly,
    materialsMap:            v2.materialsMap,
    v2Config:                v2.v2Config,
    v2Rates:                 v2.v2Rates,
    minPrice:                v2.minPrice,
    minTotal:                v2.minTotal,
  };

  const runAssembly = (id) => {
    const assembly = v2.assemblies.find(a => a.assembly_id === id);
    if (!assembly) return null;
    return calculateQuoteV2({
      assembly, qty: 1, selectedDriverOptions: [],
      v2Data, serviceAreas: cfg.serviceAreas, zip: null, stackCap: null,
    });
  };

  // ── Section 1: Focal assemblies — before vs after ─────────────────────────
  // "Before" = what the engine returned when all 40 IDs had base_cost = $0.
  // These values were verified on 2026-03-03 (pre-migration) and are hardcoded
  // here to document the gap that seed-material-costs.js closed.
  const BEFORE_BASELINE = {
    A001: { raw: 0, sell: 0, price: 165 },
    A004: { raw: 0, sell: 0, price: 165 },
    A017: { raw: 0, sell: 0, price: 165 },
    A028: { raw: 0, sell: 0, price: 165 },
  };

  console.log("\n══════════════════════════════════════════════════════════════════");
  console.log(" FOCAL ASSEMBLY VALIDATION — BEFORE vs AFTER (raw_material_cost)");
  console.log("══════════════════════════════════════════════════════════════════");
  console.log(
    " Assembly  Name                           " +
    "  Before_raw  After_raw  After_sell  After_price  Status"
  );
  console.log(" " + "─".repeat(90));

  let focalPass = 0, focalFail = 0;
  for (const tc of FOCAL_CASES) {
    const r = runAssembly(tc.id);
    if (!r) { console.log(` ${tc.id}  NOT FOUND`); focalFail++; continue; }

    const before  = BEFORE_BASELINE[tc.id];
    const rawNow  = r.raw_material_cost;
    const sellNow = r.material_allowance;
    const ok      = rawNow >= tc.expectRawGt;
    ok ? focalPass++ : focalFail++;

    const status = ok
      ? `PASS (raw ≥ $${tc.expectRawGt})`
      : `FAIL — raw $${rawNow} < expected $${tc.expectRawGt}`;

    console.log(
      ` ${tc.id.padEnd(9)} ${tc.name.padEnd(35)}` +
      `  $${String(before.raw).padStart(7)}` +
      `  $${String(rawNow).padStart(8)}` +
      `  $${String(sellNow).padStart(9)}` +
      `  $${String(r.final_price).padStart(10)}` +
      `  ${status}`
    );
  }
  console.log(` Focal: ${focalPass} PASS, ${focalFail} FAIL`);

  // ── Section 2: Extended validation ───────────────────────────────────────
  console.log("\n══════════════════════════════════════════════════════════════════");
  console.log(" EXTENDED ASSEMBLY VALIDATION");
  console.log("══════════════════════════════════════════════════════════════════");
  console.log(` ${"ID".padEnd(8)} ${"Name".padEnd(35)} ${"Labor".padStart(7)} ${"RawMat".padStart(8)} ${"Sell".padStart(6)} ${"Price".padStart(7)}  Status`);
  console.log(" " + "─".repeat(85));

  let extPass = 0, extFail = 0;
  for (const tc of EXTENDED_CASES) {
    const r = runAssembly(tc.id);
    if (!r) { console.log(` ${tc.id}  NOT FOUND`); extFail++; continue; }
    const ok = r.raw_material_cost >= tc.expectRawGt;
    ok ? extPass++ : extFail++;
    console.log(
      ` ${tc.id.padEnd(8)} ${tc.name.padEnd(35)}` +
      ` $${String(r.labor_cost).padStart(6)}` +
      ` $${String(r.raw_material_cost).padStart(7)}` +
      ` $${String(r.material_allowance).padStart(5)}` +
      ` $${String(r.final_price).padStart(6)}` +
      `  ${ok ? "PASS" : `FAIL (expected raw≥$${tc.expectRawGt})`}`
    );
  }
  console.log(` Extended: ${extPass} PASS, ${extFail} FAIL`);

  // ── Section 3: Residential avg ticket ────────────────────────────────────
  // Methodology: equal-weight across 30 active residential assemblies
  // (qty=1, no driver multipliers, no zip), using:
  //   • material_allowance = raw_material_cost × 1.08 (8% waste) × 1.20 (20% markup)
  //   • A015 (whole-house rewire) excluded — custom-quote-only, not in normal mix
  // No booking-frequency weights applied (no real job history yet; revisit after
  // 30+ booked jobs when actual service-mix ratios are available).
  const residential = v2.assemblies.filter(a =>
    a.serviceType === "residential" &&
    String(a.active).toUpperCase() !== "FALSE" &&
    a.assembly_id !== "A015"
  );

  const ticketData = residential.map(asm => {
    const r = runAssembly(asm.assembly_id);
    return {
      id: asm.assembly_id,
      name: asm.niche_name || asm.assembly_id,
      labor:    r ? r.labor_cost         : 0,
      rawMat:   r ? r.raw_material_cost  : 0,
      matSell:  r ? r.material_allowance : 0,
      price:    r ? r.final_price        : 0,
    };
  });

  const avgPrice  = ticketData.reduce((s, t) => s + t.price,   0) / ticketData.length;
  const avgRaw    = ticketData.reduce((s, t) => s + t.rawMat,  0) / ticketData.length;
  const avgSell   = ticketData.reduce((s, t) => s + t.matSell, 0) / ticketData.length;
  const avgLabor  = ticketData.reduce((s, t) => s + t.labor,   0) / ticketData.length;
  const sorted    = [...ticketData].sort((a, b) => a.price - b.price).map(t => t.price);
  const median    = sorted[Math.floor(sorted.length / 2)];

  const BASELINE_AVG    = 241;
  const BASELINE_MEDIAN = 165;

  console.log("\n══════════════════════════════════════════════════════════════════");
  console.log(" RESIDENTIAL AVERAGE TICKET (equal-weight, 30 assemblies)");
  console.log("══════════════════════════════════════════════════════════════════");
  const wasteFactor  = (1 + sheetWaste  / 100).toFixed(2);
  const markupFactor = (1 + sheetMarkup / 100).toFixed(2);
  console.log(` Pricing formula: raw_material_cost × ${wasteFactor} (${sheetWaste}% waste) × ${markupFactor} (${sheetMarkup}% markup) = material_allowance`);
  console.log(` Crew loaded rate: $91/hr (1 JW @ $61 + 1 AP @ $30), overhead ${v2.v2Rates.overheadRate}%`);
  console.log("");
  console.log(`  Avg ticket price:      $${avgPrice.toFixed(0).padStart(6)}`);
  console.log(`  Avg labor cost:        $${avgLabor.toFixed(0).padStart(6)}`);
  console.log(`  Avg material at cost:  $${avgRaw.toFixed(0).padStart(6)}  (raw_material_cost)`);
  console.log(`  Avg material sell:     $${avgSell.toFixed(0).padStart(6)}  (raw × 1.08 × 1.20)`);
  console.log(`  Median ticket:         $${String(median).padStart(6)}`);
  console.log(`  Range: $${sorted[0]} – $${sorted[sorted.length - 1]}`);
  console.log("");
  console.log("  BEFORE (labor-only, all material IDs at base_cost=$0):");
  console.log(`    avg $${BASELINE_AVG}, median $${BASELINE_MEDIAN}`);
  console.log("  AFTER (40 IDs priced, WIR-009/010/011/012/013 unit→100ft):");
  console.log(`    avg $${avgPrice.toFixed(0)}, median $${median}`);
  console.log(`  Delta: avg +$${(avgPrice - BASELINE_AVG).toFixed(0)}, median +$${median - BASELINE_MEDIAN}`);

  // ── Final pass/fail ───────────────────────────────────────────────────────
  const allPass = focalFail === 0 && extFail === 0;
  console.log("\n══════════════════════════════════════════════════════════════════");
  if (allPass) {
    console.log(" ALL CHECKS PASSED — material costs fully validated.");
  } else {
    console.error(` FAILED — ${focalFail + extFail} check(s) did not pass. See above.`);
    process.exit(1);
  }
}

run().catch(e => { console.error("FATAL:", e.message); process.exit(1); });

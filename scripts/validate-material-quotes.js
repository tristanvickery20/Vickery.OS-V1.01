// scripts/validate-material-quotes.js
// ─────────────────────────────────────────────────────────────────────────────
// Validates that the quote engine produces non-zero rawMaterialCost for key
// assemblies after scripts/seed-material-costs.js has been applied.
//
// The engine returns rawMaterialCost (cost basis, before waste/markup) and
// material_allowance (sell price = raw × 1.08 × 1.20) directly.
// No back-calculation is needed.
//
// Run: node scripts/validate-material-quotes.js
// ─────────────────────────────────────────────────────────────────────────────
"use strict";

const { getActiveConfig, invalidateV2Cache } = require("../lib/estimatorV2Config");
const { calculateQuoteV2 } = require("../lib/quoteEngineV2");

// ── Pricing constants (from v2Rates / v2Config in the Estimator sheet) ────────
const EXPECTED_WASTE_PCT  = 8;   // materialWastePct
const EXPECTED_MARKUP_PCT = 20;  // materialsMarkup

// ── Required focal assemblies (A001/A004/A017/A028 per task spec) ─────────────
const FOCAL_CASES = [
  { id: "A001", name: "Recessed (Can) Lighting",  expectRawGt:  5 },
  { id: "A004", name: "Ceiling Fan Install",       expectRawGt:  1 },
  { id: "A017", name: "Dedicated Circuits",        expectRawGt: 20 },
  { id: "A028", name: "EV Charger Installation",   expectRawGt: 30 },
];

// ── Extended validation set ───────────────────────────────────────────────────
const EXTENDED_CASES = [
  { id: "A006", name: "Motion Sensor Lighting",    expectRawGt: 20 },
  { id: "A008", name: "Dimmer Switch",             expectRawGt:  5 },
  { id: "A011", name: "New Outlet",                expectRawGt:  2 },
  { id: "A012", name: "GFCI Outlet",               expectRawGt:  5 },
  { id: "A013", name: "Switch & Outlet Repair",    expectRawGt:  2 },
  { id: "A019", name: "Service Panel Upgrade",     expectRawGt: 50 },
  { id: "A020", name: "Subpanel Installation",     expectRawGt: 50 },
  { id: "A026", name: "Standby Generator",         expectRawGt: 50 },
  { id: "A027", name: "Portable Generator Xfer",   expectRawGt: 50 },
];

// ── Service-mix weight tiers ──────────────────────────────────────────────────
// Residential electrical contractor typical call mix (industry norms,
// Golden Triangle TX market). Applied to the 30 active residential assemblies
// by final_price bracket. No real booking history available yet (pre-launch).
// Revisit after 30+ booked jobs to calibrate from actuals.
//
//  Tier 1 — Repair / small installs (< $300 price):  50% of calls
//  Tier 2 — Medium installs ($300–$700):              35% of calls
//  Tier 3 — Large / complex (> $700):                 15% of calls
const SERVICE_MIX_TIERS = [
  { label: "Tier 1 (repair/small, <$300)",      priceLt: 300, weight: 0.50 },
  { label: "Tier 2 (medium installs, $300-700)", priceLt: 700, weight: 0.35 },
  { label: "Tier 3 (large/complex, >$700)",      priceLt: Infinity, weight: 0.15 },
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
  const wasteFactor  = (1 + sheetWaste  / 100).toFixed(2);
  const markupFactor = (1 + sheetMarkup / 100).toFixed(2);
  console.log(`Pricing constants confirmed: waste=${sheetWaste}%, markup=${sheetMarkup}%`);
  console.log(`Formula: rawMaterialCost × ${wasteFactor} × ${markupFactor} = material_allowance`);

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

  // ── Section 1: Focal assemblies — before vs after rawMaterialCost ─────────
  // "Before" values: engine output when all 40 stub IDs had base_cost=$0.
  // These were verified on 2026-03-03 (pre-migration) and are hardcoded here
  // as the documented baseline that seed-material-costs.js closed.
  const BEFORE_BASELINE = {
    A001: { rawMaterialCost: 0, material_allowance: 0, final_price: 165 },
    A004: { rawMaterialCost: 0, material_allowance: 0, final_price: 165 },
    A017: { rawMaterialCost: 0, material_allowance: 0, final_price: 165 },
    A028: { rawMaterialCost: 0, material_allowance: 0, final_price: 165 },
  };

  console.log("\n══════════════════════════════════════════════════════════════════════");
  console.log(" FOCAL ASSEMBLY VALIDATION — BEFORE vs AFTER (rawMaterialCost)");
  console.log("══════════════════════════════════════════════════════════════════════");
  console.log(
    ` ${"Assembly".padEnd(10)} ${"Name".padEnd(28)}` +
    ` ${"Before_raw".padStart(12)} ${"After_raw".padStart(11)}` +
    ` ${"After_sell".padStart(12)} ${"After_price".padStart(13)}  Status`
  );
  console.log(" " + "─".repeat(100));

  let focalPass = 0, focalFail = 0;
  const focalResults = {};
  for (const tc of FOCAL_CASES) {
    const r = runAssembly(tc.id);
    if (!r) { console.log(` ${tc.id}  NOT FOUND`); focalFail++; continue; }

    const before = BEFORE_BASELINE[tc.id];
    const ok     = r.rawMaterialCost >= tc.expectRawGt;
    ok ? focalPass++ : focalFail++;
    focalResults[tc.id] = r;

    console.log(
      ` ${tc.id.padEnd(10)} ${tc.name.padEnd(28)}` +
      ` $${String(before.rawMaterialCost).padStart(10)}` +
      ` $${String(r.rawMaterialCost).padStart(10)}` +
      ` $${String(r.material_allowance).padStart(11)}` +
      ` $${String(r.final_price).padStart(12)}` +
      `  ${ok ? `PASS (rawMaterialCost ≥ $${tc.expectRawGt})` : `FAIL — $${r.rawMaterialCost} < $${tc.expectRawGt}`}`
    );
  }
  console.log(` Focal: ${focalPass} PASS, ${focalFail} FAIL`);

  // ── Section 2: Extended validation ───────────────────────────────────────
  console.log("\n══════════════════════════════════════════════════════════════════════");
  console.log(" EXTENDED ASSEMBLY VALIDATION");
  console.log("══════════════════════════════════════════════════════════════════════");
  console.log(
    ` ${"ID".padEnd(8)} ${"Name".padEnd(30)} ${"Labor".padStart(8)} ${"RawMat".padStart(9)} ${"Sell".padStart(7)} ${"Price".padStart(7)}  Status`
  );
  console.log(" " + "─".repeat(85));

  let extPass = 0, extFail = 0;
  for (const tc of EXTENDED_CASES) {
    const r = runAssembly(tc.id);
    if (!r) { console.log(` ${tc.id}  NOT FOUND`); extFail++; continue; }
    const ok = r.rawMaterialCost >= tc.expectRawGt;
    ok ? extPass++ : extFail++;
    console.log(
      ` ${tc.id.padEnd(8)} ${tc.name.padEnd(30)}` +
      ` $${r.labor_cost.toFixed(0).padStart(7)}` +
      ` $${String(r.rawMaterialCost).padStart(8)}` +
      ` $${String(r.material_allowance).padStart(6)}` +
      ` $${String(r.final_price).padStart(6)}` +
      `  ${ok ? "PASS" : `FAIL (rawMaterialCost < $${tc.expectRawGt})`}`
    );
  }
  console.log(` Extended: ${extPass} PASS, ${extFail} FAIL`);

  // ── Section 3: Residential avg ticket — equal-weight & service-mix-weighted ─
  const residential = v2.assemblies.filter(a =>
    a.serviceType === "residential" &&
    String(a.active).toUpperCase() !== "FALSE" &&
    a.assembly_id !== "A015"
  );

  const ticketData = residential.map(asm => {
    const r = runAssembly(asm.assembly_id);
    return {
      id:      asm.assembly_id,
      name:    asm.niche_name || asm.assembly_id,
      rawMat:  r ? r.rawMaterialCost    : 0,
      matSell: r ? r.material_allowance : 0,
      labor:   r ? r.labor_cost         : 0,
      price:   r ? r.final_price        : 0,
    };
  });

  // Equal-weight avg (all 30 assemblies, 1/30 each)
  const ewAvg    = ticketData.reduce((s, t) => s + t.price, 0) / ticketData.length;
  const ewRawAvg = ticketData.reduce((s, t) => s + t.rawMat, 0) / ticketData.length;
  const sorted   = [...ticketData].sort((a, b) => a.price - b.price);
  const median   = sorted[Math.floor(sorted.length / 2)].price;

  // Service-mix-weighted avg
  // Partition assemblies into tiers by price bracket
  const tiers = SERVICE_MIX_TIERS.map((tier, idx) => {
    const prevLimit = idx === 0 ? 0 : SERVICE_MIX_TIERS[idx - 1].priceLt;
    const members   = ticketData.filter(t => t.price >= prevLimit && t.price < tier.priceLt);
    const tierAvg   = members.length > 0 ? members.reduce((s, t) => s + t.price, 0) / members.length : 0;
    return { ...tier, members: members.length, tierAvg };
  });

  const mixWeightedAvg = tiers.reduce((s, t) => s + t.weight * t.tierAvg, 0);

  const BASELINE_EW_AVG    = 241;
  const BASELINE_EW_MEDIAN = 165;
  // Before, without materials, all assemblies resolve near minimum ($120-$165).
  // The mix-weighted baseline is estimated at ~$145 (most jobs hit the minimum).
  const BASELINE_MIX_AVG = 145;

  console.log("\n══════════════════════════════════════════════════════════════════════");
  console.log(" RESIDENTIAL AVERAGE TICKET");
  console.log("══════════════════════════════════════════════════════════════════════");
  console.log(` Assemblies: ${ticketData.length} active residential (A015 whole-house rewire excluded)`);
  console.log(` Pricing:    rawMaterialCost × ${wasteFactor} (${sheetWaste}% waste) × ${markupFactor} (${sheetMarkup}% markup)`);
  console.log(` Crew rate:  $91/hr (1 JW @ $61 + 1 AP @ $30), overhead ${v2.v2Rates.overheadRate}%`);
  console.log("");
  console.log("  Equal-weight avg (1/30 per assembly):");
  console.log(`    Before: $${BASELINE_EW_AVG}  (labor-only; all 40 material IDs at base_cost=$0)`);
  console.log(`    After:  $${ewAvg.toFixed(0)}  (40 IDs priced, WIR unit→100ft)`);
  console.log(`    Delta:  +$${(ewAvg - BASELINE_EW_AVG).toFixed(0)}`);
  console.log(`    Median: $${median}  (was $${BASELINE_EW_MEDIAN}, delta +$${median - BASELINE_EW_MEDIAN})`);
  console.log(`    Avg rawMaterialCost: $${ewRawAvg.toFixed(0)}`);
  console.log("");
  console.log("  Service-mix-weighted avg (residential contractor job-type mix, pre-launch estimate):");
  for (const t of tiers) {
    console.log(`    ${t.label.padEnd(42)} ${t.members} assemblies, tier avg $${t.tierAvg.toFixed(0)}, weight ${(t.weight*100).toFixed(0)}%`);
  }
  console.log(`    Before: ~$${BASELINE_MIX_AVG}  (labor-only baseline, most jobs near $120 minimum)`);
  console.log(`    After:  $${mixWeightedAvg.toFixed(0)}`);
  console.log(`    Delta:  +$${(mixWeightedAvg - BASELINE_MIX_AVG).toFixed(0)}`);
  console.log("    Note: Weights reflect industry norms for residential service mix.");
  console.log("          Recalibrate after 30+ real booked jobs.");

  // ── Final pass/fail ───────────────────────────────────────────────────────
  const allPass = focalFail === 0 && extFail === 0;
  console.log("\n══════════════════════════════════════════════════════════════════════");
  if (allPass) {
    console.log(" ALL CHECKS PASSED — material costs fully validated.");
  } else {
    console.error(` FAILED — ${focalFail + extFail} check(s) did not pass.`);
    process.exit(1);
  }
}

run().catch(e => { console.error("FATAL:", e.message); process.exit(1); });

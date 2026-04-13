// scripts/validate-material-quotes.js
// ─────────────────────────────────────────────────────────────────────────────
// Validates that the quote engine produces accurate material cost estimates
// for a representative set of assemblies after seed-material-costs.js is run.
//
// Before seed-material-costs.js:  rawMaterialCost = $0 for all 56 assemblies
// After  seed-material-costs.js:  all assemblies produce non-zero material cost
//                                  (except jobs where every material item is
//                                   customer-supplied, e.g. A009 fixture repair)
//
// Run: node scripts/validate-material-quotes.js
// ─────────────────────────────────────────────────────────────────────────────
"use strict";

const { getActiveConfig, invalidateV2Cache } = require("../lib/estimatorV2Config");
const { calculateQuoteV2 } = require("../lib/quoteEngineV2");

// Assemblies to validate and their expected behavior
const TEST_CASES = [
  // Small residential — expect modest material cost ($5–$50 sell price)
  { id: "A001", name: "Recessed Lighting",               expectMatGt: 10 },
  { id: "A004", name: "Ceiling Fan (fan is cust-suppl)", expectMatGt:  1 },
  { id: "A008", name: "Dimmer Switch",                   expectMatGt:  5 },
  { id: "A011", name: "New Outlet",                      expectMatGt:  5 },
  { id: "A012", name: "GFCI Outlet",                     expectMatGt:  5 },
  // Medium residential — panel and wiring — expect significant material cost
  { id: "A017", name: "Dedicated Circuits",              expectMatGt: 20 },
  { id: "A019", name: "Service Panel Upgrade",           expectMatGt: 50 },
  { id: "A020", name: "Subpanel Installation",           expectMatGt: 50 },
  { id: "A028", name: "EV Charger",                      expectMatGt: 30 },
  // Generator jobs (TMP-005/011 items)
  { id: "A026", name: "Standby Generator",               expectMatGt: 50 },
  { id: "A027", name: "Portable Generator Transfer",     expectMatGt: 50 },
  // Data / low-voltage (WIR-013 Cat6)
  { id: "A013", name: "Switch & Outlet Repair",          expectMatGt:  2 },
  // Outdoor / security lighting (LGT-008 flood light)
  { id: "A006", name: "Motion Sensor Lighting",          expectMatGt: 20 },
];

async function run() {
  invalidateV2Cache();
  console.log("Loading fresh V2 config from sheet…");
  const cfg = await getActiveConfig();
  const v2  = cfg._v2;

  const v2Data = {
    assemblyItemsByAssembly: v2.assemblyItemsByAssembly,
    materialsMap:            v2.materialsMap,
    v2Config:                v2.v2Config,
    v2Rates:                 v2.v2Rates,
    minPrice:                v2.minPrice,
    minTotal:                v2.minTotal,
  };

  const wastePct  = parseFloat(v2.v2Config.materialWastePct || "5") / 100;
  const markupPct = parseFloat(v2.v2Rates.materialsMarkup   || "25") / 100;

  console.log(`\n${"Assembly".padEnd(8)} ${"Name".padEnd(36)} ${"Labor".padStart(7)} ${"RawMat".padStart(8)} ${"MatSell".padStart(9)} ${"Price".padStart(8)}  Status`);
  console.log("─".repeat(90));

  let allPass = true;
  const results = [];

  for (const tc of TEST_CASES) {
    const assembly = v2.assemblies.find(a => a.assembly_id === tc.id);
    if (!assembly) {
      console.log(`${tc.id}  NOT FOUND IN ASSEMBLIES TAB`);
      allPass = false;
      continue;
    }

    const r = calculateQuoteV2({
      assembly,
      qty: 1,
      selectedDriverOptions: [],
      v2Data,
      serviceAreas: cfg.serviceAreas,
      zip: null,
      stackCap: null,
    });

    // rawMat = reverse of materialSell formula
    const rawMat = r.material_allowance / ((1 + wastePct) * (1 + markupPct));
    const pass   = r.material_allowance >= tc.expectMatGt;
    if (!pass) allPass = false;

    results.push({ ...tc, labor: r.labor_cost, rawMat, matSell: r.material_allowance, price: r.final_price, pass });

    const status = pass ? "PASS" : `FAIL (expected matSell ≥ $${tc.expectMatGt}, got $${r.material_allowance.toFixed(2)})`;
    console.log(
      `${tc.id.padEnd(8)} ${tc.name.padEnd(36)} ` +
      `$${r.labor_cost.toFixed(0).padStart(6)} ` +
      `$${rawMat.toFixed(0).padStart(7)} ` +
      `$${r.material_allowance.toFixed(0).padStart(8)} ` +
      `$${r.final_price.toString().padStart(7)}  ${status}`
    );
  }

  // ── Residential avg ticket across all 30 active non-rewire assemblies ──────
  const residential = v2.assemblies.filter(a =>
    a.serviceType === "residential" &&
    String(a.active).toUpperCase() !== "FALSE" &&
    a.assembly_id !== "A015"
  );

  const prices = [];
  for (const asm of residential) {
    const r = calculateQuoteV2({
      assembly: asm, qty: 1, selectedDriverOptions: [],
      v2Data, serviceAreas: cfg.serviceAreas, zip: null, stackCap: null,
    });
    prices.push(r.final_price);
  }
  const avg    = prices.reduce((s, p) => s + p, 0) / prices.length;
  const sorted = [...prices].sort((a, b) => a - b);
  const median = sorted[Math.floor(sorted.length / 2)];

  console.log("\n" + "─".repeat(90));
  console.log(`Residential average ticket (${residential.length} assemblies, equal weight): $${avg.toFixed(0)}`);
  console.log(`Residential median  ticket:  $${median}`);
  console.log(`Range: $${sorted[0]} – $${sorted[sorted.length - 1]}`);
  console.log("\nBaseline before material costs were mapped: avg $241, median $165 (labor-only)");
  console.log(`Delta: avg +$${(avg - 241).toFixed(0)}, median +$${median - 165}`);

  console.log("\n" + "─".repeat(90));
  if (allPass) {
    console.log("All validation checks PASSED.");
  } else {
    console.error("One or more validation checks FAILED — see above.");
    process.exit(1);
  }
}

run().catch(e => { console.error("FATAL:", e.message); process.exit(1); });

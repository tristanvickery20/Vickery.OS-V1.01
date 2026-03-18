#!/usr/bin/env node
// scripts/qa-golden.js — Bug 9: Golden QA cases for estimator engine
//
// Run: node scripts/qa-golden.js
// Requires: ESTIMATOR_V2_SHEET_ID and GOOGLE_SERVICE_ACCOUNT_JSON env vars.
//
// Tests CEILING_FAN_INSTALL, LIGHT_FIXTURE_INSTALL, RECESSED_LIGHTING,
//       OUTLET_INSTALL, GFCI_OUTLET, SURGE_PROTECTOR
// Each service has: easy, harder, and disqualify cases.

"use strict";

const { evaluateService, computePrice, getBasePrice } = require("../lib/estimatorEngine");
const { getEstimatorConfig } = require("../lib/estimatorModulesConfig");

const SEP  = "─".repeat(70);
const SEP2 = "═".repeat(70);

// ── Test case definitions ─────────────────────────────────────────────────────
const CASES = [
  // ── CEILING_FAN_INSTALL ─────────────────────────────────────────────────────
  {
    service_id:   "CEILING_FAN_INSTALL",
    label:        "Easy — standard 8ft ceiling, existing box, 1 fan",
    qty:          1,
    answers:      { CEILING_HEIGHT: "8_9", EXISTING_BOX: "yes", UNCERTAINTY_BUFFER: "simple" },
    expectBlock:  false,
  },
  {
    service_id:   "CEILING_FAN_INSTALL",
    label:        "Harder — 9–12ft ceiling, no existing box, 2 fans",
    qty:          2,
    answers:      { CEILING_HEIGHT: "9_12", EXISTING_BOX: "no", UNCERTAINTY_BUFFER: "moderate" },
    expectBlock:  false,
  },
  {
    service_id:   "CEILING_FAN_INSTALL",
    label:        "Disqualify — ceiling > 20ft",
    qty:          1,
    answers:      { CEILING_HEIGHT: "gt20", EXISTING_BOX: "yes" },
    expectBlock:  true,
  },

  // ── LIGHT_FIXTURE_INSTALL ───────────────────────────────────────────────────
  {
    service_id:   "LIGHT_FIXTURE_INSTALL",
    label:        "Easy — 8ft ceiling, existing box, 1 fixture",
    qty:          1,
    answers:      { CEILING_HEIGHT: "8_9", EXISTING_BOX: "yes", UNCERTAINTY_BUFFER: "simple" },
    expectBlock:  false,
  },
  {
    service_id:   "LIGHT_FIXTURE_INSTALL",
    label:        "Harder — 9–12ft, no existing box, 3 fixtures",
    qty:          3,
    answers:      { CEILING_HEIGHT: "9_12", EXISTING_BOX: "no", UNCERTAINTY_BUFFER: "moderate" },
    expectBlock:  false,
  },
  {
    service_id:   "LIGHT_FIXTURE_INSTALL",
    label:        "Disqualify — brick wall",
    qty:          1,
    answers:      { CEILING_HEIGHT: "8_9", WALL_TYPE: "brick" },
    expectBlock:  true,
  },

  // ── RECESSED_LIGHTING ───────────────────────────────────────────────────────
  {
    service_id:   "RECESSED_LIGHTING",
    label:        "Easy — standard ceiling, no insulation, 4 cans",
    qty:          4,
    answers:      { CEILING_HEIGHT: "8_9", RECESSED_LIGHT_INSULATION: "no", UNCERTAINTY_BUFFER: "simple" },
    expectBlock:  false,
  },
  {
    service_id:   "RECESSED_LIGHTING",
    label:        "Harder — 9–12ft ceiling, insulated, 8 cans",
    qty:          8,
    answers:      { CEILING_HEIGHT: "9_12", RECESSED_LIGHT_INSULATION: "yes", UNCERTAINTY_BUFFER: "complex" },
    expectBlock:  false,
  },
  {
    service_id:   "RECESSED_LIGHTING",
    label:        "Disqualify — ceiling over 20ft",
    qty:          6,
    answers:      { CEILING_HEIGHT: "gt20" },
    expectBlock:  true,
  },

  // ── OUTLET_INSTALL ──────────────────────────────────────────────────────────
  {
    service_id:   "OUTLET_INSTALL",
    label:        "Easy — standard location, drywall, 1 outlet",
    qty:          1,
    answers:      { OUTLET_LOCATION_TYPE: "standard", WALL_TYPE: "drywall", UNCERTAINTY_BUFFER: "simple" },
    expectBlock:  false,
  },
  {
    service_id:   "OUTLET_INSTALL",
    label:        "Harder — bathroom GFCI zone, 2 outlets",
    qty:          2,
    answers:      { OUTLET_LOCATION_TYPE: "bath", WALL_TYPE: "drywall", UNCERTAINTY_BUFFER: "moderate" },
    expectBlock:  false,
  },
  {
    service_id:   "OUTLET_INSTALL",
    label:        "Disqualify — brick wall",
    qty:          1,
    answers:      { OUTLET_LOCATION_TYPE: "standard", WALL_TYPE: "brick" },
    expectBlock:  true,
  },

  // ── GFCI_OUTLET ─────────────────────────────────────────────────────────────
  {
    service_id:   "GFCI_OUTLET",
    label:        "Easy — drywall, 1 GFCI",
    qty:          1,
    answers:      { WALL_TYPE: "drywall", UNCERTAINTY_BUFFER: "simple" },
    expectBlock:  false,
  },
  {
    service_id:   "GFCI_OUTLET",
    label:        "Harder — 3 GFCIs, moderate buffer",
    qty:          3,
    answers:      { WALL_TYPE: "drywall", UNCERTAINTY_BUFFER: "moderate" },
    expectBlock:  false,
  },
  {
    service_id:   "GFCI_OUTLET",
    label:        "Disqualify — brick wall",
    qty:          1,
    answers:      { WALL_TYPE: "brick" },
    expectBlock:  true,
  },

  // ── SURGE_PROTECTOR ─────────────────────────────────────────────────────────
  {
    service_id:   "SURGE_PROTECTOR",
    label:        "Easy — panel has space, 1 unit",
    qty:          1,
    answers:      { PANEL_SPACE: "yes", UNCERTAINTY_BUFFER: "simple" },
    expectBlock:  false,
  },
  {
    service_id:   "SURGE_PROTECTOR",
    label:        "Harder — panel has space, complex buffer",
    qty:          1,
    answers:      { PANEL_SPACE: "yes", UNCERTAINTY_BUFFER: "complex" },
    expectBlock:  false,
  },
  {
    service_id:   "SURGE_PROTECTOR",
    label:        "No-space — panel full (should NOT disqualify for SURGE_PROTECTOR)",
    qty:          1,
    answers:      { PANEL_SPACE: "no" },
    expectBlock:  false,
  },
];

// ── Runner ────────────────────────────────────────────────────────────────────
async function runCase(tc, raw) {
  const service = (raw.services || []).find(s => s.service_id === tc.service_id);
  if (!service) {
    return { ...tc, error: `Service ${tc.service_id} not found in sheet` };
  }

  const eval_ = evaluateService(raw.modulesById, service, tc.answers, 0 /* photoCount */);
  const { tier_result, reasons, risk_multiplier, contingency_pct, photo_warning } = eval_;

  const blocked  = tier_result === "needs_site_visit";
  const passGate = blocked === tc.expectBlock;

  let basePrice = 0, priceSource = "n/a", debugDrivers = [], stackCapTrace = null;
  if (!blocked) {
    const bp = await getBasePrice(
      tc.service_id, service.service_name, tc.qty,
      tc.answers, raw.modulesById, service.modules_csv
    );
    basePrice    = bp.final_price;
    priceSource  = bp.source;
    debugDrivers = bp.debug_drivers || [];
    stackCapTrace = bp.classification_trace;
  }

  const { subtotal, total } = computePrice(basePrice, risk_multiplier, contingency_pct);

  return {
    service_id:    tc.service_id,
    label:         tc.label,
    qty:           tc.qty,
    tier_result,
    blocked,
    expectBlock:   tc.expectBlock,
    passGate,
    risk_multiplier,
    contingency_pct,
    photo_warning,
    base_price:    basePrice,
    subtotal,
    total,
    price_source:  priceSource,
    drivers:       debugDrivers,
    reasons,
    stack_cap:     stackCapTrace,
  };
}

function printCase(r, idx) {
  const status = r.error       ? "  ERROR   "
               : !r.passGate   ? "  FAIL    "
               : r.blocked     ? "  BLOCKED "
               : "  PASS    ";

  console.log(`\n${SEP}`);
  console.log(`${status} [${idx + 1}] ${r.service_id} — ${r.label}`);
  console.log(`  Tier: ${r.tier_result}  |  Expected blocked: ${r.expectBlock}  |  Actual blocked: ${r.blocked}  → ${r.passGate ? "✓ OK" : "✗ MISMATCH"}`);

  if (r.error) {
    console.log(`  ERROR: ${r.error}`);
    return;
  }

  if (!r.blocked) {
    console.log(`  Price source: ${r.price_source}  |  Qty: ${r.qty}`);
    console.log(`  Base: $${r.base_price}  Subtotal: $${r.subtotal}  Total: $${r.total}`);
    console.log(`  Risk mult: ${r.risk_multiplier}  Contingency: ${Math.round(r.contingency_pct * 100)}%`);
    if (r.drivers.length) {
      console.log(`  Multiplier path: ${r.drivers.join(" → ")}`);
    } else {
      console.log(`  Multiplier path: (baseline — no modifiers)`);
    }
    if (r.stack_cap?.cap_applied) {
      console.log(`  ⚠ Stack cap applied: uncapped=${r.stack_cap.uncapped_multiplier} → capped=${r.stack_cap.capped_multiplier}`);
    }
  } else {
    console.log(`  Block reasons:`);
    for (const reason of r.reasons) console.log(`    • ${reason}`);
  }

  if (r.photo_warning) console.log(`  📷 photo_warning=true`);
}

async function main() {
  console.log(`\n${SEP2}`);
  console.log(`  VICKERY ELECTRIC — ESTIMATOR GOLDEN QA`);
  console.log(`  ${new Date().toISOString()}`);
  console.log(SEP2);

  let raw;
  try {
    raw = await getEstimatorConfig();
    console.log(`\n  Config loaded: ${raw.updatedAt}  Services: ${raw.services?.length}`);
  } catch (err) {
    console.error("\n  FATAL: Could not load estimator config:", err.message);
    console.error("  Ensure ESTIMATOR_V2_SHEET_ID and GOOGLE_SERVICE_ACCOUNT_JSON are set.");
    process.exit(1);
  }

  const results = [];
  for (const tc of CASES) {
    try {
      const r = await runCase(tc, raw);
      results.push(r);
      printCase(r, results.length - 1);
    } catch (err) {
      const r = { ...tc, error: err.message, passGate: false, blocked: false };
      results.push(r);
      printCase(r, results.length - 1);
    }
  }

  // Summary
  const pass    = results.filter(r => r.passGate).length;
  const fail    = results.filter(r => !r.passGate).length;
  const priced  = results.filter(r => r.passGate && !r.blocked && r.total > 0);

  console.log(`\n${SEP2}`);
  console.log(`  SUMMARY`);
  console.log(`  Total cases: ${results.length}  |  Pass: ${pass}  |  Fail: ${fail}`);
  console.log(`\n  Priced cases:`);
  for (const r of priced) {
    console.log(`    ${r.service_id.padEnd(25)} qty=${r.qty}  total=$${r.total}  src=${r.price_source}  buf=${Math.round(r.contingency_pct*100)}%`);
  }
  console.log(`\n  Blocked cases:`);
  for (const r of results.filter(r => r.blocked)) {
    console.log(`    ${r.service_id.padEnd(25)} ${r.label}`);
  }
  console.log(SEP2 + "\n");

  if (fail > 0) process.exit(1);
}

main().catch(err => { console.error(err); process.exit(1); });

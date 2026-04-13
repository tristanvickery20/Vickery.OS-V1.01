// scripts/seed-material-costs.js
// ─────────────────────────────────────────────────────────────────────────────
// One-time (idempotent) migration: assigns real base_cost values and corrects
// units for all 40 zero-cost material IDs in the Estimator "Materials" tab.
//
// Context
// ───────
// When the Materials tab was auto-populated from AssemblyItems, 40 of 43 unique
// material IDs were created with base_cost = $0 (stub rows). This script sets
// real Elliott Electric Supply reference prices (Golden Triangle TX, April 2026)
// so the quote engine produces accurate material cost estimates.
//
// WIR unit correction
// ───────────────────
// WIR-009 – WIR-013 originally had unit = "ea". AssemblyItems uses a 100 ft
// scale (qty_per_unit 0.1 = 10 ft, qty 4 = 400 ft, etc.). Unit is corrected
// to "100ft" and base_cost is set per 100 ft accordingly. The engine formula
// (qty_per_unit × qty × base_cost) then yields the correct dollar contribution
// without any code change — the unit field is documentation only.
//
// Customer-supplied materials
// ───────────────────────────
// Nine IDs get a realistic reference price here so we have a documented cost
// basis, but are added to lib/flaggedMaterials.js so the engine prices them
// at $0 (installer charges labor only; customer supplies the product).
//   LGT-007 LGT-013 LGT-018 LGT-021 LGT-027 LGT-036 CTL-001 CTL-002 DEV-014
//
// Run
// ───
//   node scripts/seed-material-costs.js
// The script is idempotent — re-running overwrites with the same values.
// ─────────────────────────────────────────────────────────────────────────────
"use strict";

const { getSheetsClient } = require("../lib/sheets");

const SHEET_ID = process.env.ESTIMATOR_V2_SHEET_ID;
if (!SHEET_ID) { console.error("ESTIMATOR_V2_SHEET_ID env var not set"); process.exit(1); }

// ── Price table ───────────────────────────────────────────────────────────────
// Each entry: { cost, unit, note }
// cost  = base_cost in the unit shown
// unit  = the unit stored in the Materials tab
// note  = human-readable note for the Notes column
const MATERIAL_PRICES = {
  // ── Boxes ──────────────────────────────────────────────────────────────────
  "BOX-003": { cost:  15.00, unit: "ea",    note: "Wiremold 500-series surface raceway box" },
  "BOX-004": { cost:   3.00, unit: "ea",    note: "Low-voltage mounting bracket / wall-plate ring" },
  "BOX-006": { cost:   8.50, unit: "ea",    note: "1-gang weatherproof outdoor box with in-use cover" },
  "BOX-007": { cost:   3.50, unit: "ea",    note: "Standard old-work 1-gang device box" },

  // ── Conduit ────────────────────────────────────────────────────────────────
  "CON-005": { cost:   1.25, unit: "ea",    note: "EMT ½\" set-screw coupling" },
  "CON-007": { cost:  10.00, unit: "ea",    note: "EMT ½\" conduit, 10 ft stick" },

  // ── Connectors & consumables ───────────────────────────────────────────────
  "CONN-001":{ cost:   0.15, unit: "ea",    note: "Wire nut — per connector; qty_per_unit is allowance count" },
  "MSC-001": { cost:   3.00, unit: "roll",  note: "Electrical tape roll; qty_per_unit is fraction of roll used" },

  // ── Devices — installer-supplied ───────────────────────────────────────────
  "DEV-008": { cost:  45.00, unit: "ea",    note: "NEMA 14-50 EV outlet/inlet (installer supplies)" },
  "DEV-009": { cost:  12.00, unit: "ea",    note: "Range/appliance receptacle (NEMA 14-30 or 10-30)" },
  "DEV-017": { cost:  22.00, unit: "ea",    note: "LED/CFL dimmer switch (Leviton / Lutron standard grade)" },
  "DEV-020": { cost:   4.00, unit: "ea",    note: "Detector junction cover plate" },
  "DEV-021": { cost:   3.50, unit: "ea",    note: "15A TR duplex receptacle, white" },
  "DEV-023": { cost:   8.00, unit: "ea",    note: "Single-pole switch (fan/light control)" },
  "DEV-024": { cost:  22.00, unit: "ea",    note: "15A GFCI outlet with weatherproof cover" },

  // ── Devices — customer-supplied (reference price; flagged in engine) ────────
  "DEV-014": { cost:  35.00, unit: "ea",    note: "Smart switch/outlet — CUSTOMER-SUPPLIED; reference price only" },

  // ── Lighting — installer-supplied ──────────────────────────────────────────
  "LGT-008": { cost:  55.00, unit: "ea",    note: "Dual-head motion sensor flood light" },
  "LGT-009": { cost:  65.00, unit: "ea",    note: "Combination exit/alarm fixture (commercial)" },
  "LGT-010": { cost:  75.00, unit: "ea",    note: "LED emergency exit combo unit (commercial)" },
  "LGT-035": { cost:  28.00, unit: "ea",    note: "Outdoor photocell / astronomical timer" },
  "LGT-037": { cost:  28.00, unit: "ea",    note: "6\" LED recessed wafer light (installer-supplied)" },

  // ── Lighting — customer-supplied (reference price; flagged in engine) ───────
  "LGT-007": { cost:  85.00, unit: "ea",    note: "Chandelier/pendant — CUSTOMER-SUPPLIED; reference price only" },
  "LGT-013": { cost:  35.00, unit: "ea",    note: "Under-cabinet LED strip kit — CUSTOMER-SUPPLIED; reference price only" },
  "LGT-018": { cost:  18.00, unit: "ea",    note: "LED retrofit lamp kit — CUSTOMER-SUPPLIED; reference price only" },
  "LGT-021": { cost:   4.50, unit: "ea",    note: "LED A19/BR30 retrofit bulb — CUSTOMER-SUPPLIED; reference price only" },
  "LGT-027": { cost:   6.50, unit: "ea",    note: "LED T8 tube lamp — CUSTOMER-SUPPLIED; reference price only" },
  "LGT-036": { cost: 150.00, unit: "ea",    note: "Ceiling fan/light combo — CUSTOMER-SUPPLIED; reference price only" },

  // ── Panels & breakers ──────────────────────────────────────────────────────
  "PNL-004": { cost: 185.00, unit: "ea",    note: "Commercial control transformer (480V/120V typical)" },
  "PNL-005": { cost: 120.00, unit: "ea",    note: "100A residential load center with main breaker" },
  "PNL-006": { cost:  12.00, unit: "ea",    note: "20A single-pole breaker (Square D / Eaton compatible)" },
  "PNL-007": { cost:  22.00, unit: "ea",    note: "40A 2-pole breaker (EV / generator / HVAC circuits)" },

  // ── Temporary cords ────────────────────────────────────────────────────────
  "TMP-005": { cost:  28.00, unit: "ea",    note: "6 ft NEMA 14-50 generator output cord" },
  "TMP-011": { cost:  28.00, unit: "ea",    note: "6 ft NEMA 14-50 cord for portable generator hookup" },

  // ── Controls — customer-supplied (reference price; flagged in engine) ───────
  "CTL-001": { cost:  45.00, unit: "ea",    note: "Smart sensor/module — CUSTOMER-SUPPLIED; reference price only" },
  "CTL-002": { cost:  80.00, unit: "ea",    note: "Smart bridge/hub — CUSTOMER-SUPPLIED; reference price only" },

  // ── Wire runs ──────────────────────────────────────────────────────────────
  // Unit corrected from "ea" → "100ft". AssemblyItems uses 100 ft scale:
  //   qty_per_unit 0.1 means 10 ft, qty 4 means 400 ft, etc.
  // Engine formula: qty_per_unit × job_qty × base_cost → correct dollar amount.
  "WIR-009": { cost:  68.00, unit: "100ft", note: "NM-B 12/2 cable — $68/100 ft ($0.68/ft). Unit corrected from 'ea'." },
  "WIR-010": { cost:  48.00, unit: "100ft", note: "NM-B 14/2 cable — $48/100 ft ($0.48/ft). Unit corrected from 'ea'." },
  "WIR-011": { cost: 135.00, unit: "100ft", note: "NM-B 10/2 cable — $135/100 ft ($1.35/ft). Unit corrected from 'ea'." },
  "WIR-012": { cost:  85.00, unit: "100ft", note: "MC cable 12/2 — $85/100 ft ($0.85/ft). Unit corrected from 'ea'." },
  "WIR-013": { cost:  28.00, unit: "100ft", note: "Cat6 data cable — $28/100 ft ($0.28/ft). Unit corrected from 'ea'." },
};

// ─────────────────────────────────────────────────────────────────────────────

async function run() {
  const sheets  = await getSheetsClient();
  const resp    = await sheets.spreadsheets.values.get({
    spreadsheetId: SHEET_ID,
    range: "Materials!A1:J500",
  });
  const rows    = resp.data.values || [];
  const headers = rows[0];

  const colIdx = (name) => {
    const i = headers.indexOf(name);
    if (i < 0) throw new Error(`Column "${name}" not found in Materials tab`);
    return i;
  };
  const unitIdx  = colIdx("unit");
  const costIdx  = colIdx("base_cost");
  const srcIdx   = colIdx("cost_source");
  const lastIdx  = colIdx("last_updated");
  const noteIdx  = colIdx("Notes");

  // Build row-number map (1-indexed: row 1 = header, data starts at row 2)
  const rowByMatId = {};
  rows.slice(1).forEach((row, i) => {
    if (row[0]) rowByMatId[row[0]] = i + 2;
  });

  // Validate all 40 IDs exist before writing anything
  const missing = Object.keys(MATERIAL_PRICES).filter(id => !rowByMatId[id]);
  if (missing.length) {
    console.error("IDs not found in Materials tab:", missing.join(", "));
    console.error("Aborting — no changes written.");
    process.exit(1);
  }
  console.log(`All ${Object.keys(MATERIAL_PRICES).length} IDs found. Building batch update…`);

  const today = new Date().toISOString().split("T")[0];
  const colLetter = (idx) => String.fromCharCode(65 + idx); // A=65

  const data = [];
  for (const [matId, info] of Object.entries(MATERIAL_PRICES)) {
    const row = rowByMatId[matId];
    data.push({ range: `Materials!${colLetter(unitIdx)}${row}`,  values: [[info.unit]] });
    data.push({ range: `Materials!${colLetter(costIdx)}${row}`,  values: [[info.cost]] });
    data.push({ range: `Materials!${colLetter(srcIdx)}${row}`,   values: [["Elliott Electric Supply / April 2026"]] });
    data.push({ range: `Materials!${colLetter(lastIdx)}${row}`,  values: [[today]] });
    data.push({ range: `Materials!${colLetter(noteIdx)}${row}`,  values: [[info.note]] });
  }

  console.log(`Sending ${data.length} cell updates (${Object.keys(MATERIAL_PRICES).length} rows × 5 columns)…`);
  const result = await sheets.spreadsheets.values.batchUpdate({
    spreadsheetId: SHEET_ID,
    requestBody: { valueInputOption: "RAW", data },
  });
  console.log(`Written: ${result.data.totalUpdatedCells} cells across ${result.data.totalUpdatedRows} rows.`);

  // ── Verification pass ────────────────────────────────────────────────────
  const verResp = await sheets.spreadsheets.values.get({
    spreadsheetId: SHEET_ID,
    range: "Materials!A1:J500",
  });
  const vRows = verResp.data.values || [];
  const vHeaders = vRows[0];
  const vCostIdx = vHeaders.indexOf("base_cost");
  const vUnitIdx = vHeaders.indexOf("unit");

  console.log("\n=== VERIFICATION ===");
  let pass = 0, fail = 0;
  for (const [matId, info] of Object.entries(MATERIAL_PRICES).sort(([a], [b]) => a.localeCompare(b))) {
    const row     = vRows[rowByMatId[matId] - 1];
    const gotCost = parseFloat(row[vCostIdx]);
    const gotUnit = row[vUnitIdx];
    const ok      = gotCost === info.cost && gotUnit === info.unit;
    ok ? pass++ : fail++;
    const tag = ok ? "OK  " : "FAIL";
    console.log(`${tag} | ${matId} | $${gotCost} | ${gotUnit}` +
      (ok ? "" : `  ← expected $${info.cost} ${info.unit}`));
  }

  console.log(`\n${pass} OK, ${fail} FAIL`);
  if (fail > 0) { console.error("Some rows failed verification."); process.exit(1); }
  console.log("All material costs seeded and verified successfully.");
}

run().catch(e => { console.error("FATAL:", e.message); process.exit(1); });

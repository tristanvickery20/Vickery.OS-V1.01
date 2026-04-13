// scripts/seed-material-costs.js
// ─────────────────────────────────────────────────────────────────────────────
// Idempotent upsert migration — sets real base_cost and corrects units for the
// 40 zero-cost material IDs in the Estimator "Materials" tab.
//
// Context
// ───────
// When the Materials tab was auto-populated from AssemblyItems, 40 of 43 unique
// material IDs were stubbed with base_cost = $0. This script assigns real
// Elliott Electric Supply reference prices (Golden Triangle TX, April 2026) so
// the quote engine produces accurate material cost estimates.
//
// WIR unit correction (WIR-009 – WIR-013)
// ────────────────────────────────────────
// These 5 rows originally had unit = "ea". AssemblyItems uses a 100 ft scale:
//   qty_per_unit 0.1 = 10 ft, qty_per_unit 4 = 400 ft, etc.
// Unit is corrected to "100ft" and base_cost is set per 100 ft. The engine
// formula (qty_per_unit × job_qty × base_cost) then yields the correct dollar
// amount without any code change — the unit field is documentation only.
//
// Upsert strategy for each of the 40 IDs:
//   • If the row already exists → update unit, base_cost, cost_source,
//     last_updated, and Notes columns.
//   • If the row is missing (first run or accidental delete) → append a full
//     new row with all columns populated.
//
// Customer-supplied materials
// ───────────────────────────
// Nine IDs receive a realistic reference price for cost-record purposes but are
// also added to lib/flaggedMaterials.js so the engine excludes them from the
// customer quote (installer charges labor only; customer supplies the product).
//   LGT-007  LGT-013  LGT-018  LGT-021  LGT-027  LGT-036
//   CTL-001  CTL-002  DEV-014
//
// Run
// ───
//   node scripts/seed-material-costs.js
// Safe to re-run; all writes are idempotent.
// ─────────────────────────────────────────────────────────────────────────────
"use strict";

const { getSheetsClient } = require("../lib/sheets");

const SHEET_ID = process.env.ESTIMATOR_V2_SHEET_ID;
if (!SHEET_ID) { console.error("ESTIMATOR_V2_SHEET_ID env var not set"); process.exit(1); }

// ── Price table ───────────────────────────────────────────────────────────────
// cost  = base_cost in the stated unit
// unit  = value stored in the Materials "unit" column
// cust  = true → customer supplies product; engine prices at $0 via flaggedMaterials
// note  = Notes column content
const MATERIAL_PRICES = {
  // ── Boxes ──────────────────────────────────────────────────────────────────
  "BOX-003": { cost:  15.00, unit: "ea",    cust: false, name: "Surface raceway boxes",                  note: "Wiremold 500-series surface raceway box" },
  "BOX-004": { cost:   3.00, unit: "ea",    cust: false, name: "Data wall plate box",                    note: "Low-voltage mounting bracket / wall-plate ring" },
  "BOX-006": { cost:   8.50, unit: "ea",    cust: false, name: "Weatherproof junction box",              note: "1-gang weatherproof outdoor box with in-use cover" },
  "BOX-007": { cost:   3.50, unit: "ea",    cust: false, name: "Device box (old work)",                  note: "Standard old-work 1-gang device box" },

  // ── Conduit ────────────────────────────────────────────────────────────────
  "CON-005": { cost:   1.25, unit: "ea",    cust: false, name: "EMT conduit coupling 1/2\"",             note: "EMT ½\" set-screw coupling" },
  "CON-007": { cost:  10.00, unit: "ea",    cust: false, name: "EMT conduit 1/2\" 10ft",                 note: "EMT ½\" conduit, 10 ft stick" },

  // ── Connectors & consumables ───────────────────────────────────────────────
  "CONN-001":{ cost:   0.15, unit: "ea",    cust: false, name: "Wire connectors",                        note: "Wire nut — per connector; qty_per_unit is allowance count" },
  "MSC-001": { cost:   3.00, unit: "roll",  cust: false, name: "Electrical tape",                        note: "Electrical tape roll; qty_per_unit = fraction of roll consumed" },

  // ── Devices — installer-supplied ───────────────────────────────────────────
  "DEV-008": { cost:  45.00, unit: "ea",    cust: false, name: "EV receptacle or inlet",                 note: "NEMA 14-50 EV outlet/inlet (installer supplies)" },
  "DEV-009": { cost:  12.00, unit: "ea",    cust: false, name: "Range/appliance receptacle",             note: "Range/appliance receptacle (NEMA 14-30 or 10-30)" },
  "DEV-017": { cost:  22.00, unit: "ea",    cust: false, name: "LED/CFL dimmer switch",                  note: "LED/CFL dimmer switch (Leviton / Lutron standard grade)" },
  "DEV-020": { cost:   4.00, unit: "ea",    cust: false, name: "Switch cover for detector junction",     note: "Detector junction cover plate" },
  "DEV-021": { cost:   3.50, unit: "ea",    cust: false, name: "Duplex receptacles",                     note: "15A TR duplex receptacle, white" },
  "DEV-023": { cost:   8.00, unit: "ea",    cust: false, name: "Switch control for fan/light",           note: "Single-pole switch (fan/light control)" },
  "DEV-024": { cost:  22.00, unit: "ea",    cust: false, name: "GFCI device for exterior circuit",       note: "15A GFCI outlet with weatherproof cover" },

  // ── Devices — customer-supplied ────────────────────────────────────────────
  "DEV-014": { cost:  35.00, unit: "ea",    cust: true,  name: "Smart switch or outlet device",          note: "CUSTOMER-SUPPLIED — smart switch/outlet; reference price only" },

  // ── Lighting — installer-supplied ──────────────────────────────────────────
  "LGT-008": { cost:  55.00, unit: "ea",    cust: false, name: "Motion sensor flood/security light",     note: "Dual-head motion sensor flood light" },
  "LGT-009": { cost:  65.00, unit: "ea",    cust: false, name: "Exit/alarm fixtures",                    note: "Combination exit/alarm fixture (commercial)" },
  "LGT-010": { cost:  75.00, unit: "ea",    cust: false, name: "Exit/emergency combo fixtures",          note: "LED emergency exit combo unit (commercial)" },
  "LGT-035": { cost:  28.00, unit: "ea",    cust: false, name: "Photo control or lighting timer",        note: "Outdoor photocell / astronomical timer" },
  "LGT-037": { cost:  28.00, unit: "ea",    cust: false, name: "6\" LED recessed downlight",             note: "6\" LED recessed wafer light (installer-supplied)" },

  // ── Lighting — customer-supplied ───────────────────────────────────────────
  "LGT-007": { cost:  85.00, unit: "ea",    cust: true,  name: "Ceiling fixture (chandelier/pendant)",   note: "CUSTOMER-SUPPLIED — chandelier/pendant; reference price only" },
  "LGT-013": { cost:  35.00, unit: "ea",    cust: true,  name: "Under-cabinet LED strip",                note: "CUSTOMER-SUPPLIED — LED strip kit; reference price only" },
  "LGT-018": { cost:  18.00, unit: "ea",    cust: true,  name: "LED retrofit lamp or kit",               note: "CUSTOMER-SUPPLIED — LED retrofit kit; reference price only" },
  "LGT-021": { cost:   4.50, unit: "ea",    cust: true,  name: "LED retrofit lamps",                     note: "CUSTOMER-SUPPLIED — LED A19/BR30 bulb; reference price only" },
  "LGT-027": { cost:   6.50, unit: "ea",    cust: true,  name: "LED tubes or lamps",                     note: "CUSTOMER-SUPPLIED — LED T8 tube lamp; reference price only" },
  "LGT-036": { cost: 150.00, unit: "ea",    cust: true,  name: "Ceiling fan/light combo fixture",        note: "CUSTOMER-SUPPLIED — ceiling fan/light combo; reference price only" },

  // ── Panels & breakers ──────────────────────────────────────────────────────
  "PNL-004": { cost: 185.00, unit: "ea",    cust: false, name: "Transformer unit",                       note: "Commercial control transformer (480V/120V typical)" },
  "PNL-005": { cost: 120.00, unit: "ea",    cust: false, name: "100A main breaker load center",          note: "100A residential load center with main breaker" },
  "PNL-006": { cost:  12.00, unit: "ea",    cust: false, name: "Breakers (20A)",                         note: "20A single-pole breaker (Square D / Eaton compatible)" },
  "PNL-007": { cost:  22.00, unit: "ea",    cust: false, name: "40A 2-pole breaker",                     note: "40A 2-pole breaker (EV / generator / HVAC circuits)" },

  // ── Temporary cords ────────────────────────────────────────────────────────
  "TMP-005": { cost:  28.00, unit: "ea",    cust: false, name: "6ft range cord for generator output",    note: "6 ft NEMA 14-50 generator output cord" },
  "TMP-011": { cost:  28.00, unit: "ea",    cust: false, name: "6ft range cord for portable generator",  note: "6 ft NEMA 14-50 cord for portable generator hookup" },

  // ── Controls — customer-supplied ───────────────────────────────────────────
  "CTL-001": { cost:  45.00, unit: "ea",    cust: true,  name: "Sensor or smart module",                 note: "CUSTOMER-SUPPLIED — smart sensor/module; reference price only" },
  "CTL-002": { cost:  80.00, unit: "ea",    cust: true,  name: "Smart bridge or control hub",            note: "CUSTOMER-SUPPLIED — smart bridge/hub; reference price only" },

  // ── Wire runs — unit corrected from 'ea' to '100ft' ────────────────────────
  // AssemblyItems qty_per_unit uses a 100 ft scale (0.1 = 10 ft, 4 = 400 ft).
  // base_cost is set per 100 ft so: qty_per_unit × qty × base_cost = correct $.
  "WIR-009": { cost:  68.00, unit: "100ft", cust: false, name: "NM-B 12/2 cable",   note: "NM-B 12/2 @ $68/100 ft ($0.68/ft) — unit corrected from 'ea' to '100ft'" },
  "WIR-010": { cost:  48.00, unit: "100ft", cust: false, name: "NM-B 14/2 cable",   note: "NM-B 14/2 @ $48/100 ft ($0.48/ft) — unit corrected from 'ea' to '100ft'" },
  "WIR-011": { cost: 135.00, unit: "100ft", cust: false, name: "NM-B 10/2 cable",   note: "NM-B 10/2 @ $135/100 ft ($1.35/ft) — unit corrected from 'ea' to '100ft'" },
  "WIR-012": { cost:  85.00, unit: "100ft", cust: false, name: "MC cable 12/2",     note: "MC 12/2 @ $85/100 ft ($0.85/ft) — unit corrected from 'ea' to '100ft'" },
  "WIR-013": { cost:  28.00, unit: "100ft", cust: false, name: "Category 6 data cable", note: "Cat6 @ $28/100 ft ($0.28/ft) — unit corrected from 'ea' to '100ft'" },
};

const VENDOR    = "Elliott Electric Supply";
const SRC       = "Elliott Electric Supply / April 2026";
const ALL_IDS   = Object.keys(MATERIAL_PRICES);

// ─────────────────────────────────────────────────────────────────────────────

async function run() {
  const sheets  = await getSheetsClient();

  // Read current Materials tab
  const resp    = await sheets.spreadsheets.values.get({
    spreadsheetId: SHEET_ID,
    range: "Materials!A1:J600",
  });
  const rows    = resp.data.values || [];
  const headers = rows[0];

  const colIdx = (name) => {
    const i = headers.indexOf(name);
    if (i < 0) throw new Error(`Column "${name}" not found in Materials tab`);
    return i;
  };
  const idIdx   = colIdx("material_id");
  const nameIdx = colIdx("name");
  const unitIdx = colIdx("unit");
  const vendIdx = colIdx("vendor");
  const costIdx = colIdx("base_cost");
  const srcIdx  = colIdx("cost_source");
  const lastIdx = colIdx("last_updated");
  const noteIdx = colIdx("Notes");

  const colLetter = (i) => String.fromCharCode(65 + i);
  const today     = new Date().toISOString().split("T")[0];

  // Build row-number map (1-indexed: row 1 = header, data starts row 2)
  const rowByMatId = {};
  rows.slice(1).forEach((row, i) => {
    if (row[idIdx]) rowByMatId[row[idIdx]] = i + 2;
  });

  const toUpdate = ALL_IDS.filter(id =>  rowByMatId[id]);
  const toAppend = ALL_IDS.filter(id => !rowByMatId[id]);

  console.log(`Found ${toUpdate.length} existing rows to update, ${toAppend.length} rows to append.`);
  if (toAppend.length > 0) {
    console.log("  Appending:", toAppend.join(", "));
  }

  // ── Batch update existing rows ────────────────────────────────────────────
  if (toUpdate.length > 0) {
    const data = [];
    for (const matId of toUpdate) {
      const info = MATERIAL_PRICES[matId];
      const row  = rowByMatId[matId];
      data.push({ range: `Materials!${colLetter(unitIdx)}${row}`, values: [[info.unit]] });
      data.push({ range: `Materials!${colLetter(costIdx)}${row}`, values: [[info.cost]] });
      data.push({ range: `Materials!${colLetter(srcIdx)}${row}`,  values: [[SRC]] });
      data.push({ range: `Materials!${colLetter(lastIdx)}${row}`, values: [[today]] });
      data.push({ range: `Materials!${colLetter(noteIdx)}${row}`, values: [[info.note]] });
    }
    const res = await sheets.spreadsheets.values.batchUpdate({
      spreadsheetId: SHEET_ID,
      requestBody: { valueInputOption: "RAW", data },
    });
    console.log(`Updated ${res.data.totalUpdatedCells} cells across ${res.data.totalUpdatedRows} rows.`);
  }

  // ── Append missing rows ───────────────────────────────────────────────────
  if (toAppend.length > 0) {
    // Build full rows in column order matching the header
    const maxCol  = Math.max(idIdx, nameIdx, unitIdx, vendIdx, costIdx, srcIdx, lastIdx, noteIdx);
    const newRows = toAppend.map(matId => {
      const info = MATERIAL_PRICES[matId];
      const row  = new Array(maxCol + 1).fill("");
      row[idIdx]   = matId;
      row[nameIdx] = info.name;
      row[unitIdx] = info.unit;
      row[vendIdx] = VENDOR;
      row[costIdx] = info.cost;
      row[srcIdx]  = SRC;
      row[lastIdx] = today;
      row[noteIdx] = info.note;
      return row;
    });
    await sheets.spreadsheets.values.append({
      spreadsheetId: SHEET_ID,
      range: "Materials!A1",
      valueInputOption: "RAW",
      insertDataOption: "INSERT_ROWS",
      requestBody: { values: newRows },
    });
    console.log(`Appended ${newRows.length} new row(s): ${toAppend.join(", ")}`);
  }

  // ── Verification pass ─────────────────────────────────────────────────────
  const verResp = await sheets.spreadsheets.values.get({
    spreadsheetId: SHEET_ID,
    range: "Materials!A1:J600",
  });
  const vRows    = verResp.data.values || [];
  const vHeaders = vRows[0];
  const vIdIdx   = vHeaders.indexOf("material_id");
  const vCostIdx = vHeaders.indexOf("base_cost");
  const vUnitIdx = vHeaders.indexOf("unit");

  // Rebuild map after potential appends
  const vRowMap = {};
  vRows.slice(1).forEach((r, i) => { if (r[vIdIdx]) vRowMap[r[vIdIdx]] = i + 1; });

  console.log("\n=== VERIFICATION (all 40 target IDs) ===");
  let pass = 0, fail = 0;
  for (const matId of ALL_IDS.sort()) {
    const rowData = vRows[vRowMap[matId]];
    if (!rowData) { console.log(`MISS | ${matId} — not found after write`); fail++; continue; }
    const info    = MATERIAL_PRICES[matId];
    const gotCost = parseFloat(rowData[vCostIdx]);
    const gotUnit = rowData[vUnitIdx];
    const ok      = gotCost === info.cost && gotUnit === info.unit;
    ok ? pass++ : fail++;
    console.log(`${ok ? "OK  " : "FAIL"} | ${matId.padEnd(8)} | $${String(gotCost).padStart(6)} | ${gotUnit}` +
      (ok ? "" : `  ← expected $${info.cost} ${info.unit}`));
  }

  console.log(`\n${pass} OK — ${fail} FAIL`);
  if (fail > 0) { console.error("Some rows failed verification — check above."); process.exit(1); }
  console.log("All 40 material costs seeded and verified successfully.");
  console.log(`WIR-009/010/011/012/013 confirmed unit='100ft' — engine math is correct.`);
}

run().catch(e => { console.error("FATAL:", e.message); process.exit(1); });

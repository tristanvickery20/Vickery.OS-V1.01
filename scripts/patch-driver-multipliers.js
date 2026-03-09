// scripts/patch-driver-multipliers.js
// Appends missing rows to the Driver_Multipliers tab in the V2 estimator sheet.
// Safe to re-run: only adds rows that are not already present (checked by driver_id + option).
//
// Usage: node scripts/patch-driver-multipliers.js

const { getSheetsClient } = require("../lib/sheets");

const SHEET_ID = process.env.ESTIMATOR_V2_SHEET_ID;

// Full desired Driver_Multipliers rows.
// Format: [driver_id, option_label, labor_mult, material_mult]
const DESIRED_ROWS = [
  // DIST_PANEL — already populated; listed for completeness (will be skipped if present)
  ["DIST_PANEL", "Same room",       "1",    "1"],
  ["DIST_PANEL", "Adjacent room",   "1.1",  "1.05"],
  ["DIST_PANEL", "Across house",    "1.25", "1.1"],

  // CEILING_HT — "12–14 ft" exists; add the rest
  ["CEILING_HT", "Under 9 ft",      "1",    "1"],
  ["CEILING_HT", "9–12 ft",         "1",    "1"],
  ["CEILING_HT", "12–14 ft",        "1.15", "1"],
  ["CEILING_HT", "15–20 ft",        "1.5",  "1.1"],

  // ATTIC_ACCESS — "No" exists; add Yes/Limited/Not sure
  ["ATTIC_ACCESS", "Yes — full",    "1",    "1"],
  ["ATTIC_ACCESS", "Limited",       "1.15", "1.05"],
  ["ATTIC_ACCESS", "Not sure",      "1.1",  "1"],
  ["ATTIC_ACCESS", "No",            "1.3",  "1.05"],

  // WALL_TYPE — "Plaster" exists; add Drywall/Tile/Wood
  ["WALL_TYPE", "Drywall",          "1",    "1"],
  ["WALL_TYPE", "Tile",             "1.5",  "1.15"],
  ["WALL_TYPE", "Wood / paneling",  "1.15", "1"],
  ["WALL_TYPE", "Plaster",          "1.4",  "1.05"],

  // HOME_OCC — entirely missing
  ["HOME_OCC", "Yes",               "1.1",  "1"],
  ["HOME_OCC", "No",                "1",    "1"],
];

async function run() {
  if (!SHEET_ID) {
    console.error("ERROR: ESTIMATOR_V2_SHEET_ID not set.");
    process.exit(1);
  }

  const sheets = await getSheetsClient();

  // Read existing rows
  const existing = await sheets.spreadsheets.values.get({
    spreadsheetId: SHEET_ID,
    range: "Driver_Multipliers!A:D",
  });
  const existingRows = (existing.data.values || []).slice(1); // skip header
  const existingKeys = new Set(
    existingRows.map(r => `${r[0]}||${r[1]}`)
  );

  console.log(`Existing Driver_Multipliers rows: ${existingRows.length}`);

  // Determine which rows to add
  const toAdd = DESIRED_ROWS.filter(r => !existingKeys.has(`${r[0]}||${r[1]}`));

  if (!toAdd.length) {
    console.log("Nothing to add — all desired rows already present.");
    return;
  }

  console.log(`Appending ${toAdd.length} missing row(s):`);
  toAdd.forEach(r => console.log(`  + ${r[0]} | "${r[1]}" | labor×${r[2]} | mat×${r[3]}`));

  await sheets.spreadsheets.values.append({
    spreadsheetId: SHEET_ID,
    range: "Driver_Multipliers!A:D",
    valueInputOption: "RAW",
    insertDataOption: "INSERT_ROWS",
    requestBody: {
      majorDimension: "ROWS",
      values: toAdd,
    },
  });

  // Verify
  const verify = await sheets.spreadsheets.values.get({
    spreadsheetId: SHEET_ID,
    range: "Driver_Multipliers!A:D",
  });
  const afterRows = (verify.data.values || []).slice(1);
  console.log(`\nDriver_Multipliers now has ${afterRows.length} rows (was ${existingRows.length}).`);
  console.log("\nFinal table:");
  (verify.data.values || []).forEach(r => console.log("  " + r.map(v => String(v).padEnd(18)).join(" ")));
}

run().catch(err => {
  console.error("FATAL:", err.message);
  process.exit(1);
});

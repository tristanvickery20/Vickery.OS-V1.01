#!/usr/bin/env node
// scripts/reseed-estimator.js
// Force-reseeds Estimator_Modules and Estimator_ServiceMatrix tabs in the
// ESTIMATOR_V2_SHEET_ID Google Sheet. Clears existing data rows (keeps headers),
// then writes fresh rows from lib/estimatorSeedData.js.
//
// Usage:
//   node scripts/reseed-estimator.js              — dry run (shows row counts)
//   node scripts/reseed-estimator.js --write      — executes the reseed
//   node scripts/reseed-estimator.js --modules    — modules tab only
//   node scripts/reseed-estimator.js --services   — services tab only

const { getSheetsClient } = require("../lib/sheets");
const { MODULES, SERVICES } = require("../lib/estimatorSeedData");

const WRITE  = process.argv.includes("--write");
const MONLY  = process.argv.includes("--modules");
const SONLY  = process.argv.includes("--services");
const DO_MOD = !SONLY;
const DO_SVC = !MONLY;

function SHEET_ID() {
  const id = process.env.ESTIMATOR_V2_SHEET_ID;
  if (!id) { console.error("ERROR: ESTIMATOR_V2_SHEET_ID not set."); process.exit(1); }
  return id;
}

async function getHeaders(sheets, tab) {
  const r = await sheets.spreadsheets.values.get({
    spreadsheetId: SHEET_ID(),
    range: `${tab}!1:1`,
  });
  return (r.data.values?.[0] || []).map(h => String(h).trim());
}

async function getDataRowCount(sheets, tab) {
  const r = await sheets.spreadsheets.values.get({
    spreadsheetId: SHEET_ID(),
    range: `${tab}!A1:A5000`,
  });
  const rows = r.data.values || [];
  return Math.max(0, rows.length - 1); // subtract header row
}

async function clearDataRows(sheets, tab, dataRowCount) {
  if (dataRowCount === 0) return;
  const endRow = 1 + dataRowCount;
  await sheets.spreadsheets.values.clear({
    spreadsheetId: SHEET_ID(),
    range: `${tab}!A2:ZZ${endRow}`,
  });
  console.log(`  Cleared ${dataRowCount} data rows from ${tab}`);
}

async function writeRows(sheets, tab, rows, headers) {
  if (!rows.length) return;
  const values = rows.map(r => headers.map(h => String(r[h] ?? "")));
  await sheets.spreadsheets.values.append({
    spreadsheetId: SHEET_ID(),
    range: `${tab}!A1`,
    valueInputOption: "RAW",
    insertDataOption: "INSERT_ROWS",
    requestBody: { majorDimension: "ROWS", values },
  });
  console.log(`  Wrote ${rows.length} rows to ${tab}`);
}

async function reseedTab(sheets, tab, rows) {
  const headers      = await getHeaders(sheets, tab);
  const dataRowCount = await getDataRowCount(sheets, tab);

  console.log(`\n[${tab}]`);
  console.log(`  Headers (${headers.length}): ${headers.join(", ")}`);
  console.log(`  Existing data rows: ${dataRowCount}`);
  console.log(`  New seed rows: ${rows.length}`);

  if (!WRITE) {
    console.log("  → DRY RUN — pass --write to execute");
    return;
  }

  if (!headers.length) {
    console.error(`  ERROR: No headers found in ${tab}. Run migrate-estimator-tabs.js first.`);
    return;
  }

  await clearDataRows(sheets, tab, dataRowCount);
  await writeRows(sheets, tab, rows, headers);
  console.log(`  Done.`);
}

async function main() {
  console.log("=== Estimator Force-Reseed ===");
  console.log(`Sheet: ${SHEET_ID()}`);
  console.log(`Mode:  ${WRITE ? "WRITE" : "DRY RUN"}`);

  const sheets = await getSheetsClient();

  const svcRows = SERVICES.map(s => ({
    ...s,
    qty_min:               "",
    qty_max:               "",
    disqualify_rules_json: "[]",
  }));

  if (DO_MOD) await reseedTab(sheets, "Estimator_Modules",      MODULES);
  if (DO_SVC) await reseedTab(sheets, "Estimator_ServiceMatrix", svcRows);

  if (!WRITE) {
    console.log("\nRe-run with --write to apply changes.");
  } else {
    console.log("\nReseed complete. Restart the server to pick up new modules.");
  }
}

main().catch(err => {
  console.error("FATAL:", err.message);
  process.exit(1);
});

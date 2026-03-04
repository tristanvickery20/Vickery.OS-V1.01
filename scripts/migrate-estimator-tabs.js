// scripts/migrate-estimator-tabs.js
// One-shot migration: copies Estimator_Modules, Estimator_ServiceMatrix, and
// Leads_QuoteSnapshots from the CRM Master sheet → Instant_Estimator_v2 sheet.
// Run once: node scripts/migrate-estimator-tabs.js

"use strict";
const { getSheetsClient } = require("../lib/sheets");

const CRM_ID       = process.env.CRM_SHEET_ID;
const ESTIMATOR_ID = process.env.ESTIMATOR_V2_SHEET_ID;
const TABS         = ["Estimator_Modules", "Estimator_ServiceMatrix", "Leads_QuoteSnapshots"];

async function getTabTitles(sheets, spreadsheetId) {
  const meta = await sheets.spreadsheets.get({ spreadsheetId });
  return (meta.data.sheets || []).map(s => s.properties.title);
}

async function ensureTab(sheets, spreadsheetId, tabName) {
  const titles = await getTabTitles(sheets, spreadsheetId);
  if (!titles.includes(tabName)) {
    await sheets.spreadsheets.batchUpdate({
      spreadsheetId,
      requestBody: { requests: [{ addSheet: { properties: { title: tabName } } }] },
    });
    console.log(`  Created tab "${tabName}" in destination sheet.`);
  }
}

async function readTabRaw(sheets, spreadsheetId, tabName) {
  try {
    const r = await sheets.spreadsheets.values.get({
      spreadsheetId,
      range: `${tabName}!A1:Z5000`,
    });
    return r.data.values || [];
  } catch {
    return [];
  }
}

async function writeTabRaw(sheets, spreadsheetId, tabName, rows) {
  if (!rows.length) {
    console.log(`  No data in "${tabName}" — tab created but left empty.`);
    return;
  }
  // Clear existing content first
  await sheets.spreadsheets.values.clear({ spreadsheetId, range: `${tabName}!A:Z` });
  await sheets.spreadsheets.values.update({
    spreadsheetId,
    range: `${tabName}!A1`,
    valueInputOption: "RAW",
    requestBody: { majorDimension: "ROWS", values: rows },
  });
  console.log(`  Wrote ${rows.length} rows (incl. header) to "${tabName}".`);
}

async function main() {
  if (!CRM_ID)       { console.error("CRM_SHEET_ID is not set"); process.exit(1); }
  if (!ESTIMATOR_ID) { console.error("ESTIMATOR_V2_SHEET_ID is not set"); process.exit(1); }

  console.log(`Source (CRM):      ${CRM_ID}`);
  console.log(`Destination (Est): ${ESTIMATOR_ID}`);
  console.log("");

  const sheets = await getSheetsClient();

  for (const tab of TABS) {
    console.log(`Migrating "${tab}"…`);
    const rows = await readTabRaw(sheets, CRM_ID, tab);
    console.log(`  Read ${rows.length} rows from source.`);
    await ensureTab(sheets, ESTIMATOR_ID, tab);
    await writeTabRaw(sheets, ESTIMATOR_ID, tab, rows);
    console.log(`  Done.`);
  }

  console.log("\nMigration complete. CRM sheet untouched.");
  console.log("Now update estimator code to use ESTIMATOR_V2_SHEET_ID and restart.");
}

main().catch(err => { console.error("Migration failed:", err.message); process.exit(1); });

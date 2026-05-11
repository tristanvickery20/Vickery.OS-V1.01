#!/usr/bin/env node
// scripts/cleanup-orphaned-tabs.js
// Deletes orphaned V1 tabs from the live CRM Google Sheet.
// Safe to run multiple times — skips tabs that don't exist.

const { getSheetsClient } = require("../lib/sheets");

const TABS_TO_DELETE = [
  "Quotes",
  "Visits",
  "Availability",
  "Leads_QuoteSnapshots",
  "Estimator_Modules",
  "Estimator_ServiceMatrix",
  "JobTypes",
  "Questions",
  "AnswerOptions",
  "AddOns",
  "Rates",
];

async function main() {
  const spreadsheetId = process.env.CRM_SHEET_ID;
  if (!spreadsheetId) {
    console.error("ERROR: CRM_SHEET_ID env var is not set.");
    process.exit(1);
  }

  const sheets = await getSheetsClient();

  // Fetch spreadsheet metadata to get all sheet names + IDs
  console.log("Fetching spreadsheet metadata...");
  const meta = await sheets.spreadsheets.get({ spreadsheetId });
  const allSheets = meta.data.sheets || [];

  const sheetMap = {};
  for (const s of allSheets) {
    sheetMap[s.properties.title] = s.properties.sheetId;
  }

  console.log(`Found ${allSheets.length} tabs in sheet.`);
  console.log("All tabs:", Object.keys(sheetMap).join(", "));
  console.log("");

  const toDelete = [];
  const missing = [];

  for (const tabName of TABS_TO_DELETE) {
    if (tabName in sheetMap) {
      toDelete.push({ name: tabName, sheetId: sheetMap[tabName] });
    } else {
      missing.push(tabName);
    }
  }

  if (missing.length > 0) {
    console.log(`Tabs not found (already deleted or never existed): ${missing.join(", ")}`);
  }

  if (toDelete.length === 0) {
    console.log("Nothing to delete. All orphaned tabs are already gone.");
    return;
  }

  console.log(`Tabs to delete (${toDelete.length}): ${toDelete.map(t => t.name).join(", ")}`);
  console.log("");

  const requests = toDelete.map(t => ({
    deleteSheet: { sheetId: t.sheetId },
  }));

  console.log("Sending batchUpdate to delete tabs...");
  await sheets.spreadsheets.batchUpdate({
    spreadsheetId,
    requestBody: { requests },
  });

  console.log("");
  console.log("SUCCESS — deleted tabs:");
  for (const t of toDelete) {
    console.log(`  ✓ ${t.name} (sheetId: ${t.sheetId})`);
  }
}

main().catch(err => {
  console.error("FATAL:", err.message || err);
  process.exit(1);
});

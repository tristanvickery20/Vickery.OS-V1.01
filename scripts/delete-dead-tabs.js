// scripts/delete-dead-tabs.js
// Delete dead/redundant tabs from the live CRM sheet.
//
// Tabs removed from CRM (reason):
//   Clients, Properties, Requests, Jobs   → flattened into Leads
//   ServiceAreas                           → Estimator sheet only
//   Actuals_Rollup_30D                     → deprecated rollup
//   Time                                   → duplicate of TimeEntries
//   Reviews, Templates, ReferralLedger     → moved to MARKETING_SHEET_ID
//   FleetVehicles, FleetMaintenance,
//     ToolAssets, ToolIssues,
//     InventoryItems, TruckStock,
//     MaterialRequests                     → moved to TRUCK_STOCK_ID (Ops sheet)
//   HR_* (26 tabs)                         → moved to HR_SHEET_ID
//
// Bookings is intentionally KEPT — still used by the scheduling engine.
// QuoteSnapshots is intentionally KEPT — still written by schedule-book.js.
//
// Usage:
//   node scripts/delete-dead-tabs.js           # dry-run (prints what would be deleted)
//   node scripts/delete-dead-tabs.js --execute  # actually deletes
//
// Safe to re-run. If a tab is already gone, it is skipped silently.

"use strict";

const { getSheetsClient } = require("../lib/sheets");

const DRY_RUN = !process.argv.includes("--execute");

const CRM_ID = process.env.CRM_SHEET_ID;

// Dead tabs to delete from CRM sheet
const DEAD_TABS = [
  // Flattened into Leads
  "Clients",
  "Properties",
  "Requests",
  "Jobs",
  // Moved to Estimator sheet only
  "ServiceAreas",
  // Deprecated rollup tab
  "Actuals_Rollup_30D",
  // Duplicate of TimeEntries
  "Time",
  // Moved to MARKETING_SHEET_ID
  "Reviews",
  "Templates",
  "ReferralLedger",
  // Moved to TRUCK_STOCK_ID (Ops sheet)
  "FleetVehicles",
  "FleetMaintenance",
  "ToolAssets",
  "ToolIssues",
  "InventoryItems",
  "TruckStock",
  "MaterialRequests",
  // HR tabs migrated to HR sheet
  "HR_Departments",
  "HR_Designations",
  "HR_ShiftTypes",
  "HR_Attendance",
  "HR_CorrectionRequests",
  "HR_LeaveTypes",
  "HR_HolidayLists",
  "HR_Holidays",
  "HR_LeavePolicies",
  "HR_LeavePolicyItems",
  "HR_LeaveAllocations",
  "HR_LeaveApplications",
  "HR_JobOpenings",
  "HR_JobApplicants",
  "HR_Interviews",
  "HR_JobOffers",
  "HR_ExpenseClaims",
  "HR_ExpenseClaimItems",
  "HR_SalaryComponents",
  "HR_SalaryStructures",
  "HR_SalaryStructureItems",
  "HR_SalaryAssignments",
  "HR_PayrollSettings",
  "HR_PayrollRuns",
  "HR_PayrollRunAdditions",
  "HR_SalarySlips",
];

async function getSheetMeta(sheets, spreadsheetId) {
  const meta = await sheets.spreadsheets.get({ spreadsheetId });
  return (meta.data.sheets || []).map(s => ({
    title: s.properties.title,
    sheetId: s.properties.sheetId,
  }));
}

async function deleteSheets(sheets, spreadsheetId, sheetIds) {
  const requests = sheetIds.map(id => ({ deleteSheet: { sheetId: id } }));
  await sheets.spreadsheets.batchUpdate({
    spreadsheetId,
    requestBody: { requests },
  });
}

async function main() {
  if (!CRM_ID) {
    console.error("ERROR: CRM_SHEET_ID env var is not set.");
    process.exit(1);
  }

  console.log(DRY_RUN
    ? "\n=== DRY RUN — no changes will be made. Pass --execute to apply. ===\n"
    : "\n=== EXECUTE MODE — tabs will be permanently deleted. ===\n");

  const sheets = await getSheetsClient();

  let meta;
  try {
    meta = await getSheetMeta(sheets, CRM_ID);
  } catch (e) {
    console.error("Cannot access CRM sheet:", e.message);
    process.exit(1);
  }

  console.log(`CRM sheet has ${meta.length} tabs total.\n`);

  const existingByTitle = new Map(meta.map(s => [s.title, s.sheetId]));

  const toDelete = [];
  const notFound = [];

  for (const tabName of DEAD_TABS) {
    if (existingByTitle.has(tabName)) {
      toDelete.push({ title: tabName, sheetId: existingByTitle.get(tabName) });
    } else {
      notFound.push(tabName);
    }
  }

  if (notFound.length > 0) {
    console.log("Tabs already gone (skip):");
    notFound.forEach(t => console.log(`  - ${t}`));
    console.log();
  }

  if (toDelete.length === 0) {
    console.log("Nothing to delete — all dead tabs are already gone.");
    return;
  }

  console.log(`Tabs to ${DRY_RUN ? "DELETE (dry run)" : "DELETE"}:`);
  toDelete.forEach(t => console.log(`  - ${t.title}  (sheetId: ${t.sheetId})`));
  console.log();

  if (DRY_RUN) {
    console.log(`Dry run complete. ${toDelete.length} tab(s) would be deleted.`);
    console.log("Run with --execute to apply.\n");
    return;
  }

  // Delete in batches of 10 to avoid request size limits
  const BATCH = 10;
  let deleted = 0;
  for (let i = 0; i < toDelete.length; i += BATCH) {
    const batch = toDelete.slice(i, i + BATCH);
    try {
      await deleteSheets(sheets, CRM_ID, batch.map(t => t.sheetId));
      batch.forEach(t => {
        console.log(`  DELETED: ${t.title}`);
        deleted++;
      });
    } catch (err) {
      console.error(`  ERROR deleting batch ${i / BATCH + 1}:`, err.message);
    }
    // Brief pause to respect Sheets API rate limits
    if (i + BATCH < toDelete.length) {
      await new Promise(r => setTimeout(r, 500));
    }
  }

  console.log(`\nDone. ${deleted} tab(s) deleted from CRM sheet.`);
  console.log("\nVerify the CRM sheet in Google Sheets — then restart the server.");
}

main().catch(err => {
  console.error("\nScript failed:", err.message);
  if (err.response && err.response.data) {
    console.error("API detail:", JSON.stringify(err.response.data, null, 2));
  }
  process.exit(1);
});

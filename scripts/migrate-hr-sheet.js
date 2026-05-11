// scripts/migrate-hr-sheet.js
// One-shot migration: creates a dedicated HR Google Sheet (if HR_SHEET_ID not set),
// then copies all HR_* tabs from the CRM sheet into it.
//
// Usage (auto-create mode — recommended):
//   node scripts/migrate-hr-sheet.js
//
// Usage (supply existing sheet):
//   node scripts/migrate-hr-sheet.js <HR_SHEET_ID>
//
// What it does:
//   1. Creates "Vickery Electric — HR" spreadsheet (owned by service account)
//   2. Reads each HR_* tab from the CRM sheet (missing tabs are created empty)
//   3. Writes every row to the matching tab in the HR sheet
//   4. Prints the new HR_SHEET_ID at the end — paste it into Replit Secrets
//
// Safe to re-run: each tab is cleared before writing.
// Does NOT delete any tabs from the CRM sheet — manual clean-up after confirming.

"use strict";

const { getSheetsClient } = require("../lib/sheets");

const CRM_ID         = process.env.CRM_SHEET_ID;
const EXISTING_HR_ID = process.argv[2] || process.env.HR_SHEET_ID || null;

const HR_TABS = [
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

async function createHrSheet(sheets) {
  const res = await sheets.spreadsheets.create({
    requestBody: {
      properties: { title: "Vickery Electric — HR" },
      sheets: [{ properties: { title: "Sheet1" } }],
    },
  });
  return res.data.spreadsheetId;
}

async function getExistingTabs(sheets, spreadsheetId) {
  const meta = await sheets.spreadsheets.get({ spreadsheetId });
  return (meta.data.sheets || []).map(s => s.properties.title);
}

async function ensureTab(sheets, spreadsheetId, tabName) {
  const existing = await getExistingTabs(sheets, spreadsheetId);
  if (!existing.includes(tabName)) {
    await sheets.spreadsheets.batchUpdate({
      spreadsheetId,
      requestBody: { requests: [{ addSheet: { properties: { title: tabName } } }] },
    });
  }
}

async function readTab(sheets, spreadsheetId, tabName) {
  try {
    const r = await sheets.spreadsheets.values.get({
      spreadsheetId,
      range: `${tabName}!A1:ZZ10000`,
    });
    return r.data.values || [];
  } catch (err) {
    // Only treat "tab not found" (400 with INVALID_ARGUMENT) as a missing tab.
    // All other errors (auth, quota, network) are re-thrown so the operator
    // sees a clear failure rather than a silently partial migration.
    const status = err.response && err.response.status;
    const code   = err.response && err.response.data && err.response.data.error && err.response.data.error.status;
    if (status === 400 && (code === "INVALID_ARGUMENT" || !code)) {
      return null; // tab genuinely doesn't exist in source
    }
    throw err; // transient or auth error — fail loudly
  }
}

async function writeTab(sheets, spreadsheetId, tabName, rows) {
  await sheets.spreadsheets.values.clear({ spreadsheetId, range: `${tabName}!A:ZZ` });
  if (!rows || rows.length === 0) return false;
  await sheets.spreadsheets.values.update({
    spreadsheetId,
    range: `${tabName}!A1`,
    valueInputOption: "RAW",
    requestBody: { majorDimension: "ROWS", values: rows },
  });
  return true;
}

async function main() {
  if (!CRM_ID) {
    console.error("ERROR: CRM_SHEET_ID env var is not set.");
    process.exit(1);
  }

  const sheets = await getSheetsClient();

  // ── Create or verify the HR sheet ───────────────────────────────────────────
  let HR_ID = EXISTING_HR_ID;

  if (!HR_ID) {
    console.log("Creating new 'Vickery Electric — HR' spreadsheet…");
    try {
      HR_ID = await createHrSheet(sheets);
      console.log(`  Created: ${HR_ID}`);
      console.log(`  URL: https://docs.google.com/spreadsheets/d/${HR_ID}/edit\n`);
    } catch (e) {
      console.error("  Could not auto-create sheet:", e.message);
      console.error("");
      console.error("MANUAL SETUP REQUIRED:");
      console.error("  1. Create a new Google Sheet called 'Vickery Electric — HR'");
      console.error("  2. Share it (Editor) with your service account email (see GOOGLE_SERVICE_ACCOUNT_JSON → client_email)");
      console.error("  3. Run: node scripts/migrate-hr-sheet.js <SHEET_ID>");
      process.exit(1);
    }
  } else {
    // Verify access to the supplied sheet
    try {
      const meta = await sheets.spreadsheets.get({ spreadsheetId: HR_ID });
      console.log(`Using existing HR sheet: "${meta.data.properties.title}" (${HR_ID})`);
    } catch (e) {
      console.error(`ERROR: Cannot access HR sheet "${HR_ID}": ${e.message}`);
      console.error("Make sure the sheet is shared with the service account (Editor access).");
      process.exit(1);
    }
  }

  // ── Verify CRM access ────────────────────────────────────────────────────────
  let crmMeta;
  try {
    crmMeta = await sheets.spreadsheets.get({ spreadsheetId: CRM_ID });
  } catch (e) {
    console.error(`ERROR: Cannot access CRM sheet "${CRM_ID}":`, e.message);
    process.exit(1);
  }

  const crmTabs = (crmMeta.data.sheets || []).map(s => s.properties.title);
  console.log(`\nSource: "${crmMeta.data.properties.title}" (${CRM_ID}) — ${crmTabs.length} tabs`);
  console.log(`Destination: ${HR_ID}`);
  console.log(`\nMigrating ${HR_TABS.length} HR tabs…\n`);

  let migrated = 0, skipped = 0, empty = 0;

  for (const tab of HR_TABS) {
    process.stdout.write(`  ${tab.padEnd(32)} `);

    if (!crmTabs.includes(tab)) {
      // Tab doesn't exist in CRM — still create it in HR (ensureTab will do it on server start)
      console.log(`[not in CRM — skipped]`);
      skipped++;
      continue;
    }

    const rows = await readTab(sheets, CRM_ID, tab);
    if (rows === null) {
      console.log(`[read error — skipped]`);
      skipped++;
      continue;
    }

    await ensureTab(sheets, HR_ID, tab);
    const hadData = await writeTab(sheets, HR_ID, tab, rows);

    if (hadData) {
      console.log(`[ok] ${rows.length} row${rows.length !== 1 ? "s" : ""}`);
      migrated++;
    } else {
      console.log(`[empty — tab created]`);
      empty++;
    }

    // Respect Sheets API rate limits (100 req/100s per project)
    await new Promise(r => setTimeout(r, 300));
  }

  console.log("\n──────────────────────────────────────────────────────────");
  console.log(`Migration complete:`);
  console.log(`  Tabs with data migrated : ${migrated}`);
  console.log(`  Empty tabs created      : ${empty}`);
  console.log(`  Tabs not in CRM (skip)  : ${skipped}`);
  console.log("");
  console.log(`  HR_SHEET_ID = ${HR_ID}`);
  console.log("");
  console.log("NEXT STEPS:");
  console.log(`  1. Go to Replit Secrets → add  HR_SHEET_ID = ${HR_ID}`);
  console.log("  2. Restart the server — look for '[Sheets] HR: ...' in the logs");
  console.log("  3. Open an HR page (e.g. /people/employees) and verify data appears");
  console.log("  4. When satisfied, delete the HR_* tabs from the CRM sheet");
  console.log("──────────────────────────────────────────────────────────");
}

main().catch(err => {
  console.error("\nMigration failed:", err.message);
  if (err.response && err.response.data) {
    console.error("API detail:", JSON.stringify(err.response.data, null, 2));
  }
  process.exit(1);
});

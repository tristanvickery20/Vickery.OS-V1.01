// lib/hrSheetClient.js
// Returns the HR-dedicated sheet ID and provides a sheets client scoped to the HR sheet.
// All HR lib files use hrSpreadsheetId() instead of CRM_SHEET_ID for HR-specific tabs.
// The Staff tab (crew lookups, scheduling) remains on the CRM sheet.
//
// DATA MIGRATION NOTE:
// When HR_SHEET_ID is first configured, all existing HR_* tab data must be manually
// copied from the CRM sheet into the new HR sheet. The ensureXxxSheets() functions
// in each HR lib will auto-create tabs and headers on first boot, but they will be empty.
// Steps:
//  1. Create a new Google Sheet and set its ID as HR_SHEET_ID in Replit Secrets.
//  2. Share the new sheet with the Google service account email (same account used for CRM).
//  3. Copy the following tabs from the CRM sheet into the HR sheet:
//     HR_Departments, HR_Designations, HR_ShiftTypes, HR_Attendance,
//     HR_CorrectionRequests, HR_LeaveTypes, HR_HolidayLists, HR_Holidays,
//     HR_LeavePolicies, HR_LeavePolicyItems, HR_LeaveAllocations, HR_LeaveApplications,
//     HR_JobOpenings, HR_JobApplicants, HR_Interviews, HR_JobOffers,
//     HR_ExpenseClaims, HR_ExpenseClaimItems, HR_SalaryComponents, HR_SalaryStructures,
//     HR_SalaryStructureItems, HR_SalaryAssignments, HR_PayrollSettings,
//     HR_PayrollRuns, HR_PayrollRunAdditions, HR_SalarySlips
//  4. The Staff tab stays in the CRM sheet — do NOT copy it.

const { getSheetsClient } = require("./sheets");

function hrSpreadsheetId() {
  const id = process.env.HR_SHEET_ID;
  if (!id) throw new Error("[FATAL] HR_SHEET_ID is not configured. Set this Replit Secret to enable the HR module.");
  return id;
}

module.exports = { hrSpreadsheetId, getSheetsClient };

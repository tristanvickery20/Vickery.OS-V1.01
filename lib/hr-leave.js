// lib/hr-leave.js — HR Phase 3: Leave Types, Policies, Allocations, Applications
//
// DATA MIGRATION NOTE (2026-05-11):
// All HR_Leave* and HR_Holiday* tabs now live on HR_SHEET_ID.
// The Staff tab (leave_policy_id column migration) remains on CRM_SHEET_ID.
// Copy HR_LeaveTypes, HR_HolidayLists, HR_Holidays, HR_LeavePolicies,
// HR_LeavePolicyItems, HR_LeaveAllocations, HR_LeaveApplications
// from the CRM sheet to the HR sheet manually on first boot.

const { getSheetsClient, colToLetter } = require("./sheets");
const { hrSpreadsheetId } = require("./hrSheetClient");

const LEAVE_TYPE_TAB     = "HR_LeaveTypes";
const HOLIDAY_LIST_TAB   = "HR_HolidayLists";
const HOLIDAY_TAB        = "HR_Holidays";
const POLICY_TAB         = "HR_LeavePolicies";
const POLICY_ITEM_TAB    = "HR_LeavePolicyItems";
const ALLOCATION_TAB     = "HR_LeaveAllocations";
const APPLICATION_TAB    = "HR_LeaveApplications";
const STAFF_TAB          = "Staff";

const LEAVE_TYPE_HEADERS    = ["leave_type_id", "name", "is_paid", "days_per_year", "carry_over", "created_at"];
const HOLIDAY_LIST_HEADERS  = ["holiday_list_id", "name", "year", "is_active", "created_at"];
const HOLIDAY_HEADERS       = ["holiday_id", "holiday_list_id", "date", "name", "created_at"];
const POLICY_HEADERS        = ["leave_policy_id", "name", "description", "created_at"];
const POLICY_ITEM_HEADERS   = ["policy_item_id", "leave_policy_id", "leave_type_id", "days_allocated", "created_at"];
const ALLOCATION_HEADERS    = ["allocation_id", "staff_id", "leave_type_id", "leave_policy_id", "year", "days_allocated", "days_used", "created_at", "updated_at"];
const APPLICATION_HEADERS   = ["application_id", "staff_id", "leave_type_id", "from_date", "to_date", "half_day", "reason", "status", "manager_id", "manager_note", "days_count", "created_at", "updated_at"];

function hrId() { return hrSpreadsheetId(); }

// ── Generic helpers (HR sheet) ──────────────────────────────────────────────────

async function ensureTab(tabName, headers) {
  const spreadsheetId = hrId();
  const sheets = await getSheetsClient();
  const meta = await sheets.spreadsheets.get({ spreadsheetId });
  const exists = meta.data.sheets.some(s => s.properties.title === tabName);
  if (!exists) {
    await sheets.spreadsheets.batchUpdate({
      spreadsheetId,
      requestBody: { requests: [{ addSheet: { properties: { title: tabName } } }] },
    });
    await sheets.spreadsheets.values.update({
      spreadsheetId,
      range: `${tabName}!A1`,
      valueInputOption: "RAW",
      requestBody: { values: [headers] },
    });
    console.log(`[hr-leave] Created tab: ${tabName}`);
  }
}

async function readTab(tabName) {
  const spreadsheetId = hrId();
  const sheets = await getSheetsClient();
  const resp = await sheets.spreadsheets.values.get({ spreadsheetId, range: `${tabName}!A:AZ` });
  const rows = resp.data.values || [];
  if (rows.length < 2) return [];
  const hdrs = rows[0];
  return rows.slice(1).filter(r => r && r.some(c => c)).map(row => {
    const obj = {};
    hdrs.forEach((h, i) => { obj[h] = String(row[i] || "").trim(); });
    return obj;
  });
}

async function appendRow(tabName, headers, record) {
  const spreadsheetId = hrId();
  const sheets = await getSheetsClient();
  const row = headers.map(h => String(record[h] ?? ""));
  await sheets.spreadsheets.values.append({
    spreadsheetId,
    range: `${tabName}!A:AZ`,
    valueInputOption: "RAW",
    requestBody: { values: [row] },
  });
}

async function updateRowById(tabName, idField, idValue, updates) {
  const spreadsheetId = hrId();
  const sheets = await getSheetsClient();
  const resp = await sheets.spreadsheets.values.get({ spreadsheetId, range: `${tabName}!A:AZ` });
  const rows = resp.data.values || [];
  if (rows.length < 2) return false;
  const headers = rows[0];
  const idIdx = headers.indexOf(idField);
  for (let i = 1; i < rows.length; i++) {
    if ((rows[i][idIdx] || "") === idValue) {
      const updated = [...rows[i]];
      while (updated.length < headers.length) updated.push("");
      Object.entries(updates).forEach(([k, v]) => {
        const idx = headers.indexOf(k);
        if (idx >= 0) {
          while (updated.length <= idx) updated.push("");
          updated[idx] = String(v ?? "");
        }
      });
      await sheets.spreadsheets.values.update({
        spreadsheetId,
        range: `${tabName}!A${i + 1}`,
        valueInputOption: "RAW",
        requestBody: { values: [updated] },
      });
      return true;
    }
  }
  return false;
}

async function deleteRowById(tabName, idField, idValue) {
  const spreadsheetId = hrId();
  const sheets = await getSheetsClient();
  const metaResp = await sheets.spreadsheets.get({ spreadsheetId });
  const sheetMeta = metaResp.data.sheets.find(s => s.properties.title === tabName);
  if (!sheetMeta) return false;
  const sheetId = sheetMeta.properties.sheetId;
  const resp = await sheets.spreadsheets.values.get({ spreadsheetId, range: `${tabName}!A:AZ` });
  const rows = resp.data.values || [];
  const headers = rows[0] || [];
  const idIdx = headers.indexOf(idField);
  const rowIndex = rows.findIndex((r, i) => i > 0 && (r[idIdx] || "") === idValue);
  if (rowIndex < 0) return false;
  await sheets.spreadsheets.batchUpdate({
    spreadsheetId,
    requestBody: {
      requests: [{ deleteDimension: { range: { sheetId, dimension: "ROWS", startIndex: rowIndex, endIndex: rowIndex + 1 } } }],
    },
  });
  return true;
}

// ── Leave Types ─────────────────────────────────────────────────────────────────

async function readAllLeaveTypes()          { return readTab(LEAVE_TYPE_TAB); }
async function appendLeaveType(record)      { return appendRow(LEAVE_TYPE_TAB, LEAVE_TYPE_HEADERS, record); }
async function updateLeaveType(id, updates) { return updateRowById(LEAVE_TYPE_TAB, "leave_type_id", id, updates); }
async function deleteLeaveType(id)          { return deleteRowById(LEAVE_TYPE_TAB, "leave_type_id", id); }

// ── Holiday Lists ───────────────────────────────────────────────────────────────

async function readAllHolidayLists()            { return readTab(HOLIDAY_LIST_TAB); }
async function appendHolidayList(record)        { return appendRow(HOLIDAY_LIST_TAB, HOLIDAY_LIST_HEADERS, record); }
async function updateHolidayList(id, updates)   { return updateRowById(HOLIDAY_LIST_TAB, "holiday_list_id", id, updates); }
async function deleteHolidayList(id)            { return deleteRowById(HOLIDAY_LIST_TAB, "holiday_list_id", id); }

// ── Holidays ────────────────────────────────────────────────────────────────────

async function readAllHolidays()           { return readTab(HOLIDAY_TAB); }
async function appendHoliday(record)       { return appendRow(HOLIDAY_TAB, HOLIDAY_HEADERS, record); }
async function deleteHoliday(id)           { return deleteRowById(HOLIDAY_TAB, "holiday_id", id); }

async function readHolidaysForList(listId) {
  const all = await readAllHolidays();
  return all.filter(h => h.holiday_list_id === listId);
}

async function getActiveHolidayDates() {
  const [lists, holidays] = await Promise.all([readAllHolidayLists(), readAllHolidays()]);
  const activeList = lists.find(l => l.is_active === "TRUE" || l.is_active === "true");
  if (!activeList) return new Set();
  const active = holidays.filter(h => h.holiday_list_id === activeList.holiday_list_id);
  return new Set(active.map(h => h.date));
}

// ── Leave Policies ──────────────────────────────────────────────────────────────

async function readAllLeavePolicies()           { return readTab(POLICY_TAB); }
async function appendLeavePolicy(record)        { return appendRow(POLICY_TAB, POLICY_HEADERS, record); }
async function updateLeavePolicy(id, updates)   { return updateRowById(POLICY_TAB, "leave_policy_id", id, updates); }
async function deleteLeavePolicy(id)            { return deleteRowById(POLICY_TAB, "leave_policy_id", id); }

async function readAllPolicyItems()             { return readTab(POLICY_ITEM_TAB); }
async function appendPolicyItem(record)         { return appendRow(POLICY_ITEM_TAB, POLICY_ITEM_HEADERS, record); }
async function deletePolicyItem(id)             { return deleteRowById(POLICY_ITEM_TAB, "policy_item_id", id); }
async function readPolicyItems(policyId) {
  const all = await readAllPolicyItems();
  return all.filter(p => p.leave_policy_id === policyId);
}

// ── Leave Allocations (balance ledger) ──────────────────────────────────────────

async function readAllAllocations() { return readTab(ALLOCATION_TAB); }

async function readAllocationsForEmployee(staffId) {
  const all = await readAllAllocations();
  return all.filter(a => a.staff_id === staffId);
}

async function readAllocationForEmployeeLeaveType(staffId, leaveTypeId, year) {
  const all = await readAllAllocations();
  return all.find(a => a.staff_id === staffId && a.leave_type_id === leaveTypeId && a.year === String(year)) || null;
}

async function upsertAllocation(record) {
  const existing = await readAllocationForEmployeeLeaveType(record.staff_id, record.leave_type_id, record.year);
  const now = new Date().toISOString();
  if (existing) {
    const updates = { updated_at: now };
    if (record.days_allocated !== undefined) updates.days_allocated = String(record.days_allocated);
    if (record.days_used !== undefined) updates.days_used = String(record.days_used);
    if (record.leave_policy_id !== undefined) updates.leave_policy_id = record.leave_policy_id;
    return updateRowById(ALLOCATION_TAB, "allocation_id", existing.allocation_id, updates);
  }
  const full = {
    allocation_id: record.allocation_id || require("crypto").randomUUID(),
    staff_id: record.staff_id,
    leave_type_id: record.leave_type_id,
    leave_policy_id: record.leave_policy_id || "",
    year: String(record.year),
    days_allocated: String(record.days_allocated || 0),
    days_used: String(record.days_used || 0),
    created_at: now,
    updated_at: now,
  };
  return appendRow(ALLOCATION_TAB, ALLOCATION_HEADERS, full);
}

// Deduct days from an allocation (called on approval)
async function deductFromAllocation(staffId, leaveTypeId, year, days) {
  const alloc = await readAllocationForEmployeeLeaveType(staffId, leaveTypeId, String(year));
  if (!alloc) return false;
  const used = parseFloat(alloc.days_used || 0) + days;
  const now = new Date().toISOString();
  return updateRowById(ALLOCATION_TAB, "allocation_id", alloc.allocation_id, {
    days_used: String(used),
    updated_at: now,
  });
}

// Write allocations for all leave types in a policy for a single employee
async function writeAllocationsForEmployee(staffId, policyId, year) {
  const items = await readPolicyItems(policyId);
  const now = new Date().toISOString();
  for (const item of items) {
    const existing = await readAllocationForEmployeeLeaveType(staffId, item.leave_type_id, year);
    if (existing) {
      await updateRowById(ALLOCATION_TAB, "allocation_id", existing.allocation_id, {
        days_allocated: item.days_allocated,
        leave_policy_id: policyId,
        updated_at: now,
      });
    } else {
      await appendRow(ALLOCATION_TAB, ALLOCATION_HEADERS, {
        allocation_id: require("crypto").randomUUID(),
        staff_id: staffId,
        leave_type_id: item.leave_type_id,
        leave_policy_id: policyId,
        year: String(year),
        days_allocated: item.days_allocated,
        days_used: "0",
        created_at: now,
        updated_at: now,
      });
    }
  }
}

// ── Leave Applications ──────────────────────────────────────────────────────────

async function readAllApplications() { return readTab(APPLICATION_TAB); }

async function readApplicationsForEmployee(staffId) {
  const all = await readAllApplications();
  return all.filter(a => a.staff_id === staffId);
}

async function readPendingApplications() {
  const all = await readAllApplications();
  return all.filter(a => a.status === "pending");
}

async function appendApplication(record) { return appendRow(APPLICATION_TAB, APPLICATION_HEADERS, record); }

async function updateApplication(appId, updates) {
  return updateRowById(APPLICATION_TAB, "application_id", appId, updates);
}

// ── Day counting helpers ────────────────────────────────────────────────────────

function countWorkingDays(fromDate, toDate, holidaySet, halfDay) {
  if (halfDay) {
    const d = new Date(fromDate + "T12:00:00Z");
    const dow = d.getUTCDay();
    if (dow === 0 || dow === 6 || holidaySet.has(fromDate)) return 0;
    return 0.5;
  }
  const start = new Date(fromDate + "T12:00:00Z");
  const end   = new Date(toDate   + "T12:00:00Z");
  let count = 0;
  const cur = new Date(start);
  while (cur <= end) {
    const dow = cur.getUTCDay();
    const dateStr = cur.toISOString().slice(0, 10);
    if (dow !== 0 && dow !== 6 && !holidaySet.has(dateStr)) {
      count++;
    }
    cur.setUTCDate(cur.getUTCDate() + 1);
  }
  return count;
}

// ── Staff leave_policy_id column migration (CRM sheet) ─────────────────────────

async function migrateStaffLeavePolicyColumn() {
  const spreadsheetId = process.env.CRM_SHEET_ID;
  if (!spreadsheetId) return;
  const sheets = await getSheetsClient();
  const hRes = await sheets.spreadsheets.values.get({ spreadsheetId, range: `${STAFF_TAB}!1:1` });
  const existing = (hRes.data.values || [[]])[0] || [];
  if (existing.includes("leave_policy_id")) return;
  const startCol = colToLetter(existing.length);
  await sheets.spreadsheets.values.update({
    spreadsheetId,
    range: `${STAFF_TAB}!${startCol}1`,
    valueInputOption: "RAW",
    requestBody: { values: [["leave_policy_id"]] },
  });
  console.log("[hr-leave] Added leave_policy_id column to Staff sheet");
}

// ── Startup ─────────────────────────────────────────────────────────────────────

async function ensureLeaveSheets() {
  if (!process.env.HR_SHEET_ID) {
    throw new Error("[FATAL] HR_SHEET_ID is required. Leave sheets cannot initialize without it.");
  }
  await Promise.all([
    ensureTab(LEAVE_TYPE_TAB,  LEAVE_TYPE_HEADERS),
    ensureTab(HOLIDAY_LIST_TAB, HOLIDAY_LIST_HEADERS),
    ensureTab(HOLIDAY_TAB,     HOLIDAY_HEADERS),
    ensureTab(POLICY_TAB,      POLICY_HEADERS),
    ensureTab(POLICY_ITEM_TAB, POLICY_ITEM_HEADERS),
    ensureTab(ALLOCATION_TAB,  ALLOCATION_HEADERS),
    ensureTab(APPLICATION_TAB, APPLICATION_HEADERS),
    migrateStaffLeavePolicyColumn(),
  ]);
}

module.exports = {
  ensureLeaveSheets,
  readAllLeaveTypes, appendLeaveType, updateLeaveType, deleteLeaveType,
  readAllHolidayLists, appendHolidayList, updateHolidayList, deleteHolidayList,
  readAllHolidays, readHolidaysForList, appendHoliday, deleteHoliday, getActiveHolidayDates,
  readAllLeavePolicies, appendLeavePolicy, updateLeavePolicy, deleteLeavePolicy,
  readAllPolicyItems, readPolicyItems, appendPolicyItem, deletePolicyItem,
  readAllAllocations, readAllocationsForEmployee, readAllocationForEmployeeLeaveType,
  upsertAllocation, deductFromAllocation, writeAllocationsForEmployee,
  readAllApplications, readApplicationsForEmployee, readPendingApplications,
  appendApplication, updateApplication,
  countWorkingDays, getActiveHolidayDates,
};

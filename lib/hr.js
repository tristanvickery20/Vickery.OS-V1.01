// lib/hr.js — HR data layer: Departments, Designations, and employee HR profile fields

const { getSheetsClient, colToLetter } = require("./sheets");

const DEPT_TAB = "HR_Departments";
const DEPT_HEADERS = ["dept_id", "name", "description", "created_at"];

const DESIG_TAB = "HR_Designations";
const DESIG_HEADERS = ["designation_id", "name", "description", "created_at"];

const STAFF_TAB = "Staff";

// New HR columns added to the Staff sheet (beyond the original 12)
const HR_STAFF_COLUMNS = [
  "hire_date",
  "employment_status",
  "department_id",
  "designation_id",
  "reports_to",
  "personal_phone",
  "emergency_contact_name",
  "emergency_contact_phone",
];

function spreadsheetId() { return process.env.CRM_SHEET_ID; }

// ── Generic tab helpers ────────────────────────────────────────────────────────

async function ensureTab(tabName, headers) {
  const sid = spreadsheetId();
  if (!sid) return;
  const sheets = await getSheetsClient();
  const meta = await sheets.spreadsheets.get({ spreadsheetId: sid });
  const exists = meta.data.sheets.some(s => s.properties.title === tabName);
  if (!exists) {
    await sheets.spreadsheets.batchUpdate({
      spreadsheetId: sid,
      requestBody: { requests: [{ addSheet: { properties: { title: tabName } } }] },
    });
    await sheets.spreadsheets.values.update({
      spreadsheetId: sid,
      range: `${tabName}!A1`,
      valueInputOption: "RAW",
      requestBody: { values: [headers] },
    });
    console.log(`[hr] Created tab: ${tabName}`);
  }
}

async function readTab(tabName, headers) {
  const sid = spreadsheetId();
  if (!sid) return [];
  const sheets = await getSheetsClient();
  const resp = await sheets.spreadsheets.values.get({ spreadsheetId: sid, range: `${tabName}!A:Z` });
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
  const sid = spreadsheetId();
  if (!sid) throw new Error("No CRM_SHEET_ID");
  const sheets = await getSheetsClient();
  const row = headers.map(h => record[h] || "");
  await sheets.spreadsheets.values.append({
    spreadsheetId: sid,
    range: `${tabName}!A:Z`,
    valueInputOption: "RAW",
    requestBody: { values: [row] },
  });
}

async function updateRowById(tabName, idField, idValue, updates) {
  const sid = spreadsheetId();
  if (!sid) throw new Error("No CRM_SHEET_ID");
  const sheets = await getSheetsClient();
  const resp = await sheets.spreadsheets.values.get({ spreadsheetId: sid, range: `${tabName}!A:Z` });
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
        if (idx >= 0) updated[idx] = String(v ?? "");
      });
      await sheets.spreadsheets.values.update({
        spreadsheetId: sid,
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
  const sid = spreadsheetId();
  if (!sid) throw new Error("No CRM_SHEET_ID");
  const sheets = await getSheetsClient();
  const metaResp = await sheets.spreadsheets.get({ spreadsheetId: sid });
  const sheetMeta = metaResp.data.sheets.find(s => s.properties.title === tabName);
  if (!sheetMeta) return false;
  const sheetId = sheetMeta.properties.sheetId;

  const resp = await sheets.spreadsheets.values.get({ spreadsheetId: sid, range: `${tabName}!A:Z` });
  const rows = resp.data.values || [];
  const headers = rows[0] || [];
  const idIdx = headers.indexOf(idField);
  const rowIndex = rows.findIndex((r, i) => i > 0 && (r[idIdx] || "") === idValue);
  if (rowIndex < 0) return false;

  await sheets.spreadsheets.batchUpdate({
    spreadsheetId: sid,
    requestBody: {
      requests: [{
        deleteDimension: {
          range: { sheetId, dimension: "ROWS", startIndex: rowIndex, endIndex: rowIndex + 1 },
        },
      }],
    },
  });
  return true;
}

// ── Departments ────────────────────────────────────────────────────────────────

async function ensureDepartmentsSheet() { return ensureTab(DEPT_TAB, DEPT_HEADERS); }
async function readAllDepartments() { return readTab(DEPT_TAB, DEPT_HEADERS); }
async function appendDepartment(dept) { return appendRow(DEPT_TAB, DEPT_HEADERS, dept); }
async function updateDepartment(deptId, updates) { return updateRowById(DEPT_TAB, "dept_id", deptId, updates); }
async function deleteDepartment(deptId) { return deleteRowById(DEPT_TAB, "dept_id", deptId); }

// ── Designations ───────────────────────────────────────────────────────────────

async function ensureDesignationsSheet() { return ensureTab(DESIG_TAB, DESIG_HEADERS); }
async function readAllDesignations() { return readTab(DESIG_TAB, DESIG_HEADERS); }
async function appendDesignation(desig) { return appendRow(DESIG_TAB, DESIG_HEADERS, desig); }
async function updateDesignation(designationId, updates) { return updateRowById(DESIG_TAB, "designation_id", designationId, updates); }
async function deleteDesignation(designationId) { return deleteRowById(DESIG_TAB, "designation_id", designationId); }

// ── Employee HR profile migration ──────────────────────────────────────────────
// Adds the new HR columns to the existing Staff sheet if they are missing.

async function migrateStaffHrColumns() {
  const sid = spreadsheetId();
  if (!sid) return;
  const sheets = await getSheetsClient();
  const hRes = await sheets.spreadsheets.values.get({ spreadsheetId: sid, range: `${STAFF_TAB}!1:1` });
  const existing = (hRes.data.values || [[]])[0] || [];
  const toAdd = HR_STAFF_COLUMNS.filter(c => !existing.includes(c));
  if (toAdd.length === 0) return;
  const startCol = colToLetter(existing.length);
  await sheets.spreadsheets.values.update({
    spreadsheetId: sid,
    range: `${STAFF_TAB}!${startCol}1`,
    valueInputOption: "RAW",
    requestBody: { values: [toAdd] },
  });
  console.log("[hr] Added Staff HR columns:", toAdd.join(", "));
}

// ── Employee profile read/update ───────────────────────────────────────────────

async function readAllEmployees() {
  const sid = spreadsheetId();
  if (!sid) return [];
  const sheets = await getSheetsClient();
  const resp = await sheets.spreadsheets.values.get({ spreadsheetId: sid, range: `${STAFF_TAB}!A:AZ` });
  const rows = resp.data.values || [];
  if (rows.length < 2) return [];
  const headers = rows[0];
  return rows.slice(1).filter(r => r && r.some(c => c)).map(row => {
    const obj = {};
    headers.forEach((h, i) => { obj[h] = String(row[i] || "").trim(); });
    return obj;
  });
}

async function updateEmployeeHr(staffId, updates) {
  const sid = spreadsheetId();
  if (!sid) throw new Error("No CRM_SHEET_ID");
  const sheets = await getSheetsClient();
  const resp = await sheets.spreadsheets.values.get({ spreadsheetId: sid, range: `${STAFF_TAB}!A:AZ` });
  const rows = resp.data.values || [];
  if (rows.length < 2) return false;
  const headers = rows[0];
  const idIdx = headers.indexOf("staff_id");
  for (let i = 1; i < rows.length; i++) {
    if ((rows[i][idIdx] || "") === staffId) {
      const updated = [...rows[i]];
      while (updated.length < headers.length) updated.push("");
      Object.entries(updates).forEach(([k, v]) => {
        const idx = headers.indexOf(k);
        if (idx < 0) {
          // Column not in sheet — skip rather than write to unlabeled position.
          // migrateStaffHrColumns() at startup ensures all HR fields are present.
          console.warn(`[hr] updateEmployeeHr: unknown column "${k}" — skipped`);
          return;
        }
        while (updated.length <= idx) updated.push("");
        updated[idx] = String(v ?? "");
      });
      await sheets.spreadsheets.values.update({
        spreadsheetId: sid,
        range: `${STAFF_TAB}!A${i + 1}`,
        valueInputOption: "RAW",
        requestBody: { values: [updated] },
      });
      return true;
    }
  }
  return false;
}

// ── Append a full employee row (including HR columns) ─────────────────────────

async function appendEmployeeRow(record) {
  const sid = spreadsheetId();
  if (!sid) throw new Error("No CRM_SHEET_ID");
  const sheets = await getSheetsClient();
  const resp = await sheets.spreadsheets.values.get({ spreadsheetId: sid, range: `${STAFF_TAB}!1:1` });
  const headers = (resp.data.values || [[]])[0] || [];
  const row = headers.map(h => String(record[h] ?? ""));
  await sheets.spreadsheets.values.append({
    spreadsheetId: sid,
    range: `${STAFF_TAB}!A:AZ`,
    valueInputOption: "RAW",
    requestBody: { values: [row] },
  });
}

// ── Startup ────────────────────────────────────────────────────────────────────

async function ensureHrSheets() {
  await Promise.all([
    ensureDepartmentsSheet(),
    ensureDesignationsSheet(),
    migrateStaffHrColumns(),
  ]);
}

module.exports = {
  ensureHrSheets,
  readAllDepartments, appendDepartment, updateDepartment, deleteDepartment,
  readAllDesignations, appendDesignation, updateDesignation, deleteDesignation,
  readAllEmployees, updateEmployeeHr, appendEmployeeRow,
};

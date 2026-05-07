// lib/hr-payroll.js — HR Phase 6: Expense Claims & Payroll Engine

const { getSheetsClient, colToLetter } = require("./sheets");

const CLAIM_TAB        = "HR_ExpenseClaims";
const CLAIM_ITEM_TAB   = "HR_ExpenseClaimItems";
const COMPONENT_TAB    = "HR_SalaryComponents";
const STRUCTURE_TAB    = "HR_SalaryStructures";
const STRUCT_ITEM_TAB  = "HR_SalaryStructureItems";
const ASSIGNMENT_TAB   = "HR_SalaryAssignments";
const SETTINGS_TAB     = "HR_PayrollSettings";
const RUN_TAB          = "HR_PayrollRuns";
const RUN_ADD_TAB      = "HR_PayrollRunAdditions";
const SLIP_TAB         = "HR_SalarySlips";

const CLAIM_HEADERS = [
  "claim_id","staff_id","claim_date","job_id","notes","status",
  "manager_id","manager_note","submitted_at","reviewed_at","paid_at","created_at",
];
const CLAIM_ITEM_HEADERS = [
  "item_id","claim_id","category","amount","receipt_url","description","item_date","created_at",
];
const COMPONENT_HEADERS = [
  "component_id","name","type","value_type","amount","formula","taxable","created_at",
];
const STRUCTURE_HEADERS = [
  "structure_id","name","description","created_at",
];
const STRUCT_ITEM_HEADERS = [
  "item_id","structure_id","component_id","order_index","created_at",
];
const ASSIGNMENT_HEADERS = [
  "assignment_id","staff_id","structure_id","base_amount","effective_date","currency","created_at",
];
const SETTINGS_HEADERS = [
  "working_day_source","holiday_handling","half_day_fraction","pay_period_type","updated_at",
];
const RUN_HEADERS = [
  "run_id","pay_period_start","pay_period_end","department_id","status","created_by","finalized_at","created_at",
];
const RUN_ADD_HEADERS = [
  "addition_id","run_id","staff_id","description","amount","type","created_at",
];
const SLIP_HEADERS = [
  "slip_id","run_id","staff_id","pay_period_start","pay_period_end",
  "base_amount","gross_earnings","total_deductions","net_pay",
  "working_days","total_days","earnings_detail","deductions_detail",
  "share_token","status","created_at",
];

function sid() { return process.env.CRM_SHEET_ID; }

// ── Generic helpers ──────────────────────────────────────────────────────────

async function ensureTab(tabName, headers) {
  const spreadsheetId = sid();
  if (!spreadsheetId) return;
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
    console.log(`[hr-payroll] Created tab: ${tabName}`);
  }
}

async function readTab(tabName) {
  const spreadsheetId = sid();
  if (!spreadsheetId) return [];
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
  const spreadsheetId = sid();
  if (!spreadsheetId) throw new Error("No CRM_SHEET_ID");
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
  const spreadsheetId = sid();
  if (!spreadsheetId) throw new Error("No CRM_SHEET_ID");
  const sheets = await getSheetsClient();
  const resp = await sheets.spreadsheets.values.get({ spreadsheetId, range: `${tabName}!A:AZ` });
  const rows = resp.data.values || [];
  if (rows.length < 2) return false;
  const hdrs = rows[0];
  const idCol = hdrs.indexOf(idField);
  if (idCol === -1) return false;
  const rowIdx = rows.findIndex((r, i) => i > 0 && String(r[idCol] || "") === String(idValue));
  if (rowIdx === -1) return false;
  const sheetRow = rowIdx + 1;
  for (const [key, val] of Object.entries(updates)) {
    const col = hdrs.indexOf(key);
    if (col === -1) continue;
    const range = `${tabName}!${colToLetter(col)}${sheetRow}`;
    await sheets.spreadsheets.values.update({
      spreadsheetId, range, valueInputOption: "RAW",
      requestBody: { values: [[String(val ?? "")]] },
    });
  }
  return true;
}

async function deleteRowById(tabName, idField, idValue) {
  const spreadsheetId = sid();
  if (!spreadsheetId) throw new Error("No CRM_SHEET_ID");
  const sheets = await getSheetsClient();
  const meta = await sheets.spreadsheets.get({ spreadsheetId });
  const sheet = meta.data.sheets.find(s => s.properties.title === tabName);
  if (!sheet) return false;
  const sheetId = sheet.properties.sheetId;
  const resp = await sheets.spreadsheets.values.get({ spreadsheetId, range: `${tabName}!A:AZ` });
  const rows = resp.data.values || [];
  if (rows.length < 2) return false;
  const hdrs = rows[0];
  const idCol = hdrs.indexOf(idField);
  const rowIdx = rows.findIndex((r, i) => i > 0 && String(r[idCol] || "") === String(idValue));
  if (rowIdx === -1) return false;
  await sheets.spreadsheets.batchUpdate({
    spreadsheetId,
    requestBody: {
      requests: [{ deleteDimension: { range: { sheetId, dimension: "ROWS", startIndex: rowIdx, endIndex: rowIdx + 1 } } }],
    },
  });
  return true;
}

// ── ensurePayrollSheets ──────────────────────────────────────────────────────

async function ensurePayrollSheets() {
  await ensureTab(CLAIM_TAB,       CLAIM_HEADERS);
  await ensureTab(CLAIM_ITEM_TAB,  CLAIM_ITEM_HEADERS);
  await ensureTab(COMPONENT_TAB,   COMPONENT_HEADERS);
  await ensureTab(STRUCTURE_TAB,   STRUCTURE_HEADERS);
  await ensureTab(STRUCT_ITEM_TAB, STRUCT_ITEM_HEADERS);
  await ensureTab(ASSIGNMENT_TAB,  ASSIGNMENT_HEADERS);
  await ensureTab(SETTINGS_TAB,    SETTINGS_HEADERS);
  await ensureTab(RUN_TAB,         RUN_HEADERS);
  await ensureTab(RUN_ADD_TAB,     RUN_ADD_HEADERS);
  await ensureTab(SLIP_TAB,        SLIP_HEADERS);
}

// ── Expense Claims ────────────────────────────────────────────────────────────

async function readAllClaims()            { return readTab(CLAIM_TAB); }
async function readAllClaimItems()        { return readTab(CLAIM_ITEM_TAB); }

async function readClaimsForEmployee(staffId) {
  const all = await readAllClaims();
  return all.filter(c => c.staff_id === staffId);
}

async function appendClaim(record)       { return appendRow(CLAIM_TAB, CLAIM_HEADERS, record); }
async function updateClaim(id, updates)  { return updateRowById(CLAIM_TAB, "claim_id", id, updates); }
async function deleteClaim(id)           { return deleteRowById(CLAIM_TAB, "claim_id", id); }

async function appendClaimItem(record)   { return appendRow(CLAIM_ITEM_TAB, CLAIM_ITEM_HEADERS, record); }
async function deleteClaimItemsByClaim(claimId) {
  const all = await readAllClaimItems();
  const toDelete = all.filter(i => i.claim_id === claimId);
  for (const item of toDelete) await deleteRowById(CLAIM_ITEM_TAB, "item_id", item.item_id);
}

// ── Salary Components ─────────────────────────────────────────────────────────

async function readAllComponents()             { return readTab(COMPONENT_TAB); }
async function appendComponent(record)         { return appendRow(COMPONENT_TAB, COMPONENT_HEADERS, record); }
async function updateComponent(id, updates)    { return updateRowById(COMPONENT_TAB, "component_id", id, updates); }
async function deleteComponent(id)             { return deleteRowById(COMPONENT_TAB, "component_id", id); }

// ── Salary Structures ─────────────────────────────────────────────────────────

async function readAllStructures()             { return readTab(STRUCTURE_TAB); }
async function readAllStructureItems()         { return readTab(STRUCT_ITEM_TAB); }
async function appendStructure(record)         { return appendRow(STRUCTURE_TAB, STRUCTURE_HEADERS, record); }
async function updateStructure(id, updates)    { return updateRowById(STRUCTURE_TAB, "structure_id", id, updates); }
async function deleteStructure(id)             { return deleteRowById(STRUCTURE_TAB, "structure_id", id); }
async function appendStructureItem(record)     { return appendRow(STRUCT_ITEM_TAB, STRUCT_ITEM_HEADERS, record); }
async function deleteStructureItem(id)         { return deleteRowById(STRUCT_ITEM_TAB, "item_id", id); }
async function deleteStructureItems(structId)  {
  const all = await readAllStructureItems();
  for (const item of all.filter(i => i.structure_id === structId)) {
    await deleteRowById(STRUCT_ITEM_TAB, "item_id", item.item_id);
  }
}

// ── Salary Assignments ────────────────────────────────────────────────────────

async function readAllAssignments()            { return readTab(ASSIGNMENT_TAB); }
async function readAssignmentsForEmployee(staffId) {
  const all = await readAllAssignments();
  return all.filter(a => a.staff_id === staffId).sort((a, b) => b.effective_date.localeCompare(a.effective_date));
}
async function activeAssignment(staffId, asOfDate) {
  const list = await readAssignmentsForEmployee(staffId);
  const cutoff = asOfDate || new Date().toISOString().slice(0, 10);
  return list.find(a => a.effective_date <= cutoff) || null;
}
async function appendAssignment(record)        { return appendRow(ASSIGNMENT_TAB, ASSIGNMENT_HEADERS, record); }
async function deleteAssignment(id)            { return deleteRowById(ASSIGNMENT_TAB, "assignment_id", id); }

// ── Payroll Settings ──────────────────────────────────────────────────────────

async function readPayrollSettings() {
  const rows = await readTab(SETTINGS_TAB);
  if (rows.length === 0) {
    return {
      working_day_source: "attendance",
      holiday_handling: "exclude",
      half_day_fraction: "0.5",
      pay_period_type: "monthly",
    };
  }
  return rows[0];
}

async function savePayrollSettings(settings) {
  const spreadsheetId = sid();
  if (!spreadsheetId) throw new Error("No CRM_SHEET_ID");
  const sheets = await getSheetsClient();
  const row = SETTINGS_HEADERS.map(h => {
    if (h === "updated_at") return new Date().toISOString();
    return String(settings[h] ?? "");
  });
  const resp = await sheets.spreadsheets.values.get({ spreadsheetId, range: `${SETTINGS_TAB}!A:AZ` });
  const rows = resp.data.values || [];
  if (rows.length >= 2) {
    await sheets.spreadsheets.values.update({
      spreadsheetId,
      range: `${SETTINGS_TAB}!A2`,
      valueInputOption: "RAW",
      requestBody: { values: [row] },
    });
  } else {
    await appendRow(SETTINGS_TAB, SETTINGS_HEADERS, { ...settings, updated_at: new Date().toISOString() });
  }
}

// ── Payroll Runs ──────────────────────────────────────────────────────────────

async function readAllRuns()              { return readTab(RUN_TAB); }
async function readRun(runId)             { const all = await readAllRuns(); return all.find(r => r.run_id === runId) || null; }
async function appendRun(record)          { return appendRow(RUN_TAB, RUN_HEADERS, record); }
async function updateRun(id, updates)     {
  const nextStatus = String((updates && updates.status) || "").toLowerCase();
  if (nextStatus === "finalized") {
    const slips = await readSlipsForRun(id);
    if (!slips.length) {
      throw new Error("No salary slips were created. Payroll run was not finalized.");
    }
  }
  return updateRowById(RUN_TAB, "run_id", id, updates);
}

async function readAllRunAdditions()       { return readTab(RUN_ADD_TAB); }
async function readRunAdditions(runId) {
  const all = await readAllRunAdditions();
  return all.filter(a => a.run_id === runId);
}
async function appendRunAddition(record)   { return appendRow(RUN_ADD_TAB, RUN_ADD_HEADERS, record); }
async function deleteRunAddition(id)       { return deleteRowById(RUN_ADD_TAB, "addition_id", id); }

// ── Salary Slips ─────────────────────────────────────────────────────────────

async function readAllSlips()              { return readTab(SLIP_TAB); }
async function readSlipsForRun(runId)      { const all = await readAllSlips(); return all.filter(s => s.run_id === runId); }
async function readSlipByToken(token)      { const all = await readAllSlips(); return all.find(s => s.share_token === token) || null; }
async function readSlip(slipId)            { const all = await readAllSlips(); return all.find(s => s.slip_id === slipId) || null; }
async function appendSlip(record)          { return appendRow(SLIP_TAB, SLIP_HEADERS, record); }
async function updateSlip(id, updates)     { return updateRowById(SLIP_TAB, "slip_id", id, updates); }

// ── Payroll Computation ───────────────────────────────────────────────────────

/**
 * Compute gross pay, deductions, and net pay for one employee in a pay period.
 * Returns { base_amount, gross_earnings, total_deductions, net_pay, earnings_detail, deductions_detail }
 */
async function computeEmployeePay(staffId, periodStart, periodEnd, workingDays, totalDays, additions, settings) {
  // Resolve assignment as of the payroll period end date (not today)
  const assignment = await activeAssignment(staffId, periodEnd);
  if (!assignment) return null;

  // Use caller-provided settings or load from sheet
  const cfg = settings || await readPayrollSettings();
  const halfDayFraction = parseFloat(cfg.half_day_fraction) || 0.5;

  // Prorate base salary by working days (working_days × daily_rate)
  // daily_rate = base_amount / total_days in period
  const fullBase = parseFloat(assignment.base_amount) || 0;
  const td = parseInt(totalDays) || 0;
  const wd = parseFloat(workingDays) || 0;
  // effective_base = fullBase × (workingDays / totalDays)  — capped at fullBase
  const effectiveBase = td > 0 ? Math.min(fullBase, fullBase * (wd / td)) : fullBase;

  const allComponents = await readAllComponents();
  const allItems = await readAllStructureItems();
  const structureItems = allItems
    .filter(i => i.structure_id === assignment.structure_id)
    .sort((a, b) => parseInt(a.order_index) - parseInt(b.order_index));

  const earnings = [];
  const deductions = [];

  for (const si of structureItems) {
    const comp = allComponents.find(c => c.component_id === si.component_id);
    if (!comp) continue;
    let amount = 0;
    if (comp.value_type === "Fixed") {
      // Fixed components are prorated by attendance too
      const fixedFull = parseFloat(comp.amount) || 0;
      amount = td > 0 ? fixedFull * (wd / td) : fixedFull;
    } else if (comp.value_type === "Formula") {
      // Formulas reference `base` which is the prorated effective base
      try {
        const formulaStr = (comp.formula || "0").replace(/base/gi, String(effectiveBase));
        // Safe eval: only allow numbers, operators, parens
        if (/^[\d\s\+\-\*\/\.\(\)]+$/.test(formulaStr)) {
          // eslint-disable-next-line no-new-func
          amount = Number(Function('"use strict"; return (' + formulaStr + ')')());
        }
      } catch { amount = 0; }
    }
    if (comp.type === "Earning") {
      earnings.push({ name: comp.name, amount: Math.round(amount * 100) / 100 });
    } else {
      deductions.push({ name: comp.name, amount: Math.round(amount * 100) / 100 });
    }
  }

  // Add one-off additions/deductions from the run (not prorated — these are explicit amounts)
  for (const add of (additions || [])) {
    if (add.staff_id !== staffId) continue;
    const amt = parseFloat(add.amount) || 0;
    if (add.type === "bonus") earnings.push({ name: add.description || "Bonus", amount: amt });
    else deductions.push({ name: add.description || "Deduction", amount: amt });
  }

  const grossEarnings = effectiveBase + earnings.reduce((s, e) => s + e.amount, 0);
  const totalDeductions = deductions.reduce((s, d) => s + d.amount, 0);
  const netPay = Math.max(0, grossEarnings - totalDeductions);

  return {
    base_amount: Math.round(effectiveBase * 100) / 100,
    gross_earnings: Math.round(grossEarnings * 100) / 100,
    total_deductions: Math.round(totalDeductions * 100) / 100,
    net_pay: Math.round(netPay * 100) / 100,
    working_days: workingDays,
    total_days: totalDays,
    earnings_detail: JSON.stringify(earnings),
    deductions_detail: JSON.stringify(deductions),
    structure_id: assignment.structure_id,
  };
}

module.exports = {
  ensurePayrollSheets,
  // Claims
  readAllClaims, readAllClaimItems, readClaimsForEmployee,
  appendClaim, updateClaim, deleteClaim,
  appendClaimItem, deleteClaimItemsByClaim,
  // Components
  readAllComponents, appendComponent, updateComponent, deleteComponent,
  // Structures
  readAllStructures, readAllStructureItems, appendStructure, updateStructure, deleteStructure,
  appendStructureItem, deleteStructureItem, deleteStructureItems,
  // Assignments
  readAllAssignments, readAssignmentsForEmployee, activeAssignment, appendAssignment, deleteAssignment,
  // Settings
  readPayrollSettings, savePayrollSettings,
  // Runs
  readAllRuns, readRun, appendRun, updateRun,
  readAllRunAdditions, readRunAdditions, appendRunAddition, deleteRunAddition,
  // Slips
  readAllSlips, readSlipsForRun, readSlipByToken, readSlip, appendSlip, updateSlip,
  // Compute
  computeEmployeePay,
};

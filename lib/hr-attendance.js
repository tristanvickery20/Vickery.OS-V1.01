// lib/hr-attendance.js — HR Phase 2: Shift Types, Attendance, and Correction Requests
//
// DATA MIGRATION NOTE (2026-05-11):
// HR_ShiftTypes, HR_Attendance, HR_CorrectionRequests now live on HR_SHEET_ID.
// syncAttendanceFromTimeLog() still reads from the CRM sheet's Time and Staff tabs.
// Copy HR_ShiftTypes, HR_Attendance, HR_CorrectionRequests from the CRM sheet to
// the HR sheet manually on first boot.

const { getSheetsClient, colToLetter } = require("./sheets");
const { hrSpreadsheetId } = require("./hrSheetClient");

const SHIFT_TAB     = "HR_ShiftTypes";
const ATTEND_TAB    = "HR_Attendance";
const CORRECT_TAB   = "HR_CorrectionRequests";

const SHIFT_HEADERS   = ["shift_id", "name", "start_time", "end_time", "break_minutes", "days_of_week", "created_at"];
const ATTEND_HEADERS  = ["attendance_id", "date", "staff_id", "status", "shift_id", "notes", "source", "created_at", "updated_at"];
const CORRECT_HEADERS = ["correction_id", "staff_id", "attendance_id", "date", "requested_status", "reason", "status", "admin_notes", "created_at", "updated_at"];

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
    console.log(`[hr-attendance] Created tab: ${tabName}`);
  }
}

async function readTab(tabName) {
  const spreadsheetId = hrId();
  const sheets = await getSheetsClient();
  const resp = await sheets.spreadsheets.values.get({ spreadsheetId, range: `${tabName}!A:Z` });
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
    range: `${tabName}!A:Z`,
    valueInputOption: "RAW",
    requestBody: { values: [row] },
  });
}

async function updateRowById(tabName, idField, idValue, updates) {
  const spreadsheetId = hrId();
  const sheets = await getSheetsClient();
  const resp = await sheets.spreadsheets.values.get({ spreadsheetId, range: `${tabName}!A:Z` });
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

  const resp = await sheets.spreadsheets.values.get({ spreadsheetId, range: `${tabName}!A:Z` });
  const rows = resp.data.values || [];
  const headers = rows[0] || [];
  const idIdx = headers.indexOf(idField);
  const rowIndex = rows.findIndex((r, i) => i > 0 && (r[idIdx] || "") === idValue);
  if (rowIndex < 0) return false;

  await sheets.spreadsheets.batchUpdate({
    spreadsheetId,
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

// ── Shift Types ─────────────────────────────────────────────────────────────────

async function ensureShiftTypesSheet() { return ensureTab(SHIFT_TAB, SHIFT_HEADERS); }
async function readAllShiftTypes()     { return readTab(SHIFT_TAB); }
async function appendShiftType(shift)  { return appendRow(SHIFT_TAB, SHIFT_HEADERS, shift); }
async function updateShiftType(shiftId, updates) { return updateRowById(SHIFT_TAB, "shift_id", shiftId, updates); }
async function deleteShiftType(shiftId)           { return deleteRowById(SHIFT_TAB, "shift_id", shiftId); }

// ── Attendance ──────────────────────────────────────────────────────────────────

async function ensureAttendanceSheet() { return ensureTab(ATTEND_TAB, ATTEND_HEADERS); }
async function readAllAttendance()     { return readTab(ATTEND_TAB); }

async function readAttendanceByDate(date) {
  const all = await readAllAttendance();
  return all.filter(r => r.date === date);
}

async function readAttendanceByStaffAndDate(staffId, date) {
  const all = await readAllAttendance();
  return all.find(r => r.staff_id === staffId && r.date === date) || null;
}

async function upsertAttendance(record) {
  const existing = await readAttendanceByStaffAndDate(record.staff_id, record.date);
  const now = new Date().toISOString();
  if (existing) {
    return updateRowById(ATTEND_TAB, "attendance_id", existing.attendance_id, {
      ...record,
      updated_at: now,
    });
  }
  const full = {
    attendance_id: record.attendance_id || require("crypto").randomUUID(),
    date: record.date,
    staff_id: record.staff_id,
    status: record.status || "Absent",
    shift_id: record.shift_id || "",
    notes: record.notes || "",
    source: record.source || "manual",
    created_at: now,
    updated_at: now,
  };
  return appendRow(ATTEND_TAB, ATTEND_HEADERS, full);
}

async function bulkUpsertAttendance(records) {
  for (const r of records) {
    await upsertAttendance(r);
  }
}

// ── Sync from Time log ──────────────────────────────────────────────────────────
// Reads Time and Staff from CRM sheet (both remain there), writes Attendance to HR sheet.

async function syncAttendanceFromTimeLog(targetDate) {
  const crmSpreadsheetId = process.env.CRM_SHEET_ID;
  if (!crmSpreadsheetId) return { synced: 0 };
  const { hrSpreadsheetId } = require("./hrSheetClient");
  const hrSid = hrSpreadsheetId();
  const sheets = await getSheetsClient();

  // Load TimeEntries from CRM sheet; Staff now lives on HR sheet
  const [timeResp, staffResp] = await Promise.all([
    sheets.spreadsheets.values.get({ spreadsheetId: crmSpreadsheetId, range: "TimeEntries!A1:L5000" }),
    sheets.spreadsheets.values.get({ spreadsheetId: hrSid, range: "Staff!A:AZ" }),
  ]);

  const timeRows = timeResp.data.values || [];
  if (timeRows.length < 2) return { synced: 0 };

  // Build name → { staff_id, default_shift_id } map from the Staff sheet
  const staffRows = staffResp.data.values || [];
  const nameToEmployee = {};
  if (staffRows.length > 1) {
    const staffHeaders = staffRows[0];
    const siIdx  = staffHeaders.indexOf("staff_id");
    const fnIdx  = staffHeaders.indexOf("first_name");
    const lnIdx  = staffHeaders.indexOf("last_name");
    const dsIdx  = staffHeaders.indexOf("default_shift_id");
    if (siIdx >= 0 && fnIdx >= 0 && lnIdx >= 0) {
      staffRows.slice(1).forEach(row => {
        const staffId_ = String(row[siIdx] || "").trim();
        const fn       = String(row[fnIdx] || "").trim();
        const ln       = String(row[lnIdx] || "").trim();
        const dsId     = dsIdx >= 0 ? String(row[dsIdx] || "").trim() : "";
        if (staffId_ && fn) {
          const fullName = [fn, ln].filter(Boolean).join(" ").toLowerCase();
          nameToEmployee[fullName] = { staffId: staffId_, defaultShiftId: dsId };
        }
      });
    }
  }

  // Load shift types from HR sheet for off-shift detection
  const shifts = await readAllShiftTypes();
  const shiftById = {};
  shifts.forEach(s => { shiftById[s.shift_id] = s; });

  const DAY_NAMES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

  const [headers, ...data] = timeRows;
  const idx = {
    date:    headers.indexOf("date"),
    tech_id: headers.indexOf("tech_id"),
  };
  if (idx.date < 0)    idx.date    = 2;
  if (idx.tech_id < 0) idx.tech_id = 3;

  const dateStr = targetDate || new Date().toISOString().slice(0, 10);
  const dateDayName = DAY_NAMES[new Date(dateStr + "T12:00:00Z").getUTCDay()];

  // Collect unique tech_ids (names) clocked in on the target date
  const nameSet = new Set();
  data.forEach(row => {
    const d = String(row[idx.date] || "").trim();
    const t = String(row[idx.tech_id] || "").trim();
    if (d === dateStr && t) nameSet.add(t.toLowerCase());
  });

  // Resolve names → employee info
  const resolved = [];
  nameSet.forEach(name => {
    const emp = nameToEmployee[name];
    if (emp) resolved.push(emp);
  });

  let synced = 0;
  for (const { staffId, defaultShiftId } of resolved) {
    const existing = await readAttendanceByStaffAndDate(staffId, dateStr);
    if (existing && existing.source === "correction") continue;

    let isOffShift = false;
    if (defaultShiftId && shiftById[defaultShiftId]) {
      const shift = shiftById[defaultShiftId];
      if (shift.days_of_week) {
        const scheduledDays = shift.days_of_week.split(",").map(d => d.trim());
        isOffShift = scheduledDays.length > 0 && !scheduledDays.includes(dateDayName);
      }
    }

    const notes = isOffShift
      ? "Auto-synced from crew time log (off scheduled shift day)"
      : "Auto-synced from crew time log";
    const source = isOffShift ? "auto-off-shift" : "auto";

    await upsertAttendance({
      staff_id: staffId,
      date: dateStr,
      status: "Present",
      source,
      notes,
      shift_id: defaultShiftId || "",
    });
    synced++;
  }
  return { synced, date: dateStr };
}

// ── Correction Requests ─────────────────────────────────────────────────────────

async function ensureCorrectionSheet() { return ensureTab(CORRECT_TAB, CORRECT_HEADERS); }
async function readAllCorrections()    { return readTab(CORRECT_TAB); }

async function appendCorrection(record) { return appendRow(CORRECT_TAB, CORRECT_HEADERS, record); }

async function updateCorrection(correctionId, updates) {
  return updateRowById(CORRECT_TAB, "correction_id", correctionId, updates);
}

// ── Startup ─────────────────────────────────────────────────────────────────────

async function ensureAttendanceSheets() {
  if (!process.env.HR_SHEET_ID) {
    throw new Error("[FATAL] HR_SHEET_ID is required. Attendance sheets cannot initialize without it.");
  }
  await Promise.all([
    ensureShiftTypesSheet(),
    ensureAttendanceSheet(),
    ensureCorrectionSheet(),
  ]);
}

module.exports = {
  ensureAttendanceSheets,
  readAllShiftTypes, appendShiftType, updateShiftType, deleteShiftType,
  readAllAttendance, readAttendanceByDate, readAttendanceByStaffAndDate,
  upsertAttendance, bulkUpsertAttendance, syncAttendanceFromTimeLog,
  readAllCorrections, appendCorrection, updateCorrection,
};

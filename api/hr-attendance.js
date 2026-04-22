// api/hr-attendance.js — HR Phase 2: Shift Types, Attendance & Correction Requests

const crypto = require("crypto");
const {
  readAllShiftTypes, appendShiftType, updateShiftType, deleteShiftType,
  readAllAttendance, readAttendanceByDate,
  upsertAttendance, bulkUpsertAttendance, syncAttendanceFromTimeLog,
  readAllCorrections, appendCorrection, updateCorrection,
} = require("../lib/hr-attendance");
const { readAllEmployees } = require("../lib/hr");

function json(res, status, data) {
  res.writeHead(status, { "Content-Type": "application/json", "Cache-Control": "no-store" });
  res.end(JSON.stringify(data));
}

function readBody(req) {
  // Support pre-parsed body injected by crew session wrapper (avoids double-read of stream)
  if (req._crewInjectedBody !== undefined) return Promise.resolve(req._crewInjectedBody);
  return new Promise((resolve) => {
    let data = "";
    req.on("data", c => { data += c; });
    req.on("end", () => { try { resolve(JSON.parse(data || "{}")); } catch { resolve({}); } });
  });
}

// ── Shift Types ────────────────────────────────────────────────────────────────

// GET /api/hr/shifts
async function handleListShifts(req, res) {
  try {
    const shifts = await readAllShiftTypes();
    json(res, 200, { ok: true, shifts });
  } catch (err) {
    console.error("[hr/shifts]", err.message);
    json(res, 500, { ok: false, error: err.message });
  }
}

// POST /api/hr/shifts
async function handleCreateShift(req, res) {
  try {
    const { name, start_time, end_time, break_minutes, days_of_week } = await readBody(req);
    if (!name?.trim()) return json(res, 400, { ok: false, error: "name is required" });
    const shift = {
      shift_id: crypto.randomUUID(),
      name: name.trim(),
      start_time: (start_time || "").trim(),
      end_time: (end_time || "").trim(),
      break_minutes: String(Number(break_minutes) || 0),
      days_of_week: Array.isArray(days_of_week) ? days_of_week.join(",") : (days_of_week || "Mon,Tue,Wed,Thu,Fri"),
      created_at: new Date().toISOString(),
    };
    await appendShiftType(shift);
    json(res, 200, { ok: true, shift });
  } catch (err) {
    console.error("[hr/shifts/create]", err.message);
    json(res, 500, { ok: false, error: err.message });
  }
}

// PATCH /api/hr/shifts/:id
async function handleUpdateShift(req, res, shiftId) {
  try {
    const body = await readBody(req);
    const updates = {};
    ["name", "start_time", "end_time", "break_minutes"].forEach(k => {
      if (body[k] !== undefined) updates[k] = body[k];
    });
    if (body.days_of_week !== undefined) {
      updates.days_of_week = Array.isArray(body.days_of_week)
        ? body.days_of_week.join(",")
        : body.days_of_week;
    }
    const ok = await updateShiftType(shiftId, updates);
    json(res, ok ? 200 : 404, { ok });
  } catch (err) {
    console.error("[hr/shifts/update]", err.message);
    json(res, 500, { ok: false, error: err.message });
  }
}

// DELETE /api/hr/shifts/:id
async function handleDeleteShift(req, res, shiftId) {
  try {
    const ok = await deleteShiftType(shiftId);
    json(res, ok ? 200 : 404, { ok });
  } catch (err) {
    console.error("[hr/shifts/delete]", err.message);
    json(res, 500, { ok: false, error: err.message });
  }
}

// ── Daily Attendance ───────────────────────────────────────────────────────────

// GET /api/hr/attendance?date=YYYY-MM-DD
// Returns attendance records merged with full employee list so every employee appears.
async function handleListAttendance(req, res) {
  try {
    const u = new URL(req.url, "http://localhost");
    const date = u.searchParams.get("date") || new Date().toISOString().slice(0, 10);

    const [employees, records] = await Promise.all([
      readAllEmployees(),
      readAttendanceByDate(date),
    ]);

    const byStaff = {};
    records.forEach(r => { byStaff[r.staff_id] = r; });

    const active = employees.filter(e => {
      const s = (e.employment_status || "active").toLowerCase();
      return s === "active" || s === "";
    });

    const merged = active.map(emp => {
      const rec = byStaff[emp.staff_id];
      // Default to "Absent" when no record exists — per spec: Present if clocked in, absent if not.
      const status = rec ? (rec.status || "Absent") : "Absent";
      return {
        staff_id: emp.staff_id,
        first_name: emp.first_name,
        last_name: emp.last_name,
        department_id: emp.department_id || "",
        default_shift_id: emp.default_shift_id || "",
        attendance_id: rec ? (rec.attendance_id || "") : "",
        date,
        status,
        shift_id: rec ? (rec.shift_id || emp.default_shift_id || "") : (emp.default_shift_id || ""),
        notes: rec ? (rec.notes || "") : "",
        source: rec ? (rec.source || "") : "",
      };
    });

    json(res, 200, { ok: true, date, attendance: merged });
  } catch (err) {
    console.error("[hr/attendance]", err.message);
    json(res, 500, { ok: false, error: err.message });
  }
}

// POST /api/hr/attendance — upsert a single record
async function handleUpsertAttendance(req, res) {
  try {
    const body = await readBody(req);
    const { staff_id, date, status, shift_id, notes } = body;
    if (!staff_id || !date) return json(res, 400, { ok: false, error: "staff_id and date are required" });
    const VALID = ["Present", "Absent", "On Leave", "Half Day"];
    if (!VALID.includes(status)) return json(res, 400, { ok: false, error: `status must be one of: ${VALID.join(", ")}` });
    await upsertAttendance({ staff_id, date, status, shift_id: shift_id || "", notes: notes || "", source: "manual" });
    json(res, 200, { ok: true });
  } catch (err) {
    console.error("[hr/attendance/upsert]", err.message);
    json(res, 500, { ok: false, error: err.message });
  }
}

// POST /api/hr/attendance/bulk — mark multiple employees with a given status
async function handleBulkAttendance(req, res) {
  try {
    const { date, staff_ids, status, department_id, shift_id } = await readBody(req);
    if (!date) return json(res, 400, { ok: false, error: "date is required" });
    const VALID = ["Present", "Absent", "On Leave", "Half Day"];
    if (!VALID.includes(status)) return json(res, 400, { ok: false, error: `status must be one of: ${VALID.join(", ")}` });

    let targets = staff_ids;
    if (!targets || !targets.length) {
      const employees = await readAllEmployees();
      let filtered = employees.filter(e => {
        const s = (e.employment_status || "active").toLowerCase();
        return s === "active" || s === "";
      });
      if (department_id) {
        filtered = filtered.filter(e => e.department_id === department_id);
      }
      targets = filtered.map(e => e.staff_id);
    }

    const records = targets.map(staff_id => ({
      staff_id, date, status,
      shift_id: shift_id || "",
      source: "manual",
      notes: "Bulk marked",
    }));

    await bulkUpsertAttendance(records);
    json(res, 200, { ok: true, count: records.length });
  } catch (err) {
    console.error("[hr/attendance/bulk]", err.message);
    json(res, 500, { ok: false, error: err.message });
  }
}

// POST /api/hr/attendance/sync — auto-populate from Time log for a given date
async function handleSyncAttendance(req, res) {
  try {
    const { date } = await readBody(req);
    const result = await syncAttendanceFromTimeLog(date || null);
    json(res, 200, { ok: true, ...result });
  } catch (err) {
    console.error("[hr/attendance/sync]", err.message);
    json(res, 500, { ok: false, error: err.message });
  }
}

// GET /api/hr/attendance/grid?month=YYYY-MM&department_id=...
// Returns a 2D structure: { employees: [...], dates: [...], cells: { "staffId|date": status } }
async function handleAttendanceGrid(req, res) {
  try {
    const u = new URL(req.url, "http://localhost");
    const month = u.searchParams.get("month") || new Date().toISOString().slice(0, 7); // "YYYY-MM"
    const deptFilter = u.searchParams.get("department_id") || "";

    const [employees, allRecords] = await Promise.all([
      readAllEmployees(),
      readAllAttendance(),
    ]);

    let active = employees.filter(e => {
      const s = (e.employment_status || "active").toLowerCase();
      return s === "active" || s === "";
    });
    if (deptFilter) {
      active = active.filter(e => e.department_id === deptFilter);
    }

    // Build list of dates for the month
    const [year, mon] = month.split("-").map(Number);
    const daysInMonth = new Date(year, mon, 0).getDate();
    const dates = [];
    for (let d = 1; d <= daysInMonth; d++) {
      dates.push(`${month}-${String(d).padStart(2, "0")}`);
    }

    const today = new Date().toISOString().slice(0, 10);

    // Filter records to this month and build lookup
    const monthRecords = allRecords.filter(r => r.date && r.date.startsWith(month));
    const cells = {};

    // Pre-fill all employee×date cells up to today with "Absent" (default)
    active.forEach(emp => {
      dates.forEach(date => {
        if (date <= today) cells[`${emp.staff_id}|${date}`] = "Absent";
      });
    });

    // Overlay with actual persisted records (any date in month, including future)
    monthRecords.forEach(r => {
      cells[`${r.staff_id}|${r.date}`] = r.status;
    });

    const empList = active.map(e => ({
      staff_id: e.staff_id,
      first_name: e.first_name,
      last_name: e.last_name,
      department_id: e.department_id || "",
    }));

    json(res, 200, { ok: true, month, dates, employees: empList, cells });
  } catch (err) {
    console.error("[hr/attendance/grid]", err.message);
    json(res, 500, { ok: false, error: err.message });
  }
}

// ── Correction Requests ────────────────────────────────────────────────────────

// GET /api/hr/corrections
async function handleListCorrections(req, res) {
  try {
    const u = new URL(req.url, "http://localhost");
    const staffId = u.searchParams.get("staff_id");
    let all = await readAllCorrections();
    if (staffId) all = all.filter(r => r.staff_id === staffId);
    json(res, 200, { ok: true, corrections: all });
  } catch (err) {
    console.error("[hr/corrections]", err.message);
    json(res, 500, { ok: false, error: err.message });
  }
}

// POST /api/hr/corrections — employee submits a correction request
async function handleCreateCorrection(req, res) {
  try {
    const { staff_id, date, requested_status, reason } = await readBody(req);
    if (!staff_id || !date || !requested_status) {
      return json(res, 400, { ok: false, error: "staff_id, date, and requested_status are required" });
    }
    const VALID = ["Present", "Absent", "On Leave", "Half Day"];
    if (!VALID.includes(requested_status)) {
      return json(res, 400, { ok: false, error: `requested_status must be one of: ${VALID.join(", ")}` });
    }
    const now = new Date().toISOString();
    const record = {
      correction_id: crypto.randomUUID(),
      staff_id,
      attendance_id: "",
      date,
      requested_status,
      reason: (reason || "").trim(),
      status: "pending",
      admin_notes: "",
      created_at: now,
      updated_at: now,
    };
    await appendCorrection(record);
    json(res, 200, { ok: true, correction: record });
  } catch (err) {
    console.error("[hr/corrections/create]", err.message);
    json(res, 500, { ok: false, error: err.message });
  }
}

// PATCH /api/hr/corrections/:id — admin approves or rejects
async function handleUpdateCorrection(req, res, correctionId) {
  try {
    const body = await readBody(req);
    const { status, admin_notes } = body;
    if (!["approved", "rejected"].includes(status)) {
      return json(res, 400, { ok: false, error: "status must be 'approved' or 'rejected'" });
    }
    const now = new Date().toISOString();
    const updates = { status, admin_notes: (admin_notes || "").trim(), updated_at: now };
    const ok = await updateCorrection(correctionId, updates);
    if (!ok) return json(res, 404, { ok: false, error: "Correction not found" });

    // If approved, update the attendance record too
    if (status === "approved") {
      const all = await readAllCorrections();
      const corr = all.find(c => c.correction_id === correctionId);
      if (corr && corr.staff_id && corr.date && corr.requested_status) {
        await upsertAttendance({
          staff_id: corr.staff_id,
          date: corr.date,
          status: corr.requested_status,
          source: "correction",
          notes: `Correction approved: ${corr.reason || ""}`,
        });
      }
    }

    json(res, 200, { ok: true });
  } catch (err) {
    console.error("[hr/corrections/update]", err.message);
    json(res, 500, { ok: false, error: err.message });
  }
}

module.exports = {
  handleListShifts, handleCreateShift, handleUpdateShift, handleDeleteShift,
  handleListAttendance, handleUpsertAttendance, handleBulkAttendance,
  handleSyncAttendance, handleAttendanceGrid,
  handleListCorrections, handleCreateCorrection, handleUpdateCorrection,
};

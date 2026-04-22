// api/hr-leave.js — HR Phase 3: Leave Engine API

const crypto = require("crypto");
const {
  readAllLeaveTypes, appendLeaveType, updateLeaveType, deleteLeaveType,
  readAllHolidayLists, appendHolidayList, updateHolidayList, deleteHolidayList,
  readAllHolidays, readHolidaysForList, appendHoliday, deleteHoliday, getActiveHolidayDates,
  readAllLeavePolicies, appendLeavePolicy, updateLeavePolicy, deleteLeavePolicy,
  readAllPolicyItems, readPolicyItems, appendPolicyItem, deletePolicyItem,
  readAllAllocations, readAllocationsForEmployee, readAllocationForEmployeeLeaveType,
  upsertAllocation, deductFromAllocation, writeAllocationsForEmployee,
  readAllApplications, readApplicationsForEmployee, readPendingApplications,
  appendApplication, updateApplication,
  countWorkingDays,
} = require("../lib/hr-leave");
const { readAllEmployees, updateEmployeeHr } = require("../lib/hr");
const { getCrewSession } = require("../lib/staff");
const { isAuthed } = require("../lib/auth");

function json(res, status, data) {
  res.writeHead(status, { "Content-Type": "application/json", "Cache-Control": "no-store" });
  res.end(JSON.stringify(data));
}

function readBody(req) {
  if (req._crewInjectedBody !== undefined) return Promise.resolve(req._crewInjectedBody);
  return new Promise((resolve) => {
    let data = "";
    req.on("data", c => { data += c; });
    req.on("end", () => { try { resolve(JSON.parse(data || "{}")); } catch { resolve({}); } });
  });
}

// ── Leave Types ─────────────────────────────────────────────────────────────────

async function handleListLeaveTypes(req, res) {
  try {
    const types = await readAllLeaveTypes();
    json(res, 200, { ok: true, leave_types: types });
  } catch (err) {
    console.error("[hr/leave-types]", err.message);
    json(res, 500, { ok: false, error: err.message });
  }
}

async function handleCreateLeaveType(req, res) {
  try {
    const { name, is_paid, days_per_year, carry_over } = await readBody(req);
    if (!name?.trim()) return json(res, 400, { ok: false, error: "name is required" });
    const record = {
      leave_type_id: crypto.randomUUID(),
      name: name.trim(),
      is_paid: is_paid ? "TRUE" : "FALSE",
      days_per_year: String(Number(days_per_year) || 0),
      carry_over: carry_over ? "TRUE" : "FALSE",
      created_at: new Date().toISOString(),
    };
    await appendLeaveType(record);
    json(res, 200, { ok: true, leave_type: record });
  } catch (err) {
    console.error("[hr/leave-types/create]", err.message);
    json(res, 500, { ok: false, error: err.message });
  }
}

async function handleUpdateLeaveType(req, res, id) {
  try {
    const body = await readBody(req);
    const updates = {};
    if (body.name !== undefined)        updates.name = body.name;
    if (body.is_paid !== undefined)     updates.is_paid = body.is_paid ? "TRUE" : "FALSE";
    if (body.days_per_year !== undefined) updates.days_per_year = String(Number(body.days_per_year) || 0);
    if (body.carry_over !== undefined)  updates.carry_over = body.carry_over ? "TRUE" : "FALSE";
    const ok = await updateLeaveType(id, updates);
    json(res, ok ? 200 : 404, { ok });
  } catch (err) {
    console.error("[hr/leave-types/update]", err.message);
    json(res, 500, { ok: false, error: err.message });
  }
}

async function handleDeleteLeaveType(req, res, id) {
  try {
    const ok = await deleteLeaveType(id);
    json(res, ok ? 200 : 404, { ok });
  } catch (err) {
    console.error("[hr/leave-types/delete]", err.message);
    json(res, 500, { ok: false, error: err.message });
  }
}

// ── Holiday Lists ───────────────────────────────────────────────────────────────

async function handleListHolidayLists(req, res) {
  try {
    const lists = await readAllHolidayLists();
    json(res, 200, { ok: true, holiday_lists: lists });
  } catch (err) {
    console.error("[hr/holiday-lists]", err.message);
    json(res, 500, { ok: false, error: err.message });
  }
}

async function handleCreateHolidayList(req, res) {
  try {
    const { name, year, is_active } = await readBody(req);
    if (!name?.trim() || !year) return json(res, 400, { ok: false, error: "name and year are required" });
    const record = {
      holiday_list_id: crypto.randomUUID(),
      name: name.trim(),
      year: String(year),
      is_active: is_active ? "TRUE" : "FALSE",
      created_at: new Date().toISOString(),
    };
    // If setting active, deactivate others
    if (is_active) {
      const lists = await readAllHolidayLists();
      for (const l of lists) {
        if (l.is_active === "TRUE") await updateHolidayList(l.holiday_list_id, { is_active: "FALSE" });
      }
    }
    await appendHolidayList(record);
    json(res, 200, { ok: true, holiday_list: record });
  } catch (err) {
    console.error("[hr/holiday-lists/create]", err.message);
    json(res, 500, { ok: false, error: err.message });
  }
}

async function handleUpdateHolidayList(req, res, id) {
  try {
    const body = await readBody(req);
    const updates = {};
    if (body.name !== undefined) updates.name = body.name;
    if (body.year !== undefined) updates.year = String(body.year);
    if (body.is_active !== undefined) {
      updates.is_active = body.is_active ? "TRUE" : "FALSE";
      if (body.is_active) {
        const lists = await readAllHolidayLists();
        for (const l of lists) {
          if (l.holiday_list_id !== id && l.is_active === "TRUE") {
            await updateHolidayList(l.holiday_list_id, { is_active: "FALSE" });
          }
        }
      }
    }
    const ok = await updateHolidayList(id, updates);
    json(res, ok ? 200 : 404, { ok });
  } catch (err) {
    console.error("[hr/holiday-lists/update]", err.message);
    json(res, 500, { ok: false, error: err.message });
  }
}

async function handleDeleteHolidayList(req, res, id) {
  try {
    const ok = await deleteHolidayList(id);
    json(res, ok ? 200 : 404, { ok });
  } catch (err) {
    console.error("[hr/holiday-lists/delete]", err.message);
    json(res, 500, { ok: false, error: err.message });
  }
}

// ── Holidays (entries within a list) ───────────────────────────────────────────

async function handleListHolidays(req, res) {
  try {
    const u = new URL(req.url, "http://localhost");
    const listId = u.searchParams.get("holiday_list_id");
    const holidays = listId ? await readHolidaysForList(listId) : await readAllHolidays();
    json(res, 200, { ok: true, holidays });
  } catch (err) {
    console.error("[hr/holidays]", err.message);
    json(res, 500, { ok: false, error: err.message });
  }
}

async function handleCreateHoliday(req, res) {
  try {
    const { holiday_list_id, date, name } = await readBody(req);
    if (!holiday_list_id || !date || !name?.trim()) {
      return json(res, 400, { ok: false, error: "holiday_list_id, date, and name are required" });
    }
    const record = {
      holiday_id: crypto.randomUUID(),
      holiday_list_id,
      date,
      name: name.trim(),
      created_at: new Date().toISOString(),
    };
    await appendHoliday(record);
    json(res, 200, { ok: true, holiday: record });
  } catch (err) {
    console.error("[hr/holidays/create]", err.message);
    json(res, 500, { ok: false, error: err.message });
  }
}

async function handleDeleteHoliday(req, res, id) {
  try {
    const ok = await deleteHoliday(id);
    json(res, ok ? 200 : 404, { ok });
  } catch (err) {
    console.error("[hr/holidays/delete]", err.message);
    json(res, 500, { ok: false, error: err.message });
  }
}

// ── Leave Policies ──────────────────────────────────────────────────────────────

async function handleListLeavePolicies(req, res) {
  try {
    const [policies, items] = await Promise.all([readAllLeavePolicies(), readAllPolicyItems()]);
    const itemsByPolicy = {};
    items.forEach(it => {
      if (!itemsByPolicy[it.leave_policy_id]) itemsByPolicy[it.leave_policy_id] = [];
      itemsByPolicy[it.leave_policy_id].push(it);
    });
    const result = policies.map(p => ({ ...p, items: itemsByPolicy[p.leave_policy_id] || [] }));
    json(res, 200, { ok: true, policies: result });
  } catch (err) {
    console.error("[hr/leave-policies]", err.message);
    json(res, 500, { ok: false, error: err.message });
  }
}

async function handleCreateLeavePolicy(req, res) {
  try {
    const { name, description } = await readBody(req);
    if (!name?.trim()) return json(res, 400, { ok: false, error: "name is required" });
    const record = {
      leave_policy_id: crypto.randomUUID(),
      name: name.trim(),
      description: (description || "").trim(),
      created_at: new Date().toISOString(),
    };
    await appendLeavePolicy(record);
    json(res, 200, { ok: true, policy: record });
  } catch (err) {
    console.error("[hr/leave-policies/create]", err.message);
    json(res, 500, { ok: false, error: err.message });
  }
}

async function handleUpdateLeavePolicy(req, res, id) {
  try {
    const body = await readBody(req);
    const updates = {};
    if (body.name !== undefined) updates.name = body.name;
    if (body.description !== undefined) updates.description = body.description;
    const ok = await updateLeavePolicy(id, updates);
    json(res, ok ? 200 : 404, { ok });
  } catch (err) {
    console.error("[hr/leave-policies/update]", err.message);
    json(res, 500, { ok: false, error: err.message });
  }
}

async function handleDeleteLeavePolicy(req, res, id) {
  try {
    const ok = await deleteLeavePolicy(id);
    json(res, ok ? 200 : 404, { ok });
  } catch (err) {
    console.error("[hr/leave-policies/delete]", err.message);
    json(res, 500, { ok: false, error: err.message });
  }
}

// ── Policy Items ────────────────────────────────────────────────────────────────

async function handleCreatePolicyItem(req, res) {
  try {
    const { leave_policy_id, leave_type_id, days_allocated } = await readBody(req);
    if (!leave_policy_id || !leave_type_id) {
      return json(res, 400, { ok: false, error: "leave_policy_id and leave_type_id are required" });
    }
    const record = {
      policy_item_id: crypto.randomUUID(),
      leave_policy_id,
      leave_type_id,
      days_allocated: String(Number(days_allocated) || 0),
      created_at: new Date().toISOString(),
    };
    await appendPolicyItem(record);
    json(res, 200, { ok: true, policy_item: record });
  } catch (err) {
    console.error("[hr/policy-items/create]", err.message);
    json(res, 500, { ok: false, error: err.message });
  }
}

async function handleDeletePolicyItem(req, res, id) {
  try {
    const ok = await deletePolicyItem(id);
    json(res, ok ? 200 : 404, { ok });
  } catch (err) {
    console.error("[hr/policy-items/delete]", err.message);
    json(res, 500, { ok: false, error: err.message });
  }
}

// ── Leave Allocations ───────────────────────────────────────────────────────────

// GET /api/hr/leave/allocations?staff_id=...
async function handleListAllocations(req, res) {
  try {
    const u = new URL(req.url, "http://localhost");
    const staffId = u.searchParams.get("staff_id");
    const year = u.searchParams.get("year") || String(new Date().getFullYear());
    let allocs = staffId ? await readAllocationsForEmployee(staffId) : await readAllAllocations();
    if (year) allocs = allocs.filter(a => a.year === year);
    json(res, 200, { ok: true, allocations: allocs });
  } catch (err) {
    console.error("[hr/leave/allocations]", err.message);
    json(res, 500, { ok: false, error: err.message });
  }
}

// POST /api/hr/leave/allocations/assign — assign policy to employee + write allocations
async function handleAssignPolicy(req, res) {
  try {
    const { staff_id, leave_policy_id, year } = await readBody(req);
    if (!staff_id || !leave_policy_id) {
      return json(res, 400, { ok: false, error: "staff_id and leave_policy_id are required" });
    }
    const targetYear = year || new Date().getFullYear();
    // Update employee's leave_policy_id field in Staff sheet
    await updateEmployeeHr(staff_id, { leave_policy_id });
    // Write allocation rows for all leave types in this policy
    await writeAllocationsForEmployee(staff_id, leave_policy_id, targetYear);
    json(res, 200, { ok: true });
  } catch (err) {
    console.error("[hr/leave/allocations/assign]", err.message);
    json(res, 500, { ok: false, error: err.message });
  }
}

// PATCH /api/hr/leave/allocations/:id — manually adjust an allocation
async function handleUpdateAllocation(req, res, allocId) {
  try {
    const body = await readBody(req);
    const allocs = await readAllAllocations();
    const alloc = allocs.find(a => a.allocation_id === allocId);
    if (!alloc) return json(res, 404, { ok: false, error: "Allocation not found" });
    const now = new Date().toISOString();
    const updates = {};
    if (body.days_allocated !== undefined) updates.days_allocated = String(Number(body.days_allocated) || 0);
    if (body.days_used !== undefined) updates.days_used = String(Number(body.days_used) || 0);
    await upsertAllocation({ ...alloc, ...updates, updated_at: now });
    json(res, 200, { ok: true });
  } catch (err) {
    console.error("[hr/leave/allocations/update]", err.message);
    json(res, 500, { ok: false, error: err.message });
  }
}

// ── Leave Applications ──────────────────────────────────────────────────────────

// GET /api/hr/leave/applications?staff_id=...&status=...
async function handleListApplications(req, res) {
  try {
    const u = new URL(req.url, "http://localhost");
    const staffId = u.searchParams.get("staff_id");
    const status  = u.searchParams.get("status");
    const managerId = u.searchParams.get("manager_id");
    let apps = staffId
      ? await readApplicationsForEmployee(staffId)
      : await readAllApplications();
    if (status)    apps = apps.filter(a => a.status === status);
    if (managerId) {
      // Return applications where the applicant reports to this manager
      const employees = await readAllEmployees();
      const subordinateIds = new Set(employees.filter(e => e.reports_to === managerId).map(e => e.staff_id));
      apps = apps.filter(a => subordinateIds.has(a.staff_id));
    }
    // Enrich with employee name and leave type name
    const [employees, leaveTypes] = await Promise.all([readAllEmployees(), readAllLeaveTypes()]);
    const empById  = {};
    employees.forEach(e => { empById[e.staff_id] = e; });
    const ltById = {};
    leaveTypes.forEach(lt => { ltById[lt.leave_type_id] = lt; });
    const enriched = apps.map(a => {
      const emp = empById[a.staff_id] || {};
      const lt  = ltById[a.leave_type_id] || {};
      const mgr = empById[a.manager_id] || {};
      return {
        ...a,
        employee_name: [emp.first_name, emp.last_name].filter(Boolean).join(" ") || "",
        leave_type_name: lt.name || "",
        department_id: emp.department_id || "",
        manager_name: [mgr.first_name, mgr.last_name].filter(Boolean).join(" ") || "",
      };
    });
    json(res, 200, { ok: true, applications: enriched });
  } catch (err) {
    console.error("[hr/leave/applications]", err.message);
    json(res, 500, { ok: false, error: err.message });
  }
}

// POST /api/hr/leave/applications — employee submits a leave application
async function handleCreateApplication(req, res) {
  try {
    const { staff_id, leave_type_id, from_date, to_date, half_day, reason } = await readBody(req);
    if (!staff_id || !leave_type_id || !from_date || !to_date) {
      return json(res, 400, { ok: false, error: "staff_id, leave_type_id, from_date, to_date are required" });
    }

    // If this request carries a crew session (self-service), enforce that the
    // staff_id in the body matches the session owner — crew members cannot submit
    // leave on behalf of others.
    const crewSession = getCrewSession(req);
    if (crewSession && crewSession.staffId !== staff_id) {
      return json(res, 403, { ok: false, error: "You can only submit leave requests for yourself" });
    }

    if (from_date > to_date) {
      return json(res, 400, { ok: false, error: "from_date must be on or before to_date" });
    }

    // Half-day requires a single day
    if (half_day && from_date !== to_date) {
      return json(res, 400, { ok: false, error: "Half-day requests must be for a single day (from_date must equal to_date)" });
    }

    const holidaySet = await getActiveHolidayDates();
    const days = countWorkingDays(from_date, to_date, holidaySet, !!half_day);

    if (days <= 0) {
      return json(res, 400, { ok: false, error: "Date range has no working days (all holidays or weekends)" });
    }

    const year = from_date.slice(0, 4);
    const alloc = await readAllocationForEmployeeLeaveType(staff_id, leave_type_id, year);
    if (!alloc) {
      return json(res, 400, { ok: false, error: "No leave balance allocated for this leave type and year. Please contact HR." });
    }
    const remaining = parseFloat(alloc.days_allocated || 0) - parseFloat(alloc.days_used || 0);
    if (days > remaining) {
      return json(res, 400, { ok: false, error: `Insufficient leave balance. Requested: ${days} days, Available: ${remaining} days` });
    }

    // Find manager
    const employees = await readAllEmployees();
    const emp = employees.find(e => e.staff_id === staff_id);
    const managerId = emp ? (emp.reports_to || "") : "";

    const now = new Date().toISOString();
    const record = {
      application_id: crypto.randomUUID(),
      staff_id,
      leave_type_id,
      from_date,
      to_date,
      half_day: half_day ? "TRUE" : "FALSE",
      reason: (reason || "").trim(),
      status: "pending",
      manager_id: managerId,
      manager_note: "",
      days_count: String(days),
      created_at: now,
      updated_at: now,
    };
    await appendApplication(record);
    json(res, 200, { ok: true, application: record });
  } catch (err) {
    console.error("[hr/leave/applications/create]", err.message);
    json(res, 500, { ok: false, error: err.message });
  }
}

// PATCH /api/hr/leave/applications/:id — manager approves or rejects
async function handleUpdateApplication(req, res, appId) {
  try {
    const { status, manager_note } = await readBody(req);
    if (!["approved", "rejected"].includes(status)) {
      return json(res, 400, { ok: false, error: "status must be 'approved' or 'rejected'" });
    }

    const all = await readAllApplications();
    const app = all.find(a => a.application_id === appId);
    if (!app) return json(res, 404, { ok: false, error: "Application not found" });
    if (app.status !== "pending") {
      return json(res, 400, { ok: false, error: "Application is already " + app.status });
    }

    // Manager authorization using server-side identity only:
    // - Crew session present: staffId from the verified token is the approver.
    //   If the application has an assigned manager, the crew session staffId must
    //   match app.manager_id — crew users cannot approve other managers' queues.
    // - Admin-only session (no crew session): treated as HR admin; full approval
    //   rights with no manager restriction (admin = HR supervisor).
    // - Neither session: should not reach here (auth guard blocks), but reject.
    const crewSess = getCrewSession(req);
    const adminAuthed = isAuthed(req);
    if (!crewSess && !adminAuthed) {
      return json(res, 401, { ok: false, error: "Authentication required" });
    }
    if (crewSess) {
      // Crew users must be the explicitly assigned manager — blank manager_id also blocked.
      const mgr = (app.manager_id || "").trim();
      if (!mgr || crewSess.staffId !== mgr) {
        return json(res, 403, { ok: false, error: "You are not the assigned manager for this application" });
      }
    }
    // (admin-only session → HR admin, no manager restriction, falls through)

    // Overlap check — warn if another employee in the same dept is off those dates (don't block, just flag)
    let overlapWarning = null;
    if (status === "approved") {
      const employees = await readAllEmployees();
      const thisEmp = employees.find(e => e.staff_id === app.staff_id) || {};
      const deptId = thisEmp.department_id || "";
      if (deptId) {
        const otherApps = all.filter(a =>
          a.application_id !== appId &&
          a.status === "approved" &&
          a.from_date <= app.to_date &&
          a.to_date >= app.from_date
        );
        const sameDeptOverlap = otherApps.filter(a => {
          const emp = employees.find(e => e.staff_id === a.staff_id);
          return emp && emp.department_id === deptId;
        });
        if (sameDeptOverlap.length > 0) {
          const names = sameDeptOverlap.map(a => {
            const e = employees.find(em => em.staff_id === a.staff_id) || {};
            return [e.first_name, e.last_name].filter(Boolean).join(" ");
          });
          overlapWarning = `Overlap: ${names.join(", ")} from same department also on leave during this period.`;
        }
      }
    }

    // Re-check balance at approval time to prevent overdraw from concurrent approvals
    if (status === "approved") {
      const year = app.from_date.slice(0, 4);
      const alloc = await readAllocationForEmployeeLeaveType(app.staff_id, app.leave_type_id, year);
      if (!alloc) {
        return json(res, 400, { ok: false, error: "Cannot approve: no leave balance record found for this employee and leave type. Assign a leave policy first." });
      }
      const remaining = parseFloat(alloc.days_allocated || 0) - parseFloat(alloc.days_used || 0);
      const requested = parseFloat(app.days_count || 0);
      if (requested > remaining) {
        return json(res, 400, { ok: false, error: `Insufficient leave balance at time of approval. Available: ${remaining} days, Requested: ${requested} days` });
      }
    }

    const now = new Date().toISOString();
    await updateApplication(appId, {
      status,
      manager_note: (manager_note || "").trim(),
      updated_at: now,
    });

    // Deduct from balance on approval — fail-close for both false return and exceptions
    if (status === "approved") {
      const year = app.from_date.slice(0, 4);
      let deducted = false;
      let deductionError = null;
      try {
        deducted = await deductFromAllocation(app.staff_id, app.leave_type_id, year, parseFloat(app.days_count || 0));
      } catch (deductErr) {
        deductionError = deductErr.message;
      }
      if (!deducted || deductionError) {
        // Roll back approval to pending — allocation may have vanished or deduction threw
        try { await updateApplication(appId, { status: "pending", manager_note: "", updated_at: now }); } catch (_) {}
        return json(res, 500, { ok: false, error: "Balance deduction failed" + (deductionError ? ": " + deductionError : " (allocation record missing)") + ". Application reset to pending. Please contact HR." });
      }
    }

    json(res, 200, { ok: true, overlap_warning: overlapWarning });
  } catch (err) {
    console.error("[hr/leave/applications/update]", err.message);
    json(res, 500, { ok: false, error: err.message });
  }
}

// GET /api/hr/leave/team-calendar?manager_id=...&week_start=YYYY-MM-DD
// Returns approved leave for team members this week
async function handleTeamCalendar(req, res) {
  try {
    const u = new URL(req.url, "http://localhost");
    const managerId  = u.searchParams.get("manager_id") || "";
    const deptFilter = u.searchParams.get("department_id") || "";
    const weekStart  = u.searchParams.get("week_start") || new Date().toISOString().slice(0, 10);

    const weekEnd = (() => {
      const d = new Date(weekStart + "T12:00:00Z");
      d.setUTCDate(d.getUTCDate() + 6);
      return d.toISOString().slice(0, 10);
    })();

    const [apps, employees, leaveTypes] = await Promise.all([
      readAllApplications(),
      readAllEmployees(),
      readAllLeaveTypes(),
    ]);

    let teamIds;
    if (managerId) {
      teamIds = new Set(employees.filter(e => e.reports_to === managerId).map(e => e.staff_id));
    } else if (deptFilter) {
      teamIds = new Set(employees.filter(e => e.department_id === deptFilter).map(e => e.staff_id));
    }

    const empById = {};
    employees.forEach(e => { empById[e.staff_id] = e; });
    const ltById = {};
    leaveTypes.forEach(lt => { ltById[lt.leave_type_id] = lt; });

    const relevant = apps.filter(a => {
      if (a.status !== "approved") return false;
      if (a.to_date < weekStart || a.from_date > weekEnd) return false;
      if (teamIds && !teamIds.has(a.staff_id)) return false;
      return true;
    }).map(a => {
      const emp = empById[a.staff_id] || {};
      const lt  = ltById[a.leave_type_id] || {};
      return {
        ...a,
        employee_name: [emp.first_name, emp.last_name].filter(Boolean).join(" ") || "",
        leave_type_name: lt.name || "",
        department_id: emp.department_id || "",
      };
    });

    json(res, 200, { ok: true, week_start: weekStart, week_end: weekEnd, leave: relevant });
  } catch (err) {
    console.error("[hr/leave/team-calendar]", err.message);
    json(res, 500, { ok: false, error: err.message });
  }
}

// GET /api/hr/leave/pending-count — for sidebar badge
async function handleLeavePendingCount(req, res) {
  try {
    const pending = await readPendingApplications();
    json(res, 200, { ok: true, count: pending.length });
  } catch (err) {
    json(res, 200, { ok: true, count: 0 });
  }
}

module.exports = {
  handleListLeaveTypes, handleCreateLeaveType, handleUpdateLeaveType, handleDeleteLeaveType,
  handleListHolidayLists, handleCreateHolidayList, handleUpdateHolidayList, handleDeleteHolidayList,
  handleListHolidays, handleCreateHoliday, handleDeleteHoliday,
  handleListLeavePolicies, handleCreateLeavePolicy, handleUpdateLeavePolicy, handleDeleteLeavePolicy,
  handleCreatePolicyItem, handleDeletePolicyItem,
  handleListAllocations, handleAssignPolicy, handleUpdateAllocation,
  handleListApplications, handleCreateApplication, handleUpdateApplication,
  handleTeamCalendar, handleLeavePendingCount,
};

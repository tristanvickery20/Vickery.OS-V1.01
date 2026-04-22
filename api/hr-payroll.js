// api/hr-payroll.js — HR Phase 6: Expense Claims & Payroll Engine

const crypto = require("crypto");
const {
  readAllClaims, readAllClaimItems, readClaimsForEmployee,
  appendClaim, updateClaim, deleteClaim,
  appendClaimItem, deleteClaimItemsByClaim,
  readAllComponents, appendComponent, updateComponent, deleteComponent,
  readAllStructures, readAllStructureItems, appendStructure, updateStructure, deleteStructure,
  appendStructureItem, deleteStructureItem, deleteStructureItems,
  readAllAssignments, readAssignmentsForEmployee, activeAssignment, appendAssignment, deleteAssignment,
  readPayrollSettings, savePayrollSettings,
  readAllRuns, readRun, appendRun, updateRun,
  readRunAdditions, appendRunAddition, deleteRunAddition,
  readAllSlips, readSlipsForRun, readSlipByToken, readSlip, appendSlip, updateSlip,
  computeEmployeePay,
} = require("../lib/hr-payroll");
const { readAllEmployees } = require("../lib/hr");
const { getCrewSession } = require("../lib/staff");
const { readAllAttendance } = require("../lib/hr-attendance");
const { readAllHolidays, readAllHolidayLists, readAllApplications } = require("../lib/hr-leave");

/**
 * Load holiday dates from the active holiday list for a given year.
 * Returns a Set of date strings ("YYYY-MM-DD") for quick lookup.
 */
async function loadHolidayDates(periodStart, periodEnd) {
  const [lists, holidays] = await Promise.all([readAllHolidayLists(), readAllHolidays()]);
  const year = periodStart.slice(0, 4);
  const activeList = lists.find(l => l.is_active === "true" || l.is_active === "1" || l.year === year);
  if (!activeList) return new Set();
  return new Set(
    holidays
      .filter(h => h.holiday_list_id === activeList.holiday_list_id && h.date >= periodStart && h.date <= periodEnd)
      .map(h => h.date)
  );
}

/**
 * Compute the count of weekday holidays that overlap with the given period.
 * Used to derive both the worked-day numerator and payable-day denominator.
 */
function countHolidayWeekdays(holidayDates, settings) {
  const excludeHolidays = (settings.holiday_handling || "exclude").toLowerCase() === "exclude";
  if (!excludeHolidays) return 0;
  return [...(holidayDates || new Set())].filter(d => {
    const dow = new Date(d + "T00:00:00").getDay();
    return dow !== 0 && dow !== 6;
  }).length;
}

/**
 * Count working days for one employee in a period, respecting payroll settings.
 * Sources:
 *   "calendar"   — weekdays minus holidays (pure calendar)
 *   "attendance" — attendance records; falls back to calendar if none exist
 *   "leave"      — calendar minus approved leave days in the period
 * Honors holiday_handling: "exclude" removes holidays from the count.
 *
 * @returns {number} worked days (numerator for proration)
 */
function resolveWorkingDays(allAttendance, staffId, periodStart, periodEnd, settings, weekdayCount, holidayDates, allLeaveApplications) {
  const source = (settings.working_day_source || "calendar").toLowerCase();
  const halfFrac = parseFloat(settings.half_day_fraction) || 0.5;
  const holidays = holidayDates || new Set();
  const excludeHolidays = (settings.holiday_handling || "exclude").toLowerCase() === "exclude";
  const hwc = countHolidayWeekdays(holidays, settings);
  const payableWorkdays = weekdayCount - hwc;

  if (source === "attendance") {
    const records = allAttendance.filter(a =>
      a.staff_id === staffId && a.date >= periodStart && a.date <= periodEnd
    );
    if (records.length === 0) return payableWorkdays; // no data — fall back to full calendar capacity
    let days = 0;
    for (const r of records) {
      if (excludeHolidays && holidays.has(r.date)) continue; // skip holidays even if marked Present
      const s = String(r.status || "").toLowerCase();
      if (s === "present" || s === "p") days += 1;
      else if (s === "half" || s === "half-day" || s === "half day" || s === "hd") days += halfFrac;
      // absent / other = 0
    }
    return days;
  }

  if (source === "leave") {
    // Payable days = calendar capacity minus approved leave days in the period
    const leaves = (allLeaveApplications || []).filter(a =>
      a.staff_id === staffId &&
      (String(a.status || "")).toLowerCase() === "approved" &&
      a.from_date <= periodEnd && a.to_date >= periodStart
    );
    let leaveDays = 0;
    for (const lv of leaves) {
      const lvStart = lv.from_date > periodStart ? lv.from_date : periodStart;
      const lvEnd   = lv.to_date   < periodEnd   ? lv.to_date   : periodEnd;
      for (let d = new Date(lvStart + "T00:00:00"); d <= new Date(lvEnd + "T00:00:00"); d.setDate(d.getDate() + 1)) {
        const ds = d.toISOString().slice(0, 10);
        const dow = d.getDay();
        if (dow === 0 || dow === 6) continue;
        if (excludeHolidays && holidays.has(ds)) continue;
        leaveDays++;
      }
    }
    return Math.max(0, payableWorkdays - leaveDays);
  }

  // "calendar" source (default) — weekdays minus holidays
  return payableWorkdays;
}

function json(res, status, data) {
  res.writeHead(status, { "Content-Type": "application/json", "Cache-Control": "no-store" });
  res.end(JSON.stringify(data));
}

function readBody(req) {
  if (req._crewInjectedBody !== undefined) return Promise.resolve(req._crewInjectedBody);
  return new Promise((resolve) => {
    let data = "";
    req.on("data", c => { data += c; if (data.length > 200000) { data = "{}"; } });
    req.on("end", () => { try { resolve(JSON.parse(data || "{}")); } catch { resolve({}); } });
  });
}

function parseQuery(url) {
  const q = {};
  const i = url.indexOf("?");
  if (i === -1) return q;
  url.slice(i + 1).split("&").forEach(p => {
    const [k, v] = p.split("=");
    if (k) q[decodeURIComponent(k)] = decodeURIComponent(v || "");
  });
  return q;
}

// ── Expense Claims — Admin ────────────────────────────────────────────────────

async function handleListClaims(req, res) {
  try {
    const claims = await readAllClaims();
    const items = await readAllClaimItems();
    const employees = await readAllEmployees();
    const enriched = claims.map(c => {
      const emp = employees.find(e => e.staff_id === c.staff_id);
      return {
        ...c,
        employee_name: emp ? `${emp.first_name || ""} ${emp.last_name || ""}`.trim() : c.staff_id,
        items: items.filter(i => i.claim_id === c.claim_id),
      };
    }).sort((a, b) => b.created_at.localeCompare(a.created_at));
    json(res, 200, { ok: true, claims: enriched });
  } catch (err) {
    console.error("[hr/claims]", err.message);
    json(res, 500, { ok: false, error: err.message });
  }
}

async function handleGetClaim(req, res, claimId) {
  try {
    const claims = await readAllClaims();
    const claim = claims.find(c => c.claim_id === claimId);
    if (!claim) return json(res, 404, { ok: false, error: "Not found" });
    const items = await readAllClaimItems();
    claim.items = items.filter(i => i.claim_id === claimId);
    json(res, 200, { ok: true, claim });
  } catch (err) {
    json(res, 500, { ok: false, error: err.message });
  }
}

// Valid status state machine: submitted → approved | rejected; approved → paid
const CLAIM_TRANSITIONS = {
  submitted: new Set(["approved", "rejected"]),
  approved:  new Set(["paid"]),
  rejected:  new Set([]),
  paid:      new Set([]),
};

async function handleAdminUpdateClaim(req, res, claimId) {
  try {
    const body = await readBody(req);

    // Enforce state machine transitions when status is being changed
    if (body.status) {
      const claims = await readAllClaims();
      const claim = claims.find(c => c.claim_id === claimId);
      if (!claim) return json(res, 404, { ok: false, error: "Claim not found" });
      const cur = (claim.status || "submitted").toLowerCase();
      const next = String(body.status).toLowerCase();
      const allowed = CLAIM_TRANSITIONS[cur] || new Set();
      if (!allowed.has(next)) {
        return json(res, 400, {
          ok: false,
          error: `Cannot transition claim from "${cur}" to "${next}". ` +
                 (allowed.size ? `Allowed: ${[...allowed].join(", ")}.` : "No further transitions allowed."),
        });
      }
    }

    const allowedFields = ["status", "manager_note", "manager_id", "reviewed_at", "paid_at"];
    const updates = {};
    for (const f of allowedFields) {
      if (body[f] !== undefined) updates[f] = body[f];
    }
    // Auto-stamp timestamps on status changes
    if (body.status === "approved" && !updates.reviewed_at) updates.reviewed_at = new Date().toISOString();
    if (body.status === "rejected" && !updates.reviewed_at) updates.reviewed_at = new Date().toISOString();
    if (body.status === "paid"     && !updates.paid_at)     updates.paid_at     = new Date().toISOString();

    const ok = await updateClaim(claimId, updates);
    json(res, ok ? 200 : 404, { ok });
  } catch (err) {
    json(res, 500, { ok: false, error: err.message });
  }
}

async function handleDeleteClaim(req, res, claimId) {
  try {
    await deleteClaimItemsByClaim(claimId);
    const ok = await deleteClaim(claimId);
    json(res, ok ? 200 : 404, { ok });
  } catch (err) {
    json(res, 500, { ok: false, error: err.message });
  }
}

// ── Expense Claims — Crew ─────────────────────────────────────────────────────

async function handleCrewListClaims(req, res) {
  try {
    const session = getCrewSession(req);
    if (!session?.staffId) return json(res, 401, { ok: false, error: "Not authenticated" });
    const claims = await readClaimsForEmployee(session.staffId);
    const items = await readAllClaimItems();
    const enriched = claims.map(c => ({ ...c, items: items.filter(i => i.claim_id === c.claim_id) }))
      .sort((a, b) => b.created_at.localeCompare(a.created_at));
    json(res, 200, { ok: true, claims: enriched });
  } catch (err) {
    json(res, 500, { ok: false, error: err.message });
  }
}

async function handleCrewCreateClaim(req, res) {
  try {
    const session = getCrewSession(req);
    if (!session?.staffId) return json(res, 401, { ok: false, error: "Not authenticated" });
    const body = await readBody(req);
    if (!body.claim_date) return json(res, 400, { ok: false, error: "claim_date required" });
    if (!Array.isArray(body.items) || body.items.length === 0)
      return json(res, 400, { ok: false, error: "At least one item required" });

    const claimId = crypto.randomUUID();
    const now = new Date().toISOString();
    const claim = {
      claim_id: claimId,
      staff_id: session.staffId,
      claim_date: body.claim_date,
      job_id: body.job_id || "",
      notes: body.notes || "",
      status: "submitted",
      manager_id: "",
      manager_note: "",
      submitted_at: now,
      reviewed_at: "",
      paid_at: "",
      created_at: now,
    };
    await appendClaim(claim);

    for (const item of body.items) {
      await appendClaimItem({
        item_id: crypto.randomUUID(),
        claim_id: claimId,
        category: item.category || "Other",
        amount: String(parseFloat(item.amount) || 0),
        receipt_url: item.receipt_url || "",
        description: item.description || "",
        item_date: item.item_date || "",
        created_at: now,
      });
    }
    json(res, 200, { ok: true, claim_id: claimId });
  } catch (err) {
    console.error("[hr/crew/claims/create]", err.message);
    json(res, 500, { ok: false, error: err.message });
  }
}

async function handleCrewDeleteClaim(req, res, claimId) {
  try {
    const session = getCrewSession(req);
    if (!session?.staffId) return json(res, 401, { ok: false, error: "Not authenticated" });
    const claims = await readAllClaims();
    const claim = claims.find(c => c.claim_id === claimId);
    if (!claim) return json(res, 404, { ok: false, error: "Not found" });
    if (claim.staff_id !== session.staffId) return json(res, 403, { ok: false, error: "Forbidden" });
    if (claim.status !== "submitted") return json(res, 400, { ok: false, error: "Only submitted claims can be deleted" });
    await deleteClaimItemsByClaim(claimId);
    await deleteClaim(claimId);
    json(res, 200, { ok: true });
  } catch (err) {
    json(res, 500, { ok: false, error: err.message });
  }
}

// ── Salary Components ─────────────────────────────────────────────────────────

async function handleListComponents(req, res) {
  try {
    json(res, 200, { ok: true, components: await readAllComponents() });
  } catch (err) {
    json(res, 500, { ok: false, error: err.message });
  }
}

async function handleCreateComponent(req, res) {
  try {
    const { name, type, value_type, amount, formula, taxable } = await readBody(req);
    if (!name?.trim()) return json(res, 400, { ok: false, error: "name required" });
    if (!["Earning", "Deduction"].includes(type)) return json(res, 400, { ok: false, error: "type must be Earning or Deduction" });
    if (!["Fixed", "Formula"].includes(value_type)) return json(res, 400, { ok: false, error: "value_type must be Fixed or Formula" });
    const record = {
      component_id: crypto.randomUUID(),
      name: name.trim(),
      type,
      value_type,
      amount: value_type === "Fixed" ? String(parseFloat(amount) || 0) : "",
      formula: value_type === "Formula" ? (formula || "") : "",
      taxable: taxable ? "TRUE" : "FALSE",
      created_at: new Date().toISOString(),
    };
    await appendComponent(record);
    json(res, 200, { ok: true, component: record });
  } catch (err) {
    json(res, 500, { ok: false, error: err.message });
  }
}

async function handleUpdateComponent(req, res, id) {
  try {
    const body = await readBody(req);
    const updates = {};
    if (body.name !== undefined) updates.name = body.name;
    if (body.type !== undefined) updates.type = body.type;
    if (body.value_type !== undefined) updates.value_type = body.value_type;
    if (body.amount !== undefined) updates.amount = String(parseFloat(body.amount) || 0);
    if (body.formula !== undefined) updates.formula = body.formula;
    if (body.taxable !== undefined) updates.taxable = body.taxable ? "TRUE" : "FALSE";
    const ok = await updateComponent(id, updates);
    json(res, ok ? 200 : 404, { ok });
  } catch (err) {
    json(res, 500, { ok: false, error: err.message });
  }
}

async function handleDeleteComponent(req, res, id) {
  try {
    const ok = await deleteComponent(id);
    json(res, ok ? 200 : 404, { ok });
  } catch (err) {
    json(res, 500, { ok: false, error: err.message });
  }
}

// ── Salary Structures ─────────────────────────────────────────────────────────

async function handleListStructures(req, res) {
  try {
    const structures = await readAllStructures();
    const allItems = await readAllStructureItems();
    const allComps = await readAllComponents();
    const enriched = structures.map(s => ({
      ...s,
      items: allItems
        .filter(i => i.structure_id === s.structure_id)
        .sort((a, b) => parseInt(a.order_index) - parseInt(b.order_index))
        .map(i => ({ ...i, component: allComps.find(c => c.component_id === i.component_id) || null })),
    }));
    json(res, 200, { ok: true, structures: enriched });
  } catch (err) {
    json(res, 500, { ok: false, error: err.message });
  }
}

async function handleCreateStructure(req, res) {
  try {
    const { name, description, items } = await readBody(req);
    if (!name?.trim()) return json(res, 400, { ok: false, error: "name required" });
    const structureId = crypto.randomUUID();
    const now = new Date().toISOString();
    await appendStructure({ structure_id: structureId, name: name.trim(), description: description || "", created_at: now });
    for (let i = 0; i < (items || []).length; i++) {
      await appendStructureItem({ item_id: crypto.randomUUID(), structure_id: structureId, component_id: items[i].component_id, order_index: String(i), created_at: now });
    }
    json(res, 200, { ok: true, structure_id: structureId });
  } catch (err) {
    json(res, 500, { ok: false, error: err.message });
  }
}

async function handleUpdateStructure(req, res, id) {
  try {
    const { name, description, items } = await readBody(req);
    const updates = {};
    if (name !== undefined) updates.name = name;
    if (description !== undefined) updates.description = description;
    if (Object.keys(updates).length) await updateStructure(id, updates);
    if (Array.isArray(items)) {
      await deleteStructureItems(id);
      const now = new Date().toISOString();
      for (let i = 0; i < items.length; i++) {
        await appendStructureItem({ item_id: crypto.randomUUID(), structure_id: id, component_id: items[i].component_id, order_index: String(i), created_at: now });
      }
    }
    json(res, 200, { ok: true });
  } catch (err) {
    json(res, 500, { ok: false, error: err.message });
  }
}

async function handleDeleteStructure(req, res, id) {
  try {
    await deleteStructureItems(id);
    const ok = await deleteStructure(id);
    json(res, ok ? 200 : 404, { ok });
  } catch (err) {
    json(res, 500, { ok: false, error: err.message });
  }
}

// ── Salary Assignments ────────────────────────────────────────────────────────

async function handleListAssignments(req, res) {
  try {
    const q = parseQuery(req.url);
    let assignments = await readAllAssignments();
    if (q.staff_id) assignments = assignments.filter(a => a.staff_id === q.staff_id);
    const structures = await readAllStructures();
    const enriched = assignments.map(a => ({
      ...a,
      structure_name: structures.find(s => s.structure_id === a.structure_id)?.name || "",
    })).sort((a, b) => b.effective_date.localeCompare(a.effective_date));
    json(res, 200, { ok: true, assignments: enriched });
  } catch (err) {
    json(res, 500, { ok: false, error: err.message });
  }
}

async function handleCreateAssignment(req, res) {
  try {
    const { staff_id, structure_id, base_amount, effective_date, currency } = await readBody(req);
    if (!staff_id || !structure_id || !effective_date)
      return json(res, 400, { ok: false, error: "staff_id, structure_id, effective_date required" });
    const record = {
      assignment_id: crypto.randomUUID(),
      staff_id,
      structure_id,
      base_amount: String(parseFloat(base_amount) || 0),
      effective_date,
      currency: currency || "USD",
      created_at: new Date().toISOString(),
    };
    await appendAssignment(record);
    json(res, 200, { ok: true, assignment: record });
  } catch (err) {
    json(res, 500, { ok: false, error: err.message });
  }
}

async function handleDeleteAssignment(req, res, id) {
  try {
    const ok = await deleteAssignment(id);
    json(res, ok ? 200 : 404, { ok });
  } catch (err) {
    json(res, 500, { ok: false, error: err.message });
  }
}

// ── Payroll Settings ──────────────────────────────────────────────────────────

async function handleGetSettings(req, res) {
  try {
    json(res, 200, { ok: true, settings: await readPayrollSettings() });
  } catch (err) {
    json(res, 500, { ok: false, error: err.message });
  }
}

async function handleSaveSettings(req, res) {
  try {
    const body = await readBody(req);
    const settings = {
      working_day_source: body.working_day_source || "attendance",
      holiday_handling:   body.holiday_handling || "exclude",
      half_day_fraction:  String(parseFloat(body.half_day_fraction) || 0.5),
      pay_period_type:    body.pay_period_type || "monthly",
    };
    await savePayrollSettings(settings);
    json(res, 200, { ok: true, settings });
  } catch (err) {
    json(res, 500, { ok: false, error: err.message });
  }
}

// ── Payroll Runs ──────────────────────────────────────────────────────────────

async function handleListRuns(req, res) {
  try {
    const runs = await readAllRuns();
    json(res, 200, { ok: true, runs: runs.sort((a, b) => b.created_at.localeCompare(a.created_at)) });
  } catch (err) {
    json(res, 500, { ok: false, error: err.message });
  }
}

async function handleCreateRun(req, res) {
  try {
    const { pay_period_start, pay_period_end, department_id } = await readBody(req);
    if (!pay_period_start || !pay_period_end) return json(res, 400, { ok: false, error: "pay_period_start and pay_period_end required" });
    const run = {
      run_id: crypto.randomUUID(),
      pay_period_start,
      pay_period_end,
      department_id: department_id || "",
      status: "draft",
      created_by: "",
      finalized_at: "",
      created_at: new Date().toISOString(),
    };
    await appendRun(run);
    json(res, 200, { ok: true, run });
  } catch (err) {
    json(res, 500, { ok: false, error: err.message });
  }
}

async function handleGetRunPreview(req, res, runId) {
  try {
    const run = await readRun(runId);
    if (!run) return json(res, 404, { ok: false, error: "Run not found" });
    const [additions, employees, assignments, settings, allAttendance, allLeaveApplications] = await Promise.all([
      readRunAdditions(runId),
      readAllEmployees(),
      readAllAssignments(),
      readPayrollSettings(),
      readAllAttendance(),
      readAllApplications(),
    ]);
    const holidayDates = await loadHolidayDates(run.pay_period_start, run.pay_period_end);

    // Calculate calendar weekday count in the period
    const start = new Date(run.pay_period_start);
    const end = new Date(run.pay_period_end);
    let weekdayCount = 0;
    for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
      const dow = d.getDay();
      if (dow !== 0 && dow !== 6) weekdayCount++;
    }
    // Payable working-day capacity for the period (denominator for proration)
    const payableWorkdays = weekdayCount - countHolidayWeekdays(holidayDates, settings);

    // Filter employees who have an active assignment as of period end
    const periodEnd = run.pay_period_end;
    const activeEmps = employees.filter(emp => {
      if (emp.employment_status === "terminated") return false;
      if (run.department_id && emp.department_id !== run.department_id) return false;
      return assignments.some(a => a.staff_id === emp.staff_id && a.effective_date <= periodEnd);
    });

    const previews = [];
    for (const emp of activeEmps) {
      // Resolve actual working days (numerator) — uses attendance, leave, or calendar per settings
      const workDays = resolveWorkingDays(
        allAttendance, emp.staff_id, run.pay_period_start, periodEnd, settings, weekdayCount, holidayDates, allLeaveApplications
      );
      // Prorate using payableWorkdays as denominator so full attendance → 100% base pay
      const pay = await computeEmployeePay(
        emp.staff_id, run.pay_period_start, periodEnd, workDays, payableWorkdays,
        additions.filter(a => a.staff_id === emp.staff_id), settings
      );
      if (!pay) continue;
      previews.push({
        staff_id: emp.staff_id,
        name: `${emp.first_name || ""} ${emp.last_name || ""}`.trim() || emp.staff_id,
        ...pay,
        working_days: workDays,
        payable_workdays: payableWorkdays,
        additions: additions.filter(a => a.staff_id === emp.staff_id),
      });
    }

    json(res, 200, { ok: true, run, previews, additions, settings });
  } catch (err) {
    console.error("[hr/payroll/run/preview]", err.message);
    json(res, 500, { ok: false, error: err.message });
  }
}

async function handleFinalizeRun(req, res, runId) {
  try {
    const run = await readRun(runId);
    if (!run) return json(res, 404, { ok: false, error: "Run not found" });
    if (run.status === "finalized") return json(res, 400, { ok: false, error: "Already finalized" });

    const [additions, employees, assignments, settings, allAttendance, allLeaveApplications] = await Promise.all([
      readRunAdditions(runId),
      readAllEmployees(),
      readAllAssignments(),
      readPayrollSettings(),
      readAllAttendance(),
      readAllApplications(),
    ]);
    const holidayDates = await loadHolidayDates(run.pay_period_start, run.pay_period_end);

    const periodEnd = run.pay_period_end;
    const start = new Date(run.pay_period_start);
    const end = new Date(run.pay_period_end);
    let weekdayCount = 0;
    for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
      const dow = d.getDay();
      if (dow !== 0 && dow !== 6) weekdayCount++;
    }
    // Payable working-day capacity (denominator) — so full attendance → 100% base pay
    const payableWorkdays = weekdayCount - countHolidayWeekdays(holidayDates, settings);

    const now = new Date().toISOString();
    let slipsCreated = 0;
    for (const emp of employees) {
      if (emp.employment_status === "terminated") continue;
      if (run.department_id && emp.department_id !== run.department_id) continue;
      // Only include employees with an assignment active as of period end
      const hasAssignment = assignments.some(a => a.staff_id === emp.staff_id && a.effective_date <= periodEnd);
      if (!hasAssignment) continue;

      // Resolve per-employee working days (numerator) using payroll settings
      const workDays = resolveWorkingDays(
        allAttendance, emp.staff_id, run.pay_period_start, periodEnd, settings, weekdayCount, holidayDates, allLeaveApplications
      );
      const pay = await computeEmployeePay(
        emp.staff_id, run.pay_period_start, periodEnd, workDays, payableWorkdays,
        additions.filter(a => a.staff_id === emp.staff_id), settings
      );
      if (!pay) continue;

      await appendSlip({
        slip_id: crypto.randomUUID(),
        run_id: runId,
        staff_id: emp.staff_id,
        pay_period_start: run.pay_period_start,
        pay_period_end: run.pay_period_end,
        base_amount: String(pay.base_amount),
        gross_earnings: String(pay.gross_earnings),
        total_deductions: String(pay.total_deductions),
        net_pay: String(pay.net_pay),
        working_days: String(pay.working_days),
        total_days: String(pay.total_days),
        earnings_detail: pay.earnings_detail,
        deductions_detail: pay.deductions_detail,
        share_token: crypto.randomBytes(16).toString("hex"),
        status: "finalized",
        created_at: now,
      });
      slipsCreated++;
    }

    await updateRun(runId, { status: "finalized", finalized_at: now });
    json(res, 200, { ok: true, slips_created: slipsCreated });
  } catch (err) {
    console.error("[hr/payroll/run/finalize]", err.message);
    json(res, 500, { ok: false, error: err.message });
  }
}

async function handleRunAdditions(req, res, runId) {
  try {
    if (req.method === "GET") {
      const additions = await readRunAdditions(runId);
      return json(res, 200, { ok: true, additions });
    }
    if (req.method === "POST") {
      const { staff_id, description, amount, type } = await readBody(req);
      if (!staff_id || !amount || !type) return json(res, 400, { ok: false, error: "staff_id, amount, type required" });
      if (!["bonus", "deduction"].includes(type)) return json(res, 400, { ok: false, error: "type must be bonus or deduction" });
      const record = { addition_id: crypto.randomUUID(), run_id: runId, staff_id, description: description || "", amount: String(parseFloat(amount) || 0), type, created_at: new Date().toISOString() };
      await appendRunAddition(record);
      return json(res, 200, { ok: true, addition: record });
    }
  } catch (err) {
    json(res, 500, { ok: false, error: err.message });
  }
}

async function handleDeleteRunAddition(req, res, additionId) {
  try {
    const ok = await deleteRunAddition(additionId);
    json(res, ok ? 200 : 404, { ok });
  } catch (err) {
    json(res, 500, { ok: false, error: err.message });
  }
}

// ── Salary Slips ──────────────────────────────────────────────────────────────

async function handleListSlips(req, res) {
  try {
    const q = parseQuery(req.url);
    let slips = q.run_id ? await readSlipsForRun(q.run_id) : await readAllSlips();
    const employees = await readAllEmployees();
    const enriched = slips.map(s => {
      const emp = employees.find(e => e.staff_id === s.staff_id);
      return { ...s, employee_name: emp ? `${emp.first_name || ""} ${emp.last_name || ""}`.trim() : s.staff_id };
    });
    json(res, 200, { ok: true, slips: enriched });
  } catch (err) {
    json(res, 500, { ok: false, error: err.message });
  }
}

async function handleGetSlip(req, res, slipId) {
  try {
    const slip = await readSlip(slipId);
    if (!slip) return json(res, 404, { ok: false, error: "Not found" });
    const employees = await readAllEmployees();
    const emp = employees.find(e => e.staff_id === slip.staff_id);
    slip.employee_name = emp ? `${emp.first_name || ""} ${emp.last_name || ""}`.trim() : slip.staff_id;
    json(res, 200, { ok: true, slip });
  } catch (err) {
    json(res, 500, { ok: false, error: err.message });
  }
}

// Public: salary slip by share token (no auth required)
async function handlePublicSlip(req, res, token) {
  try {
    const slip = await readSlipByToken(token);
    if (!slip) return json(res, 404, { ok: false, error: "Slip not found or link expired" });
    const employees = await readAllEmployees();
    const emp = employees.find(e => e.staff_id === slip.staff_id);
    const out = {
      employee_name: emp ? `${emp.first_name || ""} ${emp.last_name || ""}`.trim() : "Employee",
      pay_period_start: slip.pay_period_start,
      pay_period_end: slip.pay_period_end,
      base_amount: slip.base_amount,
      gross_earnings: slip.gross_earnings,
      total_deductions: slip.total_deductions,
      net_pay: slip.net_pay,
      working_days: slip.working_days,
      total_days: slip.total_days,
      earnings_detail: slip.earnings_detail,
      deductions_detail: slip.deductions_detail,
      status: slip.status,
    };
    json(res, 200, { ok: true, slip: out });
  } catch (err) {
    json(res, 500, { ok: false, error: err.message });
  }
}

module.exports = {
  // Claims
  handleListClaims, handleGetClaim, handleAdminUpdateClaim, handleDeleteClaim,
  handleCrewListClaims, handleCrewCreateClaim, handleCrewDeleteClaim,
  // Components
  handleListComponents, handleCreateComponent, handleUpdateComponent, handleDeleteComponent,
  // Structures
  handleListStructures, handleCreateStructure, handleUpdateStructure, handleDeleteStructure,
  // Assignments
  handleListAssignments, handleCreateAssignment, handleDeleteAssignment,
  // Settings
  handleGetSettings, handleSaveSettings,
  // Runs
  handleListRuns, handleCreateRun, handleGetRunPreview, handleFinalizeRun,
  handleRunAdditions, handleDeleteRunAddition,
  // Slips
  handleListSlips, handleGetSlip, handlePublicSlip,
};

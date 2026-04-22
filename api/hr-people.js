// api/hr-people.js — HR People API: Departments, Designations, Employees

const crypto = require("crypto");
const {
  readAllDepartments, appendDepartment, updateDepartment, deleteDepartment,
  readAllDesignations, appendDesignation, updateDesignation, deleteDesignation,
  readAllEmployees, updateEmployeeHr, appendEmployeeRow,
} = require("../lib/hr");

function json(res, status, data) {
  res.writeHead(status, { "Content-Type": "application/json", "Cache-Control": "no-store" });
  res.end(JSON.stringify(data));
}

function readBody(req) {
  return new Promise((resolve) => {
    let data = "";
    req.on("data", c => { data += c; });
    req.on("end", () => { try { resolve(JSON.parse(data || "{}")); } catch { resolve({}); } });
  });
}

// ── Departments ────────────────────────────────────────────────────────────────

// GET /api/hr/departments
async function handleListDepartments(req, res) {
  try {
    const depts = await readAllDepartments();
    json(res, 200, { ok: true, departments: depts });
  } catch (err) {
    console.error("[hr/departments]", err.message);
    json(res, 500, { ok: false, error: err.message });
  }
}

// POST /api/hr/departments
async function handleCreateDepartment(req, res) {
  try {
    const { name, description } = await readBody(req);
    if (!name?.trim()) return json(res, 400, { ok: false, error: "name is required" });
    const dept = {
      dept_id: crypto.randomUUID(),
      name: name.trim(),
      description: (description || "").trim(),
      created_at: new Date().toISOString(),
    };
    await appendDepartment(dept);
    json(res, 200, { ok: true, department: dept });
  } catch (err) {
    console.error("[hr/departments/create]", err.message);
    json(res, 500, { ok: false, error: err.message });
  }
}

// PATCH /api/hr/departments/:id
async function handleUpdateDepartment(req, res, deptId) {
  try {
    const body = await readBody(req);
    const updates = {};
    ["name", "description"].forEach(k => { if (body[k] !== undefined) updates[k] = body[k]; });
    const ok = await updateDepartment(deptId, updates);
    json(res, ok ? 200 : 404, { ok });
  } catch (err) {
    console.error("[hr/departments/update]", err.message);
    json(res, 500, { ok: false, error: err.message });
  }
}

// DELETE /api/hr/departments/:id
async function handleDeleteDepartment(req, res, deptId) {
  try {
    const ok = await deleteDepartment(deptId);
    json(res, ok ? 200 : 404, { ok });
  } catch (err) {
    console.error("[hr/departments/delete]", err.message);
    json(res, 500, { ok: false, error: err.message });
  }
}

// ── Designations ───────────────────────────────────────────────────────────────

// GET /api/hr/designations
async function handleListDesignations(req, res) {
  try {
    const designations = await readAllDesignations();
    json(res, 200, { ok: true, designations });
  } catch (err) {
    console.error("[hr/designations]", err.message);
    json(res, 500, { ok: false, error: err.message });
  }
}

// POST /api/hr/designations
async function handleCreateDesignation(req, res) {
  try {
    const { name, description } = await readBody(req);
    if (!name?.trim()) return json(res, 400, { ok: false, error: "name is required" });
    const desig = {
      designation_id: crypto.randomUUID(),
      name: name.trim(),
      description: (description || "").trim(),
      created_at: new Date().toISOString(),
    };
    await appendDesignation(desig);
    json(res, 200, { ok: true, designation: desig });
  } catch (err) {
    console.error("[hr/designations/create]", err.message);
    json(res, 500, { ok: false, error: err.message });
  }
}

// PATCH /api/hr/designations/:id
async function handleUpdateDesignation(req, res, designationId) {
  try {
    const body = await readBody(req);
    const updates = {};
    ["name", "description"].forEach(k => { if (body[k] !== undefined) updates[k] = body[k]; });
    const ok = await updateDesignation(designationId, updates);
    json(res, ok ? 200 : 404, { ok });
  } catch (err) {
    console.error("[hr/designations/update]", err.message);
    json(res, 500, { ok: false, error: err.message });
  }
}

// DELETE /api/hr/designations/:id
async function handleDeleteDesignation(req, res, designationId) {
  try {
    const ok = await deleteDesignation(designationId);
    json(res, ok ? 200 : 404, { ok });
  } catch (err) {
    console.error("[hr/designations/delete]", err.message);
    json(res, 500, { ok: false, error: err.message });
  }
}

// ── Employees ──────────────────────────────────────────────────────────────────

// POST /api/hr/employees  — create a new HR-only employee record
async function handleCreateEmployee(req, res) {
  try {
    const body = await readBody(req);
    const { first_name, last_name, hire_date, employment_status, department_id, designation_id } = body;
    if (!first_name?.trim() || !last_name?.trim()) {
      return json(res, 400, { ok: false, error: "first_name and last_name are required" });
    }
    const staffId = crypto.randomUUID();
    const now = new Date().toISOString();
    const record = {
      staff_id: staffId,
      first_name: first_name.trim(),
      last_name: last_name.trim(),
      phone: "",
      password_hash: "",
      status: "inactive",
      permissions: "",
      created_at: now,
      approved_at: "",
      notes: "",
      username: "",
      role: "crew",
      hire_date: hire_date || "",
      employment_status: employment_status || "active",
      department_id: department_id || "",
      designation_id: designation_id || "",
      reports_to: "",
      personal_phone: "",
      emergency_contact_name: "",
      emergency_contact_phone: "",
    };
    await appendEmployeeRow(record);
    json(res, 200, { ok: true, staff_id: staffId });
  } catch (err) {
    console.error("[hr/employees/create]", err.message);
    json(res, 500, { ok: false, error: err.message });
  }
}

// GET /api/hr/employees
async function handleListEmployees(req, res) {
  try {
    const all = await readAllEmployees();
    const safe = all.map(({ password_hash, ...e }) => e);
    json(res, 200, { ok: true, employees: safe });
  } catch (err) {
    console.error("[hr/employees]", err.message);
    json(res, 500, { ok: false, error: err.message });
  }
}

// GET /api/hr/employees/:id
async function handleGetEmployee(req, res, staffId) {
  try {
    const all = await readAllEmployees();
    const emp = all.find(e => e.staff_id === staffId);
    if (!emp) return json(res, 404, { ok: false, error: "Employee not found" });
    const { password_hash, ...safe } = emp;
    json(res, 200, { ok: true, employee: safe });
  } catch (err) {
    console.error("[hr/employees/get]", err.message);
    json(res, 500, { ok: false, error: err.message });
  }
}

// PATCH /api/hr/employees/:id
async function handleUpdateEmployee(req, res, staffId) {
  try {
    const body = await readBody(req);
    const allowed = [
      "first_name", "last_name", "phone",
      "hire_date", "employment_status", "department_id", "designation_id", "reports_to",
      "personal_phone", "emergency_contact_name", "emergency_contact_phone",
      "notes",
    ];
    const updates = {};
    allowed.forEach(k => { if (body[k] !== undefined) updates[k] = body[k]; });

    // Lightweight referential validation (skip empty = clearing the field)
    if (updates.department_id) {
      const depts = await readAllDepartments();
      if (!depts.find(d => d.dept_id === updates.department_id)) {
        return json(res, 400, { ok: false, error: "Invalid department_id" });
      }
    }
    if (updates.designation_id) {
      const desigs = await readAllDesignations();
      if (!desigs.find(d => d.designation_id === updates.designation_id)) {
        return json(res, 400, { ok: false, error: "Invalid designation_id" });
      }
    }
    if (updates.reports_to) {
      const all = await readAllEmployees();
      if (!all.find(e => e.staff_id === updates.reports_to)) {
        return json(res, 400, { ok: false, error: "Invalid reports_to staff_id" });
      }
    }

    const ok = await updateEmployeeHr(staffId, updates);
    json(res, ok ? 200 : 404, { ok });
  } catch (err) {
    console.error("[hr/employees/update]", err.message);
    json(res, 500, { ok: false, error: err.message });
  }
}

module.exports = {
  handleListDepartments, handleCreateDepartment, handleUpdateDepartment, handleDeleteDepartment,
  handleListDesignations, handleCreateDesignation, handleUpdateDesignation, handleDeleteDesignation,
  handleCreateEmployee, handleListEmployees, handleGetEmployee, handleUpdateEmployee,
};

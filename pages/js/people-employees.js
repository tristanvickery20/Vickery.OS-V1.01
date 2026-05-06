(function() {
  var employees = [];
  var departments = [];
  var designations = [];
  var shifts = [];
  var corrections = [];
  var leaveApplications = [];
  var leavePolicies = [];
  var expenseClaims = [];
  var payrollRuns = [];
  var payrollSettings = null;
  var payrollComponents = [];
  var payrollStructures = [];
  var salaryAssignments = [];
  var availability = {};
  var activeStatus = "";

  function qs(id) { return document.getElementById(id); }
  function esc(s) { return String(s||"").replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;"); }
  function norm(s) { return String(s || "").toLowerCase().trim(); }
  function money(n) { return "$" + (parseFloat(n) || 0).toFixed(2); }

  function showToast(msg, isError) {
    var t = qs("toast");
    t.textContent = msg;
    t.className = "toast" + (isError ? " error" : "");
    t.classList.add("show");
    setTimeout(function() { t.classList.remove("show"); }, 3000);
  }

  function safeFetch(url, fallback) {
    return fetch(url, { cache: "no-store" })
      .then(function(r) { return r.json(); })
      .catch(function() { return fallback || { ok: false }; });
  }

  function deptName(id) {
    if (!id) return "";
    var d = departments.find(function(d) { return d.dept_id === id; });
    return d ? d.name : id;
  }

  function desigName(id) {
    if (!id) return "";
    var d = designations.find(function(d) { return d.designation_id === id; });
    return d ? d.name : id;
  }

  function empStatus(emp) {
    var es = emp.employment_status || "";
    return es || (emp.status === "active" ? "active" : emp.status === "inactive" ? "inactive" : emp.status === "pending" ? "pending" : "");
  }

  function isActiveEmployee(emp) {
    var s = norm(empStatus(emp));
    return s === "active" || s === "" || s === "pending";
  }

  function badgeHtml(status) {
    var map = {
      active: "badge-active", inactive: "badge-inactive",
      terminated: "badge-terminated", pending: "badge-pending",
    };
    var cls = map[status] || "badge-inactive";
    return '<span class="badge ' + cls + '">' + esc(status || "—") + '</span>';
  }

  function hasAssignment(emp) {
    if (!availability.assignments) return false;
    return salaryAssignments.some(function(a) { return a.staff_id === emp.staff_id; });
  }

  function latestAssignment(emp) {
    if (!availability.assignments) return null;
    var list = salaryAssignments.filter(function(a) { return a.staff_id === emp.staff_id; });
    list.sort(function(a, b) { return String(b.effective_date || "").localeCompare(String(a.effective_date || "")); });
    return list[0] || null;
  }

  function missingEmployeeFields(emp) {
    var missing = [];
    if (!emp.first_name || !emp.last_name) missing.push("name");
    if (!emp.department_id) missing.push("department");
    if (!emp.designation_id) missing.push("designation");
    if (!empStatus(emp)) missing.push("status");
    if (!emp.hire_date) missing.push("hire date");
    if (!emp.phone && !emp.personal_phone) missing.push("phone");
    if (!emp.emergency_contact_name || !emp.emergency_contact_phone) missing.push("emergency contact");
    if (availability.assignments && !hasAssignment(emp) && isActiveEmployee(emp)) missing.push("pay assignment");
    return missing;
  }

  function miniBadge(label, cls) {
    return '<span class="mini-badge ' + (cls || "") + '">' + esc(label) + '</span>';
  }

  function warningCard(severity, title, count, reason, href) {
    var tag = href ? "a" : "div";
    var attrs = href ? ' href="' + esc(href) + '"' : "";
    return '<' + tag + ' class="hr-warning"' + attrs + '>' +
      '<div class="hr-dot ' + esc(severity || "info") + '"></div>' +
      '<div><div class="hr-warning-title">' + esc(title) + '</div>' +
      '<div class="hr-warning-reason">' + esc(reason) + '</div></div>' +
      '<div class="hr-warning-count">' + (count === null || count === undefined ? '&mdash;' : esc(count)) + '</div>' +
      '</' + tag + '>';
  }

  function addSetupWarning(list, limited, available, hasRows, name) {
    if (!available) limited.push(name + " unavailable");
    else if (!hasRows) list.push(name);
  }

  function renderOverview() {
    var activeStaff = employees.filter(isActiveEmployee);
    var pendingStaff = employees.filter(function(e) { return norm(e.status) === "pending" || norm(empStatus(e)) === "pending"; });
    var missingCritical = activeStaff.filter(function(e) { return missingEmployeeFields(e).length > 0; });
    var pendingCorrections = availability.corrections ? corrections.filter(function(c) { return norm(c.status) === "pending"; }) : [];
    var openLeave = availability.leave ? leaveApplications.filter(function(a) { return norm(a.status) === "pending"; }) : [];
    var submittedClaims = availability.claims ? expenseClaims.filter(function(c) { return norm(c.status) === "submitted"; }) : [];
    var approvedUnpaidClaims = availability.claims ? expenseClaims.filter(function(c) { return norm(c.status) === "approved"; }) : [];
    var draftRuns = availability.runs ? payrollRuns.filter(function(r) { return norm(r.status) === "draft"; }) : [];
    var pendingRuns = availability.runs ? payrollRuns.filter(function(r) { return ["pending", "review", "processing"].indexOf(norm(r.status)) >= 0; }) : [];
    var finalizedRuns = availability.runs ? payrollRuns.filter(function(r) { return ["finalized", "completed", "complete"].indexOf(norm(r.status)) >= 0; }) : [];
    var unassignedPay = availability.assignments ? activeStaff.filter(function(e) { return !hasAssignment(e); }) : [];

    var setupWarnings = [];
    var limitedAreas = [];
    addSetupWarning(setupWarnings, limitedAreas, availability.departments, departments.length, "departments");
    addSetupWarning(setupWarnings, limitedAreas, availability.designations, designations.length, "designations");
    addSetupWarning(setupWarnings, limitedAreas, availability.shifts, shifts.length, "shifts");
    addSetupWarning(setupWarnings, limitedAreas, availability.leavePolicies, leavePolicies.length, "leave policies");
    addSetupWarning(setupWarnings, limitedAreas, availability.components, payrollComponents.length, "pay components");
    addSetupWarning(setupWarnings, limitedAreas, availability.structures, payrollStructures.length, "pay structures");
    if (!availability.settings) limitedAreas.push("payroll settings unavailable");
    if (!availability.assignments) limitedAreas.push("pay assignments unavailable");
    if (!availability.corrections) limitedAreas.push("attendance corrections unavailable");
    if (!availability.leave) limitedAreas.push("leave requests unavailable");
    if (!availability.claims) limitedAreas.push("expense claims unavailable");
    if (!availability.runs) limitedAreas.push("payroll runs unavailable");

    var activeCount = pendingStaff.length + missingCritical.length + pendingCorrections.length + openLeave.length + submittedClaims.length + approvedUnpaidClaims.length + draftRuns.length + pendingRuns.length + unassignedPay.length + setupWarnings.length + limitedAreas.length;
    qs("hrOverviewPill").textContent = activeCount + " HR/payroll item" + (activeCount === 1 ? "" : "s") + " to review";

    qs("hrKpiGrid").innerHTML = [
      { label: "Active staff", value: availability.employees ? activeStaff.length : "—", note: availability.employees ? employees.length + " total employee/staff records" : "Employee data unavailable" },
      { label: "Pending approvals", value: pendingStaff.length, note: "Staff accounts needing owner approval" },
      { label: "Open leave", value: availability.leave ? openLeave.length : "—", note: availability.leave ? "Pending leave applications" : "Leave request data unavailable" },
      { label: "Payroll runs", value: availability.runs ? draftRuns.length + pendingRuns.length : "—", note: availability.runs ? finalizedRuns.length + " finalized/internal summaries" : "Payroll run data unavailable" },
      { label: "Expense claims", value: availability.claims ? submittedClaims.length + approvedUnpaidClaims.length : "—", note: availability.claims ? submittedClaims.length + " submitted, " + approvedUnpaidClaims.length + " approved unpaid" : "Expense claim data unavailable" },
      { label: "Record gaps", value: missingCritical.length, note: "Active staff missing critical HR/pay fields" },
      { label: "Attendance issues", value: availability.corrections ? pendingCorrections.length : "—", note: availability.corrections ? "Pending correction requests" : "Attendance correction data unavailable" },
      { label: "Setup gaps", value: setupWarnings.length + limitedAreas.length, note: setupWarnings.concat(limitedAreas).length ? setupWarnings.concat(limitedAreas).join(", ") : "Core setup found" },
    ].map(function(k) {
      return '<div class="hr-kpi"><div class="hr-kpi-label">' + esc(k.label) + '</div>' +
        '<div class="hr-kpi-value">' + esc(k.value) + '</div>' +
        '<div class="hr-kpi-note">' + esc(k.note) + '</div></div>';
    }).join("");

    var warnings = [];
    warnings.push(warningCard(pendingStaff.length ? "critical" : "info", "Pending staff approvals", pendingStaff.length, "Approve or reject staff accounts so access is controlled.", "/crm/staff"));
    warnings.push(warningCard(missingCritical.length ? "warning" : "info", "Employee records missing critical fields", missingCritical.length, "Employee records should have department, role/designation, hire date, contact, emergency contact, and pay assignment where applicable.", "/people/employees"));
    warnings.push(availability.corrections
      ? warningCard(pendingCorrections.length ? "warning" : "info", "Attendance corrections need review", pendingCorrections.length, "Correction requests should be approved or rejected before payroll review.", "/people/attendance")
      : warningCard("info", "Attendance correction check limited", null, "Attendance correction data is unavailable, so correction readiness cannot be confirmed.", "/people/attendance"));
    warnings.push(availability.leave
      ? warningCard(openLeave.length ? "warning" : "info", "Open leave requests", openLeave.length, "Pending leave should be reviewed before scheduling and payroll decisions.", "/people/leave")
      : warningCard("info", "Leave request check limited", null, "Leave request data is unavailable, so leave readiness cannot be confirmed.", "/people/leave"));
    warnings.push(availability.claims
      ? warningCard(submittedClaims.length ? "warning" : "info", "Submitted expense claims", submittedClaims.length, "Submitted claims need review before reimbursement or payroll processing.", "/people/expense-claims")
      : warningCard("info", "Expense claim check limited", null, "Expense claim data is unavailable, so reimbursement readiness cannot be confirmed.", "/people/expense-claims"));
    if (availability.claims) {
      warnings.push(warningCard(approvedUnpaidClaims.length ? "warning" : "info", "Approved claims not marked paid", approvedUnpaidClaims.length, "Approved reimbursements should be paid or intentionally held before payroll closeout.", "/people/expense-claims"));
    }
    warnings.push(availability.runs
      ? warningCard((draftRuns.length + pendingRuns.length) ? "warning" : "info", "Payroll runs need owner review", draftRuns.length + pendingRuns.length, "Draft/review payroll runs are internal summaries only; external payroll filing and direct deposit are not connected.", "/people/payroll/runs")
      : warningCard("info", "Payroll run check limited", null, "Payroll run data is unavailable, so run readiness cannot be confirmed.", "/people/payroll/runs"));
    warnings.push(availability.assignments
      ? warningCard(unassignedPay.length ? "critical" : "info", "Active staff missing pay assignment", unassignedPay.length, "Payroll previews require salary/pay assignments before internal payroll can be reviewed.", "/people/payroll/structures")
      : warningCard("info", "Pay assignment check limited", null, "Salary assignment data is unavailable, so pay assignment readiness cannot be confirmed.", "/people/payroll/structures"));
    warnings.push(warningCard((setupWarnings.length || limitedAreas.length) ? "warning" : "info", "Payroll setup gaps", setupWarnings.length + limitedAreas.length, setupWarnings.concat(limitedAreas).length ? "Setup or data still needs review: " + setupWarnings.concat(limitedAreas).join(", ") + "." : "Departments, roles, shifts, leave policies, pay components, structures, assignments, and settings are present enough for internal review.", "/people/payroll/settings"));

    qs("hrWarningList").innerHTML = warnings.join("");
  }

  function render() {
    var search = (qs("searchInput").value || "").toLowerCase();
    var deptF = qs("deptFilter").value;
    var desigF = qs("desigFilter").value;

    var filtered = employees.filter(function(e) {
      var name = ((e.first_name || "") + " " + (e.last_name || "")).toLowerCase();
      if (search && name.indexOf(search) < 0) return false;
      if (deptF && e.department_id !== deptF) return false;
      if (desigF && e.designation_id !== desigF) return false;
      if (activeStatus) {
        var es = empStatus(e);
        if (es !== activeStatus) return false;
      }
      return true;
    });

    var body = qs("empBody");
    if (!filtered.length) {
      body.innerHTML = '<tr><td colspan="7"><div class="empty"><strong>No employees found</strong>Try adjusting your filters.</div></td></tr>';
      return;
    }

    body.innerHTML = filtered.map(function(e) {
      var name = [e.first_name, e.last_name].filter(Boolean).join(" ") || "—";
      var es = empStatus(e);
      var dn = deptName(e.department_id);
      var dsn = desigName(e.designation_id);
      var hire = e.hire_date ? e.hire_date.slice(0, 10) : "—";
      var missing = missingEmployeeFields(e);
      var assignment = latestAssignment(e);
      var contact = e.personal_phone || e.phone || "";
      var emergency = [e.emergency_contact_name, e.emergency_contact_phone].filter(Boolean).join(" · ");
      var rowBadges = [];
      if (missing.length) rowBadges.push(miniBadge("Missing: " + missing.slice(0, 3).join(", ") + (missing.length > 3 ? " +" + (missing.length - 3) : ""), "warn"));
      else rowBadges.push(miniBadge("HR record OK", "good"));
      if (norm(e.status) === "pending") rowBadges.push(miniBadge("Needs approval", "warn"));
      if (availability.assignments) {
        if (assignment) rowBadges.push(miniBadge("Pay assigned", "good"));
        else if (isActiveEmployee(e)) rowBadges.push(miniBadge("No pay assignment", "warn"));
      } else {
        rowBadges.push(miniBadge("Pay assignment check limited", "limited"));
      }

      var payText = !availability.assignments
        ? '<span style="color:var(--muted)">Assignment data unavailable</span>'
        : assignment
          ? (money(assignment.base_amount) + " · " + (assignment.currency || "USD") + (assignment.effective_date ? " · from " + assignment.effective_date : ""))
          : '<span style="color:var(--muted)">No assignment</span>';

      return '<tr data-id="' + esc(e.staff_id) + '">' +
        '<td><div class="emp-name">' + esc(name) + '</div>' +
        (e.username ? '<div class="emp-meta">@' + esc(e.username) + '</div>' : '') +
        '<div class="emp-badges">' + rowBadges.join("") + '</div>' +
        '</td>' +
        '<td>' + (dn ? esc(dn) : '<span style="color:var(--muted)">—</span>') + '</td>' +
        '<td>' + (dsn ? esc(dsn) : '<span style="color:var(--muted)">—</span>') + '</td>' +
        '<td>' + badgeHtml(es) + '</td>' +
        '<td>' + (contact ? esc(contact) : '<span style="color:var(--muted)">—</span>') +
          (emergency ? '<div class="emp-meta">Emergency: ' + esc(emergency) + '</div>' : '<div class="emp-meta">Emergency: —</div>') + '</td>' +
        '<td>' + payText + '</td>' +
        '<td>' + esc(hire) + '</td>' +
        '</tr>';
    }).join("");

    body.querySelectorAll("tr[data-id]").forEach(function(row) {
      row.style.cursor = "pointer";
      row.addEventListener("click", function() {
        window.location = "/people/employees/" + row.getAttribute("data-id");
      });
    });
  }

  function populateFilterDropdowns() {
    var df = qs("deptFilter");
    var cur = df.value;
    df.innerHTML = '<option value="">All Departments</option>' +
      departments.map(function(d) {
        return '<option value="' + esc(d.dept_id) + '">' + esc(d.name) + '</option>';
      }).join("");
    df.value = cur;

    var xf = qs("desigFilter");
    var cur2 = xf.value;
    xf.innerHTML = '<option value="">All Designations</option>' +
      designations.map(function(d) {
        return '<option value="' + esc(d.designation_id) + '">' + esc(d.name) + '</option>';
      }).join("");
    xf.value = cur2;
  }

  function populateModalDropdowns() {
    var dd = qs("newDept");
    dd.innerHTML = '<option value="">— None —</option>' +
      departments.map(function(d) {
        return '<option value="' + esc(d.dept_id) + '">' + esc(d.name) + '</option>';
      }).join("");
    var de = qs("newDesig");
    de.innerHTML = '<option value="">— None —</option>' +
      designations.map(function(d) {
        return '<option value="' + esc(d.designation_id) + '">' + esc(d.name) + '</option>';
      }).join("");
  }

  async function loadAll() {
    try {
      var results = await Promise.all([
        safeFetch("/api/hr/employees", { ok: false, employees: [] }),
        safeFetch("/api/hr/departments", { ok: false, departments: [] }),
        safeFetch("/api/hr/designations", { ok: false, designations: [] }),
        safeFetch("/api/hr/shifts", { ok: false, shifts: [] }),
        safeFetch("/api/hr/corrections", { ok: false, corrections: [] }),
        safeFetch("/api/hr/leave/applications", { ok: false, applications: [] }),
        safeFetch("/api/hr/leave/policies", { ok: false, policies: [] }),
        safeFetch("/api/hr/payroll/claims", { ok: false, claims: [] }),
        safeFetch("/api/hr/payroll/runs", { ok: false, runs: [] }),
        safeFetch("/api/hr/payroll/settings", { ok: false, settings: null }),
        safeFetch("/api/hr/payroll/components", { ok: false, components: [] }),
        safeFetch("/api/hr/payroll/structures", { ok: false, structures: [] }),
        safeFetch("/api/hr/payroll/assignments", { ok: false, assignments: [] }),
      ]);
      availability = {
        employees: !!results[0].ok,
        departments: !!results[1].ok,
        designations: !!results[2].ok,
        shifts: !!results[3].ok,
        corrections: !!results[4].ok,
        leave: !!results[5].ok,
        leavePolicies: !!results[6].ok,
        claims: !!results[7].ok,
        runs: !!results[8].ok,
        settings: !!results[9].ok,
        components: !!results[10].ok,
        structures: !!results[11].ok,
        assignments: !!results[12].ok,
      };
      if (results[0].ok) employees = results[0].employees || [];
      if (results[1].ok) departments = results[1].departments || [];
      if (results[2].ok) designations = results[2].designations || [];
      if (results[3].ok) shifts = results[3].shifts || [];
      if (results[4].ok) corrections = results[4].corrections || [];
      if (results[5].ok) leaveApplications = results[5].applications || [];
      if (results[6].ok) leavePolicies = results[6].policies || [];
      if (results[7].ok) expenseClaims = results[7].claims || [];
      if (results[8].ok) payrollRuns = results[8].runs || [];
      if (results[9].ok) payrollSettings = results[9].settings || null;
      if (results[10].ok) payrollComponents = results[10].components || [];
      if (results[11].ok) payrollStructures = results[11].structures || [];
      if (results[12].ok) salaryAssignments = results[12].assignments || [];
      populateFilterDropdowns();
      renderOverview();
      render();
    } catch (err) {
      qs("empBody").innerHTML = '<tr><td colspan="7"><div class="empty"><strong>Error loading employees</strong>' + esc(err.message) + '</div></td></tr>';
      qs("hrWarningList").innerHTML = warningCard("critical", "HR overview failed to load", null, err.message, "");
    }
  }

  // ── Event listeners ──────────────────────────────────────────────────────────

  qs("searchInput").addEventListener("input", render);
  qs("deptFilter").addEventListener("change", render);
  qs("desigFilter").addEventListener("change", render);

  document.querySelectorAll(".filter-tab").forEach(function(btn) {
    btn.addEventListener("click", function() {
      document.querySelectorAll(".filter-tab").forEach(function(b) { b.classList.remove("active"); });
      btn.classList.add("active");
      activeStatus = btn.getAttribute("data-status") || "";
      render();
    });
  });

  // ── Add Employee Modal ───────────────────────────────────────────────────────

  qs("addEmpBtn").addEventListener("click", function() {
    populateModalDropdowns();
    qs("newFirstName").value = "";
    qs("newLastName").value = "";
    qs("newHireDate").value = "";
    qs("newEmpStatus").value = "active";
    qs("newDept").value = "";
    qs("newDesig").value = "";
    qs("addModal").classList.add("open");
  });

  qs("cancelAddBtn").addEventListener("click", function() {
    qs("addModal").classList.remove("open");
  });

  qs("addModal").addEventListener("click", function(e) {
    if (e.target === qs("addModal")) qs("addModal").classList.remove("open");
  });

  qs("saveAddBtn").addEventListener("click", async function() {
    var fn = (qs("newFirstName").value || "").trim();
    var ln = (qs("newLastName").value || "").trim();
    if (!fn || !ln) { showToast("First and last name are required", true); return; }

    var payload = {
      first_name: fn,
      last_name: ln,
      hire_date: qs("newHireDate").value,
      employment_status: qs("newEmpStatus").value,
      department_id: qs("newDept").value,
      designation_id: qs("newDesig").value,
    };

    try {
      qs("saveAddBtn").disabled = true;
      var r = await fetch("/api/hr/employees", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
      var d = await r.json();
      if (d.ok) {
        showToast("Employee added");
        qs("addModal").classList.remove("open");
        await loadAll();
      } else {
        showToast(d.error || "Failed to add employee", true);
      }
    } catch (err) {
      showToast(err.message, true);
    } finally {
      qs("saveAddBtn").disabled = false;
    }
  });

  loadAll();
})();

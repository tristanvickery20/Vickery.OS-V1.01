(function() {
  var staffId = window.location.pathname.replace("/people/employees/", "").replace(/\//g, "");
  var employee = null;
  var departments = [];
  var designations = [];
  var employees = [];
  var shifts = [];

  function qs(id) { return document.getElementById(id); }
  function esc(s) { return String(s||"").replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;"); }

  function showToast(msg, isError) {
    var t = qs("toast");
    t.textContent = msg;
    t.className = "toast" + (isError ? " error" : "");
    t.classList.add("show");
    setTimeout(function() { t.classList.remove("show"); }, 3000);
  }

  function empStatus(emp) {
    return emp.employment_status || (emp.status === "active" ? "active" : emp.status === "inactive" ? "inactive" : "");
  }

  function badgeClass(status) {
    var map = { active: "badge-active", inactive: "badge-inactive", terminated: "badge-terminated", pending: "badge-pending" };
    return map[status] || "badge-inactive";
  }

  function buildDeptOptions(selectedId) {
    return departments.map(function(d) {
      return '<option value="' + esc(d.dept_id) + '"' + (selectedId === d.dept_id ? " selected" : "") + '>' + esc(d.name) + '</option>';
    }).join("");
  }

  function buildDesigOptions(selectedId) {
    return designations.map(function(d) {
      return '<option value="' + esc(d.designation_id) + '"' + (selectedId === d.designation_id ? " selected" : "") + '>' + esc(d.name) + '</option>';
    }).join("");
  }

  function buildShiftOptions(selectedId) {
    return shifts.map(function(s) {
      return '<option value="' + esc(s.shift_id) + '"' + (selectedId === s.shift_id ? " selected" : "") + '>' + esc(s.name) + '</option>';
    }).join("");
  }

  function buildReportsToOptions(selectedId) {
    return employees.filter(function(e) { return e.staff_id !== staffId; }).map(function(e) {
      var name = [e.first_name, e.last_name].filter(Boolean).join(" ");
      return '<option value="' + esc(e.staff_id) + '"' + (selectedId === e.staff_id ? " selected" : "") + '>' + esc(name) + '</option>';
    }).join("");
  }

  function buildProfileHtml(emp) {
    var es = empStatus(emp);

    var managerLinkHtml = "";
    if (emp.reports_to) {
      var mgr = employees.find(function(e) { return e.staff_id === emp.reports_to; });
      if (mgr) {
        var mgrName = [mgr.first_name, mgr.last_name].filter(Boolean).join(" ");
        managerLinkHtml = ' &nbsp;<a class="reports-to-link" href="/people/employees/' + esc(mgr.staff_id) + '">' + esc(mgrName) + ' →</a>';
      }
    }

    return '<div class="tabs">' +
      '<button class="tab-btn active" data-tab="personal">Personal Info</button>' +
      '<button class="tab-btn" data-tab="employment">Employment Info</button>' +
      '<button class="tab-btn" data-tab="emergency">Emergency Contact</button>' +
      '</div>' +

      /* ── Personal Info tab ── */
      '<div class="tab-panel active" id="tab-personal">' +
        '<div class="section-card">' +
          '<div class="section-title">Personal Information</div>' +
          '<div class="form-grid">' +
            '<div class="form-row"><label>First Name</label><input type="text" id="fFirstName" /></div>' +
            '<div class="form-row"><label>Last Name</label><input type="text" id="fLastName" /></div>' +
            '<div class="form-row"><label>Username</label><input type="text" id="fUsername" disabled style="opacity:.5" /></div>' +
            '<div class="form-row"><label>Login Phone</label><input type="tel" id="fPhone" /></div>' +
            '<div class="form-row"><label>Personal Phone</label><input type="tel" id="fPersonalPhone" /></div>' +
          '</div>' +
        '</div>' +
        '<div class="save-bar"><button class="btn-primary" id="savePersonal">Save Changes</button></div>' +
      '</div>' +

      /* ── Employment Info tab ── */
      '<div class="tab-panel" id="tab-employment">' +
        '<div class="section-card">' +
          '<div class="section-title">Employment Details</div>' +
          '<div class="form-grid">' +
            '<div class="form-row"><label>Hire Date</label><input type="date" id="fHireDate" /></div>' +
            '<div class="form-row"><label>Employment Status</label>' +
              '<select id="fEmpStatus">' +
                '<option value="active"' + (es === "active" ? " selected" : "") + '>Active</option>' +
                '<option value="inactive"' + (es === "inactive" ? " selected" : "") + '>Inactive</option>' +
                '<option value="terminated"' + (es === "terminated" ? " selected" : "") + '>Terminated</option>' +
              '</select>' +
            '</div>' +
            '<div class="form-row"><label>Department</label>' +
              '<select id="fDept"><option value="">— None —</option>' + buildDeptOptions(emp.department_id) + '</select>' +
            '</div>' +
            '<div class="form-row"><label>Designation</label>' +
              '<select id="fDesig"><option value="">— None —</option>' + buildDesigOptions(emp.designation_id) + '</select>' +
            '</div>' +
            '<div class="form-row"><label>Reports To' + managerLinkHtml + '</label>' +
              '<select id="fReportsTo"><option value="">— None —</option>' + buildReportsToOptions(emp.reports_to) + '</select>' +
            '</div>' +
            '<div class="form-row"><label>Default Shift</label>' +
              '<select id="fDefaultShift"><option value="">— None —</option>' + buildShiftOptions(emp.default_shift_id) + '</select>' +
            '</div>' +
            '<div class="form-row full"><label>Notes</label>' +
              '<textarea id="fNotes"></textarea>' +
            '</div>' +
          '</div>' +
        '</div>' +
        '<div class="save-bar"><button class="btn-primary" id="saveEmployment">Save Changes</button></div>' +
      '</div>' +

      /* ── Emergency Contact tab ── */
      '<div class="tab-panel" id="tab-emergency">' +
        '<div class="section-card">' +
          '<div class="section-title">Emergency Contact</div>' +
          '<div class="form-grid">' +
            '<div class="form-row"><label>Contact Name</label><input type="text" id="fEcName" /></div>' +
            '<div class="form-row"><label>Contact Phone</label><input type="tel" id="fEcPhone" /></div>' +
          '</div>' +
        '</div>' +
        '<div class="save-bar"><button class="btn-primary" id="saveEmergency">Save Changes</button></div>' +
      '</div>';
  }

  function populateFields(emp) {
    var set = function(id, val) { var el = document.getElementById(id); if (el) el.value = val || ""; };
    set("fFirstName", emp.first_name);
    set("fLastName", emp.last_name);
    set("fUsername", emp.username);
    set("fPhone", emp.phone);
    set("fPersonalPhone", emp.personal_phone);
    set("fHireDate", emp.hire_date);
    set("fNotes", emp.notes);
    set("fEcName", emp.emergency_contact_name);
    set("fEcPhone", emp.emergency_contact_phone);
  }

  function initTabs() {
    document.querySelectorAll(".tab-btn").forEach(function(btn) {
      btn.addEventListener("click", function() {
        document.querySelectorAll(".tab-btn").forEach(function(b) { b.classList.remove("active"); });
        document.querySelectorAll(".tab-panel").forEach(function(p) { p.classList.remove("active"); });
        btn.classList.add("active");
        var panel = document.getElementById("tab-" + btn.getAttribute("data-tab"));
        if (panel) panel.classList.add("active");
      });
    });
  }

  async function save(updates) {
    var r = await fetch("/api/hr/employees/" + staffId, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(updates),
    });
    var d = await r.json();
    if (d.ok) showToast("Saved");
    else showToast(d.error || "Save failed", true);
    return d.ok;
  }

  function initSaveButtons() {
    var savePersonal = document.getElementById("savePersonal");
    if (savePersonal) {
      savePersonal.addEventListener("click", async function() {
        savePersonal.disabled = true;
        var ok = await save({
          first_name: (document.getElementById("fFirstName") || {}).value || "",
          last_name: (document.getElementById("fLastName") || {}).value || "",
          phone: (document.getElementById("fPhone") || {}).value || "",
          personal_phone: (document.getElementById("fPersonalPhone") || {}).value || "",
        });
        if (ok) {
          var fn = (document.getElementById("fFirstName") || {}).value || "";
          var ln = (document.getElementById("fLastName") || {}).value || "";
          qs("empNameHeading").textContent = [fn, ln].filter(Boolean).join(" ") || "Employee Profile";
          document.title = qs("empNameHeading").textContent + " — Vickery Electric CRM";
        }
        savePersonal.disabled = false;
      });
    }

    var saveEmp = document.getElementById("saveEmployment");
    if (saveEmp) {
      saveEmp.addEventListener("click", async function() {
        saveEmp.disabled = true;
        var status = (document.getElementById("fEmpStatus") || {}).value || "";
        var ok = await save({
          hire_date: (document.getElementById("fHireDate") || {}).value || "",
          employment_status: status,
          department_id: (document.getElementById("fDept") || {}).value || "",
          designation_id: (document.getElementById("fDesig") || {}).value || "",
          reports_to: (document.getElementById("fReportsTo") || {}).value || "",
          default_shift_id: (document.getElementById("fDefaultShift") || {}).value || "",
          notes: (document.getElementById("fNotes") || {}).value || "",
        });
        if (ok) {
          var badge = qs("empStatusBadge");
          if (badge) {
            badge.textContent = status;
            badge.className = "emp-status-badge " + badgeClass(status);
          }
        }
        saveEmp.disabled = false;
      });
    }

    var saveEmg = document.getElementById("saveEmergency");
    if (saveEmg) {
      saveEmg.addEventListener("click", async function() {
        saveEmg.disabled = true;
        await save({
          emergency_contact_name: (document.getElementById("fEcName") || {}).value || "",
          emergency_contact_phone: (document.getElementById("fEcPhone") || {}).value || "",
        });
        saveEmg.disabled = false;
      });
    }
  }

  async function load() {
    try {
      var results = await Promise.all([
        fetch("/api/hr/employees/" + staffId).then(function(r) { return r.json(); }),
        fetch("/api/hr/departments").then(function(r) { return r.json(); }),
        fetch("/api/hr/designations").then(function(r) { return r.json(); }),
        fetch("/api/hr/employees").then(function(r) { return r.json(); }),
        fetch("/api/hr/shifts").then(function(r) { return r.json(); }),
      ]);

      if (!results[0].ok) {
        qs("profileContent").innerHTML = '<div class="loading-state">Employee not found.</div>';
        return;
      }

      employee = results[0].employee;
      departments = results[1].ok ? results[1].departments : [];
      designations = results[2].ok ? results[2].designations : [];
      employees = results[3].ok ? results[3].employees : [];
      shifts = results[4] && results[4].ok ? results[4].shifts : [];

      var name = [employee.first_name, employee.last_name].filter(Boolean).join(" ") || "Employee";
      qs("empNameHeading").textContent = name;
      document.title = name + " — Vickery Electric CRM";

      var status = employee.employment_status || employee.status || "";
      var badge = qs("empStatusBadge");
      badge.textContent = status;
      badge.className = "emp-status-badge " + badgeClass(status);

      qs("profileContent").innerHTML = buildProfileHtml(employee);
      populateFields(employee);
      initTabs();
      initSaveButtons();
    } catch (err) {
      qs("profileContent").innerHTML = '<div class="loading-state">Error loading profile: ' + esc(err.message) + '</div>';
    }
  }

  load();
})();

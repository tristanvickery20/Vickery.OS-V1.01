(function() {
  var employees = [];
  var departments = [];
  var designations = [];
  var activeStatus = "";

  function qs(id) { return document.getElementById(id); }
  function esc(s) { return String(s||"").replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;"); }

  function showToast(msg, isError) {
    var t = qs("toast");
    t.textContent = msg;
    t.className = "toast" + (isError ? " error" : "");
    t.classList.add("show");
    setTimeout(function() { t.classList.remove("show"); }, 3000);
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
    return es || (emp.status === "active" ? "active" : emp.status === "inactive" ? "inactive" : "");
  }

  function badgeHtml(status) {
    var map = {
      active: "badge-active", inactive: "badge-inactive",
      terminated: "badge-terminated", pending: "badge-pending",
    };
    var cls = map[status] || "badge-inactive";
    return '<span class="badge ' + cls + '">' + esc(status || "—") + '</span>';
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
      body.innerHTML = '<tr><td colspan="5"><div class="empty"><strong>No employees found</strong>Try adjusting your filters.</div></td></tr>';
      return;
    }

    body.innerHTML = filtered.map(function(e) {
      var name = [e.first_name, e.last_name].filter(Boolean).join(" ") || "—";
      var es = empStatus(e);
      var dn = deptName(e.department_id);
      var dsn = desigName(e.designation_id);
      var hire = e.hire_date ? e.hire_date.slice(0, 10) : "—";
      return '<tr data-id="' + esc(e.staff_id) + '">' +
        '<td><div class="emp-name">' + esc(name) + '</div>' +
        (e.username ? '<div class="emp-meta">@' + esc(e.username) + '</div>' : '') +
        '</td>' +
        '<td>' + (dn ? esc(dn) : '<span style="color:var(--muted)">—</span>') + '</td>' +
        '<td>' + (dsn ? esc(dsn) : '<span style="color:var(--muted)">—</span>') + '</td>' +
        '<td>' + badgeHtml(es) + '</td>' +
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
        fetch("/api/hr/employees").then(function(r) { return r.json(); }),
        fetch("/api/hr/departments").then(function(r) { return r.json(); }),
        fetch("/api/hr/designations").then(function(r) { return r.json(); }),
      ]);
      if (results[0].ok) employees = results[0].employees || [];
      if (results[1].ok) departments = results[1].departments || [];
      if (results[2].ok) designations = results[2].designations || [];
      populateFilterDropdowns();
      render();
    } catch (err) {
      qs("empBody").innerHTML = '<tr><td colspan="5"><div class="empty"><strong>Error loading employees</strong>' + esc(err.message) + '</div></td></tr>';
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

(function() {
  var allApplications = [];
  var departments = [];
  var leaveTypes = [];
  var employees = [];
  var allocations = [];
  var weekOffset = 0;

  function esc(s) { return String(s||"").replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;"); }

  function showToast(msg, isError) {
    var t = document.getElementById("toast");
    t.textContent = msg;
    t.className = "toast" + (isError ? " error" : "");
    t.classList.add("show");
    setTimeout(function() { t.classList.remove("show"); }, 3500);
  }

  function fmtDate(d) {
    if (!d) return "";
    var parts = d.split("-");
    if (parts.length < 3) return d;
    var months = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
    return months[parseInt(parts[1])-1] + " " + parseInt(parts[2]) + ", " + parts[0];
  }

  function statusBadge(s) {
    var cls = { pending: "status-pending", approved: "status-approved", rejected: "status-rejected" }[s] || "status-pending";
    return '<span class="status-badge ' + cls + '">' + esc(s) + '</span>';
  }

  function getWeekStart() {
    var d = new Date();
    var day = d.getUTCDay();
    d.setUTCDate(d.getUTCDate() - day + weekOffset * 7);
    return d.toISOString().slice(0, 10);
  }

  function addDays(dateStr, n) {
    var d = new Date(dateStr + "T12:00:00Z");
    d.setUTCDate(d.getUTCDate() + n);
    return d.toISOString().slice(0, 10);
  }

  // ── Tabs ──────────────────────────────────────────────────────────────────────
  document.querySelectorAll(".page-tab").forEach(function(btn) {
    btn.addEventListener("click", function() {
      document.querySelectorAll(".page-tab").forEach(function(b) { b.classList.remove("active"); });
      document.querySelectorAll(".tab-section").forEach(function(s) { s.classList.remove("active"); });
      btn.classList.add("active");
      var panel = document.getElementById("tab-" + btn.getAttribute("data-tab"));
      if (panel) panel.classList.add("active");
    });
  });

  // ── Render helpers ────────────────────────────────────────────────────────────
  function buildAppCard(app, showActions) {
    var days = parseFloat(app.days_count || 0);
    var note = app.manager_note ? '<div style="font-size:13px;color:var(--muted);margin-top:4px;">Manager note: ' + esc(app.manager_note) + '</div>' : "";
    var mgrLabel = app.manager_name
      ? '<div style="font-size:12px;color:var(--muted);margin-top:2px;">Assigned manager: ' + esc(app.manager_name) + '</div>'
      : (app.manager_id ? '<div style="font-size:12px;color:var(--muted);margin-top:2px;">Manager: ' + esc(app.manager_id) + '</div>' : "");
    return '<div class="app-card">' +
      '<div class="app-card-main">' +
        '<div class="app-card-name">' + esc(app.employee_name || app.staff_id) + ' ' + statusBadge(app.status) + '</div>' +
        '<div class="app-card-meta">' +
          esc(app.leave_type_name || app.leave_type_id) + ' · ' +
          fmtDate(app.from_date) + ' – ' + fmtDate(app.to_date) +
          (app.half_day === "TRUE" ? ' · Half Day' : '') +
          ' · <strong>' + days + ' day' + (days !== 1 ? 's' : '') + '</strong>' +
        '</div>' +
        mgrLabel +
        (app.reason ? '<div class="app-card-reason">' + esc(app.reason) + '</div>' : '') +
        note +
      '</div>' +
      (showActions && app.status === "pending" ? '<div class="app-card-actions">' +
        '<button class="btn-sm btn-approve" data-action="approved" data-id="' + esc(app.application_id) + '">Approve</button>' +
        '<button class="btn-sm btn-reject" data-action="rejected" data-id="' + esc(app.application_id) + '">Reject</button>' +
      '</div>' : '') +
    '</div>';
  }

  // ── Pending Approvals ─────────────────────────────────────────────────────────
  function renderPending() {
    var mgrFilter = document.getElementById("pendMgrFilter").value;
    var pending = allApplications.filter(function(a) {
      if (a.status !== "pending") return false;
      if (mgrFilter && a.manager_id !== mgrFilter) return false;
      return true;
    });
    var el = document.getElementById("pendingList");
    if (!pending.length) { el.innerHTML = '<div class="empty-state">No pending leave requests.</div>'; return; }
    el.innerHTML = pending.map(function(a) { return buildAppCard(a, true); }).join("");
    bindActionBtns(el);
  }

  document.getElementById("pendMgrFilter").addEventListener("change", renderPending);

  function bindActionBtns(container) {
    container.querySelectorAll("[data-action]").forEach(function(btn) {
      btn.addEventListener("click", function() {
        var appId = btn.getAttribute("data-id");
        var status = btn.getAttribute("data-action");
        openActionModal(appId, status);
      });
    });
  }

  // ── Action Modal ──────────────────────────────────────────────────────────────
  function openActionModal(appId, status) {
    document.getElementById("actionAppId").value = appId;
    document.getElementById("actionStatus").value = status;
    document.getElementById("actionModalTitle").textContent = status === "approved" ? "Approve Leave Request" : "Reject Leave Request";
    document.getElementById("actionNote").value = "";
    document.getElementById("actionConfirmBtn").className = "btn-primary " + (status === "approved" ? "btn-approve" : "btn-reject");
    document.getElementById("actionModal").classList.add("open");
  }

  document.getElementById("actionCancelBtn").addEventListener("click", function() {
    document.getElementById("actionModal").classList.remove("open");
  });

  document.getElementById("actionConfirmBtn").addEventListener("click", async function() {
    var appId = document.getElementById("actionAppId").value;
    var status = document.getElementById("actionStatus").value;
    var note = document.getElementById("actionNote").value;
    var btn = document.getElementById("actionConfirmBtn");
    btn.disabled = true;
    try {
      var r = await fetch("/api/hr/leave/applications/" + appId, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: status, manager_note: note }),
      });
      var d = await r.json();
      if (d.ok) {
        showToast(status === "approved" ? "Leave approved" : "Leave rejected");
        if (d.overlap_warning) {
          setTimeout(function() { showToast("⚠ " + d.overlap_warning, true); }, 1000);
        }
        document.getElementById("actionModal").classList.remove("open");
        loadAll();
      } else showToast(d.error || "Error", true);
    } finally { btn.disabled = false; }
  });

  // ── Team Calendar ─────────────────────────────────────────────────────────────
  function renderTeamCalendar() {
    var ws = getWeekStart();
    var we = addDays(ws, 6);
    document.getElementById("weekLabel").textContent = fmtDate(ws) + " – " + fmtDate(we);

    var deptFilter = document.getElementById("calDeptFilter").value;
    var relevant = allApplications.filter(function(a) {
      if (a.status !== "approved") return false;
      if (a.to_date < ws || a.from_date > we) return false;
      if (deptFilter && a.department_id !== deptFilter) return false;
      return true;
    });

    var el = document.getElementById("teamCalendarGrid");
    if (!relevant.length) {
      el.innerHTML = '<div class="empty-state">No one on approved leave this week.</div>';
      return;
    }
    el.innerHTML = '<div class="team-leave-grid">' +
      relevant.map(function(a) {
        var days = parseFloat(a.days_count || 0);
        return '<div class="team-leave-row">' +
          '<div class="team-emp-name">' + esc(a.employee_name) + '</div>' +
          '<div class="team-leave-info">' +
            esc(a.leave_type_name) + ' · ' +
            fmtDate(a.from_date) + ' – ' + fmtDate(a.to_date) +
            ' (' + days + ' day' + (days !== 1 ? 's' : '') + ')' +
          '</div>' +
        '</div>';
      }).join("") +
    '</div>';
  }

  document.getElementById("prevWeekBtn").addEventListener("click", function() { weekOffset--; renderTeamCalendar(); });
  document.getElementById("nextWeekBtn").addEventListener("click", function() { weekOffset++; renderTeamCalendar(); });
  document.getElementById("calDeptFilter").addEventListener("change", function() { renderTeamCalendar(); });

  // ── Team Balances ─────────────────────────────────────────────────────────────
  function renderBalances() {
    var deptFilter = document.getElementById("balDeptFilter").value;
    var year = document.getElementById("balYear").value;
    var el = document.getElementById("balancesTable");

    var ltById = {};
    leaveTypes.forEach(function(lt) { ltById[lt.leave_type_id] = lt; });
    var empById = {};
    employees.forEach(function(e) { empById[e.staff_id] = e; });

    var filtered = employees.filter(function(e) {
      if (deptFilter && e.department_id !== deptFilter) return false;
      var s = (e.employment_status || "active").toLowerCase();
      return s === "active" || s === "";
    });

    if (!filtered.length) { el.innerHTML = '<div class="empty-state">No employees.</div>'; return; }

    var rows = filtered.map(function(e) {
      var myAllocs = allocations.filter(function(a) { return a.staff_id === e.staff_id && a.year === year; });
      var name = [e.first_name, e.last_name].filter(Boolean).join(" ");
      if (myAllocs.length === 0) {
        return '<tr><td><strong>' + esc(name) + '</strong></td>' +
          '<td colspan="3" style="color:var(--muted);font-size:13px;">No policy assigned</td></tr>';
      }
      return myAllocs.map(function(a, i) {
        var lt = ltById[a.leave_type_id] || {};
        var alloc = parseFloat(a.days_allocated || 0);
        var used = parseFloat(a.days_used || 0);
        var rem = Math.max(0, alloc - used);
        var pct = alloc > 0 ? Math.min(100, Math.round((used / alloc) * 100)) : 0;
        var empCell = i === 0
          ? '<td' + (myAllocs.length > 1 ? ' rowspan="' + myAllocs.length + '"' : '') + '><strong>' + esc(name) + '</strong></td>'
          : '';
        return '<tr>' + empCell +
          '<td>' + esc(lt.name || a.leave_type_id) + '</td>' +
          '<td>' + rem + ' / ' + alloc + ' days' +
            '<div class="bal-bar"><div class="bal-fill" style="width:' + pct + '%"></div></div>' +
          '</td><td></td></tr>';
      }).join("");
    }).join("");

    el.innerHTML = '<table class="data-table"><thead><tr>' +
      '<th>Employee</th><th>Leave Type</th><th>Remaining / Allocated</th><th></th>' +
      '</thead><tbody>' + rows + '</tbody></table>';
  }

  document.getElementById("balDeptFilter").addEventListener("change", function() { renderBalances(); });
  document.getElementById("balYear").addEventListener("change", async function() {
    var year = document.getElementById("balYear").value;
    var r = await fetch("/api/hr/leave/allocations?year=" + year);
    var d = await r.json();
    allocations = d.ok ? d.allocations : [];
    renderBalances();
  });

  // ── All Applications ──────────────────────────────────────────────────────────
  function renderAll() {
    var statusFilter = document.getElementById("allStatusFilter").value;
    var deptFilter = document.getElementById("allDeptFilter").value;
    var filtered = allApplications.filter(function(a) {
      if (statusFilter && a.status !== statusFilter) return false;
      if (deptFilter && a.department_id !== deptFilter) return false;
      return true;
    });
    var el = document.getElementById("allList");
    if (!filtered.length) { el.innerHTML = '<div class="empty-state">No applications.</div>'; return; }
    el.innerHTML = filtered.map(function(a) { return buildAppCard(a, true); }).join("");
    bindActionBtns(el);
  }

  document.getElementById("allStatusFilter").addEventListener("change", renderAll);
  document.getElementById("allDeptFilter").addEventListener("change", renderAll);

  // ── Department filter population ──────────────────────────────────────────────
  function populateDeptFilters() {
    var opts = '<option value="">All Departments</option>' +
      departments.map(function(d) { return '<option value="' + esc(d.dept_id) + '">' + esc(d.name) + '</option>'; }).join("");
    ["calDeptFilter", "balDeptFilter", "allDeptFilter"].forEach(function(id) {
      var el = document.getElementById(id);
      if (el) el.innerHTML = opts;
    });
  }

  function populateMgrFilter() {
    var mgrIds = new Set(allApplications.filter(function(a) { return a.status === "pending" && a.manager_id; }).map(function(a) { return a.manager_id; }));
    var empById = {};
    employees.forEach(function(e) { empById[e.staff_id] = e; });
    var opts = '<option value="">All Managers</option>' +
      Array.from(mgrIds).map(function(mid) {
        var e = empById[mid] || {};
        var name = [e.first_name, e.last_name].filter(Boolean).join(" ") || mid;
        return '<option value="' + esc(mid) + '">' + esc(name) + '</option>';
      }).join("");
    var el = document.getElementById("pendMgrFilter");
    if (el) el.innerHTML = opts;
  }

  // ── Load all data ─────────────────────────────────────────────────────────────
  async function loadAll() {
    try {
      var year = document.getElementById("balYear").value;
      var results = await Promise.all([
        fetch("/api/hr/leave/applications").then(function(r) { return r.json(); }),
        fetch("/api/hr/departments").then(function(r) { return r.json(); }),
        fetch("/api/hr/leave-types").then(function(r) { return r.json(); }),
        fetch("/api/hr/employees").then(function(r) { return r.json(); }),
        fetch("/api/hr/leave/allocations?year=" + year).then(function(r) { return r.json(); }),
      ]);
      allApplications = results[0].ok ? results[0].applications : [];
      departments = results[1].ok ? results[1].departments : [];
      leaveTypes = results[2].ok ? results[2].leave_types : [];
      employees = results[3].ok ? results[3].employees : [];
      allocations = results[4].ok ? results[4].allocations : [];

      populateDeptFilters();
      populateMgrFilter();
      renderPending();
      renderTeamCalendar();
      renderBalances();
      renderAll();
    } catch(e) {
      console.error(e);
      document.getElementById("pendingList").innerHTML = '<div class="empty-state">Error loading data.</div>';
    }
  }

  loadAll();
})();

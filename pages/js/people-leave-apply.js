(function() {
  var employees = [];
  var leaveTypes = [];
  var allocations = [];
  var myApplications = [];

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
    return months[parseInt(parts[1])-1] + " " + parseInt(parts[2]);
  }

  async function init() {
    try {
      var results = await Promise.all([
        fetch("/api/hr/employees").then(function(r) { return r.json(); }),
        fetch("/api/hr/leave-types").then(function(r) { return r.json(); }),
      ]);
      employees = (results[0].ok ? results[0].employees : []).filter(function(e) {
        var s = (e.employment_status || "active").toLowerCase();
        return s === "active" || s === "";
      });
      leaveTypes = results[1].ok ? results[1].leave_types : [];

      var empSel = document.getElementById("empSel");
      empSel.innerHTML = '<option value="">Select employee…</option>' +
        employees.map(function(e) {
          var name = [e.first_name, e.last_name].filter(Boolean).join(" ");
          return '<option value="' + esc(e.staff_id) + '">' + esc(name) + '</option>';
        }).join("");

      var ltSel = document.getElementById("ltSel");
      ltSel.innerHTML = '<option value="">Select leave type…</option>' +
        leaveTypes.map(function(lt) {
          return '<option value="' + esc(lt.leave_type_id) + '">' + esc(lt.name) +
            ' (' + esc(lt.days_per_year) + ' days/yr)' + '</option>';
        }).join("");

      // Pre-select from URL param
      var params = new URLSearchParams(window.location.search);
      var preStaff = params.get("staff_id");
      if (preStaff) {
        empSel.value = preStaff;
        onEmployeeChange();
      }

      // Set default dates
      var today = new Date().toISOString().slice(0, 10);
      document.getElementById("fromDate").value = today;
      document.getElementById("toDate").value = today;
    } catch(e) {
      showToast("Error loading data", true);
    }
  }

  async function onEmployeeChange() {
    var staffId = document.getElementById("empSel").value;
    if (!staffId) {
      allocations = [];
      myApplications = [];
      renderBalances();
      renderMyApps();
      renderBalancePill();
      return;
    }
    try {
      var year = new Date().getFullYear();
      var results = await Promise.all([
        fetch("/api/hr/leave/allocations?staff_id=" + staffId + "&year=" + year).then(function(r) { return r.json(); }),
        fetch("/api/hr/leave/applications?staff_id=" + staffId).then(function(r) { return r.json(); }),
      ]);
      allocations = results[0].ok ? results[0].allocations : [];
      myApplications = results[1].ok ? results[1].applications : [];
      renderBalances();
      renderMyApps();
      renderBalancePill();
    } catch(e) { showToast("Error loading employee data", true); }
  }

  function renderBalancePill() {
    var ltId = document.getElementById("ltSel").value;
    var el = document.getElementById("balanceInfo");
    if (!ltId || !allocations.length) { el.innerHTML = ""; return; }
    var alloc = allocations.find(function(a) { return a.leave_type_id === ltId; });
    if (!alloc) { el.innerHTML = '<span class="balance-pill">No balance set for this type</span>'; return; }
    var rem = Math.max(0, parseFloat(alloc.days_allocated || 0) - parseFloat(alloc.days_used || 0));
    el.innerHTML = '<span class="balance-pill">Available: <strong>' + rem + ' days</strong></span>' +
      '<span class="balance-pill">Used: <strong>' + alloc.days_used + ' / ' + alloc.days_allocated + '</strong></span>';
  }

  function renderBalances() {
    var el = document.getElementById("balancesSection");
    if (!allocations.length) {
      el.innerHTML = '<div style="color:hsl(220 15% 50%);font-size:14px;">No leave balances assigned. Ask your manager to assign a leave policy.</div>';
      return;
    }
    var ltById = {};
    leaveTypes.forEach(function(lt) { ltById[lt.leave_type_id] = lt; });
    el.innerHTML = allocations.map(function(a) {
      var lt = ltById[a.leave_type_id] || {};
      var rem = Math.max(0, parseFloat(a.days_allocated || 0) - parseFloat(a.days_used || 0));
      return '<div class="bal-row">' +
        '<div class="bal-name">' + esc(lt.name || a.leave_type_id) + '</div>' +
        '<div class="bal-val">' + rem + ' / ' + esc(a.days_allocated) + ' days</div>' +
      '</div>';
    }).join("");
  }

  function renderMyApps() {
    var el = document.getElementById("myApps");
    if (!myApplications.length) {
      el.innerHTML = '<div style="color:hsl(220 15% 50%);font-size:14px;">No applications yet.</div>';
      return;
    }
    var ltById = {};
    leaveTypes.forEach(function(lt) { ltById[lt.leave_type_id] = lt; });
    var sorted = myApplications.slice().sort(function(a, b) { return b.created_at.localeCompare(a.created_at); });
    el.innerHTML = sorted.map(function(a) {
      var lt = ltById[a.leave_type_id] || {};
      var cls = { pending: "badge-pending", approved: "badge-approved", rejected: "badge-rejected" }[a.status] || "badge-pending";
      var days = parseFloat(a.days_count || 0);
      return '<div class="app-item">' +
        '<div class="app-item-top">' +
          '<div class="app-name">' + esc(lt.name || a.leave_type_id) + '</div>' +
          '<span class="badge ' + cls + '">' + esc(a.status) + '</span>' +
        '</div>' +
        '<div class="app-meta">' + fmtDate(a.from_date) + ' – ' + fmtDate(a.to_date) +
          ' · ' + days + ' day' + (days !== 1 ? 's' : '') +
          (a.manager_note ? ' · "' + esc(a.manager_note) + '"' : '') +
        '</div>' +
      '</div>';
    }).join("");
  }

  function updateDaysPreview() {
    var from = document.getElementById("fromDate").value;
    var to = document.getElementById("toDate").value;
    var halfDay = document.getElementById("halfDayToggle").checked;
    var el = document.getElementById("daysPreview");
    if (!from || !to || from > to) { el.className = "days-preview"; return; }
    if (halfDay) {
      el.textContent = "This will count as 0.5 working days.";
      el.className = "days-preview visible";
      return;
    }
    // Simple client-side working day count (no holiday data)
    var count = 0;
    var cur = new Date(from + "T12:00:00Z");
    var end = new Date(to + "T12:00:00Z");
    while (cur <= end) {
      var dow = cur.getUTCDay();
      if (dow !== 0 && dow !== 6) count++;
      cur.setUTCDate(cur.getUTCDate() + 1);
    }
    el.textContent = "Approx. " + count + " working day" + (count !== 1 ? "s" : "") + " (holidays excluded by server).";
    el.className = "days-preview visible";
  }

  document.getElementById("empSel").addEventListener("change", onEmployeeChange);
  document.getElementById("ltSel").addEventListener("change", renderBalancePill);
  document.getElementById("fromDate").addEventListener("change", updateDaysPreview);
  document.getElementById("toDate").addEventListener("change", updateDaysPreview);
  document.getElementById("halfDayToggle").addEventListener("change", updateDaysPreview);

  document.getElementById("submitBtn").addEventListener("click", async function() {
    var staffId = document.getElementById("empSel").value;
    var ltId = document.getElementById("ltSel").value;
    var from = document.getElementById("fromDate").value;
    var to = document.getElementById("toDate").value;
    var halfDay = document.getElementById("halfDayToggle").checked;
    var reason = document.getElementById("reasonInput").value;

    if (!staffId) { showToast("Select an employee", true); return; }
    if (!ltId) { showToast("Select a leave type", true); return; }
    if (!from || !to) { showToast("Select dates", true); return; }
    if (from > to) { showToast("End date must be after start date", true); return; }

    var btn = document.getElementById("submitBtn");
    btn.disabled = true;
    try {
      var r = await fetch("/api/hr/leave/applications", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          staff_id: staffId,
          leave_type_id: ltId,
          from_date: from,
          to_date: to,
          half_day: halfDay,
          reason: reason,
        }),
      });
      var d = await r.json();
      if (d.ok) {
        showToast("Leave application submitted!");
        document.getElementById("reasonInput").value = "";
        onEmployeeChange();
      } else {
        showToast(d.error || "Error submitting", true);
      }
    } finally {
      btn.disabled = false;
    }
  });

  init();
})();

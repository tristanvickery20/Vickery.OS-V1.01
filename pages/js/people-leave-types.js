(function() {
  var leaveTypes = [];
  var holidayLists = [];
  var holidays = [];

  function esc(s) { return String(s||"").replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;"); }

  function showToast(msg, isError) {
    var t = document.getElementById("toast");
    t.textContent = msg;
    t.className = "toast" + (isError ? " error" : "");
    t.classList.add("show");
    setTimeout(function() { t.classList.remove("show"); }, 3500);
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

  // ── Leave Types ───────────────────────────────────────────────────────────────
  function renderLeaveTypes() {
    var el = document.getElementById("leaveTypesList");
    if (!leaveTypes.length) { el.innerHTML = '<div class="empty-state">No leave types yet. Add one above.</div>'; return; }
    var rows = leaveTypes.map(function(lt) {
      return '<tr>' +
        '<td><strong>' + esc(lt.name) + '</strong></td>' +
        '<td>' + esc(lt.days_per_year) + ' days/yr</td>' +
        '<td><span class="badge ' + (lt.is_paid === "TRUE" ? "badge-yes" : "badge-no") + '">' + (lt.is_paid === "TRUE" ? "Paid" : "Unpaid") + '</span></td>' +
        '<td><span class="badge ' + (lt.carry_over === "TRUE" ? "badge-yes" : "badge-no") + '">' + (lt.carry_over === "TRUE" ? "Carry-over" : "No carry") + '</span></td>' +
        '<td><button class="btn-sm btn-danger" data-del-lt="' + esc(lt.leave_type_id) + '">Remove</button></td>' +
        '</tr>';
    }).join("");
    el.innerHTML = '<table class="data-table"><thead><tr>' +
      '<th>Name</th><th>Days/Year</th><th>Paid</th><th>Carry Over</th><th></th>' +
      '</thead><tbody>' + rows + '</tbody></table>';

    el.querySelectorAll("[data-del-lt]").forEach(function(btn) {
      btn.addEventListener("click", async function() {
        if (!confirm("Remove this leave type?")) return;
        var id = btn.getAttribute("data-del-lt");
        var r = await fetch("/api/hr/leave-types/" + id, { method: "DELETE" });
        var d = await r.json();
        if (d.ok) { showToast("Removed"); loadLeaveTypes(); }
        else showToast(d.error || "Error", true);
      });
    });
  }

  async function loadLeaveTypes() {
    try {
      var r = await fetch("/api/hr/leave-types");
      var d = await r.json();
      leaveTypes = d.ok ? d.leave_types : [];
      renderLeaveTypes();
    } catch(e) { showToast("Failed to load leave types", true); }
  }

  document.getElementById("addLeaveTypeBtn").addEventListener("click", async function() {
    var name = (document.getElementById("ltName").value || "").trim();
    var days = parseFloat(document.getElementById("ltDays").value || 0);
    var paid = document.getElementById("ltPaid").checked;
    var carry = document.getElementById("ltCarryOver").checked;
    if (!name) { showToast("Name is required", true); return; }
    var r = await fetch("/api/hr/leave-types", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: name, days_per_year: days, is_paid: paid, carry_over: carry }),
    });
    var d = await r.json();
    if (d.ok) {
      showToast("Leave type added");
      document.getElementById("ltName").value = "";
      loadLeaveTypes();
    } else showToast(d.error || "Error", true);
  });

  // ── Holiday Lists ─────────────────────────────────────────────────────────────
  function renderHolidayLists() {
    var el = document.getElementById("holidayListsContent");
    if (!holidayLists.length) { el.innerHTML = '<div class="empty-state">No holiday lists yet.</div>'; return; }

    var rows = holidayLists.map(function(hl) {
      var myHolidays = holidays.filter(function(h) { return h.holiday_list_id === hl.holiday_list_id; });
      var entryRows = myHolidays.map(function(h) {
        return '<tr class="holiday-entry">' +
          '<td>' + esc(h.date) + '</td>' +
          '<td>' + esc(h.name) + '</td>' +
          '<td><button class="btn-sm btn-danger" data-del-hol="' + esc(h.holiday_id) + '">×</button></td>' +
          '</tr>';
      }).join("");
      var addRow = '<tr class="holiday-entry"><td colspan="3"><div class="add-holiday-form">' +
        '<div class="form-row">' +
          '<div class="form-col" style="flex:0 0 150px;"><label>Date</label><input type="date" class="hol-date" /></div>' +
          '<div class="form-col"><label>Name</label><input type="text" class="hol-name" placeholder="e.g. Independence Day" /></div>' +
          '<div class="form-col" style="flex:0 0 auto;justify-content:flex-end;"><label>&nbsp;</label>' +
            '<button class="btn-primary btn-sm add-hol-btn" data-list-id="' + esc(hl.holiday_list_id) + '">Add Holiday</button>' +
          '</div>' +
        '</div>' +
        '</div></td></tr>';
      return '<tbody>' +
        '<tr class="holiday-list-row" data-list-id="' + esc(hl.holiday_list_id) + '">' +
          '<td><strong>' + esc(hl.name) + '</strong> <small style="color:var(--muted)">(' + esc(hl.year) + ')</small>' +
            (hl.is_active === "TRUE" ? ' <span class="badge active-badge">Active</span>' : '') + '</td>' +
          '<td>' + myHolidays.length + ' holidays</td>' +
          '<td>' + (hl.is_active !== "TRUE" ? '<button class="btn-sm btn-primary set-active-btn" data-list-id="' + esc(hl.holiday_list_id) + '">Set Active</button>' : '') + '</td>' +
          '<td><button class="btn-sm btn-danger" data-del-hl="' + esc(hl.holiday_list_id) + '">Remove</button></td>' +
        '</tr>' +
        '<tr class="holiday-entries" id="he-' + esc(hl.holiday_list_id) + '"><td colspan="4"><table class="data-table" style="margin-left:20px;">' +
          '<thead><tr><th>Date</th><th>Name</th><th></th></tr></thead>' +
          '<tbody>' + entryRows + '</tbody>' +
          addRow +
        '</table></td></tr>' +
        '</tbody>';
    }).join("");

    el.innerHTML = '<table class="data-table" style="width:100%">' + rows + '</table>';

    // Toggle expand
    el.querySelectorAll(".holiday-list-row").forEach(function(row) {
      row.addEventListener("click", function(e) {
        if (e.target.tagName === "BUTTON") return;
        var id = row.getAttribute("data-list-id");
        var entries = document.getElementById("he-" + id);
        if (entries) entries.classList.toggle("open");
      });
    });

    // Set active
    el.querySelectorAll(".set-active-btn").forEach(function(btn) {
      btn.addEventListener("click", async function(e) {
        e.stopPropagation();
        var id = btn.getAttribute("data-list-id");
        var r = await fetch("/api/hr/holiday-lists/" + id, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ is_active: true }),
        });
        var d = await r.json();
        if (d.ok) { showToast("Set as active"); loadHolidayData(); }
        else showToast(d.error || "Error", true);
      });
    });

    // Delete list
    el.querySelectorAll("[data-del-hl]").forEach(function(btn) {
      btn.addEventListener("click", async function(e) {
        e.stopPropagation();
        if (!confirm("Remove this holiday list?")) return;
        var id = btn.getAttribute("data-del-hl");
        var r = await fetch("/api/hr/holiday-lists/" + id, { method: "DELETE" });
        var d = await r.json();
        if (d.ok) { showToast("Removed"); loadHolidayData(); }
        else showToast(d.error || "Error", true);
      });
    });

    // Delete holiday
    el.querySelectorAll("[data-del-hol]").forEach(function(btn) {
      btn.addEventListener("click", async function(e) {
        e.stopPropagation();
        if (!confirm("Remove this holiday?")) return;
        var id = btn.getAttribute("data-del-hol");
        var r = await fetch("/api/hr/holidays/" + id, { method: "DELETE" });
        var d = await r.json();
        if (d.ok) { showToast("Removed"); loadHolidayData(); }
        else showToast(d.error || "Error", true);
      });
    });

    // Add holiday button
    el.querySelectorAll(".add-hol-btn").forEach(function(btn) {
      btn.addEventListener("click", async function(e) {
        e.stopPropagation();
        var listId = btn.getAttribute("data-list-id");
        var row = btn.closest("tr");
        var dateInput = row.querySelector(".hol-date");
        var nameInput = row.querySelector(".hol-name");
        var date = (dateInput ? dateInput.value : "").trim();
        var name = (nameInput ? nameInput.value : "").trim();
        if (!date || !name) { showToast("Date and name are required", true); return; }
        var r = await fetch("/api/hr/holidays", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ holiday_list_id: listId, date: date, name: name }),
        });
        var d = await r.json();
        if (d.ok) { showToast("Holiday added"); loadHolidayData(); }
        else showToast(d.error || "Error", true);
      });
    });
  }

  async function loadHolidayData() {
    try {
      var [listRes, holRes] = await Promise.all([
        fetch("/api/hr/holiday-lists").then(function(r) { return r.json(); }),
        fetch("/api/hr/holidays").then(function(r) { return r.json(); }),
      ]);
      holidayLists = listRes.ok ? listRes.holiday_lists : [];
      holidays = holRes.ok ? holRes.holidays : [];
      renderHolidayLists();
    } catch(e) { showToast("Failed to load holiday data", true); }
  }

  document.getElementById("addHolidayListBtn").addEventListener("click", async function() {
    var name = (document.getElementById("hlName").value || "").trim();
    var year = document.getElementById("hlYear").value;
    var active = document.getElementById("hlActive").checked;
    if (!name || !year) { showToast("Name and year are required", true); return; }
    var r = await fetch("/api/hr/holiday-lists", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: name, year: year, is_active: active }),
    });
    var d = await r.json();
    if (d.ok) {
      showToast("Holiday list created");
      document.getElementById("hlName").value = "";
      loadHolidayData();
    } else showToast(d.error || "Error", true);
  });

  // ── Init ──────────────────────────────────────────────────────────────────────
  loadLeaveTypes();
  loadHolidayData();
})();

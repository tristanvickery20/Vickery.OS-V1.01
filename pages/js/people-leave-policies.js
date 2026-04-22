(function() {
  var policies = [];
  var leaveTypes = [];
  var employees = [];

  function esc(s) { return String(s||"").replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;"); }

  function showToast(msg, isError) {
    var t = document.getElementById("toast");
    t.textContent = msg;
    t.className = "toast" + (isError ? " error" : "");
    t.classList.add("show");
    setTimeout(function() { t.classList.remove("show"); }, 3500);
  }

  function renderPolicies() {
    var el = document.getElementById("policiesList");
    if (!policies.length) { el.innerHTML = '<div class="empty-state" style="text-align:center;padding:40px;">No policies yet. Create one above.</div>'; return; }
    var ltById = {};
    leaveTypes.forEach(function(lt) { ltById[lt.leave_type_id] = lt; });

    el.innerHTML = policies.map(function(p) {
      var items = p.items || [];
      var itemHtml = items.length === 0
        ? '<div style="color:var(--muted);font-size:13px;padding:8px 0;">No allocations yet.</div>'
        : items.map(function(it) {
            var lt = ltById[it.leave_type_id] || {};
            return '<div class="policy-item-row">' +
              '<div class="policy-item-name">' + esc(lt.name || it.leave_type_id) + '</div>' +
              '<div class="policy-item-days">' + esc(it.days_allocated) + ' days</div>' +
              '<button class="btn-sm btn-danger" data-del-item="' + esc(it.policy_item_id) + '">×</button>' +
            '</div>';
          }).join("");
      return '<div class="policy-card">' +
        '<div class="policy-name">' + esc(p.name) + '</div>' +
        (p.description ? '<div class="policy-desc">' + esc(p.description) + '</div>' : '') +
        '<div class="policy-items-title">Leave Allocations</div>' +
        itemHtml +
        '<div class="policy-actions">' +
          '<button class="btn-sm btn-primary" data-add-item="' + esc(p.leave_policy_id) + '">+ Add Type</button>' +
          '<button class="btn-sm btn-primary" data-assign="' + esc(p.leave_policy_id) + '" style="background:rgba(45,106,224,0.6);">Assign to Employee</button>' +
          '<button class="btn-sm btn-danger" data-del-policy="' + esc(p.leave_policy_id) + '">Delete Policy</button>' +
        '</div>' +
      '</div>';
    }).join("");

    el.querySelectorAll("[data-del-item]").forEach(function(btn) {
      btn.addEventListener("click", async function() {
        if (!confirm("Remove this allocation?")) return;
        var id = btn.getAttribute("data-del-item");
        var r = await fetch("/api/hr/leave/policy-items/" + id, { method: "DELETE" });
        var d = await r.json();
        if (d.ok) { showToast("Removed"); loadAll(); }
        else showToast(d.error || "Error", true);
      });
    });

    el.querySelectorAll("[data-del-policy]").forEach(function(btn) {
      btn.addEventListener("click", async function() {
        if (!confirm("Delete this leave policy?")) return;
        var id = btn.getAttribute("data-del-policy");
        var r = await fetch("/api/hr/leave/policies/" + id, { method: "DELETE" });
        var d = await r.json();
        if (d.ok) { showToast("Deleted"); loadAll(); }
        else showToast(d.error || "Error", true);
      });
    });

    el.querySelectorAll("[data-add-item]").forEach(function(btn) {
      btn.addEventListener("click", function() {
        var policyId = btn.getAttribute("data-add-item");
        openAddItemModal(policyId);
      });
    });

    el.querySelectorAll("[data-assign]").forEach(function(btn) {
      btn.addEventListener("click", function() {
        var policyId = btn.getAttribute("data-assign");
        openAssignModal(policyId);
      });
    });
  }

  async function loadAll() {
    try {
      var results = await Promise.all([
        fetch("/api/hr/leave/policies").then(function(r) { return r.json(); }),
        fetch("/api/hr/leave-types").then(function(r) { return r.json(); }),
        fetch("/api/hr/employees").then(function(r) { return r.json(); }),
      ]);
      policies = results[0].ok ? results[0].policies : [];
      leaveTypes = results[1].ok ? results[1].leave_types : [];
      employees = results[2].ok ? results[2].employees : [];
      renderPolicies();
    } catch(e) { showToast("Failed to load", true); }
  }

  document.getElementById("addPolicyBtn").addEventListener("click", async function() {
    var name = (document.getElementById("pName").value || "").trim();
    var desc = (document.getElementById("pDesc").value || "").trim();
    if (!name) { showToast("Policy name is required", true); return; }
    var r = await fetch("/api/hr/leave/policies", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: name, description: desc }),
    });
    var d = await r.json();
    if (d.ok) { showToast("Policy created"); document.getElementById("pName").value = ""; document.getElementById("pDesc").value = ""; loadAll(); }
    else showToast(d.error || "Error", true);
  });

  // ── Add Item Modal ──────────────────────────────────────────────────────────
  function openAddItemModal(policyId) {
    document.getElementById("addItemPolicyId").value = policyId;
    var sel = document.getElementById("addItemLtSel");
    sel.innerHTML = '<option value="">Select leave type…</option>' +
      leaveTypes.map(function(lt) {
        return '<option value="' + esc(lt.leave_type_id) + '">' + esc(lt.name) + '</option>';
      }).join("");
    document.getElementById("addItemModal").classList.add("open");
  }

  document.getElementById("addItemCancelBtn").addEventListener("click", function() {
    document.getElementById("addItemModal").classList.remove("open");
  });

  document.getElementById("addItemConfirmBtn").addEventListener("click", async function() {
    var policyId = document.getElementById("addItemPolicyId").value;
    var ltId = document.getElementById("addItemLtSel").value;
    var days = parseFloat(document.getElementById("addItemDays").value || 0);
    if (!ltId) { showToast("Select a leave type", true); return; }
    var r = await fetch("/api/hr/leave/policy-items", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ leave_policy_id: policyId, leave_type_id: ltId, days_allocated: days }),
    });
    var d = await r.json();
    if (d.ok) {
      showToast("Allocation added");
      document.getElementById("addItemModal").classList.remove("open");
      loadAll();
    } else showToast(d.error || "Error", true);
  });

  // ── Assign Modal ────────────────────────────────────────────────────────────
  function openAssignModal(policyId) {
    document.getElementById("assignPolicyId").value = policyId;
    var sel = document.getElementById("assignEmpSel");
    sel.innerHTML = '<option value="">Select employee…</option>' +
      employees.map(function(e) {
        var name = [e.first_name, e.last_name].filter(Boolean).join(" ");
        return '<option value="' + esc(e.staff_id) + '">' + esc(name) + '</option>';
      }).join("");
    document.getElementById("assignModal").classList.add("open");
  }

  document.getElementById("assignCancelBtn").addEventListener("click", function() {
    document.getElementById("assignModal").classList.remove("open");
  });

  document.getElementById("assignConfirmBtn").addEventListener("click", async function() {
    var policyId = document.getElementById("assignPolicyId").value;
    var staffId = document.getElementById("assignEmpSel").value;
    var year = document.getElementById("assignYear").value;
    if (!staffId) { showToast("Select an employee", true); return; }
    var btn = document.getElementById("assignConfirmBtn");
    btn.disabled = true;
    var r = await fetch("/api/hr/leave/allocations/assign", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ staff_id: staffId, leave_policy_id: policyId, year: parseInt(year) }),
    });
    var d = await r.json();
    btn.disabled = false;
    if (d.ok) {
      showToast("Policy assigned & balances created");
      document.getElementById("assignModal").classList.remove("open");
    } else showToast(d.error || "Error", true);
  });

  loadAll();
})();

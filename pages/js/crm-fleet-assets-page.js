(function () {
  var root = document.getElementById("fleetAssetPage");
  if (!root) return;

  var resource = root.getAttribute("data-resource") || "vehicles";
  var title = root.getAttribute("data-title") || "Fleet Records";
  var description = root.getAttribute("data-description") || "Records are stored in Google Sheets.";
  var fieldList = (root.getAttribute("data-fields") || "").split(",").map(function (f) { return f.trim(); }).filter(Boolean);
  var primaryField = root.getAttribute("data-primary") || fieldList[0] || "name";
  var rows = [];

  function esc(s) {
    return String(s || "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  }
  function norm(s) { return String(s || "").toLowerCase().trim(); }
  function money(v) { return v === undefined || v === null || v === "" ? "—" : "$" + (Number(v) || 0).toFixed(2); }
  function label(field) { return field.replace(/_/g, " ").replace(/\b\w/g, function (m) { return m.toUpperCase(); }); }
  function isDateField(field) { return field.indexOf("date") >= 0 || field.indexOf("due") >= 0 || field === "needed_by" || field === "reported_date"; }
  function isMoneyField(field) { return ["cost", "purchase_cost", "replacement_value", "estimated_cost", "estimated_unit_cost", "repair_cost"].includes(field); }

  function statusBadge(record) {
    var s = norm(record.status || "");
    var cls = "";
    if (["missing", "broken", "out", "out_of_service", "overdue", "open"].includes(s)) cls = " danger";
    else if (["maintenance", "repair", "planned", "low", "not_counted", "requested", "in_review", "repairing"].includes(s)) cls = " warning";
    else if (["active", "completed", "ok", "resolved", "used", "picked_up"].includes(s)) cls = " good";
    return '<span class="asset-badge' + cls + '">' + esc(record.status || "—") + '</span>';
  }

  function stockWarning(record) {
    if (resource !== "truck-stock") return "";
    var current = Number(record.current_quantity || 0);
    var reorder = Number(record.reorder_point || 0);
    if (!record.last_counted_at) return '<span class="asset-badge warning">Not counted</span>';
    if (current <= 0) return '<span class="asset-badge danger">Out of stock</span>';
    if (reorder && current < reorder) return '<span class="asset-badge warning">Low stock</span>';
    return '<span class="asset-badge good">OK</span>';
  }

  function emptyMessage() {
    var map = {
      vehicles: "No vehicle records yet",
      maintenance: "No maintenance records yet",
      tools: "No tools/assets recorded yet",
      "tool-issues": "No tool issues recorded yet",
      inventory: "No inventory items recorded yet",
      "truck-stock": "No truck stock records yet",
      "material-requests": "No material requests yet"
    };
    return map[resource] || "No records yet";
  }

  function renderShell() {
    root.innerHTML =
      '<div class="asset-page-head">' +
        '<div><h1>' + esc(title) + '</h1><p>' + esc(description) + '</p><p class="asset-note">Records are stored in Google Sheets. Live GPS comes from Traccar only.</p></div>' +
        '<button class="asset-btn" id="refreshAssetBtn">Refresh</button>' +
      '</div>' +
      '<div class="asset-card"><div class="asset-card-title">Create Record</div><div class="asset-form" id="assetForm"></div></div>' +
      '<div class="asset-card"><div class="asset-card-title">Records</div><div id="assetList"><div class="asset-empty">Loading…</div></div></div>';
    document.getElementById("refreshAssetBtn").addEventListener("click", loadRows);
    renderForm();
  }

  function renderForm() {
    var form = document.getElementById("assetForm");
    form.innerHTML = fieldList.map(function (field) {
      if (field === "notes") return '<label><span>Notes</span><textarea name="notes" placeholder="Notes"></textarea></label>';
      var type = isDateField(field) ? "date" : "text";
      if (["cost", "purchase_cost", "replacement_value", "estimated_cost", "estimated_unit_cost", "repair_cost", "quantity", "normal_quantity", "current_quantity", "reorder_point", "odometer", "year"].includes(field)) type = "number";
      return '<label><span>' + esc(label(field)) + '</span><input type="' + type + '" name="' + esc(field) + '" placeholder="' + esc(label(field)) + '" /></label>';
    }).join("") + '<button class="asset-btn asset-btn-wide" id="createAssetBtn">Create ' + esc(title) + ' Record</button>';
    document.getElementById("createAssetBtn").addEventListener("click", createRecord);
  }

  function rowTitle(record) {
    return record[primaryField] || record.name || record.item_name || record.tool_name || record.type || record.vehicle_id || "Record";
  }

  function renderRows() {
    var list = document.getElementById("assetList");
    if (!rows.length) {
      list.innerHTML = '<div class="asset-empty"><strong>' + esc(emptyMessage()) + '</strong><br>Create a real Sheet-backed record when ready. Empty does not mean all clear.</div>';
      return;
    }
    list.innerHTML = '<div class="asset-table-wrap"><table class="asset-table"><thead><tr><th>Name</th><th>Status</th><th>Details</th><th>Notes</th></tr></thead><tbody>' +
      rows.map(function (r) {
        var detailFields = fieldList.filter(function (f) { return ![primaryField, "status", "notes"].includes(f); }).slice(0, 5);
        var details = detailFields.map(function (f) {
          var val = isMoneyField(f) ? money(r[f]) : (r[f] || "");
          return val ? label(f) + ": " + val : "";
        }).filter(Boolean).join(" · ");
        return '<tr><td><strong>' + esc(rowTitle(r)) + '</strong></td><td>' + statusBadge(r) + (stockWarning(r) ? '<br>' + stockWarning(r) : '') + '</td><td>' + esc(details || "—") + '</td><td>' + esc(r.notes || "—") + '</td></tr>';
      }).join("") + '</tbody></table></div>';
  }

  async function api(url, options) {
    try {
      var r = await fetch(url, options || { cache: "no-store" });
      return await r.json();
    } catch (err) {
      return { ok: false, error: err.message };
    }
  }

  async function loadRows() {
    var list = document.getElementById("assetList");
    if (list) list.innerHTML = '<div class="asset-empty">Loading…</div>';
    var result = await api('/api/fleet-assets/' + resource);
    if (!result.ok) {
      rows = [];
      if (list) list.innerHTML = '<div class="asset-error"><strong>Could not load records.</strong><br>' + esc(result.error || 'The /api/fleet-assets route may not be registered yet.') + '</div>';
      return;
    }
    rows = Array.isArray(result.records) ? result.records : [];
    renderRows();
  }

  async function createRecord() {
    var body = {};
    document.querySelectorAll('#assetForm input, #assetForm textarea, #assetForm select').forEach(function (el) {
      body[el.name] = el.value;
    });
    var btn = document.getElementById("createAssetBtn");
    btn.disabled = true;
    btn.textContent = "Creating…";
    var result = await api('/api/fleet-assets/' + resource, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });
    btn.disabled = false;
    btn.textContent = "Create " + title + " Record";
    if (!result.ok) return alert(result.error || "Could not create record.");
    document.querySelectorAll('#assetForm input, #assetForm textarea').forEach(function (el) { el.value = ""; });
    loadRows();
  }

  renderShell();
  loadRows();
})();

(function () {
  if (window.location.pathname !== "/crm/fleet") return;
  if (document.getElementById("fleetOwnerOverview")) return;

  var state = {
    positions: [],
    trips: [],
    tasks: [],
    expenses: [],
    traccar: { ok: false, online: false, lastPoll: "", mode: null },
    availability: { positions: false, trips: false, tasks: false, expenses: false }
  };

  function esc(s) {
    return String(s || "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  }
  function norm(s) { return String(s || "").toLowerCase().trim(); }
  function asArray(v) { return Array.isArray(v) ? v : []; }
  function todayISO() { return new Date().toISOString().slice(0, 10); }
  function isOpenStatus(s) { return !["done", "closed", "complete", "completed", "cancelled"].includes(norm(s)); }
  function containsAny(text, words) {
    var t = norm(text);
    return words.some(function (w) { return t.indexOf(w) >= 0; });
  }
  function money(n) { return "$" + (Number(n) || 0).toFixed(2); }
  function fmtDate(value) {
    if (!value) return "—";
    var raw = String(value).slice(0, 10);
    var d = new Date(raw + "T00:00:00");
    if (Number.isNaN(d.getTime())) return raw;
    return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
  }

  function injectStyles() {
    if (document.getElementById("fleetOwnerOverviewStyles")) return;
    var style = document.createElement("style");
    style.id = "fleetOwnerOverviewStyles";
    style.textContent = [
      "#fleetOwnerOverview{border-bottom:1px solid rgba(255,255,255,.08);background:rgba(11,15,20,.96);padding:12px 12px 10px;max-height:45vh;overflow:auto}",
      ".fo-title{display:flex;align-items:center;justify-content:space-between;gap:8px;margin-bottom:8px}",
      ".fo-title strong{font-size:12px;text-transform:uppercase;letter-spacing:.07em;color:#cbd5e1}",
      ".fo-refresh{border:1px solid rgba(255,255,255,.12);background:transparent;color:#94a3b8;border-radius:8px;font-size:11px;font-weight:800;padding:5px 8px;cursor:pointer}",
      ".fo-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:7px;margin-bottom:10px}",
      ".fo-kpi{border:1px solid rgba(255,255,255,.08);background:rgba(255,255,255,.035);border-radius:10px;padding:8px}",
      ".fo-label{font-size:9px;color:#64748b;text-transform:uppercase;letter-spacing:.06em;font-weight:900}",
      ".fo-value{font-size:18px;font-weight:950;margin-top:2px;color:#e2e8f0}",
      ".fo-note{font-size:10px;color:#94a3b8;line-height:1.25;margin-top:2px}",
      ".fo-section{border-top:1px solid rgba(255,255,255,.08);padding-top:9px;margin-top:9px}",
      ".fo-section h3{font-size:11px;text-transform:uppercase;letter-spacing:.07em;color:#94a3b8;margin:0 0 6px}",
      ".fo-list{display:flex;flex-direction:column;gap:6px}",
      ".fo-row{border:1px solid rgba(255,255,255,.07);background:rgba(0,0,0,.14);border-radius:9px;padding:7px 8px;font-size:11px;color:#cbd5e1;line-height:1.32}",
      ".fo-row b{display:block;color:#f8fafc;font-size:12px;margin-bottom:2px}",
      ".fo-row .muted{color:#94a3b8}",
      ".fo-pill{display:inline-block;border-radius:999px;padding:2px 7px;font-size:9px;font-weight:900;margin-left:4px;background:rgba(96,165,250,.14);color:#93c5fd}",
      ".fo-pill.warn{background:rgba(251,191,36,.14);color:#fcd34d}",
      ".fo-pill.crit{background:rgba(248,113,113,.14);color:#fca5a5}",
      ".fo-empty{border:1px dashed rgba(255,255,255,.12);border-radius:9px;padding:8px;color:#94a3b8;font-size:11px;line-height:1.35}",
      ".fo-form{display:grid;grid-template-columns:1fr;gap:6px;margin-top:7px}",
      ".fo-form input,.fo-form select,.fo-form textarea{width:100%;background:#0b0f14;border:1px solid rgba(255,255,255,.12);border-radius:8px;color:#e2e8f0;padding:7px;font-size:11px;font-family:inherit}",
      ".fo-form textarea{min-height:50px;resize:vertical}",
      ".fo-btn{border:0;background:#2563eb;color:#fff;border-radius:8px;font-size:11px;font-weight:900;padding:8px;cursor:pointer}",
      ".fo-error{background:rgba(248,113,113,.12);border:1px solid rgba(248,113,113,.25);color:#fecaca;border-radius:9px;padding:8px;font-size:11px;margin-bottom:8px}",
      "@media(max-width:768px){#fleetOwnerOverview{max-height:50vh}.fo-grid{grid-template-columns:1fr}}"
    ].join("\n");
    document.head.appendChild(style);
  }

  function mountOverview() {
    injectStyles();
    var panel = document.getElementById("fleetPanel");
    var header = panel && panel.querySelector(".fleet-panel-header");
    if (!panel || !header) return false;
    var div = document.createElement("div");
    div.id = "fleetOwnerOverview";
    div.innerHTML = '<div class="fo-title"><strong>Owner Fleet / Assets</strong><button class="fo-refresh" id="foRefresh">Refresh</button></div><div id="foContent"><div class="fo-empty">Loading fleet, tool, and inventory readiness…</div></div>';
    header.insertAdjacentElement("afterend", div);
    div.querySelector("#foRefresh").addEventListener("click", loadAll);
    return true;
  }

  function api(url, options) {
    return fetch(url, options || { cache: "no-store" })
      .then(function (r) { return r.json(); })
      .catch(function (err) { return { ok: false, error: err.message }; });
  }

  function openFleetTasks() {
    return state.tasks.filter(function (t) {
      var text = [t.type, t.title, t.notes].join(" ");
      return isOpenStatus(t.status) && containsAny(text, [
        "fleet", "vehicle", "truck", "maintenance", "oil", "tire", "brake",
        "tool", "asset", "broken", "missing", "repair", "stock", "inventory",
        "material", "reorder"
      ]);
    });
  }

  function taskGroup(words) {
    return openFleetTasks().filter(function (t) {
      return containsAny([t.type, t.title, t.notes].join(" "), words);
    });
  }

  function expenseGroup(words) {
    return state.expenses.filter(function (e) {
      return containsAny([e.category, e.type, e.payee, e.vendor, e.notes].join(" "), words);
    }).slice(0, 8);
  }

  function actionRows(rows, emptyText) {
    if (!rows.length) return '<div class="fo-empty">' + esc(emptyText) + '</div>';
    return '<div class="fo-list">' + rows.slice(0, 5).map(function (t) {
      var due = t.due_date ? 'Due ' + fmtDate(t.due_date) : 'No due date';
      var pri = norm(t.priority) === "high" || norm(t.priority) === "critical" ? ' crit' : norm(t.priority) === "medium" ? ' warn' : '';
      return '<div class="fo-row"><b>' + esc(t.title) + '<span class="fo-pill' + pri + '">' + esc(t.priority || 'medium') + '</span></b><span class="muted">' + esc(t.type || 'Task') + ' · ' + esc(due) + ' · ' + esc(t.status || 'Open') + '</span><br>' + esc(t.notes || '') + '</div>';
    }).join('') + (rows.length > 5 ? '<div class="fo-empty">' + (rows.length - 5) + ' more fleet/asset task(s) in Tasks.</div>' : '') + '</div>';
  }

  function expenseRows(rows, emptyText) {
    if (!rows.length) return '<div class="fo-empty">' + esc(emptyText) + '</div>';
    return '<div class="fo-list">' + rows.slice(0, 5).map(function (e) {
      return '<div class="fo-row"><b>' + esc(e.category || e.type || 'Expense') + '<span class="fo-pill">' + esc(money(e.amount)) + '</span></b><span class="muted">' + esc(fmtDate(e.date)) + ' · ' + esc(e.payee || e.vendor || 'No vendor') + '</span><br>' + esc(e.notes || '') + '</div>';
    }).join('') + '</div>';
  }

  function render() {
    var content = document.getElementById("foContent");
    if (!content) return;

    var vehicleCount = state.availability.positions ? state.positions.length : null;
    var fleetTasks = openFleetTasks();
    var maintenanceTasks = taskGroup(["maintenance", "oil", "tire", "brake", "vehicle", "truck", "fleet"]);
    var toolTasks = taskGroup(["tool", "asset", "broken", "missing", "repair"]);
    var stockTasks = taskGroup(["stock", "inventory", "material", "reorder"]);
    var vehicleExpenses = expenseGroup(["fuel", "gas", "vehicle", "truck", "maintenance", "oil", "tire", "brake"]);
    var materialExpenses = expenseGroup(["material", "parts", "inventory", "stock", "supply"]);
    var gpsText = state.availability.positions
      ? (state.traccar.online ? "Online" : "Offline/not connected")
      : "Unavailable";

    var warnings = [];
    if (!state.availability.positions || !state.traccar.online) warnings.push("Traccar/GPS not connected or offline");
    if (!state.availability.tasks) warnings.push("Fleet action tracking unavailable");
    if (!state.availability.expenses) warnings.push("Expense/material cost data unavailable");
    if (maintenanceTasks.length) warnings.push(maintenanceTasks.length + " fleet/maintenance task(s) open");
    if (toolTasks.length) warnings.push(toolTasks.length + " tool/asset issue task(s) open");
    if (stockTasks.length) warnings.push(stockTasks.length + " stock/material task(s) open");

    content.innerHTML =
      (warnings.length ? '<div class="fo-error"><b>Owner warnings</b><br>' + esc(warnings.join(" · ")) + '</div>' : '') +
      '<div class="fo-grid">' +
        '<div class="fo-kpi"><div class="fo-label">Vehicles / GPS</div><div class="fo-value">' + esc(vehicleCount === null ? '—' : vehicleCount) + '</div><div class="fo-note">Traccar status: ' + esc(gpsText) + '</div></div>' +
        '<div class="fo-kpi"><div class="fo-label">Fleet tasks</div><div class="fo-value">' + esc(state.availability.tasks ? fleetTasks.length : '—') + '</div><div class="fo-note">Open Tasks tagged fleet/tool/stock/material</div></div>' +
        '<div class="fo-kpi"><div class="fo-label">Tool issues</div><div class="fo-value">' + esc(state.availability.tasks ? toolTasks.length : '—') + '</div><div class="fo-note">Missing/broken/repair tasks</div></div>' +
        '<div class="fo-kpi"><div class="fo-label">Stock/materials</div><div class="fo-value">' + esc(state.availability.tasks ? stockTasks.length : '—') + '</div><div class="fo-note">Low stock/reorder/material tasks</div></div>' +
      '</div>' +
      '<div class="fo-section"><h3>Vehicles / Traccar</h3>' + renderVehicles() + '</div>' +
      '<div class="fo-section"><h3>Maintenance / Vehicle Readiness</h3>' + actionRows(maintenanceTasks, 'No open fleet maintenance tasks found. Dedicated FleetMaintenance records are not connected yet.') + expenseRows(vehicleExpenses, 'No recent vehicle/fuel/maintenance expenses found.') + '</div>' +
      '<div class="fo-section"><h3>Tools / Assets / Issues</h3>' + actionRows(toolTasks, 'No open missing/broken/repair tool tasks found. Dedicated ToolAssets and ToolIssues registries are not connected yet.') + '</div>' +
      '<div class="fo-section"><h3>Truck Stock / Inventory / Materials</h3>' + actionRows(stockTasks, 'No open low-stock/material/reorder tasks found. Dedicated InventoryItems, TruckStock, and MaterialRequests tabs are not connected yet.') + expenseRows(materialExpenses, 'No recent material/parts expenses found.') + '</div>' +
      '<div class="fo-section"><h3>Log Fleet / Tool / Stock Action</h3>' + renderActionForm() + '</div>' +
      '<div class="fo-section"><h3>Data limits</h3><div class="fo-empty">Step 5A uses existing Traccar, Tasks, and Expenses data only. Dedicated vehicle registry, maintenance log, tool registry, tool issue log, truck stock, and material request tabs are not created in this pass to avoid risky central route/schema changes.</div></div>';

    bindActionForm();
  }

  function renderVehicles() {
    if (!state.availability.positions) return '<div class="fo-empty">Could not load Traccar positions.</div>';
    if (!state.traccar.online) return '<div class="fo-empty">Traccar is offline or not configured. Vehicle GPS visibility is limited until TRACCAR_URL and TRACCAR_TOKEN are connected.</div>';
    if (!state.positions.length) return '<div class="fo-empty">Traccar is online, but no vehicles are currently reporting.</div>';
    var tripsById = {};
    state.trips.forEach(function (t) { tripsById[String(t.deviceId)] = t; });
    return '<div class="fo-list">' + state.positions.slice(0, 6).map(function (p) {
      var t = tripsById[String(p.deviceId)] || {};
      return '<div class="fo-row"><b>' + esc(p.deviceName || ('Device ' + p.deviceId)) + '<span class="fo-pill">' + esc(p.speed > 3 ? 'moving' : 'stopped') + '</span></b><span class="muted">' + esc((t.miles_today || 0) + ' mi today · ' + (t.drive_minutes_today || 0) + 'm drive') + '</span><br>Last fix: ' + esc(p.fixTime ? new Date(p.fixTime).toLocaleString() : '—') + '</div>';
    }).join('') + '</div>';
  }

  function renderActionForm() {
    return '<div class="fo-form">' +
      '<select id="foActionType"><option value="Fleet Maintenance">Fleet Maintenance</option><option value="Tool Issue">Tool Issue</option><option value="Truck Stock">Truck Stock / Inventory</option><option value="Material Request">Material Request</option><option value="Asset Task">Asset Task</option></select>' +
      '<input id="foActionTitle" placeholder="Short title, e.g. Truck 1 oil change due" />' +
      '<input id="foActionDue" type="date" value="' + todayISO() + '" />' +
      '<select id="foActionPriority"><option value="high">High</option><option value="medium" selected>Medium</option><option value="low">Low</option></select>' +
      '<textarea id="foActionNotes" placeholder="Notes, vehicle/tool/item, quantity, vendor, next due, etc."></textarea>' +
      '<button class="fo-btn" id="foCreateAction">Create Fleet/Asset Task</button>' +
    '</div>';
  }

  function bindActionForm() {
    var btn = document.getElementById("foCreateAction");
    if (!btn) return;
    btn.addEventListener("click", async function () {
      var title = document.getElementById("foActionTitle").value.trim();
      if (!title) return alert("Add a short title first.");
      btn.disabled = true;
      btn.textContent = "Creating…";
      var payload = {
        title: title,
        type: document.getElementById("foActionType").value,
        due_date: document.getElementById("foActionDue").value,
        priority: document.getElementById("foActionPriority").value,
        notes: document.getElementById("foActionNotes").value
      };
      var result = await api("/api/tasks", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
      btn.disabled = false;
      btn.textContent = "Create Fleet/Asset Task";
      if (!result.ok) return alert(result.error || "Could not create task.");
      document.getElementById("foActionTitle").value = "";
      document.getElementById("foActionNotes").value = "";
      await loadAll();
    });
  }

  async function loadAll() {
    var pos = await api("/api/traccar/positions");
    var trips = await api("/api/traccar/trips");
    var tasks = await api("/api/tasks");
    var expenses = await api("/api/expenses");

    state.availability.positions = !!pos.ok;
    state.availability.trips = !!trips.ok;
    state.availability.tasks = !!tasks.ok;
    state.availability.expenses = !!expenses.ok;
    state.traccar = { ok: !!pos.ok, online: !!pos.online, lastPoll: pos.lastPoll || "", mode: pos.mode || null };
    state.positions = asArray(pos.positions);
    state.trips = asArray(trips.trips);
    state.tasks = asArray(tasks.tasks);
    state.expenses = asArray(expenses.entries);
    render();
  }

  function boot() {
    if (!mountOverview()) return setTimeout(boot, 250);
    loadAll();
  }

  boot();
})();

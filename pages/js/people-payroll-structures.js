(function () {
  var allStructures = [];
  var allComponents = [];

  function esc(s) { return String(s||"").replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;"); }
  function toast(msg, err) {
    var t = document.getElementById("toast");
    t.textContent = msg; t.className = "toast show" + (err ? " error" : "");
    setTimeout(function () { t.className = "toast"; }, 3000);
  }

  function render() {
    var el = document.getElementById("structList");
    if (allStructures.length === 0) { el.innerHTML = '<div class="empty"><strong>No structures yet</strong></div>'; return; }
    el.innerHTML = allStructures.map(function (s) {
      var badges = (s.items || []).map(function (i) {
        if (!i.component) return "";
        var cls = i.component.type === "Earning" ? "earning" : "deduction";
        return '<span class="comp-badge ' + cls + '">' + esc(i.component.name) + '</span>';
      }).join("");
      return '<div class="struct-card">' +
        '<div class="struct-top">' +
          '<div><div class="struct-name">' + esc(s.name) + '</div>' +
          (s.description ? '<div class="struct-desc">' + esc(s.description) + '</div>' : '') + '</div>' +
          '<div class="struct-actions">' +
            '<button class="btn-icon" data-id="' + esc(s.structure_id) + '" data-action="edit">Edit</button>' +
            '<button class="btn-icon btn-del" data-id="' + esc(s.structure_id) + '" data-action="delete">Delete</button>' +
          '</div>' +
        '</div>' +
        '<div class="comp-badges">' + (badges || '<span style="font-size:12px;color:var(--muted)">No components</span>') + '</div>' +
      '</div>';
    }).join("");
  }

  function buildCompSelector(selectedIds) {
    var sel = document.getElementById("compSelector");
    sel.innerHTML = allComponents.map(function (c) {
      var checked = selectedIds && selectedIds.indexOf(c.component_id) !== -1 ? "checked" : "";
      var cls = c.type === "Earning" ? "earning" : "deduction";
      return '<label class="comp-sel-item' + (checked ? " selected" : "") + '">' +
        '<input type="checkbox" value="' + esc(c.component_id) + '" ' + checked + ' />' +
        '<span class="comp-sel-name">' + esc(c.name) + '</span>' +
        '<span class="comp-badge ' + cls + '">' + esc(c.type) + '</span>' +
      '</label>';
    }).join("");
    sel.querySelectorAll("label").forEach(function (lbl) {
      lbl.addEventListener("change", function () {
        lbl.classList.toggle("selected", lbl.querySelector("input").checked);
      });
    });
  }

  function openModal(struct) {
    document.getElementById("editId").value = struct ? struct.structure_id : "";
    document.getElementById("modalTitle").textContent = struct ? "Edit Structure" : "New Salary Structure";
    document.getElementById("fieldName").value = struct ? struct.name : "";
    document.getElementById("fieldDesc").value = struct ? struct.description : "";
    var selectedIds = struct ? (struct.items || []).map(function (i) { return i.component_id; }) : [];
    buildCompSelector(selectedIds);
    document.getElementById("modal").classList.add("open");
  }

  function closeModal() { document.getElementById("modal").classList.remove("open"); }
  document.getElementById("cancelBtn").addEventListener("click", closeModal);
  document.getElementById("addBtn").addEventListener("click", function () { openModal(null); });

  document.getElementById("structList").addEventListener("click", function (e) {
    var btn = e.target.closest("[data-action]");
    if (!btn) return;
    var id = btn.dataset.id; var action = btn.dataset.action;
    if (action === "edit") {
      var struct = allStructures.find(function (s) { return s.structure_id === id; });
      if (struct) openModal(struct);
    } else if (action === "delete") {
      if (!confirm("Delete this structure? Existing assignments will keep their data.")) return;
      fetch("/api/hr/payroll/structures/" + id, { method: "DELETE" }).then(function (r) { return r.json(); }).then(function (d) {
        if (d.ok) { toast("Deleted"); load(); } else toast(d.error, true);
      });
    }
  });

  document.getElementById("saveBtn").addEventListener("click", function () {
    var id = document.getElementById("editId").value;
    var selected = Array.from(document.querySelectorAll("#compSelector input:checked")).map(function (cb) { return { component_id: cb.value }; });
    var body = {
      name: document.getElementById("fieldName").value.trim(),
      description: document.getElementById("fieldDesc").value.trim(),
      items: selected,
    };
    if (!body.name) { toast("Name is required", true); return; }
    var url = id ? "/api/hr/payroll/structures/" + id : "/api/hr/payroll/structures";
    var method = id ? "PATCH" : "POST";
    fetch(url, { method: method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) })
      .then(function (r) { return r.json(); })
      .then(function (d) {
        if (d.ok) { toast("Saved"); closeModal(); load(); } else toast(d.error || "Error", true);
      });
  });

  function load() {
    Promise.all([
      fetch("/api/hr/payroll/structures").then(function (r) { return r.json(); }),
      fetch("/api/hr/payroll/components").then(function (r) { return r.json(); }),
    ]).then(function (results) {
      if (results[0].ok) allStructures = results[0].structures;
      if (results[1].ok) allComponents = results[1].components;
      render();
    });
  }

  load();
})();

(function () {
  var allComponents = [];

  function esc(s) { return String(s||"").replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;"); }
  function toast(msg, err) {
    var t = document.getElementById("toast");
    t.textContent = msg; t.className = "toast show" + (err ? " error" : "");
    setTimeout(function () { t.className = "toast"; }, 3000);
  }

  function renderList(type, containerId) {
    var list = allComponents.filter(function (c) { return c.type === type; });
    var el = document.getElementById(containerId);
    if (list.length === 0) { el.innerHTML = '<div class="empty">No ' + type.toLowerCase() + 's defined yet.</div>'; return; }
    el.innerHTML = list.map(function (c) {
      var detail = c.value_type === "Fixed" ? "$" + (parseFloat(c.amount)||0).toFixed(2) : "Formula: " + esc(c.formula);
      return '<div class="comp-card">' +
        '<div class="comp-info"><div class="comp-name">' + esc(c.name) + '</div>' +
        '<div class="comp-meta">' + esc(c.value_type) + ' · ' + detail + ' · Taxable: ' + (c.taxable === "TRUE" ? "Yes" : "No") + '</div></div>' +
        '<div class="comp-actions">' +
          '<button class="btn-icon" data-id="' + esc(c.component_id) + '" data-action="edit">Edit</button>' +
          '<button class="btn-icon btn-del" data-id="' + esc(c.component_id) + '" data-action="delete">Delete</button>' +
        '</div>' +
      '</div>';
    }).join("");
  }

  function render() {
    renderList("Earning", "earningsList");
    renderList("Deduction", "deductionsList");
  }

  function load() {
    fetch("/api/hr/payroll/components").then(function (r) { return r.json(); }).then(function (d) {
      if (d.ok) { allComponents = d.components; render(); }
    });
  }

  function openModal(comp) {
    document.getElementById("editId").value = comp ? comp.component_id : "";
    document.getElementById("modalTitle").textContent = comp ? "Edit Component" : "New Component";
    document.getElementById("fieldName").value = comp ? comp.name : "";
    document.getElementById("fieldType").value = comp ? comp.type : "Earning";
    document.getElementById("fieldValueType").value = comp ? comp.value_type : "Fixed";
    document.getElementById("fieldAmount").value = comp ? comp.amount : "";
    document.getElementById("fieldFormula").value = comp ? comp.formula : "";
    document.getElementById("fieldTaxable").value = (comp && comp.taxable === "FALSE") ? "no" : "yes";
    toggleValueType(comp ? comp.value_type : "Fixed");
    document.getElementById("modal").classList.add("open");
    document.getElementById("fieldName").focus();
  }

  function toggleValueType(vt) {
    document.getElementById("amountRow").style.display = vt === "Fixed" ? "" : "none";
    document.getElementById("formulaRow").style.display = vt === "Formula" ? "" : "none";
  }

  document.getElementById("fieldValueType").addEventListener("change", function () {
    toggleValueType(this.value);
  });

  function closeModal() { document.getElementById("modal").classList.remove("open"); }
  document.getElementById("cancelBtn").addEventListener("click", closeModal);
  document.getElementById("addBtn").addEventListener("click", function () { openModal(null); });

  document.addEventListener("click", function (e) {
    var btn = e.target.closest("[data-action]");
    if (!btn) return;
    var id = btn.dataset.id;
    var action = btn.dataset.action;
    if (action === "edit") {
      var comp = allComponents.find(function (c) { return c.component_id === id; });
      if (comp) openModal(comp);
    } else if (action === "delete") {
      if (!confirm("Delete this component?")) return;
      fetch("/api/hr/payroll/components/" + id, { method: "DELETE" }).then(function (r) { return r.json(); }).then(function (d) {
        if (d.ok) { toast("Deleted"); load(); } else toast(d.error, true);
      });
    }
  });

  document.getElementById("saveBtn").addEventListener("click", function () {
    var id = document.getElementById("editId").value;
    var body = {
      name: document.getElementById("fieldName").value.trim(),
      type: document.getElementById("fieldType").value,
      value_type: document.getElementById("fieldValueType").value,
      amount: document.getElementById("fieldAmount").value,
      formula: document.getElementById("fieldFormula").value,
      taxable: document.getElementById("fieldTaxable").value === "yes",
    };
    if (!body.name) { toast("Name is required", true); return; }
    var url = id ? "/api/hr/payroll/components/" + id : "/api/hr/payroll/components";
    var method = id ? "PATCH" : "POST";
    fetch(url, { method: method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) })
      .then(function (r) { return r.json(); })
      .then(function (d) {
        if (d.ok) { toast("Saved"); closeModal(); load(); } else toast(d.error || "Error", true);
      });
  });

  load();
})();

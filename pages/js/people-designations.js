(function() {
  var designations = [];
  function qs(id) { return document.getElementById(id); }
  function esc(s) { return String(s||"").replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;"); }

  function showToast(msg, isError) {
    var t = qs("toast");
    t.textContent = msg;
    t.className = "toast" + (isError ? " error" : "");
    t.classList.add("show");
    setTimeout(function() { t.classList.remove("show"); }, 3000);
  }

  function render() {
    var list = qs("desigList");
    if (!designations.length) {
      list.innerHTML = '<div class="empty"><strong>No designations yet</strong>Create your first designation to get started.</div>';
      return;
    }
    list.innerHTML = designations.map(function(d) {
      return '<div class="desig-card">' +
        '<div class="desig-info">' +
          '<div class="desig-name">' + esc(d.name) + '</div>' +
          (d.description ? '<div class="desig-desc">' + esc(d.description) + '</div>' : '') +
        '</div>' +
        '<div class="desig-actions">' +
          '<button class="btn-icon" data-edit="' + esc(d.designation_id) + '">Edit</button>' +
          '<button class="btn-icon btn-del" data-del="' + esc(d.designation_id) + '" data-name="' + esc(d.name) + '">Delete</button>' +
        '</div>' +
      '</div>';
    }).join("");

    list.querySelectorAll("[data-edit]").forEach(function(btn) {
      btn.addEventListener("click", function() { editDesig(btn.getAttribute("data-edit")); });
    });
    list.querySelectorAll("[data-del]").forEach(function(btn) {
      btn.addEventListener("click", function() { deleteDesig(btn.getAttribute("data-del"), btn.getAttribute("data-name")); });
    });
  }

  async function load() {
    try {
      var r = await fetch("/api/hr/designations");
      var d = await r.json();
      if (d.ok) { designations = d.designations || []; render(); }
    } catch (err) {
      showToast("Failed to load designations", true);
    }
  }

  function openModal(desig) {
    qs("editId").value = desig ? desig.designation_id : "";
    qs("fieldName").value = desig ? desig.name : "";
    qs("fieldDesc").value = desig ? desig.description : "";
    qs("modalTitle").textContent = desig ? "Edit Designation" : "New Designation";
    qs("modal").classList.add("open");
    setTimeout(function() { qs("fieldName").focus(); }, 50);
  }

  function editDesig(id) {
    var d = designations.find(function(x) { return x.designation_id === id; });
    if (d) openModal(d);
  }

  async function deleteDesig(id, name) {
    if (!confirm("Delete designation \"" + name + "\"? This cannot be undone.")) return;
    try {
      var r = await fetch("/api/hr/designations/" + id, { method: "DELETE" });
      var d = await r.json();
      if (d.ok) { showToast("Designation deleted"); load(); }
      else showToast(d.error || "Delete failed", true);
    } catch (err) { showToast(err.message, true); }
  }

  qs("addBtn").addEventListener("click", function() { openModal(null); });
  qs("cancelBtn").addEventListener("click", function() { qs("modal").classList.remove("open"); });
  qs("modal").addEventListener("click", function(e) {
    if (e.target === qs("modal")) qs("modal").classList.remove("open");
  });

  qs("saveBtn").addEventListener("click", async function() {
    var name = (qs("fieldName").value || "").trim();
    if (!name) { showToast("Name is required", true); return; }
    var id = qs("editId").value;
    var payload = { name: name, description: (qs("fieldDesc").value || "").trim() };
    try {
      qs("saveBtn").disabled = true;
      var r = id
        ? await fetch("/api/hr/designations/" + id, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) })
        : await fetch("/api/hr/designations", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
      var d = await r.json();
      if (d.ok) { showToast(id ? "Designation updated" : "Designation created"); qs("modal").classList.remove("open"); load(); }
      else showToast(d.error || "Save failed", true);
    } catch (err) { showToast(err.message, true); }
    finally { qs("saveBtn").disabled = false; }
  });

  load();
})();

(function() {
  var departments = [];
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
    var list = qs("deptList");
    if (!departments.length) {
      list.innerHTML = '<div class="empty"><strong>No departments yet</strong>Create your first department to get started.</div>';
      return;
    }
    list.innerHTML = departments.map(function(d) {
      return '<div class="dept-card">' +
        '<div class="dept-info">' +
          '<div class="dept-name">' + esc(d.name) + '</div>' +
          (d.description ? '<div class="dept-desc">' + esc(d.description) + '</div>' : '') +
        '</div>' +
        '<div class="dept-actions">' +
          '<button class="btn-icon" data-edit="' + esc(d.dept_id) + '">Edit</button>' +
          '<button class="btn-icon btn-del" data-del="' + esc(d.dept_id) + '" data-name="' + esc(d.name) + '">Delete</button>' +
        '</div>' +
      '</div>';
    }).join("");

    list.querySelectorAll("[data-edit]").forEach(function(btn) {
      btn.addEventListener("click", function() { editDept(btn.getAttribute("data-edit")); });
    });
    list.querySelectorAll("[data-del]").forEach(function(btn) {
      btn.addEventListener("click", function() { deleteDept(btn.getAttribute("data-del"), btn.getAttribute("data-name")); });
    });
  }

  async function load() {
    try {
      var r = await fetch("/api/hr/departments");
      var d = await r.json();
      if (d.ok) { departments = d.departments || []; render(); }
    } catch (err) {
      showToast("Failed to load departments", true);
    }
  }

  function openModal(dept) {
    qs("editId").value = dept ? dept.dept_id : "";
    qs("fieldName").value = dept ? dept.name : "";
    qs("fieldDesc").value = dept ? dept.description : "";
    qs("modalTitle").textContent = dept ? "Edit Department" : "New Department";
    qs("modal").classList.add("open");
    setTimeout(function() { qs("fieldName").focus(); }, 50);
  }

  function editDept(id) {
    var d = departments.find(function(x) { return x.dept_id === id; });
    if (d) openModal(d);
  }

  async function deleteDept(id, name) {
    if (!confirm("Delete department \"" + name + "\"? This cannot be undone.")) return;
    try {
      var r = await fetch("/api/hr/departments/" + id, { method: "DELETE" });
      var d = await r.json();
      if (d.ok) { showToast("Department deleted"); load(); }
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
        ? await fetch("/api/hr/departments/" + id, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) })
        : await fetch("/api/hr/departments", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
      var d = await r.json();
      if (d.ok) { showToast(id ? "Department updated" : "Department created"); qs("modal").classList.remove("open"); load(); }
      else showToast(d.error || "Save failed", true);
    } catch (err) { showToast(err.message, true); }
    finally { qs("saveBtn").disabled = false; }
  });

  load();
})();

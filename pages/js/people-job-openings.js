// pages/js/people-job-openings.js — Job Openings management

let allOpenings = [];
let departments = [];
let designations = [];
let applicantCounts = {};

function esc(s) {
  return String(s || "").replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;").replace(/'/g,"&#39;");
}

function fmtDate(d) {
  if (!d) return "";
  try { return new Date(d + "T00:00:00").toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }); }
  catch { return d; }
}

async function loadAll() {
  const [oRes, dRes, desRes, aRes] = await Promise.all([
    fetch("/api/hr/job-openings"),
    fetch("/api/hr/departments"),
    fetch("/api/hr/designations"),
    fetch("/api/hr/applicants"),
  ]);
  const [oData, dData, desData, aData] = await Promise.all([oRes.json(), dRes.json(), desRes.json(), aRes.json()]);
  allOpenings = oData.openings || [];
  departments = dData.departments || [];
  designations = desData.designations || [];

  // build applicant count per opening
  applicantCounts = {};
  (aData.applicants || []).forEach(a => {
    applicantCounts[a.opening_id] = (applicantCounts[a.opening_id] || 0) + 1;
  });

  populateSelects();
  applyFilter();
}

function populateSelects() {
  const dOpt = '<option value="">— None —</option>' +
    departments.map(d => `<option value="${esc(d.dept_id)}">${esc(d.name)}</option>`).join("");
  const desOpt = '<option value="">— None —</option>' +
    designations.map(d => `<option value="${esc(d.designation_id)}">${esc(d.name)}</option>`).join("");
  document.getElementById("fDept").innerHTML = dOpt;
  document.getElementById("fDesig").innerHTML = desOpt;
}

function applyFilter() {
  const statusFilter = document.getElementById("statusFilter").value;
  let filtered = allOpenings.filter(o => !statusFilter || o.status === statusFilter);
  renderOpenings(filtered);
}

function renderOpenings(openings) {
  const container = document.getElementById("openingsList");
  if (!openings.length) {
    container.innerHTML = '<div class="empty-state">No job openings found. Create your first one above.</div>';
    return;
  }
  container.innerHTML = openings.map(o => {
    const dept = departments.find(d => d.dept_id === o.department_id);
    const desig = designations.find(d => d.designation_id === o.designation_id);
    const count = applicantCounts[o.opening_id] || 0;
    return `
      <div class="opening-card">
        <div class="opening-info">
          <div class="opening-title">${esc(o.title)}
            <span class="badge ${o.status === 'Open' ? 'badge-open' : 'badge-closed'}" style="margin-left:8px">${esc(o.status)}</span>
          </div>
          <div class="opening-meta">
            ${dept ? `<span>🏢 ${esc(dept.name)}</span>` : ""}
            ${desig ? `<span>👤 ${esc(desig.name)}</span>` : ""}
            <span>📅 ${fmtDate(o.posted_date)}</span>
            <span class="badge badge-count">${count} applicant${count !== 1 ? "s" : ""}</span>
          </div>
          ${o.description ? `<div class="opening-desc">${esc(o.description)}</div>` : ""}
        </div>
        <div class="opening-actions">
          <a href="/people/applicants?opening_id=${esc(o.opening_id)}" class="btn-icon">Applicants</a>
          <button class="btn-icon" data-action="edit" data-id="${esc(o.opening_id)}">Edit</button>
          <button class="btn-icon" data-action="toggle" data-id="${esc(o.opening_id)}" data-status="${esc(o.status)}">
            ${o.status === "Open" ? "Close" : "Reopen"}
          </button>
          <button class="btn-icon danger" data-action="delete" data-id="${esc(o.opening_id)}">Delete</button>
        </div>
      </div>`;
  }).join("");
}

function openCreateModal() {
  document.getElementById("editOpeningId").value = "";
  document.getElementById("modalTitle").textContent = "New Job Opening";
  document.getElementById("fTitle").value = "";
  document.getElementById("fDept").value = "";
  document.getElementById("fDesig").value = "";
  document.getElementById("fStatus").value = "Open";
  document.getElementById("fDesc").value = "";
  document.getElementById("openingModal").classList.add("open");
}

function openEditModal(openingId) {
  const o = allOpenings.find(x => x.opening_id === openingId);
  if (!o) return;
  document.getElementById("editOpeningId").value = o.opening_id;
  document.getElementById("modalTitle").textContent = "Edit Job Opening";
  document.getElementById("fTitle").value = o.title || "";
  document.getElementById("fDept").value = o.department_id || "";
  document.getElementById("fDesig").value = o.designation_id || "";
  document.getElementById("fStatus").value = o.status || "Open";
  document.getElementById("fDesc").value = o.description || "";
  document.getElementById("openingModal").classList.add("open");
}

function closeModal() {
  document.getElementById("openingModal").classList.remove("open");
}

async function saveOpening() {
  const id = document.getElementById("editOpeningId").value;
  const title = document.getElementById("fTitle").value.trim();
  if (!title) { alert("Title is required."); return; }
  const body = {
    title,
    department_id: document.getElementById("fDept").value,
    designation_id: document.getElementById("fDesig").value,
    status: document.getElementById("fStatus").value,
    description: document.getElementById("fDesc").value,
  };
  const url = id ? `/api/hr/job-openings/${id}` : "/api/hr/job-openings";
  const method = id ? "PATCH" : "POST";
  const r = await fetch(url, { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const d = await r.json();
  if (d.ok) { closeModal(); loadAll(); }
  else alert(d.error || "Save failed");
}

async function toggleStatus(openingId, currentStatus) {
  const newStatus = currentStatus === "Open" ? "Closed" : "Open";
  const r = await fetch(`/api/hr/job-openings/${openingId}`, {
    method: "PATCH", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ status: newStatus }),
  });
  const d = await r.json();
  if (d.ok) loadAll();
  else alert(d.error || "Update failed");
}

async function deleteOpening(openingId) {
  if (!confirm("Delete this job opening? Applicants linked to it will remain but may show no opening title.")) return;
  const r = await fetch(`/api/hr/job-openings/${openingId}`, { method: "DELETE" });
  const d = await r.json();
  if (d.ok) loadAll();
  else alert(d.error || "Delete failed");
}

document.getElementById("openingModal").addEventListener("click", e => {
  if (e.target === e.currentTarget) closeModal();
});

// Delegated handler for opening card action buttons (avoids inline onclick + quote escaping issues)
document.getElementById("openingsList").addEventListener("click", e => {
  const btn = e.target.closest("button[data-action]");
  if (!btn) return;
  const { action, id, status } = btn.dataset;
  if (action === "edit") openEditModal(id);
  else if (action === "toggle") toggleStatus(id, status);
  else if (action === "delete") deleteOpening(id);
});

loadAll();

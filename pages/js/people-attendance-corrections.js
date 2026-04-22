// pages/js/people-attendance-corrections.js — Admin correction request review

let corrections  = [];
let employees    = [];

function esc(s) {
  return String(s || "").replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;");
}

function toast(msg, isError = false) {
  const el = document.getElementById("toast");
  el.textContent = msg;
  el.className = "toast show" + (isError ? " error" : "");
  setTimeout(() => { el.className = "toast"; }, 3000);
}

function empName(staffId) {
  const e = employees.find(x => x.staff_id === staffId);
  return e ? `${e.first_name} ${e.last_name}` : staffId;
}

function fmtDate(s) {
  if (!s) return "—";
  const d = new Date(s + "T00:00:00");
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

function statusBadge(s) {
  return `<span class="status-badge status-${s}">${s}</span>`;
}

function renderList() {
  const filter = document.getElementById("statusFilter").value;
  const filtered = filter ? corrections.filter(c => c.status === filter) : corrections;
  const list = document.getElementById("corrList");

  if (!filtered.length) {
    list.innerHTML = '<div class="empty"><strong>No correction requests found</strong></div>';
    return;
  }

  list.innerHTML = filtered.map(c => {
    const isPending = c.status === "pending";
    return `
      <div class="corr-card" id="card-${c.correction_id}">
        <div class="corr-top">
          <div>
            <div class="corr-name">${esc(empName(c.staff_id))}</div>
            <div class="corr-meta">Date: ${fmtDate(c.date)} · Requested: <strong>${esc(c.requested_status)}</strong> · Submitted: ${fmtDate(c.created_at ? c.created_at.slice(0,10) : "")}</div>
          </div>
          ${statusBadge(c.status)}
        </div>
        ${c.reason ? `<div class="corr-reason">"${esc(c.reason)}"</div>` : ""}
        ${isPending ? `
          <div class="corr-actions">
            <input class="admin-notes-input" type="text" placeholder="Admin notes (optional)…" id="notes-${c.correction_id}" />
            <button class="btn-approve" onclick="resolve('${c.correction_id}', 'approved')">Approve</button>
            <button class="btn-reject"  onclick="resolve('${c.correction_id}', 'rejected')">Reject</button>
          </div>
        ` : `
          <div class="resolved-note">
            ${c.admin_notes ? `Admin note: ${esc(c.admin_notes)} · ` : ""}
            Resolved: ${fmtDate(c.updated_at ? c.updated_at.slice(0,10) : "")}
          </div>
        `}
      </div>`;
  }).join("");
}

window.resolve = async function(corrId, status) {
  const notesEl = document.getElementById(`notes-${corrId}`);
  const admin_notes = notesEl ? notesEl.value.trim() : "";
  try {
    const resp = await fetch(`/api/hr/corrections/${corrId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status, admin_notes }),
    });
    const data = await resp.json();
    if (!data.ok) return toast(data.error || "Failed", true);
    toast(status === "approved" ? "Approved — attendance updated" : "Rejected");
    await load();
  } catch {
    toast("Network error", true);
  }
};

async function load() {
  try {
    const [cResp, eResp] = await Promise.all([
      fetch("/api/hr/corrections"),
      fetch("/api/hr/employees"),
    ]);
    const [cData, eData] = await Promise.all([cResp.json(), eResp.json()]);
    if (cData.ok) corrections = cData.corrections.sort((a, b) => (a.created_at < b.created_at ? 1 : -1));
    if (eData.ok) employees   = eData.employees;
    renderList();
  } catch {
    toast("Failed to load", true);
  }
}

document.getElementById("statusFilter").addEventListener("change", renderList);
document.addEventListener("DOMContentLoaded", load);

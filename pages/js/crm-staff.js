// pages/js/crm-staff.js — Staff management for CRM owner

const ALL_PERMS = [
  { id: "jobs",     label: "Today's Jobs" },
  { id: "time",     label: "Log Time" },
  { id: "expenses", label: "Log Expenses" },
  { id: "schedule", label: "View Schedule" },
  { id: "history",  label: "Time History" },
];

let allStaff = [];
let activeFilter = "all";

document.addEventListener("DOMContentLoaded", () => {
  loadStaff();

  document.querySelectorAll(".filter-tab").forEach(btn => {
    btn.addEventListener("click", () => {
      document.querySelectorAll(".filter-tab").forEach(b => b.classList.remove("active"));
      btn.classList.add("active");
      activeFilter = btn.dataset.filter;
      renderStaff();
    });
  });
});

async function loadStaff() {
  try {
    const res  = await fetch("/api/crew/staff");
    const data = await res.json();
    if (!data.ok) throw new Error(data.error || "Failed to load staff");
    allStaff = data.staff || [];
    renderStaff();
    updatePendingBanner();
  } catch (err) {
    document.getElementById("staffGrid").innerHTML =
      `<div class="empty"><strong>Could not load staff</strong>${err.message}</div>`;
  }
}

function updatePendingBanner() {
  const pending = allStaff.filter(s => s.status === "pending");
  const banner  = document.getElementById("pendingBanner");
  const text    = document.getElementById("pendingText");
  if (!banner || !text) return;
  if (pending.length > 0) {
    text.textContent = `${pending.length} account request${pending.length > 1 ? "s" : ""} waiting for approval.`;
    banner.classList.remove("hidden");
  } else {
    banner.classList.add("hidden");
  }
}

function renderStaff() {
  const grid = document.getElementById("staffGrid");
  if (!grid) return;

  const filtered = activeFilter === "all"
    ? allStaff
    : allStaff.filter(s => s.status === activeFilter);

  if (!filtered.length) {
    grid.innerHTML = `<div class="empty"><strong>No staff in this category</strong>Accounts will appear here once someone requests access.</div>`;
    return;
  }

  // Sort: pending first, then active, then inactive
  const order = { pending: 0, active: 1, inactive: 2 };
  const sorted = [...filtered].sort((a, b) => (order[a.status] ?? 9) - (order[b.status] ?? 9));

  grid.innerHTML = sorted.map(s => buildCard(s)).join("");

  // Bind actions
  grid.querySelectorAll(".btn-approve").forEach(btn =>
    btn.addEventListener("click", () => updateStatus(btn.dataset.id, btn.dataset.phone, "active"))
  );
  grid.querySelectorAll(".btn-deny").forEach(btn =>
    btn.addEventListener("click", () => updateStatus(btn.dataset.id, btn.dataset.phone, "inactive"))
  );
  grid.querySelectorAll(".btn-activate").forEach(btn =>
    btn.addEventListener("click", () => updateStatus(btn.dataset.id, btn.dataset.phone, "active"))
  );
  grid.querySelectorAll(".btn-deactivate").forEach(btn =>
    btn.addEventListener("click", () => updateStatus(btn.dataset.id, btn.dataset.phone, "inactive"))
  );
  grid.querySelectorAll(".btn-save-perms").forEach(btn => {
    btn.addEventListener("click", () => {
      const staffId = btn.dataset.id;
      const chips = grid.querySelectorAll(`.perm-chip[data-staff="${staffId}"]`);
      const perms = [...chips].filter(c => c.classList.contains("on")).map(c => c.dataset.perm).join(",");
      savePermissions(staffId, perms);
    });
  });

  // Toggle permission chips
  grid.querySelectorAll(".perm-chip").forEach(chip => {
    chip.addEventListener("click", () => chip.classList.toggle("on"));
  });
}

function buildCard(s) {
  const badgeClass = { pending: "badge-pending", active: "badge-active", inactive: "badge-inactive" }[s.status] || "badge-inactive";
  const badgeLabel = { pending: "Pending", active: "Active", inactive: "Inactive" }[s.status] || s.status;
  const currentPerms = new Set((s.permissions || "").split(",").map(p => p.trim()));
  const joined = s.created_at ? new Date(s.created_at).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }) : "";

  const permsHtml = ALL_PERMS.map(p =>
    `<button class="perm-chip${currentPerms.has(p.id) ? " on" : ""}" data-perm="${p.id}" data-staff="${s.staff_id}">${p.label}</button>`
  ).join("");

  let actionsHtml = "";
  if (s.status === "pending") {
    actionsHtml = `
      <button class="btn-action btn-approve" data-id="${s.staff_id}" data-phone="${esc(s.phone)}">✓ Approve</button>
      <button class="btn-action btn-deny"    data-id="${s.staff_id}" data-phone="${esc(s.phone)}">✕ Deny</button>`;
  } else if (s.status === "active") {
    actionsHtml = `
      <button class="btn-action btn-save-perms" data-id="${s.staff_id}">Save Permissions</button>
      <button class="btn-action btn-deactivate" data-id="${s.staff_id}" data-phone="${esc(s.phone)}">Deactivate</button>`;
  } else {
    actionsHtml = `
      <button class="btn-action btn-activate" data-id="${s.staff_id}" data-phone="${esc(s.phone)}">Re-activate</button>`;
  }

  return `
    <div class="staff-card${s.status === "pending" ? " pending" : ""}" id="card-${s.staff_id}">
      <div class="staff-card-top">
        <div>
          <div class="staff-name">${esc(s.first_name)} ${esc(s.last_name)}</div>
          <div class="staff-meta">${esc(s.phone)}${joined ? " · Requested " + joined : ""}</div>
        </div>
        <span class="badge ${badgeClass}">${badgeLabel}</span>
      </div>
      <div class="perms-label">Crew Portal Access</div>
      <div class="perms-chips">${permsHtml}</div>
      <div class="staff-actions">${actionsHtml}</div>
    </div>`;
}

async function updateStatus(staffId, phone, status) {
  try {
    const res  = await fetch(`/api/crew/staff/${staffId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status, phone }),
    });
    const data = await res.json();
    if (!data.ok) throw new Error("Update failed");
    const action = status === "active" ? "Approved" : status === "inactive" ? "Deactivated" : "Updated";
    showToast(`${action} successfully`);
    // Update local state and re-render
    const idx = allStaff.findIndex(s => s.staff_id === staffId);
    if (idx >= 0) allStaff[idx].status = status;
    renderStaff();
    updatePendingBanner();
  } catch (err) {
    showToast("Error: " + err.message, true);
  }
}

async function savePermissions(staffId, permissions) {
  try {
    const res  = await fetch(`/api/crew/staff/${staffId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ permissions }),
    });
    const data = await res.json();
    if (!data.ok) throw new Error("Save failed");
    showToast("Permissions saved");
    const idx = allStaff.findIndex(s => s.staff_id === staffId);
    if (idx >= 0) allStaff[idx].permissions = permissions;
  } catch (err) {
    showToast("Error: " + err.message, true);
  }
}

function showToast(msg, isError = false) {
  const t = document.getElementById("toast");
  if (!t) return;
  t.textContent = msg;
  t.className = "toast" + (isError ? " error" : "");
  t.classList.add("show");
  setTimeout(() => t.classList.remove("show"), 3000);
}

function esc(s) {
  return String(s || "").replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;");
}

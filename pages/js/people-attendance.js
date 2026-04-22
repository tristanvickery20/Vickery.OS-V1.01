// pages/js/people-attendance.js — Daily Attendance screen

let attendanceData   = [];
let departments      = [];
let shifts           = [];
let pendingChanges   = {};

function esc(s) {
  return String(s || "").replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;");
}

function toast(msg, isError = false) {
  const el = document.getElementById("toast");
  el.textContent = msg;
  el.className = "toast show" + (isError ? " error" : "");
  setTimeout(() => { el.className = "toast"; }, 3000);
}

function todayStr() {
  const d = new Date();
  return d.toISOString().slice(0, 10);
}

function statusClass(s) {
  const m = { "Present": "status-present", "Absent": "status-absent", "On Leave": "status-on-leave", "Half Day": "status-half-day" };
  return m[s] || "status-none";
}

function sourceLabel(source) {
  if (!source) return "";
  if (source === "auto")       return '<span class="source-badge source-auto">auto</span>';
  if (source === "correction") return '<span class="source-badge source-correction">corrected</span>';
  return "";
}

function renderSummary(rows) {
  const counts = { Present: 0, Absent: 0, "On Leave": 0, "Half Day": 0, "": 0 };
  rows.forEach(r => { counts[r.status] = (counts[r.status] || 0) + 1; });
  const bar = document.getElementById("summaryBar");
  bar.innerHTML = `
    <span class="summary-chip chip-present">✓ Present: ${counts["Present"]}</span>
    <span class="summary-chip chip-absent">✗ Absent: ${counts["Absent"]}</span>
    <span class="summary-chip chip-leave">◐ On Leave: ${counts["On Leave"]}</span>
    <span class="summary-chip chip-halfday">½ Half Day: ${counts["Half Day"]}</span>
    <span class="summary-chip chip-unmarked">— Unmarked: ${counts[""]}</span>
  `;
}

function deptName(id) {
  const d = departments.find(x => x.dept_id === id);
  return d ? d.name : "—";
}

function renderRows(rows) {
  const deptFilter = document.getElementById("deptFilter").value;
  const filtered = deptFilter ? rows.filter(r => r.department_id === deptFilter) : rows;

  const tbody = document.getElementById("attendanceBody");
  if (!filtered.length) {
    tbody.innerHTML = '<tr><td colspan="5" class="empty"><strong>No employees found</strong></td></tr>';
    return;
  }
  tbody.innerHTML = filtered.map(r => {
    const key = r.staff_id;
    const currentStatus = (pendingChanges[key] !== undefined) ? pendingChanges[key].status : r.status;
    const currentNotes  = (pendingChanges[key] !== undefined) ? pendingChanges[key].notes  : r.notes;
    const statusOpts = ["", "Present", "Absent", "On Leave", "Half Day"].map(s =>
      `<option value="${s}" ${currentStatus === s ? "selected" : ""}>${s || "— Select —"}</option>`
    ).join("");
    return `
      <tr>
        <td><span class="emp-name">${esc(r.first_name)} ${esc(r.last_name)}</span>${sourceLabel(r.source)}</td>
        <td>${esc(deptName(r.department_id))}</td>
        <td>
          <select class="status-select ${statusClass(currentStatus)}" data-id="${key}"
            onchange="onStatusChange(this)">
            ${statusOpts}
          </select>
        </td>
        <td>
          <input class="notes-input" type="text" placeholder="Notes…"
            value="${esc(currentNotes)}" data-id="${key}"
            oninput="onNotesChange(this)" />
        </td>
        <td>
          ${pendingChanges[key] !== undefined
            ? `<button class="btn-save-row" onclick="saveRow('${key}')">Save</button>`
            : ""}
        </td>
      </tr>`;
  }).join("");
}

window.onStatusChange = function(sel) {
  const id = sel.dataset.id;
  const row = attendanceData.find(r => r.staff_id === id);
  if (!pendingChanges[id]) pendingChanges[id] = { status: row ? row.status : "", notes: row ? row.notes : "" };
  pendingChanges[id].status = sel.value;
  sel.className = `status-select ${statusClass(sel.value)}`;
  renderRows(attendanceData);
};

window.onNotesChange = function(inp) {
  const id = inp.dataset.id;
  const row = attendanceData.find(r => r.staff_id === id);
  if (!pendingChanges[id]) pendingChanges[id] = { status: row ? row.status : "", notes: row ? row.notes : "" };
  pendingChanges[id].notes = inp.value;
};

window.saveRow = async function(staffId) {
  const ch = pendingChanges[staffId];
  if (!ch || !ch.status) return toast("Select a status first", true);
  const date = document.getElementById("datePicker").value;
  const row = attendanceData.find(r => r.staff_id === staffId);
  try {
    const resp = await fetch("/api/hr/attendance", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ staff_id: staffId, date, status: ch.status, shift_id: row ? row.shift_id : "", notes: ch.notes }),
    });
    const data = await resp.json();
    if (!data.ok) return toast(data.error || "Save failed", true);
    delete pendingChanges[staffId];
    toast("Saved");
    await loadAttendance();
  } catch {
    toast("Network error", true);
  }
};

async function markAllPresent() {
  const date = document.getElementById("datePicker").value;
  const deptId = document.getElementById("deptFilter").value;
  const body = { date, status: "Present" };
  if (deptId) body.department_id = deptId;
  try {
    const resp = await fetch("/api/hr/attendance/bulk", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const data = await resp.json();
    if (!data.ok) return toast(data.error || "Failed", true);
    toast(`Marked ${data.count} employees Present`);
    pendingChanges = {};
    await loadAttendance();
  } catch {
    toast("Network error", true);
  }
}

async function syncFromTimeLog() {
  const date = document.getElementById("datePicker").value;
  try {
    const resp = await fetch("/api/hr/attendance/sync", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ date }),
    });
    const data = await resp.json();
    if (!data.ok) return toast(data.error || "Sync failed", true);
    toast(`Synced ${data.synced} records from time log`);
    await loadAttendance();
  } catch {
    toast("Network error", true);
  }
}

async function loadAttendance() {
  const date = document.getElementById("datePicker").value;
  try {
    const resp = await fetch(`/api/hr/attendance?date=${date}`);
    const data = await resp.json();
    if (data.ok) {
      attendanceData = data.attendance;
      renderSummary(attendanceData);
      renderRows(attendanceData);
    }
  } catch {}
}

async function loadPendingBadge() {
  try {
    const resp = await fetch("/api/hr/corrections");
    const data = await resp.json();
    if (data.ok) {
      const pending = data.corrections.filter(c => c.status === "pending").length;
      const badge = document.getElementById("pendingBadge");
      if (badge) {
        badge.textContent = pending;
        badge.style.display = pending ? "inline" : "none";
      }
    }
  } catch {}
}

async function loadDepts() {
  try {
    const resp = await fetch("/api/hr/departments");
    const data = await resp.json();
    if (data.ok) {
      departments = data.departments;
      const sel = document.getElementById("deptFilter");
      const existing = sel.value;
      sel.innerHTML = '<option value="">All Departments</option>' +
        departments.map(d => `<option value="${d.dept_id}">${esc(d.name)}</option>`).join("");
      sel.value = existing;
    }
  } catch {}
}

function init() {
  const datePicker = document.getElementById("datePicker");
  datePicker.value = todayStr();
  datePicker.addEventListener("change", () => { pendingChanges = {}; loadAttendance(); });
  document.getElementById("deptFilter").addEventListener("change", () => renderRows(attendanceData));
  document.getElementById("markAllBtn").addEventListener("click", markAllPresent);
  document.getElementById("syncBtn").addEventListener("click", syncFromTimeLog);
  loadDepts();
  loadAttendance();
  loadPendingBadge();
}

document.addEventListener("DOMContentLoaded", init);

// pages/js/people-attendance-grid.js — Monthly Attendance Grid

let departments = [];

function esc(s) {
  return String(s || "").replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;");
}

function toast(msg, isError = false) {
  const el = document.getElementById("toast");
  el.textContent = msg;
  el.className = "toast show" + (isError ? " error" : "");
  setTimeout(() => { el.className = "toast"; }, 3000);
}

function currentMonth() {
  return new Date().toISOString().slice(0, 7);
}

function fmtDay(dateStr) {
  const d = new Date(dateStr + "T00:00:00");
  return d.getDate();
}

function dayOfWeek(dateStr) {
  const d = new Date(dateStr + "T00:00:00");
  return ["Su","Mo","Tu","We","Th","Fr","Sa"][d.getDay()];
}

function todayStr() {
  return new Date().toISOString().slice(0, 10);
}

const STATUS_ABBR = { "Present": "P", "Absent": "A", "On Leave": "L", "Half Day": "H" };
const STATUS_CLASS = { "Present": "cell-P", "Absent": "cell-A", "On Leave": "cell-L", "Half Day": "cell-H" };

function renderGrid(data) {
  const wrap = document.getElementById("gridWrap");
  if (!data.employees.length) {
    wrap.innerHTML = '<div class="empty"><strong>No employees for selected filters</strong></div>';
    return;
  }
  const today = todayStr();

  let html = '<table><thead><tr>';
  html += '<th class="name-col">Employee</th>';
  data.dates.forEach(d => {
    const dow = dayOfWeek(d);
    const isToday = d === today;
    html += `<th${isToday ? ' style="color:var(--blue)"' : ""}>${fmtDay(d)}<br><span style="font-weight:400">${dow}</span></th>`;
  });
  html += '</tr></thead><tbody>';

  data.employees.forEach(emp => {
    html += `<tr>
      <td class="emp-name-cell">
        ${esc(emp.first_name)} ${esc(emp.last_name)}
      </td>`;
    data.dates.forEach(d => {
      const key    = `${emp.staff_id}|${d}`;
      const status = data.cells[key] || "";
      const abbr   = STATUS_ABBR[status] || "";
      const cls    = STATUS_CLASS[status] || "cell-";
      const isToday = d === today;
      const title  = `${emp.first_name} ${emp.last_name} — ${d}: ${status || "Not recorded"}`;
      html += `<td><div class="cell ${cls}${isToday ? " cell-today" : ""}" title="${esc(title)}">${abbr}</div></td>`;
    });
    html += "</tr>";
  });

  html += "</tbody></table>";
  wrap.innerHTML = html;
}

async function load() {
  const month  = document.getElementById("monthPicker").value;
  const deptId = document.getElementById("deptFilter").value;
  let url = `/api/hr/attendance/grid?month=${month}`;
  if (deptId) url += `&department_id=${deptId}`;
  try {
    const resp = await fetch(url);
    const data = await resp.json();
    if (!data.ok) return toast(data.error || "Failed to load", true);
    renderGrid(data);
  } catch {
    toast("Network error", true);
  }
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
  const picker = document.getElementById("monthPicker");
  picker.value = currentMonth();
  picker.addEventListener("change", load);
  document.getElementById("deptFilter").addEventListener("change", load);
  loadDepts();
  load();
}

document.addEventListener("DOMContentLoaded", init);

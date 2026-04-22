// pages/js/people-shifts.js — Shift Types management

const DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

let shifts = [];

function toast(msg, isError = false) {
  const el = document.getElementById("toast");
  el.textContent = msg;
  el.className = "toast show" + (isError ? " error" : "");
  setTimeout(() => { el.className = "toast"; }, 3000);
}

function fmtTime(t) {
  if (!t) return "—";
  const [h, m] = t.split(":").map(Number);
  const ampm = h >= 12 ? "PM" : "AM";
  const hh = h % 12 || 12;
  return `${hh}:${String(m).padStart(2, "0")} ${ampm}`;
}

function renderShifts() {
  const list = document.getElementById("shiftList");
  if (!shifts.length) {
    list.innerHTML = '<div class="empty"><strong>No shift types yet</strong>Define your first shift type to get started.</div>';
    return;
  }
  list.innerHTML = shifts.map(s => {
    const days = (s.days_of_week || "").split(",").filter(Boolean).join(", ") || "—";
    const brk  = s.break_minutes ? `${s.break_minutes} min break` : "";
    return `
      <div class="shift-card">
        <div class="shift-info">
          <div class="shift-name">${esc(s.name)}</div>
          <div class="shift-meta">
            <span>${fmtTime(s.start_time)} – ${fmtTime(s.end_time)}</span>
            ${brk ? `<span>${brk}</span>` : ""}
            <span>${days}</span>
          </div>
        </div>
        <div class="shift-actions">
          <button class="btn-icon" onclick="openEdit('${s.shift_id}')">Edit</button>
          <button class="btn-icon btn-del" onclick="doDelete('${s.shift_id}')">Delete</button>
        </div>
      </div>`;
  }).join("");
}

function buildDayBoxes(selected = []) {
  const wrap = document.getElementById("dayBoxes");
  wrap.innerHTML = DAYS.map(d => {
    const checked = selected.includes(d);
    return `<label class="day-label ${checked ? "checked" : ""}" id="day-${d}">
      <input type="checkbox" value="${d}" ${checked ? "checked" : ""} onchange="toggleDay(this)" />
      ${d}
    </label>`;
  }).join("");
}

window.toggleDay = function(cb) {
  const lbl = cb.closest(".day-label");
  lbl.classList.toggle("checked", cb.checked);
};

function getSelectedDays() {
  return DAYS.filter(d => {
    const lbl = document.getElementById(`day-${d}`);
    return lbl && lbl.querySelector("input").checked;
  });
}

function openAdd() {
  document.getElementById("modalTitle").textContent = "New Shift Type";
  document.getElementById("editId").value = "";
  document.getElementById("fieldName").value = "";
  document.getElementById("fieldStart").value = "07:00";
  document.getElementById("fieldEnd").value = "16:00";
  document.getElementById("fieldBreak").value = "30";
  buildDayBoxes(["Mon","Tue","Wed","Thu","Fri"]);
  document.getElementById("modal").classList.add("open");
}

window.openEdit = function(shiftId) {
  const s = shifts.find(x => x.shift_id === shiftId);
  if (!s) return;
  document.getElementById("modalTitle").textContent = "Edit Shift Type";
  document.getElementById("editId").value = shiftId;
  document.getElementById("fieldName").value = s.name;
  document.getElementById("fieldStart").value = s.start_time || "";
  document.getElementById("fieldEnd").value = s.end_time || "";
  document.getElementById("fieldBreak").value = s.break_minutes || "";
  buildDayBoxes((s.days_of_week || "").split(",").filter(Boolean));
  document.getElementById("modal").classList.add("open");
};

function closeModal() {
  document.getElementById("modal").classList.remove("open");
}

async function doSave() {
  const id    = document.getElementById("editId").value;
  const name  = document.getElementById("fieldName").value.trim();
  const start = document.getElementById("fieldStart").value;
  const end   = document.getElementById("fieldEnd").value;
  const brk   = document.getElementById("fieldBreak").value;
  const days  = getSelectedDays();

  if (!name) return toast("Shift name is required", true);

  const body = { name, start_time: start, end_time: end, break_minutes: brk, days_of_week: days };

  try {
    let resp;
    if (id) {
      resp = await fetch(`/api/hr/shifts/${id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    } else {
      resp = await fetch("/api/hr/shifts", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    }
    const data = await resp.json();
    if (!data.ok) return toast(data.error || "Save failed", true);
    closeModal();
    toast(id ? "Shift updated" : "Shift created");
    await load();
  } catch (err) {
    toast("Network error", true);
  }
}

window.doDelete = async function(shiftId) {
  if (!confirm("Delete this shift type? This cannot be undone.")) return;
  try {
    const resp = await fetch(`/api/hr/shifts/${shiftId}`, { method: "DELETE" });
    const data = await resp.json();
    if (!data.ok) return toast("Delete failed", true);
    toast("Shift deleted");
    await load();
  } catch {
    toast("Network error", true);
  }
};

async function load() {
  try {
    const resp = await fetch("/api/hr/shifts");
    const data = await resp.json();
    if (data.ok) shifts = data.shifts;
  } catch {}
  renderShifts();
}

function esc(s) {
  return String(s || "").replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;");
}

document.getElementById("addBtn").addEventListener("click", openAdd);
document.getElementById("cancelBtn").addEventListener("click", closeModal);
document.getElementById("saveBtn").addEventListener("click", doSave);
document.getElementById("modal").addEventListener("click", e => {
  if (e.target === e.currentTarget) closeModal();
});

load();

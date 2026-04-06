// Crew Portal — Vickery Electric
// Self-contained: no shell.js dependency. Works offline-first for name selection.

// ── State ────────────────────────────────────────────────────────────────────
let currentName  = localStorage.getItem("crew_name") || "";
let activeJob    = null; // { booking_id, quote_id, customer_name, address }
let hoursValue   = 2;    // default 2 hours
let amountRaw    = "";   // raw keypad string e.g. "4575" → $45.75
let timeCategory = "On-site";
let expCategory  = "Materials";

// ── Init ─────────────────────────────────────────────────────────────────────
document.addEventListener("DOMContentLoaded", async () => {
  setupTodayLabel();
  await loadCrewMembers();

  if (currentName) {
    showMainScreen();
    loadTodayJobs();
  } else {
    showNameScreen();
  }

  bindOverlayControls();
  bindManualButtons();
});

function setupTodayLabel() {
  const el = document.getElementById("todayLabel");
  if (!el) return;
  el.textContent = new Date().toLocaleDateString("en-US", {
    weekday: "long", month: "long", day: "numeric"
  });
}

// ── Crew name selection ───────────────────────────────────────────────────────
async function loadCrewMembers() {
  try {
    const res = await fetch("/api/crew/members");
    const data = await res.json();
    renderNameButtons(data.members || []);
  } catch {
    renderNameButtons([]);
  }
}

function renderNameButtons(members) {
  const grid = document.getElementById("nameGrid");
  if (!grid) return;

  if (!members.length) {
    // Fallback: free-text input
    grid.innerHTML = `
      <input class="form-input" type="text" id="manualNameInput" placeholder="Enter your name" style="margin-bottom:12px;font-size:18px;padding:16px;border-radius:14px;background:hsl(220 10% 10%);border:1px solid hsl(220 10% 22%);color:hsl(220 15% 88%);font-family:inherit;width:100%;" />
      <button class="name-btn" id="confirmName" style="margin-top:4px;">Continue →</button>`;
    document.getElementById("confirmName")?.addEventListener("click", () => {
      const val = document.getElementById("manualNameInput")?.value.trim();
      if (val) selectName(val);
    });
    return;
  }

  grid.innerHTML = members.map(m =>
    `<button class="name-btn" data-name="${esc(m)}">${esc(m)}</button>`
  ).join("");

  grid.querySelectorAll(".name-btn").forEach(btn => {
    btn.addEventListener("click", () => selectName(btn.dataset.name));
  });
}

function selectName(name) {
  currentName = name;
  localStorage.setItem("crew_name", name);
  showMainScreen();
  loadTodayJobs();
}

// ── Screen switching ──────────────────────────────────────────────────────────
function showNameScreen() {
  document.getElementById("nameScreen").hidden = false;
  document.getElementById("mainScreen").hidden = true;
}

function showMainScreen() {
  document.getElementById("nameScreen").hidden = true;
  document.getElementById("mainScreen").hidden = false;

  const hr = new Date().getHours();
  const greet = hr < 12 ? "Good morning" : hr < 17 ? "Good afternoon" : "Good evening";
  const el = document.getElementById("greeting");
  if (el) el.textContent = `${greet}, ${currentName.split(" ")[0]}`;
}

document.getElementById("switchUser")?.addEventListener("click", () => {
  currentName = "";
  localStorage.removeItem("crew_name");
  showNameScreen();
});

// ── Today's jobs ──────────────────────────────────────────────────────────────
async function loadTodayJobs() {
  const list = document.getElementById("jobList");
  const noJobs = document.getElementById("noJobs");
  if (!list) return;

  list.innerHTML = `<div style="padding:20px;text-align:center;color:hsl(220 15% 45%);">Loading…</div>`;

  try {
    const res = await fetch("/api/crew/today");
    const data = await res.json();
    const jobs = data.jobs || [];

    if (!jobs.length) {
      list.innerHTML = "";
      if (noJobs) noJobs.hidden = false;
      return;
    }

    if (noJobs) noJobs.hidden = true;
    list.innerHTML = jobs.map(j => jobCard(j)).join("");
    list.querySelectorAll(".btn-time").forEach(btn => {
      btn.addEventListener("click", () => openTimeOverlay(JSON.parse(btn.dataset.job)));
    });
    list.querySelectorAll(".btn-expense").forEach(btn => {
      btn.addEventListener("click", () => openExpenseOverlay(JSON.parse(btn.dataset.job)));
    });
  } catch (err) {
    list.innerHTML = `<div style="color:hsl(0 60% 55%);padding:16px;">Could not load today's jobs.</div>`;
  }
}

function jobCard(j) {
  const block = j.schedule_block ? `${j.schedule_block} · ` : "";
  const dur   = j.duration_minutes ? `${j.duration_minutes} min` : "";
  const jobData = esc(JSON.stringify(j));
  return `
    <div class="job-card">
      <div class="job-block">${block}${dur}</div>
      <div class="job-customer">${esc(j.customer_name || "Customer")}</div>
      <div class="job-address">${esc(j.address || "—")}</div>
      <div class="job-actions">
        <button class="btn-time" data-job='${jobData}'>⏱ Log Time</button>
        <button class="btn-expense" data-job='${jobData}'>💳 Expense</button>
      </div>
    </div>`;
}

// ── Overlay controls ──────────────────────────────────────────────────────────
function bindOverlayControls() {
  // Time overlay
  document.getElementById("closeTime")?.addEventListener("click", () => closeOverlay("timeOverlay"));
  document.getElementById("timeOverlay")?.addEventListener("click", e => {
    if (e.target === e.currentTarget) closeOverlay("timeOverlay");
  });

  // Hours ±1
  document.getElementById("hoursUp")?.addEventListener("click", () => adjustHours(1));
  document.getElementById("hoursDown")?.addEventListener("click", () => adjustHours(-1));

  // Fine adjustments
  document.querySelectorAll("[data-add]").forEach(btn => {
    btn.addEventListener("click", () => adjustHours(parseFloat(btn.dataset.add)));
  });

  // Category chips (time)
  document.getElementById("timeCategory")?.addEventListener("click", e => {
    const chip = e.target.closest(".chip");
    if (!chip) return;
    document.querySelectorAll("#timeCategory .chip").forEach(c => c.classList.remove("selected"));
    chip.classList.add("selected");
    timeCategory = chip.dataset.val;
  });

  // Submit time
  document.getElementById("submitTime")?.addEventListener("click", submitTime);

  // Expense overlay
  document.getElementById("closeExpense")?.addEventListener("click", () => closeOverlay("expenseOverlay"));
  document.getElementById("expenseOverlay")?.addEventListener("click", e => {
    if (e.target === e.currentTarget) closeOverlay("expenseOverlay");
  });

  // Category chips (expense)
  document.getElementById("expenseCategory")?.addEventListener("click", e => {
    const chip = e.target.closest(".chip");
    if (!chip) return;
    document.querySelectorAll("#expenseCategory .chip").forEach(c => c.classList.remove("selected"));
    chip.classList.add("selected");
    expCategory = chip.dataset.val;
  });

  // Keypad
  document.getElementById("keypad")?.addEventListener("click", e => {
    const key = e.target.closest(".key");
    if (!key) return;
    handleKeypad(key.dataset.k);
  });

  // Submit expense
  document.getElementById("submitExpense")?.addEventListener("click", submitExpense);
}

function bindManualButtons() {
  document.getElementById("manualTime")?.addEventListener("click", () => openTimeOverlay(null));
  document.getElementById("manualExpense")?.addEventListener("click", () => openExpenseOverlay(null));
}

// ── Hours control ─────────────────────────────────────────────────────────────
function adjustHours(delta) {
  hoursValue = Math.max(0.25, Math.round((hoursValue + delta) * 4) / 4);
  renderHours();
}

function renderHours() {
  const el = document.getElementById("hoursDisplay");
  if (!el) return;
  el.textContent = hoursValue % 1 === 0 ? String(hoursValue) : hoursValue.toFixed(2);
}

// ── Keypad control ────────────────────────────────────────────────────────────
function handleKeypad(k) {
  if (k === "del") {
    amountRaw = amountRaw.slice(0, -1);
  } else if (k === ".") {
    if (!amountRaw.includes(".")) amountRaw += ".";
  } else {
    // Limit decimal places to 2
    const dotIdx = amountRaw.indexOf(".");
    if (dotIdx >= 0 && amountRaw.length - dotIdx > 2) return;
    amountRaw += k;
  }
  renderAmount();
}

function renderAmount() {
  const el = document.getElementById("amountVal");
  if (!el) return;
  el.textContent = amountRaw || "0.00";
}

function getAmountValue() {
  return parseFloat(amountRaw) || 0;
}

// ── Overlay open/close ────────────────────────────────────────────────────────
function openTimeOverlay(job) {
  activeJob    = job;
  hoursValue   = 2;
  timeCategory = "On-site";
  document.querySelectorAll("#timeCategory .chip").forEach((c, i) => c.classList.toggle("selected", i === 0));
  document.getElementById("timeNotes").value = "";
  const lbl = document.getElementById("timeJobLabel");
  if (lbl) lbl.textContent = job ? `${job.customer_name} — ${job.address}` : "No specific job";
  renderHours();
  document.getElementById("timeOverlay").classList.add("open");
}

function openExpenseOverlay(job) {
  activeJob   = job;
  amountRaw   = "";
  expCategory = "Materials";
  document.querySelectorAll("#expenseCategory .chip").forEach((c, i) => c.classList.toggle("selected", i === 0));
  document.getElementById("expenseVendor").value = "";
  document.getElementById("expenseNotes").value = "";
  const lbl = document.getElementById("expenseJobLabel");
  if (lbl) lbl.textContent = job ? `${job.customer_name} — ${job.address}` : "No specific job";
  renderAmount();
  document.getElementById("expenseOverlay").classList.add("open");
}

function closeOverlay(id) {
  document.getElementById(id)?.classList.remove("open");
}

// ── Submissions ───────────────────────────────────────────────────────────────
async function submitTime() {
  const btn = document.getElementById("submitTime");
  if (btn) btn.disabled = true;

  const today = new Date().toISOString().slice(0, 10);
  const body = {
    date:     today,
    tech_id:  currentName,
    lead_id:  activeJob ? (activeJob.quote_id || activeJob.booking_id || "") : "",
    minutes:  Math.round(hoursValue * 60),
    category: timeCategory,
    notes:    document.getElementById("timeNotes")?.value.trim() || "",
  };

  try {
    const res = await fetch("/api/time", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const data = await res.json();
    if (!data.ok) throw new Error(data.error || "Server error");
    closeOverlay("timeOverlay");
    showToast(`✓ ${hoursValue} hr${hoursValue !== 1 ? "s" : ""} logged`);
  } catch (err) {
    showToast("Error: " + err.message, true);
  } finally {
    if (btn) btn.disabled = false;
  }
}

async function submitExpense() {
  const amount = getAmountValue();
  if (amount <= 0) { showToast("Enter an amount first", true); return; }

  const btn = document.getElementById("submitExpense");
  if (btn) btn.disabled = true;

  const today = new Date().toISOString().slice(0, 10);
  const body = {
    date:    today,
    tech_id: currentName,
    lead_id: activeJob ? (activeJob.quote_id || activeJob.booking_id || "") : "",
    type:    expCategory,
    vendor:  document.getElementById("expenseVendor")?.value.trim() || "",
    amount:  amount,
    notes:   document.getElementById("expenseNotes")?.value.trim() || "",
  };

  try {
    const res = await fetch("/api/expenses", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const data = await res.json();
    if (!data.ok) throw new Error(data.error || "Server error");
    closeOverlay("expenseOverlay");
    showToast(`✓ $${amount.toFixed(2)} ${expCategory} logged`);
  } catch (err) {
    showToast("Error: " + err.message, true);
  } finally {
    if (btn) btn.disabled = false;
  }
}

// ── Toast ─────────────────────────────────────────────────────────────────────
function showToast(msg, isError = false) {
  const t = document.getElementById("toast");
  if (!t) return;
  t.textContent = msg;
  t.className = "toast" + (isError ? " error" : "");
  t.classList.add("show");
  setTimeout(() => t.classList.remove("show"), 3000);
}

// ── Helpers ───────────────────────────────────────────────────────────────────
function esc(s) {
  return String(s || "").replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;").replace(/'/g,"&#39;");
}

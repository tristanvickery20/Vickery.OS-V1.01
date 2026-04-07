// Crew Portal JS — live timer, geolocation, expenses, PWA

let currentSession = null; // { staffId, firstName, lastName, phone, permissions }
let activeJob      = null;
let hoursValue     = 2;
let amountRaw      = "";
let timeCategory   = "On-site";
let expCategory    = "Materials";

// Map state
let _todayJobs    = [];
let _crewMap      = null;
let _crewMarkers  = [];
let _crewTokenP   = null;
let _mapLoaded    = false;

// ── Timer state ───────────────────────────────────────────────────────────────
// Persisted in localStorage so it survives page refresh
const TIMER_KEY = "ve_crew_timer_v2";
let timerState    = null; // { date, bookingId, quoteId, startTime, pausedMs, lat_in, lng_in, isPaused }
let timerInterval = null;

// Today's logged time + expenses, keyed by booking_id or quote_id
let todayTimeMap = {}; // key → total minutes
let todayExpMap  = {}; // key → [{ type, amount, vendor }]

// Inline expense panel state (only one job's panel open at a time)
let expandedExpJobId = null; // booking_id whose expense panel is open

// ── Boot ─────────────────────────────────────────────────────────────────────
document.addEventListener("DOMContentLoaded", async () => {
  try {
    const res  = await fetch("/api/crew/me");
    const data = await res.json();
    if (!data.ok) { window.location.replace("/login"); return; }
    currentSession = data.staff;
  } catch {
    window.location.replace("/login");
    return;
  }

  timerState = loadTimerState();

  setupHeader();
  await loadTodayEntries();
  await loadTodayJobs();
  bindOverlayControls();
  bindJobDetailOverlay();
  bindManualButtons();
  bindLogout();
  bindViewTabs();

  if (timerState) startTimerTick();
});

// ── Header ────────────────────────────────────────────────────────────────────
function setupHeader() {
  const todayEl = document.getElementById("todayLabel");
  if (todayEl) {
    todayEl.textContent = new Date().toLocaleDateString("en-US", {
      weekday: "long", month: "long", day: "numeric",
    });
  }
  const hr    = new Date().getHours();
  const greet = hr < 12 ? "Good morning" : hr < 17 ? "Good afternoon" : "Good evening";
  const el    = document.getElementById("greeting");
  if (el) el.textContent = `${greet}, ${currentSession.firstName}`;

  if (currentSession.role === "owner") {
    const crmBtn = document.getElementById("btnCRM");
    if (crmBtn) crmBtn.style.display = "block";
  }
}

// ── Logout ────────────────────────────────────────────────────────────────────
function bindLogout() {
  document.getElementById("btnLogout")?.addEventListener("click", async () => {
    await fetch("/api/crew/logout", { method: "POST" });
    window.location.replace("/login");
  });
}

// ── Geolocation ───────────────────────────────────────────────────────────────
function getGeo() {
  return new Promise((resolve) => {
    if (!navigator.geolocation) { resolve(null); return; }
    navigator.geolocation.getCurrentPosition(
      (pos) => resolve({ lat: pos.coords.latitude, lng: pos.coords.longitude }),
      ()    => resolve(null),
      { timeout: 8000, maximumAge: 30000, enableHighAccuracy: false }
    );
  });
}

// ── Timer — localStorage persistence ─────────────────────────────────────────
function saveTimerState(state) {
  try { localStorage.setItem(TIMER_KEY, JSON.stringify(state)); } catch {}
}
function loadTimerState() {
  try {
    const raw = localStorage.getItem(TIMER_KEY);
    if (!raw) return null;
    const state = JSON.parse(raw);
    const today = new Date().toISOString().slice(0, 10);
    if (state.date !== today) { localStorage.removeItem(TIMER_KEY); return null; }
    return state;
  } catch { return null; }
}
function clearTimerState() {
  try { localStorage.removeItem(TIMER_KEY); } catch {}
}

// ── Timer — elapsed calculation ───────────────────────────────────────────────
function getElapsedMs() {
  if (!timerState) return 0;
  if (timerState.isPaused) return timerState.pausedMs || 0;
  const now   = Date.now();
  const start = new Date(timerState.startTime).getTime();
  return (now - start) + (timerState.pausedMs || 0);
}

function formatElapsed(ms) {
  const totalSec = Math.floor(ms / 1000);
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  return `${String(h).padStart(2,"0")}:${String(m).padStart(2,"0")}:${String(s).padStart(2,"0")}`;
}

function formatMinutes(mins) {
  if (mins < 60) return `${Math.round(mins)}m`;
  const h = Math.floor(mins / 60);
  const m = Math.round(mins % 60);
  return m ? `${h}h ${m}m` : `${h}h`;
}

// ── Timer — tick ──────────────────────────────────────────────────────────────
function startTimerTick() {
  if (timerInterval) clearInterval(timerInterval);
  timerInterval = setInterval(tickTimer, 1000);
  tickTimer();
}

function tickTimer() {
  if (!timerState) { clearInterval(timerInterval); return; }
  const bid = timerState.bookingId;
  const el  = document.getElementById("elapsed-" + bid);
  if (el) el.textContent = formatElapsed(getElapsedMs());
}

// ── Timer — start ─────────────────────────────────────────────────────────────
async function startTimer(job) {
  if (timerState) {
    const other = _todayJobs.find(j => j.booking_id === timerState.bookingId);
    const name  = other ? other.customer_name : "another job";
    showToast(`Stop the current timer (${name}) first`, true);
    return;
  }
  const geo = await getGeo();
  const now = new Date();
  const techId = currentSession ? `${currentSession.firstName} ${currentSession.lastName}` : "Crew";

  // POST clock-in record immediately so it's durable even if browser crashes
  let timeId = null;
  try {
    const res = await fetch("/api/time", {
      method:  "POST",
      headers: { "Content-Type": "application/json" },
      body:    JSON.stringify({
        date:     now.toISOString().slice(0, 10),
        tech_id:  techId,
        lead_id:  job.quote_id || job.booking_id || "",
        minutes:  0,
        category: "On-site",
        notes:    geo
          ? "GPS clock-in — awaiting clock-out"
          : "GPS clock-in unavailable — awaiting clock-out",
        lat_in:   geo ? geo.lat : null,
        lng_in:   geo ? geo.lng : null,
        lat_out:  null,
        lng_out:  null,
      }),
    });
    const data = await res.json();
    if (data.ok) timeId = data.entry?.id || null;
  } catch {}

  timerState = {
    date:      now.toISOString().slice(0, 10),
    bookingId: job.booking_id,
    quoteId:   job.quote_id || "",
    startTime: now.toISOString(),
    pausedMs:  0,
    isPaused:  false,
    lat_in:    geo ? geo.lat : null,
    lng_in:    geo ? geo.lng : null,
    timeId,
  };
  saveTimerState(timerState);
  renderJobCards();
  startTimerTick();
  showToast(geo ? "Clock started" : "Clock started — GPS unavailable, location not recorded");
}

// ── Timer — pause / resume ────────────────────────────────────────────────────
function pauseTimer() {
  if (!timerState || timerState.isPaused) return;
  timerState.pausedMs  = getElapsedMs();
  timerState.isPaused  = true;
  timerState.pausedAt  = new Date().toISOString();
  saveTimerState(timerState);
  renderJobCards();
  showToast("Clock paused");
}

function resumeTimer() {
  if (!timerState || !timerState.isPaused) return;
  timerState.startTime = new Date().toISOString();
  timerState.isPaused  = false;
  delete timerState.pausedAt;
  saveTimerState(timerState);
  renderJobCards();
  startTimerTick();
  showToast("Clock resumed");
}

// ── Timer — stop & log ────────────────────────────────────────────────────────
async function stopTimer() {
  if (!timerState) return;

  const elapsedMs = getElapsedMs();
  const minutes   = Math.max(1, Math.round(elapsedMs / 60000));
  const snapshot  = { ...timerState };

  clearInterval(timerInterval);
  timerInterval = null;
  timerState    = null;
  clearTimerState();
  renderJobCards();

  const geo = await getGeo();

  const techId = currentSession
    ? `${currentSession.firstName} ${currentSession.lastName}`
    : "Crew";

  const gpsNote = (() => {
    const inOk  = snapshot.lat_in  != null;
    const outOk = geo != null;
    if (inOk && outOk)  return "GPS clock-in/out via crew app";
    if (inOk && !outOk) return "GPS clock-in via crew app; clock-out GPS unavailable";
    if (!inOk && outOk) return "GPS clock-in unavailable; clock-out GPS via crew app";
    return "GPS unavailable for both clock-in and clock-out";
  })();

  const patchBody = {
    minutes,
    category: "On-site",
    notes:    gpsNote,
    lat_in:   snapshot.lat_in,
    lng_in:   snapshot.lng_in,
    lat_out:  geo ? geo.lat : null,
    lng_out:  geo ? geo.lng : null,
  };

  try {
    let ok = false;
    if (snapshot.timeId) {
      // Two-phase: PATCH the existing clock-in record with duration + clock-out coords
      const res  = await fetch(`/api/time/${encodeURIComponent(snapshot.timeId)}`, {
        method:  "PATCH",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify(patchBody),
      });
      const data = await res.json();
      ok = data.ok;
      if (!ok) throw new Error(data.error || "Patch failed");
    } else {
      // Fallback: no timeId (clock-in POST may have failed) — create a fresh record
      const body = {
        date:     snapshot.date,
        tech_id:  techId,
        lead_id:  snapshot.quoteId || snapshot.bookingId || "",
        ...patchBody,
      };
      const res  = await fetch("/api/time", {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify(body),
      });
      const data = await res.json();
      ok = data.ok;
      if (!ok) throw new Error(data.error || "Server error");
    }

    const key = snapshot.quoteId || snapshot.bookingId;
    todayTimeMap[key] = (todayTimeMap[key] || 0) + minutes;

    showToast(`✓ ${formatMinutes(minutes)} logged`);
    renderJobCards();
  } catch (err) {
    showToast("Failed to save time: " + err.message, true);
  }
}

// ── Load today's time and expense entries ─────────────────────────────────────
async function loadTodayEntries() {
  try {
    const [timeRes, expRes] = await Promise.all([
      fetch("/api/crew/time-today").then(r => r.json()).catch(() => ({ entries: [] })),
      fetch("/api/crew/expenses-today").then(r => r.json()).catch(() => ({ entries: [] })),
    ]);

    todayTimeMap = {};
    for (const e of (timeRes.entries || [])) {
      const key = e.lead_id || "";
      if (key) todayTimeMap[key] = (todayTimeMap[key] || 0) + (e.minutes || 0);
    }

    todayExpMap = {};
    for (const e of (expRes.entries || [])) {
      const key = e.lead_id || "";
      if (key) {
        if (!todayExpMap[key]) todayExpMap[key] = [];
        todayExpMap[key].push({ type: e.type, amount: e.amount, vendor: e.vendor || "" });
      }
    }
  } catch {}
}

// ── Today's jobs ──────────────────────────────────────────────────────────────
async function loadTodayJobs() {
  const list   = document.getElementById("jobList");
  const noJobs = document.getElementById("noJobs");
  if (!list) return;
  list.innerHTML = `<div style="padding:20px;text-align:center;color:hsl(220 15% 45%);">Loading…</div>`;
  try {
    const res  = await fetch("/api/crew/today");
    const data = await res.json();
    const jobs = data.jobs || [];
    _todayJobs = jobs;
    if (!jobs.length) {
      list.innerHTML = "";
      if (noJobs) noJobs.hidden = false;
      return;
    }
    if (noJobs) noJobs.hidden = true;
    renderJobCards();
  } catch {
    list.innerHTML = `<div style="color:hsl(0 60% 55%);padding:16px;">Could not load today's jobs.</div>`;
  }
}

function renderJobCards() {
  const list = document.getElementById("jobList");
  if (!list || !_todayJobs.length) return;
  list.innerHTML = _todayJobs.map(jobCard).join("");

  // Restore expanded expense panel if one was open
  if (expandedExpJobId) {
    const panel = document.getElementById("exp-panel-" + expandedExpJobId);
    const toggle = document.getElementById("exp-toggle-" + expandedExpJobId);
    if (panel) { panel.classList.add("open"); }
    if (toggle) { toggle.classList.add("open"); toggle.textContent = "▲ Close"; }
  }

  list.querySelectorAll(".btn-start-clock").forEach(btn =>
    btn.addEventListener("click", () => startTimer(JSON.parse(btn.dataset.job)))
  );
  list.querySelectorAll(".btn-stop-clock").forEach(btn =>
    btn.addEventListener("click", stopTimer)
  );
  list.querySelectorAll(".btn-pause-clock").forEach(btn => {
    btn.addEventListener("click", () => {
      if (timerState?.isPaused) resumeTimer(); else pauseTimer();
    });
  });
  list.querySelectorAll(".btn-expense-toggle").forEach(btn => {
    btn.addEventListener("click", () => toggleExpensePanel(btn.dataset.bid, btn));
  });
  list.querySelectorAll(".exp-cat-chip").forEach(chip => {
    chip.addEventListener("click", () => {
      const row = chip.closest(".exp-category-row");
      row.querySelectorAll(".exp-cat-chip").forEach(c => c.classList.remove("sel"));
      chip.classList.add("sel");
    });
  });
  list.querySelectorAll(".btn-expense-submit").forEach(btn => {
    btn.addEventListener("click", () => submitInlineExpense(btn.dataset.bid, btn));
  });
  list.querySelectorAll(".btn-review-ask").forEach(btn =>
    btn.addEventListener("click", () => sendReviewAsk(JSON.parse(btn.dataset.job), btn))
  );
  list.querySelectorAll(".job-card-top").forEach(el =>
    el.addEventListener("click", () => openJobDetail(JSON.parse(el.dataset.job)))
  );

  // Kick off display update immediately for active timer
  if (timerState) tickTimer();
}

function toggleExpensePanel(bid, toggleBtn) {
  const panel = document.getElementById("exp-panel-" + bid);
  if (!panel) return;
  const isOpen = panel.classList.contains("open");
  if (isOpen) {
    panel.classList.remove("open");
    toggleBtn.classList.remove("open");
    toggleBtn.textContent = "+ Expense";
    expandedExpJobId = null;
  } else {
    // Close any other open panel
    if (expandedExpJobId && expandedExpJobId !== bid) {
      const oldPanel  = document.getElementById("exp-panel-" + expandedExpJobId);
      const oldToggle = document.getElementById("exp-toggle-" + expandedExpJobId);
      if (oldPanel)  oldPanel.classList.remove("open");
      if (oldToggle) { oldToggle.classList.remove("open"); oldToggle.textContent = "+ Expense"; }
    }
    panel.classList.add("open");
    toggleBtn.classList.add("open");
    toggleBtn.textContent = "▲ Close";
    expandedExpJobId = bid;
    panel.querySelector(".exp-amount-input")?.focus();
  }
}

async function submitInlineExpense(bid, btn) {
  const panel  = document.getElementById("exp-panel-" + bid);
  if (!panel) return;

  const amountInput = panel.querySelector(".exp-amount-input");
  const amount = parseFloat(amountInput?.value || "") || 0;
  if (amount <= 0) { showToast("Enter an amount first", true); return; }

  const selCat    = panel.querySelector(".exp-cat-chip.sel");
  const category  = selCat ? selCat.textContent.trim() : "Materials";
  const vendor    = panel.querySelector(".exp-vendor-input")?.value.trim() || "";
  const note      = panel.querySelector(".exp-note-input")?.value.trim() || "";

  const job = _todayJobs.find(j => j.booking_id === bid);
  const leadId = job ? (job.quote_id || job.booking_id || "") : "";

  const origText = btn.textContent;
  btn.disabled = true;
  btn.textContent = "Saving…";

  const techId = currentSession ? `${currentSession.firstName} ${currentSession.lastName}` : "Crew";
  const body = {
    date:    new Date().toISOString().slice(0, 10),
    tech_id: techId,
    lead_id: leadId,
    type:    category,
    vendor,
    amount,
    notes:   note,
  };

  try {
    const res  = await fetch("/api/expenses", {
      method:  "POST",
      headers: { "Content-Type": "application/json" },
      body:    JSON.stringify(body),
    });
    const data = await res.json();
    if (!data.ok) throw new Error(data.error || "Server error");

    // Update local state
    if (!todayExpMap[leadId]) todayExpMap[leadId] = [];
    todayExpMap[leadId].push({ type: category, amount, vendor });

    // Reset form
    if (amountInput) amountInput.value = "";
    panel.querySelector(".exp-vendor-input") && (panel.querySelector(".exp-vendor-input").value = "");
    panel.querySelector(".exp-note-input")   && (panel.querySelector(".exp-note-input").value   = "");

    showToast(`✓ $${amount.toFixed(2)} ${category} logged`);

    // Re-render expense list within the panel (don't close it)
    const listEl = panel.querySelector(".job-expense-list");
    if (listEl && leadId) {
      listEl.innerHTML = renderExpenseList(leadId);
    }
  } catch (err) {
    showToast("Error: " + err.message, true);
  }

  btn.textContent = origText;
  btn.disabled = false;
}

function renderExpenseList(jobKey) {
  const exps = todayExpMap[jobKey] || [];
  if (!exps.length) return "";
  return exps.map(e => `
    <div class="exp-list-row">
      <span class="exp-list-amount">$${Number(e.amount).toFixed(2)}</span>
      <span class="exp-list-type">${esc(e.type)}</span>
      <span class="exp-list-vendor">${esc(e.vendor || "")}</span>
    </div>`).join("");
}

const EXP_CATEGORIES = ["Materials", "Gas", "Tools", "Permits", "Other"];

function jobCard(j) {
  const bid     = j.booking_id;
  const block   = j.schedule_block ? `${j.schedule_block} · ` : "";
  const dur     = j.duration_minutes ? `${j.duration_minutes} min` : "";
  const jobData = esc(JSON.stringify(j));

  // Timer state for this job
  const isActive  = timerState && timerState.bookingId === bid;
  const anyActive = !!timerState;

  // Today's logged summary (time chip only — expenses shown inline below panel)
  const jobKey  = j.quote_id || bid;
  const logMins = todayTimeMap[jobKey] || 0;
  const timeChip = logMins
    ? `<div class="job-logged-bar"><span class="logged-chip time">⏱ ${formatMinutes(logMins)} logged today</span></div>`
    : "";

  // Timer display row (shown when this job is active)
  const timerHtml = isActive ? `
    <div class="timer-row">
      <div class="timer-elapsed" id="elapsed-${esc(bid)}">${formatElapsed(getElapsedMs())}</div>
      ${timerState.isPaused ? `<span class="timer-paused-label">Paused</span>` : ""}
      <button class="btn-pause-clock${timerState.isPaused ? " paused" : ""}" style="font-size:13px;padding:8px 12px;">
        ${timerState.isPaused ? "▶ Resume" : "⏸ Pause"}
      </button>
    </div>` : "";

  // Clock button
  let clockBtn;
  if (isActive) {
    clockBtn = `<button class="btn-stop-clock">■ Stop &amp; Log</button>`;
  } else {
    const disabled = anyActive ? 'disabled title="Stop the current timer first"' : "";
    clockBtn = `<button class="btn-start-clock" data-job='${jobData}' ${disabled}>▶ Start Clock</button>`;
  }

  const reviewBtn = j.phone
    ? `<button class="btn-review-ask" data-job='${jobData}'>★ Review</button>`
    : "";

  // Inline expense form panel
  const catChips = EXP_CATEGORIES.map((cat, i) =>
    `<button class="exp-cat-chip${i === 0 ? " sel" : ""}">${esc(cat)}</button>`
  ).join("");

  const expList = renderExpenseList(jobKey);

  const expPanel = `
    <div class="job-expense-panel" id="exp-panel-${esc(bid)}">
      <div>
        <label>Category</label>
        <div class="exp-category-row">${catChips}</div>
      </div>
      <div>
        <label>Amount</label>
        <div class="exp-amount-row">
          <span class="exp-amount-prefix">$</span>
          <input class="exp-amount-input" type="number" min="0.01" step="0.01" placeholder="0.00" inputmode="decimal" />
        </div>
      </div>
      <div>
        <label>Vendor <span style="font-weight:400;text-transform:none;">(optional)</span></label>
        <input class="exp-text-input exp-vendor-input" type="text" placeholder="e.g. Home Depot" />
      </div>
      <div>
        <label>Note <span style="font-weight:400;text-transform:none;">(optional)</span></label>
        <input class="exp-text-input exp-note-input" type="text" placeholder="Brief description" />
      </div>
      <button class="btn-expense-submit" data-bid="${esc(bid)}">Log Expense</button>
      ${expList ? `<div class="job-expense-list">${expList}</div>` : `<div class="job-expense-list"></div>`}
    </div>`;

  return `
    <div class="job-card" id="card-${esc(bid)}">
      <div class="job-card-top" data-job='${jobData}'>
        <div class="job-block">${block}${dur}</div>
        <div class="job-customer">${esc(j.customer_name || "Customer")}</div>
        <div class="job-address">${esc(j.address || "—")}</div>
        <div class="job-tap-hint">Tap to view details</div>
      </div>
      ${timerHtml}
      <div class="job-actions">
        ${clockBtn}
        <button class="btn-expense-toggle" id="exp-toggle-${esc(bid)}" data-bid="${esc(bid)}">+ Expense</button>
        ${reviewBtn}
      </div>
      ${timeChip}
      ${expPanel}
    </div>`;
}

async function sendReviewAsk(job, btn) {
  const origText = btn.textContent;
  btn.disabled = true;
  btn.textContent = "Sending…";
  try {
    const res  = await fetch("/api/crew/review-ask", {
      method:  "POST",
      headers: { "Content-Type": "application/json" },
      body:    JSON.stringify({
        phone:         job.phone,
        customer_name: job.customer_name,
        booking_id:    job.booking_id,
      }),
    });
    const data = await res.json();
    if (data.ok) {
      btn.textContent = "✓ Sent!";
      btn.style.background = "hsl(142 55% 35%)";
      setTimeout(() => {
        btn.textContent = origText;
        btn.style.background = "";
        btn.disabled = false;
      }, 3000);
    } else {
      showToast(data.error || "Send failed", true);
      btn.textContent = origText;
      btn.disabled = false;
    }
  } catch {
    showToast("Network error — try again", true);
    btn.textContent = origText;
    btn.disabled = false;
  }
}

// ── Job Detail Overlay ────────────────────────────────────────────────────────
let _detailJob = null;

function closeJobDetail() {
  _detailJob = null;
  closeOverlay("jobDetailOverlay");
  if (typeof _unlockBody === "function") _unlockBody();
}

async function sendCrewNotify(action, btn) {
  if (!_detailJob?.phone) return;
  const orig = btn.textContent;
  btn.disabled = true;
  btn.textContent = "Sending…";
  try {
    const res  = await fetch("/api/crew/notify", {
      method:  "POST",
      headers: { "Content-Type": "application/json" },
      body:    JSON.stringify({
        action,
        phone:         _detailJob.phone,
        customer_name: _detailJob.customer_name,
        booking_id:    _detailJob.booking_id,
      }),
    });
    const data = await res.json();
    if (data.ok) {
      btn.textContent = "✓ Sent!";
      btn.classList.add("sent");
      setTimeout(() => {
        btn.textContent = orig;
        btn.classList.remove("sent");
        btn.disabled = false;
      }, 4000);
    } else {
      showToast(data.error || "Send failed", true);
      btn.textContent = orig;
      btn.disabled = false;
    }
  } catch {
    showToast("Network error — try again", true);
    btn.textContent = orig;
    btn.disabled = false;
  }
}

function bindJobDetailOverlay() {
  document.getElementById("closeJobDetail")?.addEventListener("click", closeJobDetail);
  document.getElementById("jobDetailOverlay")?.addEventListener("click", e => {
    if (e.target === e.currentTarget) closeJobDetail();
  });
  document.getElementById("notifyOnTheWay")?.addEventListener("click", e =>
    sendCrewNotify("on_the_way", e.currentTarget));
  document.getElementById("notifyWeAreHere")?.addEventListener("click", e =>
    sendCrewNotify("we_are_here", e.currentTarget));
  document.getElementById("notifyRunningLate")?.addEventListener("click", e =>
    sendCrewNotify("running_late", e.currentTarget));
}

function classificationLabel(s) {
  const key = String(s || "").toLowerCase();
  if (!key || key === "production_ready" || key === "standard") return "";
  const map = {
    ready_with_review_flag: "Ready — flagged for review",
    manual_review_required: "Needs manual review — contact office",
    manual_quote_only:      "Manual quote only — contact office",
    blocked:                "DO NOT START — contact office first",
  };
  return map[key] || key.replace(/_/g, " ").replace(/\b\w/g, c => c.toUpperCase());
}

function openJobDetail(j) {
  document.getElementById("jdCustomer").textContent = j.customer_name || "Customer";
  const priceEl = document.getElementById("jdPrice");
  priceEl.textContent = j.final_price
    ? `$${Number(j.final_price).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
    : "";
  priceEl.style.display = j.final_price ? "block" : "none";

  const refEl = document.getElementById("jdRef");
  const refs = [];
  if (j.booking_id) refs.push(j.booking_id);
  if (j.quote_id)   refs.push(j.quote_id);
  refEl.textContent = refs.join("  ·  ");
  refEl.style.display = refs.length ? "block" : "none";

  const timeEl = document.getElementById("jdTime");
  if (j.scheduled_datetime) {
    const d    = new Date(j.scheduled_datetime);
    const time = d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
    const dur  = j.duration_minutes ? ` · ${j.duration_minutes} min` : "";
    const blk  = j.schedule_block   ? ` (${j.schedule_block})` : "";
    timeEl.textContent = `${time}${dur}${blk}`;
  } else {
    timeEl.textContent = j.schedule_block || "—";
  }

  const addr = j.address || "";
  document.getElementById("jdAddress").textContent = addr || "—";
  const navLink = document.getElementById("jdNavigate");
  if (addr) {
    navLink.href = "https://maps.google.com/maps?q=" + encodeURIComponent(addr);
    navLink.style.display = "inline-flex";
  } else {
    navLink.style.display = "none";
  }

  const scopeSection = document.getElementById("jdScopeSection");
  const scopeEl = document.getElementById("jdScope");
  scopeSection.style.display = "block";

  const items      = j.scope_items  || [];
  const addons     = j.scope_addons || [];
  const qty        = j.scope_qty;
  const clsLabel   = classificationLabel(j.scope_status || "");
  const hasDetails = items.length > 0 || addons.length > 0 || qty > 1 || j.scope_of_work;

  let html = "";
  if (hasDetails) {
    if (clsLabel) {
      const isBlocked = (j.scope_status || "").includes("blocked");
      html += `<div class="scope-status ${isBlocked ? "scope-status--alert" : ""}">${esc(clsLabel)}</div>`;
    }
    if (qty != null) html += `<div class="scope-qty">Qty: <strong>${qty}</strong></div>`;
    items.forEach(item => {
      html += `<div class="scope-row"><span class="scope-row-label">${esc(item.label)}</span><span class="scope-row-val">${esc(item.value)}</span></div>`;
    });
    addons.forEach(name => {
      html += `<div class="scope-row"><span class="scope-row-label">Add-on</span><span class="scope-row-val">${esc(name)}</span></div>`;
    });
    if (items.length === 0 && j.scope_of_work) {
      html += `<div class="scope-plain">${esc(j.scope_of_work)}</div>`;
    }
  } else {
    const notice = clsLabel ? `<div class="scope-status">${esc(clsLabel)}</div>` : "";
    html = notice + `<span class="scope-empty">No quote details on file — this job was booked manually. Check with the office for scope.</span>`;
  }
  scopeEl.innerHTML = html;

  const typeSection = document.getElementById("jdTypeSection");
  const typeEl      = document.getElementById("jdType");
  const typeName    = j.job_type_name || "";
  if (typeName) {
    typeEl.textContent = typeName;
    typeSection.style.display = "block";
  } else {
    typeSection.style.display = "none";
  }

  const notifySection = document.getElementById("jdNotifySection");
  if (notifySection) notifySection.style.display = j.phone ? "block" : "none";
  document.querySelectorAll(".btn-notify").forEach(b => {
    b.textContent = b.id === "notifyOnTheWay" ? "On the way"
      : b.id === "notifyWeAreHere" ? "We're here"
      : "Running late";
    b.classList.remove("sent");
    b.disabled = false;
  });

  _detailJob = j;
  document.getElementById("jobDetailOverlay").classList.add("open");
  if (typeof _lockBody === "function") _lockBody();
}

// ── Overlay controls ──────────────────────────────────────────────────────────
function bindOverlayControls() {
  // Manual time entry (Log Without a Job section only)
  document.getElementById("closeTime")?.addEventListener("click", () => closeOverlay("timeOverlay"));
  document.getElementById("timeOverlay")?.addEventListener("click", e => {
    if (e.target === e.currentTarget) closeOverlay("timeOverlay");
  });
  document.getElementById("hoursUp")?.addEventListener("click",   () => adjustHours(1));
  document.getElementById("hoursDown")?.addEventListener("click", () => adjustHours(-1));
  document.querySelectorAll("[data-add]").forEach(btn =>
    btn.addEventListener("click", () => adjustHours(parseFloat(btn.dataset.add)))
  );
  document.getElementById("timeCategory")?.addEventListener("click", e => {
    const chip = e.target.closest(".chip"); if (!chip) return;
    document.querySelectorAll("#timeCategory .chip").forEach(c => c.classList.remove("selected"));
    chip.classList.add("selected");
    timeCategory = chip.dataset.val;
  });
  document.getElementById("submitTime")?.addEventListener("click", submitTime);

  // Expense overlay
  document.getElementById("closeExpense")?.addEventListener("click", () => closeOverlay("expenseOverlay"));
  document.getElementById("expenseOverlay")?.addEventListener("click", e => {
    if (e.target === e.currentTarget) closeOverlay("expenseOverlay");
  });
  document.getElementById("expenseCategory")?.addEventListener("click", e => {
    const chip = e.target.closest(".chip"); if (!chip) return;
    document.querySelectorAll("#expenseCategory .chip").forEach(c => c.classList.remove("selected"));
    chip.classList.add("selected");
    expCategory = chip.dataset.val;
  });
  document.getElementById("keypad")?.addEventListener("click", e => {
    const key = e.target.closest(".key"); if (!key) return;
    handleKeypad(key.dataset.k);
  });
  document.getElementById("submitExpense")?.addEventListener("click", submitExpense);
}

function bindManualButtons() {
  document.getElementById("manualTime")?.addEventListener("click",    () => openTimeOverlay(null));
  document.getElementById("manualExpense")?.addEventListener("click", () => openExpenseOverlay(null));
}

// ── Hours ─────────────────────────────────────────────────────────────────────
function adjustHours(delta) {
  hoursValue = Math.max(0.25, Math.round((hoursValue + delta) * 4) / 4);
  renderHours();
}
function renderHours() {
  const el = document.getElementById("hoursDisplay");
  if (el) el.textContent = hoursValue % 1 === 0 ? String(hoursValue) : hoursValue.toFixed(2);
}

// ── Keypad ────────────────────────────────────────────────────────────────────
function handleKeypad(k) {
  if (k === "del") {
    amountRaw = amountRaw.slice(0, -1);
  } else if (k === ".") {
    if (!amountRaw.includes(".")) amountRaw += ".";
  } else {
    const dot = amountRaw.indexOf(".");
    if (dot >= 0 && amountRaw.length - dot > 2) return;
    amountRaw += k;
  }
  renderAmount();
}
function renderAmount() {
  const el = document.getElementById("amountVal");
  if (el) el.textContent = amountRaw || "0.00";
}
function getAmountValue() { return parseFloat(amountRaw) || 0; }

// ── Open overlays ─────────────────────────────────────────────────────────────
function openTimeOverlay(job) {
  activeJob = job; hoursValue = 2; timeCategory = "On-site";
  document.querySelectorAll("#timeCategory .chip").forEach((c, i) => c.classList.toggle("selected", i === 0));
  const el = document.getElementById("timeNotes"); if (el) el.value = "";
  const lbl = document.getElementById("timeJobLabel");
  if (lbl) lbl.textContent = job ? `${job.customer_name} — ${job.address}` : "No specific job";
  renderHours();
  document.getElementById("timeOverlay").classList.add("open");
}

function openExpenseOverlay(job) {
  activeJob = job; amountRaw = ""; expCategory = "Materials";
  document.querySelectorAll("#expenseCategory .chip").forEach((c, i) => c.classList.toggle("selected", i === 0));
  ["expenseVendor","expenseNotes"].forEach(id => { const el = document.getElementById(id); if (el) el.value = ""; });
  const lbl = document.getElementById("expenseJobLabel");
  if (lbl) lbl.textContent = job ? `${job.customer_name} — ${job.address}` : "No specific job";
  renderAmount();
  document.getElementById("expenseOverlay").classList.add("open");
}

function closeOverlay(id) { document.getElementById(id)?.classList.remove("open"); }

// ── Submissions ───────────────────────────────────────────────────────────────
async function submitTime() {
  const btn = document.getElementById("submitTime");
  if (btn) btn.disabled = true;
  const techId = currentSession ? `${currentSession.firstName} ${currentSession.lastName}` : "Crew";
  const body = {
    date:     new Date().toISOString().slice(0, 10),
    tech_id:  techId,
    lead_id:  activeJob ? (activeJob.quote_id || activeJob.booking_id || "") : "",
    minutes:  Math.round(hoursValue * 60),
    category: timeCategory,
    notes:    document.getElementById("timeNotes")?.value.trim() || "",
  };
  try {
    const res  = await fetch("/api/time", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    const data = await res.json();
    if (!data.ok) throw new Error(data.error || "Server error");
    closeOverlay("timeOverlay");
    showToast(`✓ ${hoursValue} hr${hoursValue !== 1 ? "s" : ""} logged`);
    if (body.lead_id) {
      todayTimeMap[body.lead_id] = (todayTimeMap[body.lead_id] || 0) + body.minutes;
      renderJobCards();
    }
  } catch (err) {
    showToast("Error: " + err.message, true);
  }
  if (btn) btn.disabled = false;
}

async function submitExpense() {
  const amount = getAmountValue();
  if (amount <= 0) { showToast("Enter an amount first", true); return; }
  const btn = document.getElementById("submitExpense");
  if (btn) btn.disabled = true;
  const techId = currentSession ? `${currentSession.firstName} ${currentSession.lastName}` : "Crew";
  const leadId = activeJob ? (activeJob.quote_id || activeJob.booking_id || "") : "";
  const body = {
    date:    new Date().toISOString().slice(0, 10),
    tech_id: techId,
    lead_id: leadId,
    type:    expCategory,
    vendor:  document.getElementById("expenseVendor")?.value.trim() || "",
    amount:  amount,
    notes:   document.getElementById("expenseNotes")?.value.trim() || "",
  };
  try {
    const res  = await fetch("/api/expenses", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    const data = await res.json();
    if (!data.ok) throw new Error(data.error || "Server error");
    closeOverlay("expenseOverlay");
    showToast(`✓ $${amount.toFixed(2)} ${expCategory} logged`);
    if (leadId) {
      if (!todayExpMap[leadId]) todayExpMap[leadId] = [];
      todayExpMap[leadId].push({ type: expCategory, amount });
      renderJobCards();
    }
  } catch (err) {
    showToast("Error: " + err.message, true);
  }
  if (btn) btn.disabled = false;
}

// ── View tabs (Jobs / Map) ─────────────────────────────────────────────────────
function bindViewTabs() {
  document.querySelectorAll(".view-tab").forEach(btn => {
    btn.addEventListener("click", () => {
      const tab = btn.dataset.tab;
      document.querySelectorAll(".view-tab").forEach(b => b.classList.toggle("active", b === btn));
      document.getElementById("listView").style.display = tab === "list" ? "" : "none";
      document.getElementById("mapView").style.display  = tab === "map"  ? "" : "none";
      if (tab === "map" && !_mapLoaded) {
        _mapLoaded = true;
        renderCrewMap();
      }
    });
  });
}

// ── Nav URL helper (platform-aware deep link) ─────────────────────────────────
function navHref(addr) {
  if (!addr) return "";
  const q = encodeURIComponent(addr);
  const iOS = /iPad|iPhone|iPod/.test(navigator.userAgent);
  return iOS ? `maps://maps.apple.com/?q=${q}` : `https://maps.google.com/maps?q=${q}`;
}

// ── Crew Map ──────────────────────────────────────────────────────────────────
function crewMapToken() {
  if (!_crewTokenP) {
    _crewTokenP = fetch("/api/config/mapbox").then(r => r.json()).then(d => {
      if (!d.ok) { _crewTokenP = null; throw new Error(d.error || "Map not configured"); }
      return d.token;
    }).catch(e => { _crewTokenP = null; throw e; });
  }
  return _crewTokenP;
}

function loadCrewMapboxSDK(token) {
  return new Promise((resolve, reject) => {
    if (window.mapboxgl) { mapboxgl.accessToken = token; return resolve(); }
    const link = document.createElement("link");
    link.rel = "stylesheet";
    link.href = "https://api.mapbox.com/mapbox-gl-js/v3.5.1/mapbox-gl.css";
    document.head.appendChild(link);
    const script = document.createElement("script");
    script.src = "https://api.mapbox.com/mapbox-gl-js/v3.5.1/mapbox-gl.js";
    script.onload  = () => { mapboxgl.accessToken = token; resolve(); };
    script.onerror = () => reject(new Error("Failed to load map library"));
    document.head.appendChild(script);
  });
}

async function renderCrewMap() {
  const mapEl  = document.getElementById("crewMapEl");
  const status = document.getElementById("crewMapStatus");
  if (!mapEl) return;

  const withCoords = _todayJobs.filter(j => j.lat && j.lng);

  if (!withCoords.length) {
    if (status) status.textContent = _todayJobs.length
      ? "No addresses geocoded yet — check back after the office saves coordinates."
      : "No jobs scheduled today.";
    return;
  }

  try {
    const token = await crewMapToken();
    await loadCrewMapboxSDK(token);

    if (_crewMap) { _crewMap.remove(); _crewMap = null; }
    _crewMarkers.forEach(m => m.remove()); _crewMarkers = [];

    const sorted = [...withCoords].sort((a, b) => {
      if (!a.scheduled_datetime) return 1;
      if (!b.scheduled_datetime) return -1;
      return new Date(a.scheduled_datetime) - new Date(b.scheduled_datetime);
    });

    _crewMap = new mapboxgl.Map({
      container: mapEl,
      style: "mapbox://styles/mapbox/dark-v11",
      center: [sorted[0].lng, sorted[0].lat],
      zoom: 11,
    });
    _crewMap.addControl(new mapboxgl.NavigationControl(), "bottom-right");

    _crewMap.on("load", () => {
      if (sorted.length > 1) {
        const coords = sorted.map(j => [j.lng, j.lat]);
        _crewMap.addSource("crew-route", {
          type: "geojson",
          data: { type: "Feature", geometry: { type: "LineString", coordinates: coords } },
        });
        _crewMap.addLayer({
          id: "crew-route-lyr", type: "line", source: "crew-route",
          layout: { "line-join": "round", "line-cap": "round" },
          paint: { "line-color": "#2d6ae0", "line-width": 2, "line-opacity": 0.65, "line-dasharray": [2, 2] },
        });
      }

      sorted.forEach((job, idx) => {
        const el = document.createElement("div");
        el.style.cssText = [
          "width:30px;height:30px;border-radius:50%;",
          "background:#2d6ae0;color:#fff;",
          "display:flex;align-items:center;justify-content:center;",
          "font-size:12px;font-weight:800;border:2px solid rgba(255,255,255,.7);",
          "cursor:pointer;box-shadow:0 2px 8px rgba(0,0,0,.5);",
        ].join("");
        el.textContent = String(idx + 1);

        const addr = job.address || "";
        const nav  = navHref(addr);

        const popup = new mapboxgl.Popup({ offset: 18, maxWidth: "260px", closeButton: true })
          .setHTML(`<div>
            <div class="cpop-name">${esc(job.customer_name || "—")}</div>
            <div class="cpop-addr">${esc(addr || "No address")}</div>
            <div class="cpop-btns">
              ${nav ? `<a class="cpop-btn cpop-nav" href="${nav}" target="_blank" rel="noopener">Navigate &#10132;</a>` : ""}
              ${job.phone ? `<button class="cpop-btn cpop-way"  data-bid="${esc(job.booking_id)}" data-action="on_the_way">On the way</button>`    : ""}
              ${job.phone ? `<button class="cpop-btn cpop-here" data-bid="${esc(job.booking_id)}" data-action="we_are_here">We're here</button>`    : ""}
              ${job.phone ? `<button class="cpop-btn cpop-late" data-bid="${esc(job.booking_id)}" data-action="running_late">Running late</button>` : ""}
            </div>
          </div>`);

        popup.on("open", () => {
          const pEl = popup.getElement();
          if (!pEl) return;
          pEl.querySelectorAll("[data-action]").forEach(btn => {
            btn.addEventListener("click", () => {
              const j = _todayJobs.find(x => x.booking_id === btn.dataset.bid);
              if (j) crewMapNotify(btn.dataset.action, j, btn);
            });
          });
        });

        const marker = new mapboxgl.Marker({ element: el })
          .setLngLat([job.lng, job.lat])
          .setPopup(popup)
          .addTo(_crewMap);

        el.addEventListener("click", () => marker.togglePopup());
        _crewMarkers.push(marker);
      });

      if (sorted.length > 1) {
        const bounds = new mapboxgl.LngLatBounds();
        sorted.forEach(j => bounds.extend([j.lng, j.lat]));
        _crewMap.fitBounds(bounds, { padding: 50, maxZoom: 13 });
      }

      if (status) status.textContent = `${sorted.length} job${sorted.length !== 1 ? "s" : ""} on map · Tap a pin to navigate or notify`;
    });
  } catch (err) {
    if (status) status.textContent = "Map unavailable: " + err.message;
  }
}

async function crewMapNotify(action, job, btn) {
  const orig = btn.textContent;
  btn.disabled = true; btn.textContent = "Sending…";
  try {
    const res  = await fetch("/api/crew/notify", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action, phone: job.phone, customer_name: job.customer_name, booking_id: job.booking_id }),
    });
    const data = await res.json();
    if (data.ok) {
      btn.textContent = "✓ Sent!";
      btn.style.background = "#15803d";
      setTimeout(() => { btn.textContent = orig; btn.style.background = ""; btn.disabled = false; }, 3000);
    } else {
      showToast(data.error || "Send failed", true);
      btn.textContent = orig; btn.disabled = false;
    }
  } catch {
    showToast("Network error", true);
    btn.textContent = orig; btn.disabled = false;
  }
}

// ── Toast ─────────────────────────────────────────────────────────────────────
function showToast(msg, isError = false) {
  const t = document.getElementById("toast"); if (!t) return;
  t.textContent = msg;
  t.className   = "toast" + (isError ? " error" : "");
  t.classList.add("show");
  setTimeout(() => t.classList.remove("show"), 3000);
}

function esc(s) {
  return String(s || "").replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;").replace(/'/g,"&#39;");
}

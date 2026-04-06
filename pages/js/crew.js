// Crew Portal JS — uses real crew session from /api/crew/me

let currentSession = null; // { staffId, firstName, lastName, phone, permissions }
let activeJob      = null;
let hoursValue     = 2;
let amountRaw      = "";
let timeCategory   = "On-site";
let expCategory    = "Materials";

// ── Boot ─────────────────────────────────────────────────────────────────────
document.addEventListener("DOMContentLoaded", async () => {
  // Verify session (server already blocks unauthenticated page loads,
  // but this double-checks and populates the greeting)
  try {
    const res  = await fetch("/api/crew/me");
    const data = await res.json();
    if (!data.ok) { window.location.replace("/login"); return; }
    currentSession = data.staff;
  } catch {
    window.location.replace("/login");
    return;
  }

  setupHeader();
  loadTodayJobs();
  bindOverlayControls();
  bindJobDetailOverlay();
  bindManualButtons();
  bindLogout();
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
    if (!jobs.length) {
      list.innerHTML = "";
      if (noJobs) noJobs.hidden = false;
      return;
    }
    if (noJobs) noJobs.hidden = true;
    list.innerHTML = jobs.map(jobCard).join("");
    list.querySelectorAll(".btn-time").forEach(btn =>
      btn.addEventListener("click", () => openTimeOverlay(JSON.parse(btn.dataset.job)))
    );
    list.querySelectorAll(".btn-expense").forEach(btn =>
      btn.addEventListener("click", () => openExpenseOverlay(JSON.parse(btn.dataset.job)))
    );
    list.querySelectorAll(".btn-review-ask").forEach(btn =>
      btn.addEventListener("click", () => sendReviewAsk(JSON.parse(btn.dataset.job), btn))
    );
    list.querySelectorAll(".job-card-top").forEach(el =>
      el.addEventListener("click", () => openJobDetail(JSON.parse(el.dataset.job)))
    );
  } catch {
    list.innerHTML = `<div style="color:hsl(0 60% 55%);padding:16px;">Could not load today's jobs.</div>`;
  }
}

function jobCard(j) {
  const block   = j.schedule_block ? `${j.schedule_block} · ` : "";
  const dur     = j.duration_minutes ? `${j.duration_minutes} min` : "";
  const jobData = esc(JSON.stringify(j));
  const reviewBtn = j.phone
    ? `<button class="btn-review-ask" data-job='${jobData}'>Review Ask</button>`
    : "";
  return `
    <div class="job-card">
      <div class="job-card-top" data-job='${jobData}'>
        <div class="job-block">${block}${dur}</div>
        <div class="job-customer">${esc(j.customer_name || "Customer")}</div>
        <div class="job-address">${esc(j.address || "—")}</div>
        <div class="job-tap-hint">Tap to view details</div>
      </div>
      <div class="job-actions">
        <button class="btn-time"    data-job='${jobData}'>Log Time</button>
        <button class="btn-expense" data-job='${jobData}'>Expense</button>
        ${reviewBtn}
      </div>
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
function bindJobDetailOverlay() {
  document.getElementById("closeJobDetail")?.addEventListener("click", () =>
    closeOverlay("jobDetailOverlay")
  );
  document.getElementById("jobDetailOverlay")?.addEventListener("click", e => {
    if (e.target === e.currentTarget) closeOverlay("jobDetailOverlay");
  });
}

function classificationLabel(s) {
  if (!s || s === "standard") return "";
  const map = {
    manual_review_required: "Needs office review before starting",
    ready_with_review_flag: "Ready — double-check with office before starting",
    blocked:                "DO NOT START — office must clear this first",
  };
  return map[s] || s.replace(/_/g, " ").replace(/\b\w/g, c => c.toUpperCase());
}

function openJobDetail(j) {
  // Customer + price
  document.getElementById("jdCustomer").textContent = j.customer_name || "Customer";
  const priceEl = document.getElementById("jdPrice");
  priceEl.textContent = j.final_price
    ? `$${Number(j.final_price).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
    : "";
  priceEl.style.display = j.final_price ? "block" : "none";

  // Reference IDs — always show so crew has a paper trail
  const refEl = document.getElementById("jdRef");
  const refs = [];
  if (j.booking_id) refs.push(j.booking_id);
  if (j.quote_id)   refs.push(j.quote_id);
  refEl.textContent = refs.join("  ·  ");
  refEl.style.display = refs.length ? "block" : "none";

  // Scheduled time
  const timeEl = document.getElementById("jdTime");
  if (j.scheduled_datetime) {
    const d = new Date(j.scheduled_datetime);
    const time = d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
    const dur  = j.duration_minutes ? ` · ${j.duration_minutes} min` : "";
    const blk  = j.schedule_block   ? ` (${j.schedule_block})` : "";
    timeEl.textContent = `${time}${dur}${blk}`;
  } else {
    timeEl.textContent = j.schedule_block || "—";
  }

  // Address + navigate link
  const addr = j.address || "";
  document.getElementById("jdAddress").textContent = addr || "—";
  const navLink = document.getElementById("jdNavigate");
  if (addr) {
    navLink.href = "https://maps.google.com/maps?q=" + encodeURIComponent(addr);
    navLink.style.display = "inline-flex";
  } else {
    navLink.style.display = "none";
  }

  // Scope / notes — always show
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
    // Status notice — only show alongside real detail rows, not alone
    if (clsLabel) {
      const isBlocked = (j.scope_status || "").includes("blocked");
      html += `<div class="scope-status ${isBlocked ? "scope-status--alert" : ""}">${esc(clsLabel)}</div>`;
    }

    // Quantity — show prominently when > 1
    if (qty && qty > 1) {
      html += `<div class="scope-qty">Qty: <strong>${qty}</strong></div>`;
    }

    // Q&A rows from quote answers
    items.forEach(item => {
      html += `<div class="scope-row"><span class="scope-row-label">${esc(item.label)}</span><span class="scope-row-val">${esc(item.value)}</span></div>`;
    });

    // Add-ons
    addons.forEach(name => {
      html += `<div class="scope-row"><span class="scope-row-label">Add-on</span><span class="scope-row-val">${esc(name)}</span></div>`;
    });

    // Plain-text notes (manually-created bookings with no quote answers)
    if (items.length === 0 && j.scope_of_work) {
      html += `<div class="scope-plain">${esc(j.scope_of_work)}</div>`;
    }
  } else {
    // No detail data at all
    const notice = clsLabel ? `<div class="scope-status">${esc(clsLabel)}</div>` : "";
    html = notice + `<span class="scope-empty">No quote details on file — this job was booked manually. Check with the office for scope.</span>`;
  }

  scopeEl.innerHTML = html;

  // Job type — show if available, hide only when truly nothing
  const typeSection = document.getElementById("jdTypeSection");
  const typeEl = document.getElementById("jdType");
  const typeName = j.job_type_name || "";
  if (typeName) {
    typeEl.textContent = typeName;
    typeSection.style.display = "block";
  } else {
    typeSection.style.display = "none";
  }

  document.getElementById("jobDetailOverlay").classList.add("open");
}

// ── Overlay controls ──────────────────────────────────────────────────────────
function bindOverlayControls() {
  // Time
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

  // Expense
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
  const body = {
    date:    new Date().toISOString().slice(0, 10),
    tech_id: techId,
    lead_id: activeJob ? (activeJob.quote_id || activeJob.booking_id || "") : "",
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
  } catch (err) {
    showToast("Error: " + err.message, true);
  }
  if (btn) btn.disabled = false;
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

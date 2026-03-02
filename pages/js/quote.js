// pages/js/quote.js — V3 Quote Flow with Scheduling

// ── State ─────────────────────────────────────────────────────────────────────
const S = {
  step: "service",
  config: null,
  quoteId: null,
  typeId: null,
  answers: {},
  addons: [],
  pricing: null,
  lock: null,
  photoUploaded: false,
  slotsData: null,    // { slots, timezone, duration_minutes, quote }
  selectedSlot: null, // ISO string
  booking: null,      // result from /api/schedule/book
};

let repricTimer = null;

// ── Boot ──────────────────────────────────────────────────────────────────────
async function boot() {
  setContent(loadingHTML("Loading services\u2026"));
  try {
    const r = await fetch("/api/quote/config");
    S.config = await r.json();
    go("service");
  } catch {
    setContent(errHTML("Could not load services. Please refresh the page."));
  }
}

// ── Navigation ────────────────────────────────────────────────────────────────
function go(step) {
  S.step = step;
  window.scrollTo({ top: 0, behavior: "smooth" });
  renderStep();
}

function back() {
  const prev = { questions: "service", price: "questions", lead: "price" };
  if (prev[S.step]) {
    if (S.step === "price") {
      const hasQs    = (S.config?.questionsByType?.[S.typeId]?.length || 0) > 0;
      const hasAddons = (S.config?.addonsByType?.[S.typeId]?.length || 0) > 0;
      go(hasQs || hasAddons ? "questions" : "service");
    } else {
      go(prev[S.step]);
    }
  }
}

// ── Rendering ─────────────────────────────────────────────────────────────────
function renderStep() {
  document.getElementById("qProgress").innerHTML = progressHTML();
  switch (S.step) {
    case "service":   setContent(renderService());   break;
    case "questions": setContent(renderQuestions()); break;
    case "price":     setContent(renderPrice());     break;
    case "lead":      setContent(renderLead());      break;
    case "confirmed": setContent(renderConfirmed()); break;
    case "schedule":  setContent(renderSchedule());  break;
    case "booked":    setContent(renderBooked());    break;
    default:          setContent(errHTML("Unknown step.")); break;
  }
  bindEvents();
}

function progressHTML() {
  const steps = ["Service", "Questions", "Price", "Your Info", "Schedule"];
  const idx   = { service: 0, questions: 1, price: 2, lead: 3, confirmed: 3, schedule: 4, booked: 4 };
  const cur   = idx[S.step] ?? 0;
  return `<div class="q-progress">${steps.map((label, i) =>
    `<div class="q-prog-step ${i < cur ? "done" : ""} ${i === cur ? "active" : ""}">
       <div class="q-prog-dot">${i < cur ? "\u2713" : i + 1}</div>
       <div class="q-prog-label">${label}</div>
     </div>${i < steps.length - 1
       ? `<div class="q-prog-line${i < cur ? " done" : ""}"></div>`
       : ""}`
  ).join("")}</div>`;
}

// ── Step A: Service ───────────────────────────────────────────────────────────
function renderService() {
  const types = (S.config?.jobTypes || []).filter(j => j.active !== false);
  if (!types.length) return `
    <div class="q-card q-center">
      <div class="q-icon">\u{1F527}</div>
      <h2 class="q-heading">Services Coming Soon</h2>
      <p class="q-muted">Our service menu is being set up. Check back shortly or call us at
        <a href="tel:+14095550100" style="color:hsl(var(--accent));">(409) 555-0100</a>.</p>
    </div>`;

  return `
    <h2 class="q-heading">What can we help you with?</h2>
    <div class="q-tiles">
      ${types.map(t => `
        <button class="q-tile${S.typeId === t.job_type_id ? " selected" : ""}"
                data-type="${t.job_type_id}">
          <div class="q-tile-name">${escHtml(t.name_public)}</div>
          ${t.min_price ? `<div class="q-tile-sub">From $${Number(t.min_price).toLocaleString()}</div>` : ""}
        </button>`).join("")}
    </div>
    <button class="q-btn-primary" id="nextService" style="margin-top:24px;" ${S.typeId ? "" : "disabled"}>
      Continue &rarr;
    </button>`;
}

// ── Step B: Questions + Add-ons ───────────────────────────────────────────────
function renderQuestions() {
  const questions = S.config?.questionsByType?.[S.typeId] || [];
  const addons    = S.config?.addonsByType?.[S.typeId]   || [];

  return `
    <button class="q-back" id="backBtn">\u2190 Back</button>
    <h2 class="q-heading">Tell us about the job</h2>
    ${!questions.length && !addons.length ? `
      <p class="q-muted" style="margin-bottom:24px;">No additional details needed. Click below to see your price.</p>
    ` : ""}
    <div class="q-questions">
      ${questions.map(q => renderQuestion(q)).join("")}
    </div>
    ${addons.length ? `
      <div class="q-section-label">Optional Add-ons</div>
      <div class="q-addons">
        ${addons.map(a => `
          <label class="q-addon${S.addons.includes(a.addon_id) ? " selected" : ""}">
            <input type="checkbox" class="q-addon-check" value="${escHtml(a.addon_id)}"
              ${S.addons.includes(a.addon_id) ? "checked" : ""}>
            <div class="q-addon-body">
              <div class="q-addon-name">${escHtml(a.name_public)}</div>
              ${a.add_fee ? `<div class="q-addon-fee">+$${Number(a.add_fee).toLocaleString()}</div>` : ""}
              ${a.description ? `<div class="q-addon-desc">${escHtml(a.description)}</div>` : ""}
            </div>
          </label>`).join("")}
      </div>
    ` : ""}
    <button class="q-btn-primary" id="seePriceBtn" style="margin-top:24px;">
      See My Price &rarr;
    </button>`;
}

function renderQuestion(q) {
  const options = S.config?.optionsByQuestion?.[q.question_id] || [];
  return `
    <div class="q-question" data-qid="${q.question_id}">
      <div class="q-question-prompt">${escHtml(q.prompt)}${q.required ? " <span class='q-req'>*</span>" : ""}</div>
      ${options.length ? `
        <div class="q-options">
          ${options.map(o => `
            <label class="q-option${S.answers[q.question_id] === o.option_id ? " selected" : ""}">
              <input type="radio" name="q_${q.question_id}" value="${escHtml(o.option_id)}"
                ${S.answers[q.question_id] === o.option_id ? "checked" : ""}>
              ${escHtml(o.label)}
            </label>`).join("")}
        </div>
      ` : `
        <input type="text" class="q-text-input" name="q_${q.question_id}"
          value="${escHtml(S.answers[q.question_id] || "")}" placeholder="Your answer">
      `}
    </div>`;
}

// ── Step C: Price ─────────────────────────────────────────────────────────────
function renderPrice() {
  if (!S.pricing) return loadingHTML("Calculating your price\u2026");
  const p    = S.pricing;
  const bnpl = p.final_price && p.final_price >= 200 ? Math.ceil(p.final_price / 12) : null;

  return `
    <button class="q-back" id="backBtn">\u2190 Back</button>
    <div class="q-price-reveal">
      <div class="q-price-label">Your Instant Price</div>
      <div class="q-price-big">$${p.final_price != null ? Number(p.final_price).toLocaleString() : "\u2014"}</div>
      <p class="q-price-sub">Exact price based on your answers.</p>
      <div class="q-disclaimer travel-note">
        \u{1F4CD} A $25 travel fee may be applied once your address is confirmed.
      </div>
      ${p.evaluation_flag ? `
        <div class="q-disclaimer warn">
          \u26A0\uFE0F This job may need an in-person evaluation first. We'll confirm when you lock your price.
        </div>` : ""}
      ${bnpl ? `
        <div class="q-bnpl">
          As low as <strong>$${bnpl}/mo</strong> with flexible payment options.
        </div>` : ""}
    </div>
    <button class="q-btn-primary" id="lockPriceBtn" style="margin-top:28px;">
      Lock My Price &amp; Schedule &rarr;
    </button>`;
}

// ── Step D: Lead Form ─────────────────────────────────────────────────────────
function renderLead() {
  const p = S.pricing;
  return `
    <button class="q-back" id="backBtn">\u2190 Back</button>
    <h2 class="q-heading">Almost done!</h2>
    <p class="q-muted" style="margin-bottom:20px;">
      Your price: <strong>$${p?.final_price != null ? Number(p.final_price).toLocaleString() : "\u2014"}</strong>
      <span style="font-size:12px;"> &mdash; travel fee confirmed with address</span>
    </p>
    <div class="q-form">
      <div class="q-field">
        <label class="q-label">Your Name <span class="q-req">*</span></label>
        <input type="text" id="ld_name" class="q-input" placeholder="Jane Smith" autocomplete="name">
      </div>
      <div class="q-field">
        <label class="q-label">Phone <span class="q-req">*</span></label>
        <input type="tel" id="ld_phone" class="q-input" placeholder="(409) 555-0100" autocomplete="tel">
      </div>
      <div class="q-field">
        <label class="q-label">Email</label>
        <input type="email" id="ld_email" class="q-input" placeholder="you@example.com" autocomplete="email">
      </div>
      <div class="q-field">
        <label class="q-label">Service Address <span class="q-req">*</span></label>
        <input type="text" id="ld_address" class="q-input"
          placeholder="123 Main St, Beaumont TX 77701" autocomplete="street-address">
      </div>
      <div class="q-field">
        <label class="q-label">ZIP Code <span class="q-req">*</span></label>
        <input type="text" id="ld_zip" class="q-input" placeholder="77701"
          maxlength="5" inputmode="numeric" pattern="[0-9]{5}">
        <div class="q-zip-note" id="zipNote" style="display:none;"></div>
        <div class="q-price-update" id="priceUpdate" style="display:none;"></div>
      </div>
      <div class="q-err" id="leadErr" style="display:none;"></div>
      <button class="q-btn-primary" id="submitLockBtn">
        Confirm My Price &rarr;
      </button>
    </div>`;
}

// ── Step E: Confirmed (price locked, optional photo, then choose time) ─────────
function renderConfirmed() {
  const p         = S.lock || S.pricing;
  const needsPhoto = p?.photo_required && !S.photoUploaded;
  const canSchedule = !needsPhoto;

  return `
    <div class="q-confirmed">
      <div class="q-confirmed-icon">\u2705</div>
      <h2 class="q-heading">Price Locked!</h2>
      <div class="q-locked-price">$${p?.final_price != null ? Number(p.final_price).toLocaleString() : "\u2014"}</div>
      ${p?.travel_fee ? `<p class="q-muted" style="margin-top:6px;">Includes $${p.travel_fee} travel fee.</p>` : ""}
    </div>

    ${needsPhoto ? `
      <div class="q-photo-gate" id="photoSection">
        <div class="q-photo-header">\u{1F4F7} One Quick Step</div>
        <p class="q-muted" style="margin-bottom:16px;">
          Upload a photo of your electrical panel to confirm compatibility before we schedule.
        </p>
        <label class="q-file-label">
          Choose Photo
          <input type="file" id="photoFile" accept="image/*" style="display:none;">
        </label>
        <div id="photoPreview" class="q-photo-preview" style="display:none;"></div>
        <button class="q-btn-secondary" id="uploadPhotoBtn" style="display:none;margin-top:12px;">
          Upload Photo
        </button>
        <div id="photoStatus" class="q-photo-status"></div>
        <div id="afterPhotoSchedule" style="display:none;margin-top:16px;">
          <button class="q-btn-primary" id="scheduleBtn">
            \u{1F4C5} Choose a Time &rarr;
          </button>
        </div>
      </div>
    ` : `
      <div class="q-next-step" style="margin-top:20px;">
        <div class="q-next-icon">\u{1F4C5}</div>
        <strong>You're one step away!</strong>
        <p class="q-muted" style="margin-top:8px;">Choose a time that works for you.</p>
        <button class="q-btn-primary" id="scheduleBtn" style="margin-top:16px;">
          Choose a Time &rarr;
        </button>
      </div>
    `}`;
}

// ── Step F: Schedule (slot picker) ────────────────────────────────────────────
function renderSchedule() {
  if (!S.slotsData) return loadingHTML("Finding available times\u2026");

  const { slots, timezone, quote } = S.slotsData;

  if (!slots || !slots.length) {
    return `
      <h2 class="q-heading">Available Times</h2>
      <div class="q-error-box" style="margin-top:12px;">
        No available slots right now. We'll call you within one business day to schedule.
      </div>
      <p class="q-muted" style="margin-top:16px;text-align:center;">
        Quote ID: <strong>${escHtml(S.quoteId)}</strong>
      </p>`;
  }

  // Group by local date
  const groups = {};
  for (const iso of slots) {
    const dk = formatSlotDate(iso, timezone);
    if (!groups[dk]) groups[dk] = [];
    groups[dk].push(iso);
  }

  return `
    <h2 class="q-heading">Choose a Time</h2>
    <p class="q-muted" style="margin-bottom:20px;">
      Price locked at <strong>$${Number(quote?.final_price || 0).toLocaleString()}</strong>.
      Select a time and we'll see you there.
    </p>
    <div class="q-slot-groups">
      ${Object.entries(groups).map(([date, daySlots]) => `
        <div class="q-slot-group">
          <div class="q-slot-date">${escHtml(date)}</div>
          <div class="q-slot-row">
            ${daySlots.map(iso => `
              <button class="q-slot${S.selectedSlot === iso ? " selected" : ""}"
                      data-iso="${escHtml(iso)}">
                ${escHtml(formatSlotTime(iso, timezone))}
              </button>`).join("")}
          </div>
        </div>`).join("")}
    </div>
    <div id="slotErr" class="q-err" style="display:none;margin-top:12px;"></div>
    <button class="q-btn-primary" id="bookBtn" style="margin-top:24px;"
            ${S.selectedSlot ? "" : "disabled"}>
      Book This Time &rarr;
    </button>`;
}

// ── Step G: Booked confirmation ────────────────────────────────────────────────
function renderBooked() {
  const bk = S.booking;
  const tz  = S.slotsData?.timezone || "America/Chicago";
  const dt  = bk?.scheduled_datetime ? new Date(bk.scheduled_datetime) : null;

  const dateStr = dt
    ? new Intl.DateTimeFormat("en-US", { timeZone: tz, weekday: "long", month: "long", day: "numeric", year: "numeric" }).format(dt)
    : "";
  const timeStr = dt
    ? new Intl.DateTimeFormat("en-US", { timeZone: tz, hour: "numeric", minute: "2-digit", hour12: true }).format(dt)
    : "";

  return `
    <div class="q-booked">
      <div class="q-booked-icon">\u{1F389}</div>
      <h2 class="q-heading">You're Booked!</h2>
      <p class="q-muted" style="margin-bottom:24px;">Here's your confirmation. We'll see you soon.</p>

      <div class="q-booking-card">
        <div class="q-booking-row">
          <span class="q-booking-key">\u{1F4C5} Date</span>
          <span class="q-booking-val">${escHtml(dateStr)}</span>
        </div>
        <div class="q-booking-row">
          <span class="q-booking-key">\u{1F55B} Time</span>
          <span class="q-booking-val">${escHtml(timeStr)} (Central)</span>
        </div>
        <div class="q-booking-row">
          <span class="q-booking-key">\u{1F4CD} Address</span>
          <span class="q-booking-val">${escHtml(bk?.address || "")}</span>
        </div>
        <div class="q-booking-row">
          <span class="q-booking-key">\u{1F4B5} Price</span>
          <span class="q-booking-val">$${Number(bk?.final_price || 0).toLocaleString()} locked</span>
        </div>
        <div class="q-booking-row">
          <span class="q-booking-key">\u{1F9FE} Booking ID</span>
          <span class="q-booking-val" style="font-family:monospace;font-size:13px;">${escHtml(bk?.booking_id || "")}</span>
        </div>
      </div>

      <p class="q-muted" style="margin-top:24px;font-size:13px;">
        Questions? Call us at <a href="tel:+14095550100" style="color:hsl(var(--accent));">(409) 555-0100</a>
      </p>
    </div>`;
}

// ── Event Binding ─────────────────────────────────────────────────────────────
function bindEvents() {
  document.getElementById("backBtn")?.addEventListener("click", back);

  // Service tiles
  document.querySelectorAll(".q-tile").forEach(btn => {
    btn.addEventListener("click", () => {
      S.typeId = btn.dataset.type;
      document.querySelectorAll(".q-tile").forEach(b => b.classList.remove("selected"));
      btn.classList.add("selected");
      document.getElementById("nextService")?.removeAttribute("disabled");
    });
  });

  document.getElementById("nextService")?.addEventListener("click", () => {
    if (!S.typeId) return;
    const hasQs    = (S.config?.questionsByType?.[S.typeId]?.length || 0) > 0;
    const hasAddons = (S.config?.addonsByType?.[S.typeId]?.length || 0) > 0;
    if (hasQs || hasAddons) go("questions");
    else calcPrice();
  });

  // Radio answers
  document.querySelectorAll("input[type=radio]").forEach(radio => {
    radio.addEventListener("change", () => {
      const qid = radio.name.replace("q_", "");
      S.answers[qid] = radio.value;
      radio.closest(".q-options")?.querySelectorAll(".q-option")
        .forEach(l => l.classList.toggle("selected", l.querySelector("input") === radio));
    });
  });

  // Addon checkboxes
  document.querySelectorAll(".q-addon-check").forEach(cb => {
    cb.addEventListener("change", () => {
      if (cb.checked) { if (!S.addons.includes(cb.value)) S.addons.push(cb.value); }
      else { S.addons = S.addons.filter(id => id !== cb.value); }
      cb.closest(".q-addon")?.classList.toggle("selected", cb.checked);
    });
  });

  // Text inputs
  document.querySelectorAll(".q-text-input").forEach(inp => {
    inp.addEventListener("change", () => {
      S.answers[inp.name.replace("q_", "")] = inp.value;
    });
  });

  document.getElementById("seePriceBtn")?.addEventListener("click", calcPrice);
  document.getElementById("lockPriceBtn")?.addEventListener("click", () => go("lead"));

  // ZIP reprice
  document.getElementById("ld_zip")?.addEventListener("input", e => {
    const zip = e.target.value.replace(/\D/g, "").slice(0, 5);
    e.target.value = zip;
    clearTimeout(repricTimer);
    if (zip.length === 5) repricTimer = setTimeout(() => reprice(zip), 800);
  });

  document.getElementById("submitLockBtn")?.addEventListener("click", submitLock);

  // Photo upload
  document.getElementById("photoFile")?.addEventListener("change", onPhotoSelected);
  document.getElementById("uploadPhotoBtn")?.addEventListener("click", uploadPhoto);

  // Choose a time button (confirmed step)
  document.getElementById("scheduleBtn")?.addEventListener("click", () => {
    loadSlots();
  });

  // Slot picker
  document.querySelectorAll(".q-slot").forEach(btn => {
    btn.addEventListener("click", () => {
      S.selectedSlot = btn.dataset.iso;
      document.querySelectorAll(".q-slot").forEach(b => b.classList.remove("selected"));
      btn.classList.add("selected");
      document.getElementById("bookBtn")?.removeAttribute("disabled");
    });
  });

  document.getElementById("bookBtn")?.addEventListener("click", submitBooking);
}

// ── API Calls ──────────────────────────────────────────────────────────────────
async function calcPrice() {
  go("price");
  setContent(loadingHTML("Calculating your price\u2026"));

  try {
    if (!S.quoteId) {
      const sr = await fetch("/api/quote/start", {
        method: "POST", headers: { "Content-Type": "application/json" }, body: "{}",
      });
      const sd = await sr.json();
      if (!sd.quote_id) throw new Error("Could not start quote session.");
      S.quoteId = sd.quote_id;
    }

    const cr = await fetch("/api/quote/calc", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ quote_id: S.quoteId, job_type_id: S.typeId, answers: S.answers, addons: S.addons }),
    });
    S.pricing = await cr.json();
    if (!S.pricing.ok && S.pricing.error) throw new Error(S.pricing.error);
    go("price");
  } catch (e) {
    S.step = "price";
    setContent(errHTML("Could not calculate price: " + e.message));
  }
}

async function reprice(zip) {
  const noteEl   = document.getElementById("zipNote");
  const updateEl = document.getElementById("priceUpdate");
  if (!noteEl || !updateEl) return;

  noteEl.style.display   = "block";
  noteEl.textContent     = "Checking travel fee for your area\u2026";
  updateEl.style.display = "none";

  try {
    const r = await fetch("/api/quote/lock", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ quote_id: S.quoteId, job_type_id: S.typeId, answers: S.answers, addons: S.addons, zip }),
    });
    const data = await r.json();
    if (data.final_price != null) {
      noteEl.style.display   = "none";
      updateEl.style.display = "block";
      const delta = data.travel_fee > 0
        ? ` (includes $${data.travel_fee} travel fee)`
        : " (no travel fee for this area)";
      updateEl.innerHTML = `Updated price: <strong>$${Number(data.final_price).toLocaleString()}</strong>${escHtml(delta)}`;
      S.lock = data;
    }
  } catch {
    noteEl.textContent = "Could not look up travel fee for this ZIP.";
  }
}

async function submitLock() {
  const name    = val("ld_name"), phone = val("ld_phone"),
        email   = val("ld_email"), address = val("ld_address"), zip = val("ld_zip");

  const errEl = document.getElementById("leadErr");
  const hide  = () => { if (errEl) errEl.style.display = "none"; };
  const show  = msg => { if (errEl) { errEl.textContent = msg; errEl.style.display = "block"; } };
  hide();

  if (!name)                    return show("Name is required.");
  if (!phone)                   return show("Phone is required.");
  if (!address)                 return show("Address is required.");
  if (!/^\d{5}$/.test(zip))     return show("Please enter a valid 5-digit ZIP code.");

  const btn = document.getElementById("submitLockBtn");
  if (btn) { btn.disabled = true; btn.textContent = "Locking\u2026"; }

  try {
    const r = await fetch("/api/quote/lock", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ quote_id: S.quoteId, job_type_id: S.typeId, answers: S.answers, addons: S.addons,
        customer_name: name, phone, email, address, zip }),
    });
    S.lock = await r.json();
    if (!S.lock.ok && S.lock.error) throw new Error(S.lock.error);
    go("confirmed");
  } catch (e) {
    show("Could not lock price: " + e.message);
    if (btn) { btn.disabled = false; btn.textContent = "Confirm My Price \u2192"; }
  }
}

async function loadSlots() {
  go("schedule");
  setContent(loadingHTML("Finding available times\u2026"));

  try {
    const r = await fetch(`/api/schedule/slots?quote_id=${encodeURIComponent(S.quoteId)}`);
    S.slotsData = await r.json();
    if (!S.slotsData.ok && S.slotsData.error) throw new Error(S.slotsData.error);
    S.selectedSlot = null;
    go("schedule");
  } catch (e) {
    S.step = "schedule";
    setContent(errHTML("Could not load available times: " + e.message));
  }
}

async function submitBooking() {
  if (!S.selectedSlot) return;

  const errEl = document.getElementById("slotErr");
  const btn   = document.getElementById("bookBtn");

  if (errEl) errEl.style.display = "none";
  if (btn)   { btn.disabled = true; btn.textContent = "Booking\u2026"; }

  try {
    const r = await fetch("/api/schedule/book", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ quote_id: S.quoteId, scheduled_datetime: S.selectedSlot }),
    });
    S.booking = await r.json();
    if (!S.booking.ok && S.booking.error) throw new Error(S.booking.error);
    go("booked");
  } catch (e) {
    if (errEl) { errEl.textContent = e.message; errEl.style.display = "block"; }
    if (btn)   { btn.disabled = false; btn.textContent = "Book This Time \u2192"; }
  }
}

// ── Photo Upload ──────────────────────────────────────────────────────────────
function onPhotoSelected(e) {
  const file = e.target.files?.[0];
  if (!file) return;
  const preview = document.getElementById("photoPreview");
  const btn     = document.getElementById("uploadPhotoBtn");
  if (preview) {
    preview.style.display = "block";
    const reader = new FileReader();
    reader.onload = ev => {
      preview.innerHTML = `<img src="${ev.target.result}" alt="Panel photo preview" style="max-width:100%;max-height:200px;border-radius:8px;">`;
    };
    reader.readAsDataURL(file);
  }
  if (btn) btn.style.display = "block";
}

async function uploadPhoto() {
  const fileInput = document.getElementById("photoFile");
  const statusEl  = document.getElementById("photoStatus");
  const btn       = document.getElementById("uploadPhotoBtn");
  const afterEl   = document.getElementById("afterPhotoSchedule");
  const file      = fileInput?.files?.[0];
  if (!file) return;

  if (btn) { btn.disabled = true; btn.textContent = "Uploading\u2026"; }
  if (statusEl) statusEl.textContent = "";

  const reader = new FileReader();
  reader.onload = async ev => {
    try {
      const base64 = ev.target.result.split(",")[1];
      const r = await fetch("/api/quote/photo", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ quote_id: S.quoteId, base64, mime_type: file.type, filename: file.name }),
      });
      const data = await r.json();
      if (data.ok) {
        S.photoUploaded = true;
        if (statusEl) statusEl.innerHTML = "\u2705 Photo received!";
        if (btn) btn.style.display = "none";
        if (afterEl) afterEl.style.display = "block";
        // Bind the newly shown schedule button
        document.getElementById("scheduleBtn")?.addEventListener("click", loadSlots);
      } else {
        throw new Error(data.error || "Upload failed");
      }
    } catch (err) {
      if (statusEl) statusEl.textContent = "Upload failed: " + err.message;
      if (btn) { btn.disabled = false; btn.textContent = "Upload Photo"; }
    }
  };
  reader.onerror = () => {
    if (statusEl) statusEl.textContent = "Could not read file.";
    if (btn) { btn.disabled = false; btn.textContent = "Upload Photo"; }
  };
  reader.readAsDataURL(file);
}

// ── Slot Formatting ────────────────────────────────────────────────────────────
function formatSlotDate(iso, timezone) {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    weekday: "long", month: "long", day: "numeric",
  }).format(new Date(iso));
}

function formatSlotTime(iso, timezone) {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: timezone, hour: "numeric", minute: "2-digit", hour12: true,
  }).format(new Date(iso));
}

// ── Utilities ─────────────────────────────────────────────────────────────────
function val(id)    { return document.getElementById(id)?.value?.trim() || ""; }
function setContent(html) { document.getElementById("stepContent").innerHTML = html; }
function loadingHTML(msg) {
  return `<div class="q-loading"><div class="q-spinner"></div><p class="q-muted" style="margin-top:16px;">${msg}</p></div>`;
}
function errHTML(msg) { return `<div class="q-error-box">\u26A0\uFE0F ${escHtml(msg)}</div>`; }
function escHtml(s) {
  return String(s ?? "")
    .replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;");
}

document.addEventListener("DOMContentLoaded", boot);

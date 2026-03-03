// pages/js/quote.js — V3 Quote Flow v3 (reference design)
// Type → Categories → Services + Qty → Details → Review (Price + Slots) → Confirm → [Photo] → Booked

// ── State ─────────────────────────────────────────────────────────────────────
const S = {
  step: "segment",
  segment: null,
  selectedCategories: [],   // string[]  — multi-select
  config: null,
  quoteId: null,
  typeId: null,             // selected job_type_id
  qty: 1,                   // quantity — sent to server, server returns final_price inclusive
  answers: {},
  addons: [],
  pricing: null,            // server calc response (final_price already qty-adjusted)
  lock: null,               // server lock response (final_price already qty-adjusted)
  photoUploaded: false,
  slotsData: null,
  selectedSlot: null,
  booking: null,
};

let repricTimer = null;

// ── Boot ──────────────────────────────────────────────────────────────────────
async function boot() {
  setContent(loadingHTML("Loading\u2026"));
  try {
    const r  = await fetch("/api/quote/config");
    S.config = await r.json();
    go("segment");
  } catch {
    setContent(errHTML("Could not load services. Please refresh."));
  }
}

// ── Navigation ────────────────────────────────────────────────────────────────
function go(step) {
  S.step = step;
  window.scrollTo({ top: 0, behavior: "smooth" });
  renderStep();
}

function back() {
  if (S.step === "review") {
    const hasQs     = (S.config?.questionsByType?.[S.typeId]?.length || 0) > 0;
    const hasAddons = (S.config?.addonsByType?.[S.typeId]?.length   || 0) > 0;
    go(hasQs || hasAddons ? "questions" : "services");
    return;
  }
  const prev = {
    categories: "segment",
    services:   "categories",
    questions:  "services",
    confirm:    "review",
    photo:      "confirm",
  };
  if (prev[S.step]) go(prev[S.step]);
}

// ── Rendering ─────────────────────────────────────────────────────────────────
function renderStep() {
  document.getElementById("qProgress").innerHTML = progressHTML();
  const el    = document.getElementById("stepContent");
  const clone = el.cloneNode(false);
  el.parentNode.replaceChild(clone, el);

  switch (S.step) {
    case "segment":    clone.innerHTML = renderSegment();    break;
    case "categories": clone.innerHTML = renderCategories(); break;
    case "services":   clone.innerHTML = renderServices();   break;
    case "questions":  clone.innerHTML = renderQuestions();  break;
    case "review":
      clone.innerHTML = renderReview();
      loadSlotsForReview();
      break;
    case "confirm":    clone.innerHTML = renderConfirm();    break;
    case "photo":      clone.innerHTML = renderPhoto();      break;
    case "booked":     clone.innerHTML = renderBooked();     break;
    default:           clone.innerHTML = errHTML("Unknown step."); break;
  }
  bindEvents();
}

function setContent(html) { document.getElementById("stepContent").innerHTML = html; }

// ── Progress bar (horizontal tab style) ───────────────────────────────────────
function progressHTML() {
  const steps = ["Type", "Categories", "Services", "Review", "Done"];
  const idx   = {
    segment: 0, categories: 1,
    services: 2, questions: 2,
    review: 3,
    confirm: 4, photo: 4, booked: 4,
  };
  const cur = idx[S.step] ?? 0;

  const parts = [];
  steps.forEach((label, i) => {
    const cls = i < cur ? "done" : i === cur ? "active" : "";
    parts.push(`<div class="q-prog-step ${cls}">
      <span class="q-prog-num">${i + 1}.</span>
      <span class="q-prog-label">${label}</span>
    </div>`);
    if (i < steps.length - 1) parts.push(`<span class="q-prog-div">/</span>`);
  });
  return `<div class="q-progress">${parts.join("")}</div>`;
}

// ── Step badge helper ──────────────────────────────────────────────────────────
function stepHeader(num, title) {
  return `<div class="q-step-header">
    <div class="q-step-badge">${num}</div>
    <h2 class="q-step-title">${title}</h2>
  </div>`;
}

// ── Note bar helper ────────────────────────────────────────────────────────────
const NOTE = `<div class="q-note-bar"><strong>Note:</strong> This is a rough estimate. Final pricing may vary based on on-site inspection.</div>`;

// ── Step 1: Segment / Type ────────────────────────────────────────────────────
function renderSegment() {
  return `
    <div class="q-hero">
      <h1 class="q-hero-title">Get your estimate <span class="q-hero-accent">instantly</span></h1>
      <p class="q-hero-sub">Select your service needs below and our smart calculator will generate a precise estimate for your project.</p>
    </div>
    ${stepHeader(1, "Project Type")}
    <div class="q-type-list">
      <div class="q-type-card${S.segment === "Residential" ? " selected" : ""}" data-seg="Residential">
        <div class="q-type-icon-box">&#127968;</div>
        <div class="q-type-text">
          <div class="q-type-name">Residential</div>
          <div class="q-type-sub">Home electrical upgrades, repairs, and installations.</div>
        </div>
        <div class="q-type-radio"></div>
      </div>
      <div class="q-type-card${S.segment === "Commercial" ? " selected" : ""}" data-seg="Commercial">
        <div class="q-type-icon-box">&#127970;</div>
        <div class="q-type-text">
          <div class="q-type-name">Commercial</div>
          <div class="q-type-sub">Office, retail, and industrial electrical solutions.</div>
        </div>
        <div class="q-type-radio"></div>
      </div>
    </div>
    <div class="q-nav-row">
      <div></div>
      <button class="q-btn-next" id="nextSegment" ${S.segment ? "" : "disabled"}>
        Next Step &rarr;
      </button>
    </div>
    ${NOTE}`;
}

// ── Step 2: Categories (multi-select list) ────────────────────────────────────
const CAT_ICONS = {
  "Outlets & Switches": "&#128268;",
  "Lighting & Fans":    "&#128161;",
  "Ventilation":        "&#127751;",
  "Panel & Protection": "&#9889;",
  "EV Charging":        "&#128663;",
  "Diagnostics":        "&#128269;",
};

function renderCategories() {
  const types = (S.config?.jobTypes || []).filter(j => j.segment === S.segment);
  const cats  = [...new Set(types.map(t => t.category).filter(Boolean))];

  if (!cats.length) return `
    <div class="q-center">
      <div class="q-icon">&#128295;</div>
      <h2 style="font-family:var(--font-display);font-size:20px;font-weight:800;margin-bottom:8px;">Coming Soon</h2>
      <p class="q-muted">${escHtml(S.segment)} services are being added. Call us for a custom quote at
        <a href="tel:+14095550100" style="color:hsl(var(--accent));">(409) 555-0100</a>.</p>
    </div>
    <div class="q-nav-row">
      <button class="q-btn-back" onclick="back()">&#8592; Back</button>
      <div></div>
    </div>`;

  return `
    ${stepHeader(2, "Categories")}
    <div class="q-cat-list">
      ${cats.map(cat => {
        const sel = S.selectedCategories.includes(cat);
        return `<div class="q-cat-item${sel ? " selected" : ""}" data-cat="${escHtml(cat)}">
          <span>${escHtml(cat)}</span>
          <span class="q-cat-check">&#10003;</span>
        </div>`;
      }).join("")}
    </div>
    <div class="q-nav-row">
      <button class="q-btn-back" onclick="back()">&#8592; Back</button>
      <button class="q-btn-next" id="nextCategories" ${S.selectedCategories.length ? "" : "disabled"}>
        Next Step &rarr;
      </button>
    </div>
    ${NOTE}`;
}

// ── Step 3: Services (checkbox select + qty) ──────────────────────────────────
function renderServices() {
  const allTypes = (S.config?.jobTypes || []).filter(j =>
    j.segment === S.segment && S.selectedCategories.includes(j.category)
  );

  if (!allTypes.length) return `
    <div class="q-center">
      <div class="q-icon">&#128295;</div>
      <h2 style="font-family:var(--font-display);font-size:20px;font-weight:800;margin-bottom:8px;">No Services Found</h2>
      <p class="q-muted">No services available yet for the selected categories.</p>
    </div>
    <div class="q-nav-row">
      <button class="q-btn-back" onclick="back()">&#8592; Back</button>
      <div></div>
    </div>`;

  // Group by category
  const grouped = {};
  for (const t of allTypes) {
    if (!grouped[t.category]) grouped[t.category] = [];
    grouped[t.category].push(t);
  }

  const listHTML = Object.entries(grouped).map(([cat, types]) => `
    <div class="q-cat-group-heading">${escHtml(cat)}</div>
    <div class="q-svc-list">
      ${types.map(t => {
        const sel = S.typeId === t.job_type_id;
        return `
          <div class="q-svc-item${sel ? " selected" : ""}" data-type="${escHtml(t.job_type_id)}">
            <div class="q-svc-checkbox">${sel ? "&#10003;" : ""}</div>
            <div>
              <div class="q-svc-name">${escHtml(t.name_public)}</div>
              ${t.min_price ? `<div class="q-svc-price">From $${Number(t.min_price).toLocaleString()}</div>` : ""}
            </div>
          </div>`;
      }).join("")}
    </div>`).join("");

  return `
    ${stepHeader(3, "Select Specific Services")}
    ${listHTML}
    <div class="q-qty-wrap" id="qtyWrap" ${S.typeId ? "" : 'style="display:none;"'}>
      <div class="q-qty-label">How many?</div>
      <div class="q-qty-ctrl">
        <button class="q-qty-btn" id="qtyDec">&#8722;</button>
        <span class="q-qty-val" id="qtyVal">${S.qty}</span>
        <button class="q-qty-btn" id="qtyInc">&#43;</button>
      </div>
    </div>
    <div class="q-nav-row">
      <button class="q-btn-back" onclick="back()">&#8592; Back</button>
      <button class="q-btn-next" id="nextService" ${S.typeId ? "" : "disabled"}>
        Next Step &rarr;
      </button>
    </div>
    ${NOTE}`;
}

// ── Step 4: Questions + Add-ons ───────────────────────────────────────────────
function renderQuestions() {
  const questions = S.config?.questionsByType?.[S.typeId] || [];
  const addons    = S.config?.addonsByType?.[S.typeId]   || [];

  return `
    ${stepHeader(3, "Project Details")}
    ${!questions.length && !addons.length ? `
      <p class="q-muted" style="margin-bottom:20px;">No additional details needed for this service.</p>
    ` : ""}
    <div class="q-card-section">
      <div class="q-questions">
        ${questions.map(q => renderQuestion(q)).join("")}
      </div>
      ${addons.length ? `
        <div class="q-section-label" style="margin-top:${questions.length ? "24px" : "0"};">Optional Add-ons</div>
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
    </div>
    <div class="q-nav-row">
      <button class="q-btn-back" onclick="back()">&#8592; Back</button>
      <button class="q-btn-next" id="seePriceBtn">
        See My Price &rarr;
      </button>
    </div>
    ${NOTE}`;
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

// ── Step 5: Review — price + slot picker (no lead info) ───────────────────────
function renderReview() {
  const price   = S.pricing?.final_price ?? null;
  const bnpl    = price && price >= 200 ? Math.ceil(price / 12) : null;
  const jobType = (S.config?.jobTypes || []).find(j => j.job_type_id === S.typeId);
  const label   = jobType?.name_public || "";

  const slotLabel = S.selectedSlot
    ? (() => {
        const tz = S.slotsData?.timezone || "America/Chicago";
        const d  = new Date(S.selectedSlot);
        const date = new Intl.DateTimeFormat("en-US", { timeZone: tz, weekday: "short", month: "short", day: "numeric" }).format(d);
        const time = new Intl.DateTimeFormat("en-US", { timeZone: tz, hour: "numeric", minute: "2-digit", hour12: true }).format(d);
        return `${date} \u2022 ${time}`;
      })()
    : null;

  return `
    ${stepHeader(4, "Final Review &amp; Scheduling")}

    <div class="q-review-slots-section">
      <div class="q-review-slots-heading">&#128197; Preferred Appointment Date</div>
      <div class="q-review-date-field${slotLabel ? " has-slot" : ""}">
        <span>&#128197;</span>
        <span>${slotLabel || "Select a date &amp; time"}</span>
      </div>
      <p class="q-muted" style="font-size:13px;margin-top:8px;">
        Note: Select a time slot below. Your spot is held when you confirm.
      </p>
      <div id="reviewSlotSection">${loadingHTML("Finding available times\u2026")}</div>
    </div>

    <div class="q-price-footer">
      <div class="q-price-footer-label">
        Final Estimated Cost${S.qty > 1 ? ` (${S.qty}&times; ${escHtml(label)})` : ""}
      </div>
      <div class="q-price-footer-amount">
        $${price != null ? Number(price).toLocaleString() : "0.00"}
      </div>
      <div class="q-price-footer-sub">
        &#128205; A $25 travel fee may apply once your address is confirmed.
        ${S.pricing?.evaluation_flag ? " An in-person evaluation may be needed first." : ""}
        ${bnpl ? ` &bull; As low as $${bnpl}/mo.` : ""}
      </div>
    </div>

    <div class="q-nav-row" style="margin-top:20px;">
      <button class="q-btn-back" onclick="back()">&#8592; Back</button>
      <button class="q-btn-next" id="goConfirmBtn" ${S.selectedSlot ? "" : "disabled"}>
        Confirm Booking &rarr;
      </button>
    </div>
    ${NOTE}`;
}

// ── Step 6: Confirm — lead form ────────────────────────────────────────────────
function renderConfirm() {
  const price  = S.lock?.final_price ?? S.pricing?.final_price ?? null;
  const tz     = S.slotsData?.timezone || "America/Chicago";
  const slotDt = S.selectedSlot ? new Date(S.selectedSlot) : null;
  const slotDate = slotDt
    ? new Intl.DateTimeFormat("en-US", { timeZone: tz, weekday: "short", month: "long", day: "numeric" }).format(slotDt)
    : "";
  const slotTime = slotDt
    ? new Intl.DateTimeFormat("en-US", { timeZone: tz, hour: "numeric", minute: "2-digit", hour12: true }).format(slotDt)
    : "";

  return `
    ${stepHeader(5, "Your Information")}
    <div class="q-confirm-summary">
      <div class="q-confirm-row">
        <span class="q-confirm-icon">&#128197;</span>
        <div>
          <div class="q-confirm-key">Appointment</div>
          <div class="q-confirm-val">${escHtml(slotDate)}&nbsp;&bull;&nbsp;${escHtml(slotTime)}</div>
        </div>
      </div>
      <div class="q-confirm-row">
        <span class="q-confirm-icon">&#128181;</span>
        <div>
          <div class="q-confirm-key">Estimated Price</div>
          <div class="q-confirm-val">
            $${price != null ? Number(price).toLocaleString() : "&mdash;"}
            <span class="q-confirm-note">&mdash; travel fee applied with address</span>
          </div>
        </div>
      </div>
    </div>
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
      <div class="q-nav-row" style="margin-top:8px;">
        <button class="q-btn-back" onclick="back()">&#8592; Back</button>
        <button class="q-btn-next" id="submitLockBtn">
          Confirm &amp; Book &rarr;
        </button>
      </div>
    </div>
    <p class="q-muted" style="font-size:12px;text-align:center;margin-top:16px;">
      Secure booking &bull; No payment due now
    </p>`;
}

// ── Step 7: Photo gate ────────────────────────────────────────────────────────
function renderPhoto() {
  return `
    ${stepHeader(5, "One Quick Step")}
    <p class="q-muted" style="margin-bottom:20px;">
      Please upload a photo of your electrical panel so we can confirm compatibility before finalizing your booking.
    </p>
    <div class="q-photo-gate">
      <div class="q-photo-header">&#128247; Upload a Panel Photo</div>
      <p class="q-muted" style="font-size:13px;margin:6px 0 0;">JPG, PNG or HEIC &bull; Max 10 MB</p>
      <label class="q-file-label">
        Choose Photo
        <input type="file" id="photoFile" accept="image/*" style="display:none;">
      </label>
      <div id="photoPreview" class="q-photo-preview" style="display:none;"></div>
      <button class="q-btn-next" id="uploadPhotoBtn" style="display:none;margin-top:12px;width:100%;">
        Upload Photo
      </button>
      <div id="photoStatus" class="q-photo-status"></div>
    </div>
    <button class="q-btn-next" id="finalizeBtn" style="display:none;margin-top:20px;width:100%;">
      Finalize Booking &rarr;
    </button>`;
}

// ── Step 8: Booked ────────────────────────────────────────────────────────────
function renderBooked() {
  const bk   = S.booking;
  const tz   = S.slotsData?.timezone || "America/Chicago";
  const dt   = bk?.scheduled_datetime ? new Date(bk.scheduled_datetime) : null;
  const dateStr = dt
    ? new Intl.DateTimeFormat("en-US", { timeZone: tz, weekday: "long", month: "long", day: "numeric", year: "numeric" }).format(dt)
    : "";
  const timeStr = dt
    ? new Intl.DateTimeFormat("en-US", { timeZone: tz, hour: "numeric", minute: "2-digit", hour12: true }).format(dt)
    : "";
  const displayPrice = S.lock?.final_price ?? bk?.final_price;

  return `
    <div class="q-booked">
      <div class="q-booked-icon">&#127881;</div>
      <h2 style="font-family:var(--font-display);font-size:26px;font-weight:800;letter-spacing:-0.02em;margin-bottom:8px;">You're Booked!</h2>
      <p class="q-muted" style="margin-bottom:24px;">Here's your confirmation. We'll see you soon.</p>
      <div class="q-booking-card">
        <div class="q-booking-row">
          <span class="q-booking-key">&#128197; Date</span>
          <span class="q-booking-val">${escHtml(dateStr)}</span>
        </div>
        <div class="q-booking-row">
          <span class="q-booking-key">&#128347; Time</span>
          <span class="q-booking-val">${escHtml(timeStr)} (Central)</span>
        </div>
        <div class="q-booking-row">
          <span class="q-booking-key">&#128205; Address</span>
          <span class="q-booking-val">${escHtml(bk?.address || "")}</span>
        </div>
        <div class="q-booking-row">
          <span class="q-booking-key">&#128181; Price</span>
          <span class="q-booking-val">$${Number(displayPrice || 0).toLocaleString()} locked</span>
        </div>
        <div class="q-booking-row">
          <span class="q-booking-key">&#129534; ID</span>
          <span class="q-booking-val" style="font-family:monospace;font-size:12px;">${escHtml(bk?.booking_id || "")}</span>
        </div>
      </div>
      <p class="q-muted" style="margin-top:24px;font-size:13px;">
        Questions? Call us at <a href="tel:+14095550100" style="color:hsl(var(--accent));">(409) 555-0100</a>
      </p>
    </div>`;
}

// ── Event Binding ─────────────────────────────────────────────────────────────
function bindEvents() {
  // Segment cards — click to select, Next Step to advance
  document.querySelectorAll(".q-type-card").forEach(card => {
    card.addEventListener("click", () => {
      S.segment = card.dataset.seg;
      document.querySelectorAll(".q-type-card").forEach(c => c.classList.remove("selected"));
      card.classList.add("selected");
      document.getElementById("nextSegment")?.removeAttribute("disabled");
    });
  });

  document.getElementById("nextSegment")?.addEventListener("click", () => {
    if (!S.segment) return;
    S.selectedCategories = [];
    S.typeId = null; S.qty = 1; S.answers = {}; S.addons = [];
    go("categories");
  });

  // Category items — toggle
  document.querySelectorAll(".q-cat-item").forEach(item => {
    item.addEventListener("click", () => {
      const cat = item.dataset.cat;
      const idx = S.selectedCategories.indexOf(cat);
      if (idx >= 0) S.selectedCategories.splice(idx, 1);
      else S.selectedCategories.push(cat);
      const sel = S.selectedCategories.includes(cat);
      item.classList.toggle("selected", sel);
      item.querySelector(".q-cat-check").style.visibility = sel ? "visible" : "hidden";
      document.getElementById("nextCategories").disabled = !S.selectedCategories.length;
    });
  });

  document.getElementById("nextCategories")?.addEventListener("click", () => {
    if (!S.selectedCategories.length) return;
    S.typeId = null; S.qty = 1; S.answers = {}; S.addons = [];
    go("services");
  });

  // Service items — single select
  document.querySelectorAll(".q-svc-item").forEach(item => {
    item.addEventListener("click", () => {
      S.typeId  = item.dataset.type;
      S.answers = {}; S.addons = [];
      document.querySelectorAll(".q-svc-item").forEach(i => {
        i.classList.remove("selected");
        i.querySelector(".q-svc-checkbox").innerHTML = "";
      });
      item.classList.add("selected");
      item.querySelector(".q-svc-checkbox").innerHTML = "&#10003;";
      const qtyWrap = document.getElementById("qtyWrap");
      if (qtyWrap) qtyWrap.style.display = "";
      document.getElementById("nextService")?.removeAttribute("disabled");
    });
  });

  // Qty controls
  document.getElementById("qtyDec")?.addEventListener("click", () => {
    S.qty = Math.max(1, S.qty - 1);
    const el = document.getElementById("qtyVal");
    if (el) el.textContent = S.qty;
  });
  document.getElementById("qtyInc")?.addEventListener("click", () => {
    S.qty = Math.min(20, S.qty + 1);
    const el = document.getElementById("qtyVal");
    if (el) el.textContent = S.qty;
  });

  document.getElementById("nextService")?.addEventListener("click", () => {
    if (!S.typeId) return;
    const hasQs     = (S.config?.questionsByType?.[S.typeId]?.length || 0) > 0;
    const hasAddons = (S.config?.addonsByType?.[S.typeId]?.length   || 0) > 0;
    if (hasQs || hasAddons) go("questions");
    else calcPrice();
  });

  // Questions
  document.querySelectorAll("input[type=radio]").forEach(radio => {
    radio.addEventListener("change", () => {
      const qid = radio.name.replace("q_", "");
      S.answers[qid] = radio.value;
      radio.closest(".q-options")?.querySelectorAll(".q-option")
        .forEach(l => l.classList.toggle("selected", l.querySelector("input") === radio));
    });
  });
  document.querySelectorAll(".q-addon-check").forEach(cb => {
    cb.addEventListener("change", () => {
      if (cb.checked) { if (!S.addons.includes(cb.value)) S.addons.push(cb.value); }
      else { S.addons = S.addons.filter(id => id !== cb.value); }
      cb.closest(".q-addon")?.classList.toggle("selected", cb.checked);
    });
  });
  document.querySelectorAll(".q-text-input").forEach(inp => {
    inp.addEventListener("change", () => { S.answers[inp.name.replace("q_", "")] = inp.value; });
  });

  document.getElementById("seePriceBtn")?.addEventListener("click", calcPrice);

  // Review: advance to confirm once slot selected
  document.getElementById("goConfirmBtn")?.addEventListener("click", () => {
    if (!S.selectedSlot) return;
    go("confirm");
  });

  // Confirm: ZIP reprice
  document.getElementById("ld_zip")?.addEventListener("input", e => {
    const zip = e.target.value.replace(/\D/g, "").slice(0, 5);
    e.target.value = zip;
    clearTimeout(repricTimer);
    if (zip.length === 5) repricTimer = setTimeout(() => reprice(zip), 800);
  });

  document.getElementById("submitLockBtn")?.addEventListener("click", submitLock);

  // Photo
  document.getElementById("photoFile")?.addEventListener("change", onPhotoSelected);
  document.getElementById("uploadPhotoBtn")?.addEventListener("click", uploadPhoto);
  document.getElementById("finalizeBtn")?.addEventListener("click", submitBooking);
}

// ── API: Calculate price ───────────────────────────────────────────────────────
async function calcPrice() {
  go("review");
  document.getElementById("stepContent").innerHTML = loadingHTML("Calculating your price\u2026");

  try {
    if (!S.quoteId) {
      const sr = await fetch("/api/quote/start", {
        method: "POST", headers: { "Content-Type": "application/json" }, body: "{}",
      });
      const sd = await sr.json();
      if (!sd.quote_id) throw new Error("Could not start session.");
      S.quoteId = sd.quote_id;
    }
    const cr = await fetch("/api/quote/calc", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ quote_id: S.quoteId, job_type_id: S.typeId, answers: S.answers, addons: S.addons, qty: S.qty }),
    });
    S.pricing = await cr.json();
    if (!S.pricing.ok && S.pricing.error) throw new Error(S.pricing.error);
    S.selectedSlot = null;
    go("review");
  } catch (e) {
    document.getElementById("stepContent").innerHTML = errHTML("Could not calculate price: " + e.message);
  }
}

// ── Load slots for review screen ───────────────────────────────────────────────
async function loadSlotsForReview() {
  const section = document.getElementById("reviewSlotSection");
  if (!section) return;
  try {
    const jobType = (S.config?.jobTypes || []).find(j => j.job_type_id === S.typeId);
    const minutes = Number(jobType?.default_duration_minutes) || 90;
    const r       = await fetch(`/api/schedule/slots?minutes=${encodeURIComponent(minutes)}`);
    const d       = await r.json();
    if (!d.ok) throw new Error(d.error || "Could not load slots.");
    S.slotsData     = d;
    section.innerHTML = renderSlotGrid(d.slots, d.timezone);
    bindSlotEvents();
  } catch (e) {
    section.innerHTML = `<div class="q-error-box" style="margin-top:12px;">Could not load times: ${escHtml(e.message)}</div>`;
  }
}

function renderSlotGrid(slots, timezone) {
  if (!slots || !slots.length) {
    return `<div class="q-error-box" style="margin-top:12px;">No available slots right now. We'll call you within one business day to schedule.</div>`;
  }
  const groups = {};
  for (const iso of slots) {
    const dk = formatSlotDate(iso, timezone);
    if (!groups[dk]) groups[dk] = [];
    groups[dk].push(iso);
  }
  return `<div class="q-slot-groups">${Object.entries(groups).map(([date, daySlots]) => `
    <div class="q-slot-group">
      <div class="q-slot-date">${escHtml(date)}</div>
      <div class="q-slot-row">
        ${daySlots.map(iso => `
          <button class="q-slot${S.selectedSlot === iso ? " selected" : ""}" data-iso="${escHtml(iso)}">
            ${escHtml(formatSlotTime(iso, timezone))}
          </button>`).join("")}
      </div>
    </div>`).join("")}</div>`;
}

function bindSlotEvents() {
  document.querySelectorAll(".q-slot").forEach(btn => {
    btn.addEventListener("click", () => {
      S.selectedSlot = btn.dataset.iso;
      document.querySelectorAll(".q-slot").forEach(b => b.classList.remove("selected"));
      btn.classList.add("selected");
      document.getElementById("goConfirmBtn")?.removeAttribute("disabled");
      // Update the "field" display
      const fieldEl = document.querySelector(".q-review-date-field");
      if (fieldEl) {
        const tz   = S.slotsData?.timezone || "America/Chicago";
        const d    = new Date(S.selectedSlot);
        const date = formatSlotDate(S.selectedSlot, tz);
        const time = formatSlotTime(S.selectedSlot, tz);
        fieldEl.innerHTML = `<span>&#128197;</span><span>${escHtml(date)} &bull; ${escHtml(time)}</span>`;
        fieldEl.classList.add("has-slot");
      }
    });
  });
}

// ── ZIP reprice ────────────────────────────────────────────────────────────────
async function reprice(zip) {
  const noteEl   = document.getElementById("zipNote");
  const updateEl = document.getElementById("priceUpdate");
  if (!noteEl || !updateEl) return;
  noteEl.style.display = "block";
  noteEl.textContent   = "Checking travel fee\u2026";
  updateEl.style.display = "none";
  try {
    const r = await fetch("/api/quote/lock", {
      method: "POST", headers: { "Content-Type": "application/json" },
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

// ── Submit Lock ────────────────────────────────────────────────────────────────
async function submitLock() {
  const name    = val("ld_name");
  const phone   = val("ld_phone");
  const email   = val("ld_email");
  const address = val("ld_address");
  const zip     = val("ld_zip");

  const errEl = document.getElementById("leadErr");
  const show  = msg => { if (errEl) { errEl.textContent = msg; errEl.style.display = "block"; } };
  if (errEl) errEl.style.display = "none";

  if (!name)                return show("Name is required.");
  if (!phone)               return show("Phone is required.");
  if (!address)             return show("Address is required.");
  if (!/^\d{5}$/.test(zip)) return show("Please enter a valid 5-digit ZIP code.");

  const btn = document.getElementById("submitLockBtn");
  if (btn) { btn.disabled = true; btn.textContent = "Locking\u2026"; }

  try {
    const r = await fetch("/api/quote/lock", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ quote_id: S.quoteId, job_type_id: S.typeId, answers: S.answers, addons: S.addons, qty: S.qty, customer_name: name, name, phone, email, address, zip }),
    });
    const data = await r.json();
    if (!data.ok) throw new Error(data.error || "Lock failed.");
    S.lock = data;
    if (data.photo_required && !S.photoUploaded) go("photo");
    else await submitBooking();
  } catch (e) {
    show(e.message);
    if (btn) { btn.disabled = false; btn.textContent = "Confirm & Book \u2192"; }
  }
}

// ── Photo upload ──────────────────────────────────────────────────────────────
function onPhotoSelected(e) {
  const file = e.target.files[0];
  if (!file) return;
  const preview   = document.getElementById("photoPreview");
  const uploadBtn = document.getElementById("uploadPhotoBtn");
  const reader    = new FileReader();
  reader.onload = ev => {
    if (preview) {
      preview.innerHTML = `<img src="${ev.target.result}" alt="Preview"
        style="max-width:100%;max-height:200px;border-radius:10px;margin-top:8px;">`;
      preview.style.display = "block";
    }
    if (uploadBtn) uploadBtn.style.display = "block";
  };
  reader.readAsDataURL(file);
}

async function uploadPhoto() {
  const file     = document.getElementById("photoFile")?.files[0];
  const statusEl = document.getElementById("photoStatus");
  const btn      = document.getElementById("uploadPhotoBtn");
  if (!file || !statusEl) return;
  if (btn) { btn.disabled = true; btn.textContent = "Uploading\u2026"; }
  statusEl.textContent = "Uploading\u2026";
  try {
    const base64 = await fileToBase64(file);
    const r = await fetch("/api/quote/photo", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ quote_id: S.quoteId, filename: file.name, data: base64 }),
    });
    const d = await r.json();
    if (!d.ok) throw new Error(d.error || "Upload failed.");
    S.photoUploaded = true;
    statusEl.textContent = "\u2705 Photo uploaded!";
    const finalizeBtn = document.getElementById("finalizeBtn");
    if (finalizeBtn) finalizeBtn.style.display = "block";
    if (btn) btn.style.display = "none";
  } catch (e) {
    statusEl.textContent = "\u274C Upload failed: " + e.message;
    if (btn) { btn.disabled = false; btn.textContent = "Upload Photo"; }
  }
}

function fileToBase64(file) {
  return new Promise((res, rej) => {
    const r = new FileReader();
    r.onload  = e => res(e.target.result.split(",")[1]);
    r.onerror = rej;
    r.readAsDataURL(file);
  });
}

// ── Submit Booking ────────────────────────────────────────────────────────────
async function submitBooking() {
  try {
    const lockData = S.lock || S.pricing;
    const r = await fetch("/api/schedule/book", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        quote_id:           S.quoteId,
        scheduled_datetime: S.selectedSlot,
        address:            lockData?.address || "",
        customer_name:      lockData?.customer_name || "",
        final_price:        lockData?.final_price,
      }),
    });
    const d = await r.json();
    if (!d.ok) throw new Error(d.error || "Booking failed.");
    S.booking = d;
    go("booked");
  } catch (e) {
    const errEl = document.getElementById("leadErr");
    if (errEl) { errEl.textContent = e.message; errEl.style.display = "block"; }
    const btn = document.getElementById("submitLockBtn");
    if (btn) { btn.disabled = false; btn.textContent = "Confirm & Book \u2192"; }
  }
}

// ── Formatters ────────────────────────────────────────────────────────────────
function formatSlotDate(iso, tz) {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: tz, weekday: "short", month: "short", day: "numeric",
  }).format(new Date(iso));
}
function formatSlotTime(iso, tz) {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: tz, hour: "numeric", minute: "2-digit", hour12: true,
  }).format(new Date(iso));
}

// ── Helpers ───────────────────────────────────────────────────────────────────
function escHtml(s) {
  return String(s ?? "")
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}
function val(id) { return (document.getElementById(id)?.value || "").trim(); }
function loadingHTML(msg) {
  return `<div class="q-loading"><div class="q-spinner"></div><p class="q-muted" style="margin-top:16px;">${msg}</p></div>`;
}
function errHTML(msg) {
  return `<div class="q-error-box" style="margin-top:24px;">${escHtml(msg)}</div>`;
}

// ── Init ──────────────────────────────────────────────────────────────────────
document.addEventListener("DOMContentLoaded", boot);

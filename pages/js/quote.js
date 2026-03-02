// pages/js/quote.js — V3 Quote Flow v2
// Segment → Categories (multi-select) → Service + Qty → Details → Review (Price + Slots) → Confirm → [Photo] → Booked

// ── State ─────────────────────────────────────────────────────────────────────
const S = {
  step: "segment",
  segment: null,
  selectedCategories: [],   // string[]  — multi-select
  config: null,
  quoteId: null,
  typeId: null,             // selected job_type_id
  qty: 1,                   // quantity for selected service
  answers: {},
  addons: [],
  pricing: null,            // server calc response
  displayPrice: null,       // pricing.final_price × qty (no travel fee yet)
  lock: null,               // server lock response
  lockedDisplayPrice: null, // (base × qty) + travel_fee
  photoUploaded: false,
  slotsData: null,
  selectedSlot: null,
  booking: null,
};

let repricTimer = null;

// ── Boot ──────────────────────────────────────────────────────────────────────
async function boot() {
  setContent(loadingHTML("Loading services\u2026"));
  try {
    const r  = await fetch("/api/quote/config");
    S.config = await r.json();
    go("segment");
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
  if (S.step === "review") {
    const hasQs     = (S.config?.questionsByType?.[S.typeId]?.length || 0) > 0;
    const hasAddons = (S.config?.addonsByType?.[S.typeId]?.length   || 0) > 0;
    go(hasQs || hasAddons ? "questions" : "services");
    return;
  }
  const prev = { categories: "segment", services: "categories", questions: "services", confirm: "review", photo: "confirm" };
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

function progressHTML() {
  const steps = ["Type", "Services", "Details", "Review", "Confirm"];
  const idx   = {
    segment: 0, categories: 0,
    services: 1,
    questions: 2,
    review: 3,
    confirm: 4, photo: 4, booked: 4,
  };
  const cur = idx[S.step] ?? 0;
  return `<div class="q-progress">${steps.map((label, i) =>
    `<div class="q-prog-step ${i < cur ? "done" : ""} ${i === cur ? "active" : ""}">
       <div class="q-prog-dot">${i < cur ? "\u2713" : i + 1}</div>
       <div class="q-prog-label">${label}</div>
     </div>${i < steps.length - 1
       ? `<div class="q-prog-line${i < cur ? " done" : ""}"></div>`
       : ""}`
  ).join("")}</div>`;
}

// ── Step 1: Segment ───────────────────────────────────────────────────────────
function renderSegment() {
  return `
    <h2 class="q-heading">What type of property?</h2>
    <div class="q-seg-cards">
      <button class="q-seg-card" data-seg="Residential">
        <div class="q-seg-icon">&#127968;</div>
        <div class="q-seg-name">Residential</div>
        <div class="q-seg-sub">Homes, condos &amp; apartments</div>
      </button>
      <button class="q-seg-card" data-seg="Commercial">
        <div class="q-seg-icon">&#127970;</div>
        <div class="q-seg-name">Commercial</div>
        <div class="q-seg-sub">Offices, retail &amp; businesses</div>
      </button>
    </div>`;
}

// ── Step 2: Categories (multi-select) ─────────────────────────────────────────
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
    <button class="q-back" onclick="back()">&#8592; Back</button>
    <div class="q-center">
      <div class="q-icon">&#128295;</div>
      <h2 class="q-heading">Coming Soon</h2>
      <p class="q-muted">Commercial services are being added. Call us for a custom quote at
        <a href="tel:+14095550100" style="color:hsl(var(--accent));">(409) 555-0100</a>.</p>
    </div>`;

  return `
    <button class="q-back" onclick="back()">&#8592; Back</button>
    <h2 class="q-heading">What type of work do you need?</h2>
    <p class="q-muted" style="margin-bottom:20px;">Select all that apply &mdash; then tap <em>See Services</em>.</p>
    <div class="q-cat-cards">
      ${cats.map(cat => {
        const sel = S.selectedCategories.includes(cat);
        return `
          <button class="q-cat-card q-checkable${sel ? " selected" : ""}" data-cat="${escHtml(cat)}">
            <span class="q-check-badge">${sel ? "&#10003;" : ""}</span>
            <div class="q-cat-icon">${CAT_ICONS[cat] || "&#128295;"}</div>
            <div class="q-cat-name">${escHtml(cat)}</div>
          </button>`;
      }).join("")}
    </div>
    <button class="q-btn-primary" id="nextCategories" style="margin-top:24px;"
            ${S.selectedCategories.length ? "" : "disabled"}>
      See Services &rarr;
    </button>`;
}

// ── Step 3: Services (single select + qty) ────────────────────────────────────
function renderServices() {
  const allTypes = (S.config?.jobTypes || []).filter(j =>
    j.segment === S.segment && S.selectedCategories.includes(j.category)
  );

  if (!allTypes.length) return `
    <button class="q-back" onclick="back()">&#8592; Back</button>
    <div class="q-center">
      <div class="q-icon">&#128295;</div>
      <h2 class="q-heading">No Services Found</h2>
      <p class="q-muted">No services available for the selected categories. Call us at
        <a href="tel:+14095550100" style="color:hsl(var(--accent));">(409) 555-0100</a>.</p>
    </div>`;

  // Group by category
  const grouped = {};
  for (const t of allTypes) {
    if (!grouped[t.category]) grouped[t.category] = [];
    grouped[t.category].push(t);
  }

  return `
    <button class="q-back" onclick="back()">&#8592; Back</button>
    <h2 class="q-heading">Which service do you need?</h2>
    ${Object.entries(grouped).map(([cat, types]) => `
      <div class="q-section-label">${escHtml(cat)}</div>
      <div class="q-tiles">
        ${types.map(t => `
          <button class="q-tile${S.typeId === t.job_type_id ? " selected" : ""}"
                  data-type="${escHtml(t.job_type_id)}">
            <div class="q-tile-name">${escHtml(t.name_public)}</div>
            ${t.min_price ? `<div class="q-tile-sub">From $${Number(t.min_price).toLocaleString()}</div>` : ""}
          </button>`).join("")}
      </div>`).join("")}

    <div class="q-qty-wrap" id="qtyWrap" ${S.typeId ? "" : 'style="display:none;"'}>
      <div class="q-qty-label">How many?</div>
      <div class="q-qty-ctrl">
        <button class="q-qty-btn" id="qtyDec">&#8722;</button>
        <span class="q-qty-val" id="qtyVal">${S.qty}</span>
        <button class="q-qty-btn" id="qtyInc">&#43;</button>
      </div>
    </div>

    <button class="q-btn-primary" id="nextService" style="margin-top:20px;" ${S.typeId ? "" : "disabled"}>
      Continue &rarr;
    </button>`;
}

// ── Step 4: Questions + Add-ons ───────────────────────────────────────────────
function renderQuestions() {
  const questions = S.config?.questionsByType?.[S.typeId] || [];
  const addons    = S.config?.addonsByType?.[S.typeId]   || [];

  return `
    <button class="q-back" onclick="back()">&#8592; Back</button>
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

// ── Step 5: Review — price + slot picker (no lead info yet) ───────────────────
function renderReview() {
  const price    = S.displayPrice;
  const bnpl     = price && price >= 200 ? Math.ceil(price / 12) : null;
  const jobType  = (S.config?.jobTypes || []).find(j => j.job_type_id === S.typeId);
  const label    = jobType?.name_public || "";

  return `
    <button class="q-back" onclick="back()">&#8592; Back</button>
    <h2 class="q-heading">Your Instant Price</h2>

    <div class="q-price-reveal">
      <div class="q-price-label">Estimated Total</div>
      <div class="q-price-big">$${price != null ? Number(price).toLocaleString() : "&mdash;"}</div>
      <p class="q-price-sub">${S.qty > 1 ? `${S.qty}&times; ` : ""}${escHtml(label)}</p>
      <div class="q-disclaimer">
        &#128205; A $25 travel fee may be applied once your address is confirmed.
      </div>
      ${S.pricing?.evaluation_flag ? `
        <div class="q-disclaimer warn">
          &#9888;&#65039; This job may need an in-person evaluation first. We'll confirm with you.
        </div>` : ""}
      ${bnpl ? `<div class="q-bnpl">As low as <strong>$${bnpl}/mo</strong> with flexible payment options.</div>` : ""}
    </div>

    <div class="q-review-slots-section">
      <h3 class="q-review-slots-heading">&#128197; Choose a Time</h3>
      <p class="q-muted" style="margin-bottom:16px;">Browse available times. Your spot is reserved when you confirm.</p>
      <div id="reviewSlotSection">${loadingHTML("Finding available times\u2026")}</div>
    </div>

    <div style="margin-top:28px;">
      <button class="q-btn-primary" id="goConfirmBtn" ${S.selectedSlot ? "" : "disabled"}>
        Confirm Booking &rarr;
      </button>
      <p class="q-muted" style="font-size:12px;text-align:center;margin-top:10px;">
        Select a time above to continue
      </p>
    </div>`;
}

// ── Step 6: Confirm — lead form (slot + price shown above form) ────────────────
function renderConfirm() {
  const price  = S.displayPrice;
  const tz     = S.slotsData?.timezone || "America/Chicago";
  const slotDt = S.selectedSlot ? new Date(S.selectedSlot) : null;
  const slotDate = slotDt
    ? new Intl.DateTimeFormat("en-US", { timeZone: tz, weekday: "short", month: "long", day: "numeric" }).format(slotDt)
    : "";
  const slotTime = slotDt
    ? new Intl.DateTimeFormat("en-US", { timeZone: tz, hour: "numeric", minute: "2-digit", hour12: true }).format(slotDt)
    : "";

  return `
    <button class="q-back" onclick="back()">&#8592; Back</button>
    <h2 class="q-heading">Almost there!</h2>

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
            <span class="q-confirm-note">&mdash; travel fee applied with your address</span>
          </div>
        </div>
      </div>
    </div>

    <div class="q-form" style="margin-top:24px;">
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
        Confirm &amp; Book &rarr;
      </button>
      <p class="q-muted" style="font-size:12px;text-align:center;margin-top:10px;">
        Secure booking &bull; No payment due now
      </p>
    </div>`;
}

// ── Step 7: Photo gate ────────────────────────────────────────────────────────
function renderPhoto() {
  return `
    <h2 class="q-heading">One Quick Step</h2>
    <p class="q-muted" style="margin-bottom:24px;">
      Please upload a photo of your electrical panel so we can confirm compatibility before finalizing your booking.
    </p>
    <div class="q-photo-gate">
      <div class="q-photo-header">&#128247; Upload a Panel Photo</div>
      <p class="q-muted" style="margin:8px 0 16px;">JPG, PNG or HEIC &bull; Max 10 MB</p>
      <label class="q-file-label">
        Choose Photo
        <input type="file" id="photoFile" accept="image/*" style="display:none;">
      </label>
      <div id="photoPreview" class="q-photo-preview" style="display:none;"></div>
      <button class="q-btn-secondary" id="uploadPhotoBtn" style="display:none;margin-top:12px;">
        Upload Photo
      </button>
      <div id="photoStatus" class="q-photo-status"></div>
    </div>
    <button class="q-btn-primary" id="finalizeBtn" style="display:none;margin-top:20px;">
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
  const displayPrice = S.lockedDisplayPrice ?? bk?.final_price;

  return `
    <div class="q-booked">
      <div class="q-booked-icon">&#127881;</div>
      <h2 class="q-heading">You're Booked!</h2>
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
          <span class="q-booking-key">&#129534; Booking ID</span>
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
  // Segment — click advances immediately
  document.querySelectorAll(".q-seg-card").forEach(btn => {
    btn.addEventListener("click", () => {
      S.segment            = btn.dataset.seg;
      S.selectedCategories = [];
      S.typeId             = null;
      S.qty                = 1;
      S.answers            = {};
      S.addons             = [];
      go("categories");
    });
  });

  // Category — multi-select toggle
  document.querySelectorAll(".q-cat-card.q-checkable").forEach(btn => {
    btn.addEventListener("click", () => {
      const cat = btn.dataset.cat;
      const idx = S.selectedCategories.indexOf(cat);
      if (idx >= 0) S.selectedCategories.splice(idx, 1);
      else S.selectedCategories.push(cat);
      const sel = S.selectedCategories.includes(cat);
      btn.classList.toggle("selected", sel);
      const badge = btn.querySelector(".q-check-badge");
      if (badge) badge.innerHTML = sel ? "&#10003;" : "";
      const nextBtn = document.getElementById("nextCategories");
      if (nextBtn) nextBtn.disabled = !S.selectedCategories.length;
    });
  });

  document.getElementById("nextCategories")?.addEventListener("click", () => {
    if (!S.selectedCategories.length) return;
    S.typeId  = null;
    S.qty     = 1;
    S.answers = {};
    S.addons  = [];
    go("services");
  });

  // Service tiles — single select
  document.querySelectorAll(".q-tile").forEach(btn => {
    btn.addEventListener("click", () => {
      S.typeId  = btn.dataset.type;
      S.answers = {};
      S.addons  = [];
      document.querySelectorAll(".q-tile").forEach(b => b.classList.remove("selected"));
      btn.classList.add("selected");
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

  // Review: slot selection (delegated via bindSlotEvents after async load)
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

// ── API: Calculate price (& start session) ─────────────────────────────────────
async function calcPrice() {
  go("review");
  document.getElementById("stepContent").innerHTML = loadingHTML("Calculating your price\u2026");

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

    // qty-adjusted display price (travel fee not yet included)
    S.displayPrice = S.pricing.final_price != null ? S.pricing.final_price * S.qty : null;
    S.selectedSlot = null;

    go("review");
  } catch (e) {
    document.getElementById("stepContent").innerHTML = errHTML("Could not calculate price: " + e.message);
  }
}

// ── Load slots into the review screen ─────────────────────────────────────────
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
    section.innerHTML = `<div class="q-error-box">Could not load times: ${escHtml(e.message)}</div>`;
  }
}

function renderSlotGrid(slots, timezone) {
  if (!slots || !slots.length) {
    return `<div class="q-error-box">No available slots right now. We'll call you within one business day to schedule.</div>`;
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
      const hint = document.querySelector(".q-muted[style*='Select a time']");
      if (hint) hint.style.display = "none";
    });
  });
}

// ── ZIP reprice on confirm step ────────────────────────────────────────────────
async function reprice(zip) {
  const noteEl   = document.getElementById("zipNote");
  const updateEl = document.getElementById("priceUpdate");
  if (!noteEl || !updateEl) return;
  noteEl.style.display   = "block";
  noteEl.textContent     = "Checking travel fee\u2026";
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
      // qty-adjusted: base × qty + flat travel fee
      const baseUnit = data.final_price - (data.travel_fee || 0);
      const adjTotal = baseUnit * S.qty + (data.travel_fee || 0);
      const delta    = data.travel_fee > 0
        ? ` (includes $${data.travel_fee} travel fee)`
        : " (no travel fee for this area)";
      updateEl.innerHTML = `Updated price: <strong>$${Number(adjTotal).toLocaleString()}</strong>${escHtml(delta)}`;
      S.lock = { ...data, lockedDisplayPrice: adjTotal };
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
      body: JSON.stringify({ quote_id: S.quoteId, job_type_id: S.typeId, answers: S.answers, addons: S.addons, name, phone, email, address, zip }),
    });
    const data = await r.json();
    if (!data.ok) throw new Error(data.error || "Lock failed.");

    // qty-adjusted locked price
    const baseUnit          = data.final_price - (data.travel_fee || 0);
    S.lockedDisplayPrice    = baseUnit * S.qty + (data.travel_fee || 0);
    S.lock                  = { ...data, lockedDisplayPrice: S.lockedDisplayPrice };

    if (data.photo_required && !S.photoUploaded) {
      go("photo");
    } else {
      await submitBooking();
    }
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
  reader.onload   = ev => {
    if (preview) {
      preview.innerHTML     = `<img src="${ev.target.result}" alt="Preview"
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
    const lockData     = S.lock || S.pricing;
    const displayPrice = S.lockedDisplayPrice ?? lockData?.final_price;
    const r = await fetch("/api/schedule/book", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        quote_id:           S.quoteId,
        scheduled_datetime: S.selectedSlot,
        address:            lockData?.address || "",
        customer_name:      lockData?.customer_name || "",
        final_price:        displayPrice,
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

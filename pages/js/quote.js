// pages/js/quote.js — V3 Quote Flow v3 (reference design)
// Type → Categories → Services + Qty → Details → Review (Price + Slots) → Confirm → [Photo] → Booked

// ── State ─────────────────────────────────────────────────────────────────────
const S = {
  step: "segment",
  segment: null,
  selectedCategories: [],   // string[]  — multi-select
  config: null,
  quoteId: null,
  selectedServices: [],     // [{job_type_id, qty}] — multi-select services
  answers: {},              // answers for primary service questions
  uncertain: {},            // module_id → true for "not sure" answers
  photos: {},               // module_id → File[]
  addons: [],
  pricing: null,            // {final_price, services:[]} — summed across all services
  lock: null,               // server lock response
  photoUploaded: false,
  slotsData: null,
  selectedSlot: null,   // ISO string — start of selected block (or exact slot for legacy)
  selectedBlock: null,  // { date, block, start_iso, window_label, display } | null
  booking: null,
};

// ── Helpers for primary service ────────────────────────────────────────────────
function primaryTypeId() { return S.selectedServices[0]?.job_type_id || null; }
function primaryQty()    { return S.selectedServices[0]?.qty || 1; }

let repricTimer = null;

// ── Boot ──────────────────────────────────────────────────────────────────────
async function boot() {
  setContent(loadingHTML("Loading\u2026"));
  try {
    const [r1, r2] = await Promise.all([
      fetch("/api/quote/config"),
      fetch("/api/estimator/config?_=" + Date.now()),
    ]);
    S.config = await r1.json();
    const est = await r2.json();
    enrichConfigWithModules(S.config, est);
    go("segment");
  } catch (e) {
    setContent(errHTML("Could not load services. Please refresh. (" + e.message + ")"));
  }
}

// ── Enrich config: replace static questions with dynamic module-based questions ─

// Normalize a service name for fuzzy matching
function _normName(s) {
  return (s || "")
    .replace(/\(.*?\)/g, "")              // strip parentheticals "(for kitchens"
    .replace(/[\/&–—\-]/g, " ")           // separators → space
    .replace(/\s+/g, " ")
    .toLowerCase()
    .trim();
}

// Return a set of significant words from a name
function _wordSet(s) {
  const STOP = new Set(["for", "the", "and", "with", "etc", "e.g", "new", "all"]);
  return new Set(_normName(s).split(/\s+/).filter(w => w.length > 2 && !STOP.has(w)));
}

// 0–1 similarity between two names (word overlap + partial-word credit)
function _nameSim(a, b) {
  const na = _normName(a), nb = _normName(b);
  if (na === nb) return 1;
  const wa = _wordSet(a), wb = _wordSet(b);
  if (!wa.size || !wb.size) return 0;
  let score = 0;
  for (const w of wa) {
    if (wb.has(w)) { score += 1; continue; }
    // partial: covers "subpanel"↔"sub panel", "ev"↔"electric vehicle", etc.
    for (const bw of wb) {
      if (bw.startsWith(w) || w.startsWith(bw)) { score += 0.6; break; }
    }
  }
  return score / Math.max(wa.size, wb.size);
}

function enrichConfigWithModules(config, est) {
  if (!est?.services || !est?.modules) return;
  const modMap = est.modules;
  config.questionsByType   = config.questionsByType   || {};
  config.optionsByQuestion = config.optionsByQuestion || {};

  for (const jt of (config.jobTypes || [])) {
    // Find the best-matching estimator service
    let best = null, bestSim = 0;
    for (const svc of est.services) {
      const sim = _nameSim(jt.name_public, svc.service_name);
      if (sim > bestSim) { bestSim = sim; best = svc; }
    }
    if (!best || bestSim < 0.52 || !best.modules?.length) continue;

    const questions = [];
    for (const mid of best.modules) {
      if (mid === "UNCERTAINTY_BUFFER") continue;
      const m = modMap[mid];
      if (!m) continue;
      questions.push({
        question_id: m.module_id,
        prompt:      m.question,
        input_type:  m.input_type,
        required:    m.input_type !== "photo",
      });
      if (m.options?.length) {
        config.optionsByQuestion[m.module_id] = m.options.map(o => ({
          option_id:    o.value,
          label:        o.label,
          disqualify:   !!o.disqualify,
          uncertain:    !!o.uncertain,
          effect_type:  o.multiplier != null ? "MULTIPLY_HOURS" : null,
          effect_value: o.multiplier != null ? Number(o.multiplier) : 1.0,
          multiplier:   o.multiplier || 1.0,
        }));
      }
    }
    config.questionsByType[jt.job_type_id] = questions;
    jt._tier = best.tier;
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
    const pid       = primaryTypeId();
    const hasQs     = (S.config?.questionsByType?.[pid]?.length || 0) > 0;
    const hasAddons = (S.config?.addonsByType?.[pid]?.length   || 0) > 0;
    go(hasQs || hasAddons ? "questions" : "services");
    return;
  }
  const prev = {
    categories: "segment",
    services:   "categories",
    questions:  "services",
    sitevisit:  "questions",
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
    case "sitevisit":  clone.innerHTML = renderSiteVisit();  break;
    case "review":
      clone.innerHTML = renderReview();
      loadBlocksForReview();
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
    services: 2, questions: 2, sitevisit: 2,
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
        const existing = S.selectedServices.find(s => s.job_type_id === t.job_type_id);
        const sel = !!existing;
        const tid = escHtml(t.job_type_id);
        const qty = existing?.qty || 1;
        return `
          <div class="q-svc-card${sel ? " selected" : ""}" data-type="${tid}">
            <div class="q-svc-item">
              <div class="q-svc-checkbox">${sel ? "&#10003;" : ""}</div>
              <div>
                <div class="q-svc-name">${escHtml(t.name_public)}</div>
              </div>
            </div>
            <div class="q-svc-qty-row" ${sel ? "" : 'style="display:none;"'}>
              <span class="q-qty-label">How many?</span>
              <div class="q-qty-ctrl">
                <button class="q-qty-btn q-qty-dec" data-type="${tid}">&#8722;</button>
                <span class="q-qty-val" id="qtyVal_${tid}">${qty}</span>
                <button class="q-qty-btn q-qty-inc" data-type="${tid}">&#43;</button>
              </div>
            </div>
          </div>`;
      }).join("")}
    </div>`).join("");

  return `
    ${stepHeader(3, "Select Specific Services")}
    ${listHTML}
    <div class="q-nav-row">
      <button class="q-btn-back" onclick="back()">&#8592; Back</button>
      <button class="q-btn-next" id="nextService" ${S.selectedServices.length ? "" : "disabled"}>
        Next Step &rarr;
      </button>
    </div>
    ${NOTE}`;
}

// ── Step 4: Questions + Add-ons ───────────────────────────────────────────────
function renderQuestions() {
  const pid       = primaryTypeId();
  const questions = S.config?.questionsByType?.[pid] || [];
  const addons    = S.config?.addonsByType?.[pid]   || [];

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
  const options  = S.config?.optionsByQuestion?.[q.question_id] || [];
  // yesno with no options → synthesize Yes / No choices
  const itype = q.input_type || "single_select";
  const effectiveOptions = (itype === "yesno" && !options.length)
    ? [{ option_id: "yes", label: "Yes" }, { option_id: "no", label: "No" }]
    : options;

  if (itype === "photo") {
    const photoList = S.photos[q.question_id] || [];
    const label = photoList.length
      ? `&#128247; ${photoList.length} photo${photoList.length !== 1 ? "s" : ""} added`
      : "&#128247; Add Photos (Optional)";
    return `
      <div class="q-question" data-qid="${q.question_id}">
        <div class="q-question-prompt">${escHtml(q.prompt)}</div>
        <label class="q-file-label" style="margin-top:8px;">
          ${label}
          <input type="file" class="q-photo-inline" data-qid="${escHtml(q.question_id)}"
            accept="image/*" multiple style="display:none;">
        </label>
        <p class="q-muted" style="font-size:12px;margin:6px 0 0;">
          Optional &mdash; photos help confirm the estimate
        </p>
      </div>`;
  }

  if (itype === "number") {
    const cur = Number(S.answers[q.question_id] || 1);
    return `
      <div class="q-question" data-qid="${q.question_id}">
        <div class="q-question-prompt">${escHtml(q.prompt)}${q.required ? " <span class='q-req'>*</span>" : ""}</div>
        <div class="q-qty-wrap" style="display:flex;align-items:center;gap:10px;margin-top:8px;">
          <div class="q-qty-ctrl">
            <button class="q-qty-btn q-num-dec" data-qid="${escHtml(q.question_id)}"
              ${cur <= 1 ? "disabled" : ""}>&#8722;</button>
            <span class="q-qty-val" id="numVal_${escHtml(q.question_id)}">${cur}</span>
            <button class="q-qty-btn q-num-inc" data-qid="${escHtml(q.question_id)}"
              ${cur >= 20 ? "disabled" : ""}>&#43;</button>
          </div>
        </div>
      </div>`;
  }

  return `
    <div class="q-question" data-qid="${q.question_id}">
      <div class="q-question-prompt">${escHtml(q.prompt)}${q.required ? " <span class='q-req'>*</span>" : ""}</div>
      ${effectiveOptions.length ? `
        <div class="q-options">
          ${effectiveOptions.map(o => `
            <label class="q-option${S.answers[q.question_id] === o.option_id ? " selected" : ""}"
              data-dis="${o.disqualify ? "1" : ""}" data-unc="${o.uncertain ? "1" : ""}">
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
  const price  = S.pricing?.final_price ?? null;
  const bnpl   = price && price >= 200 ? Math.ceil(price / 12) : null;

  // Build a label from all selected services
  const svcLabel = S.selectedServices.map(svc => {
    const jt = (S.config?.jobTypes || []).find(j => j.job_type_id === svc.job_type_id);
    return svc.qty > 1 ? `${svc.qty}× ${jt?.name_public || svc.job_type_id}` : (jt?.name_public || svc.job_type_id);
  }).join(", ");

  const slotLabel = S.selectedBlock
    ? `${escHtml(S.selectedBlock.display)} &bull; ${escHtml(S.selectedBlock.window_label)}`
    : null;

  return `
    ${stepHeader(4, "Final Review &amp; Scheduling")}

    <div class="q-price-footer">
      <div class="q-price-footer-label">
        Final Estimated Cost${svcLabel ? ` &mdash; ${escHtml(svcLabel)}` : ""}
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

    <div class="q-review-slots-section">
      <div class="q-review-slots-heading">&#128197; Choose a Service Window</div>
      <p class="q-muted" style="font-size:13px;margin:-4px 0 12px;">
        Pick a morning or afternoon block. Our crew will arrive within that window.
      </p>
      <div id="reviewSlotSection">${loadingHTML("Loading available windows\u2026")}</div>
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
  const price       = S.lock?.final_price ?? S.pricing?.final_price ?? null;
  const blockDisplay = S.selectedBlock?.display      || "";
  const blockWindow  = S.selectedBlock?.window_label || "";

  return `
    ${stepHeader(5, "Your Information")}
    <div class="q-confirm-summary">
      <div class="q-confirm-row">
        <span class="q-confirm-icon">&#128197;</span>
        <div>
          <div class="q-confirm-key">Appointment Window</div>
          <div class="q-confirm-val">${escHtml(blockDisplay)}${blockWindow ? ` &bull; Arrival ${escHtml(blockWindow)}` : ""}</div>
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
  const bk          = S.booking;
  const displayPrice = S.lock?.final_price ?? bk?.final_price;

  // Block info from booking response (preferred) or from the selection state
  const blockLabel  = bk?.schedule_block  || S.selectedBlock?.block  || "";
  const windowLabel = bk?.window_label    || S.selectedBlock?.window_label || "";
  const dayDisplay  = S.selectedBlock?.display || blockLabel;

  // For the date, format from scheduled_datetime
  const tz = "America/Chicago";
  const dt = bk?.scheduled_datetime ? new Date(bk.scheduled_datetime) : null;
  const dateStr = dt
    ? new Intl.DateTimeFormat("en-US", { timeZone: tz, weekday: "long", month: "long", day: "numeric", year: "numeric" }).format(dt)
    : dayDisplay;

  const windowDisplay = windowLabel ? `Arrival window: ${windowLabel} (Central)` : "";

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
          <span class="q-booking-key">&#128336; Window</span>
          <span class="q-booking-val">${escHtml(windowDisplay || blockLabel)}</span>
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

// ── Step: Site Visit Required ─────────────────────────────────────────────────
function renderSiteVisit() {
  return `
    ${stepHeader(3, "Site Visit Required")}
    <div class="q-card-section" style="text-align:center;padding:32px 20px;">
      <div style="font-size:52px;margin-bottom:16px;">&#128203;</div>
      <h3 style="font-family:var(--font-display);font-size:20px;font-weight:800;margin-bottom:12px;letter-spacing:-0.01em;">
        An On-Site Estimate is Needed
      </h3>
      <p class="q-muted" style="max-width:400px;margin:0 auto 20px;">
        Based on your answers, this project requires an in-person evaluation before we can give you an accurate price. Don't worry &mdash; the consultation is free!
      </p>
      <a href="tel:+14095550100"
        style="display:inline-flex;align-items:center;gap:8px;padding:14px 32px;background:hsl(var(--primary));color:white;border-radius:50px;font-size:16px;font-weight:700;text-decoration:none;margin-bottom:12px;">
        &#128222; Call (409) 555-0100
      </a>
      <p class="q-muted" style="font-size:13px;">We'll schedule your free consultation right away.</p>
    </div>
    <div class="q-nav-row">
      <button class="q-btn-back" onclick="back()">&#8592; Back to Questions</button>
      <div></div>
    </div>
    ${NOTE}`;
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
    S.selectedServices = []; S.answers = {}; S.addons = [];
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
    S.selectedServices = []; S.answers = {}; S.addons = [];
    go("services");
  });

  // Service cards — multi-select toggle with individual inline qty
  document.querySelectorAll(".q-svc-card").forEach(card => {
    card.querySelector(".q-svc-item")?.addEventListener("click", () => {
      const typeId  = card.dataset.type;
      const qtyRow  = card.querySelector(".q-svc-qty-row");
      const cbEl    = card.querySelector(".q-svc-checkbox");
      const idx     = S.selectedServices.findIndex(s => s.job_type_id === typeId);

      if (idx >= 0) {
        // Deselect this service
        S.selectedServices.splice(idx, 1);
        card.classList.remove("selected");
        if (cbEl)   cbEl.innerHTML = "";
        if (qtyRow) qtyRow.style.display = "none";
      } else {
        // Select this service (add to list, keep others)
        S.selectedServices.push({ job_type_id: typeId, qty: 1 });
        card.classList.add("selected");
        if (cbEl)   cbEl.innerHTML = "&#10003;";
        if (qtyRow) qtyRow.style.display = "";
        const valEl = document.getElementById("qtyVal_" + typeId);
        if (valEl)  valEl.textContent = 1;
      }
      document.getElementById("nextService")?.toggleAttribute("disabled", S.selectedServices.length === 0);
    });
  });

  // Inline qty dec/inc buttons (stop propagation so they don't toggle the card)
  document.querySelectorAll(".q-qty-dec").forEach(btn => {
    btn.addEventListener("click", e => {
      e.stopPropagation();
      const typeId = btn.dataset.type;
      const svc    = S.selectedServices.find(s => s.job_type_id === typeId);
      if (svc) { svc.qty = Math.max(1, svc.qty - 1); }
      const valEl = document.getElementById("qtyVal_" + typeId);
      if (valEl) valEl.textContent = svc?.qty ?? 1;
    });
  });
  document.querySelectorAll(".q-qty-inc").forEach(btn => {
    btn.addEventListener("click", e => {
      e.stopPropagation();
      const typeId = btn.dataset.type;
      const svc    = S.selectedServices.find(s => s.job_type_id === typeId);
      if (svc) { svc.qty = Math.min(20, svc.qty + 1); }
      const valEl = document.getElementById("qtyVal_" + typeId);
      if (valEl) valEl.textContent = svc?.qty ?? 1;
    });
  });

  document.getElementById("nextService")?.addEventListener("click", () => {
    if (!S.selectedServices.length) return;
    const pid       = primaryTypeId();
    const hasQs     = (S.config?.questionsByType?.[pid]?.length || 0) > 0;
    const hasAddons = (S.config?.addonsByType?.[pid]?.length   || 0) > 0;
    if (hasQs || hasAddons) go("questions");
    else calcPrice();
  });

  // Questions — radio (with disqualify gate + uncertain tracking)
  document.querySelectorAll("input[type=radio]").forEach(radio => {
    radio.addEventListener("change", () => {
      const qid   = radio.name.replace("q_", "");
      const label = radio.closest("label[data-dis]");
      S.answers[qid] = radio.value;

      if (label?.dataset.unc === "1") {
        S.uncertain[qid] = true;
      } else {
        delete S.uncertain[qid];
      }

      if (label?.dataset.dis === "1") {
        go("sitevisit");
        return;
      }
      radio.closest(".q-options")?.querySelectorAll(".q-option")
        .forEach(l => l.classList.toggle("selected", l.querySelector("input") === radio));
    });
  });

  // Questions — number steppers
  document.querySelectorAll(".q-num-dec").forEach(btn => {
    btn.addEventListener("click", () => {
      const qid = btn.dataset.qid;
      const cur = Number(S.answers[qid] || 1);
      const nv  = Math.max(1, cur - 1);
      S.answers[qid] = nv;
      const el = document.getElementById("numVal_" + qid);
      if (el) el.textContent = nv;
      btn.disabled = nv <= 1;
      btn.nextElementSibling?.nextElementSibling?.removeAttribute("disabled");
    });
  });
  document.querySelectorAll(".q-num-inc").forEach(btn => {
    btn.addEventListener("click", () => {
      const qid = btn.dataset.qid;
      const cur = Number(S.answers[qid] || 1);
      const nv  = Math.min(20, cur + 1);
      S.answers[qid] = nv;
      const el = document.getElementById("numVal_" + qid);
      if (el) el.textContent = nv;
      btn.disabled = nv >= 20;
      btn.previousElementSibling?.previousElementSibling?.removeAttribute("disabled");
    });
  });

  // Questions — inline photo pickers
  document.querySelectorAll(".q-photo-inline").forEach(inp => {
    inp.addEventListener("change", () => {
      const qid = inp.dataset.qid;
      if (!S.photos[qid]) S.photos[qid] = [];
      Array.from(inp.files).forEach(f => S.photos[qid].push(f));
      const lbl = inp.closest("label.q-file-label");
      if (lbl) {
        const count = S.photos[qid].length;
        lbl.childNodes[0].textContent =
          "\uD83D\uDCF7 " + count + " photo" + (count !== 1 ? "s" : "") + " added";
      }
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

    // Calc price for each selected service, then sum
    const results = await Promise.all(S.selectedServices.map(svc =>
      fetch("/api/quote/calc", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          quote_id: S.quoteId,
          job_type_id: svc.job_type_id,
          answers: S.answers,
          addons: S.addons,
          qty: svc.qty,
        }),
      }).then(r => r.json())
    ));

    for (const res of results) {
      if (!res.ok && res.error) throw new Error(res.error);
    }

    const totalPrice = results.reduce((sum, r) => sum + (r.final_price || 0), 0);
    S.pricing = { ok: true, final_price: totalPrice, services: results, evaluation_flag: results.some(r => r.evaluation_flag) };
    S.selectedSlot  = null;
    S.selectedBlock = null;
    go("review");
  } catch (e) {
    document.getElementById("stepContent").innerHTML = errHTML("Could not calculate price: " + e.message);
  }
}

// ── Load blocks for review screen ──────────────────────────────────────────────
async function loadBlocksForReview() {
  const section = document.getElementById("reviewSlotSection");
  if (!section) return;
  try {
    const r = await fetch("/api/schedule/blocks?days=14");
    const d = await r.json();
    if (!d.ok) throw new Error(d.error || "Could not load windows.");
    S.slotsData = d;   // keep for timezone reference
    renderBlockPicker(d.blocks || []);
  } catch (e) {
    section.innerHTML = `<div class="q-error-box" style="margin-top:12px;">Could not load windows: ${escHtml(e.message)}</div>`;
  }
}

// ── Block picker — render ──────────────────────────────────────────────────────
// Groups blocks by date and renders a card list with Morning / Afternoon buttons.
function renderBlockPicker(blocks) {
  const section = document.getElementById("reviewSlotSection");
  if (!section) return;

  const available = blocks.filter(b => b.available);
  if (!available.length) {
    section.innerHTML = `<div class="q-error-box" style="margin-top:8px;">No available windows right now. Please call us at (409) 555-0100 to schedule.</div>`;
    return;
  }

  // Group by date
  const byDate = {};
  for (const b of available) {
    if (!byDate[b.date]) byDate[b.date] = { day_label: b.day_label, date: b.date, blocks: [] };
    byDate[b.date].blocks.push(b);
  }

  // Selected summary bar
  const selSummary = S.selectedBlock
    ? `<div class="q-selected-summary" style="margin-bottom:12px;">
        &#10003;&nbsp; ${escHtml(S.selectedBlock.display)} &bull; Arrival ${escHtml(S.selectedBlock.window_label)}
      </div>`
    : "";

  const dayCards = Object.values(byDate).slice(0, 14).map(day => {
    const dayFmt = new Intl.DateTimeFormat("en-US", {
      weekday: "long", month: "long", day: "numeric",
    }).format(new Date(day.date + "T12:00:00"));

    const blockBtns = day.blocks.map(b => {
      const isSel = S.selectedBlock?.date === b.date && S.selectedBlock?.block === b.block;
      return `<button
        class="q-block-btn${isSel ? " selected" : ""}"
        data-date="${escHtml(b.date)}"
        data-block="${escHtml(b.block)}"
        data-start-iso="${escHtml(b.start_iso)}"
        data-window-label="${escHtml(b.window_label)}"
        data-display="${escHtml(b.display)}">
        <span class="q-block-icon">${b.block === "Morning" ? "&#9728;" : "&#9734;"}</span>
        <span class="q-block-name">${escHtml(b.block)}</span>
        <span class="q-block-window">${escHtml(b.window_label)}</span>
      </button>`;
    }).join("");

    return `<div class="q-block-day">
      <div class="q-block-day-label">${escHtml(dayFmt)}</div>
      <div class="q-block-row">${blockBtns}</div>
    </div>`;
  }).join("");

  section.innerHTML = `
    ${selSummary}
    <div class="q-block-picker">${dayCards}</div>`;

  bindBlockPickerEvents();
}

function bindBlockPickerEvents() {
  document.querySelectorAll(".q-block-btn").forEach(btn => {
    btn.addEventListener("click", () => {
      const blk = {
        date:         btn.dataset.date,
        block:        btn.dataset.block,
        start_iso:    btn.dataset.startIso,
        window_label: btn.dataset.windowLabel,
        display:      btn.dataset.display,
      };
      S.selectedSlot  = blk.start_iso;
      S.selectedBlock = blk;
      document.getElementById("goConfirmBtn")?.removeAttribute("disabled");
      // Re-render to show updated selection
      renderBlockPicker(
        (S.slotsData?.blocks || []).filter(b => b.available)
      );
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
      body: JSON.stringify({ quote_id: S.quoteId, job_type_id: primaryTypeId(), answers: S.answers, addons: S.addons, zip }),
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
      body: JSON.stringify({ quote_id: S.quoteId, job_type_id: primaryTypeId(), answers: S.answers, addons: S.addons, qty: primaryQty(), customer_name: name, name, phone, email, address, zip }),
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
        block:              S.selectedBlock?.block || null,
        date:               S.selectedBlock?.date  || null,
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

// pages/js/instant-estimate.js — Instant Estimate Wizard (v2026-03-04)
"use strict";

// ── State ─────────────────────────────────────────────────────────────────────
const S = {
  config: null,       // normalized config from /api/estimator/config
  segment: null,
  service: null,
  qty: 1,
  moduleList: [],     // ordered Module objects for selected service
  idx: 0,
  answers: {},        // { module_id: answer_value }
  photos: {},         // { module_id: [File,...] }
};

// ── Helpers ───────────────────────────────────────────────────────────────────
const $   = id => document.getElementById(id);
const esc = s  => String(s||"").replace(/[&<>"']/g, c =>
  ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":'&#39;'}[c]));

function setProgress(n) {
  ["ps1","ps2","ps3","ps4"].forEach((id,i) => {
    const el = $(id); if(!el) return;
    el.className = "progress-step" + (i+1 < n ? " done" : i+1 === n ? " active" : "");
  });
}

function show(html) { $("stepContent").innerHTML = html; }

function statusMsg(msg, isErr) {
  show(`<div class="status-msg${isErr?" error-msg":""}">${esc(msg)}</div>`);
}

function reset() {
  Object.assign(S, { segment:null, service:null, qty:1, moduleList:[], idx:0, answers:{}, photos:{} });
}

// ── Config normalization (defensive — handles both shapes) ────────────────────
function normalize(d) {
  // modules: accept `d.modules` or `d.modulesById`
  const modules = d.modules || d.modulesById || {};
  // Ensure every module's options is an array
  for (const [mid, mod] of Object.entries(modules)) {
    if (!mod) continue;
    if (!Array.isArray(mod.options)) {
      try { mod.options = JSON.parse(mod.options_json || "[]"); } catch { mod.options = []; }
    }
    mod.module_id = mod.module_id || mid;
  }
  // services: ensure .modules array (pre-split); accept .modules or .modules_csv
  const services = (d.services || []).map(s => ({
    ...s,
    modules: Array.isArray(s.modules)
      ? s.modules
      : (s.modules_csv || s.modulesCsv || "").split(",").map(m => m.trim()).filter(Boolean),
    enabled: String(s.enabled ?? "true").toUpperCase() !== "FALSE",
  }));
  return { modules, services, updatedAt: d.updatedAt };
}

// ── Debug accordion ───────────────────────────────────────────────────────────
function renderDebug() {
  const cfg = S.config;
  const svcCount = cfg?.services?.length ?? 0;
  const modCount = Object.keys(cfg?.modules ?? {}).length;
  const selMods  = S.service?.modules ?? [];
  return `
  <details class="debug-box" style="margin-top:28px">
    <summary class="debug-toggle">🔧 Debug info</summary>
    <div class="debug-body">
      <div class="debug-row"><span>Config loaded</span><span>${esc(cfg?.updatedAt ?? "—")}</span></div>
      <div class="debug-row"><span>Services</span><span>${svcCount}</span></div>
      <div class="debug-row"><span>Modules</span><span>${modCount}</span></div>
      <div class="debug-row"><span>Selected service</span><span>${esc(S.service?.service_id ?? "—")}</span></div>
      <div class="debug-row"><span>Selected modules</span><span>${selMods.length ? esc(selMods.join(", ")) : "—"}</span></div>
      <div class="debug-row"><span>Uncertain answers</span><span>${Object.keys(S.uncertain||{}).join(", ")||"none"}</span></div>
      <details style="margin-top:8px"><summary style="cursor:pointer;color:var(--muted);font-size:.75rem">Raw config JSON</summary>
        <pre class="debug-pre">${esc(JSON.stringify(cfg, null, 2))}</pre>
      </details>
    </div>
  </details>`;
}

// ── Step 1: Segment ───────────────────────────────────────────────────────────
function renderSegment() {
  setProgress(1);
  show(`
    <div class="seg-grid">
      ${["residential","commercial"].map(seg => `
        <div class="seg-card${S.segment===seg?" picked":""}" data-seg="${seg}">
          <div class="icon">${seg==="residential"?"🏠":"🏢"}</div>
          <div class="label">${seg==="residential"?"Residential":"Commercial"}</div>
          <div class="desc">${seg==="residential"?"Home upgrades, repairs & installations":"Office, retail & industrial solutions"}</div>
        </div>`).join("")}
    </div>
    <div class="actions"><button class="btn btn-primary" id="nextSeg"${S.segment?"":" disabled"}>Next →</button></div>
    ${renderDebug()}`);
  document.querySelectorAll(".seg-card").forEach(c =>
    c.addEventListener("click", () => { S.segment = c.dataset.seg; renderSegment(); }));
  $("nextSeg")?.addEventListener("click", renderService);
}

// ── Step 2: Service ───────────────────────────────────────────────────────────
function renderService() {
  setProgress(2);
  const all  = (S.config.services||[]).filter(sv => sv.segment===S.segment && sv.enabled!==false);
  const TC   = { instant:"tier-instant", instant_with_safeguards:"tier-safeguards", site_visit_required:"tier-site-visit" };
  const TL   = { instant:"Instant", instant_with_safeguards:"Instant Quote", site_visit_required:"Site Visit" };
  const isInstant = s => s.tier !== "site_visit_required";

  // Sort: instant first, site_visit last
  const instant   = all.filter(isInstant);
  const siteVisit = all.filter(s => !isInstant(s));
  const svcs      = [...instant, ...siteVisit];

  if (!svcs.length) {
    show(`<div class="warn-banner">⚠️ No services found for segment "${esc(S.segment)}" in Google Sheets (Estimator_ServiceMatrix).</div>
      <div class="actions"><button class="btn btn-ghost" id="bkSeg">← Back</button></div>${renderDebug()}`);
    $("bkSeg").addEventListener("click", renderSegment);
    return;
  }

  function svcCard(sv) {
    return `<div class="svc-card${S.service?.service_id===sv.service_id?" picked":""}" data-id="${sv.service_id}">
      <span class="svc-name">${esc(sv.service_name)}</span>
      <span class="tier-badge ${TC[sv.tier]||""}">${TL[sv.tier]||sv.tier}</span>
    </div>`;
  }

  const listHtml = [
    instant.length   ? `<div class="svc-section-label">⚡ Instant Quote Available</div>${instant.map(svcCard).join("")}`   : "",
    siteVisit.length ? `<div class="svc-section-label">📋 Requires Site Visit</div>${siteVisit.map(svcCard).join("")}` : "",
  ].join("");

  show(`
    <input class="search-box" id="svcSearch" placeholder="Search services…" autocomplete="off"/>
    <div class="service-list" id="svcList">${listHtml}</div>
    ${S.service?.tier==="site_visit_required"?`<div class="site-visit-notice">⚠️ This service needs an on-site assessment — no instant questions, but we'll call to schedule a free visit.</div>`:""}
    <div class="actions">
      <button class="btn btn-ghost" id="backSeg">← Back</button>
      <button class="btn btn-primary" id="nextSvc"${S.service?"":" disabled"}>Next →</button>
    </div>
    ${renderDebug()}`);

  $("svcSearch").addEventListener("input", function() {
    const q = this.value.toLowerCase();
    document.querySelectorAll(".svc-card").forEach(c => {
      c.style.display = c.querySelector(".svc-name").textContent.toLowerCase().includes(q) ? "" : "none";
    });
    document.querySelectorAll(".svc-section-label").forEach(lbl => {
      const anyVisible = [...lbl.nextElementSibling?.querySelectorAll?.(".svc-card")||[]].some(c=>c.style.display!=="none");
      lbl.style.display = anyVisible ? "" : "none";
    });
  });
  document.querySelectorAll(".svc-card").forEach(c => c.addEventListener("click", () => {
    S.service = svcs.find(sv => sv.service_id===c.dataset.id);
    renderService();
  }));
  $("backSeg").addEventListener("click", renderSegment);
  $("nextSvc")?.addEventListener("click", startModules);
}

// ── Step 3: Modules ───────────────────────────────────────────────────────────
function startModules() {
  const mids = S.service?.modules || [];

  // Check for site_visit shortcut
  if (S.service?.tier === "site_visit_required") {
    S.moduleList = [];
    renderResult(true);
    return;
  }

  // Resolve modules; collect warnings for missing IDs
  const warnings = [];
  S.moduleList = mids.map(mid => {
    const mod = S.config.modules?.[mid];
    if (!mod) { warnings.push(`Config error: module "${mid}" missing in Estimator_Modules.`); return null; }
    return mod;
  }).filter(Boolean);

  if (!mids.length) {
    warnings.push("This service has no modules configured in Google Sheets (modules_csv empty).");
  }

  S.idx = 0; S.answers = {}; S.photos = {};

  if (warnings.length && !S.moduleList.length) {
    // Show warnings and allow proceeding to result anyway
    show(`<div class="warn-banner">${warnings.map(w=>`<div>⚠️ ${esc(w)}</div>`).join("")}</div>
      <div class="actions"><button class="btn btn-ghost" id="bkSvc2">← Back</button>
      <button class="btn btn-primary" id="skipToResult">Get Estimate →</button></div>${renderDebug()}`);
    $("bkSvc2").addEventListener("click", renderService);
    $("skipToResult").addEventListener("click", () => renderResult(false));
    return;
  }

  if (warnings.length) {
    // Non-fatal warnings — show but continue
    $("stepContent").insertAdjacentHTML("afterbegin",
      `<div class="warn-banner">${warnings.map(w=>`<div>⚠️ ${esc(w)}</div>`).join("")}</div>`);
  }

  renderModule();
}

function renderModule() {
  setProgress(3);
  const m = S.moduleList[S.idx];
  if (!m) { renderResult(false); return; }

  const body = m.input_type === "photo"  ? renderPhotoModule(m)
             : m.input_type === "number" ? renderNumberModule(m)
             : renderSelectModule(m);

  show(`
    <div class="module-header">
      <div class="module-progress">${esc(S.service.service_name)} · Question ${S.idx+1} of ${S.moduleList.length}</div>
      <h2 class="module-question">${esc(m.question)}</h2>
    </div>
    <div id="moduleBody">${body}</div>
    <div class="actions" style="justify-content:space-between">
      <button class="btn btn-ghost" id="modBack">${S.idx===0?"← Service":"← Back"}</button>
      <button class="btn btn-primary" id="modNext" disabled>Next →</button>
    </div>
    ${renderDebug()}`);

  bindModuleEvents(m);
}

function renderSelectModule(m) {
  const opts = [...(m.options||[])];
  if (!opts.some(o => /not sure|unknown|unsure/i.test(o.label||"")))
    opts.push({ value:"_unsure", label:"Not sure / skip", multiplier:1.1, uncertain:true });
  return `<div class="option-grid">${opts.map(o =>
    `<button class="option-btn${S.answers[m.module_id]===o.value?" selected":""}"
      data-val="${esc(o.value)}"
      data-dis="${o.disqualify?"1":""}"
      data-unc="${o.uncertain?"1":""}">${esc(o.label)}</button>`
  ).join("")}</div>`;
}

function renderNumberModule(m) {
  const min = S.service.qty_min||1, max = S.service.qty_max||20;
  const cur = S.answers[m.module_id]??S.qty;
  return `<div class="qty-stepper">
    <button class="qty-btn" id="qtyDec"${cur<=min?" disabled":""}>−</button>
    <span class="qty-val" id="qtyVal">${cur}</span>
    <button class="qty-btn" id="qtyInc"${cur>=max?" disabled":""}>+</button>
  </div>`;
}

function renderPhotoModule(m) {
  const stored = S.photos[m.module_id]||[];
  return `<div class="photo-zone">
    <label class="photo-label" for="photoInput">
      📷 Tap to add photos
      <input type="file" id="photoInput" accept="image/*" multiple style="display:none"/>
    </label>
    <div class="thumb-row" id="thumbRow">
      ${stored.map((f,i) =>
        `<div class="thumb-wrap"><img class="thumb" src="${f._url}" alt="${esc(f.name)}"/>
        <button class="thumb-remove" data-idx="${i}">✕</button></div>`
      ).join("")}
    </div>
    <p class="photo-hint">${stored.length ? stored.length+" photo(s) added — or tap Next to continue." : "Optional — adding photos helps us confirm the estimate, but you can skip."}</p>
  </div>`;
}

function bindModuleEvents(m) {
  const nextBtn = $("modNext");
  const check = () => {
    nextBtn.disabled = m.input_type==="number" ? false
                     : m.input_type==="photo"  ? false   // photos are optional — skip allowed
                     : !S.answers[m.module_id];
  };

  // Bug 4 fix: UNCERTAINTY_BUFFER renders as a normal single_select using live
  // sheet options (simple / moderate / complex). No auto-skip.

  if (m.input_type !== "photo" && m.input_type !== "number") {
    document.querySelectorAll(".option-btn").forEach(btn => btn.addEventListener("click", () => {
      // ── Disqualify gate ───────────────────────────────────────────────────
      if (btn.dataset.dis === "1") {
        S.answers[m.module_id] = btn.dataset.val;
        document.querySelectorAll(".option-btn").forEach(b => b.classList.remove("selected"));
        btn.classList.add("selected");
        // Brief visual pause so the user sees their selection before the result renders
        setTimeout(() => renderResult(true), 400);
        return;
      }
      // ── Normal selection ──────────────────────────────────────────────────
      S.answers[m.module_id] = btn.dataset.val;
      if (btn.dataset.unc === "1") {
        if (!S.uncertain) S.uncertain = {};
        S.uncertain[m.module_id] = true;
      } else {
        if (S.uncertain) delete S.uncertain[m.module_id];
      }
      document.querySelectorAll(".option-btn").forEach(b => b.classList.remove("selected"));
      btn.classList.add("selected");
      check();
    }));
  }
  if (m.input_type === "number") {
    const min = S.service.qty_min||1, max = S.service.qty_max||20;
    let cur = S.answers[m.module_id]??S.qty;
    const refresh = () => {
      $("qtyVal").textContent = cur; $("qtyDec").disabled = cur<=min; $("qtyInc").disabled = cur>=max;
      S.answers[m.module_id] = cur; S.qty = cur; check();
    };
    $("qtyDec").addEventListener("click", () => { if(cur>min){cur--;refresh();} });
    $("qtyInc").addEventListener("click", () => { if(cur<max){cur++;refresh();} });
    refresh();
  }
  if (m.input_type === "photo") {
    if (!S.photos[m.module_id]) S.photos[m.module_id] = [];
    $("photoInput").addEventListener("change", async function() {
      for (const f of this.files) { f._url = await readFileURL(f); S.photos[m.module_id].push(f); }
      renderModule();
    });
    document.querySelectorAll(".thumb-remove").forEach(btn => btn.addEventListener("click", () => {
      S.photos[m.module_id].splice(Number(btn.dataset.idx), 1); renderModule();
    }));
  }
  nextBtn.addEventListener("click", () => { S.idx++; renderModule(); });
  $("modBack").addEventListener("click", () => { S.idx===0 ? renderService() : (S.idx--, renderModule()); });
  check();
}

function readFileURL(f) {
  return new Promise(r => { const fr=new FileReader(); fr.onload=e=>r(e.target.result); fr.readAsDataURL(f); });
}

// ── Step 4: Result ────────────────────────────────────────────────────────────
async function renderResult(siteVisitForced) {
  setProgress(4);
  show(`<div class="status-msg">Processing…</div>`);
  const photoCount = Object.values(S.photos).reduce((s,a) => s+a.length, 0);
  const retryBtn   = `<button class="btn btn-ghost" onclick="reset();renderSegment()">← Start Over</button>`;
  const summary    = `<div class="result-summary">
    <div class="rs-row"><span class="rs-lbl">Service</span><span>${esc(S.service.service_name)}</span></div>
    <div class="rs-row"><span class="rs-lbl">Qty</span><span>${S.qty}</span></div>
    <div class="rs-row"><span class="rs-lbl">Photos</span><span>${photoCount} attached</span></div>
    ${Object.entries(S.answers).map(([k,v]) =>
      `<div class="rs-row"><span class="rs-lbl">${esc(k)}</span><span>${esc(v)}</span></div>`
    ).join("")}
  </div>`;

  try {
    const r = await fetch("/api/estimator/quote", {
      method:"POST", headers:{"Content-Type":"application/json"},
      body: JSON.stringify({ segment:S.segment, service_id:S.service.service_id,
        service_name:S.service.service_name, qty:S.qty, answersByModule:S.answers,
        uncertainModules: S.uncertain||{}, photoCount }),
    });
    const d = await r.json();
    const tier = d.tier_result || (siteVisitForced ? "needs_site_visit" : "instant_with_safeguards");

    if (tier === "needs_site_visit") {
      show(`<div class="outcome-card outcome-site-visit">
        <div class="outcome-icon">📋</div><h2>Site Visit Required</h2>
        <p>${esc(d.message||"An on-site assessment is required before we can quote this job.")}</p>
        ${d.reasons?.length ? `<ul class="reason-list">${d.reasons.map(r=>`<li>${esc(r)}</li>`).join("")}</ul>` : ""}
        ${summary}
        <div class="actions" style="justify-content:center">${retryBtn}
          <a class="btn btn-gold" href="/contact">Request Free Site Visit →</a></div>
      </div>${renderDebug()}`); return;
    }
    // Bug 5 fix: needs_photos is no longer a blocking tier — photo_warning is a soft flag.
    const hasPricing   = d.total > 0;
    const contPct      = d.contingency_pct ? Math.round(d.contingency_pct*100) : 0;
    const photoWarn    = d.photo_warning
      ? `<div class="warn-banner" style="margin-bottom:12px;">📷 Adding photos would help us confirm this estimate — our tech may follow up to verify scope.</div>`
      : "";
    const reviewWarn   = d.review_flag
      ? `<div class="warn-banner" style="margin-bottom:12px;">📋 ${esc(d.material_disclosure||"Material costs will be confirmed and added separately at actuals.")}</div>`
      : "";
    show(`<div class="outcome-card outcome-instant">
      <div class="outcome-icon">✅</div><h2>Estimate Ready</h2>
      <p>${esc(d.message||"Your estimate has been generated!")}</p>
      ${photoWarn}${reviewWarn}
      ${hasPricing ? `<div class="price-preview">
        <div class="price-line"><span>Base estimate</span><span>$${d.subtotal?.toLocaleString()||"—"}</span></div>
        ${contPct ? `<div class="price-line muted"><span>Contingency buffer</span><span>+${contPct}%</span></div>` : ""}
        <div class="price-line total-line"><span>Estimated Total</span><span>$${d.total?.toLocaleString()||"—"}</span></div>
        <div style="font-size:.75rem;color:var(--muted);margin-top:8px">Final pricing confirmed at booking. Travel fee may apply.</div>
      </div>` : `<div class="price-preview">Our team will confirm pricing when we reach out to schedule.</div>`}
      ${summary}
      <div style="font-size:.75rem;color:var(--muted);margin-bottom:16px">Reference: ${esc(d.lead_id||"")}</div>
      <div class="actions" style="justify-content:center">${retryBtn}
        <a class="btn btn-primary" href="/contact">Book Appointment →</a></div>
    </div>${renderDebug()}`);
  } catch (e) {
    show(`<div class="status-msg error-msg">Network error: ${esc(e.message)}</div>${renderDebug()}`);
  }
}

// ── Boot ──────────────────────────────────────────────────────────────────────
async function init() {
  try {
    const r = await fetch("/api/estimator/config?_=" + Date.now());
    const d = await r.json();
    if (!d.ok) throw new Error(d.error||"Config load failed");
    S.config = normalize(d);
    if (!S.config.services.length) {
      show(`<div class="warn-banner">⚠️ No services loaded from Google Sheets. Check Estimator_ServiceMatrix tab.</div>
        ${renderDebug()}`);
      return;
    }
    if (!Object.keys(S.config.modules).length) {
      show(`<div class="warn-banner">⚠️ No modules loaded from Google Sheets. Check Estimator_Modules tab.</div>
        ${renderDebug()}`);
      return;
    }
    renderSegment();
  } catch(e) {
    show(`<div class="status-msg error-msg">Could not load estimator config: ${esc(e.message)}</div>
      <div style="text-align:center;margin-top:12px"><a href="/api/estimator/health" target="_blank" style="color:var(--accent);font-size:.85rem">Check health endpoint →</a></div>`);
  }
}
init();

// Quick Add — Universal floating FAB + modal for all CRM & crew pages
// Injected by shell.js on CRM pages; loaded directly on crew.html
(function () {
  if (document.getElementById("ve-qa-modal")) return; // already mounted

  // ── Styles ─────────────────────────────────────────────────────────────────
  var style = document.createElement("style");
  style.textContent = [
    /* FAB — respects iPhone safe area (home bar / notch in landscape) */
    "#ve-qa-fab{position:fixed;bottom:calc(24px + env(safe-area-inset-bottom));right:calc(20px + env(safe-area-inset-right));z-index:900;width:52px;height:52px;border-radius:50%;",
    "background:#2d6ae0;border:none;color:#fff;font-size:26px;line-height:1;cursor:pointer;",
    "box-shadow:0 4px 18px rgba(45,106,224,.55);display:flex;align-items:center;justify-content:center;",
    "transition:transform .15s,box-shadow .15s;font-family:inherit;}",
    "#ve-qa-fab:hover{transform:scale(1.08);box-shadow:0 6px 24px rgba(45,106,224,.7);}",
    "#ve-qa-fab:active{transform:scale(.96);}",
    /* Backdrop */
    "#ve-qa-backdrop{position:fixed;inset:0;background:rgba(0,0,0,.55);z-index:910;display:none;}",
    "#ve-qa-backdrop.open{display:block;}",
    /* Modal — portrait: slides up from bottom; landscape: centered */
    "#ve-qa-modal{position:fixed;left:50%;bottom:0;transform:translateX(-50%) translateY(100%);",
    "z-index:920;width:100%;max-width:520px;background:#111827;border:1px solid rgba(255,255,255,.1);",
    "border-radius:20px 20px 0 0;padding:20px 20px calc(36px + env(safe-area-inset-bottom));transition:transform .28s cubic-bezier(.2,.8,.4,1);",
    "max-height:92dvh;overflow-y:auto;-webkit-overflow-scrolling:touch;}",
    "#ve-qa-modal.open{transform:translateX(-50%) translateY(0);}",
    /* On wider screens or landscape: center the modal */
    "@media(min-width:600px){",
    "#ve-qa-modal{bottom:auto;top:50%;border-radius:16px;padding:20px 20px 28px;transform:translateX(-50%) translateY(calc(-50% + 40px));max-height:88dvh;}",
    "#ve-qa-modal.open{transform:translateX(-50%) translateY(-50%);}}",
    /* Landscape fix: short screen height — centered modal, compact, scrollable */
    "@media(max-height:500px){",
    "#ve-qa-modal{bottom:auto;top:50%;border-radius:14px;padding:12px 16px 16px;",
    "transform:translateX(-50%) translateY(calc(-50% + 60px));",
    "max-height:calc(100dvh - 24px);opacity:0;pointer-events:none;",
    "width:min(520px, calc(100vw - 32px - env(safe-area-inset-left) - env(safe-area-inset-right)));}",
    "#ve-qa-modal.open{transform:translateX(-50%) translateY(-50%);opacity:1;pointer-events:all;}",
    ".qa-chips{flex-wrap:nowrap;overflow-x:auto;-webkit-overflow-scrolling:touch;padding-bottom:6px;scrollbar-width:none;}",
    ".qa-chips::-webkit-scrollbar{display:none;}",
    ".qa-head{margin-bottom:8px;}",
    ".qa-form{gap:7px;}}",
    /* Modal header */
    ".qa-head{display:flex;align-items:center;justify-content:space-between;margin-bottom:16px;}",
    ".qa-title{font-size:17px;font-weight:800;color:#f1f5f9;}",
    ".qa-close{background:none;border:none;color:#94a3b8;font-size:22px;cursor:pointer;line-height:1;padding:0;}",
    ".qa-close:hover{color:#f1f5f9;}",
    /* Type chips */
    ".qa-chips{display:flex;flex-wrap:wrap;gap:7px;margin-bottom:18px;}",
    ".qa-chip{padding:6px 14px;border-radius:99px;border:1px solid rgba(255,255,255,.12);",
    "background:rgba(255,255,255,.05);color:#94a3b8;font-size:13px;font-weight:700;cursor:pointer;",
    "transition:all .15s;font-family:inherit;}",
    ".qa-chip:hover{background:rgba(255,255,255,.1);color:#e2e8f0;}",
    ".qa-chip.sel{background:#2d6ae0;border-color:#2d6ae0;color:#fff;}",
    ".qa-chip.sel.est{background:#0891b2;border-color:#0891b2;}",
    ".qa-chip.sel.job{background:#059669;border-color:#059669;}",
    ".qa-chip.sel.mtg{background:#7c3aed;border-color:#7c3aed;}",
    ".qa-chip.sel.cb{background:#d97706;border-color:#d97706;}",
    ".qa-chip.sel.blk{background:#475569;border-color:#475569;}",
    ".qa-chip.sel.time{background:#ea580c;border-color:#ea580c;}",
    ".qa-chip.sel.exp{background:#e11d48;border-color:#e11d48;}",
    /* Form */
    ".qa-form{display:flex;flex-direction:column;gap:11px;}",
    ".qa-label{font-size:11px;font-weight:700;letter-spacing:.06em;text-transform:uppercase;",
    "color:#64748b;margin-bottom:3px;}",
    ".qa-input,.qa-select,.qa-textarea{width:100%;padding:9px 12px;border-radius:10px;",
    "border:1px solid rgba(255,255,255,.1);background:rgba(255,255,255,.05);",
    "color:#e2e8f0;font-size:14px;font-family:inherit;outline:none;",
    "transition:border-color .15s;}",
    ".qa-input:focus,.qa-select:focus,.qa-textarea:focus{border-color:#2d6ae0;}",
    ".qa-input::placeholder,.qa-textarea::placeholder{color:#475569;}",
    ".qa-select option{background:#1e293b;color:#e2e8f0;}",
    ".qa-textarea{resize:vertical;min-height:70px;}",
    ".qa-row{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1fr);gap:10px;}",
    "@media(max-width:400px){.qa-row{grid-template-columns:1fr;}}",
    ".qa-checks-wrap{display:flex;flex-direction:column;gap:5px;max-height:160px;overflow-y:auto;padding:2px 0;}",
    ".qa-check-label{display:flex;align-items:center;gap:9px;cursor:pointer;padding:7px 10px;",
    "border-radius:9px;border:1px solid rgba(255,255,255,.07);background:rgba(255,255,255,.03);",
    "font-size:13px;color:#cbd5e1;transition:background .12s;}",
    ".qa-check-label:hover{background:rgba(255,255,255,.08);}",
    ".qa-check-label input[type=checkbox]{accent-color:#2d6ae0;width:15px;height:15px;flex-shrink:0;cursor:pointer;}",
    ".qa-checks-loading{font-size:12px;color:#475569;font-style:italic;padding:4px 0;}",
    ".qa-priority-row{display:flex;gap:7px;}",
    ".qa-pri{flex:1;padding:6px 4px;border-radius:8px;border:1px solid rgba(255,255,255,.1);",
    "background:rgba(255,255,255,.04);color:#64748b;font-size:12px;font-weight:700;",
    "cursor:pointer;text-align:center;font-family:inherit;transition:all .15s;}",
    ".qa-pri.sel.low{background:rgba(100,116,139,.25);border-color:#64748b;color:#94a3b8;}",
    ".qa-pri.sel.medium{background:rgba(234,179,8,.2);border-color:#ca8a04;color:#fbbf24;}",
    ".qa-pri.sel.high{background:rgba(239,68,68,.2);border-color:#dc2626;color:#f87171;}",
    /* Submit */
    ".qa-submit{width:100%;padding:13px;border-radius:12px;border:none;background:#2d6ae0;",
    "color:#fff;font-size:15px;font-weight:800;cursor:pointer;font-family:inherit;",
    "margin-top:4px;transition:background .15s;}",
    ".qa-submit:hover{background:#2460c8;}",
    ".qa-submit:disabled{opacity:.5;cursor:not-allowed;}",
    ".qa-msg{font-size:13px;text-align:center;padding:8px;border-radius:8px;display:none;}",
    ".qa-msg.ok{background:rgba(34,197,94,.1);color:#4ade80;}",
    ".qa-msg.err{background:rgba(239,68,68,.1);color:#f87171;}",
    /* Task list (dashboard/crew) */
    ".qa-task-list{display:flex;flex-direction:column;gap:8px;}",
    ".qa-task-group-label{font-size:11px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;",
    "color:#64748b;margin:14px 0 6px;}",
    ".qa-task-group-label.overdue{color:#f87171;}",
    ".qa-task-group-label.today{color:#fbbf24;}",
    ".qa-task-group-label.upcoming{color:#60a5fa;}",
    ".qa-task-item{display:flex;align-items:center;gap:10px;padding:10px 12px;",
    "border-radius:12px;border:1px solid rgba(255,255,255,.08);background:rgba(255,255,255,.03);}",
    ".qa-task-done-btn{width:22px;height:22px;border-radius:50%;border:2px solid #334155;",
    "background:none;cursor:pointer;flex-shrink:0;transition:all .2s;padding:0;}",
    ".qa-task-done-btn:hover{border-color:#22c55e;background:rgba(34,197,94,.1);}",
    ".qa-task-done-btn.done{border-color:#22c55e;background:#22c55e;}",
    ".qa-task-body{flex:1;min-width:0;}",
    ".qa-task-title{font-size:14px;font-weight:600;color:#e2e8f0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}",
    ".qa-task-title.done{text-decoration:line-through;color:#475569;}",
    ".qa-task-meta{font-size:11px;color:#64748b;margin-top:2px;}",
    ".qa-type-badge{font-size:10px;font-weight:700;padding:2px 7px;border-radius:99px;letter-spacing:.04em;",
    "display:inline-block;background:rgba(45,106,224,.2);color:#60a5fa;margin-right:5px;}",
    ".qa-type-badge.Meeting{background:rgba(124,58,237,.2);color:#c4b5fd;}",
    ".qa-type-badge.Callback{background:rgba(217,119,6,.2);color:#fbbf24;}",
    ".qa-type-badge.Personal\\\ Block{background:rgba(71,85,105,.35);color:#94a3b8;}",
    ".qa-pri-dot{width:7px;height:7px;border-radius:50%;display:inline-block;margin-right:4px;vertical-align:middle;}",
    ".qa-pri-dot.high{background:#f87171;}",
    ".qa-pri-dot.medium{background:#fbbf24;}",
    ".qa-pri-dot.low{background:#94a3b8;}",
    ".qa-tasks-empty{color:#475569;font-size:13px;text-align:center;padding:16px 0;}",
    ".qa-tasks-loading{color:#475569;font-size:13px;padding:12px 0;}",
    ".qa-section-hdr{display:flex;align-items:center;justify-content:space-between;margin-bottom:10px;}",
    ".qa-section-hdr-btn{font-size:12px;font-weight:700;color:#2d6ae0;background:none;border:none;cursor:pointer;",
    "padding:0;font-family:inherit;}",
    ".qa-section-hdr-btn:hover{text-decoration:underline;}",
    /* Estimate Wizard */
    ".qa-wiz-step{font-size:10px;font-weight:700;letter-spacing:.09em;text-transform:uppercase;color:#475569;margin-bottom:12px;display:flex;align-items:center;gap:7px;}",
    ".qa-wiz-step-dot{width:8px;height:8px;border-radius:50%;background:#334155;flex-shrink:0;transition:background .2s;}",
    ".qa-wiz-step-dot.active{background:#0891b2;}",
    ".qa-wiz-step-dot.done{background:#22c55e;}",
    ".qa-svc-loading{color:#475569;font-size:13px;font-style:italic;padding:24px 0;text-align:center;}",
    ".qa-svc-grid{display:grid;grid-template-columns:repeat(2,1fr);gap:8px;margin-top:6px;}",
    ".qa-svc-card{padding:12px 14px;border-radius:12px;border:1.5px solid rgba(255,255,255,.1);",
    "background:rgba(255,255,255,.04);color:#cbd5e1;font-size:13px;font-weight:700;",
    "cursor:pointer;text-align:left;font-family:inherit;transition:all .15s;line-height:1.35;width:100%;}",
    ".qa-svc-card:hover{background:rgba(8,145,178,.12);border-color:#0891b2;color:#e0f2fe;}",
    ".qa-svc-card.sel{background:rgba(8,145,178,.22);border-color:#0891b2;color:#7dd3fc;}",
    ".qa-svc-tier{font-size:10px;font-weight:400;color:#475569;margin-top:3px;text-transform:uppercase;letter-spacing:.05em;}",
    ".qa-q-block{display:flex;flex-direction:column;gap:6px;}",
    ".qa-q-label{font-size:12px;font-weight:700;color:#94a3b8;letter-spacing:.01em;}",
    ".qa-q-opts{display:flex;flex-wrap:wrap;gap:6px;}",
    ".qa-q-chip{padding:6px 12px;border-radius:8px;border:1px solid rgba(255,255,255,.1);",
    "background:rgba(255,255,255,.05);color:#94a3b8;font-size:12px;font-weight:600;",
    "cursor:pointer;font-family:inherit;transition:all .13s;}",
    ".qa-q-chip:hover{background:rgba(8,145,178,.1);border-color:#0891b2;color:#e0f2fe;}",
    ".qa-q-chip.sel{background:rgba(8,145,178,.22);border-color:#0891b2;color:#7dd3fc;}",
    ".qa-price-banner{background:rgba(8,145,178,.1);border:1px solid rgba(8,145,178,.28);",
    "border-radius:12px;padding:12px 16px;display:flex;align-items:center;justify-content:space-between;gap:8px;min-height:58px;}",
    ".qa-price-amount{font-size:22px;font-weight:900;color:#7dd3fc;letter-spacing:-.02em;line-height:1;}",
    ".qa-price-label{font-size:10px;color:#475569;margin-top:2px;text-transform:uppercase;letter-spacing:.07em;}",
    ".qa-price-note{font-size:11px;color:#475569;font-style:italic;max-width:160px;text-align:right;}",
    ".qa-wiz-back{background:none;border:none;color:#64748b;font-size:13px;cursor:pointer;",
    "padding:0;font-family:inherit;display:inline-flex;align-items:center;gap:4px;margin-bottom:8px;}",
    ".qa-wiz-back:hover{color:#94a3b8;}",
    ".qa-wiz-divider{height:1px;background:rgba(255,255,255,.07);margin:2px 0;}",
    ".qa-est-svc-name{font-size:12px;color:#0891b2;font-weight:700;margin-bottom:10px;}",
    ".qa-chip.sel.inv{background:#15803d;border-color:#15803d;}",
    /* Invoice form */
    ".qa-inv-editable{background:rgba(255,255,255,.09)!important;border-color:rgba(255,255,255,.18)!important;}",
    ".qa-inv-editable:focus{border-color:#2d6ae0!important;background:rgba(45,106,224,.08)!important;}",
    ".qa-inv-line-row{display:grid;grid-template-columns:minmax(0,2fr) 50px 80px 72px 26px;gap:5px;align-items:center;margin-bottom:5px;}",
    ".qa-inv-col-hdr{font-size:10px;font-weight:700;letter-spacing:.06em;text-transform:uppercase;color:#475569;padding:0 4px;}",
    ".qa-inv-add-btn{background:none;border:1.5px dashed rgba(255,255,255,.13);border-radius:8px;color:#64748b;",
    "font-size:13px;padding:7px 14px;cursor:pointer;width:100%;margin-top:4px;font-family:inherit;transition:all .15s;}",
    ".qa-inv-add-btn:hover{border-color:#2d6ae0;color:#60a5fa;}",
    ".qa-inv-remove-btn{background:none;border:none;color:#334155;cursor:pointer;font-size:18px;line-height:1;",
    "padding:0 2px;font-family:inherit;transition:color .12s;flex-shrink:0;}",
    ".qa-inv-remove-btn:hover{color:#f87171;}",
    ".qa-inv-totals{display:flex;flex-direction:column;gap:5px;padding:10px 14px;border-radius:10px;",
    "background:rgba(255,255,255,.03);border:1px solid rgba(255,255,255,.07);}",
    ".qa-inv-total-row{display:flex;justify-content:space-between;align-items:center;font-size:13px;color:#94a3b8;}",
    ".qa-inv-total-row.grand{font-size:16px;font-weight:800;color:#f1f5f9;border-top:1px solid rgba(255,255,255,.1);padding-top:8px;margin-top:4px;}",
    ".qa-inv-total-amt{font-weight:700;}",
    ".qa-inv-line-total{font-size:13px;color:#94a3b8;text-align:right;padding:9px 2px 9px 0;font-weight:600;white-space:nowrap;}",
    /* Client combobox */
    ".qa-combo-wrap{position:relative;}",
    ".qa-combo-list{position:absolute;top:calc(100% + 4px);left:0;right:0;z-index:999;",
    "background:#1e293b;border:1px solid rgba(255,255,255,.15);border-radius:10px;",
    "max-height:200px;overflow-y:auto;box-shadow:0 8px 24px rgba(0,0,0,.5);display:none;}",
    ".qa-combo-list.open{display:block;}",
    ".qa-combo-opt{padding:10px 14px;cursor:pointer;font-size:13px;color:#e2e8f0;border-bottom:1px solid rgba(255,255,255,.05);}",
    ".qa-combo-opt:last-child{border-bottom:none;}",
    ".qa-combo-opt:hover,.qa-combo-opt.hl{background:rgba(45,106,224,.2);color:#fff;}",
    ".qa-combo-opt-sub{font-size:11px;color:#64748b;margin-top:1px;}",
    ".qa-combo-no-res{padding:10px 14px;font-size:13px;color:#64748b;font-style:italic;}",
    /* Estimate dropdown fix */
    ".qa-q-sel-inp{width:100%;padding:8px 12px;border-radius:10px;border:1px solid rgba(255,255,255,.1);",
    "background:rgba(255,255,255,.05);color:#e2e8f0;font-size:14px;font-family:inherit;outline:none;}",
    ".qa-q-sel-inp:focus{border-color:#0891b2;}",
    ".qa-q-sel-inp option{background:#1e293b;color:#e2e8f0;}",
  ].join("");
  document.head.appendChild(style);

  // ── FAB ───────────────────────────────────────────────────────────────────
  var fab = document.createElement("button");
  fab.id = "ve-qa-fab";
  fab.setAttribute("aria-label", "Quick Add");
  fab.innerHTML = "+";
  document.body.appendChild(fab);

  // ── Backdrop ──────────────────────────────────────────────────────────────
  var backdrop = document.createElement("div");
  backdrop.id = "ve-qa-backdrop";
  document.body.appendChild(backdrop);

  // ── Modal ─────────────────────────────────────────────────────────────────
  var modal = document.createElement("div");
  modal.id = "ve-qa-modal";
  modal.setAttribute("role", "dialog");
  modal.setAttribute("aria-label", "Quick Add");
  modal.innerHTML =
    '<div class="qa-head">' +
      '<div class="qa-title">Quick Add</div>' +
      '<button class="qa-close" id="ve-qa-close" aria-label="Close">&times;</button>' +
    '</div>' +
    '<div class="qa-chips" id="ve-qa-chips"></div>' +
    '<div class="qa-form" id="ve-qa-form"></div>' +
    '<div class="qa-msg" id="ve-qa-msg"></div>';
  document.body.appendChild(modal);

  // ── State ─────────────────────────────────────────────────────────────────
  var currentType    = "Task";
  var techList       = [];
  var loadingTechs   = false;
  var crewMemberName = "";  // filled on init for crew context

  // Estimate wizard state (CRM only)
  var estimateStep     = 1;
  var selectedService  = null;
  var moduleAnswers    = {};
  var _estConfig       = null;
  var _estPriceResult  = null;
  var _estPricingTimer = null;

  // Detect context by URL path — crew page is /crew, all CRM pages are /crm/*
  // This is reliable even on CRM pages that lack a sidebar mount element
  var _path = window.location.pathname;
  var IS_CREW = _path === "/crew" || _path.startsWith("/crew/");
  var TASKS_BASE  = IS_CREW ? "/api/crew/tasks"  : "/api/tasks";
  var EVENTS_BASE = IS_CREW ? "/api/crew/events" : "/api/events";

  // Fetch crew identity on page load (used to auto-assign tasks/events)
  // /api/crew/me returns { ok, staff: { firstName, lastName, ... } }
  if (IS_CREW) {
    fetch("/api/crew/me")
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (d) {
        if (d && d.ok && d.staff) {
          crewMemberName = (d.staff.firstName + " " + d.staff.lastName).trim();
        }
      })
      .catch(function () {});
  }

  var TYPES_CRM  = [
    { id: "Task",           label: "Task",           cls: ""    },
    { id: "Estimate",       label: "Estimate",       cls: "est" },
    { id: "Job",            label: "Job",            cls: "job" },
    { id: "Invoice",        label: "Invoice",        cls: "inv" },
    { id: "Meeting",        label: "Meeting",        cls: "mtg" },
    { id: "Callback",       label: "Callback",       cls: "cb"  },
    { id: "Personal Block", label: "Personal Block", cls: "blk" },
    { id: "Time Entry",     label: "Time Entry",     cls: "time"},
    { id: "Expense",        label: "Expense",        cls: "exp" },
  ];
  var TYPES_CREW = [
    { id: "Task",           label: "Task",           cls: ""    },
    { id: "Estimate",       label: "Estimate",       cls: "est" },
    { id: "Job",            label: "Job",            cls: "job" },
    { id: "Meeting",        label: "Meeting",        cls: "mtg" },
    { id: "Callback",       label: "Callback",       cls: "cb"  },
    { id: "Personal Block", label: "Personal Block", cls: "blk" },
  ];
  var TYPES = IS_CREW ? TYPES_CREW : TYPES_CRM;

  // Add minutes to a local naive datetime string (YYYY-MM-DDTHH:MM) without UTC conversion
  function addMinutesToLocalDT(localDT, minutes) {
    var parts = localDT.split("T");
    if (parts.length < 2 || !parts[0] || !parts[1]) return "";
    var datePart = parts[0]; var timePart = parts[1];
    var hm = timePart.split(":"); if (hm.length < 2) return "";
    var totalMins = parseInt(hm[0], 10) * 60 + parseInt(hm[1], 10) + minutes;
    var extraDays = Math.floor(totalMins / 1440); totalMins = totalMins % 1440;
    var endH = Math.floor(totalMins / 60); var endM = totalMins % 60;
    var endDate = datePart;
    if (extraDays > 0) {
      var d = new Date(datePart + "T00:00:00");
      d.setDate(d.getDate() + extraDays);
      endDate = d.toISOString().slice(0, 10);
    }
    return endDate + "T" + String(endH).padStart(2,"0") + ":" + String(endM).padStart(2,"0");
  }

  function tomorrowStr() {
    const d = new Date(); d.setDate(d.getDate() + 1);
    return d.toISOString().slice(0, 10);
  }
  function nextHourEndStr() {
    const d = new Date(); d.setMinutes(0, 0, 0);
    d.setHours(d.getHours() + 2);
    return `${String(d.getHours()).padStart(2,"0")}:00`;
  }
  function todayStr() {
    return new Date().toISOString().slice(0, 10);
  }

  function nextHourStr() {
    var d = new Date();
    d.setMinutes(0, 0, 0);
    d.setHours(d.getHours() + 1);
    var hh = String(d.getHours()).padStart(2, "0");
    return hh + ":00";
  }

  // ── Build type chips ──────────────────────────────────────────────────────
  var chipsEl = document.getElementById("ve-qa-chips");
  TYPES.forEach(function (t) {
    var chip = document.createElement("button");
    chip.className = "qa-chip" + (t.id === currentType ? " sel " + t.cls : "");
    chip.textContent = t.label;
    chip.dataset.type = t.id;
    chip.dataset.cls  = t.cls;
    chip.addEventListener("click", function () {
      // Reset estimate wizard whenever user picks a chip (including re-picking Estimate)
      estimateStep = 1; selectedService = null; moduleAnswers = {}; _estPriceResult = null;
      currentType = t.id;
      chipsEl.querySelectorAll(".qa-chip").forEach(function (c) {
        c.className = "qa-chip" + (c.dataset.type === currentType ? " sel " + c.dataset.cls : "");
      });
      renderForm();
    });
    chipsEl.appendChild(chip);
  });

  // ── Tech list (lazy load) ─────────────────────────────────────────────────
  function loadTechs(cb) {
    if (techList.length) { cb(techList); return; }
    if (loadingTechs) { setTimeout(function () { loadTechs(cb); }, 200); return; }
    // Crew mode: can't call CRM-auth-gated /api/techs; use crew member's own identity
    if (IS_CREW) {
      if (crewMemberName) {
        techList = [{ name: crewMemberName }];
        cb(techList);
      } else {
        // crewMemberName may still be loading — poll briefly then proceed
        var waited = 0;
        var poll = setInterval(function () {
          waited += 100;
          if (crewMemberName || waited >= 1500) {
            clearInterval(poll);
            techList = crewMemberName ? [{ name: crewMemberName }] : [];
            cb(techList);
          }
        }, 100);
      }
      return;
    }
    loadingTechs = true;
    fetch("/api/techs")
      .then(function (r) { return r.json(); })
      .then(function (d) { techList = d.techs || d.staff || []; cb(techList); })
      .catch(function ()  { techList = []; cb([]); });
  }

  function techOptionsHtml(selected) {
    var opts = IS_CREW ? "" : '<option value="">— Unassigned —</option>';
    techList.forEach(function (t) {
      var name = t.name || t.firstName + " " + t.lastName;
      opts += '<option value="' + esc(name) + '"' + (name === selected ? ' selected' : '') + '>' + esc(name) + '</option>';
    });
    return opts;
  }

  // Render a checkbox list for multi-tech assignment
  function techCheckboxesHtml(selected) {
    if (!techList.length) return '<em class="qa-checks-loading">No techs found</em>';
    var selArr = Array.isArray(selected) ? selected
               : (selected && typeof selected === "string") ? selected.split(",").map(function(s){ return s.trim(); }).filter(Boolean)
               : [];
    return techList.map(function (t) {
      var name = t.name || (t.firstName + " " + t.lastName);
      var chk  = selArr.indexOf(name) !== -1 ? " checked" : "";
      return '<label class="qa-check-label">' +
        '<input type="checkbox" class="qa-assign-cb" value="' + esc(name) + '"' + chk + '>' +
        '<span>' + esc(name) + '</span>' +
      '</label>';
    }).join("");
  }

  // Read all checked tech names from the checkbox list
  function getAssignedNames() {
    var boxes = document.querySelectorAll("#qa-f-assign-checks .qa-assign-cb:checked");
    return Array.prototype.map.call(boxes, function (cb) { return cb.value; });
  }

  // ── Helpers ───────────────────────────────────────────────────────────────
  function esc(s) {
    return String(s || "").replace(/&/g,"&amp;").replace(/"/g,"&quot;").replace(/</g,"&lt;").replace(/>/g,"&gt;");
  }

  function fld(label, html) {
    return '<div><div class="qa-label">' + label + '</div>' + html + '</div>';
  }

  function inp(id, type, placeholder, value, extra) {
    return '<input id="' + id + '" class="qa-input" type="' + type + '" placeholder="' + (placeholder||"") + '" value="' + esc(value||"") + '" ' + (extra||"") + '/>';
  }

  function sel(id, optionsHtml, extra) {
    return '<select id="' + id + '" class="qa-select" ' + (extra||"") + '>' + optionsHtml + '</select>';
  }

  function textarea(id, placeholder) {
    return '<textarea id="' + id + '" class="qa-textarea" placeholder="' + (placeholder||"") + '"></textarea>';
  }

  // ── Render form based on type ─────────────────────────────────────────────
  function renderForm() {
    var formEl = document.getElementById("ve-qa-form");
    var msgEl  = document.getElementById("ve-qa-msg");
    msgEl.className = "qa-msg";
    msgEl.style.display = "none";

    var html = "";

    if (currentType === "Task") {
      html += fld("Title *", inp("qa-f-title", "text", "Task name…", "", "autocomplete='off'"));
      html += '<div class="qa-row">' +
        fld("Due Date", inp("qa-f-due", "date", "", todayStr())) +
        fld("Priority", '<div class="qa-priority-row">' +
          '<button type="button" class="qa-pri low" data-pri="low">Low</button>' +
          '<button type="button" class="qa-pri medium sel" data-pri="medium">Medium</button>' +
          '<button type="button" class="qa-pri high" data-pri="high">High</button>' +
        '</div>') +
      '</div>';
      html += fld("Assign To", '<div id="qa-f-assign-checks" class="qa-checks-wrap"><em class="qa-checks-loading">Loading\u2026</em></div>');
      html += fld("Related Lead ID", inp("qa-f-lead", "text", "LEAD-xxxxx (optional)", "", "autocomplete='off'"));
      html += fld("Notes", textarea("qa-f-notes", "Add any notes…"));

    } else if (currentType === "Estimate" && IS_CREW) {
      // Crew: simple form, posts as a task (cannot access /api/leads or estimator config)
      html += fld("Client Name *", inp("qa-f-name", "text", "Full name…", "", "autocomplete='off'"));
      html += '<div class="qa-row">' +
        fld("Phone", inp("qa-f-phone", "tel", "(555) 000-0000")) +
        fld("Est. Date", inp("qa-f-due", "date", "", tomorrowStr())) +
      '</div>';
      html += fld("Address", inp("qa-f-addr", "text", "Street address…", ""));
      html += fld("Duration (min)", inp("qa-f-dur", "number", "60", "60", "min='15' max='480' step='15'"));
      html += fld("Notes", textarea("qa-f-notes", "What work is needed?"));

    } else if (currentType === "Estimate") {
      // CRM: multi-step V2 estimator wizard
      if (estimateStep === 1) {
        html += '<div class="qa-wiz-step"><span class="qa-wiz-step-dot active"></span><span class="qa-wiz-step-dot"></span>Step 1 of 2 — Select Service</div>';
        html += fld("What service does the customer need?",
          '<div class="qa-svc-grid" id="qa-svc-grid"><div class="qa-svc-loading">Loading services\u2026</div></div>');
        html += '<div style="font-size:11px;color:#475569;margin-top:4px;">Service list is loaded from the Estimator sheet.</div>';
        // No submit button for step 1 — clicking a card advances; afterEstimateRender populates the grid
      } else {
        // Step 2
        html += '<button type="button" class="qa-wiz-back" id="qa-wiz-back">\u2190 Back</button>';
        html += '<div class="qa-wiz-step"><span class="qa-wiz-step-dot done"></span><span class="qa-wiz-step-dot active"></span>Step 2 of 2 — Details</div>';
        if (selectedService) {
          html += '<div class="qa-est-svc-name">' + esc(selectedService.service_name) + '</div>';
        }
        // Price banner (updated live as answers change)
        html += '<div class="qa-price-banner" id="qa-price-banner">' +
          '<div><div class="qa-price-amount" id="qa-price-amount">—</div><div class="qa-price-label">Estimated price</div></div>' +
          '<div class="qa-price-note" id="qa-price-note">Answer questions below for a price estimate</div>' +
        '</div>';
        // Dynamic module questions
        html += '<div id="qa-q-container"></div>';
        html += '<div class="qa-wiz-divider"></div>';
        // Customer info
        html += fld("Client Name *", inp("qa-f-name", "text", "Full name…", "", "autocomplete='off'"));
        html += '<div class="qa-row">' +
          fld("Phone", inp("qa-f-phone", "tel", "(555) 000-0000")) +
          fld("Address", inp("qa-f-addr", "text", "Street address…", "")) +
        '</div>';
        html += '<div class="qa-row">' +
          fld("Est. Date", inp("qa-f-due", "date", "", tomorrowStr())) +
          fld("Time", inp("qa-f-time", "time", "", "09:00")) +
        '</div>';
        html += fld("Duration (min)", inp("qa-f-dur", "number", "60", "60", "min='15' max='480' step='15'"));
        html += fld("Notes", textarea("qa-f-notes", "Any extra details for the estimate…"));
        html += '<div style="font-size:11px;color:#475569;margin-top:-4px;">Reminders will fire 24h and 1h before.</div>';
      }

    } else if (currentType === "Job") {
      html += fld("Link Existing Lead (optional)",
        '<div style="display:flex;gap:6px;align-items:center;">' +
          inp("qa-f-lead-link", "text", "LEAD-xxxxx", "", "autocomplete='off' style='flex:1'") +
          '<button type="button" id="qa-lead-lookup" style="padding:7px 12px;border-radius:8px;border:1px solid rgba(255,255,255,.15);background:rgba(255,255,255,.07);color:#94a3b8;font-size:12px;cursor:pointer;white-space:nowrap;font-family:inherit;">Auto-fill ↗</button>' +
        '</div>');
      html += fld("Client Name *", inp("qa-f-name", "text", "Full name…", "", "autocomplete='off'"));
      html += '<div class="qa-row">' +
        fld("Phone", inp("qa-f-phone", "tel", "(555) 000-0000")) +
        fld("Job Type", '<select id="qa-f-jtype" class="qa-select"><option value="Residential">Residential</option><option value="Commercial">Commercial</option><option value="Panel Upgrade">Panel Upgrade</option><option value="EV Charger">EV Charger</option><option value="Other">Other</option></select>') +
      '</div>';
      html += fld("Address", inp("qa-f-addr", "text", "Street address…", ""));
      html += '<div class="qa-row">' +
        fld("Scheduled Date", inp("qa-f-due", "date", "", todayStr())) +
        fld("Time", inp("qa-f-time", "time", "", "08:00")) +
      '</div>';
      html += fld("Duration (min)", inp("qa-f-dur", "number", "120", "120", "min='15' max='960' step='15'"));
      html += fld("Assign To", '<div id="qa-f-assign-checks" class="qa-checks-wrap"><em class="qa-checks-loading">Loading\u2026</em></div>');
      html += fld("Notes", textarea("qa-f-notes", "Additional notes…"));

    } else if (currentType === "Invoice") {
      html += buildInvoiceFormHtml();

    } else if (currentType === "Meeting") {
      html += fld("Meeting Title *", inp("qa-f-title", "text", "e.g. Site walkthrough with Smith…", "", "autocomplete='off'"));
      html += '<div class="qa-row">' +
        fld("Date *", inp("qa-f-due", "date", "", todayStr())) +
        fld("Start Time", inp("qa-f-time", "time", "", nextHourStr())) +
      '</div>';
      html += fld("Duration (min)", inp("qa-f-dur", "number", "30", "30", "min='15' max='480' step='15'"));
      html += fld("Assign To", '<div id="qa-f-assign-checks" class="qa-checks-wrap"><em class="qa-checks-loading">Loading\u2026</em></div>');
      html += fld("Notes / Attendees", textarea("qa-f-notes", "Who is attending? Any agenda items?"));

    } else if (currentType === "Callback") {
      html += fld("Who to Call *", inp("qa-f-title", "text", "Customer name or description…", "", "autocomplete='off'"));
      html += '<div class="qa-row">' +
        fld("When — Date *", inp("qa-f-due", "date", "", todayStr())) +
        fld("Time", inp("qa-f-time", "time", "", nextHourStr())) +
      '</div>';
      html += fld("Phone / Notes", textarea("qa-f-notes", "(555) 000-0000 — reason for call…"));

    } else if (currentType === "Time Entry") {
      html += '<div class="qa-row">' +
        fld("Date *", inp("qa-f-due", "date", "", todayStr())) +
        fld("Minutes *", inp("qa-f-dur", "number", "60", "60", "min='1' max='960' step='15'")) +
      '</div>';
      html += fld("Tech", '<select id="qa-f-tech" class="qa-select"><option value="">— Loading… —</option></select>');
      html += fld("Category", '<select id="qa-f-cat" class="qa-select"><option value="Labor">Labor</option><option value="Drive">Drive</option><option value="Admin">Admin</option><option value="Materials">Materials</option><option value="Other">Other</option></select>');
      html += fld("Related Job # (optional)", inp("qa-f-lead", "text", "LEAD-xxxxx", "", "autocomplete='off'"));
      html += fld("Notes", textarea("qa-f-notes", "What was done?"));

    } else if (currentType === "Expense") {
      html += '<div class="qa-row">' +
        fld("Date *", inp("qa-f-due", "date", "", todayStr())) +
        fld("Amount * ($)", inp("qa-f-amount", "number", "0.00", "", "min='0' step='0.01'")) +
      '</div>';
      html += fld("Tech", '<select id="qa-f-tech" class="qa-select"><option value="">— Loading… —</option></select>');
      html += '<div class="qa-row">' +
        fld("Type", '<select id="qa-f-exptype" class="qa-select"><option value="Materials">Materials</option><option value="Tools">Tools</option><option value="Fuel">Fuel</option><option value="Permit">Permit</option><option value="Subcontractor">Subcontractor</option><option value="Other">Other</option></select>') +
        fld("Vendor", inp("qa-f-vendor", "text", "Home Depot, etc.", "")) +
      '</div>';
      html += fld("Related Job # (optional)", inp("qa-f-lead", "text", "LEAD-xxxxx", "", "autocomplete='off'"));
      html += fld("Notes", textarea("qa-f-notes", "What was purchased?"));

    } else if (currentType === "Personal Block") {
      html += fld("Description *", inp("qa-f-title", "text", "e.g. Dentist, Family event…", "", "autocomplete='off'"));
      html += fld("Date *", inp("qa-f-due", "date", "", todayStr()));
      html += '<div class="qa-row">' +
        fld("Start Time", inp("qa-f-time", "time", "", nextHourStr())) +
        fld("End Time", inp("qa-f-time-end", "time", "", nextHourEndStr())) +
      '</div>';
      html += fld("Notes", textarea("qa-f-notes", "Any extra details…"));
    }

    // Step 1 of the Estimate wizard has no submit — service selection advances to step 2
    if (!(currentType === "Estimate" && !IS_CREW && estimateStep === 1)) {
      var submitLabel = currentType === "Estimate" ? "Save Estimate & Create Lead"
        : currentType === "Invoice"    ? "Create Invoice"
        : currentType === "Time Entry" ? "Save Time Entry"
        : currentType === "Expense"    ? "Save Expense"
        : "Add " + currentType;
      html += '<button type="button" class="qa-submit" id="ve-qa-submit">' + submitLabel + '</button>';
    }

    formEl.innerHTML = html;

    // CRM Estimate wizard — populate grid or wire questions after DOM is set
    if (currentType === "Estimate" && !IS_CREW) { afterEstimateRender(); }
    // Invoice form — load clients + wire line items after DOM is set
    if (currentType === "Invoice") { afterInvoiceRender(); }

    // Priority button wiring
    formEl.querySelectorAll(".qa-pri").forEach(function (btn) {
      btn.addEventListener("click", function () {
        formEl.querySelectorAll(".qa-pri").forEach(function (b) {
          b.className = "qa-pri " + b.dataset.pri;
        });
        btn.classList.add("sel");
      });
    });

    // Load techs into checkbox list
    var checksWrap = document.getElementById("qa-f-assign-checks");
    if (checksWrap) {
      loadTechs(function () {
        if (checksWrap.parentNode) checksWrap.innerHTML = techCheckboxesHtml("");
      });
    }

    // Lead auto-fill for Estimate / Job
    var leadLookupBtn = document.getElementById("qa-lead-lookup");
    if (leadLookupBtn) {
      leadLookupBtn.addEventListener("click", function () {
        var leadId = (document.getElementById("qa-f-lead-link") || {}).value || "";
        leadId = leadId.trim();
        if (!leadId) return;
        leadLookupBtn.textContent = "Loading…";
        leadLookupBtn.disabled = true;
        fetch("/api/leads/lookup?id=" + encodeURIComponent(leadId))
          .then(function (r) { return r.ok ? r.json() : null; })
          .then(function (data) {
            leadLookupBtn.textContent = "Auto-fill ↗";
            leadLookupBtn.disabled = false;
            if (!data || !data.lead) { showErr("Lead not found."); return; }
            var lead = data.lead;
            var nameEl   = document.getElementById("qa-f-name");
            var phoneEl  = document.getElementById("qa-f-phone");
            var addrEl   = document.getElementById("qa-f-addr");
            var checksWrap2 = document.getElementById("qa-f-assign-checks");
            if (nameEl  && lead.name)    nameEl.value  = lead.name;
            if (phoneEl && lead.phone)   phoneEl.value = lead.phone;
            if (addrEl  && lead.address) addrEl.value  = lead.address;
            if (checksWrap2 && lead.assigned_to) {
              loadTechs(function () {
                if (checksWrap2.parentNode) {
                  checksWrap2.innerHTML = techCheckboxesHtml(lead.assigned_to);
                }
              });
            }
          })
          .catch(function () {
            leadLookupBtn.textContent = "Auto-fill ↗";
            leadLookupBtn.disabled = false;
            showErr("Could not load lead.");
          });
      });
    }

    // Populate tech select for Time Entry / Expense
    var techSelEl = document.getElementById("qa-f-tech");
    if (techSelEl) {
      loadTechs(function (list) {
        var el2 = document.getElementById("qa-f-tech");
        if (!el2) return;
        var opts = '<option value="">— Select Tech —</option>';
        list.forEach(function (t) { opts += '<option value="' + t.name + '">' + t.name + '</option>'; });
        el2.innerHTML = opts;
      });
    }

    // Submit (null-safe; Estimate step 2 wires its own in afterEstimateRender)
    var submitBtnEl = document.getElementById("ve-qa-submit");
    if (submitBtnEl && !(currentType === "Estimate" && !IS_CREW)) {
      submitBtnEl.addEventListener("click", submitQuickAdd);
    }
  }

  // ── Submit ────────────────────────────────────────────────────────────────
  function submitQuickAdd() {
    var btn = document.getElementById("ve-qa-submit");
    var msg = document.getElementById("ve-qa-msg");
    if (!btn) return;

    btn.disabled = true;
    btn.textContent = "Saving…";
    msg.className = "qa-msg";
    msg.style.display = "none";

    var g = function (id) { var el = document.getElementById(id); return el ? el.value.trim() : ""; };
    var getPri = function () {
      var sel = document.querySelector(".qa-pri.sel");
      return sel ? sel.dataset.pri : "medium";
    };

    var promise;

    if (currentType === "Task") {
      var title = g("qa-f-title");
      if (!title) { showErr("Title is required."); btn.disabled = false; btn.textContent = "Add Task"; return; }
      var due = g("qa-f-due");
      var taskAssign = getAssignedNames().join(", ") || (IS_CREW ? crewMemberName : "");
      promise = fetch(TASKS_BASE, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: title, type: "Task", due_date: due,
          assigned_to: taskAssign, related_lead_id: g("qa-f-lead"),
          priority: getPri(), notes: g("qa-f-notes"),
        }),
      }).then(function (r) { return r.json(); });

    } else if (currentType === "Estimate" && !IS_CREW) {
      // CRM Estimate — wizard submit: price via /api/estimator/quote, then create Lead
      var estName = g("qa-f-name");
      if (!estName) { showErr("Client name is required."); btn.disabled = false; btn.textContent = "Save Estimate & Create Lead"; return; }
      var estDurMin  = g("qa-f-dur") || "60";
      var estDate    = g("qa-f-due");
      var estTime    = g("qa-f-time");
      var estSchedDT = estDate + (estTime ? "T" + estTime : "");
      var estBaseNotes = g("qa-f-notes");
      var svc = selectedService || {};

      promise = (svc.service_id
        ? fetch("/api/estimator/quote", {
            method: "POST", headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              segment:    svc.segment || "residential",
              service_id: svc.service_id,
              answers:    moduleAnswers,
            }),
          }).then(function (r) { return r.json(); }).catch(function () { return {}; })
        : Promise.resolve({})
      ).then(function (priceData) {
        var priceStr = "";
        if (priceData.final_price) {
          priceStr = "Quoted: $" + Number(priceData.final_price).toLocaleString();
        } else if (priceData.price_range) {
          priceStr = "Quoted: $" + Number(priceData.price_range.low).toLocaleString() + "–$" + Number(priceData.price_range.high).toLocaleString();
        }
        var notesLines = [];
        if (estBaseNotes) notesLines.push(estBaseNotes);
        notesLines.push("Duration: " + estDurMin + " min");
        if (svc.service_name) notesLines.push("Service: " + svc.service_name);
        if (priceStr) notesLines.push(priceStr);
        if (Object.keys(moduleAnswers).length) {
          var answerLines = Object.keys(moduleAnswers).map(function (k) {
            return k + ": " + moduleAnswers[k];
          }).join(", ");
          notesLines.push("Answers: " + answerLines);
        }
        notesLines.push("reminders:24h,1h");
        return fetch("/api/leads", {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            name:           estName,
            phone:          g("qa-f-phone"),
            address:        g("qa-f-addr"),
            job_type:       svc.service_name || svc.service_id || "Estimate",
            status:         "New",
            notes:          notesLines.join("\n"),
            scheduled_date: estSchedDT,
            estimated_value: priceData.final_price || (priceData.price_range && priceData.price_range.low) || "",
          }),
        }).then(function (r) { return r.json(); });
      });

    } else if (currentType === "Job" && !IS_CREW) {
      // CRM Job: create lead directly
      var name = g("qa-f-name");
      if (!name) { showErr("Client name is required."); btn.disabled = false; btn.textContent = "Add Job"; return; }
      var durMin = g("qa-f-dur") || "120";
      var schedDate = g("qa-f-due");
      var schedTime = g("qa-f-time");
      var schedDT = schedDate + (schedTime ? "T" + schedTime : "");
      var baseNotes = g("qa-f-notes");
      var notesWithDur = (baseNotes ? baseNotes + "\n" : "") + "Duration: " + durMin + " min";
      promise = fetch("/api/leads", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: name, phone: g("qa-f-phone"),
          address: g("qa-f-addr"), job_type: g("qa-f-jtype"),
          status: "New", notes: notesWithDur,
          scheduled_date: schedDT,
          assigned_to: getAssignedNames().join(", ") || "",
        }),
      }).then(function (r) { return r.json(); });

    } else if (currentType === "Invoice") {
      var invLines = [];
      document.querySelectorAll("#qa-inv-lines .qa-inv-line-row").forEach(function (row) {
        var desc2 = (row.querySelector(".inv-line-desc")?.value || "").trim();
        var qty2  = parseFloat(row.querySelector(".inv-line-qty")?.value)  || 0;
        var rate2 = parseFloat(row.querySelector(".inv-line-rate")?.value) || 0;
        if (desc2 || rate2 > 0) invLines.push({ description: desc2 || "Service", qty: qty2, rate: rate2, amount: Math.round(qty2 * rate2 * 100) / 100 });
      });
      var invSubtotal = invLines.reduce(function (s, l) { return s + l.amount; }, 0);
      if (invSubtotal <= 0) { showErr("Add at least one line item with a rate."); btn.disabled = false; btn.textContent = "Create Invoice"; return; }
      var invTaxPct = parseFloat(document.getElementById("qa-inv-tax")?.value) || 0;
      var invClientId = document.getElementById("qa-inv-client")?.value || "";
      var invName = g("qa-inv-name") || (document.getElementById("qa-inv-client-search")?.value || "").trim();
      if (!invName) { showErr("Client name is required."); btn.disabled = false; btn.textContent = "Create Invoice"; return; }
      promise = fetch("/api/invoices/from-lead", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          client_id:     invClientId,
          customer_name: invName,
          line_items:    invLines,
          subtotal:      invSubtotal,
          tax_rate:      invTaxPct,
          due_at:        g("qa-inv-due") || "",
          notes:         g("qa-inv-notes") || "",
        }),
      }).then(function (r) { return r.json(); });

    } else if ((currentType === "Estimate" || currentType === "Job") && IS_CREW) {
      // Crew context: post to crew task endpoint as a flagged work item
      // (CRM admin converts to full lead — crew cannot access /api/leads directly)
      var name2 = g("qa-f-name");
      if (!name2) { showErr("Client name is required."); btn.disabled = false; btn.textContent = "Add " + currentType; return; }
      var durMin2 = g("qa-f-dur") || (currentType === "Estimate" ? "60" : "120");
      var sDate = g("qa-f-due");
      var sTime = g("qa-f-time");
      var sDT = sDate + (sTime ? "T" + sTime : "");
      var crewNotesBase = "Client: " + name2;
      if (g("qa-f-phone")) crewNotesBase += " | Ph: " + g("qa-f-phone");
      if (g("qa-f-addr"))  crewNotesBase += " | Addr: " + g("qa-f-addr");
      crewNotesBase += " | Duration: " + durMin2 + " min";
      if (currentType === "Estimate") crewNotesBase += "\nreminders:24h,1h";
      if (g("qa-f-notes")) crewNotesBase += "\n" + g("qa-f-notes");
      promise = fetch(TASKS_BASE, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: currentType + " — " + name2,
          type: currentType, due_date: sDT,
          assigned_to: getAssignedNames()[0] || "",
          priority: getPri(), notes: crewNotesBase,
        }),
      }).then(function (r) { return r.json(); });

    } else if (currentType === "Meeting" || currentType === "Callback" || currentType === "Personal Block") {
      // Meeting | Callback | Personal Block → Events sheet (timed calendar entries)
      var title2 = g("qa-f-title");
      if (!title2) { showErr("Title is required."); btn.disabled = false; btn.textContent = "Add " + currentType; return; }
      var evDate  = g("qa-f-due");
      var evStart = g("qa-f-time");
      var startDT = evDate + (evStart ? "T" + evStart : "T00:00");
      // Compute end datetime
      var endDT = "";
      if (currentType === "Personal Block") {
        var endTime = g("qa-f-time-end");
        endDT = evDate + (endTime ? "T" + endTime : "");
      } else if (currentType === "Meeting") {
        var durMins = parseInt(g("qa-f-dur") || "30", 10);
        endDT = addMinutesToLocalDT(startDT, durMins);
      } else if (currentType === "Callback") {
        endDT = addMinutesToLocalDT(startDT, 15);
      }
      // Auto-assign to crew member in crew context; else use form selection
      var evAssign = getAssignedNames()[0] || (IS_CREW ? crewMemberName : "");
      var evNotes  = g("qa-f-notes") || "";
      promise = fetch(EVENTS_BASE, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: title2, type: currentType,
          start_datetime: startDT, end_datetime: endDT,
          assigned_to: evAssign, notes: evNotes,
        }),
      }).then(function (r) { return r.json(); });

    } else if (currentType === "Time Entry") {
      var teDate = g("qa-f-due");
      var teMin  = g("qa-f-dur");
      if (!teDate || !teMin) { showErr("Date and minutes are required."); btn.disabled = false; btn.textContent = "Save Time Entry"; return; }
      promise = fetch("/api/time", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          date:     teDate,
          tech_id:  g("qa-f-tech"),
          minutes:  parseInt(teMin, 10),
          category: g("qa-f-cat") || "Labor",
          lead_id:  g("qa-f-lead"),
          notes:    g("qa-f-notes"),
        }),
      }).then(function (r) { return r.json(); });

    } else if (currentType === "Expense") {
      var exDate   = g("qa-f-due");
      var exAmount = g("qa-f-amount");
      if (!exDate || !exAmount) { showErr("Date and amount are required."); btn.disabled = false; btn.textContent = "Save Expense"; return; }
      promise = fetch("/api/expenses", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          date:    exDate,
          tech_id: g("qa-f-tech"),
          amount:  parseFloat(exAmount),
          type:    g("qa-f-exptype") || "Materials",
          vendor:  g("qa-f-vendor"),
          lead_id: g("qa-f-lead"),
          notes:   g("qa-f-notes"),
        }),
      }).then(function (r) { return r.json(); });
    }

    promise.then(function (data) {
      if (data.ok) {
        var okMsg = currentType === "Estimate" || currentType === "Job" ? "Lead saved."
          : currentType === "Invoice"    ? "Invoice created! View it in Invoices."
          : currentType === "Time Entry" ? "Time logged!"
          : currentType === "Expense"    ? "Expense saved!"
          : "Saved!";
        showOk("Done — " + okMsg);
        setTimeout(function () {
          closeModal();
          refreshTaskLists();
        }, 900);
      } else {
        showErr(data.error || "Something went wrong.");
        btn.disabled = false;
        btn.textContent = currentType === "Invoice"    ? "Create Invoice"
          : currentType === "Time Entry" ? "Save Time Entry"
          : currentType === "Expense"    ? "Save Expense"
          : "Add " + currentType;
      }
    }).catch(function (err) {
      showErr("Network error: " + err.message);
      btn.disabled = false;
      btn.textContent = currentType === "Invoice"    ? "Create Invoice"
        : currentType === "Time Entry" ? "Save Time Entry"
        : currentType === "Expense"    ? "Save Expense"
        : "Add " + currentType;
    });
  }

  function showErr(msg) {
    var el = document.getElementById("ve-qa-msg");
    if (!el) return;
    el.textContent = msg;
    el.className = "qa-msg err";
    el.style.display = "block";
  }
  function showOk(msg) {
    var el = document.getElementById("ve-qa-msg");
    if (!el) return;
    el.textContent = msg;
    el.className = "qa-msg ok";
    el.style.display = "block";
  }

  // ── Open / Close ──────────────────────────────────────────────────────────
  function openModal() {
    backdrop.classList.add("open");
    modal.classList.add("open");
    document.body.style.overflow = "hidden";
    currentType = "Task";
    chipsEl.querySelectorAll(".qa-chip").forEach(function (c) {
      c.className = "qa-chip" + (c.dataset.type === "Task" ? " sel " + c.dataset.cls : "");
    });
    renderForm();
    setTimeout(function () {
      var firstInp = modal.querySelector("input,select,textarea");
      if (firstInp) firstInp.focus();
    }, 120);
  }

  function closeModal() {
    backdrop.classList.remove("open");
    modal.classList.remove("open");
    document.body.style.overflow = "";
  }

  fab.addEventListener("click", openModal);
  backdrop.addEventListener("click", closeModal);
  document.getElementById("ve-qa-close").addEventListener("click", closeModal);
  document.addEventListener("keydown", function (e) {
    if (e.key === "Escape") closeModal();
  });

  // ── Task list rendering ───────────────────────────────────────────────────
  function refreshTaskLists() {
    var dash = document.getElementById("ve-tasks-section");
    var crew = document.getElementById("ve-mytasks-section");
    if (dash) loadDashTasks(dash);
    if (crew) loadCrewTasks(crew);
  }

  function formatDueLabel(due) {
    if (!due) return "No due date";
    var d = new Date(due.slice(0, 10) + "T00:00:00");
    var today = new Date(); today.setHours(0,0,0,0);
    var diff  = Math.round((d - today) / 86400000);
    if (diff < 0)  return "Due " + Math.abs(diff) + " day" + (Math.abs(diff) !== 1 ? "s" : "") + " ago";
    if (diff === 0) return "Due today";
    if (diff === 1) return "Due tomorrow";
    return "Due " + d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
  }

  function taskGroup(t) {
    if (!t.due_date) return "upcoming";
    var d    = new Date(t.due_date.slice(0, 10) + "T00:00:00");
    var today = new Date(); today.setHours(0,0,0,0);
    var diff  = Math.round((d - today) / 86400000);
    if (diff < 0)  return "overdue";
    if (diff === 0) return "today";
    return "upcoming";
  }

  function renderTaskItem(t) {
    var isDone = t.status === "Done";
    var priDot = '<span class="qa-pri-dot ' + (t.priority||"medium") + '"></span>';
    var badge  = '<span class="qa-type-badge ' + esc(t.type) + '">' + esc(t.type) + '</span>';
    var dueLabel = t.due_date ? formatDueLabel(t.due_date) : "";
    var meta = badge + priDot + esc(t.assigned_to || "Unassigned");
    if (dueLabel) meta += " · " + dueLabel;
    return '<div class="qa-task-item" data-tid="' + esc(t.task_id) + '">' +
      '<button type="button" class="qa-task-done-btn' + (isDone ? " done" : "") + '" aria-label="Mark done" data-tid="' + esc(t.task_id) + '"></button>' +
      '<div class="qa-task-body">' +
        '<div class="qa-task-title' + (isDone ? " done" : "") + '">' + esc(t.title) + '</div>' +
        '<div class="qa-task-meta">' + meta + '</div>' +
      '</div>' +
    '</div>';
  }

  function attachDoneButtons(container) {
    container.querySelectorAll(".qa-task-done-btn").forEach(function (btn) {
      btn.addEventListener("click", function () {
        var tid = btn.dataset.tid;
        btn.classList.add("done");
        var item = container.querySelector('.qa-task-item[data-tid="' + tid + '"]');
        if (item) {
          var titleEl = item.querySelector(".qa-task-title");
          if (titleEl) titleEl.classList.add("done");
        }
        fetch(TASKS_BASE + "/" + encodeURIComponent(tid), {
          method: "PATCH", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ status: "Done" }),
        }).catch(function () {});
      });
    });
  }

  function renderGroups(tasks, container) {
    var groups = { overdue: [], today: [], upcoming: [] };
    tasks.forEach(function (t) { groups[taskGroup(t)].push(t); });

    var html = "";
    if (groups.overdue.length) {
      html += '<div class="qa-task-group-label overdue">Overdue (' + groups.overdue.length + ')</div>';
      html += groups.overdue.map(renderTaskItem).join("");
    }
    if (groups.today.length) {
      html += '<div class="qa-task-group-label today">Today (' + groups.today.length + ')</div>';
      html += groups.today.map(renderTaskItem).join("");
    }
    if (groups.upcoming.length) {
      html += '<div class="qa-task-group-label upcoming">Upcoming (' + groups.upcoming.length + ')</div>';
      html += groups.upcoming.map(renderTaskItem).join("");
    }
    if (!tasks.length) {
      html = '<div class="qa-tasks-empty">No open tasks — you\'re all caught up!</div>';
    }
    container.innerHTML = html;
    attachDoneButtons(container);
  }

  function loadDashTasks(section) {
    section.innerHTML = '<div class="qa-tasks-loading">Loading tasks…</div>';
    fetch("/api/tasks?status=open")
      .then(function (r) { return r.json(); })
      .then(function (d) { renderGroups(d.tasks || [], section); })
      .catch(function () { section.innerHTML = '<div class="qa-tasks-empty">Could not load tasks.</div>'; });
  }

  function loadCrewTasks(section) {
    section.innerHTML = '<div class="qa-tasks-loading">Loading tasks…</div>';
    fetch("/api/crew/tasks")
      .then(function (r) { return r.json(); })
      .then(function (d) { renderGroups(d.tasks || [], section); })
      .catch(function () { section.innerHTML = '<div class="qa-tasks-empty">Could not load tasks.</div>'; });
  }

  // ── Auto-init task lists on DOMReady (or immediate if already ready) ──────
  function tryInitTaskLists() {
    var dash = document.getElementById("ve-tasks-section");
    var crew = document.getElementById("ve-mytasks-section");
    if (dash) loadDashTasks(dash);
    if (crew) loadCrewTasks(crew);
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", tryInitTaskLists);
  } else {
    tryInitTaskLists();
  }

  // Expose for external refresh calls
  window.VE_QuickAdd = { refresh: refreshTaskLists, open: openModal };

  // ── Estimate Wizard (CRM only) ────────────────────────────────────────────

  function loadEstimatorConfig(cb) {
    if (_estConfig) { cb(_estConfig); return; }
    fetch("/api/estimator/config")
      .then(function (r) { return r.json(); })
      .then(function (d) {
        if (d.ok) { _estConfig = d; }
        cb(_estConfig || { services: [], modules: {} });
      })
      .catch(function () { cb({ services: [], modules: {} }); });
  }

  function buildQuestionsHtml(svc, modulesById) {
    if (!svc || !svc.modules || !svc.modules.length) return "";
    var html = '<div style="display:flex;flex-direction:column;gap:12px;">';
    svc.modules.forEach(function (mid) {
      var mod = modulesById[mid];
      if (!mod) return;
      var question   = mod.question  || mid;
      var inputType  = (mod.input_type || "text").toLowerCase();
      var optionsRaw = mod.options_json || "";
      var options    = [];
      try { options = optionsRaw ? JSON.parse(optionsRaw) : []; } catch (e) { options = []; }

      html += '<div class="qa-q-block" data-mid="' + esc(mid) + '">';
      html += '<div class="qa-q-label">' + esc(question) + '</div>';

      if ((inputType === "select" || inputType === "radio" || inputType === "single_select") && options.length) {
        var saved = moduleAnswers[mid] || "";
        html += '<select class="qa-q-sel-inp" data-mid="' + esc(mid) + '">';
        html += '<option value="">— Select —</option>';
        options.forEach(function (opt) {
          var selAttr = (String(opt) === String(saved)) ? " selected" : "";
          html += '<option value="' + esc(opt) + '"' + selAttr + '>' + esc(opt) + '</option>';
        });
        html += '</select>';
      } else if (inputType === "number") {
        var numVal = moduleAnswers[mid] || "";
        html += '<input class="qa-input qa-q-num-inp" type="number" data-mid="' + esc(mid) + '" value="' + esc(numVal) + '" placeholder="Enter value…" style="max-width:160px;" />';
      } else {
        var txtVal = moduleAnswers[mid] || "";
        html += '<input class="qa-input qa-q-txt-inp" type="text" data-mid="' + esc(mid) + '" value="' + esc(txtVal) + '" placeholder="Enter answer…" />';
      }
      html += '</div>';
    });
    html += '</div>';
    return html;
  }

  function _schedulePriceCalc() {
    if (_estPricingTimer) clearTimeout(_estPricingTimer);
    _estPricingTimer = setTimeout(function () { calcEstPrice(); }, 350);
  }

  function calcEstPrice() {
    var svc = selectedService;
    if (!svc || !svc.service_id) return;

    var noteEl   = document.getElementById("qa-price-note");
    var amountEl = document.getElementById("qa-price-amount");
    if (!amountEl) return;

    if (noteEl) noteEl.textContent = "Calculating…";

    fetch("/api/estimator/quote", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        segment:    svc.segment || "residential",
        service_id: svc.service_id,
        answers:    moduleAnswers,
      }),
    })
      .then(function (r) { return r.json(); })
      .then(function (d) {
        _estPriceResult = d;
        var amtEl2  = document.getElementById("qa-price-amount");
        var noteEl2 = document.getElementById("qa-price-note");
        if (!amtEl2) return;
        if (d.final_price) {
          amtEl2.textContent = "$" + Number(d.final_price).toLocaleString();
          if (noteEl2) noteEl2.textContent = "Final estimate";
        } else if (d.price_range) {
          amtEl2.textContent = "$" + Number(d.price_range.low).toLocaleString() + "–$" + Number(d.price_range.high).toLocaleString();
          if (noteEl2) noteEl2.textContent = "Price range";
        } else if (d.manual_review) {
          amtEl2.textContent = "Manual Review";
          if (noteEl2) noteEl2.textContent = d.reason || "Requires custom quote";
        } else {
          amtEl2.textContent = "—";
          if (noteEl2) noteEl2.textContent = d.error || "Unable to price";
        }
      })
      .catch(function () {
        var amtEl3  = document.getElementById("qa-price-amount");
        var noteEl3 = document.getElementById("qa-price-note");
        if (amtEl3) amtEl3.textContent = "—";
        if (noteEl3) noteEl3.textContent = "Price unavailable";
      });
  }

  function wireQuestionEvents() {
    var form = document.getElementById("ve-qa-form");
    if (!form) return;

    // Dropdown selects for single_select/select/radio module questions
    form.querySelectorAll(".qa-q-sel-inp").forEach(function (sel) {
      sel.addEventListener("change", function () {
        moduleAnswers[sel.dataset.mid] = sel.value;
        _schedulePriceCalc();
      });
    });

    // Number inputs
    form.querySelectorAll(".qa-q-num-inp").forEach(function (inp2) {
      inp2.addEventListener("input", function () {
        moduleAnswers[inp2.dataset.mid] = inp2.value;
        _schedulePriceCalc();
      });
    });

    // Text inputs
    form.querySelectorAll(".qa-q-txt-inp").forEach(function (inp3) {
      inp3.addEventListener("input", function () {
        moduleAnswers[inp3.dataset.mid] = inp3.value;
        _schedulePriceCalc();
      });
    });
  }

  // ── Invoice form helpers ──────────────────────────────────────────────────

  function buildInvoiceFormHtml() {
    var today   = new Date().toISOString().slice(0, 10);
    var dueDate = new Date(Date.now() + 30 * 24 * 3600000).toISOString().slice(0, 10);
    var invNum  = "INV-" + String(Date.now()).slice(-6);
    var h = "";
    h += fld("Client", '<div class="qa-combo-wrap">' +
      '<input class="qa-input qa-inv-editable" id="qa-inv-client-search" placeholder="Search or type client name…" autocomplete="off">' +
      '<div class="qa-combo-list" id="qa-inv-combo-list"></div>' +
      '<input type="hidden" id="qa-inv-client">' +
    '</div>');
    h += '<div class="qa-row">' +
      fld("Name", '<input class="qa-input qa-inv-editable" id="qa-inv-name" placeholder="Client name" autocomplete="off">') +
      fld("Phone", '<input class="qa-input qa-inv-editable" id="qa-inv-phone" placeholder="(555) 000-0000" autocomplete="off">') +
    '</div>';
    h += fld("Address", '<input class="qa-input qa-inv-editable" id="qa-inv-address" placeholder="Service address" autocomplete="off">');
    h += '<div class="qa-wiz-divider"></div>';
    h += '<div class="qa-row" style="grid-template-columns:1fr 1fr 1fr;">' +
      fld("Invoice #", '<input class="qa-input qa-inv-editable" id="qa-inv-number" value="' + esc(invNum) + '" autocomplete="off">') +
      fld("Date",      '<input class="qa-input" id="qa-inv-date" type="date" value="' + today + '">') +
      fld("Due Date",  '<input class="qa-input" id="qa-inv-due"  type="date" value="' + dueDate + '">') +
    '</div>';
    h += '<div class="qa-wiz-divider"></div>';
    h += '<div class="qa-label">Line Items</div>';
    h += '<div class="qa-inv-line-row" style="margin-bottom:4px;">' +
      '<span class="qa-inv-col-hdr">Description</span>' +
      '<span class="qa-inv-col-hdr" style="text-align:center">Qty</span>' +
      '<span class="qa-inv-col-hdr" style="text-align:right">Rate</span>' +
      '<span class="qa-inv-col-hdr" style="text-align:right">Total</span>' +
      '<span></span>' +
    '</div>';
    h += '<div id="qa-inv-lines"></div>';
    h += '<button type="button" class="qa-inv-add-btn" id="qa-inv-add-line">+ Add Item</button>';
    h += '<div class="qa-wiz-divider"></div>';
    h += '<div class="qa-row" style="grid-template-columns:minmax(0,1fr) 90px;align-items:end;">' +
      '<div class="qa-inv-totals">' +
        '<div class="qa-inv-total-row"><span>Subtotal</span><span class="qa-inv-total-amt" id="qa-inv-subtotal">$0.00</span></div>' +
        '<div class="qa-inv-total-row"><span>Tax</span><span class="qa-inv-total-amt" id="qa-inv-tax-amt">$0.00</span></div>' +
        '<div class="qa-inv-total-row grand"><span>Total</span><span class="qa-inv-total-amt" id="qa-inv-total">$0.00</span></div>' +
      '</div>' +
      fld("Tax %", '<input class="qa-input" id="qa-inv-tax" type="number" value="0" min="0" max="100" style="text-align:right;">') +
    '</div>';
    h += fld("Notes", textarea("qa-inv-notes", "Any additional notes…"));
    return h;
  }

  function addInvoiceLine(desc, qty, rate) {
    var linesEl = document.getElementById("qa-inv-lines");
    if (!linesEl) return;
    var row = document.createElement("div");
    row.className = "qa-inv-line-row";
    var q = (qty != null && qty !== "") ? qty : 1;
    var r = (rate != null && rate !== "") ? rate : "";
    row.innerHTML =
      '<input class="qa-input qa-inv-editable inv-line-desc" placeholder="Description" value="' + esc(desc || "") + '" style="font-size:13px;">' +
      '<input class="qa-input qa-inv-editable inv-line-qty"  type="number" value="' + q + '" min="0" step="0.01" style="text-align:center;font-size:13px;padding:8px 4px;">' +
      '<input class="qa-input qa-inv-editable inv-line-rate" type="number" value="' + esc(r) + '" min="0" step="0.01" placeholder="0.00" style="text-align:right;font-size:13px;padding:8px 6px;">' +
      '<span class="qa-inv-line-total">$0.00</span>' +
      '<button type="button" class="qa-inv-remove-btn" title="Remove">\u00d7</button>';
    function updateLine() {
      var qty2  = parseFloat(row.querySelector(".inv-line-qty").value)  || 0;
      var rate2 = parseFloat(row.querySelector(".inv-line-rate").value) || 0;
      row.querySelector(".qa-inv-line-total").textContent = "$" + (qty2 * rate2).toFixed(2);
      calcInvoiceTotals();
    }
    row.querySelector(".inv-line-qty").addEventListener("input",  updateLine);
    row.querySelector(".inv-line-rate").addEventListener("input", updateLine);
    row.querySelector(".qa-inv-remove-btn").addEventListener("click", function () { row.remove(); calcInvoiceTotals(); });
    updateLine();
    linesEl.appendChild(row);
  }

  function calcInvoiceTotals() {
    var subtotal = 0;
    (document.querySelectorAll("#qa-inv-lines .qa-inv-line-row") || []).forEach(function (row) {
      subtotal += (parseFloat(row.querySelector(".inv-line-qty")?.value)  || 0) *
                  (parseFloat(row.querySelector(".inv-line-rate")?.value) || 0);
    });
    var taxPct = parseFloat(document.getElementById("qa-inv-tax")?.value) || 0;
    var taxAmt = subtotal * taxPct / 100;
    var total  = subtotal + taxAmt;
    var sub = document.getElementById("qa-inv-subtotal");
    var txa = document.getElementById("qa-inv-tax-amt");
    var tot = document.getElementById("qa-inv-total");
    if (sub) sub.textContent = "$" + subtotal.toFixed(2);
    if (txa) txa.textContent = "$" + taxAmt.toFixed(2);
    if (tot) tot.textContent = "$" + total.toFixed(2);
  }

  var _invClients = [];

  function afterInvoiceRender() {
    // Add one default empty line
    addInvoiceLine("", 1, "");

    // + Add Item button
    var addBtn = document.getElementById("qa-inv-add-line");
    if (addBtn) addBtn.addEventListener("click", function () { addInvoiceLine("", 1, ""); });

    // Tax % → recalc
    var taxInp = document.getElementById("qa-inv-tax");
    if (taxInp) taxInp.addEventListener("input", calcInvoiceTotals);

    // Combobox wiring
    var srchEl  = document.getElementById("qa-inv-client-search");
    var listEl  = document.getElementById("qa-inv-combo-list");
    var hiddenEl= document.getElementById("qa-inv-client");
    if (!srchEl || !listEl) return;

    var _hlIdx = -1;

    function renderComboOpts(term) {
      var q = (term || "").toLowerCase().trim();
      var filtered = q ? _invClients.filter(function (c) {
        return (c.name || "").toLowerCase().includes(q) ||
               (c.phone || "").includes(q) ||
               (c.address || "").toLowerCase().includes(q);
      }) : _invClients;
      _hlIdx = -1;
      if (!filtered.length) {
        listEl.innerHTML = '<div class="qa-combo-no-res">No clients found</div>';
      } else {
        listEl.innerHTML = filtered.slice(0, 30).map(function (c, i) {
          var sub = [c.phone, c.address].filter(Boolean).join(" · ");
          return '<div class="qa-combo-opt" data-idx="' + i + '">' +
            '<div>' + esc(c.name || c.id || "—") + '</div>' +
            (sub ? '<div class="qa-combo-opt-sub">' + esc(sub) + '</div>' : '') +
          '</div>';
        }).join("");
        listEl.querySelectorAll(".qa-combo-opt").forEach(function (opt, i) {
          opt.addEventListener("mousedown", function (e) {
            e.preventDefault();
            selectClient(filtered[i]);
          });
        });
      }
      listEl.classList.add("open");
    }

    function selectClient(c) {
      if (!c) return;
      srchEl.value  = c.name || "";
      hiddenEl.value= c.id   || "";
      listEl.classList.remove("open");
      var nameEl  = document.getElementById("qa-inv-name");
      var phoneEl = document.getElementById("qa-inv-phone");
      var addrEl  = document.getElementById("qa-inv-address");
      if (nameEl)  nameEl.value  = c.name    || "";
      if (phoneEl) phoneEl.value = c.phone   || "";
      if (addrEl)  addrEl.value  = c.address || "";
      // Auto-populate line items from client's most recent invoice
      if (c.id) {
        fetch("/api/invoices?client_id=" + encodeURIComponent(c.id))
          .then(function (r) { return r.json(); })
          .then(function (d) {
            var invs = Array.isArray(d) ? d : (d.invoices || []);
            if (!invs.length) return;
            // Sort descending by issued_at and take the most recent
            invs.sort(function (a, b) {
              return new Date(b.issued_at || 0) - new Date(a.issued_at || 0);
            });
            var last = invs[0];
            var lines = [];
            try { lines = JSON.parse(last.line_items_json || "[]"); } catch (_) {}
            if (!lines.length && last.subtotal) {
              lines = [{ description: last.description || last.notes || "Service", qty: 1, rate: Number(last.subtotal) || 0 }];
            }
            if (lines.length) {
              document.getElementById("qa-inv-lines").innerHTML = "";
              lines.forEach(function (li) {
                addInvoiceLine(
                  li.description || li.title || "",
                  li.qty != null ? li.qty : 1,
                  li.rate != null ? li.rate : (li.unit_price || li.amount || 0)
                );
              });
            }
          })
          .catch(function () {});
      }
    }

    srchEl.addEventListener("focus", function () { renderComboOpts(srchEl.value); });
    srchEl.addEventListener("input", function () { hiddenEl.value = ""; renderComboOpts(srchEl.value); });
    srchEl.addEventListener("blur",  function () { setTimeout(function () { listEl.classList.remove("open"); }, 150); });
    srchEl.addEventListener("keydown", function (e) {
      var opts = listEl.querySelectorAll(".qa-combo-opt");
      if (e.key === "ArrowDown") {
        e.preventDefault();
        _hlIdx = Math.min(_hlIdx + 1, opts.length - 1);
        opts.forEach(function (o, i) { o.classList.toggle("hl", i === _hlIdx); });
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        _hlIdx = Math.max(_hlIdx - 1, 0);
        opts.forEach(function (o, i) { o.classList.toggle("hl", i === _hlIdx); });
      } else if (e.key === "Enter" && _hlIdx >= 0) {
        e.preventDefault();
        var q = (srchEl.value || "").toLowerCase().trim();
        var filtered = q ? _invClients.filter(function (c) {
          return (c.name || "").toLowerCase().includes(q) ||
                 (c.phone || "").includes(q) ||
                 (c.address || "").toLowerCase().includes(q);
        }) : _invClients;
        if (filtered[_hlIdx]) selectClient(filtered[_hlIdx]);
      } else if (e.key === "Escape") {
        listEl.classList.remove("open");
      }
    });

    // Load clients from /api/clients
    fetch("/api/clients")
      .then(function (r) { return r.json(); })
      .then(function (d) {
        _invClients = (Array.isArray(d) ? d : (d.clients || [])).map(function (c) {
          return {
            id:      c.id      || c.client_id || "",
            name:    c.name    || "",
            phone:   c.phone   || "",
            address: c.address || c.service_address || "",
          };
        });
      })
      .catch(function () {});
  }

  function afterEstimateRender() {
    var formEl = document.getElementById("ve-qa-form");
    if (!formEl) return;

    if (estimateStep === 1) {
      // Populate service grid
      loadEstimatorConfig(function (cfg) {
        var grid = document.getElementById("qa-svc-grid");
        if (!grid) return;
        var services = (cfg.services || []).filter(function (s) { return s.enabled !== false; });
        if (!services.length) {
          grid.innerHTML = '<div class="qa-svc-loading">No services found. Check Estimator sheet.</div>';
          return;
        }
        grid.innerHTML = services.map(function (s) {
          return '<button type="button" class="qa-svc-card" data-svc-id="' + esc(s.service_id) + '">' +
            esc(s.service_name) +
            (s.tier ? '<div class="qa-svc-tier">' + esc(s.tier) + '</div>' : '') +
          '</button>';
        }).join("");
        // Store full service objects by id for lookup
        grid._svcMap = {};
        services.forEach(function (s) { grid._svcMap[s.service_id] = s; });
        // Wire card clicks
        grid.querySelectorAll(".qa-svc-card").forEach(function (card) {
          card.addEventListener("click", function () {
            var svcId = card.dataset.svcId;
            var svc   = (cfg.services || []).find(function (s) { return s.service_id === svcId; });
            if (!svc) return;
            selectedService = svc;
            moduleAnswers   = {};
            _estPriceResult = null;
            estimateStep    = 2;
            renderForm();
          });
        });
      });

    } else if (estimateStep === 2) {
      // Wire back button
      var backBtn = document.getElementById("qa-wiz-back");
      if (backBtn) {
        backBtn.addEventListener("click", function () {
          estimateStep    = 1;
          selectedService = null;
          moduleAnswers   = {};
          _estPriceResult = null;
          renderForm();
        });
      }

      // Populate question container
      var qContainer = document.getElementById("qa-q-container");
      if (qContainer && selectedService && _estConfig) {
        qContainer.innerHTML = buildQuestionsHtml(selectedService, _estConfig.modules || {});
        wireQuestionEvents();
        // Try initial price calc if we have enough answers
        if (Object.keys(moduleAnswers).length > 0) calcEstPrice();
      }

      // Wire submit
      var submitBtn = document.getElementById("ve-qa-submit");
      if (submitBtn) {
        submitBtn.addEventListener("click", submitQuickAdd);
      }
    }
  }
})();

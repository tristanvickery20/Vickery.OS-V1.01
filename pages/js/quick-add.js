// Quick Add — Universal floating FAB + modal for all CRM & crew pages
// Injected by shell.js on CRM pages; loaded directly on crew.html
(function () {
  if (document.getElementById("ve-qa-modal")) return; // already mounted

  // ── Styles ─────────────────────────────────────────────────────────────────
  var style = document.createElement("style");
  style.textContent = [
    /* FAB */
    "#ve-qa-fab{position:fixed;bottom:24px;right:20px;z-index:900;width:52px;height:52px;border-radius:50%;",
    "background:#2d6ae0;border:none;color:#fff;font-size:26px;line-height:1;cursor:pointer;",
    "box-shadow:0 4px 18px rgba(45,106,224,.55);display:flex;align-items:center;justify-content:center;",
    "transition:transform .15s,box-shadow .15s;font-family:inherit;}",
    "#ve-qa-fab:hover{transform:scale(1.08);box-shadow:0 6px 24px rgba(45,106,224,.7);}",
    "#ve-qa-fab:active{transform:scale(.96);}",
    /* Backdrop */
    "#ve-qa-backdrop{position:fixed;inset:0;background:rgba(0,0,0,.55);z-index:910;display:none;}",
    "#ve-qa-backdrop.open{display:block;}",
    /* Modal */
    "#ve-qa-modal{position:fixed;left:50%;bottom:0;transform:translateX(-50%) translateY(100%);",
    "z-index:920;width:100%;max-width:520px;background:#111827;border:1px solid rgba(255,255,255,.1);",
    "border-radius:20px 20px 0 0;padding:20px 20px 36px;transition:transform .28s cubic-bezier(.2,.8,.4,1);",
    "max-height:92dvh;overflow-y:auto;}",
    "#ve-qa-modal.open{transform:translateX(-50%) translateY(0);}",
    "@media(min-width:600px){",
    "#ve-qa-modal{bottom:auto;top:50%;border-radius:16px;transform:translateX(-50%) translateY(calc(-50% + 40px));max-height:88dvh;}",
    "#ve-qa-modal.open{transform:translateX(-50%) translateY(-50%);}}",
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
    { id: "Meeting",        label: "Meeting",        cls: "mtg" },
    { id: "Callback",       label: "Callback",       cls: "cb"  },
    { id: "Personal Block", label: "Personal Block", cls: "blk" },
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

    } else if (currentType === "Estimate") {
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
        fld("Est. Date", inp("qa-f-due", "date", "", tomorrowStr())) +
        fld("Time", inp("qa-f-time", "time", "", "09:00")) +
      '</div>';
      html += fld("Duration (min)", inp("qa-f-dur", "number", "60", "60", "min='15' max='480' step='15'"));
      html += fld("Notes", textarea("qa-f-notes", "What work is needed?"));
      html += '<div style="font-size:11px;color:#475569;margin-top:-4px;">Reminders flagged: 24h before and 1h before.</div>';

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

    } else if (currentType === "Personal Block") {
      html += fld("Description *", inp("qa-f-title", "text", "e.g. Dentist, Family event…", "", "autocomplete='off'"));
      html += fld("Date *", inp("qa-f-due", "date", "", todayStr()));
      html += '<div class="qa-row">' +
        fld("Start Time", inp("qa-f-time", "time", "", nextHourStr())) +
        fld("End Time", inp("qa-f-time-end", "time", "", nextHourEndStr())) +
      '</div>';
      html += fld("Notes", textarea("qa-f-notes", "Any extra details…"));
    }

    html += '<button type="button" class="qa-submit" id="ve-qa-submit">Add ' + currentType + '</button>';

    formEl.innerHTML = html;

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

    // Submit
    document.getElementById("ve-qa-submit").addEventListener("click", submitQuickAdd);
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

    } else if ((currentType === "Estimate" || currentType === "Job") && !IS_CREW) {
      // CRM context: create a proper lead record
      var name = g("qa-f-name");
      if (!name) { showErr("Client name is required."); btn.disabled = false; btn.textContent = "Add " + currentType; return; }
      var durMin = g("qa-f-dur") || (currentType === "Estimate" ? "60" : "120");
      var schedDate = g("qa-f-due");
      var schedTime = g("qa-f-time");
      var schedDT = schedDate + (schedTime ? "T" + schedTime : "");
      var baseNotes = g("qa-f-notes");
      var notesWithDur = (baseNotes ? baseNotes + "\n" : "") + "Duration: " + durMin + " min";
      if (currentType === "Estimate") {
        notesWithDur += "\nreminders:24h,1h";
      }
      promise = fetch("/api/leads", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: name, phone: g("qa-f-phone"),
          address: g("qa-f-addr"), job_type: g("qa-f-jtype"),
          status: "New", notes: notesWithDur,
          scheduled_date: schedDT,
          assigned_to: currentType === "Job" ? (getAssignedNames()[0] || "") : "",
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

    } else {
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
    }

    promise.then(function (data) {
      if (data.ok) {
        showOk("Created! " + (currentType === "Estimate" || currentType === "Job"
          ? "Lead saved." : "Task saved."));
        setTimeout(function () {
          closeModal();
          refreshTaskLists();
        }, 900);
      } else {
        showErr(data.error || "Something went wrong.");
        btn.disabled = false;
        btn.textContent = "Add " + currentType;
      }
    }).catch(function (err) {
      showErr("Network error: " + err.message);
      btn.disabled = false;
      btn.textContent = "Add " + currentType;
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
})();

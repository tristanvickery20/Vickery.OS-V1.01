(() => {
  const PANEL_ID = "pipelineCloseoutControl";
  const STYLE_ID = "pipelineCloseoutControlStyles";

  const STAGE_ORDER = [
    "New Lead",
    "Qualified",
    "Quoted",
    "Needs Review",
    "Accepted",
    "Scheduled",
    "Prepped",
    "In Progress",
    "Complete",
    "Invoiced",
    "Paid",
    "Closed",
    "Review Requested",
    "Retention",
  ];

  const STAGE_MAP = [
    { match: /new leads needing response/i, stage: "New Lead", gate: "New Lead → Qualified", key: "new_leads_needing_response" },
    { match: /quotes needing follow-up/i, stage: "Quoted", gate: "Quoted → Accepted", key: "quotes_needing_followup" },
    { match: /manual review quote requests/i, stage: "Needs Review", gate: "Needs Review → Accepted", key: "manual_review_quote_requests" },
    { match: /incomplete estimator sessions/i, stage: "Quoted", gate: "Quoted → Accepted", key: "incomplete_estimator_sessions" },
    { match: /accepted quotes not scheduled/i, stage: "Accepted", gate: "Accepted → Scheduled", key: "accepted_not_scheduled" },
    { match: /today's jobs|tomorrow's jobs/i, stage: "Scheduled", gate: "Scheduled → Prepped", key: "scheduled_work" },
    { match: /scheduled jobs missing assigned tech/i, stage: "Scheduled", gate: "Scheduled → Prepped", key: "scheduled_missing_assignment" },
    { match: /jobs missing required deposit/i, stage: "Accepted", gate: "Accepted/Scheduled → Prepped", key: "scheduled_missing_deposit" },
    { match: /completed jobs not invoiced/i, stage: "Complete", gate: "Complete → Invoiced", key: "completed_not_invoiced" },
    { match: /completed jobs missing time entries/i, stage: "Complete", gate: "Complete → Invoiced", key: "completed_missing_time" },
    { match: /expenses missing receipts/i, stage: "Complete", gate: "Complete → Invoiced", key: "expenses_missing_receipts" },
    { match: /open invoices/i, stage: "Invoiced", gate: "Invoiced → Paid", key: "invoiced_not_paid" },
    { match: /sent invoices not paid/i, stage: "Invoiced", gate: "Invoiced → Paid", key: "sent_invoices_not_paid" },
    { match: /overdue invoices/i, stage: "Invoiced", gate: "Invoiced → Paid", key: "overdue_invoices" },
    { match: /paid jobs not closed/i, stage: "Paid", gate: "Paid → Closed", key: "paid_not_closed" },
  ];

  const LIMITED_ITEMS = [
    {
      key: "qualification_gate_limited",
      stage: "Qualified",
      gate: "Qualified → Quoted",
      severity: "info",
      title: "Qualification gate is limited",
      count: null,
      reason: "A complete qualified/unqualified stage gate is not clearly implemented yet. Current checks rely on available status fields.",
      href: "/clients",
      status: "limited",
    },
    {
      key: "prep_materials_gate_limited",
      stage: "Prepped",
      gate: "Scheduled → Prepped",
      severity: "info",
      title: "Prep/materials gate is limited",
      count: null,
      reason: "Dedicated prep/materials status fields were not clearly found, so prep readiness cannot be fully enforced yet.",
      href: "/crm/schedule",
      status: "limited",
    },
    {
      key: "in_progress_gate_limited",
      stage: "In Progress",
      gate: "Prepped → In Progress",
      severity: "info",
      title: "In-progress gate is limited",
      count: null,
      reason: "In-progress visibility depends on current status and time-entry data; a full field execution checklist is not clearly implemented yet.",
      href: "/crm/schedule",
      status: "limited",
    },
    {
      key: "final_notes_photos_limited",
      stage: "Complete",
      gate: "Complete → Invoiced",
      severity: "info",
      title: "Final notes/photos gate is limited",
      count: null,
      reason: "Final notes/photos can only be enforced where attachment or note fields are clearly available. Full closeout checklist is not yet implemented.",
      href: "/clients",
      status: "limited",
    },
    {
      key: "review_request_limited",
      stage: "Review Requested",
      gate: "Closed → Review Requested",
      severity: "info",
      title: "Review-request handoff is limited",
      count: null,
      reason: "Review APIs exist, but a per-job review-request completion flag is not clearly available in this lifecycle check.",
      href: "/reviews",
      status: "limited",
    },
    {
      key: "retention_handoff_limited",
      stage: "Retention",
      gate: "Review Requested → Retention",
      severity: "info",
      title: "Retention handoff is not clearly implemented yet",
      count: null,
      reason: "Long-term retention or year-5 retouch fields were not clearly found in the current pipeline data.",
      href: "/clients",
      status: "limited",
    },
  ];

  const CHECKLIST_DEFS = [
    {
      key: "accepted_not_scheduled",
      stage: "Accepted → Scheduled",
      severity: "critical",
      title: "Accepted work is not scheduled",
      reason: "Accepted quotes should be scheduled before they go stale.",
      href: "/crm/schedule",
    },
    {
      key: "scheduled_missing_assignment",
      stage: "Scheduled → Prepped",
      severity: "critical",
      title: "Scheduled work is missing an assigned tech",
      reason: "Scheduled jobs need a clear owner before dispatch.",
      href: "/crm/schedule",
    },
    {
      key: "scheduled_missing_deposit",
      stage: "Accepted/Scheduled → Prepped",
      severity: "critical",
      title: "Deposit-required work is missing deposit",
      reason: "Deposit-required jobs should not move forward without payment or an intentional override.",
      href: "/clients",
    },
    {
      key: "completed_not_invoiced",
      stage: "Complete → Invoiced",
      severity: "critical",
      title: "Completed work is not invoiced",
      reason: "Completed jobs should be invoiced quickly so cash is not delayed.",
      href: "/invoices",
    },
    {
      key: "completed_missing_time",
      stage: "Complete → Invoiced",
      severity: "warning",
      title: "Completed work is missing time entries",
      reason: "Missing time entries make job costing and closeout unreliable.",
      href: "/crm/time",
    },
    {
      key: "invoiced_not_paid",
      stage: "Invoiced → Paid",
      severity: "warning",
      title: "Invoices are open or unpaid",
      reason: "Open invoices should be followed until collected.",
      href: "/invoices",
    },
    {
      key: "overdue_invoices",
      stage: "Invoiced → Paid",
      severity: "critical",
      title: "Invoices are overdue",
      reason: "Overdue invoices need collection follow-up.",
      href: "/invoices?status=overdue",
    },
    {
      key: "paid_not_closed",
      stage: "Paid → Closed",
      severity: "warning",
      title: "Paid jobs are not closed",
      reason: "Paid jobs should be closed after job costing, review request, and retention handoff are handled.",
      href: "/clients",
    },
  ];

  const CHECKLIST_LIMITED = [
    {
      key: "scheduled_missing_confirmation",
      stage: "Scheduled → Prepped",
      title: "Confirmation check limited",
      reason: "No dedicated customer-confirmation field is clearly available in the current dashboard data.",
      href: "/crm/schedule",
    },
    {
      key: "scheduled_missing_prep_materials",
      stage: "Scheduled → Prepped",
      title: "Prep/materials check limited",
      reason: "No dedicated prep or materials-ready field is clearly available in the current dashboard data.",
      href: "/crm/schedule",
    },
    {
      key: "completed_missing_expenses",
      stage: "Complete → Invoiced",
      title: "Expense/material check limited",
      reason: "Expense/material records exist, but not every small job will require materials. Treat this as a review signal, not automatic failure.",
      href: "/crm/expenses",
    },
    {
      key: "completed_missing_photos_or_notes",
      stage: "Complete → Invoiced",
      title: "Final notes/photos check limited",
      reason: "No dedicated final-notes or final-photo completion field is clearly available in the current dashboard data.",
      href: "/clients",
    },
    {
      key: "review_request_missing",
      stage: "Closed → Review Requested",
      title: "Review-request tracking limited",
      reason: "No per-job review-request field is clearly available in the current lifecycle data.",
      href: "/reviews",
    },
    {
      key: "retention_handoff_missing",
      stage: "Review Requested → Retention",
      title: "Retention handoff not clearly implemented yet",
      reason: "No per-job retention or future follow-up field is clearly available in the current lifecycle data.",
      href: "/clients",
    },
  ];

  function esc(s) {
    return String(s ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function severityRank(sev) {
    const s = String(sev || "info").toLowerCase();
    if (s === "critical") return 0;
    if (s === "warning") return 1;
    return 2;
  }

  function normalizeItem(item) {
    const title = String(item?.title || "");
    const found = STAGE_MAP.find((rule) => rule.match.test(title));
    if (!found) return null;
    return {
      key: found.key,
      stage: found.stage,
      gate: found.gate,
      severity: String(item.severity || "info").toLowerCase(),
      title: title || "Lifecycle issue",
      count: item.count,
      reason: item.reason || "This lifecycle item needs review.",
      href: item.href || "#",
      status: item.status || "active",
      source: "owner_action_queue",
    };
  }

  function flattenLifecycleIssues(queue) {
    const systems = Array.isArray(queue?.systems) ? queue.systems : [];
    const active = [];

    for (const system of systems) {
      for (const item of (system.items || [])) {
        const normalized = normalizeItem(item);
        if (!normalized) continue;
        if (normalized.status !== "active" || !(Number(normalized.count) > 0)) continue;
        active.push(normalized);
      }
    }

    active.sort((a, b) => severityRank(a.severity) - severityRank(b.severity));
    return [...active, ...LIMITED_ITEMS];
  }

  function stageHealth(issues, stage) {
    const active = issues.filter((i) => i.stage === stage && i.status !== "limited");
    if (active.some((i) => i.severity === "critical")) return "critical";
    if (active.some((i) => i.severity === "warning")) return "warning";
    if (issues.some((i) => i.stage === stage && i.status === "limited")) return "limited";
    return "clear";
  }

  function queueItemsByKey(queue) {
    const out = {};
    const systems = Array.isArray(queue?.systems) ? queue.systems : [];
    for (const system of systems) {
      for (const item of (system.items || [])) {
        const normalized = normalizeItem(item);
        if (!normalized) continue;
        out[normalized.key] = normalized;
      }
    }
    return out;
  }

  function deriveChecklistFromQueue(queue) {
    const byKey = queueItemsByKey(queue);
    const checks = CHECKLIST_DEFS.map((def) => {
      const active = byKey[def.key];
      if (active && active.status === "active" && Number(active.count) > 0) {
        return {
          key: def.key,
          stage: def.stage,
          severity: active.severity || def.severity,
          title: def.title,
          count: active.count,
          reason: active.reason || def.reason,
          href: active.href || def.href,
          status: "active",
          source: "owner_action_queue",
        };
      }
      return {
        key: def.key,
        stage: def.stage,
        severity: def.severity,
        title: def.title,
        count: 0,
        reason: "No active blocker for this check was found in the current Owner Action Queue.",
        href: def.href,
        status: "clear",
        source: "owner_action_queue",
      };
    });

    for (const limited of CHECKLIST_LIMITED) {
      checks.push({
        key: limited.key,
        stage: limited.stage,
        severity: "info",
        title: limited.title,
        count: null,
        reason: limited.reason,
        href: limited.href,
        status: "limited",
        source: "limited_current_data",
      });
    }

    return {
      generated_at: new Date().toISOString(),
      source: "mapped_from_owner_action_queue",
      note: "This checklist is mapped from /api/today owner_action_queue until a dedicated server-side closeout_checklist response is wired in.",
      checks,
      active_count: checks.filter((c) => c.status === "active" && Number(c.count) > 0).length,
      critical_count: checks.filter((c) => c.status === "active" && c.severity === "critical" && Number(c.count) > 0).length,
      warning_count: checks.filter((c) => c.status === "active" && c.severity === "warning" && Number(c.count) > 0).length,
      limited_count: checks.filter((c) => c.status === "limited" || c.status === "unavailable").length,
    };
  }

  function normalizeChecklist(data) {
    const direct = data?.closeout_checklist || data?.lifecycle_gate_summary;
    if (direct && Array.isArray(direct.checks)) return direct;
    return deriveChecklistFromQueue(data?.owner_action_queue || null);
  }

  function injectStyles() {
    if (document.getElementById(STYLE_ID)) return;
    const style = document.createElement("style");
    style.id = STYLE_ID;
    style.textContent = `
      .lifecycle-control-card {
        margin-bottom:24px;
        padding:18px;
        border-radius:18px;
        border:1px solid rgba(74,222,128,.18);
        background:linear-gradient(180deg, rgba(34,197,94,.07), rgba(255,255,255,.025));
      }
      .lifecycle-control-head {
        display:flex;
        align-items:flex-start;
        justify-content:space-between;
        gap:14px;
        margin-bottom:14px;
      }
      .lifecycle-title {
        font-family:var(--font-display);
        font-size:18px;
        font-weight:900;
        letter-spacing:-.02em;
      }
      .lifecycle-sub {
        margin-top:3px;
        font-size:12px;
        line-height:1.4;
        color:rgba(230,238,252,.55);
      }
      .lifecycle-badge {
        flex:0 0 auto;
        border:1px solid rgba(74,222,128,.3);
        background:rgba(74,222,128,.10);
        color:#86efac;
        border-radius:999px;
        padding:5px 10px;
        font-size:12px;
        font-weight:850;
        white-space:nowrap;
      }
      .lifecycle-stage-strip {
        display:flex;
        gap:7px;
        overflow-x:auto;
        padding-bottom:8px;
        margin-bottom:12px;
        scrollbar-width:none;
      }
      .lifecycle-stage-strip::-webkit-scrollbar { display:none; }
      .lifecycle-stage {
        flex:0 0 auto;
        display:flex;
        align-items:center;
        gap:6px;
        padding:6px 9px;
        border-radius:999px;
        border:1px solid rgba(255,255,255,.08);
        background:rgba(255,255,255,.035);
        font-size:11px;
        font-weight:850;
        color:rgba(230,238,252,.62);
        white-space:nowrap;
      }
      .lifecycle-stage-dot {
        width:7px;
        height:7px;
        border-radius:99px;
        background:#94a3b8;
      }
      .lifecycle-stage.clear .lifecycle-stage-dot { background:#4ade80; }
      .lifecycle-stage.warning .lifecycle-stage-dot { background:#fbbf24; }
      .lifecycle-stage.critical .lifecycle-stage-dot { background:#fb7185; }
      .lifecycle-stage.limited .lifecycle-stage-dot { background:#60a5fa; }
      .lifecycle-issues,
      .closeout-checklist-grid {
        display:grid;
        grid-template-columns:repeat(2, minmax(0, 1fr));
        gap:10px;
      }
      @media (max-width: 780px) { .lifecycle-issues, .closeout-checklist-grid { grid-template-columns:1fr; } }
      .lifecycle-issue,
      .closeout-check {
        display:grid;
        grid-template-columns:auto 1fr auto;
        gap:10px;
        align-items:flex-start;
        text-decoration:none;
        color:inherit;
        border:1px solid rgba(255,255,255,.075);
        border-radius:13px;
        padding:11px;
        background:rgba(0,0,0,.08);
      }
      .lifecycle-issue:hover,
      .closeout-check:hover { border-color:rgba(74,222,128,.26); background:rgba(74,222,128,.055); }
      .lifecycle-sev,
      .closeout-sev {
        width:8px;
        height:8px;
        border-radius:50%;
        margin-top:5px;
        background:#60a5fa;
      }
      .lifecycle-sev.critical, .closeout-sev.critical { background:#fb7185; box-shadow:0 0 0 3px rgba(251,113,133,.11); }
      .lifecycle-sev.warning, .closeout-sev.warning { background:#fbbf24; box-shadow:0 0 0 3px rgba(251,191,36,.10); }
      .lifecycle-sev.info, .closeout-sev.info { background:#60a5fa; box-shadow:0 0 0 3px rgba(96,165,250,.10); }
      .lifecycle-gate,
      .closeout-stage {
        font-size:10px;
        font-weight:850;
        letter-spacing:.07em;
        text-transform:uppercase;
        color:rgba(134,239,172,.7);
        margin-bottom:3px;
      }
      .lifecycle-item-title,
      .closeout-title {
        font-size:13px;
        font-weight:900;
        line-height:1.25;
      }
      .lifecycle-reason,
      .closeout-reason {
        margin-top:4px;
        font-size:11px;
        color:rgba(230,238,252,.50);
        line-height:1.35;
      }
      .lifecycle-count,
      .closeout-count {
        min-width:30px;
        text-align:center;
        border-radius:999px;
        padding:3px 8px;
        background:rgba(255,255,255,.07);
        font-size:12px;
        font-weight:900;
      }
      .lifecycle-status,
      .closeout-status {
        margin-top:4px;
        font-size:9px;
        font-weight:850;
        text-transform:uppercase;
        letter-spacing:.05em;
        color:rgba(230,238,252,.38);
        text-align:right;
      }
      .lifecycle-empty,
      .lifecycle-error,
      .closeout-note {
        border:1px dashed rgba(255,255,255,.12);
        border-radius:14px;
        padding:16px;
        color:rgba(230,238,252,.55);
        font-size:13px;
      }
      .lifecycle-error { color:#fda4af; border-color:rgba(251,113,133,.25); }
      .closeout-checklist-section {
        margin-top:16px;
        padding-top:16px;
        border-top:1px solid rgba(255,255,255,.08);
      }
      .closeout-section-head {
        display:flex;
        align-items:flex-start;
        justify-content:space-between;
        gap:12px;
        margin-bottom:10px;
      }
      .closeout-heading {
        font-size:13px;
        font-weight:900;
        letter-spacing:.05em;
        text-transform:uppercase;
      }
      .closeout-note-mini {
        font-size:11px;
        color:rgba(230,238,252,.45);
        margin-top:3px;
        line-height:1.35;
      }
      .closeout-mini-badge {
        flex:0 0 auto;
        border:1px solid rgba(96,165,250,.3);
        background:rgba(96,165,250,.10);
        color:#93c5fd;
        border-radius:999px;
        padding:4px 9px;
        font-size:11px;
        font-weight:850;
        white-space:nowrap;
      }
    `;
    document.head.appendChild(style);
  }

  function findMountPoint() {
    const main = document.querySelector(".main-content");
    if (!main) return null;
    const ownerQueue = document.getElementById("ownerActionQueue");
    if (ownerQueue && ownerQueue.parentNode === main) return { main, after: ownerQueue };
    const firstSection = main.querySelector(".dash-section");
    return { main, before: firstSection };
  }

  function ensurePanel() {
    injectStyles();
    let panel = document.getElementById(PANEL_ID);
    if (panel) return panel;

    const mount = findMountPoint();
    if (!mount) return null;

    panel = document.createElement("section");
    panel.id = PANEL_ID;
    panel.className = "lifecycle-control-card";

    if (mount.after) mount.after.insertAdjacentElement("afterend", panel);
    else if (mount.before) mount.main.insertBefore(panel, mount.before);
    else mount.main.prepend(panel);

    return panel;
  }

  function renderLoading() {
    const panel = ensurePanel();
    if (!panel) return;
    panel.innerHTML = `
      <div class="lifecycle-control-head">
        <div>
          <div class="lifecycle-title">Pipeline / Closeout Control</div>
          <div class="lifecycle-sub">Checking current lifecycle blockers from existing queue data.</div>
        </div>
      </div>
      <div class="lifecycle-empty">Loading lifecycle controls&hellip;</div>
    `;
  }

  function renderError(message) {
    const panel = ensurePanel();
    if (!panel) return;
    panel.innerHTML = `
      <div class="lifecycle-control-head">
        <div>
          <div class="lifecycle-title">Pipeline / Closeout Control</div>
          <div class="lifecycle-sub">This panel uses existing Sheets-backed dashboard data only.</div>
        </div>
      </div>
      <div class="lifecycle-error">Failed to load lifecycle control data: ${esc(message)}</div>
    `;
  }

  function renderIssueCard(issue, className) {
    const sev = String(issue.severity || "info").toLowerCase();
    const count = issue.count === null || issue.count === undefined ? "&mdash;" : esc(issue.count);
    const href = issue.href || "#";
    const tag = href && href !== "#" ? "a" : "div";
    const attrs = tag === "a" ? ` href="${esc(href)}"` : "";
    const status = issue.status === "limited" || issue.status === "unavailable" ? issue.status : sev;
    return `
      <${tag} class="${className}"${attrs}>
        <div class="${className === "closeout-check" ? "closeout-sev" : "lifecycle-sev"} ${esc(sev)}"></div>
        <div>
          <div class="${className === "closeout-check" ? "closeout-stage" : "lifecycle-gate"}">${esc(issue.gate || issue.stage)}</div>
          <div class="${className === "closeout-check" ? "closeout-title" : "lifecycle-item-title"}">${esc(issue.title)}</div>
          <div class="${className === "closeout-check" ? "closeout-reason" : "lifecycle-reason"}">${esc(issue.reason)}</div>
        </div>
        <div>
          <div class="${className === "closeout-check" ? "closeout-count" : "lifecycle-count"}">${count}</div>
          <div class="${className === "closeout-check" ? "closeout-status" : "lifecycle-status"}">${esc(status)}</div>
        </div>
      </${tag}>`;
  }

  function renderChecklist(checklist) {
    if (!checklist || !Array.isArray(checklist.checks)) {
      return `
        <div class="closeout-checklist-section">
          <div class="closeout-section-head">
            <div>
              <div class="closeout-heading">Closeout Checklist</div>
              <div class="closeout-note-mini">No checklist data was returned.</div>
            </div>
          </div>
          <div class="closeout-note">Closeout checklist data unavailable.</div>
        </div>`;
    }

    const checks = checklist.checks.slice().sort((a, b) => {
      const statusRank = (c) => c.status === "active" ? 0 : c.status === "limited" || c.status === "unavailable" ? 1 : 2;
      return statusRank(a) - statusRank(b) || severityRank(a.severity) - severityRank(b.severity);
    });

    const activeCount = Number(checklist.active_count || checks.filter((c) => c.status === "active" && Number(c.count) > 0).length);
    const limitedCount = Number(checklist.limited_count || checks.filter((c) => c.status === "limited" || c.status === "unavailable").length);
    const sourceNote = checklist.note || (checklist.source ? `Checklist source: ${checklist.source}.` : "Computed from best available existing fields.");

    return `
      <div class="closeout-checklist-section">
        <div class="closeout-section-head">
          <div>
            <div class="closeout-heading">Closeout Checklist</div>
            <div class="closeout-note-mini">${esc(sourceNote)}</div>
          </div>
          <div class="closeout-mini-badge">${activeCount} active / ${limitedCount} limited</div>
        </div>
        <div class="closeout-checklist-grid">
          ${checks.map((check) => renderIssueCard(check, "closeout-check")).join("")}
        </div>
      </div>`;
  }

  function renderPanel(data) {
    const panel = ensurePanel();
    if (!panel) return;

    const queue = data?.owner_action_queue || null;
    const checklist = normalizeChecklist(data || {});
    const issues = flattenLifecycleIssues(queue);
    const activeIssues = issues.filter((i) => i.status !== "limited");
    const criticalCount = activeIssues.filter((i) => i.severity === "critical").length;
    const warningCount = activeIssues.filter((i) => i.severity === "warning").length;

    const stagesHtml = STAGE_ORDER.map((stage) => {
      const health = stageHealth(issues, stage);
      return `<div class="lifecycle-stage ${esc(health)}"><span class="lifecycle-stage-dot"></span>${esc(stage)}</div>`;
    }).join("");

    const issuesHtml = issues.map((issue) => renderIssueCard(issue, "lifecycle-issue")).join("");

    panel.innerHTML = `
      <div class="lifecycle-control-head">
        <div>
          <div class="lifecycle-title">Pipeline / Closeout Control</div>
          <div class="lifecycle-sub">Lifecycle visibility from lead/quote acceptance through scheduling, completion, invoicing, payment, closeout, review, and retention. This does not overwrite Sheet statuses.</div>
        </div>
        <div class="lifecycle-badge">${criticalCount} critical / ${warningCount} warning</div>
      </div>
      <div class="lifecycle-stage-strip">${stagesHtml}</div>
      ${issuesHtml ? `<div class="lifecycle-issues">${issuesHtml}</div>` : '<div class="lifecycle-empty">No active lifecycle blockers found from available data.</div>'}
      ${renderChecklist(checklist)}
    `;
  }

  async function loadLifecycleControl() {
    renderLoading();
    try {
      const response = await fetch("/api/today", { cache: "no-store" });
      const data = await response.json();
      if (!data.ok) throw new Error(data.error || "API error");
      renderPanel(data);
    } catch (err) {
      renderError(err.message || "Unknown error");
    }
  }

  function start() {
    let tries = 0;
    const timer = setInterval(() => {
      tries += 1;
      if (document.querySelector(".main-content") || tries > 10) {
        clearInterval(timer);
        loadLifecycleControl();
      }
    }, 150);
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start);
  else start();
})();

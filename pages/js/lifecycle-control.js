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
    { match: /new leads needing response/i, stage: "New Lead", gate: "New Lead → Qualified" },
    { match: /quotes needing follow-up/i, stage: "Quoted", gate: "Quoted → Accepted" },
    { match: /manual review quote requests/i, stage: "Needs Review", gate: "Needs Review → Accepted" },
    { match: /incomplete estimator sessions/i, stage: "Quoted", gate: "Quoted → Accepted" },
    { match: /accepted quotes not scheduled/i, stage: "Accepted", gate: "Accepted → Scheduled" },
    { match: /today's jobs|tomorrow's jobs/i, stage: "Scheduled", gate: "Scheduled → Prepped" },
    { match: /scheduled jobs missing assigned tech/i, stage: "Scheduled", gate: "Scheduled → Prepped" },
    { match: /jobs missing required deposit/i, stage: "Accepted", gate: "Accepted/Scheduled → Prepped" },
    { match: /completed jobs not invoiced/i, stage: "Complete", gate: "Complete → Invoiced" },
    { match: /completed jobs missing time entries/i, stage: "Complete", gate: "Complete → Invoiced" },
    { match: /open invoices|sent invoices not paid|overdue invoices/i, stage: "Invoiced", gate: "Invoiced → Paid" },
    { match: /paid jobs not closed/i, stage: "Paid", gate: "Paid → Closed" },
  ];

  const LIMITED_ITEMS = [
    {
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
      stage: found.stage,
      gate: found.gate,
      severity: String(item.severity || "info").toLowerCase(),
      title: title || "Lifecycle issue",
      count: item.count,
      reason: item.reason || "This lifecycle item needs review.",
      href: item.href || "#",
      status: item.status || "active",
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
      .lifecycle-issues {
        display:grid;
        grid-template-columns:repeat(2, minmax(0, 1fr));
        gap:10px;
      }
      @media (max-width: 780px) { .lifecycle-issues { grid-template-columns:1fr; } }
      .lifecycle-issue {
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
      .lifecycle-issue:hover { border-color:rgba(74,222,128,.26); background:rgba(74,222,128,.055); }
      .lifecycle-sev {
        width:8px;
        height:8px;
        border-radius:50%;
        margin-top:5px;
        background:#60a5fa;
      }
      .lifecycle-sev.critical { background:#fb7185; box-shadow:0 0 0 3px rgba(251,113,133,.11); }
      .lifecycle-sev.warning { background:#fbbf24; box-shadow:0 0 0 3px rgba(251,191,36,.10); }
      .lifecycle-sev.info { background:#60a5fa; box-shadow:0 0 0 3px rgba(96,165,250,.10); }
      .lifecycle-gate {
        font-size:10px;
        font-weight:850;
        letter-spacing:.07em;
        text-transform:uppercase;
        color:rgba(134,239,172,.7);
        margin-bottom:3px;
      }
      .lifecycle-item-title {
        font-size:13px;
        font-weight:900;
        line-height:1.25;
      }
      .lifecycle-reason {
        margin-top:4px;
        font-size:11px;
        color:rgba(230,238,252,.50);
        line-height:1.35;
      }
      .lifecycle-count {
        min-width:30px;
        text-align:center;
        border-radius:999px;
        padding:3px 8px;
        background:rgba(255,255,255,.07);
        font-size:12px;
        font-weight:900;
      }
      .lifecycle-status {
        margin-top:4px;
        font-size:9px;
        font-weight:850;
        text-transform:uppercase;
        letter-spacing:.05em;
        color:rgba(230,238,252,.38);
        text-align:right;
      }
      .lifecycle-empty,
      .lifecycle-error {
        border:1px dashed rgba(255,255,255,.12);
        border-radius:14px;
        padding:16px;
        color:rgba(230,238,252,.55);
        font-size:13px;
      }
      .lifecycle-error { color:#fda4af; border-color:rgba(251,113,133,.25); }
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

  function renderPanel(queue) {
    const panel = ensurePanel();
    if (!panel) return;

    const issues = flattenLifecycleIssues(queue);
    const activeIssues = issues.filter((i) => i.status !== "limited");
    const criticalCount = activeIssues.filter((i) => i.severity === "critical").length;
    const warningCount = activeIssues.filter((i) => i.severity === "warning").length;

    const stagesHtml = STAGE_ORDER.map((stage) => {
      const health = stageHealth(issues, stage);
      return `<div class="lifecycle-stage ${esc(health)}"><span class="lifecycle-stage-dot"></span>${esc(stage)}</div>`;
    }).join("");

    const issuesHtml = issues.map((issue) => {
      const sev = String(issue.severity || "info").toLowerCase();
      const count = issue.count === null || issue.count === undefined ? "&mdash;" : esc(issue.count);
      const href = issue.href || "#";
      const tag = href && href !== "#" ? "a" : "div";
      const attrs = tag === "a" ? ` href="${esc(href)}"` : "";
      const status = issue.status === "limited" ? "limited" : sev;
      return `
        <${tag} class="lifecycle-issue"${attrs}>
          <div class="lifecycle-sev ${esc(sev)}"></div>
          <div>
            <div class="lifecycle-gate">${esc(issue.gate)}</div>
            <div class="lifecycle-item-title">${esc(issue.title)}</div>
            <div class="lifecycle-reason">${esc(issue.reason)}</div>
          </div>
          <div>
            <div class="lifecycle-count">${count}</div>
            <div class="lifecycle-status">${esc(status)}</div>
          </div>
        </${tag}>`;
    }).join("");

    panel.innerHTML = `
      <div class="lifecycle-control-head">
        <div>
          <div class="lifecycle-title">Pipeline / Closeout Control</div>
          <div class="lifecycle-sub">Lifecycle gates from lead/quote acceptance through scheduling, completion, invoicing, payment, closeout, review, and retention. Computed from current dashboard queue data; it does not overwrite Sheet statuses.</div>
        </div>
        <div class="lifecycle-badge">${criticalCount} critical / ${warningCount} warning</div>
      </div>
      <div class="lifecycle-stage-strip">${stagesHtml}</div>
      ${issuesHtml ? `<div class="lifecycle-issues">${issuesHtml}</div>` : '<div class="lifecycle-empty">No active lifecycle blockers found from available data.</div>'}
    `;
  }

  async function loadLifecycleControl() {
    renderLoading();
    try {
      const response = await fetch("/api/today", { cache: "no-store" });
      const data = await response.json();
      if (!data.ok) throw new Error(data.error || "API error");
      renderPanel(data.owner_action_queue || null);
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

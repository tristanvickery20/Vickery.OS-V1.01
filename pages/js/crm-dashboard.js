(() => {
  // ── Helpers ──────────────────────────────────────────────────────────────

  function escH(s) {
    return String(s || "")
      .replace(/&/g, "&amp;").replace(/</g, "&lt;")
      .replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  }

  function fmt$(n) {
    const v = Number(n);
    if (!isFinite(v)) return "$0";
    return "$" + v.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 0 });
  }

  function fmtDateUTC(iso) {
    if (!iso) return "";
    const d = new Date(String(iso).includes("T") ? iso : iso + "T00:00:00Z");
    if (isNaN(d.getTime())) return iso;
    const months = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
    return months[d.getUTCMonth()] + " " + d.getUTCDate();
  }

  function timeSince(iso) {
    if (!iso) return "";
    const d = new Date(iso);
    if (isNaN(d.getTime())) return "";
    const diff = Date.now() - d.getTime();
    const mins = Math.floor(diff / 60000);
    if (mins < 2) return "just now";
    if (mins < 60) return mins + "m ago";
    const hrs = Math.floor(mins / 60);
    if (hrs < 24) return hrs + "h ago";
    const days = Math.floor(hrs / 24);
    if (days < 30) return days + "d ago";
    return fmtDateUTC(iso);
  }

  function set(id, html) {
    const el = document.getElementById(id);
    if (el) el.innerHTML = html;
  }

  function setText(id, text) {
    const el = document.getElementById(id);
    if (el) el.textContent = text;
  }

  const STATUS_LABEL = {
    active: "Active", awaiting_response: "Awaiting Response",
    scheduled: "Scheduled", in_progress: "In Progress",
    awaiting_payment: "Awaiting Payment", overdue: "Overdue",
    complete: "Complete", paid: "Paid", closed: "Closed",
    new: "New", deposit_required: "Deposit Required",
    estimate_sent: "Estimate Sent", approved: "Approved",
  };
  const STATUS_DOT = {
    active: "sd-blue", scheduled: "sd-blue", in_progress: "sd-blue",
    awaiting_response: "sd-gray", new: "sd-gray", estimate_sent: "sd-gray",
    awaiting_payment: "sd-yellow", deposit_required: "sd-yellow", approved: "sd-yellow",
    overdue: "sd-red",
    complete: "sd-gray", paid: "sd-gray", closed: "sd-gray",
  };
  function statusPill(code) {
    const key = String(code || "").toLowerCase().trim();
    const label = STATUS_LABEL[key] || code || "Unknown";
    const dot   = STATUS_DOT[key]   || "sd-gray";
    return '<span class="spill ' + escH(dot) + '">' + escH(label) + "</span>";
  }

  // ── Owner Action Queue UI ────────────────────────────────────────────────
  function injectOwnerQueueStyles() {
    if (document.getElementById("ownerActionQueueStyles")) return;
    const style = document.createElement("style");
    style.id = "ownerActionQueueStyles";
    style.textContent = `
      .owner-queue-card {
        margin-bottom: 24px;
        padding: 18px;
        border-radius: 18px;
        border: 1px solid rgba(96,165,250,0.22);
        background: linear-gradient(180deg, rgba(59,130,246,0.08), rgba(255,255,255,0.025));
      }
      .owner-queue-header {
        display:flex;
        align-items:flex-start;
        justify-content:space-between;
        gap:14px;
        margin-bottom:14px;
      }
      .owner-queue-title {
        font-family: var(--font-display);
        font-size:18px;
        font-weight:900;
        letter-spacing:-0.02em;
      }
      .owner-queue-sub {
        margin-top:3px;
        font-size:12px;
        color:rgba(230,238,252,0.55);
        line-height:1.4;
      }
      .owner-queue-count {
        flex:0 0 auto;
        border:1px solid rgba(96,165,250,0.35);
        background:rgba(96,165,250,0.12);
        color:#93c5fd;
        border-radius:999px;
        padding:5px 10px;
        font-size:12px;
        font-weight:800;
        white-space:nowrap;
      }
      .owner-queue-systems {
        display:grid;
        grid-template-columns: repeat(3, 1fr);
        gap:12px;
      }
      @media (max-width: 1000px) { .owner-queue-systems { grid-template-columns: repeat(2, 1fr); } }
      @media (max-width: 650px) { .owner-queue-systems { grid-template-columns: 1fr; } }
      .owner-system-card {
        border:1px solid rgba(255,255,255,0.08);
        border-radius:14px;
        background:rgba(255,255,255,0.03);
        padding:12px;
        min-width:0;
      }
      .owner-system-head {
        display:flex;
        align-items:center;
        justify-content:space-between;
        gap:8px;
        margin-bottom:9px;
      }
      .owner-system-name {
        font-size:12px;
        font-weight:850;
        letter-spacing:.04em;
        text-transform:uppercase;
        color:rgba(230,238,252,0.72);
        line-height:1.25;
      }
      .owner-system-state {
        border-radius:999px;
        padding:2px 7px;
        font-size:10px;
        font-weight:850;
        text-transform:uppercase;
        letter-spacing:.04em;
      }
      .owner-system-state.state-critical { background:rgba(251,113,133,.16); color:#fda4af; border:1px solid rgba(251,113,133,.28); }
      .owner-system-state.state-warning { background:rgba(251,191,36,.12); color:#fcd34d; border:1px solid rgba(251,191,36,.24); }
      .owner-system-state.state-partial { background:rgba(148,163,184,.10); color:#cbd5e1; border:1px solid rgba(148,163,184,.20); }
      .owner-system-state.state-clear { background:rgba(74,222,128,.10); color:#86efac; border:1px solid rgba(74,222,128,.20); }
      .owner-action-list { display:flex; flex-direction:column; gap:7px; }
      .owner-action-row {
        display:grid;
        grid-template-columns:auto 1fr auto;
        gap:9px;
        align-items:start;
        text-decoration:none;
        color:inherit;
        border:1px solid rgba(255,255,255,0.06);
        border-radius:11px;
        padding:9px;
        background:rgba(0,0,0,0.08);
      }
      .owner-action-row:hover { border-color:rgba(96,165,250,0.28); background:rgba(96,165,250,0.06); }
      .owner-action-row.unavailable,
      .owner-action-row.clear {
        opacity:.82;
      }
      .owner-sev {
        width:8px;
        height:8px;
        margin-top:5px;
        border-radius:50%;
        background:#94a3b8;
      }
      .owner-sev-critical { background:#fb7185; box-shadow:0 0 0 3px rgba(251,113,133,.12); }
      .owner-sev-warning { background:#fbbf24; box-shadow:0 0 0 3px rgba(251,191,36,.10); }
      .owner-sev-info { background:#60a5fa; box-shadow:0 0 0 3px rgba(96,165,250,.10); }
      .owner-action-title { font-size:13px; font-weight:850; line-height:1.25; }
      .owner-action-reason { margin-top:3px; font-size:11px; line-height:1.35; color:rgba(230,238,252,0.48); }
      .owner-action-meta {
        display:flex;
        flex-direction:column;
        align-items:flex-end;
        gap:4px;
      }
      .owner-action-count {
        min-width:28px;
        text-align:center;
        padding:3px 7px;
        border-radius:999px;
        background:rgba(255,255,255,0.07);
        font-size:12px;
        font-weight:900;
      }
      .owner-action-status {
        font-size:9px;
        text-transform:uppercase;
        letter-spacing:.05em;
        color:rgba(230,238,252,0.38);
        font-weight:800;
        white-space:nowrap;
      }
      .owner-queue-loading,
      .owner-queue-error {
        border:1px dashed rgba(255,255,255,.12);
        border-radius:14px;
        padding:16px;
        color:rgba(230,238,252,.55);
        font-size:13px;
      }
      .owner-queue-error { color:#fda4af; border-color:rgba(251,113,133,.25); }
    `;
    document.head.appendChild(style);
  }

  function ensureOwnerQueueMount() {
    injectOwnerQueueStyles();
    let el = document.getElementById("ownerActionQueue");
    if (el) return el;

    const main = document.querySelector(".main-content");
    if (!main) return null;

    el = document.createElement("section");
    el.id = "ownerActionQueue";
    el.className = "owner-queue-card";
    const firstDashSection = main.querySelector(".dash-section");
    if (firstDashSection) main.insertBefore(el, firstDashSection);
    else main.prepend(el);
    return el;
  }

  function displaySeverity(label) {
    const key = String(label || "info").toLowerCase();
    return key.charAt(0).toUpperCase() + key.slice(1);
  }

  function renderOwnerActionQueue(queue, state) {
    const el = ensureOwnerQueueMount();
    if (!el) return;

    if (state && state.loading) {
      el.innerHTML = (
        '<div class="owner-queue-header">' +
          '<div><div class="owner-queue-title">Owner Action Queue</div>' +
          '<div class="owner-queue-sub">Checking leads, jobs, invoices, payroll, fleet, and compliance signals.</div></div>' +
        '</div>' +
        '<div class="owner-queue-loading">Loading owner actions&hellip;</div>'
      );
      return;
    }

    if (state && state.error) {
      el.innerHTML = (
        '<div class="owner-queue-header">' +
          '<div><div class="owner-queue-title">Owner Action Queue</div>' +
          '<div class="owner-queue-sub">This queue shows stuck, blocked, overdue, risky, or unavailable operating-system items.</div></div>' +
        '</div>' +
        '<div class="owner-queue-error">Failed to load owner action queue: ' + escH(state.error) + '</div>'
      );
      return;
    }

    if (!queue || !Array.isArray(queue.systems)) {
      el.innerHTML = (
        '<div class="owner-queue-header">' +
          '<div><div class="owner-queue-title">Owner Action Queue</div>' +
          '<div class="owner-queue-sub">No owner action queue data was returned by the API.</div></div>' +
        '</div>' +
        '<div class="owner-queue-loading">Data unavailable.</div>'
      );
      return;
    }

    const activeCount = Number(queue.total_active_items || 0);
    const systemsHtml = queue.systems.map((sys) => {
      const stateKey = String(sys.status || "partial").toLowerCase();
      const items = Array.isArray(sys.items) ? sys.items : [];
      const itemHtml = items.map((item) => {
        const severity = String(item.severity || "info").toLowerCase();
        const status = String(item.status || "active").toLowerCase();
        const count = item.count === null || item.count === undefined ? "&mdash;" : escH(String(item.count));
        const href = item.href || "#";
        const tag = href && href !== "#" ? "a" : "div";
        const attrs = tag === "a" ? ' href="' + escH(href) + '"' : "";
        return (
          '<' + tag + ' class="owner-action-row ' + escH(status) + '"' + attrs + '>' +
            '<div class="owner-sev owner-sev-' + escH(severity) + '" title="' + escH(displaySeverity(severity)) + '"></div>' +
            '<div>' +
              '<div class="owner-action-title">' + escH(item.title || "Action item") + '</div>' +
              '<div class="owner-action-reason">' + escH(item.reason || "") + '</div>' +
            '</div>' +
            '<div class="owner-action-meta">' +
              '<div class="owner-action-count">' + count + '</div>' +
              '<div class="owner-action-status">' + escH(status === "active" ? displaySeverity(severity) : status) + '</div>' +
            '</div>' +
          '</' + tag + '>'
        );
      }).join("");

      return (
        '<div class="owner-system-card">' +
          '<div class="owner-system-head">' +
            '<div class="owner-system-name">' + escH(sys.key || sys.system_key || "") + '. ' + escH(sys.system || "System") + '</div>' +
            '<div class="owner-system-state state-' + escH(stateKey) + '">' + escH(stateKey) + '</div>' +
          '</div>' +
          '<div class="owner-action-list">' + (itemHtml || '<div class="owner-action-row clear"><div class="owner-sev owner-sev-info"></div><div><div class="owner-action-title">No action items found</div><div class="owner-action-reason">No issues were returned for this system.</div></div><div class="owner-action-meta"><div class="owner-action-count">0</div><div class="owner-action-status">clear</div></div></div>') + '</div>' +
        '</div>'
      );
    }).join("");

    el.innerHTML = (
      '<div class="owner-queue-header">' +
        '<div>' +
          '<div class="owner-queue-title">Owner Action Queue</div>' +
          '<div class="owner-queue-sub">Stuck, blocked, overdue, risky, or unavailable items grouped by the six VE OS operating systems.</div>' +
        '</div>' +
        '<div class="owner-queue-count">' + activeCount + ' active action' + (activeCount === 1 ? '' : 's') + '</div>' +
      '</div>' +
      '<div class="owner-queue-systems">' + systemsHtml + '</div>'
    );
  }

  // ── Filter state ──────────────────────────────────────────────────────────
  let activeFilter = "all";
  let todayData   = null;

  // ── Event-type helpers ────────────────────────────────────────────────────
  function eventDotClass(ev) {
    const t = String(ev.event_type || "").toLowerCase();
    if (ev.type === "task") return "dot-purple";
    if (t.includes("estimate") || t.includes("quote")) return "dot-yellow";
    if (ev.type === "booking") return "dot-green";
    return "dot-blue";
  }
  function eventBadgeClass(ev) {
    const t = String(ev.event_type || "").toLowerCase();
    if (ev.type === "task") return "badge-task";
    if (t.includes("estimate") || t.includes("quote")) return "badge-est";
    if (ev.type === "booking") return "badge-booking";
    return "badge-job";
  }
  function eventBadgeLabel(ev) {
    if (ev.type === "task") return "Task";
    const t = String(ev.event_type || "").toLowerCase();
    if (t.includes("estimate") || t.includes("quote")) return "Estimate";
    if (ev.type === "booking") return "Booking";
    return "Job";
  }
  function eventMatchesFilter(ev) {
    if (activeFilter === "all") return true;
    if (activeFilter === "tasks") return ev.type === "task";
    if (activeFilter === "jobs") {
      const t = String(ev.event_type || "").toLowerCase();
      return ev.type !== "task" && !t.includes("estimate") && !t.includes("quote");
    }
    if (activeFilter === "estimates") {
      const t = String(ev.event_type || "").toLowerCase();
      return t.includes("estimate") || t.includes("quote");
    }
    return true;
  }

  // ── Render a single event row ─────────────────────────────────────────────
  function renderEventRow(ev, isOverdue) {
    const dot   = eventDotClass(ev);
    const badge = eventBadgeClass(ev);
    const label = eventBadgeLabel(ev);
    const time  = ev.time_hint || "";
    const val   = Number(ev.value) || 0;
    const sub   = [ev.address, ev.assigned_to].filter(Boolean).join(" \u00b7 ");
    const cls   = "event-row" + (isOverdue ? " overdue-row" : "") + (ev.type === "task" ? " task-row" : "");
    const href  = ev.link || "#";

    return (
      '<a class="' + cls + '" href="' + escH(href) + '">' +
        '<div class="ev-time">' + escH(time) + "</div>" +
        '<div class="ev-dot ' + dot + '"></div>' +
        '<div class="ev-mid">' +
          '<div class="ev-name">' + escH(ev.name || ev.title || "(No name)") + "</div>" +
          (sub ? '<div class="ev-sub">' + escH(sub) + "</div>" : "") +
        "</div>" +
        '<div class="ev-right">' +
          '<span class="ev-badge ' + badge + '">' + escH(label) + "</span>" +
          (val > 0 ? '<div class="ev-val">' + escH(fmt$(val)) + "</div>" : "") +
        "</div>" +
      "</a>"
    );
  }

  // ── Render task row (overdue or unscheduled) ──────────────────────────────
  function renderTaskRow(task, isOverdue) {
    const pClass  = "priority-" + (task.priority || "medium");
    const dueStr  = task.due_date ? fmtDateUTC(task.due_date) : "No due date";
    const sub     = [task.assigned_to, "Due: " + dueStr].filter(Boolean).join(" \u00b7 ");
    const cls     = "event-row task-row" + (isOverdue ? " overdue-row" : "");
    const href    = task.related_lead_id ? "/crm/lead?id=" + encodeURIComponent(task.related_lead_id) : "#";

    return (
      '<div class="' + cls + '" style="cursor:default;">' +
        '<div class="ev-time"><span class="' + pClass + '" title="' + escH(task.priority) + ' priority">\u25cf</span></div>' +
        '<div class="ev-dot dot-purple"></div>' +
        '<div class="ev-mid">' +
          '<div class="ev-name">' + escH(task.title || "(No title)") + "</div>" +
          '<div class="ev-sub">' + escH(sub) + "</div>" +
        "</div>" +
        '<div class="ev-right">' +
          '<span class="ev-badge badge-task">Task</span>' +
        "</div>" +
      "</div>"
    );
  }

  // ── Render Today section ──────────────────────────────────────────────────
  function renderToday(data) {
    const now = new Date();
    const dateLabel = now.toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" });
    set("todayDateDisplay", escH(dateLabel));

    const timedCount     = (data.timed_events || []).length;
    const overdueCount   = (data.overdue_tasks || []).length;
    const unscheduledCount = (data.unscheduled_tasks || []).length;
    set("todayMeta", escH(timedCount + " scheduled \u00b7 " + overdueCount + " overdue \u00b7 " + unscheduledCount + " open tasks"));

    // Overdue tasks
    const overdueTasks = data.overdue_tasks || [];
    const overdueSection = document.getElementById("overdueSection");
    if (overdueTasks.length > 0) {
      overdueSection.style.display = "";
      setText("overdueCountBadge", overdueTasks.length);
      const filtered = overdueTasks.filter((t) => activeFilter === "all" || activeFilter === "tasks");
      if (filtered.length === 0) {
        set("overdueList", '<div class="empty-strip" style="border-style:solid;">No overdue tasks match the current filter.</div>');
      } else {
        set("overdueList", filtered.map((t) => renderTaskRow(t, true)).join(""));
      }
    } else {
      overdueSection.style.display = "none";
    }

    // Timed events
    const timedEvents = data.timed_events || [];
    const filteredEvents = timedEvents.filter(eventMatchesFilter);
    const timedEl = document.getElementById("timedEventsList");
    if (!timedEl) return;
    if (timedEvents.length === 0) {
      timedEl.innerHTML = '<div class="empty-strip">No scheduled work today.</div>';
    } else if (filteredEvents.length === 0) {
      timedEl.innerHTML = '<div class="empty-strip">No events match the current filter.</div>';
    } else {
      timedEl.innerHTML = filteredEvents.map((ev) => renderEventRow(ev, false)).join("");
    }

    // Unscheduled / open tasks
    const unscheduled = data.unscheduled_tasks || [];
    const unscheduledEl = document.getElementById("unscheduledList");
    const showTasks = activeFilter === "all" || activeFilter === "tasks";
    if (unscheduledEl) {
      if (!showTasks) {
        unscheduledEl.innerHTML = "";
      } else if (unscheduled.length === 0) {
        unscheduledEl.innerHTML = '<div class="empty-strip">No open tasks.</div>';
      } else {
        unscheduledEl.innerHTML = unscheduled.map((t) => renderTaskRow(t, false)).join("");
      }
    }
    const unscheduledSection = document.getElementById("unscheduledSection");
    if (unscheduledSection) unscheduledSection.style.display = showTasks ? "" : "none";
  }

  // ── Render week strip ─────────────────────────────────────────────────────
  let expandedDay = null;
  let weekDaysData = [];

  function renderWeekStrip(days) {
    weekDaysData = days || [];
    const el = document.getElementById("weekStrip");
    if (!el) return;
    if (!days || days.length === 0) {
      el.innerHTML = '<div class="empty-strip">No week data.</div>';
      return;
    }
    el.innerHTML = days.map((d, i) => {
      const cls = "week-day" + (d.is_today ? " today-marker" : "") + (d.date === expandedDay ? " active" : "");
      const pips =
        (d.event_count > 0 ? '<span class="wd-pip wd-pip-ev">' + d.event_count + ' ev</span>' : "") +
        (d.task_count > 0  ? '<span class="wd-pip wd-pip-task">' + d.task_count + ' task</span>' : "");
      return (
        '<div class="' + cls + '" data-date="' + escH(d.date) + '" data-idx="' + i + '">' +
          '<div class="wd-label">' + escH(d.label) + "</div>" +
          '<div class="wd-num">' + escH(d.day) + "</div>" +
          '<div class="wd-counts">' + (pips || '<span style="font-size:10px;opacity:.3;">&ndash;</span>') + "</div>" +
        "</div>"
      );
    }).join("");

    // Click handler
    el.querySelectorAll(".week-day").forEach((btn) => {
      btn.addEventListener("click", () => {
        const date = btn.dataset.date;
        if (expandedDay === date) {
          expandedDay = null;
          renderWeekStrip(weekDaysData);
          const det = document.getElementById("weekDayDetail");
          if (det) det.style.display = "none";
        } else {
          expandedDay = date;
          renderWeekStrip(weekDaysData);
          loadWeekDay(date);
        }
      });
    });
  }

  async function loadWeekDay(date) {
    const det = document.getElementById("weekDayDetail");
    if (!det) return;
    det.style.display = "";
    det.innerHTML = '<div class="week-day-detail"><div class="week-day-detail-title">Loading&hellip;</div></div>';
    try {
      const resp = await fetch("/api/week?date=" + encodeURIComponent(date), { cache: "no-store" });
      const data = await resp.json();
      if (!data.ok) throw new Error(data.error || "API error");

      const dateLabel = new Date(date + "T00:00:00Z").toLocaleDateString("en-US",
        { weekday: "long", month: "short", day: "numeric", timeZone: "UTC" });

      let html = '<div class="week-day-detail">';
      html += '<div class="week-day-detail-title">' + escH(dateLabel) + "</div>";

      const events = data.events || [];
      const tasks  = data.tasks  || [];

      if (events.length === 0 && tasks.length === 0) {
        html += '<div class="empty-strip" style="border-style:solid;font-size:12px;">Nothing scheduled.</div>';
      } else {
        if (events.length > 0) {
          html += '<div style="margin-bottom:10px;"><div class="event-list">';
          html += events.map((ev) => renderEventRow(ev, false)).join("");
          html += "</div></div>";
        }
        if (tasks.length > 0) {
          html += '<div style="font-size:11px;font-weight:700;letter-spacing:.07em;text-transform:uppercase;color:rgba(167,139,250,.8);margin:8px 0 6px;">Tasks due</div>';
          html += '<div class="event-list">';
          html += tasks.map((t) => renderTaskRow({
            title: t.title || "", priority: t.priority || "medium",
            due_date: t.due_date || "", assigned_to: t.assigned_to || "",
            related_lead_id: t.related_lead_id || "",
          }, false)).join("");
          html += "</div>";
        }
      }
      html += "</div>";
      det.innerHTML = html;
    } catch (e) {
      det.innerHTML = '<div class="week-day-detail"><div class="empty-strip" style="border-style:solid;">Failed to load: ' + escH(e.message) + "</div></div>";
    }
  }

  // ── KPI renders (from /api/dashboard) ───────────────────────────────────
  function renderPipeline(d) {
    set("pipTotal",    escH(String(d.total_leads || 0)));
    set("pipAwaiting", escH(String(d.awaiting_approval || 0)));
    set("pipActive",   escH(String(d.active || 0)));
  }
  function renderMoney(d) {
    set("monQuoted",   escH(fmt$(d.quoted_7d)));
    set("monInvoiced", escH(fmt$(d.invoiced_7d)));
    set("monPaid",     escH(fmt$(d.paid_7d)));
  }
  function renderOps(d) {
    set("opsSched",      escH(String(d.scheduled_7d || 0)));
    set("opsOverdue",    escH(String(d.overdue || 0)));
    set("opsUnassigned", escH(String(d.unassigned || 0)));
  }
  function renderCloseout(d) {
    set("clsComp",   escH(String(d.completed_7d || 0)));
    set("clsUnpaid", escH(String(d.invoiced_not_paid || 0)));
    set("clsClosed", escH(String(d.closed_30d || 0)));
  }
  function renderBonusTracker(d) {
    set("bonusEarnedPeriod",      escH(String(d.earned_count_period      || 0)));
    set("bonusLiabilityPeriod",   escH(fmt$(d.bonus_liability_period     || 0)));
    set("bonusPendingPeriod",     escH(String(d.pending_count_period     || 0)));
    set("bonusMarginFailPeriod",  escH(String(d.margin_fail_count_period || 0)));
    set("bonusDocFailPeriod",     escH(String(d.doc_fail_count_period    || 0)));
    set("bonusEarned",            escH(String(d.earned_count             || 0)));
    set("bonusLiability",         escH(fmt$(d.total_earned_bonus         || 0)));
  }
  function renderProfitShare(d) {
    if (!d) return;
    set("psANP",       escH(fmt$(d.ytd_adjusted_net_profit)));
    set("psCollected", escH(fmt$(d.ytd_invoiced_revenue || d.ytd_collected_revenue || 0)));
    set("psCost",      escH(fmt$(d.ytd_direct_job_cost)));
    set("psTier",      escH(d.projected_tier_label || "0%"));
    set("psAmount",    escH(fmt$(d.projected_share_amount || 0)));
  }
  function renderFinancials(f) {
    set("finOpenAR",         escH(fmt$(f.open_ar)));
    set("finInvoicedMonth",  escH(fmt$(f.invoiced_this_month)));
    set("finCollectedMonth", escH(fmt$(f.collected_this_month)));
    set("finCollectedYTD",   escH(fmt$(f.collected_ytd)));
    const ag = f.aging || {};
    set("finAge0",  escH(fmt$(ag.current)));
    set("finAge30", escH(fmt$(ag.days_30)));
    set("finAge60", escH(fmt$(ag.days_60)));
    set("finAge90", escH(fmt$(ag.days_90_plus)));
    set("finProvider", escH(String(f.provider || "mock").toUpperCase()));
  }
  function renderActivity(list) {
    const el = document.getElementById("activityList");
    if (!el) return;
    if (!list || list.length === 0) {
      el.innerHTML = '<div class="empty-strip">No recent activity.</div>';
      return;
    }
    el.innerHTML = list.map((r) => {
      const key = String(r.status || "").toLowerCase().trim();
      const dot = STATUS_DOT[key] || "sd-gray";
      const dotColor = dot === "sd-blue" ? "#60a5fa" : dot === "sd-yellow" ? "#fbbf24" : dot === "sd-red" ? "#fb7185" : "#94a3b8";
      return (
        '<a class="activity-row" href="/crm/lead?id=' + encodeURIComponent(r.id) + '">' +
          '<div class="act-dot" style="background:' + escH(dotColor) + '"></div>' +
          '<div class="act-name">' + escH(r.name || "(No name)") + "</div>" +
          '<div class="act-right">' +
            statusPill(r.status) + "&nbsp;" +
            escH(timeSince(r.last_activity_at)) +
          "</div>" +
        "</a>"
      );
    }).join("");
  }

  // ── Load today data ───────────────────────────────────────────────────────
  async function loadToday() {
    renderOwnerActionQueue(null, { loading: true });
    try {
      const resp = await fetch("/api/today", { cache: "no-store" });
      const data = await resp.json();
      if (!data.ok) throw new Error(data.error || "API error");
      todayData = data;
      renderOwnerActionQueue(data.owner_action_queue || null);
      renderToday(data);
      renderWeekStrip(data.week_days || []);
    } catch (e) {
      console.error("[dashboard] today error:", e);
      renderOwnerActionQueue(null, { error: e.message });
      set("timedEventsList", '<div class="empty-strip">Failed to load today: ' + escH(e.message) + "</div>");
    }
  }

  // ── Load KPI / financial data ─────────────────────────────────────────────
  async function loadKPIs() {
    try {
      const [resp, finResp] = await Promise.all([
        fetch("/api/dashboard", { cache: "no-store" }),
        fetch("/api/dashboard/financials", { cache: "no-store" }).catch(() => null),
      ]);
      const data = await resp.json();
      if (!data.ok) throw new Error(data.error || "API error");

      renderPipeline(data.pipeline_card || {});
      renderMoney(data.money_card || {});
      renderOps(data.ops_card || {});
      renderCloseout(data.closeout_card || {});
      renderActivity(data.recent_activity || []);
      renderBonusTracker(data.bonus_tracker || {});
      renderProfitShare(data.profit_share || null);

      if (finResp) {
        const finData = await finResp.json().catch(() => ({ ok: false }));
        if (finData.ok || finData.partial) {
          renderFinancials(finData);
          if (finData.partial) {
            const el = document.getElementById("finProvider");
            if (el) el.textContent += " (partial data)";
          }
        }
      }
    } catch (e) {
      console.error("[dashboard] KPI error:", e);
    }
  }

  // ── Main load ─────────────────────────────────────────────────────────────
  async function load() {
    setText("statusText", "Loading\u2026");
    await Promise.all([loadToday(), loadKPIs()]);
    setText("statusText", "Updated " + new Date().toLocaleTimeString());
  }

  // ── Filter chip logic ─────────────────────────────────────────────────────
  const chipsEl = document.getElementById("filterChips");
  if (chipsEl) {
    chipsEl.querySelectorAll(".fchip").forEach((btn) => {
      btn.addEventListener("click", () => {
        chipsEl.querySelectorAll(".fchip").forEach((b) => b.classList.remove("active"));
        btn.classList.add("active");
        activeFilter = btn.dataset.filter || "all";
        if (todayData) renderToday(todayData);
      });
    });
  }

  // ── Refresh button ────────────────────────────────────────────────────────
  const refreshBtn = document.getElementById("refreshBtn");
  if (refreshBtn) refreshBtn.addEventListener("click", load);

  // ── Auto-refresh every 60 seconds ────────────────────────────────────────
  load();
  setInterval(loadToday, 60000);
})();

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
      const isActive = d.is_today || d.date === expandedDay;
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
    try {
      const resp = await fetch("/api/today", { cache: "no-store" });
      const data = await resp.json();
      if (!data.ok) throw new Error(data.error || "API error");
      todayData = data;
      renderToday(data);
      renderWeekStrip(data.week_days || []);
    } catch (e) {
      console.error("[dashboard] today error:", e);
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

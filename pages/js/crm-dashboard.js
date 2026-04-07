(() => {
  const STATUS_LABEL = {
    active:            "Active",
    awaiting_response: "Awaiting Response",
    scheduled:         "Scheduled",
    in_progress:       "In Progress",
    awaiting_payment:  "Awaiting Payment",
    overdue:           "Overdue",
    complete:          "Complete",
    paid:              "Paid",
    closed:            "Closed",
    new:               "New",
    deposit_required:  "Deposit Required",
    estimate_sent:     "Estimate Sent",
    approved:          "Approved",
  };

  const STATUS_DOT = {
    active: "sd-blue", scheduled: "sd-blue", in_progress: "sd-blue",
    awaiting_response: "sd-gray", new: "sd-gray", estimate_sent: "sd-gray",
    awaiting_payment: "sd-yellow", deposit_required: "sd-yellow", approved: "sd-yellow",
    overdue: "sd-red",
    complete: "sd-gray", paid: "sd-gray", closed: "sd-gray",
  };

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

  function initial(name) {
    const s = String(name || "").trim();
    return (s ? s.charAt(0) : "?").toUpperCase();
  }

  function dotColor(dot) {
    if (dot === "sd-blue")   return "#60a5fa";
    if (dot === "sd-yellow") return "#fbbf24";
    if (dot === "sd-red")    return "#fb7185";
    return "#94a3b8";
  }

  function statusPill(code) {
    const key = String(code || "").toLowerCase().trim();
    const label = STATUS_LABEL[key] || code || "Unknown";
    const dot = STATUS_DOT[key] || "sd-gray";
    return '<span class="spill ' + escH(dot) + '">' + escH(label) + "</span>";
  }

  function set(id, html) {
    const el = document.getElementById(id);
    if (el) el.innerHTML = html;
  }

  function setText(id, text) {
    const el = document.getElementById(id);
    if (el) el.textContent = text;
  }

  function renderToday(d) {
    const total = d.scheduled || 0;
    const completed = d.completed || 0;
    const pending = d.pending || 0;
    const val = d.pipeline_value || 0;

    set("todayBig", escH(total + " scheduled \u2022 " + fmt$(val) + " pipeline"));
    set("todaySub", escH(completed + " completed \u2022 " + pending + " pending"));

    const pct = total > 0 ? Math.round((completed / total) * 100) : 0;
    const fill = document.getElementById("todayProgress");
    if (fill) fill.style.width = pct + "%";

    setText("todayProgressLabel",
      total === 0
        ? "No visits today"
        : completed + " of " + total + " complete (" + pct + "%)");
  }

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

  function renderSchedule(list) {
    const el = document.getElementById("scheduleList");
    if (!el) return;
    if (!list || list.length === 0) {
      el.innerHTML = '<div class="empty-strip">No scheduled work today.</div>';
      return;
    }
    el.innerHTML = list.map((r) => {
      const val = Number(r.value) || 0;
      const valStr = val > 0 ? fmt$(val) : "";
      const sub = [r.address, r.assigned_to].filter(Boolean).join(" \u00b7 ");
      return (
        '<a class="schedule-row" href="/crm/lead?id=' + encodeURIComponent(r.id) + '">' +
          '<div class="sch-avatar">' + escH(initial(r.name)) + "</div>" +
          '<div class="sch-mid">' +
            '<div class="sch-name">' + escH(r.name || "(No name)") + "</div>" +
            (sub ? '<div class="sch-sub">' + escH(sub) + "</div>" : "") +
          "</div>" +
          '<div class="sch-right">' +
            statusPill(r.status) +
            (valStr ? '<div class="sch-val">' + escH(valStr) + "</div>" : "") +
          "</div>" +
        "</a>"
      );
    }).join("");
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
      return (
        '<a class="activity-row" href="/crm/lead?id=' + encodeURIComponent(r.id) + '">' +
          '<div class="act-dot" style="background:' + escH(dotColor(dot)) + '"></div>' +
          '<div class="act-name">' + escH(r.name || "(No name)") + "</div>" +
          '<div class="act-right">' +
            statusPill(r.status) + "&nbsp;" +
            escH(timeSince(r.last_activity_at)) +
          "</div>" +
        "</a>"
      );
    }).join("");
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

  async function load() {
    setText("statusText", "Loading\u2026");
    try {
      const [resp, finResp] = await Promise.all([
        fetch("/api/dashboard", { cache: "no-store" }),
        fetch("/api/dashboard/financials", { cache: "no-store" }).catch(() => null),
      ]);
      const data = await resp.json();
      if (!data.ok) throw new Error(data.error || "API error");

      renderToday(data.today_summary || {});
      renderPipeline(data.pipeline_card || {});
      renderMoney(data.money_card || {});
      renderOps(data.ops_card || {});
      renderCloseout(data.closeout_card || {});
      renderSchedule(data.today_schedule || []);
      renderActivity(data.recent_activity || []);

      if (finResp) {
        const finData = await finResp.json().catch(() => ({ ok: false }));
        if (finData.ok) renderFinancials(finData);
      }

      setText("statusText", "Updated " + new Date().toLocaleTimeString());
    } catch (e) {
      setText("statusText", "Error: " + e.message);
    }
  }

  const refreshBtn = document.getElementById("refreshBtn");
  if (refreshBtn) refreshBtn.addEventListener("click", load);

  load();
})();

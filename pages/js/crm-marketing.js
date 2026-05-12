/* crm-marketing.js — Marketing Hub front-end logic
 * Exposes window.Mkt = { loadOverview, loadReviews, loadFollowup,
 *   loadSegments, loadReferrals, loadTemplates, loadMktSettings }
 * Each marketing sub-page includes this file and calls the function it needs.
 */
window.Mkt = (function () {
  "use strict";

  // ── Data stores (avoid JSON-in-attribute patterns) ────────────────────────
  const Store = {
    queue:   {},
    pending: {},
    received: {},
    followup: {},
  };

  // ── Helpers ───────────────────────────────────────────────────────────────
  function esc(s) {
    return String(s || "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }
  function fmt$(n) {
    const v = Number(n || 0);
    if (v >= 1000) return "$" + (v / 1000).toFixed(1) + "k";
    return "$" + v.toLocaleString("en-US", { minimumFractionDigits: 0, maximumFractionDigits: 0 });
  }
  function fmtDate(iso) {
    if (!iso) return "—";
    const d = new Date(iso);
    if (isNaN(d)) return "—";
    return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
  }
  function daysBadge(days) {
    if (days >= 14) return `<span style="color:hsl(0 70% 60%)">${days}d ago</span>`;
    if (days >= 7)  return `<span style="color:hsl(38 80% 55%)">${days}d ago</span>`;
    if (days >= 2)  return `<span style="color:hsl(215 80% 65%)">${days}d ago</span>`;
    return `<span style="color:hsl(145 60% 55%)">${days}d ago</span>`;
  }
  function stars(n) {
    const s = Number(n || 0);
    if (!s) return "";
    return "★".repeat(Math.min(s, 5)) + "☆".repeat(Math.max(0, 5 - s));
  }
  function toast(msg, type) {
    const el = document.createElement("div");
    el.textContent = msg;
    el.style.cssText = [
      "position:fixed;bottom:24px;right:24px;z-index:9999;",
      "padding:12px 20px;border-radius:10px;font-size:13px;font-weight:600;",
      "max-width:340px;box-shadow:0 4px 20px #0007;word-break:break-word;",
      type === "error"
        ? "background:hsl(0 70% 40%);color:#fff;"
        : "background:hsl(145 60% 38%);color:#fff;",
    ].join("");
    document.body.appendChild(el);
    setTimeout(() => el.remove(), 3500);
  }
  function safeId(s) {
    return String(s || "").replace(/[^a-zA-Z0-9_-]/g, "_");
  }

  // ── OVERVIEW ──────────────────────────────────────────────────────────────
  async function loadOverview() {
    const loadingEl = document.getElementById("overviewLoading");
    const contentEl = document.getElementById("overviewContent");
    if (loadingEl) { loadingEl.style.display = "block"; loadingEl.textContent = "Loading overview…"; }
    if (contentEl) contentEl.style.display = "none";
    try {
      const d = await window.Api.fetchJson("/api/marketing/overview");
      const o = d.overview || {};
      renderStatGrid(o);
      renderSourceTable(o.source_breakdown || []);
      if (loadingEl) loadingEl.style.display = "none";
      if (contentEl) contentEl.style.display = "block";
    } catch (e) {
      if (loadingEl) loadingEl.textContent = "Error: " + e.message;
    }
  }

  function renderStatGrid(o) {
    const el = document.getElementById("statGrid");
    if (!el) return;
    const cards = [
      { label: "Total Leads",         value: o.leads_total || 0,                         sub: "all time",             cls: "" },
      { label: "Booked",              value: o.booked_count || 0,                         sub: "ever scheduled",       cls: "accent-blue" },
      { label: "Revenue",             value: fmt$(o.revenue_total || 0),                  sub: "invoiced / paid",      cls: "accent-green" },
      { label: "Close Rate",          value: (o.close_rate_pct || 0) + "%",               sub: "leads → booked",       cls: "" },
      { label: "Quote-to-Book",       value: (o.quote_to_book_pct || 0) + "%",            sub: "quoted → booked",      cls: "" },
      { label: "Median Response",     value: o.median_first_response_hours != null ? o.median_first_response_hours + "h" : "—", sub: "first-touch time",    cls: o.median_first_response_hours != null && o.median_first_response_hours <= 4 ? "accent-green" : "" },
      { label: "Review Eligible",     value: o.review_eligible || 0,                      sub: "completed jobs",       cls: "" },
      { label: "Asks Sent",           value: o.review_asked || 0,                         sub: "all time",             cls: "accent-blue" },
      { label: "Reviews Received",    value: o.review_received || 0,                      sub: "captured",             cls: "accent-green" },
      { label: "Ask Rate",            value: (o.review_request_rate_pct || 0) + "%",      sub: "eligible → asked",     cls: "" },
      { label: "Conversion Rate",     value: (o.review_conversion_rate_pct || 0) + "%",   sub: "asked → received",     cls: o.review_conversion_rate_pct >= 40 ? "accent-green" : "" },
      { label: "Repeat Customers",    value: (o.repeat_customer_rate_pct || 0) + "%",     sub: "2+ jobs by phone",     cls: "" },
      { label: "Stale Quotes",        value: o.stale_quote_count || 0,                    sub: "open, 48h+ no contact", cls: o.stale_quote_count > 0 ? "accent-amber" : "" },
    ];
    el.innerHTML = cards.map(c => `
      <div class="stat-card ${esc(c.cls)}">
        <div class="stat-card-label">${esc(c.label)}</div>
        <div class="stat-card-value">${esc(String(c.value))}</div>
        <div class="stat-card-sub">${esc(c.sub)}</div>
      </div>`).join("");
  }

  function renderSourceTable(breakdown) {
    const tbody = document.getElementById("sourceTableBody");
    if (!tbody) return;
    if (!breakdown.length) {
      tbody.innerHTML = `<tr><td colspan="5" style="text-align:center;color:hsl(220 15% 50%);padding:20px;">No source data yet — tag leads with a source when creating them.</td></tr>`;
      return;
    }
    const maxLeads = Math.max(...breakdown.map(r => r.leads), 1);
    tbody.innerHTML = breakdown.map(r => {
      const barW = Math.round((r.leads / maxLeads) * 80);
      return `<tr>
        <td><strong>${esc(r.source)}</strong></td>
        <td style="text-align:right;">${r.leads}</td>
        <td style="text-align:right;">${r.booked}</td>
        <td style="text-align:right;">${fmt$(r.revenue)}</td>
        <td><span class="close-bar" style="width:${barW}px;"></span> <span style="font-size:11px;color:hsl(220 15% 55%);">${r.close_rate}%</span></td>
      </tr>`;
    }).join("");
  }

  // ── REVIEWS ───────────────────────────────────────────────────────────────
  async function loadReviews() {
    const loadingEl = document.getElementById("reviewsLoading");
    if (loadingEl) { loadingEl.style.display = "block"; loadingEl.textContent = "Loading reviews…"; }
    document.querySelectorAll(".rev-subpanel").forEach(p => { p.style.visibility = "hidden"; });

    // Wire subtab switching (idempotent — only binds once via flag)
    if (!loadReviews._tabsBound) {
      loadReviews._tabsBound = true;
      document.querySelectorAll(".rev-subtab").forEach(btn => {
        btn.addEventListener("click", () => {
          document.querySelectorAll(".rev-subtab").forEach(b => b.classList.remove("active"));
          document.querySelectorAll(".rev-subpanel").forEach(p => p.classList.remove("active"));
          btn.classList.add("active");
          const sp = document.getElementById("subpanel-" + btn.dataset.subpanel);
          if (sp) sp.classList.add("active");
        });
      });
    }

    try {
      const d = await window.Api.fetchJson("/api/reviews");
      Store.queue = {}; (d.queue || []).forEach(r => { Store.queue[r.lead_id] = r; });
      Store.pending = {}; (d.pending || []).forEach(r => { Store.pending[r.lead_id] = r; });
      Store.received = {}; (d.received || []).forEach(r => { Store.received[r.lead_id] = r; });

      renderReviewQueue(d.queue || []);
      renderReviewPending(d.pending || []);
      renderReviewReceived(d.received || []);
      renderResponseDue(d.response_due || []);

      setBadge("queueCount", (d.queue || []).length);
      setBadge("pendingCount", (d.pending || []).length);
      setBadge("receivedCount", (d.received || []).length);
      setBadge("responseDueCount", (d.response_due || []).length);

      if (loadingEl) loadingEl.style.display = "none";
      document.querySelectorAll(".rev-subpanel").forEach(p => { p.style.visibility = ""; });
    } catch (e) {
      if (loadingEl) loadingEl.textContent = "Error: " + e.message;
    }
  }

  function setBadge(id, count) {
    const el = document.getElementById(id);
    if (!el) return;
    if (count > 0) {
      el.textContent = count;
      el.style.cssText = "background:hsl(215 80% 50%);color:#fff;font-size:10px;font-weight:700;padding:1px 7px;border-radius:99px;";
    } else { el.textContent = ""; el.style.cssText = ""; }
  }

  function renderReviewQueue(queue) {
    const el = document.getElementById("queueList");
    if (!el) return;
    if (!queue.length) {
      el.innerHTML = `<div class="empty-state">No eligible jobs in the queue — great work! (Requires SMS opt-in + phone number on the lead.)</div>`;
      return;
    }
    el.innerHTML = queue.map(r => {
      const sid = safeId(r.lead_id);
      return `
        <div class="rev-card queue-card" id="qcard-${sid}">
          <div class="rev-card-body">
            <div class="rev-card-name">${esc(r.name)}</div>
            <div class="rev-card-meta">
              ${esc(r.job_type || "Service")} &bull; ${esc(r.city || "Orange")} &bull; ${esc(r.phone)} &bull; Completed ${daysBadge(r.days_since_complete)}
            </div>
          </div>
          <button class="rev-btn rev-btn-ask" data-lead-id="${esc(r.lead_id)}" data-action="ask">Send Review Ask</button>
        </div>`;
    }).join("");
    el.querySelectorAll("[data-action='ask']").forEach(btn => {
      btn.addEventListener("click", () => sendReviewAsk(btn.dataset.leadId, btn));
    });
  }

  function renderReviewPending(pending) {
    const el = document.getElementById("pendingList");
    if (!el) return;
    if (!pending.length) { el.innerHTML = `<div class="empty-state">No pending review asks.</div>`; return; }
    el.innerHTML = pending.map(r => {
      const sid = safeId(r.lead_id);
      const isAsked = r.review_status === "asked";
      const daysSinceAsk = r.days_since_ask || r.days_since_reminder || 0;
      return `
        <div class="rev-card pending-card" id="pcard-${sid}">
          <div class="rev-card-body">
            <div class="rev-card-name">${esc(r.name)}</div>
            <div class="rev-card-meta">
              ${esc(r.job_type || "Service")} &bull; ${esc(r.city || "Orange")} &bull; ${esc(r.phone || "No phone")}
              &bull; Ask sent ${daysBadge(daysSinceAsk)}
              &bull; Status: <strong>${esc(r.review_status)}</strong>
            </div>
          </div>
          <div style="display:flex;flex-direction:column;gap:6px;align-items:flex-end;">
            ${isAsked && r.reminder_eligible
              ? `<button class="rev-btn rev-btn-remind" data-lead-id="${esc(r.lead_id)}" data-action="remind">Send Reminder</button>`
              : isAsked
                ? `<span style="font-size:11px;color:hsl(220 15% 45%);">Wait ${2 - (r.days_since_ask || 0)}d for reminder</span>`
                : ""}
            <button class="rev-btn rev-btn-log" data-lead-id="${esc(r.lead_id)}" data-action="toggle-log" style="font-size:11px;padding:5px 10px;">Log Review Received</button>
          </div>
        </div>
        <div id="logform-${sid}" class="log-inline-form" style="display:none;padding:12px;background:hsl(220 20% 14%);border-radius:8px;margin-top:-6px;margin-bottom:10px;">
          <div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center;">
            <select id="stars-${sid}" style="width:90px;padding:6px 8px;border-radius:6px;background:hsl(220 20% 18%);color:hsl(220 20% 90%);border:1px solid hsl(220 20% 25%);">
              <option value="">Stars</option>
              <option value="5">★★★★★ 5</option>
              <option value="4">★★★★☆ 4</option>
              <option value="3">★★★☆☆ 3</option>
              <option value="2">★★☆☆☆ 2</option>
              <option value="1">★☆☆☆☆ 1</option>
            </select>
            <input id="revtext-${sid}" placeholder="Paste review text (optional)" style="flex:1;min-width:180px;padding:6px 10px;border-radius:6px;background:hsl(220 20% 18%);color:hsl(220 20% 90%);border:1px solid hsl(220 20% 25%);" />
            <button class="rev-btn rev-btn-log" data-lead-id="${esc(r.lead_id)}" data-safe-id="${sid}" data-action="log-received">Save</button>
          </div>
        </div>`;
    }).join("");

    el.querySelectorAll("[data-action='remind']").forEach(btn => {
      btn.addEventListener("click", () => sendReminder(btn.dataset.leadId, btn));
    });
    el.querySelectorAll("[data-action='toggle-log']").forEach(btn => {
      btn.addEventListener("click", () => {
        const sid = safeId(btn.dataset.leadId);
        const form = document.getElementById("logform-" + sid);
        if (form) form.style.display = form.style.display === "none" ? "block" : "none";
      });
    });
    el.querySelectorAll("[data-action='log-received']").forEach(btn => {
      btn.addEventListener("click", () => logReceived(btn.dataset.leadId, btn.dataset.safeId));
    });
  }

  function renderReviewReceived(received) {
    const el = document.getElementById("receivedList");
    if (!el) return;
    if (!received.length) { el.innerHTML = `<div class="empty-state">No reviews logged yet.</div>`; return; }
    el.innerHTML = received.map(r => {
      const sid = safeId(r.lead_id);
      const rev = r.review || {};
      const starRating = rev.star_rating || r.star_rating || "";
      const revText = rev.review_text || r.review_text || "";
      const svcTag  = rev.service_tag || "";
      const cityTag = rev.city_tag || "";
      const techTag = rev.technician_tag || "";
      const notes   = rev.notes || "";
      const revId   = rev.id || r.lead_id;
      return `
        <div class="rev-card received-card" id="rcard-${sid}">
          <div class="rev-card-body" style="width:100%;">
            <div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap;">
              <span class="rev-card-name">${esc(r.name)}</span>
              <span class="rev-card-stars">${stars(starRating)}</span>
              <span style="font-size:11px;color:hsl(220 15% 50%);">${fmtDate(rev.review_received_at)}</span>
              <button class="copy-btn" data-copy="${esc(revText || r.name + " gave us 5 stars on Google!")}" data-action="copy">Copy</button>
            </div>
            <div class="rev-card-meta">${esc(r.job_type || "Service")}</div>
            ${revText ? `<div class="rev-card-review">"${esc(revText)}"</div>` : ""}
            <div class="testimonial-tags" style="margin-top:10px;display:flex;gap:8px;flex-wrap:wrap;align-items:center;">
              <input class="tag-input" placeholder="Service tag" value="${esc(svcTag)}" data-field="service_tag" data-rev-id="${esc(revId)}" data-lead-id="${esc(r.lead_id)}" style="width:130px;" />
              <input class="tag-input" placeholder="City tag" value="${esc(cityTag)}" data-field="city_tag" data-rev-id="${esc(revId)}" data-lead-id="${esc(r.lead_id)}" style="width:110px;" />
              <input class="tag-input" placeholder="Technician" value="${esc(techTag)}" data-field="technician_tag" data-rev-id="${esc(revId)}" data-lead-id="${esc(r.lead_id)}" style="width:120px;" />
              <button class="copy-btn" data-action="save-tags" data-lead-id="${esc(r.lead_id)}" data-rev-id="${esc(revId)}" data-safe-id="${sid}">Save Tags</button>
            </div>
            <div style="margin-top:8px;">
              <textarea class="tag-input" placeholder="Internal notes…" data-field="notes" data-rev-id="${esc(revId)}" data-lead-id="${esc(r.lead_id)}" style="width:100%;min-height:54px;resize:vertical;">${esc(notes)}</textarea>
            </div>
          </div>
        </div>`;
    }).join("");

    el.querySelectorAll(".tag-input").forEach(inp => {
      inp.style.cssText += "padding:5px 8px;border-radius:6px;background:hsl(220 20% 17%);color:hsl(220 20% 88%);border:1px solid hsl(220 20% 24%);font-size:12px;";
    });
    el.querySelectorAll("[data-action='copy']").forEach(btn => {
      btn.addEventListener("click", () => {
        navigator.clipboard.writeText(btn.dataset.copy || "").then(() => toast("Copied!", "success")).catch(() => toast("Copy failed", "error"));
      });
    });
    el.querySelectorAll("[data-action='save-tags']").forEach(btn => {
      btn.addEventListener("click", async () => {
        const revId = btn.dataset.revId;
        const leadId = btn.dataset.leadId;
        const card = document.getElementById("rcard-" + safeId(leadId));
        const getValue = (field) => {
          const inp = card ? card.querySelector(`[data-field="${field}"]`) : null;
          return inp ? inp.value.trim() : "";
        };
        const payload = {
          lead_id: leadId,
          service_tag: getValue("service_tag"),
          city_tag: getValue("city_tag"),
          technician_tag: getValue("technician_tag"),
          notes: getValue("notes"),
        };
        try {
          await window.Api.fetchJson("/api/reviews/" + encodeURIComponent(revId), {
            method: "PATCH", headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload),
          });
          toast("Tags saved!", "success");
        } catch (e) { toast("Error: " + e.message, "error"); }
      });
    });
  }

  function renderResponseDue(due) {
    const el = document.getElementById("responseDueList");
    if (!el) return;
    if (!due.length) { el.innerHTML = `<div class="empty-state">No reviews waiting for a response — great job staying on top of it!</div>`; return; }
    el.innerHTML = due.map(r => {
      const rev = r.review || {};
      const starRating = rev.star_rating || r.star_rating || "";
      const revText = rev.review_text || r.review_text || "";
      return `
        <div class="rev-card response-card">
          <div class="rev-card-body">
            <div class="rev-card-name">${esc(r.name)} <span class="rev-card-stars">${stars(starRating)}</span></div>
            <div class="rev-card-meta">${esc(r.job_type || "Service")} &bull; Received ${fmtDate(rev.review_received_at)}</div>
            ${revText ? `<div class="rev-card-review">"${esc(revText)}"</div>` : ""}
          </div>
          <button class="rev-btn rev-btn-respond" data-lead-id="${esc(r.lead_id)}" data-action="mark-responded">Mark Responded</button>
        </div>`;
    }).join("");
    el.querySelectorAll("[data-action='mark-responded']").forEach(btn => {
      btn.addEventListener("click", () => markResponded(btn.dataset.leadId, btn));
    });
  }

  async function sendReviewAsk(leadId, btn) {
    if (!leadId) return;
    const r = Store.queue[leadId] || {};
    if (btn) { btn.disabled = true; btn.textContent = "Sending…"; }
    try {
      const d = await window.Api.fetchJson("/api/reviews/ask", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ lead_id: leadId, name: r.name, phone: r.phone, job_type: r.job_type }),
      });
      if (d.ok) {
        toast(d.sms_sent ? "Review ask sent via SMS!" : "Review ask logged (SMS not yet configured).", "success");
        setTimeout(() => loadReviews(), 600);
      } else {
        toast("Error: " + (d.error || "unknown"), "error");
        if (btn) { btn.disabled = false; btn.textContent = "Send Review Ask"; }
      }
    } catch (e) {
      toast("Error: " + e.message, "error");
      if (btn) { btn.disabled = false; btn.textContent = "Send Review Ask"; }
    }
  }

  async function sendReminder(leadId, btn) {
    if (!leadId) return;
    const r = Store.pending[leadId] || {};
    if (btn) { btn.disabled = true; btn.textContent = "Sending…"; }
    try {
      const d = await window.Api.fetchJson("/api/reviews/remind", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ lead_id: leadId, name: r.name, phone: r.phone, job_type: r.job_type }),
      });
      if (d.ok) {
        toast(d.sms_sent ? "Reminder sent via SMS!" : "Reminder logged (SMS not configured).", "success");
        setTimeout(() => loadReviews(), 600);
      } else {
        toast("Error: " + (d.error || "unknown"), "error");
        if (btn) { btn.disabled = false; btn.textContent = "Send Reminder"; }
      }
    } catch (e) {
      toast("Error: " + e.message, "error");
      if (btn) { btn.disabled = false; btn.textContent = "Send Reminder"; }
    }
  }

  async function logReceived(leadId, safeIdStr) {
    const sid = safeIdStr || safeId(leadId);
    const starsEl = document.getElementById("stars-" + sid);
    const textEl  = document.getElementById("revtext-" + sid);
    const starsVal = starsEl ? starsEl.value : "";
    const textVal  = textEl  ? textEl.value : "";
    try {
      await window.Api.fetchJson("/api/reviews/" + encodeURIComponent(leadId), {
        method: "PATCH", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          lead_id: leadId,
          star_rating: starsVal,
          review_text: textVal,
          review_received_at: new Date().toISOString(),
        }),
      });
      toast("Review logged!", "success");
      setTimeout(() => loadReviews(), 600);
    } catch (e) { toast("Error: " + e.message, "error"); }
  }

  async function markResponded(leadId, btn) {
    if (btn) { btn.disabled = true; btn.textContent = "Saving…"; }
    try {
      await window.Api.fetchJson("/api/reviews/" + encodeURIComponent(leadId), {
        method: "PATCH", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ lead_id: leadId, response_status: "responded" }),
      });
      toast("Marked as responded!", "success");
      setTimeout(() => loadReviews(), 600);
    } catch (e) {
      toast("Error: " + e.message, "error");
      if (btn) { btn.disabled = false; btn.textContent = "Mark Responded"; }
    }
  }

  // ── FOLLOW-UP ─────────────────────────────────────────────────────────────
  async function loadFollowup() {
    const loadingEl = document.getElementById("followupLoading");
    const contentEl = document.getElementById("followupContent");
    if (loadingEl) { loadingEl.style.display = "block"; loadingEl.textContent = "Loading follow-up queue…"; }
    if (contentEl) contentEl.style.display = "none";
    try {
      const d = await window.Api.fetchJson("/api/marketing/followup");
      Store.followup = {};
      Object.values(d.buckets || {}).flat().forEach(r => { Store.followup[r.lead_id] = r; });
      renderFollowup(d.buckets || {});
      if (loadingEl) loadingEl.style.display = "none";
      if (contentEl) contentEl.style.display = "block";
    } catch (e) {
      if (loadingEl) loadingEl.textContent = "Error: " + e.message;
    }
  }

  function renderFollowup(buckets) {
    const el = document.getElementById("followupContent");
    if (!el) return;
    const defs = [
      { key: "24h",  label: "1–2 Days Old",  cls: "bucket-24h",  desc: "Friendly first nudge" },
      { key: "72h",  label: "3–6 Days Old",  cls: "bucket-72h",  desc: "Getting warm — follow up soon" },
      { key: "7d",   label: "7–13 Days Old", cls: "bucket-7d",   desc: "Stale — don't lose them" },
      { key: "14d+", label: "14+ Days Old",  cls: "bucket-14d",  desc: "Cold — last chance" },
    ];
    el.innerHTML = defs.map(def => {
      const rows = buckets[def.key] || [];
      const rowsHtml = rows.length === 0
        ? `<div class="empty-state" style="padding:14px;">None in this bucket.</div>`
        : rows.map(r => {
            const score = r.lead_quality_score || "";
            const SCORE_COLORS = { A: 'hsl(142,50%,40%)', B: 'hsl(38,80%,40%)', C: 'hsl(0,70%,50%)' };
            const SCORE_BG     = { A: 'hsl(142,30%,94%)', B: 'hsl(38,50%,94%)',  C: 'hsl(0,50%,95%)' };
            const scoreBadge = score
              ? `<span title="Lead quality score" style="display:inline-flex;align-items:center;justify-content:center;width:20px;height:20px;border-radius:50%;font-size:10px;font-weight:800;background:${SCORE_BG[score]||'hsl(220,10%,94%)'};color:${SCORE_COLORS[score]||'hsl(220,15%,55%)'};border:1px solid ${SCORE_COLORS[score]||'hsl(220,15%,55%)'};margin-left:4px;">${esc(score)}</span>`
              : "";
            return `
            <div class="bucket-row">
              <div class="bucket-row-name">${esc(r.name)}${scoreBadge}</div>
              <div class="bucket-row-meta">${esc(r.job_type || "—")} &bull; ${daysBadge(r.days_stale)} &bull; ${r.estimated_value > 0 ? fmt$(r.estimated_value) : "—"}</div>
              <button class="bucket-send-btn" data-lead-id="${esc(r.lead_id)}" data-action="send-followup">Send Text</button>
            </div>`;
          }).join("");
      return `
        <div class="bucket-section">
          <div class="bucket-header ${def.cls}" data-action="toggle-bucket">
            <div class="bucket-label">${esc(def.label)}</div>
            <span class="bucket-count">${rows.length}</span>
            <span style="font-size:11px;color:hsl(220 15% 55%);flex:1;">${esc(def.desc)}</span>
            <span class="bucket-arrow">▾</span>
          </div>
          <div class="bucket-rows ${rows.length > 0 ? "open" : ""}">${rowsHtml}</div>
        </div>`;
    }).join("");

    el.querySelectorAll("[data-action='toggle-bucket']").forEach(header => {
      header.addEventListener("click", () => {
        const rows = header.nextElementSibling;
        rows.classList.toggle("open");
        const arrow = header.querySelector(".bucket-arrow");
        if (arrow) arrow.textContent = rows.classList.contains("open") ? "▾" : "▸";
      });
    });
    el.querySelectorAll("[data-action='send-followup']").forEach(btn => {
      btn.addEventListener("click", () => sendFollowup(btn.dataset.leadId, btn));
    });
  }

  async function sendFollowup(leadId, btn) {
    const r = Store.followup[leadId] || {};
    if (btn) { btn.disabled = true; btn.textContent = "Sending…"; }
    try {
      const d = await window.Api.fetchJson("/api/marketing/followup/send", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ lead_id: leadId, name: r.name, phone: r.phone, job_type: r.job_type }),
      });
      if (d.ok) {
        toast(d.sms_sent ? "Follow-up sent!" : "Logged (SMS not configured).", "success");
        if (btn) { btn.textContent = "Sent"; btn.style.background = "hsl(145 60% 38%)"; }
      } else {
        toast("Error: " + (d.error || "unknown"), "error");
        if (btn) { btn.disabled = false; btn.textContent = "Send Text"; }
      }
    } catch (e) {
      toast("Error: " + e.message, "error");
      if (btn) { btn.disabled = false; btn.textContent = "Send Text"; }
    }
  }

  // ── SEGMENTS ──────────────────────────────────────────────────────────────
  async function loadSegments() {
    const loadingEl = document.getElementById("segmentsLoading");
    const contentEl = document.getElementById("segmentsContent");
    if (loadingEl) { loadingEl.style.display = "block"; loadingEl.textContent = "Loading smart lists…"; }
    if (contentEl) contentEl.style.display = "none";
    try {
      const d = await window.Api.fetchJson("/api/marketing/segments");
      renderSegments(d.segments || {});
      if (loadingEl) loadingEl.style.display = "none";
      if (contentEl) contentEl.style.display = "block";
    } catch (e) {
      if (loadingEl) loadingEl.textContent = "Error: " + e.message;
    }
  }

  const SEG_DEFS = [
    { key: "needs_review_ask",   icon: "★",  title: "Needs Review Ask",   desc: "Completed, SMS opted-in, not yet contacted" },
    { key: "stale_quote",        icon: "◇",  title: "Stale Quotes",        desc: "Open quotes with no activity in 48+ hours" },
    { key: "reactivation_ready", icon: "↻",  title: "Reactivation Ready",  desc: "No job in 6+ months" },
    { key: "repeat_customers",   icon: "◆",  title: "Repeat Customers",     desc: "2 or more completed jobs" },
    { key: "high_value",         icon: "$",  title: "High Value Leads",     desc: "At or above your configured value threshold" },
    { key: "no_sms_opt_in",      icon: "○",  title: "No SMS Opt-in",        desc: "Completed jobs we can't text — consider calling" },
  ];

  function renderSegments(segments) {
    const el = document.getElementById("segmentsContent");
    if (!el) return;
    el.innerHTML = SEG_DEFS.map(def => {
      const rows = segments[def.key] || [];
      const rowsHtml = rows.length === 0
        ? `<div class="empty-state" style="padding:14px 16px;">No customers in this segment.</div>`
        : rows.slice(0, 60).map(r => {
            let meta = "";
            if (def.key === "needs_review_ask")   meta = daysBadge(r.days_since_complete) + " completed";
            else if (def.key === "stale_quote")   meta = daysBadge(r.days_stale) + " stale";
            else if (def.key === "reactivation_ready") meta = daysBadge(r.days_inactive) + " inactive";
            else if (def.key === "repeat_customers")   meta = r.job_count + " jobs";
            else if (def.key === "high_value")    meta = fmt$(r.value);
            else meta = "No opt-in";

            const phone = esc(r.phone || "");
            const lid   = esc(r.lead_id || "");
            const sendAction = ["needs_review_ask", "stale_quote", "reactivation_ready", "repeat_customers"].includes(def.key)
              ? `<button class="seg-qa-btn" data-lead-id="${lid}" data-name="${esc(r.name)}" data-phone="${phone}" data-seg="${def.key}" data-action="seg-send">Send</button>`
              : "";
            const callBtn  = phone ? `<a class="seg-qa-btn seg-qa-call" href="tel:${phone}" title="Call ${esc(r.name)}">Call</a>` : "";
            const viewBtn  = lid  ? `<a class="seg-qa-btn seg-qa-view" href="/crm/lead/${lid}">View</a>` : "";

            const segScore = r.lead_quality_score || "";
            const SCORE_COLORS2 = { A: 'hsl(142,50%,40%)', B: 'hsl(38,80%,40%)', C: 'hsl(0,70%,50%)' };
            const SCORE_BG2     = { A: 'hsl(142,30%,94%)', B: 'hsl(38,50%,94%)',  C: 'hsl(0,50%,95%)' };
            const segScoreBadge = segScore
              ? `<span title="Lead quality score" style="display:inline-flex;align-items:center;justify-content:center;width:18px;height:18px;border-radius:50%;font-size:10px;font-weight:800;background:${SCORE_BG2[segScore]||'hsl(220,10%,94%)'};color:${SCORE_COLORS2[segScore]||'hsl(220,15%,55%)'};border:1px solid ${SCORE_COLORS2[segScore]||'hsl(220,15%,55%)'};margin-left:4px;flex-shrink:0;">${esc(segScore)}</span>`
              : "";
            return `
              <div class="seg-row">
                <div class="seg-row-info">
                  <span class="seg-row-name" style="display:flex;align-items:center;">${esc(r.name)}${segScoreBadge}</span>
                  <span class="seg-row-meta">${esc(r.phone || "No phone")} &bull; ${meta}</span>
                </div>
                <div class="seg-row-actions">${sendAction}${callBtn}${viewBtn}</div>
              </div>`;
          }).join("") + (rows.length > 60 ? `<div class="seg-row" style="justify-content:center;color:hsl(220 15% 50%);font-size:12px;">+ ${rows.length - 60} more</div>` : "");

      return `
        <div class="seg-section">
          <div class="seg-header" data-action="toggle-seg">
            <span class="seg-icon">${def.icon}</span>
            <span class="seg-title">${esc(def.title)}</span>
            <span class="seg-desc">${esc(def.desc)}</span>
            <span class="seg-count">${rows.length}</span>
            <span class="seg-arrow" style="font-size:12px;color:hsl(220 15% 50%);margin-left:4px;">▾</span>
          </div>
          <div class="seg-rows ${rows.length > 0 ? "open" : ""}">${rowsHtml}</div>
        </div>`;
    }).join("");

    el.querySelectorAll("[data-action='toggle-seg']").forEach(header => {
      header.addEventListener("click", () => {
        const rows = header.nextElementSibling;
        rows.classList.toggle("open");
        const arrow = header.querySelector(".seg-arrow");
        if (arrow) arrow.textContent = rows.classList.contains("open") ? "▾" : "▸";
      });
    });
    el.querySelectorAll("[data-action='seg-send']").forEach(btn => {
      btn.addEventListener("click", async () => {
        const leadId = btn.dataset.leadId;
        const name   = btn.dataset.name;
        const phone  = btn.dataset.phone;
        const seg    = btn.dataset.seg;
        if (!leadId && !phone) return alert("No lead ID or phone number available.");
        if (!window.confirm(`Send a text to ${name || phone}?`)) return;
        btn.disabled = true; btn.textContent = "Sending…";
        try {
          if (seg === "needs_review_ask") {
            await window.Api.fetchJson("/api/reviews/ask", {
              method: "POST", headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ lead_id: leadId, name, phone }),
            });
          } else {
            await window.Api.fetchJson("/api/marketing/followup/send", {
              method: "POST", headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ lead_id: leadId, name, phone }),
            });
          }
          btn.textContent = "Sent";
        } catch (e) {
          btn.disabled = false; btn.textContent = "Send";
          alert("Error: " + e.message);
        }
      });
    });
  }

  // ── TEMPLATES ─────────────────────────────────────────────────────────────
  const SAMPLE_VARS = {
    first_name: "Sarah",
    service: "panel upgrade",
    review_link: "https://g.page/r/vickeryelectric/review",
    city: "Orange",
    quote_link: "https://vickeryelectric.com/quote",
  };

  const CATEGORY_LABELS = {
    review_ask: "Review Ask",
    review_reminder: "Review Reminder",
    quote_followup: "Quote Follow-Up",
    job_complete_thankyou: "Job Thank-You",
    reactivation: "Reactivation",
    referral_ask: "Referral Ask",
  };

  const VARS_BY_CATEGORY = {
    review_ask: "{first_name} {service} {review_link}",
    review_reminder: "{first_name} {review_link}",
    quote_followup: "{first_name} {service}",
    job_complete_thankyou: "{first_name}",
    reactivation: "{first_name}",
    referral_ask: "{first_name}",
  };

  function previewTemplate(body) {
    return body.replace(/\{(\w+)\}/g, (_, k) => SAMPLE_VARS[k] || `{${k}}`);
  }

  async function loadTemplates() {
    const loadingEl = document.getElementById("templatesLoading");
    const gridEl    = document.getElementById("templateGrid");
    if (loadingEl) { loadingEl.style.display = "block"; loadingEl.textContent = "Loading templates…"; }
    if (gridEl)    gridEl.style.display = "none";

    // Bind new-template form handlers (idempotent)
    if (!loadTemplates._formBound) {
      loadTemplates._formBound = true;
      const newTmplBtn  = document.getElementById("newTmplBtn");
      const ntCancelBtn = document.getElementById("ntCancelBtn");
      const ntSaveBtn   = document.getElementById("ntSaveBtn");
      if (newTmplBtn) newTmplBtn.addEventListener("click", () => {
        document.getElementById("newTmplForm").classList.toggle("open");
      });
      if (ntCancelBtn) ntCancelBtn.addEventListener("click", () => {
        document.getElementById("newTmplForm").classList.remove("open");
        const r = document.getElementById("ntResult"); if (r) r.textContent = "";
      });
      if (ntSaveBtn) ntSaveBtn.addEventListener("click", async () => {
        const name     = document.getElementById("ntName").value.trim();
        const category = document.getElementById("ntCategory").value;
        const body     = document.getElementById("ntBody").value.trim();
        const resultEl = document.getElementById("ntResult");
        if (!name || !body) { resultEl.textContent = "Name and body are required."; resultEl.style.color = "hsl(0 70% 60%)"; return; }
        resultEl.textContent = "Saving…"; resultEl.style.color = "";
        try {
          const d = await window.Api.fetchJson("/api/templates", {
            method: "POST", headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ name, category, channel: "SMS", body }),
          });
          if (d.ok) {
            toast("Template created!", "success");
            document.getElementById("newTmplForm").classList.remove("open");
            document.getElementById("ntName").value = "";
            document.getElementById("ntBody").value = "";
            resultEl.textContent = "";
            loadTemplates();
          } else {
            resultEl.textContent = d.error || "Error saving.";
            resultEl.style.color = "hsl(0 70% 60%)";
          }
        } catch (e) { resultEl.textContent = e.message; resultEl.style.color = "hsl(0 70% 60%)"; }
      });
    }

    try {
      const d = await window.Api.fetchJson("/api/templates");
      renderTemplates(d.templates || []);
      if (loadingEl) loadingEl.style.display = "none";
      if (gridEl)    gridEl.style.display = "grid";
    } catch (e) {
      if (loadingEl) loadingEl.textContent = "Error: " + e.message;
    }
  }

  function renderTemplates(templates) {
    const grid = document.getElementById("templateGrid");
    if (!grid) return;
    if (!templates.length) { grid.innerHTML = `<div class="empty-state">No templates found.</div>`; return; }
    grid.innerHTML = templates.map(t => {
      const isActive = t.active === "true";
      const catLabel = CATEGORY_LABELS[t.category] || t.category;
      const vars = VARS_BY_CATEGORY[t.category] || "";
      const tid = t.id;
      return `
        <div class="tmpl-card" id="tmpl-${esc(tid)}">
          <div class="tmpl-card-header">
            <span class="tmpl-card-name">${esc(t.name)}</span>
            <span class="tmpl-chip chip-sms">SMS</span>
            <span class="tmpl-chip chip-${esc(t.category)}">${esc(catLabel)}</span>
          </div>
          <div class="tmpl-body" id="tmplbody-${esc(tid)}">${esc(t.body)}</div>
          <div class="tmpl-vars">Variables: ${esc(vars || "none")}</div>
          <div style="display:flex;align-items:center;gap:10px;margin-top:10px;flex-wrap:wrap;">
            <label class="tmpl-active-toggle">
              <button class="pill-toggle ${isActive ? "on" : "off"}" data-tmpl-id="${esc(tid)}" data-active="${isActive}" data-action="toggle-active" title="${isActive ? "Active" : "Inactive"}"></button>
              <span class="pill-label">${isActive ? "Active" : "Inactive"}</span>
            </label>
            <button class="copy-btn" data-copy="${esc(t.body)}" data-action="copy">Copy</button>
            <button class="copy-btn" data-tmpl-id="${esc(tid)}" data-action="toggle-edit">Edit</button>
            <button class="copy-btn" data-tmpl-id="${esc(tid)}" data-action="preview">Preview</button>
          </div>
          <div class="tmpl-edit-wrap" id="edit-${esc(tid)}">
            <textarea class="tmpl-edit-textarea" id="editBody-${esc(tid)}">${esc(t.body)}</textarea>
            <div class="tmpl-edit-actions">
              <button class="btn-save" data-tmpl-id="${esc(tid)}" data-action="save-tmpl">Save</button>
              <button class="btn-cancel" data-tmpl-id="${esc(tid)}" data-action="cancel-edit">Cancel</button>
            </div>
          </div>
          <div class="tmpl-preview-wrap" id="preview-${esc(tid)}" style="display:none;margin-top:10px;padding:12px;background:hsl(38 60% 14%);border-radius:8px;border:1px solid hsl(38 60% 25%);">
            <div style="font-size:11px;font-weight:700;letter-spacing:.5px;text-transform:uppercase;color:hsl(38 80% 55%);margin-bottom:6px;">Preview (sample values)</div>
            <div class="tmpl-preview-text" style="font-size:13px;line-height:1.55;white-space:pre-wrap;word-break:break-word;"></div>
          </div>
        </div>`;
    }).join("");

    grid.querySelectorAll("[data-action='copy']").forEach(btn => {
      btn.addEventListener("click", () => {
        navigator.clipboard.writeText(btn.dataset.copy || "").then(() => toast("Copied!", "success")).catch(() => toast("Copy failed", "error"));
      });
    });
    grid.querySelectorAll("[data-action='toggle-active']").forEach(btn => {
      btn.addEventListener("click", () => toggleActive(btn.dataset.tmplId, btn.dataset.active === "true", btn));
    });
    grid.querySelectorAll("[data-action='toggle-edit']").forEach(btn => {
      btn.addEventListener("click", () => {
        const wrap = document.getElementById("edit-" + btn.dataset.tmplId);
        if (!wrap) return;
        const open = wrap.classList.contains("open");
        wrap.classList.toggle("open", !open);
        btn.textContent = open ? "Edit" : "Close";
      });
    });
    grid.querySelectorAll("[data-action='preview']").forEach(btn => {
      btn.addEventListener("click", () => {
        const tid = btn.dataset.tmplId;
        const wrap = document.getElementById("preview-" + tid);
        const bodyEl = document.getElementById("editBody-" + tid) || document.getElementById("tmplbody-" + tid);
        if (!wrap) return;
        const open = wrap.style.display !== "none";
        wrap.style.display = open ? "none" : "block";
        if (!open && bodyEl) {
          const ptext = wrap.querySelector(".tmpl-preview-text");
          if (ptext) ptext.textContent = previewTemplate(bodyEl.value || bodyEl.textContent);
        }
        btn.textContent = open ? "Preview" : "Hide Preview";
      });
    });
    grid.querySelectorAll("[data-action='save-tmpl']").forEach(btn => {
      btn.addEventListener("click", () => saveTemplate(btn.dataset.tmplId));
    });
    grid.querySelectorAll("[data-action='cancel-edit']").forEach(btn => {
      btn.addEventListener("click", () => {
        const wrap = document.getElementById("edit-" + btn.dataset.tmplId);
        if (wrap) wrap.classList.remove("open");
        const editBtn = grid.querySelector(`[data-action='toggle-edit'][data-tmpl-id="${btn.dataset.tmplId}"]`);
        if (editBtn) editBtn.textContent = "Edit";
      });
    });
  }

  async function toggleActive(id, currentlyActive, btn) {
    const newVal = !currentlyActive;
    try {
      await window.Api.fetchJson("/api/templates/" + encodeURIComponent(id), {
        method: "PATCH", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ active: String(newVal) }),
      });
      btn.classList.toggle("on", newVal);
      btn.classList.toggle("off", !newVal);
      btn.dataset.active = String(newVal);
      const label = btn.nextElementSibling;
      if (label) label.textContent = newVal ? "Active" : "Inactive";
      toast(newVal ? "Template activated." : "Template deactivated.", "success");
    } catch (e) { toast("Error: " + e.message, "error"); }
  }

  async function saveTemplate(id) {
    const bodyEl = document.getElementById("editBody-" + id);
    if (!bodyEl) return;
    const newBody = bodyEl.value.trim();
    if (!newBody) return toast("Template body cannot be empty.", "error");
    try {
      await window.Api.fetchJson("/api/templates/" + encodeURIComponent(id), {
        method: "PATCH", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ body: newBody }),
      });
      toast("Template saved!", "success");
      const display = document.getElementById("tmplbody-" + id);
      if (display) display.textContent = newBody;
      const wrap = document.getElementById("edit-" + id);
      if (wrap) wrap.classList.remove("open");
      const previewWrap = document.getElementById("preview-" + id);
      if (previewWrap) previewWrap.style.display = "none";
    } catch (e) { toast("Error: " + e.message, "error"); }
  }

  // ── MARKETING SETTINGS ────────────────────────────────────────────────────
  let mktSettingsSaveBound = false;
  function bindMktSettingsSaveOnce() {
    if (mktSettingsSaveBound) return;
    mktSettingsSaveBound = true;
    const saveBtn  = document.getElementById("mktSettingsSaveBtn");
    const resultEl = document.getElementById("mktSettingsResult");
    if (!saveBtn) return;
    saveBtn.addEventListener("click", async () => {
      saveBtn.disabled = true; saveBtn.textContent = "Saving…";
      if (resultEl) resultEl.textContent = "";
      try {
        const d = await window.Api.fetchJson("/api/marketing/settings", {
          method:  "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            google_review_url:    document.getElementById("mktGoogleReviewUrl").value.trim(),
            high_value_threshold: Number(document.getElementById("mktHvThreshold").value) || 1000,
          }),
        });
        if (resultEl) {
          resultEl.textContent = d.ok ? "Settings saved." : (d.error || "Save failed.");
          resultEl.style.color = d.ok ? "hsl(140 60% 50%)" : "hsl(0 70% 60%)";
        }
      } catch (e) {
        if (resultEl) { resultEl.textContent = e.message; resultEl.style.color = "hsl(0 70% 60%)"; }
      }
      saveBtn.disabled = false; saveBtn.textContent = "Save Settings";
    });
  }

  async function loadMktSettings() {
    const loadingEl = document.getElementById("mktSettingsLoading");
    const contentEl = document.getElementById("mktSettingsContent");
    if (loadingEl) { loadingEl.style.display = "block"; loadingEl.textContent = "Loading settings…"; }
    if (contentEl) contentEl.style.display = "none";
    try {
      const d = await window.Api.fetchJson("/api/marketing/settings");
      if (d.ok && d.settings) {
        const urlEl = document.getElementById("mktGoogleReviewUrl");
        const hvEl  = document.getElementById("mktHvThreshold");
        if (urlEl) urlEl.value = d.settings.google_review_url   || "";
        if (hvEl)  hvEl.value  = d.settings.high_value_threshold || "1000";
      }
    } catch (e) { /* silently ignore — show whatever is in the inputs */ }
    if (loadingEl) loadingEl.style.display = "none";
    if (contentEl) contentEl.style.display = "block";
    bindMktSettingsSaveOnce();
  }

  // ── REFERRAL CENTER ───────────────────────────────────────────────────────
  let _refCardsLoaded = false;

  async function loadReferrals() {
    _refCardsLoaded = false;
    const loadingEl = document.getElementById("refLoading");
    const contentEl = document.getElementById("refContent");
    if (loadingEl) { loadingEl.style.display = "block"; loadingEl.textContent = "Loading referral data…"; }
    if (contentEl) contentEl.style.display = "none";

    // Wire subtab switching (idempotent)
    if (!loadReferrals._tabsBound) {
      loadReferrals._tabsBound = true;
      document.querySelectorAll(".ref-subtab").forEach(btn => {
        btn.addEventListener("click", () => {
          document.querySelectorAll(".ref-subtab").forEach(b => b.classList.remove("active"));
          document.querySelectorAll(".ref-subpanel").forEach(p => p.classList.remove("active"));
          btn.classList.add("active");
          const sp = document.getElementById("subpanel-" + btn.dataset.subpanel);
          if (sp) sp.classList.add("active");
          if (btn.dataset.subpanel === "ref-cards" && !_refCardsLoaded) {
            _refCardsLoaded = true;
            loadRefEmployeeCards();
          }
        });
      });
    }

    try {
      const d = await window.Api.fetchJson("/api/referrals");
      renderRefStats(d.stats || {});
      renderRefLedger(d.rows || []);
      const ready = (d.rows || []).filter(r => (r.reward_status || "").toLowerCase() === "ready");
      renderRefRewardQueue(ready);
      setBadge("refRewardBadge", ready.length);
      if (loadingEl) loadingEl.style.display = "none";
      if (contentEl) contentEl.style.display = "block";
    } catch (e) {
      if (loadingEl) loadingEl.textContent = "Error loading referrals: " + e.message;
    }
  }

  function renderRefStats(s) {
    const el = document.getElementById("refStatGrid");
    if (!el) return;
    const cards = [
      { label: "Total Referrals",    value: s.total || 0,                      sub: "all time",               cls: "" },
      { label: "Converted to Job",   value: s.booked || 0,                      sub: "booked or complete",     cls: "accent-green" },
      { label: "Conversion Rate",    value: (s.conversion_pct || 0) + "%",      sub: "referrals → booked",     cls: "" },
      { label: "Rewards Ready",      value: s.reward_ready || 0,                sub: "awaiting delivery",      cls: s.reward_ready > 0 ? "accent-amber" : "" },
      { label: "Rewards Paid",       value: s.reward_paid || 0,                 sub: "all time",               cls: "accent-blue" },
      { label: "Total Paid Out",     value: fmt$(s.total_paid || 0),             sub: "reward disbursements",   cls: "accent-green" },
    ];
    el.innerHTML = cards.map(c => `
      <div class="stat-card ${esc(c.cls)}">
        <div class="stat-card-label">${esc(c.label)}</div>
        <div class="stat-card-value">${esc(String(c.value))}</div>
        <div class="stat-card-sub">${esc(c.sub)}</div>
      </div>`).join("");
  }

  const STATUS_COLORS = {
    new:       "hsl(215 80% 65%)",
    contacted: "hsl(38 80% 60%)",
    booked:    "hsl(145 60% 55%)",
    complete:  "hsl(145 60% 55%)",
    rewarded:  "hsl(270 60% 70%)",
    declined:  "hsl(0 60% 60%)",
  };

  function renderRefLedger(rows) {
    const tbody = document.getElementById("refLedgerBody");
    if (!tbody) return;
    if (!rows.length) {
      tbody.innerHTML = `<tr><td colspan="9" style="text-align:center;padding:28px;color:hsl(220 15% 50%);">No referrals yet. They will appear here when submitted via the /referral page or an employee card link.</td></tr>`;
      return;
    }
    tbody.innerHTML = rows.map(r => {
      const sid = safeId(r.id);
      const sc  = STATUS_COLORS[(r.status || "new").toLowerCase()] || "hsl(220 15% 55%)";
      return `<tr id="refrow-${sid}">
        <td style="white-space:nowrap;">${esc(fmtDate(r.created_at))}</td>
        <td>
          <strong>${esc(r.referrer_name)}</strong>
          ${r.referrer_type === "employee" ? `<span style="font-size:10px;padding:1px 6px;border-radius:99px;background:hsl(215 80% 22%);color:hsl(215 80% 72%);margin-left:4px;">Employee</span>` : ""}
          <br><span style="font-size:11px;color:hsl(220 15% 55%);">${esc(r.referrer_phone)}</span>
        </td>
        <td>${esc(r.referee_name)}<br><span style="font-size:11px;color:hsl(220 15% 55%);">${esc(r.referee_phone)}</span></td>
        <td style="font-size:12px;max-width:140px;">${esc(r.referee_job_type || "—")}</td>
        <td><span style="color:${sc};font-weight:700;font-size:12px;">${esc(r.status || "new")}</span></td>
        <td>
          <select class="ref-inline-sel ref-status-sel" data-id="${esc(r.id)}">
            ${["new","contacted","booked","complete","rewarded","declined"].map(s =>
              `<option value="${s}"${(r.status||"new")===s?" selected":""}>${s}</option>`
            ).join("")}
          </select>
        </td>
        <td>
          <select class="ref-inline-sel ref-reward-sel" data-id="${esc(r.id)}">
            ${["pending","ready","paid"].map(s =>
              `<option value="${s}"${(r.reward_status||"pending")===s?" selected":""}>${s}</option>`
            ).join("")}
          </select>
        </td>
        <td>
          $<input class="ref-amt-inp" data-id="${esc(r.id)}" type="number" min="0" step="10"
            value="${esc(r.reward_amount || "50")}" />
        </td>
        <td>
          <button class="rev-btn rev-btn-log" style="font-size:11px;padding:5px 10px;" data-id="${esc(r.id)}" data-action="save-ref-row">Save</button>
        </td>
      </tr>`;
    }).join("");
    tbody.querySelectorAll("[data-action='save-ref-row']").forEach(btn => {
      btn.addEventListener("click", () => saveRefRow(btn.dataset.id, btn));
    });
  }

  async function saveRefRow(id, btn) {
    const row = document.getElementById("refrow-" + safeId(id));
    if (!row) return;
    const status        = row.querySelector(".ref-status-sel").value;
    const reward_status = row.querySelector(".ref-reward-sel").value;
    const reward_amount = row.querySelector(".ref-amt-inp").value;
    if (btn) { btn.disabled = true; btn.textContent = "Saving…"; }
    try {
      await window.Api.fetchJson(`/api/referrals/${encodeURIComponent(id)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status, reward_status, reward_amount }),
      });
      toast("Referral updated!", "success");
      loadReferrals();
    } catch (e) {
      toast("Error: " + e.message, "error");
      if (btn) { btn.disabled = false; btn.textContent = "Save"; }
    }
  }

  function renderRefRewardQueue(rows) {
    const el = document.getElementById("refRewardQueueList");
    if (!el) return;
    if (!rows.length) {
      el.innerHTML = `<div class="empty-state">No referrals with Reward Status = <strong>Ready</strong>.<br>Mark a referral's reward status as <em>ready</em> in the Ledger tab to queue it here.</div>`;
      return;
    }
    el.innerHTML = rows.map(r => {
      const sid = safeId(r.id);
      return `
        <div class="rev-card queue-card" style="border-left-color:hsl(38 80% 55%);">
          <div class="rev-card-body">
            <div class="rev-card-name">
              ${esc(r.referrer_name)}
              <span style="font-size:12px;font-weight:400;color:hsl(220 15% 60%);">&rarr; referred ${esc(r.referee_name)}</span>
            </div>
            <div class="rev-card-meta">
              ${esc(r.referrer_phone)}
              &bull; Reward: <strong>$${esc(r.reward_amount || "50")}</strong>
              &bull; Job status: <strong>${esc(r.status || "—")}</strong>
              ${r.notified_at ? `&bull; SMS sent ${fmtDate(r.notified_at)}` : ""}
            </div>
          </div>
          <button class="rev-btn rev-btn-ask" data-ref-id="${esc(r.id)}" data-action="notify-referrer">
            ${r.notified_at ? "Re-send SMS" : "Send Reward SMS"}
          </button>
        </div>`;
    }).join("");
    el.querySelectorAll("[data-action='notify-referrer']").forEach(btn => {
      btn.addEventListener("click", () => notifyReferrer(btn.dataset.refId, btn));
    });
  }

  async function notifyReferrer(refId, btn) {
    if (!refId) return;
    if (btn) { btn.disabled = true; btn.textContent = "Sending…"; }
    try {
      const d = await window.Api.fetchJson(`/api/referrals/${encodeURIComponent(refId)}/notify`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "{}",
      });
      if (d.ok) {
        toast(d.sms_sent ? "Reward SMS sent!" : "Logged (SMS not configured).", "success");
        loadReferrals();
      } else {
        toast("Error: " + (d.error || "unknown"), "error");
        if (btn) { btn.disabled = false; btn.textContent = "Send Reward SMS"; }
      }
    } catch (e) {
      toast("Error: " + e.message, "error");
      if (btn) { btn.disabled = false; btn.textContent = "Send Reward SMS"; }
    }
  }

  async function loadRefEmployeeCards() {
    const el = document.getElementById("refEmpCards");
    if (!el) return;
    el.innerHTML = `<div class="loading-state">Loading employee cards&hellip;</div>`;
    try {
      const d = await window.Api.fetchJson("/api/referrals/employees");
      if (!d.ok || !(d.employees || []).length) {
        el.innerHTML = `<div class="empty-state">No active employees found. Add staff in the People module first.</div>`;
        return;
      }
      const baseUrl = window.location.origin;
      el.innerHTML = d.employees.map(emp => {
        const refUrl = `${baseUrl}/referral?employee=${encodeURIComponent(emp.staff_id)}&ref=${encodeURIComponent(emp.staff_id)}`;
        const sid    = safeId(emp.staff_id);
        return `
          <div class="ref-emp-card">
            <div style="display:flex;align-items:flex-start;justify-content:space-between;gap:12px;flex-wrap:wrap;">
              <div>
                <div class="ref-emp-name">${esc(emp.name)}</div>
                <div class="ref-emp-role">${esc(emp.role)}</div>
              </div>
              <div style="display:flex;gap:8px;flex-wrap:wrap;">
                <button class="copy-btn" style="padding:6px 12px;" data-copy="${esc(refUrl)}" data-action="copy-ref-link">Copy Link</button>
                <button class="rev-btn rev-btn-log" data-emp-name="${esc(emp.name)}" data-ref-url="${esc(refUrl)}" data-action="print-ref-card">Print Card</button>
              </div>
            </div>
            <div class="ref-emp-url">${esc(refUrl)}</div>
            <div id="qr-${sid}" style="width:128px;height:128px;margin-top:4px;background:white;border-radius:6px;padding:4px;box-sizing:border-box;"></div>
          </div>`;
      }).join("");

      el.querySelectorAll("[data-action='copy-ref-link']").forEach(btn => {
        btn.addEventListener("click", () => {
          navigator.clipboard.writeText(btn.dataset.copy || "")
            .then(() => toast("Link copied!", "success"))
            .catch(() => toast("Copy failed", "error"));
        });
      });
      el.querySelectorAll("[data-action='print-ref-card']").forEach(btn => {
        btn.addEventListener("click", () => printEmpCard(btn.dataset.empName, btn.dataset.refUrl));
      });

      loadQRLib(() => {
        d.employees.forEach(emp => {
          const sid  = safeId(emp.staff_id);
          const qrEl = document.getElementById("qr-" + sid);
          const refUrl = `${baseUrl}/referral?employee=${encodeURIComponent(emp.staff_id)}&ref=${encodeURIComponent(emp.staff_id)}`;
          if (qrEl && window.QRCode) {
            try {
              new window.QRCode(qrEl, { text: refUrl, width: 120, height: 120, colorDark: "#0d2a6e", colorLight: "#ffffff" });
            } catch {
              qrEl.style.cssText = "font-size:10px;color:hsl(220 15% 50%);word-break:break-all;padding:4px;";
              qrEl.textContent = refUrl;
            }
          } else if (qrEl) {
            qrEl.style.cssText = "font-size:10px;color:hsl(220 15% 50%);word-break:break-all;padding:4px;";
            qrEl.textContent = "(QR unavailable — use the link above)";
          }
        });
      });
    } catch (e) {
      el.innerHTML = `<div class="empty-state">Error loading employees: ${esc(e.message)}</div>`;
    }
  }

  function loadQRLib(cb) {
    if (window.QRCode) { cb(); return; }
    const s = document.createElement("script");
    s.src = "https://cdnjs.cloudflare.com/ajax/libs/qrcodejs/1.0.0/qrcode.min.js";
    s.onload = cb;
    s.onerror = () => { console.warn("[referrals] QR library unavailable — showing URLs only."); cb(); };
    document.head.appendChild(s);
  }

  function printEmpCard(empName, refUrl) {
    const safeUrl  = String(refUrl || "").replace(/"/g, "&quot;");
    const safeName = String(empName || "").replace(/</g, "&lt;").replace(/>/g, "&gt;");
    const win = window.open("", "_blank", "width=500,height=400");
    if (!win) { toast("Pop-up blocked — allow pop-ups and try again.", "error"); return; }
    win.document.write(`<!doctype html><html lang="en"><head><meta charset="utf-8">
<title>Referral Card &mdash; ${safeName}</title>
<style>
  @import url('https://fonts.googleapis.com/css2?family=Outfit:wght@400;700;900&family=Plus+Jakarta+Sans:wght@400;600&display=swap');
  *{box-sizing:border-box;margin:0;padding:0;}
  body{background:#f4f6fb;display:flex;align-items:center;justify-content:center;min-height:100vh;font-family:'Plus Jakarta Sans',sans-serif;}
  .card{width:3.5in;background:#fff;border:2px solid hsl(220,100%,25%);border-radius:18px;padding:22px 20px;text-align:center;}
  .logo{font-family:Outfit,sans-serif;font-weight:900;font-size:21px;color:hsl(220,100%,25%);letter-spacing:-0.04em;margin-bottom:2px;}
  .tagline{font-size:10px;color:#666;text-transform:uppercase;letter-spacing:.12em;margin-bottom:14px;}
  .name{font-family:Outfit,sans-serif;font-weight:700;font-size:18px;color:hsl(220,100%,18%);margin-bottom:6px;}
  .msg{font-size:12px;color:#333;line-height:1.55;margin-bottom:14px;}
  .qr-wrap{display:flex;justify-content:center;margin-bottom:10px;}
  .url{font-size:9.5px;color:hsl(220,80%,40%);word-break:break-all;line-height:1.5;}
  .divider{border:none;border-top:1px solid hsl(220,20%,88%);margin:12px 0;}
  @media print{body{background:#fff;min-height:0;}@page{margin:.2in;size:3.75in 2.5in;}}
</style></head><body>
<div class="card">
  <div class="logo">Vickery Electric</div>
  <div class="tagline">Southeast Texas Electrical Specialists</div>
  <hr class="divider">
  <div class="name">${safeName}</div>
  <div class="msg">Know someone who needs electrical work? Scan or visit the link below &mdash; mention my name and we'll take great care of them!</div>
  <div class="qr-wrap" id="qr"></div>
  <div class="url">${safeUrl}</div>
</div>
<script src="https://cdnjs.cloudflare.com/ajax/libs/qrcodejs/1.0.0/qrcode.min.js"><\/script>
<script>
  setTimeout(function(){
    try{ new QRCode(document.getElementById('qr'),{text:"${safeUrl.replace(/"/g,'\\"')}",width:110,height:110,colorDark:"#0d2a6e",colorLight:"#ffffff"}); }catch(e){}
    setTimeout(function(){ window.print(); },700);
  },350);
<\/script></body></html>`);
    win.document.close();
  }

  // ── Public API ────────────────────────────────────────────────────────────
  return {
    loadOverview,
    loadReviews,
    loadFollowup,
    loadSegments,
    loadReferrals,
    loadTemplates,
    loadMktSettings,
  };
})();

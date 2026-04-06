/* crm-marketing.js — Marketing Hub front-end logic */
(function () {
  "use strict";

  // ── Helpers ──────────────────────────────────────────────────────────────
  function esc(s) {
    return String(s || "").replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;");
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
    if (days >= 14)  return `<span style="color:hsl(0 70% 60%)">${days}d ago</span>`;
    if (days >= 7)   return `<span style="color:hsl(38 80% 55%)">${days}d ago</span>`;
    if (days >= 2)   return `<span style="color:hsl(215 80% 65%)">${days}d ago</span>`;
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
      "max-width:320px;box-shadow:0 4px 20px #0007;",
      type === "error"
        ? "background:hsl(0 70% 40%);color:#fff;"
        : "background:hsl(145 60% 38%);color:#fff;",
    ].join("");
    document.body.appendChild(el);
    setTimeout(() => el.remove(), 3500);
  }

  // ── Tab switching ─────────────────────────────────────────────────────────
  const panels = {
    overview:  false,
    reviews:   false,
    followup:  false,
    segments:  false,
    templates: false,
  };

  document.querySelectorAll(".mhub-tab").forEach(btn => {
    btn.addEventListener("click", () => {
      document.querySelectorAll(".mhub-tab").forEach(b => b.classList.remove("active"));
      document.querySelectorAll(".mhub-panel").forEach(p => p.classList.remove("active"));
      btn.classList.add("active");
      const id = btn.dataset.panel;
      document.getElementById("panel-" + id).classList.add("active");
      if (!panels[id]) { panels[id] = true; loadPanel(id); }
    });
  });

  document.querySelectorAll(".rev-subtab").forEach(btn => {
    btn.addEventListener("click", () => {
      document.querySelectorAll(".rev-subtab").forEach(b => b.classList.remove("active"));
      document.querySelectorAll(".rev-subpanel").forEach(p => p.classList.remove("active"));
      btn.classList.add("active");
      document.getElementById("subpanel-" + btn.dataset.subpanel).classList.add("active");
    });
  });

  // ── Panel loader ──────────────────────────────────────────────────────────
  async function loadPanel(id) {
    if (id === "overview")  return loadOverview();
    if (id === "reviews")   return loadReviews();
    if (id === "followup")  return loadFollowup();
    if (id === "segments")  return loadSegments();
    if (id === "templates") return loadTemplates();
  }

  document.getElementById("refreshBtn").addEventListener("click", () => {
    // Re-load whichever panel is active
    const active = document.querySelector(".mhub-tab.active");
    if (active) {
      const id = active.dataset.panel;
      panels[id] = true;
      loadPanel(id);
    }
  });

  // ── OVERVIEW ──────────────────────────────────────────────────────────────
  async function loadOverview() {
    document.getElementById("overviewLoading").style.display = "block";
    document.getElementById("overviewContent").style.display = "none";
    try {
      const d = await window.Api.fetchJson("/api/marketing/overview");
      const o = d.overview || {};
      renderStatGrid(o);
      renderSourceTable(o.source_breakdown || []);
      document.getElementById("overviewLoading").style.display = "none";
      document.getElementById("overviewContent").style.display = "block";
    } catch (e) {
      document.getElementById("overviewLoading").textContent = "Error: " + e.message;
    }
  }

  function renderStatGrid(o) {
    const cards = [
      { label: "Total Leads",        value: o.leads_total || 0,             sub: "all time",              cls: "" },
      { label: "Booked Jobs",         value: o.booked_count || 0,            sub: "ever scheduled",        cls: "accent-blue" },
      { label: "Revenue",             value: fmt$(o.revenue_total || 0),     sub: "invoiced / paid",       cls: "accent-green" },
      { label: "Close Rate",          value: (o.close_rate_pct || 0) + "%",  sub: "leads → booked",        cls: "" },
      { label: "Review Eligible",     value: o.review_eligible || 0,         sub: "completed jobs",        cls: "" },
      { label: "Review Asks Sent",    value: o.review_asked || 0,            sub: "ever contacted",        cls: "accent-blue" },
      { label: "Reviews Received",    value: o.review_received || 0,         sub: "captured",              cls: "accent-green" },
      { label: "Ask Rate",            value: (o.review_request_rate_pct || 0) + "%", sub: "eligible → asked", cls: "" },
      { label: "Conversion Rate",     value: (o.review_conversion_rate_pct || 0) + "%", sub: "asked → received", cls: o.review_conversion_rate_pct >= 40 ? "accent-green" : "" },
      { label: "Repeat Customer Rate", value: (o.repeat_customer_rate_pct || 0) + "%", sub: "2+ jobs",         cls: "" },
      { label: "Stale Quotes",        value: o.stale_quote_count || 0,       sub: "need follow-up",        cls: o.stale_quote_count > 0 ? "accent-amber" : "" },
    ];
    document.getElementById("statGrid").innerHTML = cards.map(c => `
      <div class="stat-card ${esc(c.cls)}">
        <div class="stat-card-label">${esc(c.label)}</div>
        <div class="stat-card-value">${esc(String(c.value))}</div>
        <div class="stat-card-sub">${esc(c.sub)}</div>
      </div>
    `).join("");
  }

  function renderSourceTable(breakdown) {
    if (!breakdown.length) {
      document.getElementById("sourceTableBody").innerHTML = `<tr><td colspan="5" style="text-align:center;color:hsl(220 15% 50%);padding:20px;">No source data yet — start tagging leads with a source.</td></tr>`;
      return;
    }
    const maxLeads = Math.max(...breakdown.map(r => r.leads), 1);
    document.getElementById("sourceTableBody").innerHTML = breakdown.map(r => {
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
  let reviewData = null;

  async function loadReviews() {
    document.getElementById("reviewsLoading").style.display = "block";
    document.querySelectorAll(".rev-subpanel").forEach(p => { p.style.visibility = "hidden"; });
    try {
      const d = await window.Api.fetchJson("/api/reviews");
      reviewData = d;

      // Check config
      try {
        const cfg = await window.Api.fetchJson("/api/marketing/overview");
      } catch {}

      renderReviewQueue(d.queue || []);
      renderReviewPending(d.pending || []);
      renderReviewReceived(d.received || []);
      renderResponseDue(d.response_due || []);

      // Update badges
      setBadge("queueCount", (d.queue || []).length);
      setBadge("pendingCount", (d.pending || []).length);
      setBadge("receivedCount", (d.received || []).length);
      setBadge("responseDueCount", (d.response_due || []).length);

      document.getElementById("reviewsLoading").style.display = "none";
      document.querySelectorAll(".rev-subpanel").forEach(p => { p.style.visibility = ""; });
    } catch (e) {
      document.getElementById("reviewsLoading").textContent = "Error: " + e.message;
    }
  }

  function setBadge(id, count) {
    const el = document.getElementById(id);
    if (!el) return;
    if (count > 0) {
      el.textContent = count;
      el.style.cssText = "background:hsl(215 80% 50%);color:#fff;font-size:10px;font-weight:700;padding:1px 7px;border-radius:99px;";
    } else {
      el.textContent = "";
      el.style.cssText = "";
    }
  }

  function renderReviewQueue(queue) {
    const el = document.getElementById("queueList");
    if (!queue.length) { el.innerHTML = `<div class="empty-state">No eligible jobs in the queue — great work!</div>`; return; }
    el.innerHTML = queue.map(r => `
      <div class="rev-card queue-card" id="qcard-${esc(r.lead_id)}">
        <div class="rev-card-body">
          <div class="rev-card-name">${esc(r.name)}</div>
          <div class="rev-card-meta">
            ${esc(r.job_type)} &bull; ${r.has_phone ? esc(r.phone) : '<span style="color:hsl(0 70% 60%)">No phone</span>'}
            &bull; Completed ${daysBadge(r.days_since_complete)}
          </div>
        </div>
        ${r.has_phone ? `
          <button class="rev-btn rev-btn-ask" onclick="sendReviewAsk(${JSON.stringify(r)})">Send Review Ask</button>
        ` : `
          <span style="font-size:12px;color:hsl(0 70% 60%);">No phone #</span>
        `}
      </div>
    `).join("");
  }

  function renderReviewPending(pending) {
    const el = document.getElementById("pendingList");
    if (!pending.length) { el.innerHTML = `<div class="empty-state">No pending review asks.</div>`; return; }
    el.innerHTML = pending.map(r => {
      const isAsked = r.review_status === "asked";
      const daysSince = r.days_since_ask || r.days_since_reminder || 0;
      const reminderEligible = isAsked && r.reminder_eligible;
      return `
        <div class="rev-card pending-card" id="pcard-${esc(r.lead_id)}">
          <div class="rev-card-body">
            <div class="rev-card-name">${esc(r.name)}</div>
            <div class="rev-card-meta">
              ${esc(r.job_type)} &bull; ${esc(r.phone || "No phone")}
              &bull; Ask sent ${daysBadge(daysSince)}
              &bull; Status: <strong>${esc(r.review_status)}</strong>
            </div>
          </div>
          <div style="display:flex;flex-direction:column;gap:6px;align-items:flex-end;">
            ${reminderEligible ? `<button class="rev-btn rev-btn-remind" onclick="sendReminder(${JSON.stringify(r)})">Send Reminder</button>` : ""}
            <button class="rev-btn rev-btn-log" style="font-size:11px;padding:5px 10px;" onclick="showLogReceived('${esc(r.lead_id)}')">Log Review</button>
          </div>
        </div>
        <div id="logform-${esc(r.lead_id)}" style="display:none;padding:10px;background:hsl(220 20% 14%);border-radius:8px;margin-top:-6px;margin-bottom:10px;">
          <div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center;">
            <select id="stars-${esc(r.lead_id)}" style="width:80px;padding:5px 8px;border-radius:6px;background:hsl(220 20% 18%);color:hsl(220 20% 90%);border:1px solid hsl(220 20% 25%);">
              <option value="">Stars</option>
              <option value="5">★★★★★ 5</option>
              <option value="4">★★★★☆ 4</option>
              <option value="3">★★★☆☆ 3</option>
              <option value="2">★★☆☆☆ 2</option>
              <option value="1">★☆☆☆☆ 1</option>
            </select>
            <input id="revtext-${esc(r.lead_id)}" placeholder="Paste review text (optional)" style="flex:1;min-width:180px;padding:6px 10px;border-radius:6px;background:hsl(220 20% 18%);color:hsl(220 20% 90%);border:1px solid hsl(220 20% 25%);" />
            <button class="rev-btn rev-btn-log" onclick="logReceived('${esc(r.lead_id)}')">Save</button>
          </div>
        </div>
      `;
    }).join("");
  }

  function renderReviewReceived(received) {
    const el = document.getElementById("receivedList");
    if (!received.length) { el.innerHTML = `<div class="empty-state">No reviews logged yet.</div>`; return; }
    el.innerHTML = received.map(r => `
      <div class="rev-card received-card">
        <div class="rev-card-body">
          <div class="rev-card-name">${esc(r.name)} <span class="rev-card-stars">${stars(r.review ? r.review.star_rating : "")}</span></div>
          <div class="rev-card-meta">${esc(r.job_type)} &bull; ${fmtDate(r.review ? r.review.review_received_at : "")}</div>
          ${r.review_text ? `<div class="rev-card-review">"${esc(r.review_text)}"</div>` : ""}
        </div>
        <button class="copy-btn" onclick="copyText(${JSON.stringify(r.review_text || r.name + " left a 5-star review!")})">Copy</button>
      </div>
    `).join("");
  }

  function renderResponseDue(due) {
    const el = document.getElementById("responseDueList");
    if (!due.length) { el.innerHTML = `<div class="empty-state">No reviews waiting for a response.</div>`; return; }
    el.innerHTML = due.map(r => `
      <div class="rev-card response-card">
        <div class="rev-card-body">
          <div class="rev-card-name">${esc(r.name)} <span class="rev-card-stars">${stars(r.star_rating)}</span></div>
          <div class="rev-card-meta">${esc(r.job_type)} &bull; Received ${fmtDate(r.review ? r.review.review_received_at : "")}</div>
          ${r.review_text ? `<div class="rev-card-review">"${esc(r.review_text)}"</div>` : ""}
        </div>
        <button class="rev-btn rev-btn-respond" onclick="markResponded('${esc(r.lead_id)}', this)">Mark Responded</button>
      </div>
    `).join("");
  }

  window.sendReviewAsk = async function (r) {
    const btn = document.querySelector(`#qcard-${r.lead_id} .rev-btn-ask`);
    if (btn) { btn.disabled = true; btn.textContent = "Sending…"; }
    try {
      const d = await window.Api.fetchJson("/api/reviews/ask", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ lead_id: r.lead_id, name: r.name, phone: r.phone, job_type: r.job_type }),
      });
      if (d.ok) {
        toast(d.sms_sent ? "Review ask sent via SMS!" : "Review logged (SMS not configured).", "success");
        panels.reviews = false;
        setTimeout(() => { panels.reviews = true; loadReviews(); }, 500);
      } else {
        toast("Error: " + (d.error || "unknown"), "error");
        if (btn) { btn.disabled = false; btn.textContent = "Send Review Ask"; }
      }
    } catch (e) {
      toast("Error: " + e.message, "error");
      if (btn) { btn.disabled = false; btn.textContent = "Send Review Ask"; }
    }
  };

  window.sendReminder = async function (r) {
    const btn = document.querySelector(`#pcard-${r.lead_id} .rev-btn-remind`);
    if (btn) { btn.disabled = true; btn.textContent = "Sending…"; }
    try {
      const d = await window.Api.fetchJson("/api/reviews/remind", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ lead_id: r.lead_id, name: r.name, phone: r.phone, job_type: r.job_type }),
      });
      if (d.ok) {
        toast(d.sms_sent ? "Reminder sent via SMS!" : "Reminder logged (SMS not configured).", "success");
        panels.reviews = false;
        setTimeout(() => { panels.reviews = true; loadReviews(); }, 500);
      } else {
        toast("Error: " + (d.error || "unknown"), "error");
        if (btn) { btn.disabled = false; btn.textContent = "Send Reminder"; }
      }
    } catch (e) {
      toast("Error: " + e.message, "error");
      if (btn) { btn.disabled = false; btn.textContent = "Send Reminder"; }
    }
  };

  window.showLogReceived = function (leadId) {
    const el = document.getElementById("logform-" + leadId);
    if (el) el.style.display = el.style.display === "none" ? "block" : "none";
  };

  window.logReceived = async function (leadId) {
    const stars = document.getElementById("stars-" + leadId).value;
    const text = document.getElementById("revtext-" + leadId).value;
    try {
      await window.Api.fetchJson("/api/reviews/" + encodeURIComponent(leadId), {
        method: "PATCH", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          lead_id: leadId,
          star_rating: stars,
          review_text: text,
          review_received_at: new Date().toISOString(),
        }),
      });
      toast("Review logged!", "success");
      panels.reviews = false;
      setTimeout(() => { panels.reviews = true; loadReviews(); }, 500);
    } catch (e) { toast("Error: " + e.message, "error"); }
  };

  window.markResponded = async function (leadId, btn) {
    if (btn) { btn.disabled = true; btn.textContent = "Saving…"; }
    try {
      await window.Api.fetchJson("/api/reviews/" + encodeURIComponent(leadId), {
        method: "PATCH", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ lead_id: leadId, response_status: "responded" }),
      });
      toast("Marked as responded!", "success");
      panels.reviews = false;
      setTimeout(() => { panels.reviews = true; loadReviews(); }, 500);
    } catch (e) { toast("Error: " + e.message, "error"); }
  };

  window.copyText = function (text) {
    navigator.clipboard.writeText(text).then(() => toast("Copied!", "success")).catch(() => toast("Copy failed", "error"));
  };

  // ── FOLLOW-UP ─────────────────────────────────────────────────────────────
  async function loadFollowup() {
    document.getElementById("followupLoading").style.display = "block";
    document.getElementById("followupContent").style.display = "none";
    try {
      const d = await window.Api.fetchJson("/api/marketing/followup");
      renderFollowup(d.buckets || {});
      document.getElementById("followupLoading").style.display = "none";
      document.getElementById("followupContent").style.display = "block";
    } catch (e) {
      document.getElementById("followupLoading").textContent = "Error: " + e.message;
    }
  }

  function renderFollowup(buckets) {
    const el = document.getElementById("followupContent");
    const defs = [
      { key: "24h",  label: "1–2 Days Old",   cls: "bucket-24h",  desc: "Recent — friendly first nudge" },
      { key: "72h",  label: "3–6 Days Old",   cls: "bucket-72h",  desc: "Getting warm — follow up soon" },
      { key: "7d",   label: "7–13 Days Old",  cls: "bucket-7d",   desc: "Stale — don't lose them" },
      { key: "14d+", label: "14+ Days Old",   cls: "bucket-14d",  desc: "Cold — last chance" },
    ];
    el.innerHTML = defs.map(def => {
      const rows = buckets[def.key] || [];
      return `
        <div class="bucket-section">
          <div class="bucket-header ${def.cls}" onclick="toggleBucket(this)">
            <div class="bucket-label">${esc(def.label)}</div>
            <span class="bucket-count">${rows.length}</span>
            <span style="font-size:11px;color:hsl(220 15% 55%);flex:1;">${esc(def.desc)}</span>
            <span style="font-size:12px;color:hsl(220 15% 50%);">▾</span>
          </div>
          <div class="bucket-rows ${rows.length > 0 ? "open" : ""}">
            ${rows.length === 0 ? `<div class="empty-state" style="padding:16px;">None in this bucket.</div>` : ""}
            ${rows.map(r => `
              <div class="bucket-row">
                <div class="bucket-row-name">${esc(r.name)}</div>
                <div class="bucket-row-meta">${esc(r.job_type || "—")} &bull; ${daysBadge(r.days_stale)} &bull; ${r.estimated_value > 0 ? fmt$(r.estimated_value) : "—"}</div>
                <button class="bucket-send-btn" onclick='sendFollowup(${JSON.stringify({ lead_id: r.lead_id, name: r.name, phone: r.phone, job_type: r.job_type })}, this)'>Send Text</button>
              </div>
            `).join("")}
          </div>
        </div>
      `;
    }).join("");
  }

  window.toggleBucket = function (header) {
    const rows = header.nextElementSibling;
    rows.classList.toggle("open");
    const arrow = header.querySelector("span:last-child");
    if (arrow) arrow.textContent = rows.classList.contains("open") ? "▾" : "▸";
  };

  window.sendFollowup = async function (r, btn) {
    if (btn) { btn.disabled = true; btn.textContent = "Sending…"; }
    try {
      const d = await window.Api.fetchJson("/api/marketing/followup/send", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify(r),
      });
      if (d.ok) {
        toast(d.sms_sent ? "Follow-up sent!" : "Follow-up logged (SMS not configured).", "success");
        if (btn) { btn.textContent = "Sent ✓"; btn.style.background = "hsl(145 60% 38%)"; }
      } else {
        toast("Error: " + (d.error || "unknown"), "error");
        if (btn) { btn.disabled = false; btn.textContent = "Send Text"; }
      }
    } catch (e) {
      toast("Error: " + e.message, "error");
      if (btn) { btn.disabled = false; btn.textContent = "Send Text"; }
    }
  };

  // ── SEGMENTS ──────────────────────────────────────────────────────────────
  async function loadSegments() {
    document.getElementById("segmentsLoading").style.display = "block";
    document.getElementById("segmentsContent").style.display = "none";
    try {
      const d = await window.Api.fetchJson("/api/marketing/segments");
      renderSegments(d.segments || {}, d.counts || {});
      document.getElementById("segmentsLoading").style.display = "none";
      document.getElementById("segmentsContent").style.display = "block";
    } catch (e) {
      document.getElementById("segmentsLoading").textContent = "Error: " + e.message;
    }
  }

  const SEG_DEFS = [
    { key: "needs_review_ask",   icon: "⭐", title: "Needs Review Ask",       desc: "Completed jobs not yet contacted for a review" },
    { key: "stale_quote",        icon: "⏳", title: "Stale Quotes",            desc: "Open quotes with no activity in 48+ hours" },
    { key: "reactivation_ready", icon: "🔄", title: "Reactivation Ready",      desc: "Customers with no job in 6+ months" },
    { key: "repeat_customers",   icon: "🏆", title: "Repeat Customers",         desc: "Clients with 2 or more completed jobs" },
    { key: "high_value",         icon: "💰", title: "High Value Leads",         desc: "Estimated or invoiced value at or above your threshold" },
    { key: "no_sms_opt_in",      icon: "📵", title: "No SMS Opt-in",            desc: "Completed jobs where we can't text the customer" },
  ];

  function renderSegments(segments, counts) {
    const el = document.getElementById("segmentsContent");
    el.innerHTML = SEG_DEFS.map(def => {
      const rows = segments[def.key] || [];
      return `
        <div class="seg-section">
          <div class="seg-header" onclick="toggleSeg(this)">
            <span class="seg-icon">${def.icon}</span>
            <span class="seg-title">${esc(def.title)}</span>
            <span class="seg-desc">${esc(def.desc)}</span>
            <span class="seg-count">${rows.length}</span>
            <span style="font-size:12px;color:hsl(220 15% 50%);margin-left:4px;">▾</span>
          </div>
          <div class="seg-rows ${rows.length > 0 ? "open" : ""}">
            ${rows.length === 0 ? `<div class="empty-state" style="padding:14px 16px;">No customers in this segment.</div>` : ""}
            ${rows.slice(0, 50).map(r => {
              let meta = "";
              if (def.key === "needs_review_ask") meta = daysBadge(r.days_since_complete) + " completed";
              else if (def.key === "stale_quote")        meta = daysBadge(r.days_stale) + " stale";
              else if (def.key === "reactivation_ready") meta = daysBadge(r.days_inactive) + " inactive";
              else if (def.key === "repeat_customers")   meta = r.job_count + " jobs";
              else if (def.key === "high_value")         meta = fmt$(r.value);
              else if (def.key === "no_sms_opt_in")      meta = "No opt-in";
              return `
                <div class="seg-row">
                  <span class="seg-row-name">${esc(r.name)}</span>
                  <span class="seg-row-meta">${esc(r.phone || "No phone")} &bull; ${meta}</span>
                </div>
              `;
            }).join("")}
            ${rows.length > 50 ? `<div class="seg-row" style="justify-content:center;color:hsl(220 15% 50%);font-size:12px;">+ ${rows.length - 50} more</div>` : ""}
          </div>
        </div>
      `;
    }).join("");
  }

  window.toggleSeg = function (header) {
    const rows = header.nextElementSibling;
    rows.classList.toggle("open");
    const arrow = header.querySelector("span:last-child");
    if (arrow) arrow.textContent = rows.classList.contains("open") ? "▾" : "▸";
  };

  // ── TEMPLATES ─────────────────────────────────────────────────────────────
  async function loadTemplates() {
    document.getElementById("templatesLoading").style.display = "block";
    document.getElementById("templateGrid").style.display = "none";
    try {
      const d = await window.Api.fetchJson("/api/templates");
      renderTemplates(d.templates || []);
      document.getElementById("templatesLoading").style.display = "none";
      document.getElementById("templateGrid").style.display = "grid";
    } catch (e) {
      document.getElementById("templatesLoading").textContent = "Error: " + e.message;
    }
  }

  const CATEGORY_LABELS = {
    review_ask: "Review Ask",
    review_reminder: "Review Reminder",
    quote_followup: "Quote Follow-Up",
    job_complete_thankyou: "Job Thank-You",
    reactivation: "Reactivation",
    referral_ask: "Referral Ask",
  };

  const VARS_BY_CATEGORY = {
    review_ask: "{first_name}, {service}, {review_link}",
    review_reminder: "{first_name}, {review_link}",
    quote_followup: "{first_name}, {service}",
    job_complete_thankyou: "{first_name}",
    reactivation: "{first_name}",
    referral_ask: "{first_name}",
  };

  function renderTemplates(templates) {
    const grid = document.getElementById("templateGrid");
    if (!templates.length) {
      grid.innerHTML = `<div class="empty-state">No templates found.</div>`;
      return;
    }
    grid.innerHTML = templates.map(t => {
      const isActive = t.active === "true";
      const catLabel = CATEGORY_LABELS[t.category] || t.category;
      const vars = VARS_BY_CATEGORY[t.category] || "";
      return `
        <div class="tmpl-card" id="tmpl-${esc(t.id)}">
          <div class="tmpl-card-header">
            <span class="tmpl-card-name">${esc(t.name)}</span>
            <span class="tmpl-chip chip-sms">SMS</span>
            <span class="tmpl-chip chip-${esc(t.category)}">${esc(catLabel)}</span>
          </div>
          <div class="tmpl-body">${esc(t.body)}</div>
          <div class="tmpl-vars">Variables: ${esc(vars || "none")}</div>
          <div style="display:flex;align-items:center;gap:12px;margin-top:10px;">
            <label class="tmpl-active-toggle" title="${isActive ? "Deactivate" : "Activate"}">
              <button class="pill-toggle ${isActive ? "on" : "off"}" onclick="toggleActive('${esc(t.id)}', ${isActive}, this)" type="button" title="${isActive ? "Active — click to deactivate" : "Inactive — click to activate"}"></button>
              <span>${isActive ? "Active" : "Inactive"}</span>
            </label>
            <button class="copy-btn" onclick="copyText(${JSON.stringify(t.body)})">Copy</button>
            <button class="copy-btn" onclick="toggleEdit('${esc(t.id)}', this)" type="button">Edit</button>
          </div>
          <div class="tmpl-edit-wrap" id="edit-${esc(t.id)}">
            <textarea class="tmpl-edit-textarea" id="editBody-${esc(t.id)}">${esc(t.body)}</textarea>
            <div class="tmpl-edit-actions">
              <button class="btn-save" onclick="saveTemplate('${esc(t.id)}')">Save</button>
              <button class="btn-cancel" onclick="toggleEdit('${esc(t.id)}')">Cancel</button>
            </div>
          </div>
        </div>
      `;
    }).join("");
  }

  window.toggleActive = async function (id, currentlyActive, btn) {
    const newVal = !currentlyActive;
    try {
      await window.Api.fetchJson("/api/templates/" + encodeURIComponent(id), {
        method: "PATCH", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ active: String(newVal) }),
      });
      btn.classList.toggle("on", newVal);
      btn.classList.toggle("off", !newVal);
      btn.nextElementSibling.textContent = newVal ? "Active" : "Inactive";
      toast(newVal ? "Template activated." : "Template deactivated.", "success");
    } catch (e) { toast("Error: " + e.message, "error"); }
  };

  window.toggleEdit = function (id, btn) {
    const wrap = document.getElementById("edit-" + id);
    if (!wrap) return;
    const isOpen = wrap.classList.contains("open");
    wrap.classList.toggle("open", !isOpen);
    if (btn) btn.textContent = isOpen ? "Edit" : "Close";
  };

  window.saveTemplate = async function (id) {
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
      // Update the display
      const card = document.getElementById("tmpl-" + id);
      if (card) {
        const bodyDisplay = card.querySelector(".tmpl-body");
        if (bodyDisplay) bodyDisplay.textContent = newBody;
      }
      const wrap = document.getElementById("edit-" + id);
      if (wrap) wrap.classList.remove("open");
    } catch (e) { toast("Error: " + e.message, "error"); }
  };

  // New template form
  document.getElementById("newTmplBtn").addEventListener("click", () => {
    document.getElementById("newTmplForm").classList.toggle("open");
  });
  document.getElementById("ntCancelBtn").addEventListener("click", () => {
    document.getElementById("newTmplForm").classList.remove("open");
    document.getElementById("ntResult").textContent = "";
  });
  document.getElementById("ntSaveBtn").addEventListener("click", async () => {
    const name = document.getElementById("ntName").value.trim();
    const category = document.getElementById("ntCategory").value;
    const body = document.getElementById("ntBody").value.trim();
    const resultEl = document.getElementById("ntResult");
    if (!name || !body) { resultEl.textContent = "Name and body are required."; resultEl.style.color = "hsl(0 70% 60%)"; return; }
    resultEl.textContent = "Saving…";
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
        panels.templates = false;
        loadTemplates();
      } else {
        resultEl.textContent = d.error || "Error saving.";
        resultEl.style.color = "hsl(0 70% 60%)";
      }
    } catch (e) { resultEl.textContent = e.message; resultEl.style.color = "hsl(0 70% 60%)"; }
  });

  // ── Init ─────────────────────────────────────────────────────────────────
  panels.overview = true;
  loadOverview();
})();

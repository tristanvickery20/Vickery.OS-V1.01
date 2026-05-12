/* crm-campaigns.js — Campaign Management UI
 * Exposes window.Campaigns = { initList, initDetail, initLandingPages }
 */
window.Campaigns = (function () {
  "use strict";

  const OWNER_DECISIONS = [
    "Increase Budget", "Hold", "Reduce Budget", "Pause",
    "Fix Landing Page", "Fix Targeting", "Fix Call Handling", "Kill Campaign",
  ];

  const DECISION_COLORS = {
    "Increase Budget":  "hsl(145 60% 38%)",
    "Hold":             "hsl(215 60% 45%)",
    "Reduce Budget":    "hsl(38 80% 45%)",
    "Pause":            "hsl(38 80% 40%)",
    "Fix Landing Page": "hsl(270 50% 45%)",
    "Fix Targeting":    "hsl(270 50% 45%)",
    "Fix Call Handling":"hsl(270 50% 45%)",
    "Kill Campaign":    "hsl(0 70% 40%)",
  };

  function esc(s) {
    return String(s || "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }
  function fmt$(n) {
    const v = Number(n || 0);
    if (!v) return "—";
    if (v >= 1000) return "$" + (v / 1000).toFixed(1) + "k";
    return "$" + v.toLocaleString("en-US", { minimumFractionDigits: 0, maximumFractionDigits: 0 });
  }
  function fmtDate(iso) {
    if (!iso) return "—";
    const d = new Date(iso);
    if (isNaN(d)) return iso.slice(0, 10);
    return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
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
  function statusBadge(s) {
    const colors = {
      active:    "hsl(145 60% 25%)",
      paused:    "hsl(38 80% 25%)",
      completed: "hsl(215 60% 25%)",
      draft:     "hsl(220 15% 22%)",
    };
    const textCol = {
      active:    "hsl(145 60% 70%)",
      paused:    "hsl(38 80% 70%)",
      completed: "hsl(215 60% 75%)",
      draft:     "hsl(220 15% 65%)",
    };
    const key = String(s || "").toLowerCase();
    const bg  = colors[key] || "hsl(220 15% 22%)";
    const tc  = textCol[key] || "hsl(220 15% 65%)";
    return `<span style="background:${bg};color:${tc};font-size:11px;font-weight:700;padding:2px 9px;border-radius:99px;">${esc(s || "—")}</span>`;
  }
  function decisionBadge(d) {
    if (!d) return "—";
    const col = DECISION_COLORS[d] || "hsl(220 15% 35%)";
    return `<span style="background:${col};color:#fff;font-size:11px;font-weight:700;padding:2px 9px;border-radius:99px;">${esc(d)}</span>`;
  }
  function roasBadge(roas) {
    if (roas === null || roas === undefined) return "—";
    const v = Number(roas);
    const col = v >= 3 ? "hsl(145 60% 55%)" : v >= 1 ? "hsl(38 80% 55%)" : "hsl(0 70% 55%)";
    return `<span style="color:${col};font-weight:700;">${v.toFixed(2)}×</span>`;
  }

  // ── Campaigns List ─────────────────────────────────────────────────────────
  let _allCampaigns = [];
  let _sortKey = "name";
  let _sortAsc = true;

  function initList() {
    loadCampaigns();

    const newBtn    = document.getElementById("newCampaignBtn");
    const form      = document.getElementById("newCampaignForm");
    const cancelBtn = document.getElementById("nc_cancelBtn");
    const saveBtn   = document.getElementById("nc_saveBtn");

    if (newBtn) newBtn.addEventListener("click", () => {
      form.style.display = form.style.display === "none" ? "block" : "none";
    });
    if (cancelBtn) cancelBtn.addEventListener("click", () => { form.style.display = "none"; });
    if (saveBtn)   saveBtn.addEventListener("click",  createCampaign);

    const thead = document.querySelector("#campaignsTable thead");
    if (thead) {
      thead.querySelectorAll("th[data-sort]").forEach(th => {
        th.addEventListener("click", () => {
          const key = th.dataset.sort;
          if (_sortKey === key) { _sortAsc = !_sortAsc; }
          else { _sortKey = key; _sortAsc = true; }
          renderCampaignTable(_allCampaigns);
        });
      });
    }
  }

  function getSortValue(c, key) {
    const m = c.metrics || {};
    const metricKeys = ["leads","booked","completed","revenue","gross_profit","gross_margin_pct","roas","cpl","cpbj"];
    if (metricKeys.includes(key)) return Number(m[key] ?? -Infinity);
    if (key === "budget" || key === "spend") return Number(c[key] || 0);
    return String(c[key] || "").toLowerCase();
  }

  function updateSortArrows(key, asc) {
    document.querySelectorAll("#campaignsTable thead th[data-sort]").forEach(th => {
      const arrow = th.querySelector(".sort-arrow");
      if (!arrow) return;
      if (th.dataset.sort === key) {
        arrow.textContent = asc ? " ▲" : " ▼";
        th.style.color = "hsl(215 80% 70%)";
      } else {
        arrow.textContent = "";
        th.style.color = "";
      }
    });
  }

  async function loadCampaigns() {
    const loadingEl = document.getElementById("campaignsLoading");
    const contentEl = document.getElementById("campaignsContent");
    if (loadingEl) { loadingEl.style.display = "block"; loadingEl.textContent = "Loading campaigns…"; }
    if (contentEl) contentEl.style.display = "none";
    try {
      const d = await window.Api.fetchJson("/api/marketing/campaigns");
      _allCampaigns = d.campaigns || [];
      renderCampaignTable(_allCampaigns);
      if (loadingEl) loadingEl.style.display = "none";
      if (contentEl) contentEl.style.display = "block";
    } catch (e) {
      if (loadingEl) loadingEl.textContent = "Error: " + e.message;
    }
  }

  function renderCampaignTable(campaigns) {
    const tbody   = document.getElementById("campaignsTbody");
    const emptyEl = document.getElementById("campaignsEmpty");
    if (!tbody) return;

    const sorted = [...campaigns].sort((a, b) => {
      const va = getSortValue(a, _sortKey);
      const vb = getSortValue(b, _sortKey);
      if (va < vb) return _sortAsc ? -1 : 1;
      if (va > vb) return _sortAsc ? 1 : -1;
      return 0;
    });
    updateSortArrows(_sortKey, _sortAsc);

    if (!sorted.length) {
      tbody.innerHTML = "";
      if (emptyEl) emptyEl.style.display = "block";
      return;
    }
    if (emptyEl) emptyEl.style.display = "none";

    tbody.innerHTML = sorted.map(c => {
      const m = c.metrics || {};
      const gpColor = m.gross_profit > 0 ? "hsl(145 60% 55%)" : m.gross_profit < 0 ? "hsl(0 70% 55%)" : "";
      const mgColor = m.gross_margin_pct != null
        ? (m.gross_margin_pct >= 40 ? "hsl(145 60% 55%)" : m.gross_margin_pct >= 20 ? "hsl(38 80% 55%)" : "hsl(0 70% 55%)")
        : "";
      return `<tr style="cursor:pointer;" onclick="location.href='/crm/marketing/campaigns/${esc(c.campaign_id)}'">
        <td><strong>${esc(c.name || "—")}</strong><br><span style="font-size:11px;color:hsl(220 15% 55%);">${esc(c.utm_campaign || "")}</span></td>
        <td>${esc(c.channel || "—")}</td>
        <td>${statusBadge(c.status)}</td>
        <td style="text-align:right;">${c.budget ? fmt$(c.budget) : "—"}</td>
        <td style="text-align:right;">${c.spend  ? fmt$(c.spend)  : "—"}</td>
        <td style="text-align:right;">${m.leads  || 0}</td>
        <td style="text-align:right;">${m.booked || 0}</td>
        <td style="text-align:right;">${fmt$(m.revenue)}</td>
        <td style="text-align:right;${gpColor ? "color:"+gpColor+";" : ""}">${fmt$(m.gross_profit)}</td>
        <td style="text-align:right;${mgColor ? "color:"+mgColor+";" : ""}font-weight:600;">${m.gross_margin_pct != null ? m.gross_margin_pct + "%" : "—"}</td>
        <td style="text-align:right;">${roasBadge(m.roas)}</td>
        <td style="text-align:right;">${m.cpl  != null ? fmt$(m.cpl)  : "—"}</td>
        <td style="text-align:right;">${m.cpbj != null ? fmt$(m.cpbj) : "—"}</td>
        <td>${decisionBadge(c.owner_decision)}</td>
      </tr>`;
    }).join("");
  }

  async function createCampaign() {
    const errEl = document.getElementById("nc_error");
    const saveBtn = document.getElementById("nc_saveBtn");
    const name = (document.getElementById("nc_name") || {}).value?.trim();
    if (!name) {
      if (errEl) { errEl.textContent = "Campaign name is required."; errEl.style.display = "block"; }
      return;
    }
    if (errEl) errEl.style.display = "none";
    if (saveBtn) { saveBtn.disabled = true; saveBtn.textContent = "Saving…"; }

    const g = id => (document.getElementById(id) || {}).value?.trim() || "";
    const payload = {
      name,
      channel:            g("nc_channel"),
      source:             g("nc_source"),
      service_promoted:   g("nc_service_promoted"),
      city_zone_targeted: g("nc_city_zone_targeted"),
      utm_campaign:       g("nc_utm_campaign"),
      start_date:         g("nc_start_date"),
      end_date:           g("nc_end_date"),
      budget:             g("nc_budget"),
      spend:              g("nc_spend"),
      landing_page:       g("nc_landing_page"),
      tracking_phone:     g("nc_tracking_phone"),
      offer_message:      g("nc_offer_message"),
    };

    try {
      const d = await window.Api.fetchJson("/api/marketing/campaigns", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (d.ok) {
        toast("Campaign created!", "success");
        location.href = "/crm/marketing/campaigns/" + encodeURIComponent(d.campaign_id);
      } else {
        if (errEl) { errEl.textContent = d.error || "Error saving campaign."; errEl.style.display = "block"; }
        if (saveBtn) { saveBtn.disabled = false; saveBtn.textContent = "Save Campaign"; }
      }
    } catch (e) {
      if (errEl) { errEl.textContent = e.message; errEl.style.display = "block"; }
      if (saveBtn) { saveBtn.disabled = false; saveBtn.textContent = "Save Campaign"; }
    }
  }

  // ── Campaign Detail ────────────────────────────────────────────────────────
  function initDetail() {
    const id = getCampaignIdFromUrl();
    if (!id) { window.location.href = "/crm/marketing/campaigns"; return; }
    loadDetail(id);

    const saveBtn = document.getElementById("saveFieldsBtn");
    if (saveBtn) saveBtn.addEventListener("click", () => saveDetail(id));
  }

  function getCampaignIdFromUrl() {
    const parts = window.location.pathname.split("/");
    return parts[parts.length - 1] || "";
  }

  async function loadDetail(id) {
    const loadingEl = document.getElementById("detailLoading");
    const contentEl = document.getElementById("detailContent");
    if (loadingEl) { loadingEl.style.display = "block"; loadingEl.textContent = "Loading campaign…"; }
    if (contentEl) contentEl.style.display = "none";

    try {
      const d = await window.Api.fetchJson(`/api/marketing/campaigns/${encodeURIComponent(id)}`);
      const c = d.campaign || {};
      const m = d.metrics  || {};
      const leads = d.leads || [];

      const titleEl = document.getElementById("detailPageTitle");
      if (titleEl) titleEl.textContent = c.name || "Campaign";
      document.title = (c.name || "Campaign") + " • Vickery CRM";

      const set = (elId, val) => { const el = document.getElementById(elId); if (el) el.value = val || ""; };
      set("d_name",              c.name);
      set("d_channel",           c.channel);
      set("d_source",            c.source);
      set("d_service_promoted",  c.service_promoted);
      set("d_city_zone_targeted",c.city_zone_targeted);
      set("d_utm_campaign",      c.utm_campaign);
      set("d_start_date",        c.start_date);
      set("d_end_date",          c.end_date);
      set("d_budget",            c.budget);
      set("d_spend",             c.spend);
      set("d_landing_page",      c.landing_page);
      set("d_tracking_phone",    c.tracking_phone);
      set("d_contractor_vendor", c.contractor_vendor);
      set("d_status",            c.status);
      set("d_offer_message",     c.offer_message);
      set("d_notes",             c.notes);
      set("d_owner_decision",    c.owner_decision);

      renderOwnerDecisionButtons(c.owner_decision || "");
      renderMetrics(m, c);
      renderLeadsTable(leads);

      if (loadingEl) loadingEl.style.display = "none";
      if (contentEl) contentEl.style.display = "block";
    } catch (e) {
      if (loadingEl) loadingEl.textContent = "Error: " + e.message;
    }
  }

  function renderOwnerDecisionButtons(current) {
    const container = document.getElementById("ownerDecisionButtons");
    if (!container) return;
    container.innerHTML = OWNER_DECISIONS.map(d => {
      const isActive = d === current;
      const col = DECISION_COLORS[d] || "hsl(220 20% 30%)";
      return `<button type="button" data-decision="${esc(d)}"
        style="padding:7px 14px;border-radius:8px;border:2px solid ${isActive ? col : "hsl(var(--border,220 20% 22%))"};
          background:${isActive ? col : "transparent"};
          color:${isActive ? "#fff" : "hsl(var(--text-2,220 15% 60%))"};
          cursor:pointer;font-size:12px;font-weight:700;transition:all .15s;"
        >${esc(d)}</button>`;
    }).join("");

    container.querySelectorAll("button[data-decision]").forEach(btn => {
      btn.addEventListener("click", () => {
        const val = btn.dataset.decision;
        const hidden = document.getElementById("d_owner_decision");
        if (hidden) hidden.value = val;
        renderOwnerDecisionButtons(val);
      });
    });
  }

  function renderMetrics(m, c) {
    const grid = document.getElementById("metricsGrid");
    if (!grid) return;

    const cards = [
      { label: "Leads",         value: String(m.leads || 0),     cls: "" },
      { label: "Booked",        value: String(m.booked || 0),    cls: "accent-blue" },
      { label: "Completed",     value: String(m.completed || 0), cls: "" },
      { label: "Revenue",       value: fmt$(m.revenue || 0),     cls: "accent-green" },
      { label: "Gross Profit",  value: fmt$(m.gross_profit || 0), cls: m.gross_profit > 0 ? "accent-green" : "" },
      { label: "Gross Margin",  value: m.gross_margin_pct != null ? m.gross_margin_pct + "%" : "—", cls: "" },
      { label: "ROAS",          value: m.roas != null ? m.roas.toFixed(2) + "×" : "—",
        cls: m.roas != null ? (m.roas >= 3 ? "accent-green" : m.roas >= 1 ? "accent-amber" : "accent-red") : "" },
      { label: "CPL",           value: m.cpl != null ? fmt$(m.cpl) : "—", cls: "" },
      { label: "CPBJ",          value: m.cpbj != null ? fmt$(m.cpbj) : "—", cls: "" },
    ];

    const budget = Number(c.budget || 0);
    const spend  = Number(c.spend || 0);
    if (budget > 0 && spend > 0) {
      const pct = Math.round((spend / budget) * 100);
      cards.push({ label: "Budget Used", value: pct + "%", cls: pct > 90 ? "accent-red" : pct > 70 ? "accent-amber" : "" });
    }

    grid.innerHTML = cards.map(card => `
      <div class="stat-card ${esc(card.cls)}" style="padding:12px;">
        <div class="stat-card-label">${esc(card.label)}</div>
        <div class="stat-card-value" style="font-size:20px;">${esc(card.value)}</div>
      </div>`).join("");
  }

  function renderLeadsTable(leads) {
    const tbody  = document.getElementById("campaignLeadsTbody");
    const emptyEl = document.getElementById("leadsEmpty");
    if (!tbody) return;

    if (!leads.length) {
      tbody.innerHTML = "";
      if (emptyEl) emptyEl.style.display = "block";
      return;
    }
    if (emptyEl) emptyEl.style.display = "none";

    tbody.innerHTML = leads.map(l => `
      <tr style="cursor:pointer;" onclick="location.href='/crm/lead?id=${esc(l.id)}'">
        <td><a href="/crm/lead?id=${esc(l.id)}" onclick="event.stopPropagation();">${esc(l.name || "—")}</a></td>
        <td>${esc(l.phone || "—")}</td>
        <td>${statusBadge(l.status)}</td>
        <td style="text-align:right;">${l.revenue ? fmt$(l.revenue) : "—"}</td>
        <td>${fmtDate(l.created_at)}</td>
      </tr>`).join("");
  }

  async function saveDetail(id) {
    const saveBtn  = document.getElementById("saveFieldsBtn");
    const resultEl = document.getElementById("saveResult");
    if (saveBtn) { saveBtn.disabled = true; saveBtn.textContent = "Saving…"; }

    const g = elId => (document.getElementById(elId) || {}).value?.trim() || "";
    const payload = {
      name:               g("d_name"),
      channel:            g("d_channel"),
      source:             g("d_source"),
      service_promoted:   g("d_service_promoted"),
      city_zone_targeted: g("d_city_zone_targeted"),
      utm_campaign:       g("d_utm_campaign"),
      start_date:         g("d_start_date"),
      end_date:           g("d_end_date"),
      budget:             g("d_budget"),
      spend:              g("d_spend"),
      landing_page:       g("d_landing_page"),
      tracking_phone:     g("d_tracking_phone"),
      contractor_vendor:  g("d_contractor_vendor"),
      status:             g("d_status"),
      offer_message:      g("d_offer_message"),
      notes:              g("d_notes"),
      owner_decision:     g("d_owner_decision"),
    };

    try {
      const d = await window.Api.fetchJson(`/api/marketing/campaigns/${encodeURIComponent(id)}`, {
        method: "PATCH", headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (d.ok) {
        toast("Campaign saved!", "success");
        if (resultEl) { resultEl.textContent = "Saved " + new Date().toLocaleTimeString(); resultEl.style.color = "hsl(145 60% 55%)"; }
        const titleEl = document.getElementById("detailPageTitle");
        if (titleEl && payload.name) titleEl.textContent = payload.name;
      } else {
        toast("Error: " + (d.error || "unknown"), "error");
      }
    } catch (e) {
      toast("Error: " + e.message, "error");
    } finally {
      if (saveBtn) { saveBtn.disabled = false; saveBtn.textContent = "Save Changes"; }
    }
  }

  // ── Landing Pages ──────────────────────────────────────────────────────────
  function initLandingPages() {
    loadLandingPages();

    const newBtn    = document.getElementById("newLpBtn");
    const form      = document.getElementById("lpForm");
    const cancelBtn = document.getElementById("lp_cancelBtn");
    const saveBtn   = document.getElementById("lp_saveBtn");

    if (newBtn) newBtn.addEventListener("click", () => openLpForm(null));
    if (cancelBtn) cancelBtn.addEventListener("click", closeLpForm);
    if (saveBtn) saveBtn.addEventListener("click", saveLandingPage);
  }

  async function loadLandingPages() {
    const loadingEl = document.getElementById("lpLoading");
    const contentEl = document.getElementById("lpContent");
    if (loadingEl) { loadingEl.style.display = "block"; loadingEl.textContent = "Loading landing pages…"; }
    if (contentEl) contentEl.style.display = "none";
    try {
      const [lpData, campData] = await Promise.all([
        window.Api.fetchJson("/api/marketing/landing-pages"),
        window.Api.fetchJson("/api/marketing/campaigns").catch(() => ({ campaigns: [] })),
      ]);
      const utmMap = {};
      for (const c of (campData.campaigns || [])) {
        if (c.utm_campaign) utmMap[String(c.utm_campaign).trim().toLowerCase()] = c.campaign_id;
      }
      renderLpTable(lpData.pages || [], utmMap);
      if (loadingEl) loadingEl.style.display = "none";
      if (contentEl) contentEl.style.display = "block";
    } catch (e) {
      if (loadingEl) loadingEl.textContent = "Error: " + e.message;
    }
  }

  function renderLpTable(pages, utmMap) {
    utmMap = utmMap || {};
    const tbody  = document.getElementById("lpTbody");
    const emptyEl = document.getElementById("lpEmpty");
    if (!tbody) return;

    if (!pages.length) {
      tbody.innerHTML = "";
      if (emptyEl) emptyEl.style.display = "block";
      return;
    }
    if (emptyEl) emptyEl.style.display = "none";

    tbody.innerHTML = pages.map(p => {
      const utmKey = String(p.utm_campaign || "").trim().toLowerCase();
      const campId = utmKey ? utmMap[utmKey] : null;
      const campLink = p.utm_campaign
        ? (campId
            ? `<a href="/crm/marketing/campaigns/${esc(campId)}" style="font-size:12px;color:hsl(215 80% 60%);">${esc(p.utm_campaign)}</a>`
            : `<span style="font-size:12px;color:hsl(220 15% 55%);">${esc(p.utm_campaign)}</span>`)
        : "—";
      return `
      <tr>
        <td>
          <a href="${esc(p.url)}" target="_blank" rel="noopener" style="font-weight:600;color:hsl(215 80% 65%);">${esc(p.title || p.url || "—")}</a>
          ${p.url && p.title ? `<br><span style="font-size:11px;color:hsl(220 15% 50%);">${esc(p.url)}</span>` : ""}
        </td>
        <td>${esc(p.service_type || "—")}</td>
        <td>${esc(p.city || "—")}</td>
        <td>${campLink}</td>
        <td>${statusBadge(p.status)}</td>
        <td>${fmtDate(p.created_at)}</td>
        <td>
          <button type="button" class="copy-btn" style="font-size:11px;" data-id="${esc(p.page_id)}" data-action="edit-lp">Edit</button>
        </td>
      </tr>`;
    }).join("");

    tbody.querySelectorAll("[data-action='edit-lp']").forEach(btn => {
      btn.addEventListener("click", () => {
        const id = btn.dataset.id;
        const page = pages.find(p => p.page_id === id);
        if (page) openLpForm(page);
      });
    });
  }

  function openLpForm(page) {
    const form = document.getElementById("lpForm");
    const title = document.getElementById("lpFormTitle");
    if (!form) return;

    const set = (id, val) => { const el = document.getElementById(id); if (el) el.value = val || ""; };
    if (page) {
      if (title) title.textContent = "Edit Landing Page";
      set("lp_url",         page.url);
      set("lp_title",       page.title);
      set("lp_service_type",page.service_type);
      set("lp_city",        page.city);
      set("lp_utm_campaign",page.utm_campaign);
      set("lp_status",      page.status);
      set("lp_notes",       page.notes);
      set("lp_editing_id",  page.page_id);
    } else {
      if (title) title.textContent = "New Landing Page";
      ["lp_url","lp_title","lp_service_type","lp_city","lp_utm_campaign","lp_notes","lp_editing_id"].forEach(id => set(id, ""));
      set("lp_status", "Active");
    }

    form.style.display = "block";
    form.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  function closeLpForm() {
    const form = document.getElementById("lpForm");
    if (form) form.style.display = "none";
    const errEl = document.getElementById("lp_error");
    if (errEl) errEl.style.display = "none";
  }

  async function saveLandingPage() {
    const errEl  = document.getElementById("lp_error");
    const saveBtn = document.getElementById("lp_saveBtn");
    const url = (document.getElementById("lp_url") || {}).value?.trim();
    if (!url) {
      if (errEl) { errEl.textContent = "URL is required."; errEl.style.display = "block"; }
      return;
    }
    if (errEl) errEl.style.display = "none";
    if (saveBtn) { saveBtn.disabled = true; saveBtn.textContent = "Saving…"; }

    const editingId = (document.getElementById("lp_editing_id") || {}).value?.trim();
    const g = id => (document.getElementById(id) || {}).value?.trim() || "";
    const payload = {
      url,
      title:        g("lp_title"),
      service_type: g("lp_service_type"),
      city:         g("lp_city"),
      utm_campaign: g("lp_utm_campaign"),
      status:       g("lp_status"),
      notes:        g("lp_notes"),
    };

    try {
      let endpoint = "/api/marketing/landing-pages";
      let method   = "POST";
      if (editingId) {
        endpoint = "/api/marketing/landing-pages/" + encodeURIComponent(editingId);
        method   = "PATCH";
      }
      const d = await window.Api.fetchJson(endpoint, {
        method, headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (d.ok) {
        toast(editingId ? "Landing page updated!" : "Landing page created!", "success");
        closeLpForm();
        loadLandingPages();
      } else {
        if (errEl) { errEl.textContent = d.error || "Error saving."; errEl.style.display = "block"; }
      }
    } catch (e) {
      if (errEl) { errEl.textContent = e.message; errEl.style.display = "block"; }
    } finally {
      if (saveBtn) { saveBtn.disabled = false; saveBtn.textContent = "Save"; }
    }
  }

  return { initList, initDetail, initLandingPages };
})();

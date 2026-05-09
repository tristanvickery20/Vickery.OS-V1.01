(() => {
  const STATUS_MAP = {
    active:            { label: "Active",            dotClass: "dot-blue" },
    awaiting_response: { label: "Awaiting Response", dotClass: "dot-gray" },
    scheduled:         { label: "Scheduled",         dotClass: "dot-blue" },
    in_progress:       { label: "In Progress",       dotClass: "dot-blue" },
    awaiting_payment:  { label: "Awaiting Payment",  dotClass: "dot-yellow" },
    overdue:           { label: "Overdue",           dotClass: "dot-red" },
  };

  const listEl      = document.getElementById("clientList");
  const countEl     = document.getElementById("clientCount");
  const emptyEl     = document.getElementById("emptyState");
  const searchInput = document.getElementById("searchInput");
  const statusFilter = document.getElementById("statusFilter");

  let debounceTimer = null;

  (function injectCssOnce() {
    if (document.getElementById("clients-js-css")) return;
    const style = document.createElement("style");
    style.id = "clients-js-css";
    style.textContent = `
      .client-list { display:flex; flex-direction:column; gap:12px; }

      .client-row {
        display:flex;
        align-items:center;
        gap:14px;
        padding:14px 14px;
        border-radius:16px;
        text-decoration:none;
        color: inherit;
        background: rgba(255,255,255,0.03);
        border: 1px solid rgba(255,255,255,0.10);
        box-shadow: 0 12px 40px rgba(0,0,0,0.35);
        transition: border-color .15s ease, box-shadow .15s ease, transform .08s ease;
        -webkit-tap-highlight-color: transparent;
      }
      .client-row:hover {
        border-color: rgba(96,165,250,0.35);
        box-shadow: 0 6px 22px rgba(0,0,0,0.25);
      }
      .client-row:active { transform: translateY(1px); }

      .client-avatar {
        width:44px; height:44px;
        border-radius:999px;
        display:flex; align-items:center; justify-content:center;
        font-weight:900;
        background: rgba(59,130,246,0.18);
        border: 1px solid rgba(59,130,246,0.35);
        color: white;
        flex:0 0 44px;
        font-size:16px;
      }

      .client-mid { flex:1; min-width:0; }
      .client-name {
        font-size:16px;
        font-weight:900;
        line-height:1.15;
        white-space:nowrap;
        overflow:hidden;
        text-overflow:ellipsis;
      }
      .client-sub {
        margin-top:4px;
        font-size:13px;
        opacity:0.75;
        white-space:nowrap;
        overflow:hidden;
        text-overflow:ellipsis;
      }
      .client-sub2 {
        margin-top:6px;
        font-size:13px;
        opacity:0.85;
        white-space:nowrap;
        overflow:hidden;
        text-overflow:ellipsis;
      }

      .client-right {
        display:flex;
        flex-direction:column;
        align-items:flex-end;
        gap:8px;
        flex:0 0 auto;
      }

      .status-pill {
        display:inline-flex;
        align-items:center;
        gap:10px;
        font-size:12px;
        font-weight:900;
        padding:6px 10px;
        border-radius:999px;
        background: rgba(255,255,255,0.03);
        border: 1px solid rgba(255,255,255,0.10);
        white-space:nowrap;
      }

      .glowdot {
        width:10px; height:10px;
        border-radius:999px;
        display:inline-block;
      }
      .dot-blue   { background:#60a5fa; box-shadow:0 0 10px rgba(96,165,250,0.8),0 0 22px rgba(96,165,250,0.45); }
      .dot-gray   { background:#94a3b8; box-shadow:0 0 10px rgba(148,163,184,0.45); }
      .dot-yellow { background:#fbbf24; box-shadow:0 0 10px rgba(251,191,36,0.8),0 0 22px rgba(251,191,36,0.45); }
      .dot-red    { background:#fb7185; box-shadow:0 0 10px rgba(251,113,133,0.8),0 0 22px rgba(251,113,133,0.45); }

      .right-mini { font-size:12px; opacity:0.75; white-space:nowrap; }

      .error-card {
        padding:20px;
        border-radius:14px;
        border:1px solid rgba(251,113,133,0.3);
        background:rgba(251,113,133,0.07);
        color:#fb7185;
        font-size:14px;
      }

      @media (max-width: 520px) {
        .client-right { display:none; }
      }
    `;
    document.head.appendChild(style);
  })();

  function escH(str) {
    return String(str || "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function normalize(v) { return String(v || "").trim(); }

  function fmtShortDate(iso) {
    if (!iso) return "";
    const d = new Date(iso);
    if (isNaN(d.getTime())) return "";
    const months = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
    return months[d.getMonth()] + " " + d.getDate();
  }

  function fmtMoney(val) {
    const n = Number(val);
    if (!isFinite(n) || !val) return "";
    return "$" + n.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 0 });
  }

  function initial(name) {
    const s = String(name || "").trim();
    return (s ? s.charAt(0) : "?").toUpperCase();
  }

  function statusPill(code) {
    const key = String(code || "").toLowerCase().trim();
    const s = STATUS_MAP[key] || { label: code || "Unknown", dotClass: "dot-gray" };
    return (
      '<span class="status-pill">' +
        '<span class="glowdot ' + escH(s.dotClass) + '"></span>' +
        escH(s.label) +
      "</span>"
    );
  }

  function setEmptyState(on) {
    if (emptyEl) emptyEl.style.display = on ? "block" : "none";
    if (listEl)  listEl.style.display  = on ? "none"  : "block";
  }

  function renderList(clients) {
    const n = (clients && clients.length) ? clients.length : 0;
    if (countEl) countEl.textContent = n ? (n + " lead" + (n !== 1 ? "s" : "")) : "";

    if (!clients || clients.length === 0) {
      if (listEl) listEl.innerHTML = "";
      setEmptyState(true);
      return;
    }

    setEmptyState(false);
    listEl.classList.add("client-list");

    listEl.innerHTML = clients.map((c) => {
      const scheduled = fmtShortDate(c.scheduled_date);
      const scheduledStr = scheduled ? ("Scheduled: " + scheduled) : "Scheduled: \u2014";
      const est = fmtMoney(c.estimated_value);
      const crew = normalize(c.assigned_to);
      const estStr = "Est: " + (est || "\u2014");
      const jobNum = normalize(c.job_number);
      const jobStr = jobNum ? ("Job #" + jobNum) : "";

      const subLine = normalize(c.address) || normalize(c.phone) || "";

      const href = "/crm/lead?id=" + encodeURIComponent(c.id || "");

      return (
        '<a href="' + escH(href) + '" class="client-row" data-id="' + escH(c.id) + '">' +
          '<div class="client-avatar">' + escH(initial(c.name)) + "</div>" +
          '<div class="client-mid">' +
            '<div class="client-name">' + escH(c.name || "(No name)") + "</div>" +
            (subLine ? '<div class="client-sub">' + escH(subLine) + "</div>" : "") +
            '<div class="client-sub2">' + escH(scheduledStr + "  \u00b7  " + estStr + (crew ? "  \u00b7  Crew: " + crew : "")) + "</div>" +
          "</div>" +
          '<div class="client-right">' +
            statusPill(c.status) +
            (jobStr ? '<div class="right-mini">' + escH(jobStr) + "</div>" : "") +
            (est ? '<div class="right-mini">' + escH(est) + "</div>" : "") +
          "</div>" +
        "</a>"
      );
    }).join("");
  }

  async function loadClients() {
    const q      = (searchInput  && searchInput.value  ? searchInput.value  : "").trim();
    const status = (statusFilter && statusFilter.value ? statusFilter.value : "all");

    const params = new URLSearchParams();
    if (q) params.set("q", q);
    if (status && status !== "all") params.set("status", status);
    params.set("limit", "200");
    params.set("sort", "recent");

    try {
      const resp = await fetch("/api/clients?" + params.toString(), { cache: "no-store" });
      const data = await resp.json();
      if (data && data.ok) {
        renderList(data.clients || []);
      } else {
        setEmptyState(false);
        listEl.innerHTML = '<div class="error-card">Error loading pipeline: ' + escH((data && data.error) || "Unknown error") + "</div>";
      }
    } catch (e) {
      setEmptyState(false);
      listEl.innerHTML = '<div class="error-card">Failed to load pipeline. Check connection.</div>';
    }
  }

  function debounceLoad() {
    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(loadClients, 300);
  }

  function restoreScrollIfAny() {
    const saved = sessionStorage.getItem("clients_scrollY");
    if (!saved) return;
    requestAnimationFrame(() => {
      window.scrollTo(0, Number(saved) || 0);
      sessionStorage.removeItem("clients_scrollY");
    });
  }

  document.addEventListener("click", (e) => {
    const row = e.target && e.target.closest ? e.target.closest(".client-row") : null;
    if (row) sessionStorage.setItem("clients_scrollY", String(window.scrollY || 0));
  });

  if (searchInput)  searchInput.addEventListener("input", debounceLoad);
  if (statusFilter) statusFilter.addEventListener("change", loadClients);

  loadClients().then(restoreScrollIfAny);
})();

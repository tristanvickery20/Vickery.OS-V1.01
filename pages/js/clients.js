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
  let allClients = [];

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
        position: relative;
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

      .jobs-badge {
        display:inline-flex;
        align-items:center;
        gap:5px;
        padding:2px 8px;
        border-radius:999px;
        font-size:11px;
        font-weight:800;
        letter-spacing:0.02em;
        background: rgba(96,165,250,0.18);
        border: 1px solid rgba(96,165,250,0.40);
        color: #93c5fd;
        white-space:nowrap;
        vertical-align:middle;
        margin-left:6px;
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

      /* Merge button on each row */
      .merge-btn {
        display:none;
        position:absolute;
        top:8px; right:8px;
        padding:4px 9px;
        border-radius:8px;
        border: 1px solid rgba(96,165,250,0.4);
        background: rgba(96,165,250,0.10);
        color: #93c5fd;
        font-size:11px;
        font-weight:800;
        cursor:pointer;
        letter-spacing:0.02em;
        z-index:2;
        white-space:nowrap;
        transition: background 0.15s;
      }
      .client-row:hover .merge-btn { display:inline-flex; align-items:center; gap:4px; }
      .merge-btn:hover { background: rgba(96,165,250,0.22); }

      /* Merge Modal */
      #mergeModal {
        display:none;
        position:fixed;
        inset:0;
        z-index:9999;
        background:rgba(0,0,0,0.65);
        align-items:center;
        justify-content:center;
        padding:16px;
      }
      #mergeModal.open { display:flex; }
      .merge-dialog {
        background: hsl(220 15% 12%);
        border: 1px solid rgba(255,255,255,0.12);
        border-radius:20px;
        padding:28px;
        width:100%;
        max-width:460px;
        box-shadow: 0 24px 80px rgba(0,0,0,0.6);
        display:flex;
        flex-direction:column;
        gap:18px;
      }
      .merge-dialog h2 {
        font-size:18px;
        font-weight:900;
        margin:0;
        color:#fff;
      }
      .merge-primary-card {
        background: rgba(96,165,250,0.08);
        border: 1px solid rgba(96,165,250,0.25);
        border-radius:12px;
        padding:12px 14px;
        font-size:14px;
        color:#e2e8f0;
      }
      .merge-primary-card strong { color:#fff; }
      .merge-search-wrap { position:relative; }
      .merge-search-wrap input {
        width:100%;
        box-sizing:border-box;
        padding:10px 14px;
        border-radius:10px;
        border:1px solid rgba(255,255,255,0.15);
        background:rgba(255,255,255,0.05);
        color:#fff;
        font-size:14px;
        outline:none;
      }
      .merge-search-wrap input:focus { border-color:rgba(96,165,250,0.5); }
      .merge-results {
        max-height:220px;
        overflow-y:auto;
        display:flex;
        flex-direction:column;
        gap:6px;
      }
      .merge-result-row {
        padding:10px 12px;
        border-radius:10px;
        border:1px solid rgba(255,255,255,0.08);
        background:rgba(255,255,255,0.03);
        cursor:pointer;
        transition: border-color 0.12s, background 0.12s;
        font-size:13px;
        color:#e2e8f0;
      }
      .merge-result-row:hover { border-color:rgba(96,165,250,0.45); background:rgba(96,165,250,0.07); }
      .merge-result-row.selected { border-color:#60a5fa; background:rgba(96,165,250,0.14); color:#fff; }
      .merge-result-name { font-weight:800; font-size:14px; }
      .merge-result-sub  { font-size:12px; opacity:0.7; margin-top:2px; }
      .merge-result-empty { font-size:13px; opacity:0.5; text-align:center; padding:14px; }
      .merge-actions { display:flex; gap:10px; justify-content:flex-end; }
      .merge-cancel-btn {
        padding:10px 20px;
        border-radius:10px;
        border:1px solid rgba(255,255,255,0.15);
        background:transparent;
        color:#e2e8f0;
        font-size:14px;
        font-weight:700;
        cursor:pointer;
      }
      .merge-cancel-btn:hover { background:rgba(255,255,255,0.06); }
      .merge-confirm-btn {
        padding:10px 22px;
        border-radius:10px;
        border:none;
        background:hsl(220 100% 45%);
        color:#fff;
        font-size:14px;
        font-weight:800;
        cursor:pointer;
        transition: background 0.15s;
      }
      .merge-confirm-btn:disabled { opacity:0.4; cursor:not-allowed; }
      .merge-confirm-btn:not(:disabled):hover { background:hsl(220 100% 40%); }
      .merge-warning {
        font-size:12px;
        color:#fbbf24;
        background:rgba(251,191,36,0.08);
        border:1px solid rgba(251,191,36,0.2);
        border-radius:8px;
        padding:8px 12px;
        line-height:1.45;
      }

      @media (max-width: 520px) {
        .client-right { display:none; }
        .merge-btn { display:none !important; }
      }
    `;
    document.head.appendChild(style);
  })();

  // Inject merge modal DOM
  (function injectMergeModal() {
    if (document.getElementById("mergeModal")) return;
    const modal = document.createElement("div");
    modal.id = "mergeModal";
    modal.setAttribute("role", "dialog");
    modal.setAttribute("aria-modal", "true");
    modal.innerHTML = `
      <div class="merge-dialog">
        <h2>Merge duplicate records</h2>
        <div class="merge-primary-card" id="mergePrimaryCard"></div>
        <div class="merge-search-wrap">
          <input id="mergeSearchInput" type="text" placeholder="Search for the duplicate to merge in…" autocomplete="off" />
        </div>
        <div class="merge-results" id="mergeResults"></div>
        <div class="merge-warning">
          The duplicate's jobs will be re-linked to the primary record's phone number.
          This action is logged and cannot be automatically undone.
        </div>
        <div class="merge-actions">
          <button class="merge-cancel-btn" id="mergeCancelBtn">Cancel</button>
          <button class="merge-confirm-btn" id="mergeConfirmBtn" disabled>Merge records</button>
        </div>
      </div>
    `;
    document.body.appendChild(modal);

    document.getElementById("mergeCancelBtn").addEventListener("click", closeMergeModal);
    modal.addEventListener("click", (e) => {
      if (e.target === modal) closeMergeModal();
    });
    document.getElementById("mergeSearchInput").addEventListener("input", onMergeSearch);
    document.getElementById("mergeConfirmBtn").addEventListener("click", onMergeConfirm);
  })();

  let mergeState = { primaryClient: null, selectedSecondary: null };

  function openMergeModal(client) {
    mergeState = { primaryClient: client, selectedSecondary: null };
    const card = document.getElementById("mergePrimaryCard");
    const hasPhone = !!String(client.phone || "").replace(/\D/g, "");
    card.innerHTML =
      "<strong>Keep (primary):</strong> " + escH(client.name || "(No name)") +
      (client.phone ? " &nbsp;·&nbsp; " + escH(client.phone) : " &nbsp;<span style='color:#fb7185;font-size:11px'>no phone</span>") +
      (client.address ? "<br><span style='opacity:0.6'>" + escH(client.address) + "</span>" : "") +
      (!hasPhone ? "<br><span style='color:#fbbf24;font-size:11px;margin-top:4px;display:block'>Note: this record has no phone number. The merge will still work, but for grouping to occur it needs a phone. Consider picking the record that has one as the primary.</span>" : "");
    document.getElementById("mergeSearchInput").value = "";
    document.getElementById("mergeResults").innerHTML = "<div class='merge-result-empty'>Type a name or phone to search</div>";
    document.getElementById("mergeConfirmBtn").disabled = true;
    document.getElementById("mergeModal").classList.add("open");
    setTimeout(() => document.getElementById("mergeSearchInput").focus(), 50);
  }

  function closeMergeModal() {
    document.getElementById("mergeModal").classList.remove("open");
    mergeState = { primaryClient: null, selectedSecondary: null };
  }

  let mergeSearchTimer = null;
  function onMergeSearch(e) {
    clearTimeout(mergeSearchTimer);
    mergeSearchTimer = setTimeout(() => renderMergeResults(e.target.value.trim()), 200);
  }

  function renderMergeResults(q) {
    const container = document.getElementById("mergeResults");
    if (!q) {
      container.innerHTML = "<div class='merge-result-empty'>Type a name or phone to search</div>";
      return;
    }
    const lower = q.toLowerCase();
    const primaryId = mergeState.primaryClient ? mergeState.primaryClient.id : "";
    const matches = allClients.filter((c) => {
      if (c.id === primaryId) return false;
      const fields = [c.name, c.phone, c.address, c.job_number];
      return fields.some((f) => String(f || "").toLowerCase().includes(lower));
    }).slice(0, 12);

    if (!matches.length) {
      container.innerHTML = "<div class='merge-result-empty'>No matching records found</div>";
      return;
    }

    container.innerHTML = matches.map((c) => {
      const isSelected = mergeState.selectedSecondary && mergeState.selectedSecondary.id === c.id;
      const sub = [c.phone, c.address].filter(Boolean).join("  ·  ");
      return (
        '<div class="merge-result-row' + (isSelected ? " selected" : "") + '" data-id="' + escH(c.id) + '">' +
          '<div class="merge-result-name">' + escH(c.name || "(No name)") + '</div>' +
          (sub ? '<div class="merge-result-sub">' + escH(sub) + '</div>' : '') +
        '</div>'
      );
    }).join("");

    container.querySelectorAll(".merge-result-row").forEach((row) => {
      row.addEventListener("click", () => {
        const id = row.dataset.id;
        const c = allClients.find((x) => x.id === id);
        if (!c) return;
        mergeState.selectedSecondary = c;
        container.querySelectorAll(".merge-result-row").forEach((r) => r.classList.remove("selected"));
        row.classList.add("selected");
        document.getElementById("mergeConfirmBtn").disabled = false;
      });
    });
  }

  async function onMergeConfirm() {
    const { primaryClient, selectedSecondary } = mergeState;
    if (!primaryClient || !selectedSecondary) return;

    const confirmBtn = document.getElementById("mergeConfirmBtn");
    confirmBtn.disabled = true;
    confirmBtn.textContent = "Merging…";

    try {
      const resp = await fetch("/api/clients/merge", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          primary_id: primaryClient.id,
          secondary_id: selectedSecondary.id,
        }),
      });
      const data = await resp.json();
      if (data.ok) {
        closeMergeModal();
        await loadClients();
        showToast("Records merged successfully.");
      } else {
        alert("Merge failed: " + (data.error || "Unknown error"));
        confirmBtn.disabled = false;
        confirmBtn.textContent = "Merge records";
      }
    } catch (err) {
      alert("Merge failed: " + err.message);
      confirmBtn.disabled = false;
      confirmBtn.textContent = "Merge records";
    }
  }

  function showToast(msg) {
    let toast = document.getElementById("clientsToast");
    if (!toast) {
      toast = document.createElement("div");
      toast.id = "clientsToast";
      Object.assign(toast.style, {
        position: "fixed",
        bottom: "24px",
        left: "50%",
        transform: "translateX(-50%)",
        background: "hsl(220 100% 35%)",
        color: "#fff",
        padding: "12px 22px",
        borderRadius: "12px",
        fontWeight: "700",
        fontSize: "14px",
        zIndex: "99999",
        boxShadow: "0 8px 32px rgba(0,0,0,0.4)",
        pointerEvents: "none",
        opacity: "0",
        transition: "opacity 0.2s",
      });
      document.body.appendChild(toast);
    }
    toast.textContent = msg;
    toast.style.opacity = "1";
    clearTimeout(toast._timer);
    toast._timer = setTimeout(() => { toast.style.opacity = "0"; }, 3000);
  }

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
    allClients = clients || [];
    const n = allClients.length;
    if (countEl) countEl.textContent = n ? (n + " client" + (n !== 1 ? "s" : "")) : "";

    if (!clients || clients.length === 0) {
      if (listEl) listEl.innerHTML = "";
      setEmptyState(true);
      return;
    }

    setEmptyState(false);
    listEl.classList.add("client-list");

    listEl.innerHTML = clients.map((c) => {
      const jobCount = Number(c.job_count) || 1;
      const isMulti = jobCount > 1;
      const scheduled = fmtShortDate(c.scheduled_date);
      const scheduledStr = scheduled ? ("Last scheduled: " + scheduled) : "";
      const totalVal = isMulti ? Number(c.total_estimated_value) || 0 : 0;
      const est = isMulti
        ? (totalVal ? fmtMoney(totalVal) : "")
        : fmtMoney(c.estimated_value);
      const crew = normalize(c.assigned_to);
      const jobNum = normalize(c.job_number);
      const jobStr = !isMulti && jobNum ? ("Job #" + jobNum) : "";

      const subLine = normalize(c.address) || normalize(c.phone) || "";

      const detailParts = [];
      if (scheduledStr) detailParts.push(scheduledStr);
      if (est) detailParts.push(isMulti ? jobCount + " jobs · " + est + " total" : "Est: " + est);
      else if (isMulti) detailParts.push(jobCount + " jobs");
      if (!isMulti && crew) detailParts.push("Crew: " + crew);
      const detailStr = detailParts.join("  ·  ");

      const href = "/crm/lead?id=" + encodeURIComponent(c.id || "");
      const jobsBadge = isMulti
        ? '<span class="jobs-badge">' + jobCount + " jobs</span>"
        : "";

      return (
        '<a href="' + escH(href) + '" class="client-row" data-id="' + escH(c.id) + '">' +
          '<div class="client-avatar">' + escH(initial(c.name)) + "</div>" +
          '<div class="client-mid">' +
            '<div class="client-name">' + escH(c.name || "(No name)") + jobsBadge + "</div>" +
            (subLine ? '<div class="client-sub">' + escH(subLine) + "</div>" : "") +
            (detailStr ? '<div class="client-sub2">' + escH(detailStr) + "</div>" : "") +
          "</div>" +
          '<div class="client-right">' +
            statusPill(c.status) +
            (jobStr ? '<div class="right-mini">' + escH(jobStr) + "</div>" : "") +
            (est ? '<div class="right-mini">' + escH(est) + "</div>" : "") +
          "</div>" +
          '<button class="merge-btn" data-merge-id="' + escH(c.id) + '" title="Merge with another record" aria-label="Merge">' +
            '<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M8 7l4-4 4 4M12 3v13M8 17l4 4 4-4"/></svg>' +
            'Merge' +
          '</button>' +
        "</a>"
      );
    }).join("");

    // Attach merge button listeners (stop propagation so the link doesn't fire)
    listEl.querySelectorAll(".merge-btn").forEach((btn) => {
      btn.addEventListener("click", (e) => {
        e.preventDefault();
        e.stopPropagation();
        const id = btn.dataset.mergeId;
        const client = allClients.find((c) => c.id === id);
        if (client) openMergeModal(client);
      });
    });
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
    if (row && !e.target.closest(".merge-btn")) {
      sessionStorage.setItem("clients_scrollY", String(window.scrollY || 0));
    }
  });

  if (searchInput)  searchInput.addEventListener("input", debounceLoad);
  if (statusFilter) statusFilter.addEventListener("change", loadClients);

  loadClients().then(restoreScrollIfAny);
})();

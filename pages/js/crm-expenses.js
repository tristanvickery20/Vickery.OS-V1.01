(() => {
  const statusEl = document.getElementById("status");
  const resultEl = document.getElementById("result");
  const tbody = document.querySelector("#table tbody");
  const refreshBtn = document.getElementById("refreshBtn");
  const submitBtn = document.getElementById("submitBtn");
  const categorySelect = document.getElementById("category");

  function esc(s) {
    return String(s ?? "").replace(/[&<>"']/g, (c) => ({
      "&": "&amp;", "<": "&lt;", ">": "&gt;",
      '"': "&quot;", "'": "&#039;",
    }[c]));
  }

  function todayStr() {
    const d = new Date();
    return d.getFullYear() + "-" +
      String(d.getMonth() + 1).padStart(2, "0") + "-" +
      String(d.getDate()).padStart(2, "0");
  }

  // ── Populate Tech/Lead selects ────────────────────────────────────────────
  async function populateSelects() {
    const techSelect = document.getElementById("tech_id");
    const leadSelect = document.getElementById("lead_id");

    const [techsData, leadsData] = await Promise.all([
      window.Api.fetchJson("/api/techs"),
      window.Api.fetchJson("/api/leads"),
    ]);

    techSelect.innerHTML = '<option value="">(select tech)</option>';
    for (const t of (techsData.techs || [])) {
      const o = document.createElement("option");
      o.value = t.id;
      o.textContent = t.name;
      techSelect.appendChild(o);
    }

    leadSelect.innerHTML = '<option value="">(none)</option>';
    for (const l of (leadsData.leads || [])) {
      const o = document.createElement("option");
      o.value = l.id;
      o.textContent = `${l.name} (${l.id})`;
      leadSelect.appendChild(o);
    }
  }

  // ── Populate Category dropdown from QB accounts ───────────────────────────
  // Falls back to a sensible static list if QB is not connected.
  const STATIC_CATEGORIES = [
    { id: "", name: "Cost of Goods Sold" },
    { id: "", name: "Automobile" },
    { id: "", name: "Fuel" },
    { id: "", name: "Job Expenses" },
    { id: "", name: "Meals and Entertainment" },
    { id: "", name: "Supplies" },
    { id: "", name: "Utilities" },
    { id: "", name: "Miscellaneous" },
  ];

  async function populateCategories() {
    try {
      const data = await window.Api.fetchJson("/api/accounting/accounts");
      const accounts = data.accounts && data.accounts.length > 0
        ? data.accounts
        : STATIC_CATEGORIES;
      renderCategories(accounts);
    } catch {
      renderCategories(STATIC_CATEGORIES);
    }
  }

  function renderCategories(accounts) {
    categorySelect.innerHTML = "";
    for (const a of accounts) {
      const o = document.createElement("option");
      o.value = a.name;
      o.dataset.qbId = a.id || "";
      o.textContent = a.name;
      categorySelect.appendChild(o);
    }
  }

  // ── Load + merge CRM and QB expenses into one table ───────────────────────
  async function loadEntries() {
    statusEl.textContent = "Loading…";
    tbody.innerHTML = "";

    const [crmResult, qbResult] = await Promise.allSettled([
      window.Api.fetchJson("/api/expenses"),
      window.Api.fetchJson("/api/accounting/transactions"),
    ]);

    const crmEntries  = (crmResult.status === "fulfilled" ? crmResult.value.entries : null) || [];
    const qbData      = qbResult.status  === "fulfilled" ? qbResult.value : null;
    const qbConnected = qbData && qbData.connected;
    const qbTxns      = qbConnected ? (qbData.transactions || []) : [];

    // Build unified row list
    const rows = [];

    for (const e of crmEntries) {
      rows.push({
        date:     e.date || "",
        payee:    e.payee || e.vendor || "",
        category: e.category || e.type || "",
        amount:   Number(e.amount) || 0,
        tech:     e.tech_id || "",
        notes:    e.notes || "",
        receipt:  e.receipt_url || "",
        source:   "crm",
      });
    }

    for (const t of qbTxns) {
      rows.push({
        date:     t.date || "",
        payee:    t.payee || "",
        category: t.category || t.account || "",
        amount:   Number(t.amount) || 0,
        tech:     "",
        notes:    t.note || "",
        receipt:  "",
        source:   "qb",
      });
    }

    // Sort newest first
    rows.sort((a, b) => (b.date > a.date ? 1 : b.date < a.date ? -1 : 0));

    const heading = document.getElementById("expHeading");
    if (qbConnected) {
      heading.innerHTML = `Expenses <span style="font-size:13px;font-weight:500;color:hsl(var(--muted-foreground));background:hsl(var(--muted));padding:2px 10px;border-radius:20px;vertical-align:middle;">CRM + QuickBooks</span>`;
    } else {
      heading.textContent = "Expenses";
    }

    statusEl.textContent = rows.length
      ? `${rows.length} expense(s)${qbConnected ? " — CRM & QB combined" : ""}.`
      : "No expenses yet.";

    for (const r of rows) {
      const tr = document.createElement("tr");

      const sourceBadge = r.source === "qb"
        ? `<span style="background:#7c3aed22;color:#a78bfa;padding:2px 8px;border-radius:12px;font-size:11px;font-weight:600;">QB</span>`
        : `<span style="background:#1e293b;color:#94a3b8;padding:2px 8px;border-radius:12px;font-size:11px;font-weight:600;">CRM</span>`;

      const notesCell = r.receipt
        ? `${esc(r.notes)} <a href="${esc(r.receipt)}" target="_blank" rel="noopener" style="color:hsl(var(--primary));">Receipt</a>`
        : esc(r.notes);

      tr.innerHTML = `
        <td>${esc(r.date)}</td>
        <td style="font-weight:500;">${esc(r.payee)}</td>
        <td>${esc(r.category)}</td>
        <td style="font-weight:600;">$${r.amount.toFixed(2)}</td>
        <td>${esc(r.tech)}</td>
        <td style="max-width:200px;white-space:normal;word-break:break-word;">${notesCell}</td>
        <td>${sourceBadge}</td>
      `;
      tbody.appendChild(tr);
    }

    if (rows.length === 0) {
      tbody.innerHTML = '<tr><td colspan="7" style="text-align:center;color:hsl(var(--muted-foreground));">No expenses yet.</td></tr>';
    }
  }

  // ── Toast notification ────────────────────────────────────────────────────
  function showToast(msg, isErr) {
    let t = document.getElementById("_expToast");
    if (!t) {
      t = document.createElement("div");
      t.id = "_expToast";
      Object.assign(t.style, {
        position:"fixed", bottom:"24px", left:"50%", transform:"translateX(-50%)",
        padding:"10px 22px", borderRadius:"10px", fontWeight:"600", fontSize:"14px",
        zIndex:"9999", transition:"opacity .3s", pointerEvents:"none",
      });
      document.body.appendChild(t);
    }
    t.textContent = msg;
    t.style.background = isErr ? "#7f1d1d" : "#166534";
    t.style.color = "#fff";
    t.style.opacity = "1";
    clearTimeout(t._hide);
    t._hide = setTimeout(() => { t.style.opacity = "0"; }, 2800);
  }

  // ── Submit new expense ────────────────────────────────────────────────────
  submitBtn.addEventListener("click", async () => {
    const date   = document.getElementById("date").value;
    const amount = document.getElementById("amount").value;

    if (!date)   { showToast("Pick a date first.", true); return; }
    if (!amount) { showToast("Enter an amount.", true); return; }

    submitBtn.disabled = true;
    submitBtn.textContent = "Saving…";
    resultEl.textContent = "";

    // Read selected category name + QB account ID from the dropdown
    const selectedOpt  = categorySelect.options[categorySelect.selectedIndex];
    const categoryName = selectedOpt ? selectedOpt.value : "";
    const qbAccountId  = selectedOpt ? (selectedOpt.dataset.qbId || "") : "";

    const payload = {
      date,
      tech_id:       document.getElementById("tech_id").value,
      lead_id:       document.getElementById("lead_id").value,
      category:      categoryName,
      qb_account_id: qbAccountId,
      payee:         document.getElementById("payee").value,
      amount:        Number(amount || 0),
      notes:         document.getElementById("notes").value,
      receipt_url:   document.getElementById("receipt_url").value,
    };

    try {
      await window.Api.fetchJson("/api/expenses", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      showToast("Expense saved!");
      document.getElementById("amount").value    = "";
      document.getElementById("payee").value     = "";
      document.getElementById("notes").value     = "";
      document.getElementById("receipt_url").value = "";
      await loadEntries();
    } catch (err) {
      showToast("Error: " + err.message, true);
    } finally {
      submitBtn.disabled = false;
      submitBtn.textContent = "Log Expense";
    }
  });

  document.getElementById("date").value = todayStr();

  refreshBtn.addEventListener("click", loadEntries);
  populateSelects();
  populateCategories();
  loadEntries();
})();

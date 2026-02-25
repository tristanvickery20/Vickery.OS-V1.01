(() => {
  const statusEl = document.getElementById("status");
  const resultEl = document.getElementById("result");
  const tbody = document.querySelector("#table tbody");
  const refreshBtn = document.getElementById("refreshBtn");
  const submitBtn = document.getElementById("submitBtn");

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

  async function loadEntries() {
    statusEl.textContent = "Loading...";
    tbody.innerHTML = "";

    try {
      const data = await window.Api.fetchJson("/api/expenses");
      const entries = data.entries || [];
      statusEl.textContent = `${entries.length} entry(ies).`;

      for (const e of entries) {
        const tr = document.createElement("tr");
        const receiptLink = e.receipt_url
          ? `<a href="${esc(e.receipt_url)}" target="_blank" rel="noopener">View</a>`
          : "";
        tr.innerHTML = `
          <td>${esc(e.date)}</td>
          <td>${esc(e.tech_id)}</td>
          <td>${esc(e.lead_id)}</td>
          <td>${esc(e.type)}</td>
          <td>${esc(e.vendor)}</td>
          <td>$${Number(e.amount).toFixed(2)}</td>
          <td>${esc(e.notes)}</td>
          <td>${receiptLink}</td>
        `;
        tbody.appendChild(tr);
      }
    } catch (err) {
      statusEl.textContent = "ERROR: " + err.message;
    }
  }

  submitBtn.addEventListener("click", async () => {
    resultEl.textContent = "Saving...";
    resultEl.className = "muted";

    const payload = {
      date: document.getElementById("date").value,
      tech_id: document.getElementById("tech_id").value,
      lead_id: document.getElementById("lead_id").value,
      type: document.getElementById("type").value,
      vendor: document.getElementById("vendor").value,
      amount: Number(document.getElementById("amount").value || 0),
      notes: document.getElementById("notes").value,
      receipt_url: document.getElementById("receipt_url").value,
    };

    try {
      await window.Api.fetchJson("/api/expenses", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      resultEl.textContent = "Expense logged!";
      resultEl.className = "success-msg";
      await loadEntries();
    } catch (err) {
      resultEl.textContent = "ERROR: " + err.message;
      resultEl.className = "warn";
    }
  });

  document.getElementById("date").value = todayStr();

  refreshBtn.addEventListener("click", loadEntries);
  populateSelects();
  loadEntries();
})();

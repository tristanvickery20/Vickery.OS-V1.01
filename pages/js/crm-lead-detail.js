(() => {
  const params = new URLSearchParams(window.location.search);
  const leadId = params.get("id");
  const statusEl = document.getElementById("status");
  const infoEl = document.getElementById("info");
  const titleEl = document.getElementById("title");

  if (!leadId) {
    statusEl.textContent = "No lead ID provided.";
    return;
  }

  function esc(s) {
    return String(s ?? "").replace(/[&<>"']/g, (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;" }[c]));
  }

  async function load() {
    statusEl.textContent = "Loading...";
    try {
      const data = await window.Api.fetchJson("/api/leads");
      const lead = (data.leads || []).find((l) => String(l.id) === String(leadId));
      if (!lead) { statusEl.textContent = "Lead not found."; return; }

      titleEl.textContent = lead.name || lead.id;
      statusEl.textContent = "";

      infoEl.innerHTML = `
        <table style="width:100%;border-collapse:collapse;">
          <tr><td style="padding:6px 12px;font-weight:600;">ID</td><td style="padding:6px 12px;">${esc(lead.id)}</td></tr>
          <tr><td style="padding:6px 12px;font-weight:600;">Name</td><td style="padding:6px 12px;">${esc(lead.name)}</td></tr>
          <tr><td style="padding:6px 12px;font-weight:600;">Phone</td><td style="padding:6px 12px;">${esc(lead.phone)}</td></tr>
          <tr><td style="padding:6px 12px;font-weight:600;">Address</td><td style="padding:6px 12px;">${esc(lead.address)}</td></tr>
          <tr><td style="padding:6px 12px;font-weight:600;">Status</td><td style="padding:6px 12px;">${esc(lead.status)}</td></tr>
          <tr><td style="padding:6px 12px;font-weight:600;">Quoted $</td><td style="padding:6px 12px;">$${esc(lead.quoted_price)}</td></tr>
          <tr><td style="padding:6px 12px;font-weight:600;">Estimated $</td><td style="padding:6px 12px;">$${esc(lead.estimated_value)}</td></tr>
          <tr><td style="padding:6px 12px;font-weight:600;">Last Quote ID</td><td style="padding:6px 12px;">${esc(lead.last_quote_id)}</td></tr>
          <tr><td style="padding:6px 12px;font-weight:600;">Pricing Version</td><td style="padding:6px 12px;">${esc(lead.pricing_version)}</td></tr>
        </table>
      `;

      // Financial Summary
      const revenue = lead.invoiced_amount > 0 ? lead.invoiced_amount : lead.quoted_price;
      if (revenue > 0 || lead.total_cost > 0) {
        document.getElementById("financialSection").style.display = "block";
        document.getElementById("finRevenue").textContent = "$" + Number(revenue || 0).toFixed(2);
        document.getElementById("finLabor").textContent = "$" + Number(lead.labor_cost || 0).toFixed(2);
        document.getElementById("finExpense").textContent = "$" + Number(lead.expense_cost || 0).toFixed(2);
        document.getElementById("finTotalCost").textContent = "$" + Number(lead.total_cost || 0).toFixed(2);
        const profit = Number(lead.gross_profit || 0);
        document.getElementById("finProfit").textContent = "$" + profit.toFixed(2);
        document.getElementById("finProfit").style.color = profit < 0 ? "hsl(0,70%,50%)" : "";
        document.getElementById("finMargin").textContent = lead.gross_margin_pct != null ? lead.gross_margin_pct + "%" : "N/A";
      }

      if (lead.quote_snapshot_json) {
        document.getElementById("snapshotSection").style.display = "block";
        try {
          const snap = JSON.parse(lead.quote_snapshot_json);
          document.getElementById("snapshot").textContent = JSON.stringify(snap, null, 2);
        } catch { document.getElementById("snapshot").textContent = lead.quote_snapshot_json; }
      }
    } catch (err) { statusEl.textContent = "Error: " + err.message; }
  }

  load();
})();

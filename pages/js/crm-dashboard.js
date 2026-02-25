(() => {
  const statusEl = document.getElementById("status");
  const refreshBtn = document.getElementById("refreshBtn");

  const kpiOpenLeads = document.getElementById("kpiOpenLeads");
  const kpiScheduledToday = document.getElementById("kpiScheduledToday");
  const kpiPipeline = document.getElementById("kpiPipeline");
  const kpiDepositRisk = document.getElementById("kpiDepositRisk");
  const kpiHoursWeek = document.getElementById("kpiHoursWeek");
  const kpiExpensesWeek = document.getElementById("kpiExpensesWeek");
  const kpiGasWeek = document.getElementById("kpiGasWeek");
  const kpiInvoiced = document.getElementById("kpiInvoiced");
  const kpiPaid = document.getElementById("kpiPaid");
  const kpiReceivables = document.getElementById("kpiReceivables");
  const kpiCompNotInv = document.getElementById("kpiCompNotInv");
  const kpiLaborWeek = document.getElementById("kpiLaborWeek");
  const kpiGrossProfit = document.getElementById("kpiGrossProfit");
  const kpiGrossMargin = document.getElementById("kpiGrossMargin");

  const riskTbody = document.querySelector("#riskTable tbody");

  function esc(s) {
    return String(s ?? "").replace(/[&<>"']/g, (c) => ({
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#039;",
    }[c]));
  }

  function dateOnly(dtLocal) {
    if (!dtLocal) return "";
    return String(dtLocal).split("T")[0];
  }

  function timeOnly(dtLocal) {
    if (!dtLocal) return "";
    const parts = String(dtLocal).split("T");
    return parts[1] || "";
  }

  function money(n) {
    const x = Number(n || 0);
    return "$" + x.toFixed(0);
  }

  function todayYYYYMMDD() {
    const now = new Date();
    const yyyy = now.getFullYear();
    const mm = String(now.getMonth() + 1).padStart(2, "0");
    const dd = String(now.getDate()).padStart(2, "0");
    return `${yyyy}-${mm}-${dd}`;
  }

  async function load() {
    statusEl.textContent = "Loading...";
    riskTbody.innerHTML = "";

    try {
      // tech names
      const techsData = await window.Api.fetchJson("/api/techs");
      const techById = {};
      for (const t of (techsData.techs || [])) techById[t.id] = t.name;

      // dashboard metrics
      const dash = await window.Api.fetchJson("/api/dashboard");
      const k = dash.kpis || {};
      const risk = dash.risk || [];

      // scheduled today (count from leads list)
      const leadsData = await window.Api.fetchJson("/api/leads");
      const leads = leadsData.leads || [];

      const today = todayYYYYMMDD();

      const scheduledTodayCount = leads.filter((l) => {
        const d = dateOnly(l.scheduled_date);
        const st = String(l.status || "");
        return d === today && (st === "Scheduled" || st === "In Progress");
      }).length;

      // KPIs
      kpiOpenLeads.textContent = String(k.open_leads_count ?? 0);
      kpiScheduledToday.textContent = String(scheduledTodayCount);
      kpiPipeline.textContent = money(k.pipeline_estimated ?? 0);
      kpiDepositRisk.textContent = String(k.deposit_risk_count ?? 0);
      kpiHoursWeek.textContent = String(k.hours_this_week ?? 0);
      kpiExpensesWeek.textContent = money(k.expenses_this_week ?? 0);
      kpiGasWeek.textContent = money(k.gas_this_week ?? 0);
      kpiInvoiced.textContent = money(k.invoiced_total ?? 0);
      kpiPaid.textContent = money(k.paid_total ?? 0);
      kpiReceivables.textContent = money(k.receivables ?? 0);
      kpiCompNotInv.textContent = String(k.completed_not_invoiced ?? 0);
      kpiLaborWeek.textContent = money(k.total_labor_cost_this_week ?? 0);
      kpiGrossProfit.textContent = money(k.gross_profit_total ?? 0);
      kpiGrossMargin.textContent = k.gross_margin_pct_total != null ? k.gross_margin_pct_total + "%" : "N/A";

      // Risk table
      for (const l of risk) {
        const tr = document.createElement("tr");
        tr.innerHTML = `
          <td>
            <div><strong>${esc(l.name)}</strong></div>
            <div class="muted">${esc(l.id)}</div>
          </td>
          <td>${esc(l.status)}</td>
          <td>${esc(techById[l.assigned_to] || l.assigned_to || "(unassigned)")}</td>
          <td>
            <div>${esc(dateOnly(l.scheduled_date))}</div>
            <div class="muted">${esc(timeOnly(l.scheduled_date))}</div>
          </td>
          <td>${esc(String(l.estimated_value || 0))}</td>
          <td>${esc(String(l.deposit_received || 0))}</td>
        `;
        riskTbody.appendChild(tr);
      }

      statusEl.textContent =
        `OK • ${k.open_leads_count ?? 0} open lead(s) • Pipeline ${money(k.pipeline_estimated ?? 0)}`;
    } catch (e) {
      statusEl.textContent = "ERROR: " + e.message;
    }
  }

  refreshBtn.addEventListener("click", load);
  load();
})();
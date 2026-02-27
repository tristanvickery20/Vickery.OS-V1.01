// Profit & Expense Calculator — CRM version
// Loads defaults from /api/actuals-rollup. User edits are what-if only; never written back.

const FIELD_DEFAULTS = { hoursPerWorkerPerDay: 8, daysPerWeek: 5, utilizationPct: 87 };
const SOLO_UTIL_PENALTY = 0.30;
const SOLO_COST_UPLIFT  = 0.10;

// ─── Data loading ────────────────────────────────────────────────────────────

async function fetchAndPopulateData(windowDays) {
  const statusEl = document.getElementById("calcStatus");
  if (statusEl) statusEl.textContent = "Loading actuals…";

  try {
    const res = await fetch(`/api/actuals-rollup?windowDays=${windowDays || 30}`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();

    let populated = 0;
    Object.entries(data).forEach(([id, val]) => {
      const el = document.getElementById(id);
      if (el && !el.dataset.touched) {
        el.value = String(val);
        populated++;
      }
    });

    // Apply hard defaults for schedule fields if still blank
    ["hoursPerWorkerPerDay", "daysPerWeek", "utilizationPct"].forEach(id => {
      const el = document.getElementById(id);
      if (!el || el.dataset.touched) return;
      const hasValue = el.value !== "" && !Number.isNaN(parseFloat(el.value));
      if (!hasValue) el.value = String(FIELD_DEFAULTS[id]);
    });

    if (statusEl) {
      statusEl.textContent = `Actuals loaded (${populated} fields, last 30 days)`;
      statusEl.className = "calc-status ok";
    }
  } catch (e) {
    console.error("Actuals fetch failed:", e);
    if (statusEl) {
      statusEl.textContent = "Could not load actuals — enter values manually";
      statusEl.className = "calc-status warn";
    }
    ["hoursPerWorkerPerDay", "daysPerWeek", "utilizationPct"].forEach(id => {
      const el = document.getElementById(id);
      if (el && !el.dataset.touched && el.value === "") {
        el.value = String(FIELD_DEFAULTS[id]);
      }
    });
  }

  calculateProfit();
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

const fmtCurrency = n =>
  (Number.isFinite(n) ? n : 0).toLocaleString(undefined, { style: "currency", currency: "USD", maximumFractionDigits: 2 });
const clamp01 = x => Math.min(1, Math.max(0, x));
function numOr(id, d) {
  const el = document.getElementById(id);
  const v = parseFloat(el?.value);
  return Number.isFinite(v) ? v : d;
}

// ─── Crew deployment ──────────────────────────────────────────────────────────

function computeCrewDeployment(totalJ, totalA, crewCount) {
  const J = Math.max(0, Math.floor(totalJ));
  const A = Math.max(0, Math.floor(totalA));
  const C = Math.max(0, Math.floor(crewCount));

  const paired = Math.min(C, Math.min(J, A));
  const remainingCrewSlots = C - paired;
  const remainingJ = J - paired;
  const soloJ = Math.min(remainingCrewSlots, Math.max(0, remainingJ));
  const activeJ = paired + soloJ;
  const activeA = paired;
  const activeWorkers = activeJ + activeA;

  return {
    pairedCrews: paired,
    soloJCrews: soloJ,
    activeJourneymen: activeJ,
    activeApprentices: activeA,
    activeWorkers,
    benchJourneymen: Math.max(0, J - activeJ),
    benchApprentices: Math.max(0, A - activeA),
  };
}

// ─── Capacity from person-hours + mix ────────────────────────────────────────

function computeJobsPerWeekRealistic(phS, phM, phL, mixS, mixM, mixL, totalWorkers, hoursPerWorkerPerDay, daysPerWeek, util) {
  const weeklyPersonHours = hoursPerWorkerPerDay * daysPerWeek * util * Math.max(0, totalWorkers);
  const types = [];
  if (mixS > 0 && phS > 0) types.push({ h: phS, mix: mixS });
  if (mixM > 0 && phM > 0) types.push({ h: phM, mix: mixM });
  if (mixL > 0 && phL > 0) types.push({ h: phL, mix: mixL });
  if (!types.length || weeklyPersonHours <= 0) return 0;

  const buckets = types.map(t => ({ ...t, target: weeklyPersonHours * t.mix, done: 0, count: 0 }));
  let hoursLeft = weeklyPersonHours;

  while (true) {
    buckets.sort((a, b) => (b.target - b.done) - (a.target - a.done));
    let placed = false;
    for (const t of buckets) {
      if (hoursLeft >= t.h) { t.done += t.h; t.count += 1; hoursLeft -= t.h; placed = true; break; }
    }
    if (!placed) break;
  }
  return buckets.reduce((s, t) => s + t.count, 0);
}

// ─── Main calculation ─────────────────────────────────────────────────────────

function calculateProfit() {
  const errEl = document.getElementById("errorMessage");
  try {
    const jRate   = numOr("journeymanLaborBurden", 0);
    const aRate   = numOr("apprenticeLaborBurden", 0);
    const totalJ  = numOr("numJourneymen", 0);
    const totalA  = numOr("numApprentices", 0);
    const crewCount = numOr("crewCount", 0);
    const manualCap = numOr("jobsPerWeek", 0);

    const hpd  = Math.min(24, Math.max(0, numOr("hoursPerWorkerPerDay", FIELD_DEFAULTS.hoursPerWorkerPerDay)));
    const dpw  = Math.min(7,  Math.max(1, numOr("daysPerWeek", FIELD_DEFAULTS.daysPerWeek)));
    const util = clamp01(numOr("utilizationPct", FIELD_DEFAULTS.utilizationPct) / 100);

    const overrun   = clamp01(numOr("overrunRatePct", 0) / 100);
    const cancel    = clamp01(numOr("cancelRatePct", 0) / 100);
    const prepDrive = Math.max(0, numOr("prepDriveHoursPerJob", 0));

    const leadsPerWeek = Math.max(0, numOr("leadsPerWeek", 0));
    const closeRate    = clamp01(numOr("closeRatePct", 0) / 100);
    const hasDemandCap = leadsPerWeek > 0 && closeRate > 0;

    const growth  = clamp01(numOr("annualGrowthRate", 0) / 100);
    const taxRate = clamp01(numOr("taxRate", 0) / 100);
    const margin  = clamp01(numOr("targetProfitMargin", 0) / 100);
    const bidAcc  = clamp01(numOr("bidAccuracy", 10) / 100);

    const mixS = clamp01(numOr("smallJobMix", 0) / 100);
    const mixM = clamp01(numOr("mediumJobMix", 0) / 100);
    const mixL = clamp01(numOr("largeJobMix", 0) / 100);

    const phS  = Math.max(0, numOr("smallJobHours", 0));
    const matS = Math.max(0, numOr("smallJobMaterials", 0));
    const phM  = Math.max(0, numOr("mediumJobHours", 0));
    const matM = Math.max(0, numOr("mediumJobMaterials", 0));
    const phL  = Math.max(0, numOr("largeJobHours", 0));
    const matL = Math.max(0, numOr("largeJobMaterials", 0));

    const vehicleInsurance   = Math.max(0, numOr("vehicleInsurance", 0));
    const fuelCost           = Math.max(0, numOr("fuelCost", 0));
    const vehicleMaintenance = Math.max(0, numOr("vehicleMaintenance", 0));
    const generalLiability   = Math.max(0, numOr("generalLiability", 0));
    const toolRepair         = Math.max(0, numOr("toolRepair", 0));
    const loanPayments       = Math.max(0, numOr("loanPayments", 0));
    const softwarePayments   = Math.max(0, numOr("softwarePayments", 0));
    const marketingCost      = Math.max(0, numOr("marketingCost", 0));
    const ownerSalary        = Math.max(0, numOr("ownerSalary", 0));

    // Validation
    const mixSum = mixS + mixM + mixL;
    if (mixSum > 0.001 && (mixSum < 0.999 || mixSum > 1.001)) {
      if (errEl) { errEl.textContent = "Job mix must sum to 100%."; errEl.classList.remove("hidden"); }
      return;
    }
    if (margin >= 0.999) {
      if (errEl) { errEl.textContent = "Target margin cannot be 100%."; errEl.classList.remove("hidden"); }
      return;
    }
    if (errEl) errEl.classList.add("hidden");

    // Crew deployment
    const deploy = computeCrewDeployment(totalJ, totalA, crewCount);
    const activeWorkers = deploy.activeWorkers;

    const effectiveLaborRate = activeWorkers > 0
      ? (jRate * deploy.activeJourneymen + aRate * deploy.activeApprentices) / activeWorkers
      : 0;

    // Expenses
    const totalMonthlyExpenses = vehicleInsurance + fuelCost + vehicleMaintenance + generalLiability +
      toolRepair + loanPayments + softwarePayments + marketingCost + ownerSalary;
    const annualExpenses = totalMonthlyExpenses * 12;

    // Effective hours per job (adds prep/drive + overruns)
    const effS = (phS + prepDrive) * (1 + overrun);
    const effM = (phM + prepDrive) * (1 + overrun);
    const effL = (phL + prepDrive) * (1 + overrun);

    // Solo-J utilization penalty
    const effWorkersForUtil = Math.max(0, activeWorkers - SOLO_UTIL_PENALTY * deploy.soloJCrews);
    const utilEff = activeWorkers > 0 ? util * (effWorkersForUtil / activeWorkers) : 0;

    // Capacity
    const supplyJobsPerWeek = computeJobsPerWeekRealistic(
      effS, effM, effL, mixS, mixM, mixL, activeWorkers, hpd, dpw, utilEff
    );
    const realizedSupply = supplyJobsPerWeek * (1 - cancel);
    const demandCap = hasDemandCap ? (leadsPerWeek * closeRate * (1 - cancel)) : Infinity;
    const autoJobsPerWeek = Math.max(0, Math.min(realizedSupply, demandCap));
    const jobsPerWeekEffective = manualCap > 0 ? Math.min(manualCap, autoJobsPerWeek) : autoJobsPerWeek;
    const annualJobs = Math.max(0, Math.floor(jobsPerWeekEffective * 52));

    // Solo-J cost uplift
    const activeCrews = deploy.pairedCrews + deploy.soloJCrews;
    const soloShare = activeCrews > 0 ? (deploy.soloJCrews / activeCrews) : 0;
    const hoursUpliftFactor = 1 + SOLO_COST_UPLIFT * soloShare;

    // Job costs
    const costS = matS + (phS * hoursUpliftFactor) * effectiveLaborRate;
    const costM = matM + (phM * hoursUpliftFactor) * effectiveLaborRate;
    const costL = matL + (phL * hoursUpliftFactor) * effectiveLaborRate;

    // Profit/job at target margin
    const profitFromCost = (c, m) => c * (m / (1 - m));
    const baseS = profitFromCost(costS, margin);
    const baseM = profitFromCost(costM, margin);
    const baseL = profitFromCost(costL, margin);

    // Accuracy band
    const lowS = baseS * (1 - bidAcc), highS = baseS * (1 + bidAcc);
    const lowM = baseM * (1 - bidAcc), highM = baseM * (1 + bidAcc);
    const lowL = baseL * (1 - bidAcc), highL = baseL * (1 + bidAcc);

    const weightedLow    = lowS * mixS + lowM * mixM + lowL * mixL;
    const weightedLikely = baseS * mixS + baseM * mixM + baseL * mixL;
    const weightedHigh   = highS * mixS + highM * mixM + highL * mixL;

    const varProfitLow    = weightedLow * annualJobs;
    const varProfitLikely = weightedLikely * annualJobs;
    const varProfitHigh   = weightedHigh * annualJobs;

    const netAfterTax = (pre, tRate) => pre - Math.max(0, pre) * tRate;
    const preTaxLow    = varProfitLow    - annualExpenses;
    const preTaxLikely = varProfitLikely - annualExpenses;
    const preTaxHigh   = varProfitHigh   - annualExpenses;
    const netLow    = netAfterTax(preTaxLow,    taxRate);
    const netLikely = netAfterTax(preTaxLikely, taxRate);
    const netHigh   = netAfterTax(preTaxHigh,   taxRate);

    // Year 2/3 growth
    const expGrowth = growth * 0.8;
    const netWithGrowth = (varY1, years) => {
      const pre = varY1 * Math.pow(1 + growth, years) - annualExpenses * Math.pow(1 + expGrowth, years);
      return netAfterTax(pre, taxRate);
    };

    // Display helpers
    const setText = (id, txt) => { const el = document.getElementById(id); if (el) el.textContent = txt; };
    const setClass = (id, cls) => { const el = document.getElementById(id); if (el) el.className = cls; };

    setText("activeJourneymen", deploy.activeJourneymen.toString());
    setText("activeApprentices", deploy.activeApprentices.toString());
    setText("activeWorkers", deploy.activeWorkers.toString());
    setText("pairedCrews", deploy.pairedCrews.toString());
    setText("soloJCrews", deploy.soloJCrews.toString());
    setText("autoJobsPerWeek", autoJobsPerWeek.toFixed(1));
    setText("annualJobs", annualJobs.toLocaleString());
    setText("totalMonthlyExpenses", fmtCurrency(totalMonthlyExpenses));
    setText("annualExpenses", fmtCurrency(annualExpenses));
    setText("overheadPerJob", annualJobs ? fmtCurrency(annualExpenses / annualJobs) : fmtCurrency(0));
    setText("effectiveLaborRate", fmtCurrency(effectiveLaborRate));
    setText("weightedAverageProfit", fmtCurrency(weightedLikely));
    setText("annualGrossProfit", fmtCurrency(varProfitLikely));

    renderYear("year1", "Year 1", netLow, netLikely, netHigh, varProfitLikely);
    renderYear("year2", "Year 2", netWithGrowth(varProfitLow, 1), netWithGrowth(varProfitLikely, 1), netWithGrowth(varProfitHigh, 1), varProfitLikely);
    renderYear("year3", "Year 3", netWithGrowth(varProfitLow, 2), netWithGrowth(varProfitLikely, 2), netWithGrowth(varProfitHigh, 2), varProfitLikely);

  } catch (err) {
    console.error("calculateProfit error:", err);
    if (errEl) { errEl.textContent = "Calculation error: " + err.message; errEl.classList.remove("hidden"); }
  }
}

function renderYear(containerId, title, worst, likely, best, scaleBase) {
  const container = document.getElementById(containerId);
  if (!container) return;
  const maxAbs = Math.max(Math.abs(worst), Math.abs(likely), Math.abs(best), Math.abs(scaleBase), 1);
  const bar = (v) => Math.max(0, Math.min(100, (Math.abs(v) / maxAbs) * 100)).toFixed(1);
  const neg = (v) => v < 0 ? " negative" : "";

  container.innerHTML = `
    <div class="year-card">
      <div class="year-title">${title}</div>
      <div class="year-cols">
        <div class="year-scenario">
          <div class="scenario-label">Worst Case</div>
          <div class="scenario-value${neg(worst)}">${fmtCurrency(worst)}</div>
          <div class="scenario-bar"><div class="bar-fill bar-worst" style="width:${bar(worst)}%"></div></div>
        </div>
        <div class="year-scenario">
          <div class="scenario-label">Likely</div>
          <div class="scenario-value${neg(likely)}">${fmtCurrency(likely)}</div>
          <div class="scenario-bar"><div class="bar-fill bar-likely" style="width:${bar(likely)}%"></div></div>
        </div>
        <div class="year-scenario">
          <div class="scenario-label">Best Case</div>
          <div class="scenario-value${neg(best)}">${fmtCurrency(best)}</div>
          <div class="scenario-bar"><div class="bar-fill bar-best" style="width:${bar(best)}%"></div></div>
        </div>
      </div>
    </div>`;
}

// ─── Init ─────────────────────────────────────────────────────────────────────

document.addEventListener("DOMContentLoaded", () => {
  // Mark fields as touched on change so they aren't overwritten
  document.querySelectorAll("input[type=number]").forEach(el => {
    el.addEventListener("input", () => {
      el.dataset.touched = "1";
      calculateProfit();
    });
  });

  // Window-days selector
  const winSel = document.getElementById("windowDays");
  if (winSel) {
    winSel.addEventListener("change", () => {
      document.querySelectorAll("input[type=number]").forEach(e => delete e.dataset.touched);
      fetchAndPopulateData(parseInt(winSel.value, 10));
    });
  }

  // Reload actuals button
  const reloadBtn = document.getElementById("reloadActuals");
  if (reloadBtn) {
    reloadBtn.addEventListener("click", () => {
      const days = parseInt(document.getElementById("windowDays")?.value || "30", 10);
      document.querySelectorAll("input[type=number]").forEach(e => delete e.dataset.touched);
      fetchAndPopulateData(days);
    });
  }

  fetchAndPopulateData(30);
});

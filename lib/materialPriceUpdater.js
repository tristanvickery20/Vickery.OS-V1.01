// lib/materialPriceUpdater.js
// Automatic monthly material price updater using BLS Producer Price Index.
//
// How it works:
//   1. First run — captures current BLS PPI index values as baseline, writes to
//      Config tab. Prices are NOT changed (no comparison point yet).
//   2. Each subsequent run — fetches current BLS index, computes ratio vs. stored
//      baseline, multiplies every material's base_cost by that ratio, then
//      updates the baseline in Config.
//
// BLS series used (all free, no API key required — v1 endpoint, 25 req/day):
//   PCU335931335931 — Power wire and cable manufacturing (NM-B, THHN, MC cable)
//   PCU335999335999 — All other electrical equipment (outlets, switches, devices)
//   WPU1174         — Electrical equipment and supplies, broad (panels, breakers, general)
//
// Regional adjustment:
//   SE Texas (Golden Triangle) tracks roughly 1-2% below national average
//   due to Gulf Coast proximity and lower freight costs. Configurable via the
//   Config tab key "ppi_regional_factor" (default: 0.99).
//
// Config tab keys managed by this module:
//   ppi_baseline_wire     — last index value for wire/cable series
//   ppi_baseline_device   — last index value for wiring devices series
//   ppi_baseline_panel    — last index value for switchgear series
//   ppi_baseline_general  — last index value for general electrical series
//   ppi_baseline_period   — BLS period label of stored baseline (e.g. "Jun 2025")
//   ppi_regional_factor   — regional multiplier (default 0.99)
//   materials_last_updated — ISO timestamp of last successful auto-update

const https = require("https");

// ── BLS series IDs (verified working, Feb 2026) ────────────────────────────────
const BLS = {
  wire:    "PCU335931335931",  // Power wire and cable manufacturing (NM-B, THHN, MC)
  device:  "PCU335999335999",  // All other electrical equipment (outlets, switches, devices)
  panel:   "WPU1174",          // Electrical equipment and supplies, broad (panels, breakers)
  general: "WPU1174",          // Same broad index — catches everything not otherwise mapped
};

// ── Classify material by name → which BLS series drives its price ─────────────
function classifyMaterial(name) {
  const n = (name || "").toLowerCase();
  if (/cable|wire|thhn|thwn|nm.b|mc |romex|uf.b|stranded|conductor|conduit/.test(n)) return "wire";
  if (/outlet|receptacle|switch|gfci|afci|dimmer|plate|duplex|cover|toggle|device/.test(n)) return "device";
  if (/panel|breaker|disconnect|subpanel|load.?center|enclosure|fuse|meter|bus.?bar/.test(n)) return "panel";
  return "general";
}

// ── Fetch latest BLS PPI data for a series ────────────────────────────────────
// Uses the BLS v1 public API (no key, 25 queries/day limit).
// Returns { value: number, period: string } where period = "Jan 2026" etc.
function fetchBLSLatest(seriesId) {
  return new Promise((resolve, reject) => {
    const url = `https://api.bls.gov/publicAPI/v1/timeseries/data/${seriesId}`;
    https.get(url, { headers: { "User-Agent": "VickeryElectricCRM/1.0 (internal pricing tool)" } }, (res) => {
      let body = "";
      res.on("data", d => body += d);
      res.on("end", () => {
        try {
          const json = JSON.parse(body);
          const series = json?.Results?.series?.[0];
          const data   = series?.data;
          if (!data || data.length === 0) return reject(new Error(`No data for series ${seriesId}`));
          // BLS returns newest first
          const latest = data[0];
          const value  = parseFloat(latest.value);
          const period = `${latest.periodName} ${latest.year}`;
          resolve({ value, period });
        } catch (e) {
          reject(new Error(`BLS parse error for ${seriesId}: ${e.message}`));
        }
      });
    }).on("error", reject);
  });
}

// ── Read Config tab → key/value map ──────────────────────────────────────────
async function readConfig(sheets, sheetId) {
  const r = await sheets.spreadsheets.values.get({
    spreadsheetId: sheetId,
    range: "Config!A1:B200",
  });
  const rows = r.data.values || [];
  const map = {};
  rows.forEach(([k, v]) => { if (k && k !== "key") map[String(k).trim()] = String(v || "").trim(); });
  return map;
}

// ── Upsert Config keys (append rows that don't exist, update in-place if they do) ─
async function upsertConfigKeys(sheets, sheetId, updates) {
  const r = await sheets.spreadsheets.values.get({
    spreadsheetId: sheetId,
    range: "Config!A1:B500",
  });
  const rows = r.data.values || [];

  // Build row-index map (1-indexed, row 1 = header)
  const keyToRow = {};
  rows.forEach((row, i) => {
    if (row[0] && row[0] !== "key") keyToRow[String(row[0]).trim()] = i + 1;
  });

  const requests = [];
  const newRows  = [];

  for (const [key, value] of Object.entries(updates)) {
    if (keyToRow[key]) {
      // Update existing row
      requests.push({
        range:  `Config!B${keyToRow[key]}`,
        values: [[String(value)]],
      });
    } else {
      newRows.push([key, String(value)]);
    }
  }

  if (requests.length) {
    await sheets.spreadsheets.values.batchUpdate({
      spreadsheetId: sheetId,
      requestBody: { valueInputOption: "RAW", data: requests },
    });
  }
  if (newRows.length) {
    await sheets.spreadsheets.values.append({
      spreadsheetId: sheetId,
      range: "Config!A1",
      valueInputOption: "RAW",
      insertDataOption: "INSERT_ROWS",
      requestBody: { majorDimension: "ROWS", values: newRows },
    });
  }
}

// ── Read all Materials rows ───────────────────────────────────────────────────
async function readMaterials(sheets, sheetId) {
  const r = await sheets.spreadsheets.values.get({
    spreadsheetId: sheetId,
    range: "Materials!A1:R500",
  });
  const rows = r.data.values || [];
  if (rows.length < 2) return { headers: [], data: [] };
  const [headers, ...data] = rows;
  return { headers, data, raw: rows };
}

// ── Write back updated Materials rows ─────────────────────────────────────────
async function writeMaterials(sheets, sheetId, headers, data) {
  const values = [headers, ...data];
  await sheets.spreadsheets.values.update({
    spreadsheetId: sheetId,
    range: `Materials!A1:R${values.length}`,
    valueInputOption: "RAW",
    requestBody: { majorDimension: "ROWS", values },
  });
}

// ── Main update function ──────────────────────────────────────────────────────
/**
 * runMaterialPriceUpdate(sheets, estimatorSheetId)
 *
 * Fetches BLS PPI data, computes adjustment factors, and updates Materials sheet.
 * Returns a summary object describing what happened.
 */
async function runMaterialPriceUpdate(sheets, estimatorSheetId) {
  const summary = {
    ran_at:          new Date().toISOString(),
    status:          "ok",
    baseline_set:    false,
    prices_updated:  false,
    rows_adjusted:   0,
    factors:         {},
    period:          null,
    error:           null,
  };

  try {
    // 1. Fetch BLS indices for all four series in parallel
    console.log("[MaterialPriceUpdater] Fetching BLS PPI data…");
    const [wire, device, panel, general] = await Promise.all([
      fetchBLSLatest(BLS.wire),
      fetchBLSLatest(BLS.device),
      fetchBLSLatest(BLS.panel),
      fetchBLSLatest(BLS.general),
    ]);

    const currentPeriod = wire.period; // use wire period as canonical
    summary.period = currentPeriod;
    console.log(`[MaterialPriceUpdater] BLS data fetched — period: ${currentPeriod}`);
    console.log(`  Wire: ${wire.value}  Device: ${device.value}  Panel: ${panel.value}  General: ${general.value}`);

    // 2. Read existing Config baselines
    const cfg = await readConfig(sheets, estimatorSheetId);
    const prevPeriod       = cfg.ppi_baseline_period || null;
    const prevWire         = parseFloat(cfg.ppi_baseline_wire)    || null;
    const prevDevice       = parseFloat(cfg.ppi_baseline_device)  || null;
    const prevPanel        = parseFloat(cfg.ppi_baseline_panel)   || null;
    const prevGeneral      = parseFloat(cfg.ppi_baseline_general) || null;
    const regionalFactor   = parseFloat(cfg.ppi_regional_factor)  || 0.99;

    // 3. No baseline yet → first run. Store current values and exit.
    if (!prevPeriod || !prevWire) {
      console.log("[MaterialPriceUpdater] No baseline found — storing current indices as baseline (no price changes).");
      await upsertConfigKeys(sheets, estimatorSheetId, {
        ppi_baseline_wire:    wire.value,
        ppi_baseline_device:  device.value,
        ppi_baseline_panel:   panel.value,
        ppi_baseline_general: general.value,
        ppi_baseline_period:  currentPeriod,
        ppi_regional_factor:  regionalFactor,
        materials_last_updated: summary.ran_at,
      });
      summary.baseline_set = true;
      summary.message = "Baseline captured. Prices will be adjusted on the next monthly run.";
      return summary;
    }

    // 4. Same period as baseline → nothing to do
    if (prevPeriod === currentPeriod) {
      console.log(`[MaterialPriceUpdater] Already current (${currentPeriod}) — skipping.`);
      summary.status  = "skipped";
      summary.message = `Already up to date for period ${currentPeriod}.`;
      return summary;
    }

    // 5. Compute adjustment factors: current/baseline × regional factor
    const factors = {
      wire:    ((wire.value    / prevWire)    * regionalFactor),
      device:  ((device.value  / prevDevice)  * regionalFactor),
      panel:   ((panel.value   / prevPanel)   * regionalFactor),
      general: ((general.value / prevGeneral) * regionalFactor),
    };
    summary.factors = factors;
    console.log(`[MaterialPriceUpdater] Adjustment factors (incl ${regionalFactor}× regional): wire=${factors.wire.toFixed(4)} device=${factors.device.toFixed(4)} panel=${factors.panel.toFixed(4)} general=${factors.general.toFixed(4)}`);

    // 6. Read Materials sheet and apply factors
    const { headers, data } = await readMaterials(sheets, estimatorSheetId);
    if (!headers.length || !data.length) throw new Error("Materials sheet is empty or unreadable.");

    const idxName        = headers.indexOf("name");
    const idxBaseCost    = headers.indexOf("base_cost");
    const idxSource      = headers.indexOf("cost_source");
    const idxUpdated     = headers.indexOf("last_updated");
    const idxPriceChecked = headers.indexOf("price_last_checked");
    const idxStatus      = headers.indexOf("price_status");

    if (idxBaseCost < 0) throw new Error("Materials sheet missing 'base_cost' column.");

    const today = new Date().toISOString().slice(0, 10);
    let adjusted = 0;

    for (const row of data) {
      const materialId = (row[0] || "").trim();
      if (!materialId) continue;

      const name     = (row[idxName] ?? "").trim();
      const type     = classifyMaterial(name);
      const factor   = factors[type];
      const rawCost  = parseFloat(row[idxBaseCost]);

      if (!isFinite(rawCost) || rawCost <= 0) continue; // skip $0 placeholder rows
      if (!isFinite(factor)  || factor <= 0)  continue;

      const newCost = Math.max(0.01, parseFloat((rawCost * factor).toFixed(4)));

      row[idxBaseCost]  = newCost;
      if (idxSource    >= 0) row[idxSource]     = `BLS PPI (${currentPeriod})`;
      if (idxUpdated   >= 0) row[idxUpdated]    = today;
      if (idxPriceChecked >= 0) row[idxPriceChecked] = today;
      if (idxStatus    >= 0) row[idxStatus]     = "auto_updated";

      adjusted++;
    }

    await writeMaterials(sheets, estimatorSheetId, headers, data);
    console.log(`[MaterialPriceUpdater] Updated ${adjusted} material rows.`);

    // 7. Update Config with new baseline
    await upsertConfigKeys(sheets, estimatorSheetId, {
      ppi_baseline_wire:      wire.value,
      ppi_baseline_device:    device.value,
      ppi_baseline_panel:     panel.value,
      ppi_baseline_general:   general.value,
      ppi_baseline_period:    currentPeriod,
      materials_last_updated: summary.ran_at,
    });

    summary.prices_updated = true;
    summary.rows_adjusted  = adjusted;
    summary.message = `Updated ${adjusted} materials from ${prevPeriod} → ${currentPeriod}. Wire: ×${factors.wire.toFixed(3)} | Device: ×${factors.device.toFixed(3)} | Panel: ×${factors.panel.toFixed(3)}.`;
    return summary;

  } catch (err) {
    console.error("[MaterialPriceUpdater] Error:", err.message);
    summary.status = "error";
    summary.error  = err.message;
    return summary;
  }
}

// ── Scheduler: first day of each month at 2:00 AM server time ─────────────────
function scheduleMonthlyPriceUpdate(sheets, estimatorSheetId) {
  function msUntilNextRun() {
    const now  = new Date();
    const next = new Date(now);
    next.setMonth(next.getMonth() + 1, 1); // first of next month
    next.setHours(2, 0, 0, 0);             // 2:00 AM
    return Math.max(0, next - now);
  }

  async function run() {
    console.log("[MaterialPriceUpdater] Monthly run starting…");
    const result = await runMaterialPriceUpdate(sheets, estimatorSheetId);
    console.log(`[MaterialPriceUpdater] Done — ${result.status}: ${result.message || result.error || ""}`);
    // Schedule next run
    const ms = msUntilNextRun();
    const days = (ms / 86400000).toFixed(1);
    console.log(`[MaterialPriceUpdater] Next run in ${days} days.`);
    setTimeout(run, ms);
  }

  const ms   = msUntilNextRun();
  const days = (ms / 86400000).toFixed(1);
  setTimeout(run, ms);
  console.log(`[MaterialPriceUpdater] Monthly price update scheduled — next run in ${days} days.`);
}

module.exports = { runMaterialPriceUpdate, scheduleMonthlyPriceUpdate, classifyMaterial };

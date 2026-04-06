const { getSheetsClient } = require("./sheets");

const DEFAULTS = {
  labor_rate_tech: "50",
  labor_rate_admin: "30",
  burden_pct: "0",
};

// Default values for the Profit Calculator — written to Config on first startup only.
const CALCULATOR_DEFAULTS = {
  journeymanLaborBurden:  "61",
  apprenticeLaborBurden:  "30",
  numJourneymen:          "1",
  numApprentices:         "1",
  crewCount:              "1",
  hoursPerWorkerPerDay:   "8",
  daysPerWeek:            "5",
  utilizationPct:         "87",
  prepDriveHoursPerJob:   "0.15",
  overrunRatePct:         "0.1",
  cancelRatePct:          "0.06",
  leadsPerWeek:           "20",
  closeRatePct:           "65",
  jobsPerWeek:            "",
  smallJobMix:            "65",
  mediumJobMix:           "35",
  largeJobMix:            "0",
  smallJobHours:          "2.5",
  smallJobMaterials:      "75",
  mediumJobHours:         "8",
  mediumJobMaterials:     "250",
  largeJobHours:          "27",
  largeJobMaterials:      "1250",
  vehicleInsurance:       "150",
  fuelCost:               "350",
  vehicleMaintenance:     "175",
  generalLiability:       "150",
  toolRepair:             "50",
  loanPayments:           "1100",
  softwarePayments:       "120",
  marketingCost:          "200",
  ownerSalary:            "1200",
  annualGrowthRate:       "5",
  taxRate:                "25",
  targetProfitMargin:     "32",
  bidAccuracy:            "10",
  crew_members:           "Cody Vickery",
};

async function getConfig() {
  const sheets = await getSheetsClient();
  const spreadsheetId = process.env.CRM_SHEET_ID;
  if (!spreadsheetId) return { ...DEFAULTS };

  let rows = [];
  try {
    const resp = await sheets.spreadsheets.values.get({
      spreadsheetId,
      range: "Config!A2:B200",
    });
    rows = resp.data.values || [];
  } catch {
    return { ...DEFAULTS };
  }

  const map = { ...DEFAULTS };
  for (const r of rows) {
    const key = String(r[0] || "").trim();
    const val = String(r[1] || "").trim();
    if (key) map[key] = val;
  }

  return map;
}

// Upsert a map of key→value pairs into the Config sheet.
// Existing rows are updated in-place; new keys are appended.
async function setConfigKeys(map) {
  const sheets = await getSheetsClient();
  const spreadsheetId = process.env.CRM_SHEET_ID;
  if (!spreadsheetId) return;

  let rows = [];
  try {
    const resp = await sheets.spreadsheets.values.get({
      spreadsheetId,
      range: "Config!A1:B200",
    });
    rows = resp.data.values || [];
  } catch { rows = []; }

  // Index existing keys → 1-based sheet row number (row 1 = header)
  const keyToRow = {};
  for (let i = 1; i < rows.length; i++) {
    const k = String(rows[i][0] || "").trim();
    if (k) keyToRow[k] = i + 1; // +1 because sheets are 1-indexed
  }

  const toUpdate = [];
  const toAppend = [];

  for (const [k, v] of Object.entries(map)) {
    if (k === "") continue;
    if (keyToRow[k]) {
      toUpdate.push({ range: `Config!B${keyToRow[k]}`, values: [[String(v)]] });
    } else {
      toAppend.push([k, String(v)]);
    }
  }

  // Batch all updates
  if (toUpdate.length > 0) {
    await sheets.spreadsheets.values.batchUpdate({
      spreadsheetId,
      requestBody: {
        valueInputOption: "RAW",
        data: toUpdate,
      },
    });
  }

  if (toAppend.length > 0) {
    await sheets.spreadsheets.values.append({
      spreadsheetId,
      range: "Config!A:B",
      valueInputOption: "RAW",
      insertDataOption: "INSERT_ROWS",
      requestBody: { majorDimension: "ROWS", values: toAppend },
    });
  }
}

async function ensureConfigDefaults() {
  const sheets = await getSheetsClient();
  const spreadsheetId = process.env.CRM_SHEET_ID;
  if (!spreadsheetId) return;

  let rows = [];
  try {
    const resp = await sheets.spreadsheets.values.get({
      spreadsheetId,
      range: "Config!A2:B200",
    });
    rows = resp.data.values || [];
  } catch {
    rows = [];
  }

  const existing = new Set(rows.map((r) => String(r[0] || "").trim()));
  const missing = Object.entries(DEFAULTS).filter(([k]) => !existing.has(k));

  if (missing.length === 0) return;

  await sheets.spreadsheets.values.append({
    spreadsheetId,
    range: "Config!A:A",
    valueInputOption: "RAW",
    insertDataOption: "INSERT_ROWS",
    requestBody: {
      majorDimension: "ROWS",
      values: missing.map(([k, v]) => [k, v]),
    },
  });

  console.log(`[Config] Seeded defaults: ${missing.map(([k]) => k).join(", ")}`);
}

// Writes calculator defaults to Config for any key not already present.
async function ensureCalculatorDefaults() {
  const spreadsheetId = process.env.CRM_SHEET_ID;
  if (!spreadsheetId) return;

  try {
    const sheets = await getSheetsClient();
    const resp = await sheets.spreadsheets.values.get({
      spreadsheetId,
      range: "Config!A2:B200",
    });
    const rows = resp.data.values || [];
    const existing = new Set(rows.map((r) => String(r[0] || "").trim()));
    const missing = Object.fromEntries(
      Object.entries(CALCULATOR_DEFAULTS).filter(([k]) => !existing.has(k))
    );
    if (Object.keys(missing).length > 0) {
      await setConfigKeys(missing);
      console.log(`[Config] Calculator defaults seeded: ${Object.keys(missing).join(", ")}`);
    }
  } catch (err) {
    console.error("[Config] ensureCalculatorDefaults error:", err.message);
  }
}

module.exports = { getConfig, setConfigKeys, ensureConfigDefaults, ensureCalculatorDefaults };

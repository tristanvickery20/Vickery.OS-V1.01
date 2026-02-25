const { getSheetsClient } = require("./sheets");

const DEFAULTS = {
  labor_rate_tech: "50",
  labor_rate_admin: "30",
  burden_pct: "0",
};

async function getConfig() {
  const sheets = await getSheetsClient();
  const spreadsheetId = process.env.CRM_SHEET_ID;
  if (!spreadsheetId) return { ...DEFAULTS };

  let rows = [];
  try {
    const resp = await sheets.spreadsheets.values.get({
      spreadsheetId,
      range: "Config!A2:B100",
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

async function ensureConfigDefaults() {
  const sheets = await getSheetsClient();
  const spreadsheetId = process.env.CRM_SHEET_ID;
  if (!spreadsheetId) return;

  let rows = [];
  try {
    const resp = await sheets.spreadsheets.values.get({
      spreadsheetId,
      range: "Config!A2:B100",
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

module.exports = { getConfig, ensureConfigDefaults };

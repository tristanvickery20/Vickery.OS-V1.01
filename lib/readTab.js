const { getSheetsClient } = require("./sheets");

function parseISODateSafe(value) {
  if (!value) return null;
  const d = new Date(String(value));
  return isNaN(d.getTime()) ? null : d;
}

function normalizeStr(value) {
  return String(value || "").toLowerCase().trim();
}

function safeNum(value) {
  if (value == null || value === "") return null;
  const n = Number(value);
  return isNaN(n) ? null : n;
}

async function readTab(tabName) {
  const sheets = await getSheetsClient();
  const spreadsheetId = process.env.CRM_SHEET_ID;
  if (!spreadsheetId) return [];

  let values = [];
  try {
    const resp = await sheets.spreadsheets.values.get({
      spreadsheetId,
      range: `${tabName}!A1:AZ5000`,
    });
    values = resp.data.values || [];
  } catch {
    return [];
  }

  if (values.length <= 1) return [];

  const headers = values[0].map((h) => String(h || "").trim());
  return values.slice(1)
    .filter((r) => r && r.length && String(r[0] || "").trim() !== "")
    .map((row) => {
      const obj = {};
      for (let i = 0; i < headers.length; i++) {
        obj[headers[i]] = row[i] != null ? String(row[i]) : "";
      }
      return obj;
    });
}

module.exports = { readTab, parseISODateSafe, normalizeStr, safeNum };

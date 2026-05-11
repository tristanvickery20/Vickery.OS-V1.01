// api/seed-quote.js — GET /admin/seed-quote?token=XXXX
// Idempotent seeder for V2 CRM tabs (ServiceAreas, SchedulerRules).
// V1 tabs (JobTypes, Questions, AnswerOptions, AddOns, Rates) have been removed
// from the CRM schema and are no longer seeded here.

const { getSheetsClient }  = require("../lib/sheets");
const { ensureTabHeaders }  = require("../lib/sheetsSchema");
const { SA_H, SERVICE_AREAS, SCHED_H, SCHED } = require("../lib/quoteSeedData");

const ID = () => process.env.CRM_SHEET_ID;

function json(res, status, payload) {
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(JSON.stringify(payload, null, 2));
}

// Write a single data row (row 2) to a tab — used for SchedulerRules.
async function writeRow2(sheets, tabName, headers, row) {
  const r = await sheets.spreadsheets.values.get({ spreadsheetId: ID(), range: `${tabName}!A1:1` });
  const sheetH = ((r.data.values || [[]])[0]).map(h => String(h).trim());
  const sheetRow = sheetH.map(h => { const i = headers.indexOf(h); return i >= 0 ? String(row[i]) : ""; });
  await sheets.spreadsheets.values.update({
    spreadsheetId: ID(), range: `${tabName}!A2`, valueInputOption: "RAW",
    requestBody: { majorDimension: "ROWS", values: [sheetRow] },
  });
  return { updated: 1 };
}

// Upsert rows by key column.
async function upsertRows(sheets, tabName, headers, rows, keyCol) {
  const r = await sheets.spreadsheets.values.get({ spreadsheetId: ID(), range: `${tabName}!A:Z` });
  const all      = r.data.values || [];
  const sheetH   = (all[0] || []).map(h => String(h).trim());
  const dataRows = all.slice(1).map(row => [...row]);

  const keySheetIdx = sheetH.indexOf(keyCol);
  const lookup = new Map();
  dataRows.forEach((row, i) => { const k = (row[keySheetIdx] || "").trim(); if (k) lookup.set(k, i); });

  let created = 0, updated = 0;
  const toAppend = [];

  for (const seedRow of rows) {
    const sheetRow = sheetH.map(h => { const i = headers.indexOf(h); return i >= 0 ? String(seedRow[i]) : ""; });
    const keyVal = String(seedRow[headers.indexOf(keyCol)]).trim();

    if (lookup.has(keyVal)) {
      dataRows[lookup.get(keyVal)] = sheetRow;
      updated++;
    } else {
      toAppend.push(sheetRow);
      created++;
    }
  }

  if (updated > 0 && dataRows.length > 0) {
    await sheets.spreadsheets.values.update({
      spreadsheetId: ID(), range: `${tabName}!A2`, valueInputOption: "RAW",
      requestBody: { majorDimension: "ROWS", values: dataRows },
    });
  }
  if (toAppend.length > 0) {
    await sheets.spreadsheets.values.append({
      spreadsheetId: ID(), range: `${tabName}!A:A`, valueInputOption: "RAW",
      insertDataOption: "INSERT_ROWS",
      requestBody: { majorDimension: "ROWS", values: toAppend },
    });
  }
  return { created, updated };
}

async function handleSeedQuote(req, res) {
  const token = new URL(req.url, "http://localhost").searchParams.get("token");
  if (!token || token !== process.env.ADMIN_SEED_TOKEN) {
    return json(res, 401, { ok: false, error: "Invalid or missing token." });
  }

  const sheets = await getSheetsClient();
  const upsertCounts = {};
  const warnings = [];

  // Ensure valid V2/CRM tabs have correct headers (creates tabs if missing).
  // V1 tabs (JobTypes, Questions, AnswerOptions, AddOns, Rates) are no longer managed here.
  const ENSURE_TABS = ["ServiceAreas", "SchedulerRules", "QuoteSnapshots", "Bookings"];
  for (const tab of ENSURE_TABS) {
    try {
      await ensureTabHeaders(tab);
    } catch (e) {
      warnings.push(`ensureTabHeaders(${tab}): ${e.message}`);
    }
  }

  try { upsertCounts.SchedulerRules = await writeRow2(sheets, "SchedulerRules", SCHED_H, SCHED); }
  catch (e) { warnings.push("SchedulerRules: " + e.message); }

  try { upsertCounts.ServiceAreas = await upsertRows(sheets, "ServiceAreas", SA_H, SERVICE_AREAS, "zip"); }
  catch (e) { warnings.push("ServiceAreas: " + e.message); }

  json(res, 200, { ok: true, upsertCounts, warnings });
}

module.exports = { handleSeedQuote };

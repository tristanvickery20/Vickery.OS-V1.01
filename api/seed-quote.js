// api/seed-quote.js — GET /admin/seed-quote?token=XXXX
// Idempotent seeder for V3 quote machine tabs.

const { getSheetsClient }  = require("../lib/sheets");
const { ensureTabHeaders }  = require("../lib/sheetsSchema");
const {
  RATE_H, RATES, SCHED_H, SCHED,
  JT_H, JOB_TYPES, SA_H, SERVICE_AREAS,
  Q_H, QUESTIONS, AO_H, ANSWER_OPTIONS,
  ADDON_H, ADD_ONS,
} = require("../lib/quoteSeedData");

const ID = () => process.env.CRM_SHEET_ID;

function json(res, status, payload) {
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(JSON.stringify(payload, null, 2));
}

// Write a single data row (row 2) to a tab — used for Rates + SchedulerRules.
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
    // Build a row in sheet-column order
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

  // Write updated existing rows
  if (updated > 0 && dataRows.length > 0) {
    await sheets.spreadsheets.values.update({
      spreadsheetId: ID(), range: `${tabName}!A2`, valueInputOption: "RAW",
      requestBody: { majorDimension: "ROWS", values: dataRows },
    });
  }
  // Append new rows
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
  const createdTabs = [];
  const upsertCounts = {};
  const warnings = [];

  // Ensure all tabs have correct headers (creates tabs if missing)
  const ENSURE_TABS = ["Rates","SchedulerRules","JobTypes","Questions","AnswerOptions","AddOns","ServiceAreas","QuoteSnapshots","Bookings"];
  for (const tab of ENSURE_TABS) {
    try {
      await ensureTabHeaders(tab);
    } catch (e) {
      warnings.push(`ensureTabHeaders(${tab}): ${e.message}`);
    }
  }

  // Seed single-row tables
  try { upsertCounts.Rates = await writeRow2(sheets, "Rates", RATE_H, RATES); }
  catch (e) { warnings.push("Rates: " + e.message); }

  try { upsertCounts.SchedulerRules = await writeRow2(sheets, "SchedulerRules", SCHED_H, SCHED); }
  catch (e) { warnings.push("SchedulerRules: " + e.message); }

  // Seed upsert tables
  const TABLES = [
    ["JobTypes",      JT_H,    JOB_TYPES,      "job_type_id"],
    ["ServiceAreas",  SA_H,    SERVICE_AREAS,  "zip"],
    ["Questions",     Q_H,     QUESTIONS,      "question_id"],
    ["AnswerOptions", AO_H,    ANSWER_OPTIONS, "option_id"],
    ["AddOns",        ADDON_H, ADD_ONS,        "addon_id"],
  ];

  for (const [tab, headers, rows, key] of TABLES) {
    try {
      upsertCounts[tab] = await upsertRows(sheets, tab, headers, rows, key);
    } catch (e) {
      warnings.push(`${tab}: ${e.message}`);
    }
  }

  json(res, 200, { ok: true, createdTabs, upsertCounts, warnings });
}

module.exports = { handleSeedQuote };

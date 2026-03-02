// lib/quoteSeedInit.js — Auto-seed V3 quote sheets on startup + health log

const { getSheetsClient }  = require("./sheets");
const { ensureTabHeaders }  = require("./sheetsSchema");
const { getQuoteConfig }    = require("./sheetsConfig");
const {
  RATE_H, RATES, SCHED_H, SCHED,
  JT_H, JOB_TYPES, SA_H, SERVICE_AREAS,
  Q_H, QUESTIONS, AO_H, ANSWER_OPTIONS,
  ADDON_H, ADD_ONS,
} = require("./quoteSeedData");

const ID = () => process.env.CRM_SHEET_ID;

// Write rows to a tab in sheet-column order (for empty tabs).
async function appendRows(sheets, tabName, headers, rows) {
  const r = await sheets.spreadsheets.values.get({ spreadsheetId: ID(), range: `${tabName}!A1:1` });
  const sheetH = ((r.data.values || [[]])[0]).map(h => String(h).trim());
  const values = rows.map(row =>
    sheetH.map(h => { const i = headers.indexOf(h); return i >= 0 ? String(row[i]) : ""; })
  );
  await sheets.spreadsheets.values.append({
    spreadsheetId: ID(), range: `${tabName}!A:A`, valueInputOption: "RAW",
    insertDataOption: "INSERT_ROWS",
    requestBody: { majorDimension: "ROWS", values },
  });
}

// Write a single config row to row 2.
async function writeRow2(sheets, tabName, headers, row) {
  const r = await sheets.spreadsheets.values.get({ spreadsheetId: ID(), range: `${tabName}!A1:1` });
  const sheetH = ((r.data.values || [[]])[0]).map(h => String(h).trim());
  const sheetRow = sheetH.map(h => { const i = headers.indexOf(h); return i >= 0 ? String(row[i]) : ""; });
  await sheets.spreadsheets.values.update({
    spreadsheetId: ID(), range: `${tabName}!A2`, valueInputOption: "RAW",
    requestBody: { majorDimension: "ROWS", values: [sheetRow] },
  });
}

// Check if JobTypes has any active rows. Seed everything if not.
async function seedQuoteSheetIfEmpty() {
  try {
    const sheets = await getSheetsClient();

    // Check for existing active JobTypes
    const resp = await sheets.spreadsheets.values.get({ spreadsheetId: ID(), range: "JobTypes!A1:I2000" });
    const allRows = resp.data.values || [];
    if (allRows.length > 1) {
      const hdrs = allRows[0].map(h => String(h).trim());
      const aIdx = hdrs.indexOf("active");
      const hasActive = allRows.slice(1).some(r => String(r[aIdx] || "").toLowerCase() === "true");
      if (hasActive) {
        console.log("[QuoteSeed] JobTypes populated — skipping auto-seed.");
        return;
      }
    }

    console.log("[QuoteSeed] No active JobTypes found — seeding V3 data...");

    for (const tab of ["Rates","SchedulerRules","JobTypes","Questions","AnswerOptions","AddOns","ServiceAreas"]) {
      await ensureTabHeaders(tab).catch(() => {});
    }

    await writeRow2(sheets, "Rates",          RATE_H,  RATES);
    await writeRow2(sheets, "SchedulerRules", SCHED_H, SCHED);
    await appendRows(sheets, "JobTypes",      JT_H,    JOB_TYPES);
    await appendRows(sheets, "ServiceAreas",  SA_H,    SERVICE_AREAS);
    await appendRows(sheets, "Questions",     Q_H,     QUESTIONS);
    await appendRows(sheets, "AnswerOptions", AO_H,    ANSWER_OPTIONS);
    await appendRows(sheets, "AddOns",        ADDON_H, ADD_ONS);

    console.log(`[QuoteSeed] Done — seeded ${JOB_TYPES.length} job types, ${QUESTIONS.length} questions, ${ANSWER_OPTIONS.length} answer options.`);
  } catch (err) {
    console.error("[QuoteSeed] Auto-seed failed (non-fatal):", err.message);
  }
}

// Hardcoded segment/category for the standard 10 job types.
const SEG_CAT = {
  REPLACE_DEVICE:       { segment: "Residential", category: "Outlets & Switches" },
  ADD_OUTLET:           { segment: "Residential", category: "Outlets & Switches" },
  REPLACE_FIXTURE:      { segment: "Residential", category: "Lighting & Fans" },
  INSTALL_FAN:          { segment: "Residential", category: "Lighting & Fans" },
  REPLACE_BATH_FAN:     { segment: "Residential", category: "Ventilation" },
  SURGE_PROTECTOR:      { segment: "Residential", category: "Panel & Protection" },
  TROUBLESHOOT:         { segment: "Residential", category: "Diagnostics" },
  INSTALL_GFCI_BREAKER: { segment: "Residential", category: "Panel & Protection" },
  EV_CHARGER_STD:       { segment: "Residential", category: "EV Charging" },
  PANEL_LABEL:          { segment: "Residential", category: "Panel & Protection" },
};

function colLetter(n) {
  let s = "";
  for (; n > 0; n = Math.floor((n - 1) / 26)) s = String.fromCharCode(65 + ((n - 1) % 26)) + s;
  return s;
}

// Fill in segment/category for any JobTypes rows that still have those columns empty.
async function backfillSegmentCategory() {
  try {
    const sheets = await getSheetsClient();
    const resp = await sheets.spreadsheets.values.get({ spreadsheetId: ID(), range: "JobTypes!A1:Z2000" });
    const allRows = resp.data.values || [];
    if (allRows.length < 2) return;

    const hdrs   = allRows[0].map(h => String(h).trim());
    const idIdx  = hdrs.indexOf("job_type_id");
    const segIdx = hdrs.indexOf("segment");
    const catIdx = hdrs.indexOf("category");
    if (segIdx < 0 || catIdx < 0) return;

    const data = [];
    allRows.slice(1).forEach((row, i) => {
      const jid = String(row[idIdx] || "").trim();
      const seg = String(row[segIdx] || "").trim();
      if (!seg && SEG_CAT[jid]) {
        const maxCol = Math.max(segIdx, catIdx) + 1;
        const updated = [...row];
        while (updated.length < maxCol) updated.push("");
        updated[segIdx] = SEG_CAT[jid].segment;
        updated[catIdx] = SEG_CAT[jid].category;
        data.push({ range: `JobTypes!A${i + 2}:${colLetter(maxCol)}${i + 2}`, values: [updated] });
      }
    });

    if (!data.length) { console.log("[SegmentBackfill] All rows already have segment/category."); return; }

    await sheets.spreadsheets.values.batchUpdate({
      spreadsheetId: ID(),
      requestBody: { valueInputOption: "RAW", data },
    });
    console.log(`[SegmentBackfill] Backfilled segment/category for ${data.length} job type(s).`);
  } catch (err) {
    console.error("[SegmentBackfill] Error (non-fatal):", err.message);
  }
}

// Log V3 health after config loads.
async function logQuoteHealth() {
  try {
    const config = await getQuoteConfig();
    const count = config.jobTypes?.length ?? 0;
    const rate  = config.rates?.crew_loaded_hourly ?? 0;
    console.log("V3 Quote Machine Active");
    console.log(`JobTypes loaded: ${count}`);
    console.log(`Crew rate: $${rate}/hr`);
    if (count === 0 || rate === 0) {
      console.warn("[QuoteHealth] WARNING: jobTypes or crew rate is zero — check sheet data.");
    }
  } catch (err) {
    console.error("[QuoteHealth] Health check failed:", err.message);
  }
}

module.exports = { seedQuoteSheetIfEmpty, backfillSegmentCategory, logQuoteHealth };

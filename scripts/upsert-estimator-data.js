// scripts/upsert-estimator-data.js
// Upserts modules and service question maps from lib/estimatorSeedData.js
// (single source of truth) into the V2 estimator Google Sheet.
// Run: node scripts/upsert-estimator-data.js
"use strict";

const { getSheetsClient } = require("../lib/sheets");
const { MODULES, SERVICES } = require("../lib/estimatorSeedData");

const SHEET_ID = process.env.ESTIMATOR_V2_SHEET_ID;
if (!SHEET_ID) { console.error("ESTIMATOR_V2_SHEET_ID not set"); process.exit(1); }

// ─── Helpers ──────────────────────────────────────────────────────────────────
function toRows(values) {
  if (!values || values.length < 1) return { headers: [], rows: [] };
  const [headers, ...data] = values;
  const rows = data.map((row, i) => ({
    _rowNum: i + 2,
    ...Object.fromEntries(headers.map((h, j) => [String(h).trim(), String(row[j] ?? "").trim()])),
  }));
  return { headers: headers.map(h => String(h).trim()), rows };
}

function colLetter(idx) {
  let s = "", n = idx;
  while (n >= 0) { s = String.fromCharCode(65 + (n % 26)) + s; n = Math.floor(n / 26) - 1; }
  return s;
}

// ─── Main ─────────────────────────────────────────────────────────────────────
async function main() {
  const sheets = await getSheetsClient();
  let modulesAdded = 0, modulesUpdated = 0, servicesUpdated = 0;

  // ── A) Upsert Estimator_Modules from MODULES (lib/estimatorSeedData.js) ──────
  const modResp = await sheets.spreadsheets.values.get({
    spreadsheetId: SHEET_ID, range: "Estimator_Modules!A1:Z2000",
  });
  const { headers: modHeaders, rows: modRows } = toRows(modResp.data.values);
  console.log(`\nEstimator_Modules: ${modRows.length} existing rows, headers: ${modHeaders.join(", ")}`);

  const midCol = modHeaders.indexOf("module_id");
  const qCol   = modHeaders.indexOf("question");
  const itCol  = modHeaders.indexOf("input_type");
  const ojCol  = modHeaders.indexOf("options_json");

  const existingModMap = {};
  modRows.forEach(r => { if (r.module_id) existingModMap[r.module_id] = r; });

  const updateRanges = [];
  const newModRows  = [];

  for (const mod of MODULES) {
    const oj       = JSON.stringify(JSON.parse(mod.options_json || "[]"));
    const existing = existingModMap[mod.module_id];

    if (existing) {
      let newQ = mod.question;
      if (existing.question && existing.question !== mod.question) {
        console.warn(`  [WARN] ${mod.module_id}: keeping existing question.`);
        newQ = existing.question;
      }
      const rowNum = existing._rowNum;
      updateRanges.push({ range: `Estimator_Modules!${colLetter(qCol)}${rowNum}`,  values: [[newQ]] });
      updateRanges.push({ range: `Estimator_Modules!${colLetter(itCol)}${rowNum}`, values: [[mod.input_type]] });
      updateRanges.push({ range: `Estimator_Modules!${colLetter(ojCol)}${rowNum}`, values: [[oj]] });
      modulesUpdated++;
    } else {
      const newRow = modHeaders.map(h => {
        if (h === "module_id")    return mod.module_id;
        if (h === "question")     return mod.question;
        if (h === "input_type")   return mod.input_type;
        if (h === "options_json") return oj;
        if (h === "applies_to")   return mod.applies_to || "all";
        if (h === "notes")        return mod.notes || "";
        return "";
      });
      newModRows.push(newRow);
      modulesAdded++;
    }
  }

  if (updateRanges.length) {
    await sheets.spreadsheets.values.batchUpdate({
      spreadsheetId: SHEET_ID,
      requestBody: { valueInputOption: "RAW", data: updateRanges },
    });
    console.log(`Updated ${modulesUpdated} existing modules.`);
  }
  if (newModRows.length) {
    await sheets.spreadsheets.values.append({
      spreadsheetId: SHEET_ID,
      range: "Estimator_Modules!A1",
      valueInputOption: "RAW",
      insertDataOption: "INSERT_ROWS",
      requestBody: { majorDimension: "ROWS", values: newModRows },
    });
    console.log(`Appended ${modulesAdded} new modules.`);
  }

  // ── B) Update Estimator_ServiceMatrix from SERVICES (lib/estimatorSeedData.js) ─
  const svcResp = await sheets.spreadsheets.values.get({
    spreadsheetId: SHEET_ID, range: "Estimator_ServiceMatrix!A1:Z2000",
  });
  const { headers: svcHeaders, rows: svcRows } = toRows(svcResp.data.values);
  console.log(`\nEstimator_ServiceMatrix: ${svcRows.length} services, headers: ${svcHeaders.join(", ")}`);

  const mcCol   = svcHeaders.indexOf("modules_csv");
  const tierCol = svcHeaders.indexOf("tier");
  const sidCol  = svcHeaders.indexOf("service_id");

  if (mcCol < 0)  { console.error("modules_csv column not found"); process.exit(1); }
  if (tierCol < 0){ console.error("tier column not found");        process.exit(1); }

  // Build lookup: service_id → seed definition
  const seedMap = {};
  SERVICES.forEach(s => { seedMap[s.service_id] = s; });

  const svcUpdates = [];
  for (const row of svcRows) {
    const sid  = row.service_id;
    if (!sid) continue;
    const seed = seedMap[sid];
    if (!seed) {
      console.warn(`  [SKIP] ${sid} not in estimatorSeedData.js — skipping.`);
      continue;
    }
    const rn = row._rowNum;
    svcUpdates.push({ range: `Estimator_ServiceMatrix!${colLetter(mcCol)}${rn}`,  values: [[seed.modules_csv]] });
    svcUpdates.push({ range: `Estimator_ServiceMatrix!${colLetter(tierCol)}${rn}`, values: [[seed.tier]] });
    console.log(`  ${sid} → ${seed.modules_csv.split(",").length}q [tier=${seed.tier}]`);
    servicesUpdated++;
  }

  if (svcUpdates.length) {
    await sheets.spreadsheets.values.batchUpdate({
      spreadsheetId: SHEET_ID,
      requestBody: { valueInputOption: "RAW", data: svcUpdates },
    });
  }

  console.log(`\n─── Summary ───`);
  console.log(`Source:            lib/estimatorSeedData.js (single source of truth)`);
  console.log(`Modules added:     ${modulesAdded}`);
  console.log(`Modules updated:   ${modulesUpdated}`);
  console.log(`Services updated:  ${servicesUpdated}`);
}

main().catch(err => { console.error("Script failed:", err.message); process.exit(1); });

// scripts/update-modules-v2.js
// Targeted updates to specific Estimator_Modules rows:
//   - CEILING_HEIGHT: split 12-18 ft range into 12-14 ft and 15-20 ft, remove Not Sure
//   - WALL_TYPE: remove "Not sure" option
//   - RECESSED_LIGHT_CEILING_TYPE: remove "Not sure" option
// Run: node scripts/update-modules-v2.js
"use strict";

const { getSheetsClient } = require("../lib/sheets");

const SHEET_ID = process.env.ESTIMATOR_V2_SHEET_ID;
if (!SHEET_ID) { console.error("ESTIMATOR_V2_SHEET_ID not set"); process.exit(1); }

const UPDATES = {
  CEILING_HEIGHT: [
    { value: "lt9",    label: "Under 9 ft",   multiplier: 1.0 },
    { value: "9_12",   label: "9–12 ft",       multiplier: 1.1 },
    { value: "12_14",  label: "12–14 ft",      multiplier: 1.3 },
    { value: "15_20",  label: "15–20 ft",      multiplier: 1.6 },
    { value: "gt20",   label: "Over 20 ft",    disqualify: true },
  ],
  WALL_TYPE: [
    { value: "drywall", label: "Drywall",          multiplier: 1.0 },
    { value: "plaster", label: "Plaster",          multiplier: 1.3 },
    { value: "brick",   label: "Brick / masonry",  disqualify: true },
    { value: "tile",    label: "Tile",             multiplier: 1.5 },
    { value: "wood",    label: "Wood / paneling",  multiplier: 1.15 },
  ],
  RECESSED_LIGHT_CEILING_TYPE: [
    { value: "drywall", label: "Drywall",       multiplier: 1.0 },
    { value: "plaster", label: "Plaster",       multiplier: 1.3 },
    { value: "drop",    label: "Drop ceiling",  multiplier: 1.15 },
    { value: "wood",    label: "Wood",          multiplier: 1.15 },
  ],
};

async function main() {
  const sheets = await getSheetsClient();

  const resp = await sheets.spreadsheets.values.get({
    spreadsheetId: SHEET_ID,
    range: "Estimator_Modules!A:Z",
  });

  const rows = resp.data.values || [];
  if (!rows.length) { console.error("No data in Estimator_Modules"); process.exit(1); }

  const headers = rows[0];
  const midIdx  = headers.indexOf("module_id");
  const optIdx  = headers.indexOf("options_json");
  if (midIdx < 0 || optIdx < 0) {
    console.error("Missing columns: module_id or options_json");
    process.exit(1);
  }

  const updateRequests = [];
  for (let r = 1; r < rows.length; r++) {
    const row = rows[r];
    const mid = row[midIdx];
    if (!mid || !UPDATES[mid]) continue;

    const newOptions = UPDATES[mid];
    const rowNum = r + 1; // 1-indexed sheet row
    const colLetter = String.fromCharCode(65 + optIdx);

    updateRequests.push({
      range: `Estimator_Modules!${colLetter}${rowNum}`,
      values: [[JSON.stringify(newOptions)]],
    });
    console.log(`Queued update: ${mid} — ${newOptions.length} options`);
  }

  if (!updateRequests.length) {
    console.log("No matching module_ids found — nothing to update.");
    return;
  }

  await sheets.spreadsheets.values.batchUpdate({
    spreadsheetId: SHEET_ID,
    requestBody: {
      valueInputOption: "RAW",
      data: updateRequests,
    },
  });

  console.log(`Done — updated ${updateRequests.length} module(s).`);
}

main().catch(e => { console.error(e.message); process.exit(1); });

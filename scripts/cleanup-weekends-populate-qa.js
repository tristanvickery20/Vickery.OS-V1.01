// scripts/cleanup-weekends-populate-qa.js
// 1. Removes all bookings, leads, and QuoteSnapshots that fall on Sat/Sun
// 2. Populates realistic Q&A answers (selected_options_json) on remaining April bookings
// Run: node scripts/cleanup-weekends-populate-qa.js

const { getSheetsClient } = require("../lib/sheets");
const SHEET_ID = process.env.CRM_SHEET_ID;

// ── Q&A profiles by job type ──────────────────────────────────────────────────
// answers keys = estimator module IDs (resolved to human labels via modulesById)
// answers are varied for realism

const QA_PROFILES = {
  panel_upgrade:    (i) => ({ PROPERTY_TYPE: "residential", HOME_AGE: pick(["1960_1980","1980_2000","2000plus"], i), PANEL_SPACE: pick(["yes","limited","no"], i) }),
  outlet_install:   (i) => ({ PROPERTY_TYPE: "residential", HOME_AGE: pick(["1980_2000","2000plus"], i), WALL_TYPE: pick(["drywall","drywall","plaster"], i), CRAWLSPACE_ACCESS: pick(["yes","no"], i) }),
  ceiling_fan:      (i) => ({ PROPERTY_TYPE: "residential", HOME_AGE: pick(["1980_2000","2000plus"], i), CEILING_HEIGHT: pick(["standard","tall"], i), ATTIC_ACCESS: pick(["yes","partial"], i) }),
  ev_charger:       (i) => ({ PROPERTY_TYPE: pick(["residential","commercial"], i), HOME_AGE: "2000plus", PANEL_SPACE: pick(["yes","limited"], i) }),
  generator:        (i) => ({ PROPERTY_TYPE: "residential", HOME_AGE: pick(["1980_2000","2000plus"], i), PANEL_SPACE: pick(["yes","limited"], i) }),
  lighting:         (i) => ({ PROPERTY_TYPE: "residential", HOME_AGE: pick(["1980_2000","2000plus"], i), CEILING_HEIGHT: pick(["standard","standard","tall"], i), ATTIC_ACCESS: pick(["yes","partial","no"], i) }),
  wiring_repair:    (i) => ({ PROPERTY_TYPE: "residential", HOME_AGE: pick(["pre1960","1960_1980","1980_2000"], i) }),
  service_call:     (i) => ({ PROPERTY_TYPE: pick(["residential","commercial"], i), HOME_AGE: pick(["1960_1980","1980_2000","2000plus"], i) }),
  meter_base:       (i) => ({ PROPERTY_TYPE: "residential", HOME_AGE: pick(["1960_1980","1980_2000"], i) }),
  breaker_replace:  (i) => ({ PROPERTY_TYPE: "residential", HOME_AGE: pick(["1980_2000","2000plus"], i), PANEL_SPACE: pick(["yes","limited"], i) }),
  surge_protection: (i) => ({ PROPERTY_TYPE: pick(["residential","commercial"], i), HOME_AGE: "2000plus", PANEL_SPACE: "yes" }),
  smoke_detectors:  (i) => ({ PROPERTY_TYPE: "residential", HOME_AGE: pick(["1980_2000","2000plus"], i) }),
  bathroom_fan:     (i) => ({ PROPERTY_TYPE: "residential", HOME_AGE: pick(["1960_1980","1980_2000","2000plus"], i), ATTIC_ACCESS: pick(["yes","partial"], i) }),
  outdoor_lighting: (i) => ({ PROPERTY_TYPE: pick(["residential","commercial"], i), HOME_AGE: pick(["1980_2000","2000plus"], i) }),
  recessed_lights:  (i) => ({ PROPERTY_TYPE: "residential", HOME_AGE: pick(["1980_2000","2000plus"], i), CEILING_HEIGHT: pick(["standard","tall"], i), ATTIC_ACCESS: pick(["yes","partial","no"], i) }),
  transfer_switch:  (i) => ({ PROPERTY_TYPE: "residential", HOME_AGE: pick(["1960_1980","1980_2000"], i), PANEL_SPACE: pick(["yes","limited"], i) }),
};

function pick(arr, i) { return arr[i % arr.length]; }

function makeSelectedOptionsJson(jobTypeId, idx) {
  const profile = QA_PROFILES[jobTypeId] || ((i) => ({ PROPERTY_TYPE: "residential", HOME_AGE: "2000plus" }));
  const answers = profile(idx);
  return JSON.stringify({ answers, qty: 1, classification: "standard" });
}

async function getTab(sheets, tab) {
  const r = await sheets.spreadsheets.values.get({ spreadsheetId: SHEET_ID, range: `${tab}!A:Z` });
  const rows = r.data.values || [];
  return { headers: rows[0] || [], rows: rows.slice(1) };
}

async function writeAllRows(sheets, tab, headers, dataRows) {
  await sheets.spreadsheets.values.update({
    spreadsheetId: SHEET_ID,
    range: `${tab}!A1`,
    valueInputOption: "RAW",
    requestBody: { majorDimension: "ROWS", values: [headers, ...dataRows] },
  });
  // Clear any extra rows that may exist beyond what we wrote
  const endRow = 1 + dataRows.length + 1;
  await sheets.spreadsheets.values.clear({
    spreadsheetId: SHEET_ID,
    range: `${tab}!A${endRow}:Z10000`,
  }).catch(() => {});
}

function isWeekend(dt) {
  if (!dt) return false;
  const d = new Date(dt.includes("T") ? dt : dt + "T00:00:00");
  const dow = d.getDay();
  return dow === 0 || dow === 6;
}

async function main() {
  console.log("\n🧹 Weekend Cleanup + Q&A Population");
  console.log("════════════════════════════════════\n");

  const sheets = await getSheetsClient();

  // ── 1. Load all three tabs ─────────────────────────────────────────────────
  console.log("Loading Bookings, Leads, QuoteSnapshots...");
  const bk = await getTab(sheets, "Bookings");
  const ld = await getTab(sheets, "Leads");
  const qs = await getTab(sheets, "QuoteSnapshots");

  const bkHdrs = bk.headers;
  const ldHdrs = ld.headers;
  const qsHdrs = qs.headers;

  const bkDtIdx  = bkHdrs.indexOf("scheduled_datetime");
  const bkIdIdx  = bkHdrs.indexOf("booking_id");
  const bkQidIdx = bkHdrs.indexOf("quote_id");
  const bkJtIdx  = bkHdrs.indexOf("job_type_id");

  const ldIdIdx  = ldHdrs.indexOf("id");
  const qsQidIdx = qsHdrs.indexOf("quote_id");
  const qsSojIdx = qsHdrs.indexOf("selected_options_json");

  // ── 2. Identify weekend booking IDs and quote IDs ─────────────────────────
  const weekendBkIds  = new Set();
  const weekendQids   = new Set();

  for (const row of bk.rows) {
    const dt   = row[bkDtIdx] || "";
    const bkId = row[bkIdIdx] || "";
    const qid  = row[bkQidIdx] || "";
    if (bkId.startsWith("BK-APR26-") && isWeekend(dt)) {
      weekendBkIds.add(bkId);
      if (qid) weekendQids.add(qid);
    }
  }
  console.log(`\nWeekend bookings to remove: ${weekendBkIds.size}`);
  console.log(`Weekend QuoteSnapshots/Leads to remove: ${weekendQids.size}`);

  // ── 3. Filter out weekend rows ─────────────────────────────────────────────
  const newBkRows = bk.rows.filter(r => !weekendBkIds.has(r[bkIdIdx] || ""));
  const newLdRows = ld.rows.filter(r => {
    const id = r[ldIdIdx] || "";
    // Remove leads whose ID maps to a weekend booking (LEAD-APR26-NNN format)
    if (!id.startsWith("LEAD-APR26-")) return true;
    // Derive the quote id from the lead (LEAD-APR26-010 → QS-APR26-010)
    const derivedQid = id.replace("LEAD-", "QS-");
    return !weekendQids.has(derivedQid);
  });
  const newQsRows = qs.rows.filter(r => {
    const qid = r[qsQidIdx] || "";
    return !weekendQids.has(qid);
  });

  console.log(`\nBookings: ${bk.rows.length} → ${newBkRows.length} (removed ${bk.rows.length - newBkRows.length})`);
  console.log(`Leads:    ${ld.rows.length} → ${newLdRows.length} (removed ${ld.rows.length - newLdRows.length})`);
  console.log(`Snapshots:${qs.rows.length} → ${newQsRows.length} (removed ${qs.rows.length - newQsRows.length})`);

  // ── 4. Populate Q&A for remaining April QuoteSnapshots ────────────────────
  let qaUpdated = 0;
  const keepQids = new Set(newBkRows.map(r => r[bkQidIdx]).filter(Boolean));
  const jobTypeByQid = {};
  for (const row of newBkRows) {
    const qid = row[bkQidIdx] || "";
    const jt  = row[bkJtIdx]  || "";
    if (qid) jobTypeByQid[qid] = jt;
  }

  let aprIdx = 0;
  for (const row of newQsRows) {
    const qid = row[qsQidIdx] || "";
    if (!qid.startsWith("QS-APR26-")) continue;
    if (!keepQids.has(qid)) continue;
    const jt = jobTypeByQid[qid] || "service_call";
    const currentSoj = (row[qsSojIdx] || "").trim();
    // Only update if currently empty/trivial
    const isEmpty = !currentSoj || currentSoj === "{}" || currentSoj === "[]" || currentSoj === '{"answers":{}}';
    if (isEmpty) {
      row[qsSojIdx] = makeSelectedOptionsJson(jt, aprIdx);
      qaUpdated++;
    }
    aprIdx++;
  }
  console.log(`\nQ&A populated for ${qaUpdated} April QuoteSnapshots`);

  // ── 5. Write back all three tabs ──────────────────────────────────────────
  console.log("\nWriting Bookings...");
  await writeAllRows(sheets, "Bookings", bkHdrs, newBkRows);
  console.log("Writing Leads...");
  await writeAllRows(sheets, "Leads", ldHdrs, newLdRows);
  console.log("Writing QuoteSnapshots...");
  await writeAllRows(sheets, "QuoteSnapshots", qsHdrs, newQsRows);

  console.log("\n✅ Done!");
  console.log(`   Removed ${bk.rows.length - newBkRows.length} weekend bookings`);
  console.log(`   ${newBkRows.length} weekday bookings remain`);
  console.log(`   ${qaUpdated} April QuoteSnapshots now have Q&A answers\n`);
}

main().catch(err => {
  console.error("\n❌ Failed:", err.message);
  process.exit(1);
});

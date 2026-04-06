/**
 * Vickery Electric — Nightly Actuals Rollup
 * Google Apps Script — paste this into the Google Sheet's Script Editor
 * (Extensions → Apps Script), then set a time-based trigger to run
 * computeAndSaveActuals() nightly (e.g. between 1–2 AM).
 *
 * HOW TO SET UP THE TRIGGER:
 *   1. In Apps Script, click "Triggers" (clock icon in left sidebar)
 *   2. Click "+ Add Trigger"
 *   3. Function: computeAndSaveActuals
 *      Deployment: Head
 *      Event source: Time-driven
 *      Type: Day timer
 *      Time: 1am – 2am
 *   4. Click Save
 *
 * WHAT IT DOES:
 *   Reads Leads, Time, TimeEntries, and Expenses tabs from this spreadsheet.
 *   Computes actual job mix, average hours per job size, average material cost,
 *   and crew utilization for completed jobs in the past WINDOW_DAYS.
 *   Writes results as "actual_*" keys to the Config tab.
 *   These are then read by the Profit Calculator to show Targets vs. Actuals.
 */

var WINDOW_DAYS     = 30;   // how many days back to look
var COMPLETE_STATUS = ["complete", "paid", "closed"];

// ─── Entry point ──────────────────────────────────────────────────────────────
function computeAndSaveActuals() {
  var ss       = SpreadsheetApp.getActiveSpreadsheet();
  var windowMs = WINDOW_DAYS * 24 * 60 * 60 * 1000;
  var cutoff   = new Date(Date.now() - windowMs);

  // Read tabs
  var leads        = readTab(ss, "Leads");
  var timeEntries  = readTimeSources(ss);
  var expenses     = readTab(ss, "Expenses");

  // Filter to completed jobs in window
  var completedLeads = leads.filter(function(r) {
    var status = (r.status || "").toLowerCase().trim();
    if (COMPLETE_STATUS.indexOf(status) < 0) return false;
    var d = pickDate(r);
    return d && d >= cutoff;
  });

  // Index time by lead_id (total minutes)
  var timeByLead = {};
  timeEntries.forEach(function(t) {
    var lid = t.lead_id;
    if (!lid) return;
    timeByLead[lid] = (timeByLead[lid] || 0) + (t.minutes || 0);
  });

  // Index material expenses by lead_id
  var matByLead = {};
  expenses.forEach(function(e) {
    var lid  = e.lead_id;
    var type = (e.type || "").toLowerCase();
    var cat  = (e.category || "").toLowerCase();
    if (!lid) return;
    if (!type.includes("material") && !cat.includes("material")) return;
    matByLead[lid] = (matByLead[lid] || 0) + toNum(e.amount);
  });

  // Bucket by revenue size
  var buckets = { small: [], medium: [], large: [] };
  var totalHours = 0;

  completedLeads.forEach(function(row) {
    var revenue = toNum(row.quoted_price) || toNum(row.estimated_value);
    var bucket  = revenue < 300 ? "small" : revenue < 1000 ? "medium" : "large";
    var lid     = row.id;
    var hrs     = (timeByLead[lid] || 0) / 60;
    var mat     = matByLead[lid] || 0;
    buckets[bucket].push({ hours: hrs, mat: mat });
    totalHours += hrs;
  });

  var total       = completedLeads.length;
  var smallCount  = buckets.small.length;
  var mediumCount = buckets.medium.length;
  var largeCount  = buckets.large.length;

  function pct(n)  { return total > 0 ? Math.round((n / total) * 100) : 0; }
  function avg(arr, fn) { return arr.length ? arr.reduce(function(s,x){return s+fn(x);},0)/arr.length : 0; }

  // Utilization
  var cfg            = readConfigMap(ss);
  var numJ           = toNum(cfg.numJourneymen   || "1");
  var numA           = toNum(cfg.numApprentices  || "0");
  var workers        = Math.max(1, numJ + numA);
  var potentialHours = workers * 8 * 5 * (WINDOW_DAYS / 7);
  var utilPct        = potentialHours > 0
    ? Math.min(100, Math.round((totalHours / potentialHours) * 100))
    : 87;

  // Build actuals map
  var actuals = {
    "actual_utilizationPct":      utilPct,
    "actual_smallJobMix":         pct(smallCount),
    "actual_mediumJobMix":        pct(mediumCount),
    "actual_largeJobMix":         pct(largeCount),
    "actual_smallJobHours":       round1(avg(buckets.small,  function(x){return x.hours;})),
    "actual_mediumJobHours":      round1(avg(buckets.medium, function(x){return x.hours;})),
    "actual_largeJobHours":       round1(avg(buckets.large,  function(x){return x.hours;})),
    "actual_smallJobMaterials":   round2(avg(buckets.small,  function(x){return x.mat;})),
    "actual_mediumJobMaterials":  round2(avg(buckets.medium, function(x){return x.mat;})),
    "actual_largeJobMaterials":   round2(avg(buckets.large,  function(x){return x.mat;})),
    "actual_jobCount":            total,
    "actual_windowDays":          WINDOW_DAYS,
    "actual_lastUpdated":         new Date().toISOString(),
  };

  writeConfigKeys(ss, actuals);
  Logger.log("[Actuals] Updated " + Object.keys(actuals).length + " keys. " + total + " completed jobs in last " + WINDOW_DAYS + " days.");
}

// ─── Read helpers ─────────────────────────────────────────────────────────────
function readTab(ss, tabName) {
  var sheet = ss.getSheetByName(tabName);
  if (!sheet) return [];
  var data = sheet.getDataRange().getValues();
  if (data.length < 2) return [];
  var headers = data[0].map(function(h){ return String(h).trim(); });
  return data.slice(1).map(function(row) {
    var obj = {};
    headers.forEach(function(h, i){ obj[h] = String(row[i] || "").trim(); });
    return obj;
  });
}

function readTimeSources(ss) {
  // Prefer TimeEntries (has "hours" column); fall back to Time (has "minutes")
  var te = readTab(ss, "TimeEntries");
  var tf = readTab(ss, "Time");
  var source = te.length > 0 ? te : tf;
  return source.map(function(row) {
    var lid = row.lead_id;
    if (!lid) return null;
    var mins = 0;
    if (row.hours !== undefined && row.hours !== "") {
      mins = toNum(row.hours) * 60;
    } else if (row.minutes !== undefined && row.minutes !== "") {
      mins = toNum(row.minutes);
    }
    return { lead_id: lid, minutes: mins };
  }).filter(Boolean);
}

function readConfigMap(ss) {
  var sheet = ss.getSheetByName("Config");
  if (!sheet) return {};
  var data = sheet.getDataRange().getValues();
  var map = {};
  for (var i = 1; i < data.length; i++) {
    var k = String(data[i][0] || "").trim();
    var v = String(data[i][1] || "").trim();
    if (k) map[k] = v;
  }
  return map;
}

// ─── Write helpers ────────────────────────────────────────────────────────────
function writeConfigKeys(ss, map) {
  var sheet = ss.getSheetByName("Config");
  if (!sheet) return;

  var data = sheet.getDataRange().getValues();
  // Build key → row index (1-based, row 1 = header)
  var keyToRow = {};
  for (var i = 1; i < data.length; i++) {
    var k = String(data[i][0] || "").trim();
    if (k) keyToRow[k] = i + 1; // 1-indexed sheet row
  }

  var toAppend = [];
  Object.keys(map).forEach(function(k) {
    var v = String(map[k]);
    if (keyToRow[k]) {
      sheet.getRange(keyToRow[k], 2).setValue(v);
    } else {
      toAppend.push([k, v]);
    }
  });

  if (toAppend.length > 0) {
    var lastRow = sheet.getLastRow();
    sheet.getRange(lastRow + 1, 1, toAppend.length, 2).setValues(toAppend);
  }

  SpreadsheetApp.flush();
}

// ─── Utility ──────────────────────────────────────────────────────────────────
function toNum(v) {
  var n = parseFloat(String(v || "").replace(/[^0-9.-]/g, ""));
  return isFinite(n) ? n : 0;
}
function round1(n) { return Math.round(n * 10) / 10; }
function round2(n) { return Math.round(n * 100) / 100; }

function pickDate(row) {
  var s = row.paid_date || row.invoice_date || row.scheduled_date || "";
  if (!s) return null;
  var d = new Date(s);
  return isNaN(d.getTime()) ? null : d;
}

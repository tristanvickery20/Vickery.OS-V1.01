// scripts/seed-test-data.js
// Clears all CRM test data and seeds 4 clean test records.
// Run: node scripts/seed-test-data.js

const { getSheetsClient } = require("../lib/sheets");

const SHEET_ID = process.env.CRM_SHEET_ID;

// ── Test records ─────────────────────────────────────────────────────────────
// All share same phone per tester request. Unique names/addresses/statuses.
const PHONE = "4096580797";

const NOW = new Date().toISOString();
function daysAgo(n) {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d.toISOString();
}
function daysFromNow(n) {
  const d = new Date();
  d.setDate(d.getDate() + n);
  return d.toISOString().slice(0, 10);
}

const TEST_LEADS = [
  {
    id: "LEAD-TEST-001",
    created_at: daysAgo(3),
    name: "John Test",
    phone: PHONE,
    address: "123 Main St, Orange, TX 77630",
    job_type: "small_job",
    deposit_required: "false",
    estimated_value: "450",
    status: "Estimate Sent",
    quoted_price: "450",
    deposit_received: "0",
    invoiced_amount: "0",
    paid_amount: "0",
    scheduled_date: "",
    assigned_to: "",
    notes: "Test record 1 — generator inspection",
    schedule_window: "",
    schedule_preference: "",
    duration_minutes: "120",
    deposit_override: "false",
    invoice_date: "",
    paid_date: "",
    pricing_version: "v2",
    last_quote_id: "QS-TEST-001",
    quote_snapshot_json: "",
    client_id: "",
    job_number: "JB-001",
  },
  {
    id: "LEAD-TEST-002",
    created_at: daysAgo(2),
    name: "Mary Test",
    phone: PHONE,
    address: "456 Oak Ave, Orange, TX 77630",
    job_type: "small_job",
    deposit_required: "false",
    estimated_value: "875",
    status: "Estimate Sent",
    quoted_price: "875",
    deposit_received: "0",
    invoiced_amount: "0",
    paid_amount: "0",
    scheduled_date: daysFromNow(2),
    assigned_to: "",
    notes: "Test record 2 — recessed lighting install",
    schedule_window: "Morning",
    schedule_preference: "",
    duration_minutes: "180",
    deposit_override: "false",
    invoice_date: "",
    paid_date: "",
    pricing_version: "v2",
    last_quote_id: "QS-TEST-002",
    quote_snapshot_json: "",
    client_id: "",
    job_number: "JB-002",
  },
  {
    id: "LEAD-TEST-003",
    created_at: daysAgo(5),
    name: "Bob Test",
    phone: PHONE,
    address: "789 Pine Dr, Vidor, TX 77662",
    job_type: "project",
    deposit_required: "true",
    estimated_value: "2500",
    status: "Scheduled",
    quoted_price: "2500",
    deposit_received: "500",
    invoiced_amount: "0",
    paid_amount: "0",
    scheduled_date: daysFromNow(4),
    assigned_to: "",
    notes: "Test record 3 — panel upgrade 200A",
    schedule_window: "Morning",
    schedule_preference: "",
    duration_minutes: "360",
    deposit_override: "false",
    invoice_date: "",
    paid_date: "",
    pricing_version: "v2",
    last_quote_id: "QS-TEST-003",
    quote_snapshot_json: "",
    client_id: "",
    job_number: "JB-003",
  },
  {
    id: "LEAD-TEST-004",
    created_at: daysAgo(1),
    name: "Sue Test",
    phone: PHONE,
    address: "321 Elm Blvd, Beaumont, TX 77701",
    job_type: "small_job",
    deposit_required: "false",
    estimated_value: "650",
    status: "Estimate Sent",
    quoted_price: "650",
    deposit_received: "0",
    invoiced_amount: "0",
    paid_amount: "0",
    scheduled_date: "",
    assigned_to: "",
    notes: "Test record 4 — outlet install and GFCI",
    schedule_window: "",
    schedule_preference: "",
    duration_minutes: "90",
    deposit_override: "false",
    invoice_date: "",
    paid_date: "",
    pricing_version: "v2",
    last_quote_id: "QS-TEST-004",
    quote_snapshot_json: "",
    client_id: "",
    job_number: "JB-004",
  },
];

// Quote snapshots (locked) for the money widget
const TEST_QUOTES = [
  ["QS-TEST-001", daysAgo(3), "LEAD-TEST-001", "generator_install", "v2", "450", "{}"],
  ["QS-TEST-002", daysAgo(2), "LEAD-TEST-002", "recessed_lights",   "v2", "875", "{}"],
  ["QS-TEST-003", daysAgo(5), "LEAD-TEST-003", "panel_upgrade",     "v2", "2500", "{}"],
  ["QS-TEST-004", daysAgo(1), "LEAD-TEST-004", "outlet_install",    "v2", "650", "{}"],
];

// ── Tabs to clear (keeps header row, wipes all data rows) ─────────────────────
const TABS_TO_CLEAR = [
  "Leads", "Quotes", "QuoteSnapshots", "Bookings",
  "Clients", "Properties", "Requests", "Jobs", "Visits",
  "Time", "Expenses", "Leads_QuoteSnapshots",
];

async function clearTab(sheets, tabName) {
  try {
    const resp = await sheets.spreadsheets.values.get({
      spreadsheetId: SHEET_ID,
      range: `${tabName}!A1:1`,
    });
    const headers = (resp.data.values && resp.data.values[0]) || [];
    if (headers.length === 0) {
      console.log(`  [${tabName}] no headers found — skipping`);
      return;
    }

    // Clear everything from row 2 down
    await sheets.spreadsheets.values.clear({
      spreadsheetId: SHEET_ID,
      range: `${tabName}!A2:ZZ`,
    });
    console.log(`  [${tabName}] cleared ✓`);
  } catch (err) {
    if (err.message && err.message.includes("Unable to parse range")) {
      console.log(`  [${tabName}] tab not found — skipping`);
    } else {
      console.warn(`  [${tabName}] error: ${err.message}`);
    }
  }
}

async function getTabHeaders(sheets, tabName) {
  const resp = await sheets.spreadsheets.values.get({
    spreadsheetId: SHEET_ID,
    range: `${tabName}!A1:1`,
  });
  return (resp.data.values && resp.data.values[0]) || [];
}

async function appendRows(sheets, tabName, rows) {
  await sheets.spreadsheets.values.append({
    spreadsheetId: SHEET_ID,
    range: `${tabName}!A:A`,
    valueInputOption: "RAW",
    insertDataOption: "INSERT_ROWS",
    requestBody: { majorDimension: "ROWS", values: rows },
  });
}

async function main() {
  console.log("\n🧹 CRM Test Data Seed Script");
  console.log("═══════════════════════════════");

  const sheets = await getSheetsClient();

  // 1. Clear all tabs
  console.log("\n1. Clearing data from all tabs...");
  for (const tab of TABS_TO_CLEAR) {
    await clearTab(sheets, tab);
  }

  // 2. Seed Leads
  console.log("\n2. Seeding Leads...");
  const leadsHeaders = await getTabHeaders(sheets, "Leads");
  const leadsRows = TEST_LEADS.map(lead => {
    return leadsHeaders.map(h => String(lead[h] ?? ""));
  });
  await appendRows(sheets, "Leads", leadsRows);
  console.log(`  Inserted ${leadsRows.length} test leads ✓`);

  // 3. Seed QuoteSnapshots (locked event for each quote — so money widget sees them)
  // NOTE: We do NOT seed the Quotes tab. The new quote engine writes to QuoteSnapshots
  // only. Seeding both tabs with the same quote_ids would cause double-counting.
  console.log("\n3. Seeding QuoteSnapshots...");
  const snapHeaders = await getTabHeaders(sheets, "QuoteSnapshots");
  const snapRows = TEST_LEADS.map((lead, i) => {
    const qid = `QS-TEST-00${i + 1}`;
    const obj = {
      event_id:             `EVT-TEST-00${i + 1}`,
      quote_id:             qid,
      created_at:           lead.created_at,
      event_type:           "locked",
      job_type_id:          lead.job_type,
      selected_options_json: "{}",
      selected_addons_json:  "[]",
      total_hours:          "",
      labor_cost:            "",
      overhead_cost:         "",
      material_allowance:    "",
      travel_fee:            "0",
      final_price:           lead.quoted_price,
      address_provided:      lead.address,
      pricing_version:       "v2",
      status:                lead.status,
      customer_name:         lead.name,
      phone:                 lead.phone,
      email:                 "",
      address:               lead.address,
      notes:                 lead.notes,
    };
    return snapHeaders.map(h => String(obj[h] ?? ""));
  });
  await appendRows(sheets, "QuoteSnapshots", snapRows);
  console.log(`  Inserted ${snapRows.length} quote snapshots ✓`);

  console.log("\n✅ Done! Test data seeded successfully.");
  console.log("   Test 1: John Test  — 123 Main St, Orange TX       — $450");
  console.log("   Test 2: Mary Test  — 456 Oak Ave, Orange TX       — $875");
  console.log("   Test 3: Bob Test   — 789 Pine Dr, Vidor TX        — $2,500");
  console.log("   Test 4: Sue Test   — 321 Elm Blvd, Beaumont TX    — $650");
  console.log("   All phone: 4096580797\n");
}

main().catch(err => {
  console.error("\n❌ Seed failed:", err.message);
  process.exit(1);
});

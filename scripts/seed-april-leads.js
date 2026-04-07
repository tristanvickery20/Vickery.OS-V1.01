// scripts/seed-april-leads.js
// Reads the existing April 2026 bookings and creates matching Leads + QuoteSnapshots
// so every booking has a proper lead record and quoted price behind it.
// Run: node scripts/seed-april-leads.js

const { getSheetsClient } = require("../lib/sheets");

const SHEET_ID = process.env.CRM_SHEET_ID;

async function getHeaders(sheets, tab) {
  const r = await sheets.spreadsheets.values.get({ spreadsheetId: SHEET_ID, range: `${tab}!A1:1` });
  return (r.data.values && r.data.values[0]) || [];
}
async function getAllRows(sheets, tab) {
  const r = await sheets.spreadsheets.values.get({ spreadsheetId: SHEET_ID, range: `${tab}!A:Z` });
  const rows = r.data.values || [];
  const headers = rows[0] || [];
  return { headers, rows: rows.slice(1) };
}
async function appendRows(sheets, tab, rows) {
  await sheets.spreadsheets.values.append({
    spreadsheetId: SHEET_ID,
    range: `${tab}!A:A`,
    valueInputOption: "RAW",
    insertDataOption: "INSERT_ROWS",
    requestBody: { majorDimension: "ROWS", values: rows },
  });
}

const JOB_TYPE_LABELS = {
  panel_upgrade: "Panel Upgrade",
  outlet_install: "Outlet Installation",
  ceiling_fan: "Ceiling Fan",
  ev_charger: "EV Charger",
  generator: "Generator",
  lighting: "Lighting",
  wiring_repair: "Wiring Repair",
  service_call: "Service Call",
  meter_base: "Meter Base",
  breaker_replace: "Breaker Replacement",
  surge_protection: "Surge Protection",
  smoke_detectors: "Smoke Detectors",
  bathroom_fan: "Bathroom Fan",
  outdoor_lighting: "Outdoor Lighting",
  recessed_lights: "Recessed Lights",
  transfer_switch: "Transfer Switch",
};

async function main() {
  console.log("\n📋 April 2026 — Creating Leads & QuoteSnapshots for bookings");
  console.log("══════════════════════════════════════════════════════════════");

  const sheets = await getSheetsClient();

  // Load existing bookings
  const { headers: bkHdrs, rows: bkRows } = await getAllRows(sheets, "Bookings");
  const bi = (h) => bkHdrs.indexOf(h);

  // Filter to April 2026 BK-APR26- bookings only
  const aprilBookings = bkRows.filter(r => (r[bi("booking_id")] || "").startsWith("BK-APR26-"));
  console.log(`\nFound ${aprilBookings.length} April bookings to process.`);

  // Load existing lead IDs so we don't duplicate
  const { rows: existingLeads } = await getAllRows(sheets, "Leads");
  const existingLeadIds = new Set(existingLeads.map(r => r[0]));

  // Load QuoteSnapshot headers
  const snapHdrs = await getHeaders(sheets, "QuoteSnapshots");
  const leadsHdrs = await getHeaders(sheets, "Leads");

  const newLeadRows = [];
  const newSnapRows = [];

  for (const bk of aprilBookings) {
    const bkId      = bk[bi("booking_id")] || "";
    const quoteId   = bk[bi("quote_id")]   || "";
    const createdAt = bk[bi("created_at")] || new Date().toISOString();
    const schedDt   = bk[bi("scheduled_datetime")] || "";
    const addr      = bk[bi("address")]    || "";
    const name      = bk[bi("customer_name")] || "";
    const phone     = bk[bi("phone")]      || "";
    const price     = bk[bi("final_price")] || "0";
    const jobTypeId = bk[bi("job_type_id")] || "service_call";
    const duration  = bk[bi("duration_minutes")] || "120";

    // Lead ID derived from booking
    const leadId = `LEAD-${bkId.replace("BK-", "")}`;
    if (existingLeadIds.has(leadId)) continue; // skip if already exists

    const schedDate = schedDt ? schedDt.slice(0, 10) : "";
    const jobNum = `JB-${leadId.replace("LEAD-APR26-", "")}`;

    // ── Build Lead record ────────────────────────────────────────────────
    const lead = {
      id: leadId,
      created_at: createdAt,
      name: name,
      phone: phone,
      address: addr,
      job_type: jobTypeId,
      deposit_required: "false",
      estimated_value: price,
      status: "Scheduled",
      quoted_price: price,
      deposit_received: "0",
      invoiced_amount: "0",
      paid_amount: "0",
      scheduled_date: schedDate,
      assigned_to: bk[bi("assigned_tech_id")] || "",
      notes: `April 2026 test — ${JOB_TYPE_LABELS[jobTypeId] || jobTypeId}`,
      schedule_window: bk[bi("schedule_block")] || "Morning",
      schedule_preference: "",
      duration_minutes: duration,
      deposit_override: "false",
      invoice_date: "",
      paid_date: "",
      pricing_version: "v2",
      last_quote_id: quoteId,
      quote_snapshot_json: "",
      client_id: "",
      job_number: jobNum,
    };
    newLeadRows.push(leadsHdrs.map(h => String(lead[h] ?? "")));

    // ── Build QuoteSnapshot record (locked) ──────────────────────────────
    const snap = {
      event_id:              `EVT-${bkId.replace("BK-", "")}`,
      quote_id:              quoteId,
      created_at:            createdAt,
      event_type:            "locked",
      job_type_id:           jobTypeId,
      selected_options_json: "{}",
      selected_addons_json:  "[]",
      total_hours:           "",
      labor_cost:            "",
      overhead_cost:         "",
      material_allowance:    "",
      travel_fee:            "0",
      final_price:           price,
      address_provided:      addr,
      pricing_version:       "v2",
      status:                "Scheduled",
      customer_name:         name,
      phone:                 phone,
      email:                 "",
      address:               addr,
      notes:                 `April 2026 test — ${JOB_TYPE_LABELS[jobTypeId] || jobTypeId}`,
    };
    newSnapRows.push(snapHdrs.map(h => String(snap[h] ?? "")));
  }

  if (newLeadRows.length === 0) {
    console.log("\n⚠️  No new leads to create (all already exist).");
    return;
  }

  // Insert in batches of 50 to avoid API limits
  const BATCH = 50;
  console.log(`\nInserting ${newLeadRows.length} leads...`);
  for (let i = 0; i < newLeadRows.length; i += BATCH) {
    await appendRows(sheets, "Leads", newLeadRows.slice(i, i + BATCH));
    process.stdout.write(`  ${Math.min(i + BATCH, newLeadRows.length)}/${newLeadRows.length} leads ✓\r`);
  }
  console.log(`\n  Done — ${newLeadRows.length} leads inserted ✓`);

  console.log(`\nInserting ${newSnapRows.length} QuoteSnapshots...`);
  for (let i = 0; i < newSnapRows.length; i += BATCH) {
    await appendRows(sheets, "QuoteSnapshots", newSnapRows.slice(i, i + BATCH));
    process.stdout.write(`  ${Math.min(i + BATCH, newSnapRows.length)}/${newSnapRows.length} snapshots ✓\r`);
  }
  console.log(`\n  Done — ${newSnapRows.length} snapshots inserted ✓`);

  console.log(`\n✅ All April bookings now have leads + quotes.`);
  console.log(`   Each lead: status=Scheduled, quoted price from booking`);
  console.log(`   Each snapshot: event_type=locked, matches booking quote_id\n`);
}

main().catch(err => {
  console.error("\n❌ Failed:", err.message);
  process.exit(1);
});

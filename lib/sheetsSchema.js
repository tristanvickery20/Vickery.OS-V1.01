// lib/sheetsSchema.js
// ARCHITECTURE NOTE (2026-05-11):
// - CRM sheet (CRM_SHEET_ID): Leads, TimeEntries, Expenses, Audit, Config,
//     Invoices, Payments, Notes, Attachments, QuoteSnapshots, Tasks, Events,
//     SchedulerRules
// - Estimator sheet (ESTIMATOR_V2_SHEET_ID): Assemblies, pricing, ServiceAreas
// - HR sheet (HR_SHEET_ID): Staff, Techs, all HR_* tabs
// - Marketing sheet (MARKETING_SHEET_ID): Reviews, Templates, ReferralLedger
// - Ops sheet (TRUCK_STOCK_ID): FleetVehicles, FleetMaintenance, ToolAssets,
//     ToolIssues, InventoryItems, TruckStock, MaterialRequests
const { getSheetsClient } = require("./sheets");

const SCHEMAS = {
  Leads: [
    "id", "created_at", "name", "phone", "address",
    "job_type", "deposit_required", "estimated_value", "status",
    "quoted_price", "deposit_received", "invoiced_amount", "paid_amount",
    "scheduled_date", "assigned_to", "notes",
    "schedule_window", "schedule_preference", "duration_minutes",
    "deposit_override",
    "invoice_date",
    "paid_date",
    "pricing_version",
    "last_quote_id",
    "quote_snapshot_json",
    "client_id",
    "job_number",
    "lead_source",
    "sms_opt_in",
    "sms_marketing_consent",
    // Google Calendar sync
    "gcal_event_id",
    // Referral attribution
    "referrer_name",
    "referrer_phone",
    // Job-site access (from quote flow)
    "attendance",           // yes_me | someone | no_phone
    "access_instructions",  // free-text access notes for unattended jobs
    // Booking columns (formerly Bookings tab)
    "booking_id",
    "booking_group_id",
    "schedule_block",
    "block_allocated_minutes",
    "is_continuation",
    "booking_status",
    // Traccar GPS
    "arrived_at",
    "arrived_lat",
    "arrived_lng",
    "departed_at",
    "job_duration_minutes",
    "customer_sms_sent_at",
    // Reschedule flow
    "reschedule_token",
    "reschedule_proposed_dt",
    "reschedule_status",
    "reschedule_requested_at",
    // Review engine (formerly on Clients tab)
    "review_status",
    "review_ask_sent_at",
    "review_reminder_sent_at",
    "last_followup_at",
    // Marketing fields
    "referring_customer",
    // Payment + financing status (CRM financial engine — see lib/paymentStatus.js)
    "payment_status",             // unpaid | deposit_required | deposit_paid | partially_paid | paid | cash_recorded | etc.
    "financing_status",           // not_offered | eligible | link_sent | approved | funded | etc.
    "pay_later_status",           // not_offered | eligible | link_sent | completed | etc.
    "financial_closeout_status",  // open | ready | closed | write_off
    "processing_fees_total",      // total card/Square fees recorded against this lead
    "financing_fees_total",       // total Wisetack/Afterpay fees recorded
    "net_collected",              // total_paid - processing_fees_total - financing_fees_total
    // UTM / attribution (Task #71)
    "utm_source",                 // e.g. google, facebook, yelp
    "utm_medium",                 // e.g. cpc, organic, referral
    "utm_campaign",               // campaign name slug
    "utm_content",                // ad variant or content label
    "gclid",                      // Google Click Identifier (auto-captured from ?gclid=)
    "landing_page",               // first URL the visitor landed on
    "tracking_phone",             // dynamic phone number shown on landing page
    "referrer_url",               // HTTP Referer header or document.referrer at quote start
    "estimator_session_id",       // quote_id or session token from the estimator
    // Lead quality
    "lead_quality_score",         // A | B | C — computed by lib/leadQualityScore.js
    "lost_reason",                // free-text or dropdown when lead is lost/declined
  ],
  Expenses: [
    "id", "created_at", "date", "tech_id", "lead_id",
    "type", "vendor", "amount", "notes", "receipt_url",
  ],
  Audit: [
    "audit_id", "created_at", "actor", "action", "entity_type",
    "entity_id", "field", "old_value", "new_value", "note",
    "source", "request_id",
  ],
  Config: [
    "key", "value",
  ],

  Notes: [
    "id", "created_at", "entity_type", "entity_id", "author", "body",
  ],
  Attachments: [
    "id", "created_at", "entity_type", "entity_id",
    "file_url", "file_type", "category", "uploaded_by",
  ],

  QuoteSnapshots: [
    "event_id", "quote_id", "created_at", "event_type", "job_type_id",
    "selected_options_json", "selected_addons_json", "total_hours",
    "labor_cost", "overhead_cost", "material_allowance", "travel_fee",
    "final_price", "address_provided", "pricing_version", "status",
    "customer_name", "phone", "email", "address", "notes",
    // Ops snapshot extensions (safe append)
    "lead_id",
    "booking_id",
    "client_id",
    "scheduled_datetime",
    "schedule_block",
    "assigned_tech_id",
    "assigned_tech_ids",
    "assigned_crew_names",
    "duration_minutes",
    "snapshot_json",
  ],
  SchedulerRules: [
    "timezone", "lead_time_hours", "buffer_minutes", "horizon_days",
    "workday_start", "workday_end", "saturday_start", "saturday_end",
    "sunday_enabled", "max_bookings_per_day",
    // Block capacity (safe append — defaults: 3 each)
    "morning_capacity",
    "afternoon_capacity",
    // Crew-hours capacity (safe append — default: 2 crew)
    "crew_size",                // number of crew members per block (default 2)
  ],

  // ─── Payment financial columns on Leads ──────────────────────────────────────
  // These are appended as safe-add columns; existing Leads rows are unaffected.
  // payment_status tracks regular payment progress (see lib/paymentStatus.js)
  // financing_status tracks Wisetack or future financing provider status
  // pay_later_status tracks Afterpay or future pay-later provider status
  // financial_closeout_status: open | ready | closed | write_off
  // (Leads schema continued above with booking columns etc.)

  // ─── Ticket 21 ───────────────────────────────────────────────────────────────
  Invoices: [
    "id",
    "created_at",
    "updated_at",
    "invoice_number",
    "status_code",
    "client_id",
    "property_id",
    "request_id",
    "job_id",
    "issued_at",
    "due_at",
    "subtotal",
    "tax_rate",
    "tax_amount",
    "total",
    "paid_amount",
    "balance_due",
    "deposit_applied",
    "notes",
    "snapshot_json",
    "sent_at",
    "paid_at",
    "void_at",
    // CRM-native financial engine fields (safe append)
    "lead_id",        // for invoices originating from the Leads model
    "provider_ref",   // external payment system reference (Square payment ID, etc.)
    "provider_name",  // which provider handled payment (square, square_afterpay, wisetack, cash)
    // Invoice system v2 (safe append)
    "public_token",         // 32-char hex token — enables /invoice/:token public page
    "line_items_json",      // JSON array of line items [{id,title,description,qty,unit_price,taxable,line_total}]
    "change_orders_json",   // JSON array of change orders [{id,description,amount,type,created_at,created_by}]
    "original_total",       // preserved original total before any change orders
    "booking_id",           // link to the Bookings row that generated this invoice
    "tech_name",            // technician name at time of invoice generation
    "service_date",         // date work was performed
    "customer_name",        // denormalized from client at creation time
    "customer_phone",       // denormalized — needed for SMS without extra lookups
    "sms_sent_at",          // when invoice SMS was last sent to customer
    "sms_sent_to",          // phone number SMS was sent to
    "email_sent_at",        // when invoice email was last sent
    "email_sent_to",        // email address email was sent to
  ],
  Payments: [
    "id",
    "created_at",
    "invoice_id",
    "lead_id",            // direct lead link (avoids invoice lookup for lead-level financial roll-up)
    "client_id",
    "payment_type",       // deposit | final_payment | progress_payment | refund | cash_payment | financing_payout | adjustment | write_off
    "payment_provider",   // square | square_afterpay | wisetack | cash | manual | other
    "payment_method",     // cash | card | tap_to_pay | apple_pay | google_pay | ach | payment_link | afterpay | wisetack | check
    "gross_amount",       // amount before fees
    "fee_amount",         // processing/financing fee
    "net_amount",         // gross_amount - fee_amount (what Vickery actually receives)
    "collected_by",       // tech_id or "admin"
    "received_at",        // timestamp when money was actually received
    "verified_at",        // timestamp when cash was verified (for cash payments)
    "external_reference_id", // Square payment ID, Wisetack ref, check number, etc.
    "reference",          // freeform reference/note from admin
    "note",
    "payment_date",       // date of payment (may differ from created_at)
    // Legacy compat
    "amount",             // kept for backward compat — mirrors gross_amount
    "method",             // kept for backward compat — mirrors payment_method
    "provider_ref",       // kept for backward compat (was QB external ref)
  ],

  Reviews: [
    "id", "created_at", "lead_id", "customer_name", "phone",
    "job_type", "city", "ask_sent_at", "ask_channel",
    "reminder_sent_at", "review_received_at",
    "star_rating", "review_text",
    "service_tag", "city_tag", "technician_tag",
    "complaint_flag", "response_status", "notes",
  ],

  Templates: [
    "id", "created_at", "updated_at", "name", "channel",
    "category", "body", "active",
  ],

  // Task #22 — universal task/event object (untimed commitments)
  Tasks: [
    "task_id", "title", "type", "due_date", "assigned_to",
    "related_lead_id", "priority", "notes", "status", "created_at", "created_by",
    // Task #23 — Google Calendar sync
    "gcal_event_id",  // format: "gcalEventId|calendarId"
  ],

  // Referral Center ledger
  ReferralLedger: [
    "id", "created_at", "updated_at",
    "referrer_name", "referrer_phone", "referrer_type",
    "employee_id", "referral_slug",
    "referee_name", "referee_phone", "referee_city", "referee_job_type",
    "lead_id", "status",
    "reward_amount", "reward_status", "reward_paid_at", "reward_method",
    "notes", "notified_at", "source",
  ],

  // Task #22 — timed calendar events (Meeting, Callback, Personal Block)
  Events: [
    "event_id", "title", "type", "start_datetime", "end_datetime",
    "assigned_to", "notes", "status", "created_at", "created_by",
    // Task #23 — Google Calendar sync
    "gcal_event_id",  // format: "gcalEventId|calendarId"
  ],

  // Bookings tab — used by the visual scheduler and crew portal
  // Positional columns written by schedule-book.js match this order;
  // additional columns are appended via ensureTabHeaders on startup.
  Bookings: [
    "booking_id",
    "quote_id",
    "created_at",
    "scheduled_datetime",
    "duration_minutes",
    "address",
    "customer_name",
    "status",
    "schedule_block",
    "job_type_id",
    "final_price",
    "phone",
    "email",
    "block_allocated_minutes",
    "booking_group_id",
    "is_continuation",
    // Extended columns — safe append
    "lead_id",
    "assigned_tech_id",
    "assigned_tech_ids",
    "assigned_crew_names",
    "notes",
    "arrived_at",
    "arrived_lat",
    "arrived_lng",
    "departed_at",
    "job_duration_minutes",
    "customer_sms_sent_at",
    "scope_of_work",
    "gcal_event_id",
  ],
};

async function ensureTabHeaders(tabName, sheetId) {
  const sheets = await getSheetsClient();
  const spreadsheetId = sheetId || process.env.CRM_SHEET_ID;
  if (!spreadsheetId) return;

  const expected = SCHEMAS[tabName];
  if (!expected) return;

  let existing = [];
  try {
    const resp = await sheets.spreadsheets.values.get({
      spreadsheetId,
      range: `${tabName}!1:1`,
    });
    existing = (resp.data.values && resp.data.values[0]) || [];
  } catch (err) {
    // If sheet doesn't exist, create it.
    if (err.code === 400 || (err.message && err.message.includes("Unable to parse range"))) {
      const meta = await sheets.spreadsheets.get({ spreadsheetId });
      const sheetNames = (meta.data.sheets || []).map((s) => s.properties.title);
      if (!sheetNames.includes(tabName)) {
        await sheets.spreadsheets.batchUpdate({
          spreadsheetId,
          requestBody: { requests: [{ addSheet: { properties: { title: tabName } } }] },
        });
        console.log(`Created new sheet tab: ${tabName}`);
      }

      // retry header read
      try {
        const resp2 = await sheets.spreadsheets.values.get({
          spreadsheetId,
          range: `${tabName}!1:1`,
        });
        existing = (resp2.data.values && resp2.data.values[0]) || [];
      } catch {
        existing = [];
      }
    } else {
      throw err;
    }
  }

  const existingClean = existing.map((h) => String(h || "").trim()).filter(Boolean);
  const missing = expected.filter((h) => !existingClean.includes(h));
  if (missing.length === 0) return;

  const newHeaders = [...existingClean, ...missing];
  await sheets.spreadsheets.values.update({
    spreadsheetId,
    range: `${tabName}!A1`,
    valueInputOption: "RAW",
    requestBody: { majorDimension: "ROWS", values: [newHeaders] },
  });

  console.log(`[${tabName}] Added missing headers: ${missing.join(", ")}`);
}

const _sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Tabs that live on the Marketing sheet instead of the CRM sheet
const MARKETING_TABS = new Set(["Reviews", "Templates", "ReferralLedger"]);

function _marketingId() {
  return process.env.MARKETING_SHEET_ID || null;
}

async function ensureAllHeaders() {
  const tabs = Object.keys(SCHEMAS);
  for (let i = 0; i < tabs.length; i++) {
    const tab = tabs[i];
    try {
      if (MARKETING_TABS.has(tab)) {
        const mktId = _marketingId();
        if (mktId) await ensureTabHeaders(tab, mktId);
      } else {
        await ensureTabHeaders(tab);
      }
    } catch (err) {
      console.error(`Header check error for ${tab} (non-fatal):`, err.message);
    }
    // Brief pause between tabs to avoid exhausting the Sheets read-quota on startup
    if (i < tabs.length - 1) await _sleep(400);
  }
}

/**
 * patchSchedulerRuleDefaults — run once at startup.
 * If lead_time_hours is "0" or blank in the live SchedulerRules sheet,
 * write "4" so all booking paths use a safe non-zero advance window.
 */
async function patchSchedulerRuleDefaults() {
  const sheets = await getSheetsClient();
  const id = process.env.CRM_SHEET_ID;
  if (!id) return;
  try {
    await ensureTabHeaders("SchedulerRules");
    const r = await sheets.spreadsheets.values.get({ spreadsheetId: id, range: "SchedulerRules!A1:J3" });
    const rows = r.data.values || [];
    if (rows.length < 2) return;
    const headers = rows[0] || [];
    const data    = rows[1] || [];
    const ltIdx   = headers.indexOf("lead_time_hours");
    if (ltIdx >= 0 && (data[ltIdx] === "0" || data[ltIdx] === "" || !data[ltIdx])) {
      const colLetter = String.fromCharCode(65 + ltIdx);
      await sheets.spreadsheets.values.update({
        spreadsheetId: id,
        range:         `SchedulerRules!${colLetter}2`,
        valueInputOption: "RAW",
        requestBody:   { majorDimension: "ROWS", values: [["4"]] },
      });
      console.log("[SchedulerRules] lead_time_hours patched 0→4 at startup.");
    }
  } catch (err) {
    console.error("[patchSchedulerRuleDefaults]", err.message);
  }
}

module.exports = { ensureAllHeaders, ensureTabHeaders, patchSchedulerRuleDefaults };

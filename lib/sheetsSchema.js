// lib/sheetsSchema.js
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

    // NEW (safe append)
    "client_id",
    "job_number",
    "lead_source",
    "sms_opt_in",
    "sms_marketing_consent",
    // Task #23 — Google Calendar sync
    "gcal_event_id",  // format: "gcalEventId|calendarId"
  ],

  Quotes: [
    "quote_id", "created_at", "lead_id", "service_key",
    "pricing_version", "quoted_price", "quote_snapshot_json",
  ],
  Time: [
    "id", "created_at", "date", "tech_id", "lead_id",
    "minutes", "category", "notes",
    "lat_in", "lng_in", "lat_out", "lng_out",
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

  Clients: [
    "id", "created_at", "updated_at", "name", "phone", "email",
    "sms_opt_in", "job_description", "status_code", "last_activity_at",
    "city",
    // Marketing attribution
    "lead_source", "referring_customer",
    // Review engine
    "review_status", "review_ask_sent_at", "review_reminder_sent_at",
    // Follow-up tracking
    "last_followup_at",
  ],
  Properties: [
    "id", "created_at", "updated_at", "client_id",
    "address_line1", "address_line2", "city", "state", "zip",
    "lat", "lng", "is_primary", "notes",
  ],
  Requests: [
    "id", "created_at", "updated_at", "client_id", "property_id",
    "lead_source", "summary", "status_code",
    "deposit_required", "deposit_received", "deposit_override",
    "estimated_value",
  ],
  Jobs: [
    "id", "created_at", "updated_at", "request_id", "client_id",
    "property_id", "status_code", "description", "completed_at",
  ],
  Visits: [
    "id", "created_at", "updated_at", "job_id", "request_id",
    "client_id", "property_id", "assigned_to", "visit_type",
    "status_code", "scheduled_start", "scheduled_end",
    "override_availability",
  ],
  Notes: [
    "id", "created_at", "entity_type", "entity_id", "author", "body",
  ],
  Attachments: [
    "id", "created_at", "entity_type", "entity_id",
    "file_url", "file_type", "category", "uploaded_by",
  ],
  Availability: [
    "id", "updated_at", "tech_id", "day_of_week",
    "enabled", "start_time", "end_time",
  ],

  Actuals_Rollup_30D: [
    "Key", "Value",
  ],

  // Quote engine
  JobTypes: [
    "job_type_id", "name_public", "base_hours", "min_price",
    "default_duration_minutes", "requires_photo", "instant_book_allowed",
    "material_allowance", "active", "segment", "category",
  ],
  Questions: [
    "question_id", "job_type_id", "prompt", "input_type", "required", "sort_order",
  ],
  AnswerOptions: [
    "option_id", "question_id", "label", "effect_type", "effect_value",
  ],
  AddOns: [
    "addon_id", "job_type_id", "name_public", "add_hours", "add_fee",
    "material_allowance", "active",
  ],
  Rates: [
    "crew_loaded_hourly", "overhead_per_hour", "target_margin", "service_minimum",
    "commute_assumed_minutes", "default_disclaimer_fee", "pricing_version",
  ],
  ServiceAreas: [
    "zip", "zone", "travel_fee",
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
  Bookings: [
    "booking_id", "quote_id", "created_at", "scheduled_datetime",
    "duration_minutes", "address", "customer_name", "status",
    // Contractor block scheduling (safe append)
    "schedule_block",           // "Morning" | "Afternoon"
    "job_type_id",
    "final_price",
    "phone",
    "email",
    // Crew-hours multi-block fields (safe append)
    "block_allocated_minutes",  // minutes this booking uses in THIS block specifically
    "booking_group_id",         // shared ID linking segments of a multi-block job
    "is_continuation",          // "true" if this is a continuation block (not the first)
    "assigned_tech_id",         // staff_id of the assigned technician (for Day/Dispatch view)
    // Multi-tech support (safe append)
    "assigned_tech_ids",        // comma-separated staff_ids for multi-crew jobs (e.g. "ST-1,ST-2")
    // Geocode cache (safe append)
    "lat",                      // WGS-84 latitude (decimal)
    "lng",                      // WGS-84 longitude (decimal)
    // Traccar auto-arrival (safe append)
    "arrived_at",               // ISO timestamp when a truck arrived within 300ft of this job
    "arrived_lat",              // GPS latitude at the moment of arrival detection
    "arrived_lng",              // GPS longitude at the moment of arrival detection
    // Traccar auto-departure (safe append)
    "departed_at",              // ISO timestamp when the truck left the job site
    "job_duration_minutes",     // actual on-site time in minutes (departed_at - arrived_at)
    // Customer GPS arrival SMS (safe append)
    "customer_sms_sent_at",     // ISO timestamp when "your tech is here" SMS was sent to customer
    // Reschedule-request flow (safe append)
    "reschedule_token",         // random hex token — lookup key for public accept/decline URL
    "reschedule_proposed_dt",   // ISO datetime of the proposed new appointment
    "reschedule_status",        // "" | "pending" | "accepted" | "declined"
    "reschedule_requested_at",  // ISO timestamp when the reschedule SMS was sent to customer
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

  // Ticket 21
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
    // Accounting adapter (safe append)
    "lead_id",        // for invoices originating from the old Leads model
    "provider_ref",   // external accounting system invoice ID (e.g. QuickBooks)
    "provider_name",  // which provider created the external ref (mock, qb_sandbox, qb_live)
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
    "client_id",
    "request_id",
    "amount",
    "method",
    "reference",
    "note",
    // Accounting adapter (safe append)
    "payment_date",   // date of payment (may differ from created_at if back-dated)
    "provider_ref",   // external payment reference from accounting system
  ],

  Estimator_Modules: [
    "module_id", "question", "input_type", "options_json", "applies_to", "notes",
  ],
  Estimator_ServiceMatrix: [
    "service_id", "service_name", "segment", "tier", "modules_csv",
    "qty_min", "qty_max", "disqualify_rules_json", "base_price_mode", "enabled",
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

  Leads_QuoteSnapshots: [
    "created_at_iso", "lead_id", "customer_name", "customer_phone", "customer_email",
    "segment", "service_id", "service_name", "tier_result", "risk_multiplier",
    "contingency_pct", "subtotal", "total", "answers_json", "snapshot_json",
    "photo_urls_json", "status",
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

async function ensureAllHeaders() {
  const tabs = Object.keys(SCHEMAS);
  for (let i = 0; i < tabs.length; i++) {
    const tab = tabs[i];
    try {
      await ensureTabHeaders(tab);
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
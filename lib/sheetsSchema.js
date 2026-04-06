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
  ],

  Quotes: [
    "quote_id", "created_at", "lead_id", "service_key",
    "pricing_version", "quoted_price", "quote_snapshot_json",
  ],
  Time: [
    "id", "created_at", "date", "tech_id", "lead_id",
    "minutes", "category", "notes",
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

async function ensureAllHeaders() {
  for (const tab of Object.keys(SCHEMAS)) {
    try {
      await ensureTabHeaders(tab);
    } catch (err) {
      console.error(`Header check error for ${tab} (non-fatal):`, err.message);
    }
  }
}

module.exports = { ensureAllHeaders, ensureTabHeaders };
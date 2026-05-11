// lib/estimatorSnapshot.js
// Appends a row to QuoteSnapshots in the CRM sheet on every V2 quote attempt.
// Writes to CRM_SHEET_ID — the single authoritative quote log.
// (Previously wrote to Leads_QuoteSnapshots on ESTIMATOR_V2_SHEET_ID — removed.)

const { getSheetsClient }  = require("./sheets");
const { ensureTabHeaders } = require("./sheetsSchema");

function SPREADSHEET_ID() {
  const id = process.env.CRM_SHEET_ID;
  if (!id) throw new Error("CRM sheet not configured. Set CRM_SHEET_ID.");
  return id;
}

// Maps V2 estimator snapshot fields onto the CRM QuoteSnapshots schema.
// QuoteSnapshots columns (authoritative subset used here):
// event_id, quote_id, created_at, event_type, job_type_id,
// selected_options_json, selected_addons_json, total_hours,
// labor_cost, overhead_cost, material_allowance, travel_fee,
// final_price, address_provided, pricing_version, status,
// customer_name, phone, email, address, notes,
// lead_id, snapshot_json
async function writeLeadSnapshot(fields) {
  try {
    const sheetId = SPREADSHEET_ID();
    await ensureTabHeaders("QuoteSnapshots");
    const sheets = await getSheetsClient();

    // Read current headers so we write in column-order
    const headerResp = await sheets.spreadsheets.values.get({
      spreadsheetId: sheetId,
      range: "QuoteSnapshots!1:1",
    });
    const headers = (headerResp.data.values?.[0] || []).map(h => String(h).trim());

    const crypto = require("crypto");
    const eventId = "EV2-" + crypto.randomBytes(4).toString("hex").toUpperCase();

    const mapped = {
      event_id:              eventId,
      quote_id:              fields.quote_id || "",
      created_at:            fields.created_at_iso || new Date().toISOString(),
      event_type:            "v2_estimate",
      job_type_id:           fields.service_id || "",
      selected_options_json: typeof fields.answers_json === "string"
        ? fields.answers_json
        : JSON.stringify(fields.answers_json || {}),
      selected_addons_json:  "[]",
      total_hours:           "",
      labor_cost:            "",
      overhead_cost:         "",
      material_allowance:    "",
      travel_fee:            "",
      final_price:           String(fields.total ?? fields.subtotal ?? ""),
      address_provided:      "",
      pricing_version:       "v2",
      status:                fields.status || "error",
      customer_name:         fields.customer_name || "",
      phone:                 fields.customer_phone || "",
      email:                 fields.customer_email || "",
      address:               "",
      notes:                 [
        fields.segment    ? `segment:${fields.segment}`      : "",
        fields.service_name ? `service:${fields.service_name}` : "",
        fields.tier_result  ? `tier:${fields.tier_result}`     : "",
        fields.risk_multiplier != null ? `risk:${fields.risk_multiplier}` : "",
      ].filter(Boolean).join(" | "),
      lead_id:               fields.lead_id || "",
      snapshot_json:         typeof fields.snapshot_json === "string"
        ? fields.snapshot_json
        : JSON.stringify(fields.snapshot_json || {}),
    };

    // Build row in column order, defaulting missing columns to ""
    const row = headers.map(h => String(mapped[h] ?? ""));

    await sheets.spreadsheets.values.append({
      spreadsheetId: sheetId,
      range:         "QuoteSnapshots!A:A",
      valueInputOption:  "RAW",
      insertDataOption:  "INSERT_ROWS",
      requestBody: { majorDimension: "ROWS", values: [row] },
    });
  } catch (err) {
    // Non-fatal — log but don't crash the response
    console.error("[estimatorSnapshot] write failed:", err.message);
  }
}

module.exports = { writeLeadSnapshot };

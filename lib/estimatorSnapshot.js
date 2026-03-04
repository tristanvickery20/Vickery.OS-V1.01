// lib/estimatorSnapshot.js
// Appends a row to Leads_QuoteSnapshots on every quote attempt.

const { getSheetsClient }  = require("./sheets");
const { ensureTabHeaders } = require("./sheetsSchema");

const SPREADSHEET_ID = () => process.env.CRM_SHEET_ID;

// Column order must match Leads_QuoteSnapshots schema (17 cols):
// created_at_iso, lead_id, customer_name, customer_phone, customer_email,
// segment, service_id, service_name, tier_result, risk_multiplier,
// contingency_pct, subtotal, total, answers_json, snapshot_json,
// photo_urls_json, status
async function writeLeadSnapshot(fields) {
  try {
    await ensureTabHeaders("Leads_QuoteSnapshots");
    const sheets = await getSheetsClient();
    const row = [
      fields.created_at_iso   || new Date().toISOString(),
      fields.lead_id          || "",
      fields.customer_name    || "",
      fields.customer_phone   || "",
      fields.customer_email   || "",
      fields.segment          || "",
      fields.service_id       || "",
      fields.service_name     || "",
      fields.tier_result      || "",
      String(fields.risk_multiplier  ?? ""),
      String(fields.contingency_pct  ?? ""),
      String(fields.subtotal         ?? ""),
      String(fields.total            ?? ""),
      typeof fields.answers_json   === "string" ? fields.answers_json   : JSON.stringify(fields.answers_json  || {}),
      typeof fields.snapshot_json  === "string" ? fields.snapshot_json  : JSON.stringify(fields.snapshot_json || {}),
      typeof fields.photo_urls_json === "string" ? fields.photo_urls_json : JSON.stringify(fields.photo_urls_json || []),
      fields.status           || "error",
    ];
    await sheets.spreadsheets.values.append({
      spreadsheetId: SPREADSHEET_ID(),
      range:         "Leads_QuoteSnapshots!A:A",
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

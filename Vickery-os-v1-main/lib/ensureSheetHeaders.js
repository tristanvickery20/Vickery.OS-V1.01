const { getSheetsClient } = require("./sheets");

const EXPECTED_HEADERS = [
  "id", "created_at", "name", "phone", "address",
  "job_type", "deposit_required", "estimated_value", "status",
  "quoted_price", "deposit_received", "invoiced_amount", "paid_amount",
  "scheduled_date", "assigned_to", "notes",
  "schedule_window", "schedule_preference", "duration_minutes",
  "deposit_override",
];

async function ensureLeadHeaders() {
  try {
    const sheets = await getSheetsClient();
    const spreadsheetId = process.env.CRM_SHEET_ID;
    if (!spreadsheetId) return;

    const resp = await sheets.spreadsheets.values.get({
      spreadsheetId,
      range: "Leads!1:1",
    });

    const existing = (resp.data.values && resp.data.values[0]) || [];
    const missing = [];

    for (const h of EXPECTED_HEADERS) {
      if (!existing.includes(h)) missing.push(h);
    }

    if (missing.length === 0) return;

    const newHeaders = [...existing, ...missing];
    await sheets.spreadsheets.values.update({
      spreadsheetId,
      range: "Leads!A1",
      valueInputOption: "RAW",
      requestBody: { majorDimension: "ROWS", values: [newHeaders] },
    });

    console.log("Added missing Leads headers:", missing.join(", "));
  } catch (err) {
    console.error("Header check error (non-fatal):", err.message);
  }
}

module.exports = { ensureLeadHeaders };

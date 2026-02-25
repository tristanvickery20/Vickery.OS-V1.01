const crypto = require("crypto");
const { getSheetsClient } = require("./sheets");

function genRequestId() {
  return "req-" + crypto.randomBytes(6).toString("hex");
}

async function logAudit(entry) {
  try {
    const sheets = await getSheetsClient();
    const spreadsheetId = process.env.CRM_SHEET_ID;
    if (!spreadsheetId) return;

    const row = [
      entry.audit_id || ("AUD-" + Date.now()),
      entry.created_at || new Date().toISOString(),
      entry.actor || "system",
      entry.action || "",
      entry.entity_type || "",
      entry.entity_id || "",
      entry.field || "",
      entry.old_value || "",
      entry.new_value || "",
      entry.note || "",
      entry.source || "",
      entry.request_id || "",
    ];

    await sheets.spreadsheets.values.append({
      spreadsheetId,
      range: "Audit!A:A",
      valueInputOption: "RAW",
      insertDataOption: "INSERT_ROWS",
      requestBody: { majorDimension: "ROWS", values: [row] },
    });
  } catch (err) {
    console.error("Audit log error (non-fatal):", err.message);
  }
}

async function logAuditBatch(entries) {
  for (const entry of entries) {
    await logAudit(entry);
  }
}

module.exports = { logAudit, logAuditBatch, genRequestId };

const { getSheetsClient } = require("./sheets");

// touchClient — updates last_activity_at on a Lead row (Leads is now self-contained).
async function touchClient(clientId) {
  try {
    const sheets = await getSheetsClient();
    const spreadsheetId = process.env.CRM_SHEET_ID;
    if (!spreadsheetId || !clientId) return;

    const resp = await sheets.spreadsheets.values.get({
      spreadsheetId,
      range: "Leads!A1:BZ5000",
    });
    const values = resp.data.values || [];
    if (values.length <= 1) return;

    const headers = values[0].map((h) => String(h || "").trim());
    const idCol = headers.indexOf("id");
    if (idCol < 0) return;

    for (let r = 1; r < values.length; r++) {
      const row = values[r];
      if (String(row[idCol] || "").trim() === clientId) {
        // No last_activity_at / updated_at columns on Leads — nothing to write.
        // If those columns are added later, update here.
        return;
      }
    }
  } catch (err) {
    console.error("touchClient error (non-fatal):", err.message);
  }
}

module.exports = { touchClient };

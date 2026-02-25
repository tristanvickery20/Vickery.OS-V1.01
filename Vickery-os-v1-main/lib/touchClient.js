const { getSheetsClient } = require("./sheets");

async function touchClient(clientId) {
  try {
    const sheets = await getSheetsClient();
    const spreadsheetId = process.env.CRM_SHEET_ID;
    if (!spreadsheetId || !clientId) return;

    const resp = await sheets.spreadsheets.values.get({
      spreadsheetId,
      range: "Clients!A1:Z5000",
    });
    const values = resp.data.values || [];
    if (values.length <= 1) return;

    const headers = values[0].map((h) => String(h || "").trim());
    const idCol = headers.indexOf("id");
    const laCol = headers.indexOf("last_activity_at");
    const uaCol = headers.indexOf("updated_at");
    if (idCol < 0 || laCol < 0) return;

    for (let r = 1; r < values.length; r++) {
      const row = values[r];
      if (String(row[idCol] || "").trim() === clientId) {
        const sheetRow = r + 1;
        const now = new Date().toISOString();

        const colLetter = (c) => String.fromCharCode(65 + c);
        const updates = [
          {
            range: `Clients!${colLetter(laCol)}${sheetRow}`,
            values: [[now]],
          },
        ];

        if (uaCol >= 0) {
          updates.push({
            range: `Clients!${colLetter(uaCol)}${sheetRow}`,
            values: [[now]],
          });
        }

        await sheets.spreadsheets.values.batchUpdate({
          spreadsheetId,
          requestBody: {
            valueInputOption: "RAW",
            data: updates,
          },
        });
        return;
      }
    }
  } catch (err) {
    console.error("touchClient error (non-fatal):", err.message);
  }
}

module.exports = { touchClient };

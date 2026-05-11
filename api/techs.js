const { getSheetsClient } = require("../lib/sheets");
const { hrSpreadsheetId } = require("../lib/hrSheetClient");

function mapRowToTech(row) {
  const [id, name, active] = row;
  return {
    id: id || "",
    name: name || "",
    active: String(active).toLowerCase() === "true",
  };
}

async function handleGetTechs(req, res) {
  try {
    const sheets = await getSheetsClient();
    const spreadsheetId = hrSpreadsheetId();

    const response = await sheets.spreadsheets.values.get({
      spreadsheetId,
      range: "Techs!A1:C1000",
    });

    const values = response.data.values || [];
    if (values.length <= 1) {
      res.writeHead(200, { "Content-Type": "application/json" });
      return res.end(JSON.stringify({ ok: true, techs: [] }));
    }

    const rows = values.slice(1);
    const techs = rows
      .filter((r) => r && r.length && String(r[0] || "").trim() !== "")
      .map(mapRowToTech)
      .filter((t) => t.active);

    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ ok: true, techs }));
  } catch (error) {
    res.writeHead(500, { "Content-Type": "text/plain" });
    res.end("Techs Get Error: " + error.message);
  }
}

module.exports = { handleGetTechs };
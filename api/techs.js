const { getSheetsClient } = require("../lib/sheets");
const { hrSpreadsheetId } = require("../lib/hrSheetClient");

async function handleGetTechs(req, res) {
  try {
    const sheets = await getSheetsClient();
    const spreadsheetId = hrSpreadsheetId();

    const response = await sheets.spreadsheets.values.get({
      spreadsheetId,
      range: "Staff!A:Z",
    });

    const values = response.data.values || [];
    if (values.length <= 1) {
      res.writeHead(200, { "Content-Type": "application/json" });
      return res.end(JSON.stringify({ ok: true, techs: [] }));
    }

    const [headers, ...rows] = values;
    const idx = Object.fromEntries(headers.map((h, i) => [String(h).trim(), i]));

    const get = (row, col) => String(row[idx[col] ?? -1] ?? "").trim();

    const techs = rows
      .filter(r => r && r.length && get(r, "staff_id") !== "")
      .map(r => {
        const firstName = get(r, "first_name");
        const lastName  = get(r, "last_name");
        const name      = [firstName, lastName].filter(Boolean).join(" ") || get(r, "name") || get(r, "username");
        const activeRaw = get(r, "active");
        const status    = get(r, "employment_status").toLowerCase();
        const active    = activeRaw === "" ? (status !== "terminated" && status !== "inactive") : activeRaw.toLowerCase() === "true";
        return {
          id:         get(r, "staff_id"),
          staff_id:   get(r, "staff_id"),
          first_name: firstName,
          last_name:  lastName,
          name,
          username:   get(r, "username"),
          email:      get(r, "email"),
          phone:      get(r, "phone"),
          role:       get(r, "role"),
          active,
        };
      })
      .filter(t => t.active && t.id);

    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ ok: true, techs, staff: techs }));
  } catch (error) {
    console.error("[api/techs] Error:", error.message);
    res.writeHead(500, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ ok: false, error: error.message, techs: [] }));
  }
}

module.exports = { handleGetTechs };

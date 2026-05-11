const { getSheetsClient } = require("../lib/sheets");
const { hrSpreadsheetId }  = require("../lib/hrSheetClient");
const { suggestWithPersonalCalendar } = require("../lib/schedule");

function parseBody(req) {
  return new Promise((resolve, reject) => {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => { try { resolve(JSON.parse(body || "{}")); } catch (e) { reject(e); } });
    req.on("error", reject);
  });
}

async function handleScheduleSuggest(req, res) {
  try {
    const data = await parseBody(req);
    const { target_date, duration_minutes, preference } = data;
    if (!target_date) {
      res.writeHead(400, { "Content-Type": "application/json" });
      return res.end(JSON.stringify({ ok: false, error: "target_date is required" }));
    }

    const sheets = await getSheetsClient();
    const spreadsheetId = process.env.CRM_SHEET_ID;

    const [techsResp, leadsResp] = await Promise.all([
      sheets.spreadsheets.values.get({ spreadsheetId: hrSpreadsheetId(), range: "Techs!A1:C1000" }),
      sheets.spreadsheets.values.get({ spreadsheetId, range: "Leads!A1:Z2000" }),
    ]);

    const techRows = (techsResp.data.values || []).slice(1);
    const techs = techRows
      .filter((r) => r && r[0])
      .map((r) => ({ id: r[0], name: r[1] || "", active: String(r[2]).toLowerCase() === "true" }))
      .filter((t) => t.active);

    const leadRows = (leadsResp.data.values || []);
    const headers = leadRows[0] || [];
    const leads = leadRows.slice(1).filter((r) => r && r[0]).map((r) => {
      const obj = {};
      headers.forEach((h, i) => { obj[h] = r[i] || ""; });
      return obj;
    });

    const result = await suggestWithPersonalCalendar(techs, leads, target_date, duration_minutes || 60, preference || "");

    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify(result));
  } catch (err) {
    console.error("Schedule suggest error:", err);
    res.writeHead(500, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ ok: false, error: err.message }));
  }
}

module.exports = { handleScheduleSuggest };

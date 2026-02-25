const { getSheetsClient } = require("../lib/sheets");
const url = require("url");

async function handleGetAudit(req, res) {
  try {
    const sheets = await getSheetsClient();
    const spreadsheetId = process.env.CRM_SHEET_ID;

    const resp = await sheets.spreadsheets.values.get({
      spreadsheetId,
      range: "Audit!A1:L5000",
    });

    const values = resp.data.values || [];
    if (values.length <= 1) {
      res.writeHead(200, { "Content-Type": "application/json" });
      return res.end(JSON.stringify({ ok: true, entries: [] }));
    }

    const headers = values[0];
    let entries = values.slice(1)
      .filter((r) => r && r.length && String(r[0] || "").trim() !== "")
      .map((row) => {
        const obj = {};
        headers.forEach((h, i) => { obj[h] = row[i] || ""; });
        return obj;
      });

    // -------------------------
    // FILTERS
    // -------------------------
    const parsed = url.parse(req.url, true);
    const q = parsed.query || {};

    if (q.entity_id) {
      entries = entries.filter((e) => e.entity_id === q.entity_id);
    }

    if (q.action) {
      entries = entries.filter((e) => e.action === q.action);
    }

    // Newest first
    entries.sort((a, b) => (a.created_at < b.created_at ? 1 : -1));

    const limit = Math.min(Number(q.limit) || 200, 1000);
    entries = entries.slice(0, limit);

    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ ok: true, entries }));
  } catch (err) {
    res.writeHead(500, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ ok: false, error: err.message }));
  }
}

module.exports = { handleGetAudit };

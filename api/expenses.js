const { getSheetsClient } = require("../lib/sheets");
const { logAudit, genRequestId } = require("../lib/audit");

function mapRowToExpense(row) {
  const [id, created_at, date, tech_id, lead_id, type, vendor, amount, notes, receipt_url] = row;
  return {
    id: id || "",
    created_at: created_at || "",
    date: date || "",
    tech_id: tech_id || "",
    lead_id: lead_id || "",
    type: type || "",
    vendor: vendor || "",
    amount: Number(amount || 0),
    notes: notes || "",
    receipt_url: receipt_url || "",
  };
}

async function handleGetExpenses(req, res, opts = {}) {
  try {
    const sheets = await getSheetsClient();
    const spreadsheetId = process.env.CRM_SHEET_ID;

    const resp = await sheets.spreadsheets.values.get({
      spreadsheetId,
      range: "Expenses!A1:J2000",
    });

    const values = resp.data.values || [];
    if (values.length <= 1) {
      res.writeHead(200, { "Content-Type": "application/json" });
      return res.end(JSON.stringify({ ok: true, entries: [] }));
    }

    let entries = values
      .slice(1)
      .filter((r) => r && r.length && String(r[0] || "").trim() !== "")
      .map(mapRowToExpense);

    if (opts.filterDate) {
      entries = entries.filter((e) => e.date === opts.filterDate);
    }

    entries = entries
      .sort((a, b) => (a.created_at < b.created_at ? 1 : -1))
      .slice(0, 500);

    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ ok: true, entries }));
  } catch (err) {
    res.writeHead(500, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ ok: false, error: err.message }));
  }
}

async function handleCreateExpense(req, res) {
  let body = "";
  req.on("data", (chunk) => (body += chunk));
  req.on("end", async () => {
    try {
      const data = body ? JSON.parse(body) : {};

      const entry = {
        id: "EXP-" + Date.now(),
        created_at: new Date().toISOString(),
        date: data.date || "",
        tech_id: data.tech_id || "",
        lead_id: data.lead_id || "",
        type: data.type || "",
        vendor: data.vendor || "",
        amount: Number(data.amount || 0),
        notes: data.notes || "",
        receipt_url: data.receipt_url || "",
      };

      const row = [
        entry.id,
        entry.created_at,
        entry.date,
        entry.tech_id,
        entry.lead_id,
        entry.type,
        entry.vendor,
        String(entry.amount),
        entry.notes,
        entry.receipt_url,
      ];

      const sheets = await getSheetsClient();
      const spreadsheetId = process.env.CRM_SHEET_ID;

      await sheets.spreadsheets.values.append({
        spreadsheetId,
        range: "Expenses!A:A",
        valueInputOption: "RAW",
        insertDataOption: "INSERT_ROWS",
        requestBody: { majorDimension: "ROWS", values: [row] },
      });

      res.writeHead(201, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ok: true, entry }));

      logAudit({
        action: "expense.create",
        entity_type: "expense",
        entity_id: entry.id,
        field: "*",
        new_value: JSON.stringify({ tech_id: entry.tech_id, lead_id: entry.lead_id, type: entry.type, amount: entry.amount }),
        source: "crm-expenses",
        request_id: genRequestId(),
      }).catch(() => {});
    } catch (err) {
      res.writeHead(500, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ok: false, error: err.message }));
    }
  });
}

module.exports = { handleGetExpenses, handleCreateExpense };

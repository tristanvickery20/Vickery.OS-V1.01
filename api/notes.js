const { getSheetsClient } = require("../lib/sheets");
const { logAudit, genRequestId } = require("../lib/audit");
const { touchClient } = require("../lib/touchClient");

function json(res, code, data) {
  res.writeHead(code, { "Content-Type": "application/json" });
  res.end(JSON.stringify(data));
}

function readBody(req) {
  return new Promise((resolve) => {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      try { resolve(JSON.parse(body)); } catch { resolve({}); }
    });
  });
}

async function handleCreateNote(req, res) {
  try {
    const body = await readBody(req);
    const entity_type = String(body.entity_type || "").trim();
    const entity_id = String(body.entity_id || "").trim();
    const author = String(body.author || "admin").trim();
    const noteBody = String(body.body || "").trim();

    if (!noteBody || noteBody.length < 2) {
      return json(res, 400, { ok: false, error: "Note body is required (at least 2 characters)." });
    }

    const validTypes = ["client", "job", "quote", "visit", "request"];
    if (!validTypes.includes(entity_type)) {
      return json(res, 400, { ok: false, error: "Invalid entity_type." });
    }

    if (!entity_id) {
      return json(res, 400, { ok: false, error: "entity_id is required." });
    }

    const id = "NOTE-" + Date.now();
    const created_at = new Date().toISOString();
    const request_id = genRequestId();

    const sheets = await getSheetsClient();
    const spreadsheetId = process.env.CRM_SHEET_ID;

    const headersResp = await sheets.spreadsheets.values.get({
      spreadsheetId,
      range: "Notes!1:1",
    });
    const headers = (headersResp.data.values && headersResp.data.values[0]) || [];
    const rowObj = { id, created_at, entity_type, entity_id, author, body: noteBody };
    const row = headers.map((h) => rowObj[h] || "");

    await sheets.spreadsheets.values.append({
      spreadsheetId,
      range: "Notes!A:A",
      valueInputOption: "RAW",
      insertDataOption: "INSERT_ROWS",
      requestBody: { majorDimension: "ROWS", values: [row] },
    });

    logAudit({
      actor: author,
      action: "CREATE_NOTE",
      entity_type,
      entity_id,
      field: "note",
      new_value: noteBody.substring(0, 120),
      source: "crm",
      request_id,
    });

    if (entity_type === "client") {
      touchClient(entity_id).catch(() => {});
    }

    json(res, 201, {
      ok: true,
      note: { id, created_at, entity_type, entity_id, author, body: noteBody },
    });
  } catch (err) {
    json(res, 500, { ok: false, error: err.message });
  }
}

module.exports = { handleCreateNote };

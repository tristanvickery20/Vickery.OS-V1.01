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

function inferFileType(url) {
  const lower = url.toLowerCase();
  if (/\.(png|jpg|jpeg|webp|gif)(\?|$)/.test(lower)) return "image";
  if (/\.pdf(\?|$)/.test(lower)) return "pdf";
  return "other";
}

async function handleCreateAttachment(req, res) {
  try {
    const body = await readBody(req);
    const entity_type = String(body.entity_type || "").trim();
    const entity_id = String(body.entity_id || "").trim();
    const file_url = String(body.file_url || "").trim();
    const uploaded_by = String(body.uploaded_by || "admin").trim();
    const category = String(body.category || "general").trim().toLowerCase();

    const validTypes = ["client", "job", "quote", "visit", "request"];
    if (!validTypes.includes(entity_type)) {
      return json(res, 400, { ok: false, error: "Invalid entity_type." });
    }

    if (!entity_id) {
      return json(res, 400, { ok: false, error: "entity_id is required." });
    }

    if (!file_url || (!file_url.startsWith("http://") && !file_url.startsWith("https://"))) {
      return json(res, 400, { ok: false, error: "file_url must start with http:// or https://." });
    }

    const validCategories = ["before", "after", "general"];
    const safeCategory = validCategories.includes(category) ? category : "general";

    const file_type = body.file_type && ["image", "pdf", "other"].includes(body.file_type)
      ? body.file_type
      : inferFileType(file_url);

    const id = "ATT-" + Date.now();
    const created_at = new Date().toISOString();
    const request_id = genRequestId();

    const sheets = await getSheetsClient();
    const spreadsheetId = process.env.CRM_SHEET_ID;

    const headersResp = await sheets.spreadsheets.values.get({
      spreadsheetId,
      range: "Attachments!1:1",
    });
    const headers = (headersResp.data.values && headersResp.data.values[0]) || [];
    const rowObj = { id, created_at, entity_type, entity_id, file_url, file_type, category: safeCategory, uploaded_by };
    const row = headers.map((h) => rowObj[h] || "");

    await sheets.spreadsheets.values.append({
      spreadsheetId,
      range: "Attachments!A:A",
      valueInputOption: "RAW",
      insertDataOption: "INSERT_ROWS",
      requestBody: { majorDimension: "ROWS", values: [row] },
    });

    logAudit({
      actor: uploaded_by,
      action: "CREATE_ATTACHMENT",
      entity_type,
      entity_id,
      field: "file_url",
      new_value: file_url,
      source: "crm",
      request_id,
    });

    if (entity_type === "client") {
      touchClient(entity_id).catch(() => {});
    }

    json(res, 201, {
      ok: true,
      attachment: { id, created_at, entity_type, entity_id, file_url, file_type, category: safeCategory, uploaded_by },
    });
  } catch (err) {
    json(res, 500, { ok: false, error: err.message });
  }
}

module.exports = { handleCreateAttachment };

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

    const validTypes = ["client", "job", "quote", "visit", "request", "lead"];
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

// GET /api/attachments?entity_type=lead&entity_id=xxx
async function handleGetAttachments(req, res) {
  try {
    const qs = new URL(req.url, "http://x").searchParams;
    const entity_type = qs.get("entity_type") || "";
    const entity_id   = qs.get("entity_id") || "";

    const sheets = await getSheetsClient();
    const spreadsheetId = process.env.CRM_SHEET_ID;
    const resp = await sheets.spreadsheets.values.get({ spreadsheetId, range: "Attachments!A:K" });
    const rows = resp.data.values || [];
    if (!rows.length) return json(res, 200, { ok: true, attachments: [] });
    const headers = rows[0].map((h) => String(h || "").trim());
    const toObj = (r) => { const o = {}; headers.forEach((h, i) => { o[h] = String(r[i] || "").trim(); }); return o; };
    let attachments = rows.slice(1).map(toObj).filter((a) => a.id);
    if (entity_id)   attachments = attachments.filter((a) => a.entity_id === entity_id);
    if (entity_type) attachments = attachments.filter((a) => a.entity_type === entity_type);
    json(res, 200, { ok: true, attachments });
  } catch (err) {
    json(res, 500, { ok: false, error: err.message });
  }
}

/**
 * Internal helper — writes one row to the Attachments sheet directly.
 * Bypasses HTTP-URL validation so /uploads/ paths from server uploads work.
 * Safe to call fire-and-forget (.catch(() => {})).
 */
async function appendAttachmentRow({ id, entity_type, entity_id, file_url, file_type, category, uploaded_by }) {
  const sheets = await getSheetsClient();
  const spreadsheetId = process.env.CRM_SHEET_ID;
  const created_at = new Date().toISOString();
  const safeId = id || ("ATT-" + Date.now() + "-" + Math.floor(Math.random() * 9999));
  const headersResp = await sheets.spreadsheets.values.get({ spreadsheetId, range: "Attachments!1:1" });
  const headers = (headersResp.data.values && headersResp.data.values[0]) || [];
  const rowObj = {
    id: safeId, created_at, entity_type: entity_type || "lead",
    entity_id: entity_id || "", file_url: file_url || "",
    file_type: file_type || "image", category: category || "general",
    uploaded_by: uploaded_by || "system",
  };
  const row = headers.length ? headers.map(h => rowObj[h] || "") : Object.values(rowObj);
  await sheets.spreadsheets.values.append({
    spreadsheetId,
    range: "Attachments!A:A",
    valueInputOption: "RAW",
    insertDataOption: "INSERT_ROWS",
    requestBody: { majorDimension: "ROWS", values: [row] },
  });
}

module.exports = { handleCreateAttachment, handleGetAttachments, appendAttachmentRow };

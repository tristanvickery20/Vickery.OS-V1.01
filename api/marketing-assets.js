// api/marketing-assets.js
// Proof Asset Library + Contractor Task Board (Task #75)
const { getSheetsClient } = require("../lib/sheets");
const { marketingSpreadsheetId } = require("../lib/marketingSheetClient");
const { ensureTabHeaders } = require("../lib/sheetsSchema");
const crypto = require("crypto");

function json(res, code, data) {
  res.writeHead(code, { "Content-Type": "application/json" });
  res.end(JSON.stringify(data));
}
function readBody(req) {
  return new Promise((resolve) => {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => { try { resolve(JSON.parse(body)); } catch { resolve({}); } });
  });
}
function toObj(headers, row) {
  const obj = {};
  headers.forEach((h, i) => { obj[h] = String(row[i] || "").trim(); });
  return obj;
}
async function readTab(sheets, spreadsheetId, tab) {
  try {
    const resp = await sheets.spreadsheets.values.get({ spreadsheetId, range: `${tab}!A:ZZ` });
    const rows = resp.data.values || [];
    if (!rows.length) return { headers: [], rows: [], objects: [] };
    const headers = rows[0].map((h) => String(h || "").trim());
    const objects = rows.slice(1).map((r) => toObj(headers, r));
    return { headers, rows: rows.slice(1), objects };
  } catch {
    return { headers: [], rows: [], objects: [] };
  }
}

// ── Assets ───────────────────────────────────────────────────────────────────

// GET /api/marketing/assets
async function handleGetAssets(req, res) {
  try {
    const mktId = marketingSpreadsheetId();
    const sheets = await getSheetsClient();
    await ensureTabHeaders("MarketingAssets", mktId);
    const { objects } = await readTab(sheets, mktId, "MarketingAssets");

    const qs = new URL(req.url, "http://x").searchParams;
    const filterType    = qs.get("type") || "";
    const filterService = qs.get("service") || "";
    const filterCity    = qs.get("city") || "";
    const gbpReady      = qs.get("gbp_ready") || "";
    const filterPerm    = qs.get("permission_status") || "";

    let assets = objects.filter((a) => a.asset_id);
    if (filterType)    assets = assets.filter((a) => a.asset_type === filterType);
    if (filterService) assets = assets.filter((a) => a.service_type.toLowerCase().includes(filterService.toLowerCase()));
    if (filterCity)    assets = assets.filter((a) => a.city.toLowerCase().includes(filterCity.toLowerCase()));
    if (filterPerm)    assets = assets.filter((a) => a.permission_status === filterPerm);
    if (gbpReady === "1") assets = assets.filter((a) => a.marketing_use_allowed === "yes" && a.best_for_gbp === "true");

    assets.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
    json(res, 200, { ok: true, assets });
  } catch (err) {
    json(res, 500, { ok: false, error: err.message });
  }
}

// POST /api/marketing/assets
async function handleCreateAsset(req, res) {
  try {
    const body = await readBody(req);
    const mktId = marketingSpreadsheetId();
    const sheets = await getSheetsClient();
    await ensureTabHeaders("MarketingAssets", mktId);

    // Auto-fill service_type and city from lead if job_id/lead_id provided
    let service_type = body.service_type || "";
    let city = body.city || "";
    let client_id = body.client_id || "";
    if (!service_type && body.lead_id) {
      try {
        const crmSheets = await getSheetsClient();
        const leadsResp = await crmSheets.spreadsheets.values.get({
          spreadsheetId: process.env.CRM_SHEET_ID,
          range: "Leads!A1:ZZ5000",
        });
        const lRows = leadsResp.data.values || [];
        if (lRows.length > 1) {
          const lHeaders = lRows[0].map((h) => String(h || "").trim());
          const lIdIdx = lHeaders.indexOf("id");
          const lTypeIdx = lHeaders.indexOf("job_type");
          const lCityIdx = lHeaders.indexOf("address");
          const lClientIdx = lHeaders.indexOf("client_id");
          const match = lRows.slice(1).find((r) => String(r[lIdIdx] || "").trim() === body.lead_id);
          if (match) {
            service_type = service_type || String(match[lTypeIdx] || "").trim();
            if (!city && lCityIdx >= 0) {
              const addr = String(match[lCityIdx] || "").trim();
              const parts = addr.split(",");
              if (parts.length >= 2) city = parts[parts.length - 2].trim();
            }
            client_id = client_id || String(match[lClientIdx] || "").trim();
          }
        }
      } catch { /* non-fatal */ }
    }

    const asset_id = "ASSET-" + Date.now() + "-" + crypto.randomBytes(3).toString("hex").toUpperCase();
    const now = new Date().toISOString();
    const row = [
      asset_id, now,
      body.job_id || "", body.lead_id || "", client_id,
      service_type, city,
      body.asset_type || "",
      body.file_url || "", body.file_type || "image",
      body.date_taken || now.slice(0, 10),
      body.marketing_use_allowed || "pending",
      body.permission_status || "not_asked",
      body.best_for_gbp ? "true" : "false",
      body.best_for_website ? "true" : "false",
      body.best_for_social ? "true" : "false",
      body.best_for_ads ? "true" : "false",
      body.notes || "",
    ];

    await sheets.spreadsheets.values.append({
      spreadsheetId: mktId,
      range: "MarketingAssets!A:A",
      valueInputOption: "RAW",
      insertDataOption: "INSERT_ROWS",
      requestBody: { values: [row] },
    });

    json(res, 201, { ok: true, asset_id, asset: toObj([
      "asset_id","created_at","job_id","lead_id","client_id","service_type","city","asset_type",
      "file_url","file_type","date_taken","marketing_use_allowed","permission_status",
      "best_for_gbp","best_for_website","best_for_social","best_for_ads","notes",
    ], row) });
  } catch (err) {
    json(res, 500, { ok: false, error: err.message });
  }
}

// PATCH /api/marketing/assets/:id
async function handleUpdateAsset(req, res, assetId) {
  try {
    const body = await readBody(req);
    const mktId = marketingSpreadsheetId();
    const sheets = await getSheetsClient();
    const resp = await sheets.spreadsheets.values.get({ spreadsheetId: mktId, range: "MarketingAssets!A:ZZ" });
    const rows = resp.data.values || [];
    if (!rows.length) return json(res, 404, { ok: false, error: "Asset not found" });
    const headers = rows[0].map((h) => String(h || "").trim());
    const rowIdx = rows.findIndex((r, i) => i > 0 && String(r[0] || "").trim() === assetId);
    if (rowIdx < 0) return json(res, 404, { ok: false, error: "Asset not found" });

    const row = [...rows[rowIdx]];
    const set = (col, val) => {
      const i = headers.indexOf(col);
      if (i >= 0 && val !== undefined) row[i] = String(val);
    };
    set("marketing_use_allowed", body.marketing_use_allowed);
    set("permission_status",     body.permission_status);
    set("best_for_gbp",          body.best_for_gbp !== undefined ? String(!!body.best_for_gbp) : undefined);
    set("best_for_website",      body.best_for_website !== undefined ? String(!!body.best_for_website) : undefined);
    set("best_for_social",       body.best_for_social !== undefined ? String(!!body.best_for_social) : undefined);
    set("best_for_ads",          body.best_for_ads !== undefined ? String(!!body.best_for_ads) : undefined);
    set("asset_type",            body.asset_type);
    set("notes",                 body.notes);

    const sheetRow = rowIdx + 1;
    await sheets.spreadsheets.values.update({
      spreadsheetId: mktId,
      range: `MarketingAssets!A${sheetRow}`,
      valueInputOption: "RAW",
      requestBody: { values: [row] },
    });
    json(res, 200, { ok: true, asset: toObj(headers, row) });
  } catch (err) {
    json(res, 500, { ok: false, error: err.message });
  }
}

// ── Contractor Tasks ──────────────────────────────────────────────────────────

// GET /api/marketing/contractor-tasks
async function handleGetContractorTasks(req, res) {
  try {
    const mktId = marketingSpreadsheetId();
    const sheets = await getSheetsClient();
    await ensureTabHeaders("ContractorTasks", mktId);
    const { objects } = await readTab(sheets, mktId, "ContractorTasks");
    const tasks = objects.filter((t) => t.task_id && t.status !== "cancelled");
    tasks.sort((a, b) => {
      if (!a.due_date && !b.due_date) return 0;
      if (!a.due_date) return 1;
      if (!b.due_date) return -1;
      return new Date(a.due_date) - new Date(b.due_date);
    });
    json(res, 200, { ok: true, tasks });
  } catch (err) {
    json(res, 500, { ok: false, error: err.message });
  }
}

// POST /api/marketing/contractor-tasks
async function handleCreateContractorTask(req, res) {
  try {
    const body = await readBody(req);
    const mktId = marketingSpreadsheetId();
    const sheets = await getSheetsClient();
    await ensureTabHeaders("ContractorTasks", mktId);

    if (!body.task_name) return json(res, 400, { ok: false, error: "task_name required" });
    const task_id = "CTASK-" + Date.now() + "-" + crypto.randomBytes(3).toString("hex").toUpperCase();
    const now = new Date().toISOString();
    const row = [
      task_id, now,
      body.task_name || "",
      body.contractor_name || "",
      body.contractor_type || "",
      body.channel || "",
      body.campaign_id || "",
      body.due_date || "",
      body.status || "pending",
      body.output_expected || "",
      body.link_or_file || "",
      body.owner_approval_needed ? "true" : "false",
      body.result_metric || "",
      body.notes || "",
    ];

    await sheets.spreadsheets.values.append({
      spreadsheetId: mktId,
      range: "ContractorTasks!A:A",
      valueInputOption: "RAW",
      insertDataOption: "INSERT_ROWS",
      requestBody: { values: [row] },
    });
    json(res, 201, { ok: true, task_id });
  } catch (err) {
    json(res, 500, { ok: false, error: err.message });
  }
}

// PATCH /api/marketing/contractor-tasks/:id
async function handleUpdateContractorTask(req, res, taskId) {
  try {
    const body = await readBody(req);
    const mktId = marketingSpreadsheetId();
    const sheets = await getSheetsClient();
    const resp = await sheets.spreadsheets.values.get({ spreadsheetId: mktId, range: "ContractorTasks!A:ZZ" });
    const rows = resp.data.values || [];
    if (!rows.length) return json(res, 404, { ok: false, error: "Task not found" });
    const headers = rows[0].map((h) => String(h || "").trim());
    const rowIdx = rows.findIndex((r, i) => i > 0 && String(r[0] || "").trim() === taskId);
    if (rowIdx < 0) return json(res, 404, { ok: false, error: "Task not found" });

    const row = [...rows[rowIdx]];
    const set = (col, val) => {
      const i = headers.indexOf(col);
      if (i >= 0 && val !== undefined) row[i] = String(val);
    };
    set("status",               body.status);
    set("task_name",            body.task_name);
    set("contractor_name",      body.contractor_name);
    set("contractor_type",      body.contractor_type);
    set("channel",              body.channel);
    set("due_date",             body.due_date);
    set("output_expected",      body.output_expected);
    set("link_or_file",         body.link_or_file);
    set("owner_approval_needed", body.owner_approval_needed !== undefined ? String(!!body.owner_approval_needed) : undefined);
    set("result_metric",        body.result_metric);
    set("notes",                body.notes);

    const sheetRow = rowIdx + 1;
    await sheets.spreadsheets.values.update({
      spreadsheetId: mktId,
      range: `ContractorTasks!A${sheetRow}`,
      valueInputOption: "RAW",
      requestBody: { values: [row] },
    });
    json(res, 200, { ok: true, task: toObj(headers, row) });
  } catch (err) {
    json(res, 500, { ok: false, error: err.message });
  }
}

module.exports = {
  handleGetAssets,
  handleCreateAsset,
  handleUpdateAsset,
  handleGetContractorTasks,
  handleCreateContractorTask,
  handleUpdateContractorTask,
};

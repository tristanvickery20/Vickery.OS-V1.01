const { getSheetsClient, invalidateCache } = require("../lib/sheets");
const { logAudit, genRequestId } = require("../lib/audit");

function nowIso() {
  return new Date().toISOString();
}

function norm(s) {
  return String(s || "").toLowerCase().trim();
}

function json(res, code, data) {
  res.writeHead(code, { "Content-Type": "application/json" });
  res.end(JSON.stringify(data));
}

function findHeaderIndex(headers, key) {
  const target = String(key || "").trim();
  for (let i = 0; i < headers.length; i++) {
    if (String(headers[i] || "").trim() === target) return i;
  }
  return -1;
}

function pad4(n) {
  const s = String(n || 0);
  return s.length >= 4 ? s : "0".repeat(4 - s.length) + s;
}

function nextIdWithPrefix(existingIds, prefix) {
  let maxNum = 0;
  for (const id of existingIds) {
    const s = String(id || "").trim();
    if (!s.startsWith(prefix)) continue;
    const num = Number(s.slice(prefix.length));
    if (Number.isFinite(num) && num > maxNum) maxNum = num;
  }
  return prefix + pad4(maxNum + 1);
}

function truthy(v) {
  const x = norm(v);
  return x === "true" || x === "1" || x === "yes" || x === "y";
}

async function readValues(sheets, spreadsheetId, range) {
  const resp = await sheets.spreadsheets.values.get({ spreadsheetId, range });
  return resp.data.values || [];
}

async function ensureTabExists(sheets, spreadsheetId, tabName) {
  const meta = await sheets.spreadsheets.get({ spreadsheetId });
  const names = (meta.data.sheets || [])
    .map((s) => (s.properties ? s.properties.title : ""))
    .filter(Boolean);

  if (names.includes(tabName)) return false;

  await sheets.spreadsheets.batchUpdate({
    spreadsheetId,
    requestBody: { requests: [{ addSheet: { properties: { title: tabName } } }] },
  });

  return true;
}

async function writeRow1(sheets, spreadsheetId, tabName, headers) {
  await sheets.spreadsheets.values.update({
    spreadsheetId,
    range: `${tabName}!A1`,
    valueInputOption: "RAW",
    requestBody: { majorDimension: "ROWS", values: [headers] },
  });
}

async function ensureHeader(tabName, key, sheets, spreadsheetId) {
  const row1 = await readValues(sheets, spreadsheetId, `${tabName}!1:1`);
  const headers = (row1[0] || []).map((h) => String(h || "").trim()).filter(Boolean);
  if (!headers.length) return { headers: [], index: -1, changed: false };

  let idx = findHeaderIndex(headers, key);
  if (idx !== -1) return { headers, index: idx, changed: false };

  const newHeaders = [...headers, key];
  await writeRow1(sheets, spreadsheetId, tabName, newHeaders);
  return { headers: newHeaders, index: newHeaders.length - 1, changed: true };
}

function buildObjFromRow(headers, row) {
  const obj = {};
  for (let i = 0; i < headers.length; i++) {
    const k = String(headers[i] || "").trim();
    if (!k) continue;
    obj[k] = row[i] != null ? String(row[i]) : "";
  }
  return obj;
}

function buildRowFromHeaders(headers, obj) {
  return headers.map((h) => {
    const k = String(h || "").trim();
    return obj[k] != null ? String(obj[k]) : "";
  });
}

async function appendRows(sheets, spreadsheetId, tabName, rows) {
  await sheets.spreadsheets.values.append({
    spreadsheetId,
    range: `${tabName}!A:ZZ`,
    valueInputOption: "RAW",
    insertDataOption: "INSERT_ROWS",
    requestBody: { majorDimension: "ROWS", values: rows },
  });
}

async function updateCellByIndex(sheets, spreadsheetId, tabName, rowNumber1Based, colIndex0Based, value) {
  // 0=>A, 1=>B ...
  const colLetter = String.fromCharCode("A".charCodeAt(0) + colIndex0Based);
  const range = `${tabName}!${colLetter}${rowNumber1Based}`;
  await sheets.spreadsheets.values.update({
    spreadsheetId,
    range,
    valueInputOption: "RAW",
    requestBody: { values: [[value]] },
  });
}

async function readConfigMap(sheets, spreadsheetId) {
  // Config expected: key,value
  let rows = [];
  try {
    rows = await readValues(sheets, spreadsheetId, "Config!A1:B2000");
  } catch {
    return {};
  }
  if (!rows || rows.length < 2) return {};
  const headers = rows[0] || [];
  const kIdx = findHeaderIndex(headers, "key");
  const vIdx = findHeaderIndex(headers, "value");
  if (kIdx === -1 || vIdx === -1) return {};

  const map = {};
  for (let i = 1; i < rows.length; i++) {
    const r = rows[i] || [];
    const k = String(r[kIdx] || "").trim();
    const v = String(r[vIdx] || "").trim();
    if (k) map[k] = v;
  }
  return map;
}

function parseStatusList(raw) {
  const s = String(raw || "").trim();
  if (!s) return [];
  return s
    .split(",")
    .map((x) => norm(x))
    .filter(Boolean);
}

function shouldPromote(newStatus, cfgList) {
  const s = norm(newStatus);
  if (!s) return false;

  // default if config missing:
  const list = (cfgList && cfgList.length) ? cfgList : ["scheduled"];

  // allow a couple friendly variants:
  // "requested estimate" => "requested_estimate" normalization not automatic, so include both if you want.
  return list.includes(s);
}

async function upsertClientPropertyJobFromLead({ sheets, spreadsheetId, leadObj }) {
  // Leads are self-contained — no separate Clients/Properties/Jobs tabs.
  // This function is a no-op: all relevant data lives on the Lead row.
  const leadId = String(leadObj.id || "").trim();
  const leadAssignedTo = String(leadObj.assigned_to || "").trim();
  const leadScheduledDate = String(leadObj.scheduled_date || "").trim();
  const leadEstimatedValue = String(leadObj.estimated_value || "").trim();
  const jobNumber = String(leadObj.job_number || leadId).trim();

  return {
    ok: true,
    client_id: leadId,
    property_id: "",
    job_id: leadId,
    job_number: jobNumber,
    created_client: false,
    created_job: false,
    assigned_to: leadAssignedTo,
    scheduled_date: leadScheduledDate,
    estimated_value: leadEstimatedValue,
  };
}

async function handleUpdateLeadStatus(req, res) {
  try {
    let body = "";
    req.on("data", (chunk) => (body += chunk));
    req.on("end", async () => {
      let data = {};
      try {
        data = body ? JSON.parse(body) : {};
      } catch {
        data = {};
      }

      const id = String(data.id || data.lead_id || "").trim();
      const newStatus = String(data.status || "").trim();

      if (!id) return json(res, 400, { ok: false, error: "Missing id" });
      if (!newStatus) return json(res, 400, { ok: false, error: "Missing status" });

      const sheets = await getSheetsClient();
      const spreadsheetId = process.env.CRM_SHEET_ID;
      if (!spreadsheetId) return json(res, 500, { ok: false, error: "Missing CRM_SHEET_ID" });

      const leadVals = await readValues(sheets, spreadsheetId, "Leads!A1:AZ2000");
      if (!leadVals || leadVals.length <= 1) return json(res, 404, { ok: false, error: "No leads found" });

      const headers = (leadVals[0] || []).map((h) => String(h || "").trim()).filter(Boolean);
      const idIdx = findHeaderIndex(headers, "id");
      const statusIdx = findHeaderIndex(headers, "status");
      if (idIdx === -1) return json(res, 500, { ok: false, error: "Leads tab missing id header" });
      if (statusIdx === -1) return json(res, 500, { ok: false, error: "Leads tab missing status header" });

      let rowIndex = -1; // index in leadVals
      for (let i = 1; i < leadVals.length; i++) {
        const row = leadVals[i] || [];
        const rowId = String(row[idIdx] || "").trim();
        if (rowId === id) {
          rowIndex = i;
          break;
        }
      }
      if (rowIndex === -1) return json(res, 404, { ok: false, error: "Lead id not found: " + id });

      const oldStatus = String(((leadVals[rowIndex] || [])[statusIdx]) || "").trim();

      // Update status
      const sheetRowNumber = rowIndex + 1;
      await updateCellByIndex(sheets, spreadsheetId, "Leads", sheetRowNumber, statusIdx, newStatus);
      invalidateCache(spreadsheetId, "Leads");

      // Promotion rule: configurable statuses in Config
      // Config key: promote_to_client_statuses (comma list)
      // Default: "scheduled"
      const cfg = await readConfigMap(sheets, spreadsheetId);
      const promoteList = parseStatusList(cfg.promote_to_client_statuses);

      let promotion = null;
      if (shouldPromote(newStatus, promoteList)) {
        const leadRow = leadVals[rowIndex] || [];
        const leadObj = buildObjFromRow(headers, leadRow);

        promotion = await upsertClientPropertyJobFromLead({
          sheets,
          spreadsheetId,
          leadObj,
        });

        // write Leads.client_id if possible (append header if missing)
        if (promotion && promotion.ok && promotion.client_id) {
          const ensured = await ensureHeader("Leads", "client_id", sheets, spreadsheetId);
          if (ensured.index !== -1) {
            await updateCellByIndex(
              sheets,
              spreadsheetId,
              "Leads",
              sheetRowNumber,
              ensured.index,
              promotion.client_id
            );
          }
        }
      }

      json(res, 200, {
        ok: true,
        id,
        status: newStatus,
        promoted_to_client: !!(promotion && promotion.ok && promotion.client_id),
        promotion: promotion && promotion.ok ? promotion : null,
      });

      logAudit({
        action: "lead.status",
        entity_type: "lead",
        entity_id: id,
        field: "status",
        old_value: oldStatus,
        new_value: newStatus,
        source: "crm-leads",
        request_id: genRequestId(),
        note:
          promotion && promotion.ok && promotion.client_id
            ? `auto_client=${promotion.client_id}; job=${promotion.job_id}; job_number=${promotion.job_number}; assigned_to=${promotion.assigned_to}`
            : "",
      }).catch(() => {});
    });
  } catch (error) {
    res.writeHead(500, { "Content-Type": "text/plain" });
    res.end("Update Status Error: " + error.message);
  }
}

module.exports = { handleUpdateLeadStatus };
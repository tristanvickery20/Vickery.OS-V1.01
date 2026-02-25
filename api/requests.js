const url = require("url");
const { readTab, parseISODateSafe, normalizeStr, safeNum } = require("../lib/readTab");
const { getSheetsClient } = require("../lib/sheets");
const { logAudit, genRequestId } = require("../lib/audit");
const { touchClient } = require("../lib/touchClient");
const { getConfig } = require("../lib/config");

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

const STATUS_ORDER = [
  "lead", "quoted", "scheduled", "in progress",
  "complete", "invoiced", "paid", "closed",
];

function statusIndex(s) {
  return STATUS_ORDER.indexOf((s || "").toLowerCase().trim());
}

function isForwardTransition(oldStatus, newStatus) {
  const oi = statusIndex(oldStatus);
  const ni = statusIndex(newStatus);
  if (oi < 0 || ni < 0) return false;
  return ni > oi;
}

function computeDepositBlocked(row) {
  const required = String(row.deposit_required || "").toLowerCase();
  if (required !== "true" && required !== "1" && required !== "yes") return false;
  const received = Number(row.deposit_received || 0);
  if (received > 0) return false;
  const override = String(row.deposit_override || "").toLowerCase();
  if (override === "true" || override === "1" || override === "yes") return false;
  return true;
}

function addrOneLine(prop) {
  if (!prop) return "";
  const parts = [prop.address_line1];
  if (prop.address_line2) parts.push(prop.address_line2);
  parts.push([prop.city, prop.state].filter(Boolean).join(", "));
  if (prop.zip) parts[parts.length - 1] += " " + prop.zip;
  return parts.filter(Boolean).join(", ");
}

function bestDate(row) {
  return (
    parseISODateSafe(row.updated_at) ||
    parseISODateSafe(row.created_at) ||
    new Date(0)
  );
}

async function handleGetRequests(req, res) {
  try {
    const parsed = url.parse(req.url, true);
    const q = normalizeStr(parsed.query.q || "");
    const status = normalizeStr(parsed.query.status || "");
    const limitRaw = Number(parsed.query.limit) || 200;
    const limit = Math.min(Math.max(1, limitRaw), 500);

    const [requests, clients, properties] = await Promise.all([
      readTab("Requests"),
      readTab("Clients"),
      readTab("Properties"),
    ]);

    const clientMap = {};
    for (const c of clients) { if (c.id) clientMap[c.id] = c; }
    const propMap = {};
    for (const p of properties) { if (p.id) propMap[p.id] = p; }

    let results = requests.map((r) => {
      const client = clientMap[r.client_id] || {};
      const prop = propMap[r.property_id] || null;
      return {
        id: r.id || "",
        created_at: r.created_at || "",
        updated_at: r.updated_at || "",
        client_id: r.client_id || "",
        property_id: r.property_id || "",
        summary: r.summary || "",
        status_code: r.status_code || "",
        lead_source: r.lead_source || "",
        deposit_required: r.deposit_required || "",
        deposit_received: r.deposit_received || "",
        deposit_override: r.deposit_override || "",
        estimated_value: r.estimated_value || "",
        client_name: client.name || "",
        property_address: addrOneLine(prop),
        deposit_gate_blocked: computeDepositBlocked(r),
      };
    });

    if (status && status !== "all") {
      results = results.filter((r) => normalizeStr(r.status_code) === status);
    }

    if (q) {
      results = results.filter((r) => {
        return [r.summary, r.client_name, r.property_address, r.status_code, r.lead_source]
          .some((f) => normalizeStr(f).includes(q));
      });
    }

    results.sort((a, b) => bestDate(b) - bestDate(a));
    results = results.slice(0, limit);

    json(res, 200, { ok: true, requests: results });
  } catch (err) {
    json(res, 500, { ok: false, error: err.message });
  }
}

async function handleCreateRequest(req, res) {
  try {
    const body = await readBody(req);
    const client_id = String(body.client_id || "").trim();
    const property_id = String(body.property_id || "").trim();
    const summary = String(body.summary || "").trim();

    if (!client_id) return json(res, 400, { ok: false, error: "client_id is required." });
    if (!summary) return json(res, 400, { ok: false, error: "summary is required." });

    const now = new Date().toISOString();
    const id = "REQ-" + Date.now();
    const request_id = genRequestId();

    const rowObj = {
      id,
      created_at: now,
      updated_at: now,
      client_id,
      property_id,
      lead_source: String(body.lead_source || "").trim(),
      summary,
      status_code: "Lead",
      deposit_required: body.deposit_required === true || body.deposit_required === "true" ? "true" : "false",
      deposit_received: String(body.deposit_received || "0"),
      deposit_override: "false",
      estimated_value: String(body.estimated_value || ""),
    };

    const sheets = await getSheetsClient();
    const spreadsheetId = process.env.CRM_SHEET_ID;
    const headersResp = await sheets.spreadsheets.values.get({
      spreadsheetId,
      range: "Requests!1:1",
    });
    const headers = (headersResp.data.values && headersResp.data.values[0]) || [];
    const row = headers.map((h) => rowObj[h] || "");

    await sheets.spreadsheets.values.append({
      spreadsheetId,
      range: "Requests!A:A",
      valueInputOption: "RAW",
      insertDataOption: "INSERT_ROWS",
      requestBody: { majorDimension: "ROWS", values: [row] },
    });

    logAudit({
      actor: "admin",
      action: "CREATE_REQUEST",
      entity_type: "request",
      entity_id: id,
      field: "summary",
      new_value: summary.substring(0, 120),
      source: "crm",
      request_id,
    });

    if (client_id) touchClient(client_id).catch(() => {});

    json(res, 201, { ok: true, request: rowObj });
  } catch (err) {
    json(res, 500, { ok: false, error: err.message });
  }
}

async function handleGetRequestDetail(req, res) {
  try {
    const requestId = decodeURIComponent(
      req.url.replace(/\?.*$/, "").replace("/api/requests/", "")
    );

    const [requests, clients, properties, timeRows, expenseRows, config] = await Promise.all([
      readTab("Requests"),
      readTab("Clients"),
      readTab("Properties"),
      readTab("Time"),
      readTab("Expenses"),
      getConfig(),
    ]);

    const request = requests.find((r) => r.id === requestId);
    if (!request) return json(res, 404, { ok: false, error: "Request not found." });

    const client = clients.find((c) => c.id === request.client_id) || {};
    const prop = properties.find((p) => p.id === request.property_id) || null;

    const totalMinutes = timeRows
      .filter((t) => t.lead_id === requestId || t.request_id === requestId)
      .reduce((sum, t) => sum + (Number(t.minutes) || 0), 0);

    const totalExpenses = expenseRows
      .filter((e) => e.lead_id === requestId || e.request_id === requestId)
      .reduce((sum, e) => sum + (Number(e.amount) || 0), 0);

    const laborRate = Number(config.labor_rate_tech) || 50;
    const laborCost = (totalMinutes / 60) * laborRate;
    const totalCost = laborCost + totalExpenses;
    const revenue = Number(request.estimated_value) || 0;

    json(res, 200, {
      ok: true,
      request: {
        id: request.id,
        created_at: request.created_at || "",
        updated_at: request.updated_at || "",
        client_id: request.client_id || "",
        property_id: request.property_id || "",
        summary: request.summary || "",
        status_code: request.status_code || "",
        lead_source: request.lead_source || "",
        deposit_required: request.deposit_required || "",
        deposit_received: request.deposit_received || "",
        deposit_override: request.deposit_override || "",
        estimated_value: request.estimated_value || "",
        deposit_gate_blocked: computeDepositBlocked(request),
      },
      client: {
        id: client.id || "",
        name: client.name || "",
        phone: client.phone || "",
        email: client.email || "",
      },
      property: prop
        ? { id: prop.id, address_line1: prop.address_line1 || "", city: prop.city || "", state: prop.state || "", zip: prop.zip || "" }
        : null,
      costing: {
        total_minutes: totalMinutes,
        labor_cost: Math.round(laborCost * 100) / 100,
        expense_cost: Math.round(totalExpenses * 100) / 100,
        total_cost: Math.round(totalCost * 100) / 100,
        revenue,
        gross_profit: Math.round((revenue - totalCost) * 100) / 100,
      },
    });
  } catch (err) {
    json(res, 500, { ok: false, error: err.message });
  }
}

async function handleUpdateRequest(req, res) {
  try {
    const requestId = decodeURIComponent(
      req.url.replace(/\?.*$/, "").replace("/api/requests/", "")
    );
    const body = await readBody(req);
    const rid = genRequestId();

    const sheets = await getSheetsClient();
    const spreadsheetId = process.env.CRM_SHEET_ID;

    const resp = await sheets.spreadsheets.values.get({
      spreadsheetId,
      range: "Requests!A1:Z5000",
    });
    const values = resp.data.values || [];
    if (values.length <= 1) return json(res, 404, { ok: false, error: "Request not found." });

    const headers = values[0].map((h) => String(h || "").trim());
    const idCol = headers.indexOf("id");
    if (idCol < 0) return json(res, 500, { ok: false, error: "Missing id column." });

    let rowIndex = -1;
    for (let r = 1; r < values.length; r++) {
      if (String(values[r][idCol] || "").trim() === requestId) {
        rowIndex = r;
        break;
      }
    }
    if (rowIndex < 0) return json(res, 404, { ok: false, error: "Request not found." });

    const currentRow = {};
    for (let i = 0; i < headers.length; i++) {
      currentRow[headers[i]] = values[rowIndex][i] != null ? String(values[rowIndex][i]) : "";
    }

    const EDITABLE = ["summary", "lead_source", "deposit_required", "deposit_received", "deposit_override", "estimated_value", "status_code"];
    const changes = [];

    for (const field of EDITABLE) {
      if (body[field] === undefined) continue;
      const newVal = String(body[field]).trim();
      const oldVal = currentRow[field] || "";
      if (newVal === oldVal) continue;

      if (field === "status_code") {
        if (!isForwardTransition(oldVal, newVal)) {
          return json(res, 400, {
            ok: false,
            code: "INVALID_TRANSITION",
            error: "Status can only move forward: " + oldVal + " -> " + newVal + " is not allowed.",
          });
        }

        const newLower = newVal.toLowerCase();

        if (newLower === "scheduled" || newLower === "in progress") {
          const depReq = String(body.deposit_required !== undefined ? body.deposit_required : currentRow.deposit_required || "").toLowerCase();
          const depRec = Number(body.deposit_received !== undefined ? body.deposit_received : currentRow.deposit_received || 0);
          const depOvr = String(body.deposit_override !== undefined ? body.deposit_override : currentRow.deposit_override || "").toLowerCase();

          const isRequired = depReq === "true" || depReq === "1" || depReq === "yes";
          const isOverridden = depOvr === "true" || depOvr === "1" || depOvr === "yes";

          if (isRequired && depRec <= 0 && !isOverridden) {
            logAudit({
              actor: "admin",
              action: "BLOCKED_DEPOSIT_GATE",
              entity_type: "request",
              entity_id: requestId,
              note: "Attempted transition to " + newVal,
              source: "crm",
              request_id: rid,
            });
            return json(res, 409, {
              ok: false,
              code: "DEPOSIT_REQUIRED",
              message: "Deposit required before scheduling.",
            });
          }
        }

        if (newLower === "complete") {
          const [timeRows] = await Promise.all([readTab("Time")]);
          const totalMin = timeRows
            .filter((t) => t.lead_id === requestId || t.request_id === requestId)
            .reduce((sum, t) => sum + (Number(t.minutes) || 0), 0);
          const adminOverride = String(body.admin_override || "").toLowerCase();
          if (totalMin <= 0 && adminOverride !== "true") {
            return json(res, 400, {
              ok: false,
              code: "COMPLETE_GATE",
              error: "Cannot mark Complete without logged time entries.",
            });
          }
        }

        if (newLower === "invoiced" || newLower === "paid" || newLower === "closed") {
          return json(res, 400, {
            ok: false,
            code: "NOT_IMPLEMENTED",
            error: newVal + " status transitions are coming soon.",
          });
        }
      }

      changes.push({ field, oldVal, newVal });
    }

    if (changes.length === 0) {
      return json(res, 200, { ok: true, message: "No changes.", request: currentRow });
    }

    const now = new Date().toISOString();
    const sheetRow = rowIndex + 1;
    const colLetter = (c) => {
      if (c < 26) return String.fromCharCode(65 + c);
      return String.fromCharCode(64 + Math.floor(c / 26)) + String.fromCharCode(65 + (c % 26));
    };

    const updates = [];
    for (const ch of changes) {
      const ci = headers.indexOf(ch.field);
      if (ci >= 0) {
        updates.push({ range: `Requests!${colLetter(ci)}${sheetRow}`, values: [[ch.newVal]] });
        currentRow[ch.field] = ch.newVal;
      }
    }

    const uaCol = headers.indexOf("updated_at");
    if (uaCol >= 0) {
      updates.push({ range: `Requests!${colLetter(uaCol)}${sheetRow}`, values: [[now]] });
      currentRow.updated_at = now;
    }

    if (updates.length > 0) {
      await sheets.spreadsheets.values.batchUpdate({
        spreadsheetId,
        requestBody: { valueInputOption: "RAW", data: updates },
      });
    }

    for (const ch of changes) {
      logAudit({
        actor: "admin",
        action: "UPDATE_REQUEST",
        entity_type: "request",
        entity_id: requestId,
        field: ch.field,
        old_value: ch.oldVal,
        new_value: ch.newVal,
        source: "crm",
        request_id: rid,
      });
    }

    if (currentRow.client_id) touchClient(currentRow.client_id).catch(() => {});

    json(res, 200, { ok: true, request: currentRow });
  } catch (err) {
    json(res, 500, { ok: false, error: err.message });
  }
}

module.exports = {
  handleGetRequests,
  handleCreateRequest,
  handleGetRequestDetail,
  handleUpdateRequest,
};

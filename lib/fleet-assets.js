// lib/fleet-assets.js — Basic Sheets-backed fleet/tools/inventory records
const { getSheetsClient, colToLetter } = require("./sheets");

const RESOURCES = {
  vehicles: {
    tab: "FleetVehicles",
    idField: "vehicle_id",
    prefix: "VEH",
    defaultStatus: "active",
    headers: [
      "vehicle_id", "created_at", "updated_at", "name", "unit_number", "traccar_device_id",
      "year", "make", "model", "vin", "license_plate", "assigned_driver", "status",
      "odometer", "registration_due", "insurance_due", "oil_change_due_mileage",
      "oil_change_due_date", "last_maintenance_date", "next_maintenance_due", "notes",
    ],
  },
  maintenance: {
    tab: "FleetMaintenance",
    idField: "maintenance_id",
    prefix: "FM",
    defaultStatus: "planned",
    headers: [
      "maintenance_id", "created_at", "updated_at", "vehicle_id", "date", "type",
      "odometer", "vendor", "cost", "receipt_url", "status", "next_due_date",
      "next_due_mileage", "notes",
    ],
  },
  tools: {
    tab: "ToolAssets",
    idField: "asset_id",
    prefix: "AST",
    defaultStatus: "active",
    headers: [
      "asset_id", "created_at", "updated_at", "name", "category", "brand", "model",
      "serial_number", "assigned_to", "assigned_vehicle", "location", "status",
      "purchase_date", "purchase_cost", "replacement_value", "notes",
    ],
  },
  "tool-issues": {
    tab: "ToolIssues",
    idField: "issue_id",
    prefix: "TI",
    defaultStatus: "open",
    headers: [
      "issue_id", "created_at", "updated_at", "asset_id", "tool_name", "issue_type",
      "reported_by", "reported_date", "severity", "status", "repair_cost",
      "resolved_date", "notes",
    ],
  },
  inventory: {
    tab: "InventoryItems",
    idField: "item_id",
    prefix: "INV",
    defaultStatus: "active",
    headers: [
      "item_id", "created_at", "updated_at", "item_name", "category", "unit",
      "default_vendor", "estimated_unit_cost", "status", "notes",
    ],
  },
  "truck-stock": {
    tab: "TruckStock",
    idField: "stock_id",
    prefix: "STK",
    defaultStatus: "not_counted",
    headers: [
      "stock_id", "created_at", "updated_at", "vehicle_id", "item_id", "item_name",
      "normal_quantity", "current_quantity", "reorder_point", "last_counted_at", "status", "notes",
    ],
  },
  "material-requests": {
    tab: "MaterialRequests",
    idField: "request_id",
    prefix: "MR",
    defaultStatus: "requested",
    headers: [
      "request_id", "created_at", "updated_at", "job_id", "lead_id", "vehicle_id",
      "requested_by", "item_id", "item_name", "quantity", "needed_by", "status",
      "vendor", "estimated_cost", "receipt_url", "notes",
    ],
  },
};

function spreadsheetId() {
  return process.env.CRM_SHEET_ID;
}

function resourceConfig(resource) {
  const cfg = RESOURCES[resource];
  if (!cfg) throw new Error("Unknown fleet asset resource: " + resource);
  return cfg;
}

function newId(prefix) {
  return prefix + "-" + Date.now() + "-" + Math.random().toString(16).slice(2, 6).toUpperCase();
}

async function ensureTab(tabName, headers) {
  const id = spreadsheetId();
  if (!id) throw new Error("CRM_SHEET_ID env var is required");
  const sheets = await getSheetsClient();
  let existing = [];

  try {
    const resp = await sheets.spreadsheets.values.get({ spreadsheetId: id, range: `${tabName}!1:1` });
    existing = (resp.data.values && resp.data.values[0]) || [];
  } catch (err) {
    if (err.code === 400 || String(err.message || "").includes("Unable to parse range")) {
      const meta = await sheets.spreadsheets.get({ spreadsheetId: id });
      const exists = (meta.data.sheets || []).some((s) => s.properties.title === tabName);
      if (!exists) {
        await sheets.spreadsheets.batchUpdate({
          spreadsheetId: id,
          requestBody: { requests: [{ addSheet: { properties: { title: tabName } } }] },
        });
      }
    } else {
      throw err;
    }
  }

  const clean = existing.map((h) => String(h || "").trim()).filter(Boolean);
  const missing = headers.filter((h) => !clean.includes(h));
  if (!clean.length || missing.length) {
    const finalHeaders = clean.length ? clean.concat(missing) : headers;
    await sheets.spreadsheets.values.update({
      spreadsheetId: id,
      range: `${tabName}!A1`,
      valueInputOption: "RAW",
      requestBody: { majorDimension: "ROWS", values: [finalHeaders] },
    });
  }
}

async function ensureFleetAssetSheets() {
  for (const cfg of Object.values(RESOURCES)) {
    await ensureTab(cfg.tab, cfg.headers);
  }
}

async function readRows(cfg) {
  await ensureTab(cfg.tab, cfg.headers);
  const id = spreadsheetId();
  const sheets = await getSheetsClient();
  const resp = await sheets.spreadsheets.values.get({ spreadsheetId: id, range: `${cfg.tab}!A:AZ` });
  const rows = resp.data.values || [];
  if (rows.length < 2) return [];
  const headers = rows[0];
  return rows.slice(1)
    .filter((r) => r && r.some((c) => String(c || "").trim()))
    .map((row) => {
      const obj = {};
      headers.forEach((h, i) => { obj[h] = String(row[i] || "").trim(); });
      return obj;
    })
    .sort((a, b) => String(b.updated_at || b.created_at || "").localeCompare(String(a.updated_at || a.created_at || "")));
}

async function listRecords(resource) {
  const cfg = resourceConfig(resource);
  return readRows(cfg);
}

function cleanPayload(cfg, payload, options = {}) {
  const out = {};
  const blocked = new Set([cfg.idField, "created_at"]);
  for (const h of cfg.headers) {
    if (blocked.has(h)) continue;
    if (h === "updated_at") continue;
    if (payload[h] !== undefined) out[h] = String(payload[h] ?? "").trim();
  }
  if (options.create && !out.status) out.status = cfg.defaultStatus;
  return out;
}

async function appendRecord(resource, payload) {
  const cfg = resourceConfig(resource);
  await ensureTab(cfg.tab, cfg.headers);
  const now = new Date().toISOString();
  const record = {
    ...cleanPayload(cfg, payload || {}, { create: true }),
    [cfg.idField]: newId(cfg.prefix),
    created_at: now,
    updated_at: now,
  };
  const row = cfg.headers.map((h) => String(record[h] ?? ""));
  const sheets = await getSheetsClient();
  await sheets.spreadsheets.values.append({
    spreadsheetId: spreadsheetId(),
    range: `${cfg.tab}!A:A`,
    valueInputOption: "RAW",
    insertDataOption: "INSERT_ROWS",
    requestBody: { majorDimension: "ROWS", values: [row] },
  });
  return record;
}

async function updateRecord(resource, idValue, payload) {
  const cfg = resourceConfig(resource);
  await ensureTab(cfg.tab, cfg.headers);
  const sheets = await getSheetsClient();
  const resp = await sheets.spreadsheets.values.get({ spreadsheetId: spreadsheetId(), range: `${cfg.tab}!A:AZ` });
  const rows = resp.data.values || [];
  if (rows.length < 2) return null;
  const headers = rows[0];
  const idCol = headers.indexOf(cfg.idField);
  if (idCol < 0) throw new Error(`Missing ${cfg.idField} header on ${cfg.tab}`);
  const rowIndex = rows.findIndex((r, i) => i > 0 && String(r[idCol] || "") === String(idValue));
  if (rowIndex < 0) return null;

  const row = [...rows[rowIndex]];
  while (row.length < headers.length) row.push("");
  const updates = cleanPayload(cfg, payload || {});
  updates.updated_at = new Date().toISOString();
  for (const [key, value] of Object.entries(updates)) {
    const col = headers.indexOf(key);
    if (col >= 0) row[col] = String(value ?? "");
  }
  const sheetRow = rowIndex + 1;
  await sheets.spreadsheets.values.update({
    spreadsheetId: spreadsheetId(),
    range: `${cfg.tab}!A${sheetRow}:${colToLetter(headers.length - 1)}${sheetRow}`,
    valueInputOption: "RAW",
    requestBody: { majorDimension: "ROWS", values: [row.slice(0, headers.length)] },
  });

  const updated = {};
  headers.forEach((h, i) => { updated[h] = String(row[i] || "").trim(); });
  return updated;
}

async function listAllFleetAssetData() {
  const result = {};
  for (const resource of Object.keys(RESOURCES)) {
    result[resource] = await listRecords(resource);
  }
  return result;
}

module.exports = {
  RESOURCES,
  ensureFleetAssetSheets,
  listRecords,
  appendRecord,
  updateRecord,
  listAllFleetAssetData,
};

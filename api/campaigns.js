// api/campaigns.js — Campaign Management Module (Task #72)
// Routes: GET/POST /api/marketing/campaigns, GET/PATCH /api/marketing/campaigns/:id
//         GET /api/marketing/campaigns/:id/metrics
//         GET/POST /api/marketing/landing-pages

const { getSheetsClient } = require("../lib/sheets");
const { marketingSpreadsheetId } = require("../lib/marketingSheetClient");
const crypto = require("crypto");

const BOOKED_STATUSES   = new Set(["scheduled", "in progress", "complete", "completed", "paid", "closed", "invoiced"]);
const COMPLETE_STATUSES = new Set(["complete", "completed", "paid", "closed", "invoiced"]);

const OWNER_DECISION_OPTIONS = [
  "Increase Budget", "Hold", "Reduce Budget", "Pause",
  "Fix Landing Page", "Fix Targeting", "Fix Call Handling", "Kill Campaign",
];

function json(res, code, data) {
  res.writeHead(code, { "Content-Type": "application/json" });
  res.end(JSON.stringify(data));
}

function readBody(req) {
  return new Promise((resolve) => {
    let body = "";
    req.on("data", c => (body += c));
    req.on("end", () => { try { resolve(JSON.parse(body)); } catch { resolve({}); } });
  });
}

async function readTabRows(sheets, spreadsheetId, tab) {
  try {
    const resp = await sheets.spreadsheets.values.get({ spreadsheetId, range: `${tab}!A:ZZ` });
    const rows = resp.data.values || [];
    if (rows.length < 1) return { headers: [], rows: [] };
    const headers = rows[0].map(h => String(h || "").trim());
    return { headers, rows: rows.slice(1) };
  } catch {
    return { headers: [], rows: [] };
  }
}

function toObj(headers, row) {
  const obj = {};
  headers.forEach((h, i) => { obj[h] = String(row[i] || "").trim(); });
  return obj;
}

function norm(v) { return String(v || "").trim().toLowerCase(); }

// Compute metrics for one campaign by scanning Leads tab
async function computeMetrics(sheets, crmId, utmCampaign, spend) {
  if (!utmCampaign) {
    return { leads: 0, booked: 0, completed: 0, revenue: 0, gross_profit: 0,
             cpl: null, cpbj: null, roas: null, gross_margin_pct: null };
  }

  const { headers, rows } = await readTabRows(sheets, crmId, "Leads");
  const utmIdx    = headers.indexOf("utm_campaign");
  const statusIdx = headers.indexOf("status");
  const invIdx    = headers.indexOf("invoiced_amount");
  const paidIdx   = headers.indexOf("paid_amount");

  if (utmIdx === -1) {
    return { leads: 0, booked: 0, completed: 0, revenue: 0, gross_profit: 0,
             cpl: null, cpbj: null, roas: null, gross_margin_pct: null };
  }

  let leads = 0, booked = 0, completed = 0, revenue = 0;

  for (const row of rows) {
    if (!row || !row.length || !String(row[0] || "").trim()) continue;
    const rowUtm = norm(row[utmIdx] || "");
    if (rowUtm !== norm(utmCampaign)) continue;
    leads++;
    const status = norm(row[statusIdx] || "");
    const inv    = Number(row[invIdx] || 0);
    const paid   = Number(row[paidIdx] || 0);
    const rev    = inv > 0 ? inv : paid;

    if (BOOKED_STATUSES.has(status)) {
      booked++;
      revenue += rev;
    }
    if (COMPLETE_STATUSES.has(status)) completed++;
  }

  const spendNum = Number(spend || 0);
  const estimatedCOGS = revenue * 0.6;
  const gross_profit  = revenue - estimatedCOGS;

  const cpl  = leads > 0 && spendNum > 0 ? Math.round((spendNum / leads) * 100) / 100 : null;
  const cpbj = booked > 0 && spendNum > 0 ? Math.round((spendNum / booked) * 100) / 100 : null;
  const roas = spendNum > 0 ? Math.round((revenue / spendNum) * 100) / 100 : null;
  const gross_margin_pct = revenue > 0 ? Math.round((gross_profit / revenue) * 1000) / 10 : null;

  return {
    leads, booked, completed,
    revenue: Math.round(revenue * 100) / 100,
    gross_profit: Math.round(gross_profit * 100) / 100,
    cpl, cpbj, roas, gross_margin_pct,
  };
}

// Filter Leads for a specific utm_campaign (for the detail page lead list)
async function getLeadsForCampaign(sheets, crmId, utmCampaign) {
  if (!utmCampaign) return [];
  const { headers, rows } = await readTabRows(sheets, crmId, "Leads");
  const utmIdx    = headers.indexOf("utm_campaign");
  const idIdx     = headers.indexOf("id");
  const nameIdx   = headers.indexOf("name");
  const phoneIdx  = headers.indexOf("phone");
  const statusIdx = headers.indexOf("status");
  const invIdx    = headers.indexOf("invoiced_amount");
  const paidIdx   = headers.indexOf("paid_amount");
  const createdIdx = headers.indexOf("created_at");

  if (utmIdx === -1) return [];
  const result = [];
  for (const row of rows) {
    if (!row || !row.length || !String(row[0] || "").trim()) continue;
    if (norm(row[utmIdx] || "") !== norm(utmCampaign)) continue;
    const inv = Number(row[invIdx] || 0);
    const paid = Number(row[paidIdx] || 0);
    result.push({
      id:         String(row[idIdx] || "").trim(),
      name:       String(row[nameIdx] || "").trim(),
      phone:      String(row[phoneIdx] || "").trim(),
      status:     String(row[statusIdx] || "").trim(),
      revenue:    inv > 0 ? inv : paid,
      created_at: String(row[createdIdx] || "").trim(),
    });
  }
  return result;
}

// GET /api/marketing/campaigns
async function handleListCampaigns(req, res) {
  try {
    const mktId = marketingSpreadsheetId();
    const sheets = await getSheetsClient();
    const crmId  = process.env.CRM_SHEET_ID;
    const { headers, rows } = await readTabRows(sheets, mktId, "Campaigns");
    if (!rows.length) return json(res, 200, { ok: true, campaigns: [] });

    const campaigns = await Promise.all(rows
      .filter(r => r && r.length && String(r[0] || "").trim())
      .map(async r => {
        const obj = toObj(headers, r);
        const metrics = await computeMetrics(sheets, crmId, obj.utm_campaign, obj.spend);
        return { ...obj, metrics };
      })
    );

    json(res, 200, { ok: true, campaigns });
  } catch (err) {
    json(res, 500, { ok: false, error: err.message });
  }
}

// POST /api/marketing/campaigns
async function handleCreateCampaign(req, res) {
  try {
    const body = await readBody(req);
    const mktId  = marketingSpreadsheetId();
    const sheets = await getSheetsClient();

    const id = "camp_" + crypto.randomBytes(6).toString("hex");
    const now = new Date().toISOString();

    const row = [
      id,
      body.name || "",
      body.channel || "",
      body.source || "",
      body.service_promoted || "",
      body.city_zone_targeted || "",
      body.start_date || "",
      body.end_date || "",
      String(body.budget || ""),
      String(body.spend || ""),
      body.landing_page || "",
      body.tracking_phone || "",
      body.utm_campaign || "",
      body.offer_message || "",
      body.contractor_vendor || "",
      body.status || "Active",
      body.owner_decision || "",
      body.notes || "",
      now,
    ];

    await sheets.spreadsheets.values.append({
      spreadsheetId: mktId,
      range: "Campaigns!A:S",
      valueInputOption: "RAW",
      insertDataOption: "INSERT_ROWS",
      requestBody: { majorDimension: "ROWS", values: [row] },
    });

    json(res, 200, { ok: true, campaign_id: id });
  } catch (err) {
    json(res, 500, { ok: false, error: err.message });
  }
}

// GET /api/marketing/campaigns/:id
async function handleGetCampaign(req, res, id) {
  try {
    const mktId  = marketingSpreadsheetId();
    const sheets = await getSheetsClient();
    const crmId  = process.env.CRM_SHEET_ID;
    const { headers, rows } = await readTabRows(sheets, mktId, "Campaigns");

    const rowData = rows.find(r => String(r[0] || "").trim() === id);
    if (!rowData) return json(res, 404, { ok: false, error: "Campaign not found" });

    const campaign = toObj(headers, rowData);
    const [metrics, leads] = await Promise.all([
      computeMetrics(sheets, crmId, campaign.utm_campaign, campaign.spend),
      getLeadsForCampaign(sheets, crmId, campaign.utm_campaign),
    ]);

    json(res, 200, { ok: true, campaign, metrics, leads });
  } catch (err) {
    json(res, 500, { ok: false, error: err.message });
  }
}

// PATCH /api/marketing/campaigns/:id
async function handleUpdateCampaign(req, res, id) {
  try {
    const body   = await readBody(req);
    const mktId  = marketingSpreadsheetId();
    const sheets = await getSheetsClient();
    const { headers, rows } = await readTabRows(sheets, mktId, "Campaigns");

    const rowIdx = rows.findIndex(r => String(r[0] || "").trim() === id);
    if (rowIdx === -1) return json(res, 404, { ok: false, error: "Campaign not found" });

    const existing = toObj(headers, rows[rowIdx]);
    const EDITABLE_FIELDS = [
      "name", "channel", "source", "service_promoted", "city_zone_targeted",
      "start_date", "end_date", "budget", "spend", "landing_page",
      "tracking_phone", "utm_campaign", "offer_message", "contractor_vendor",
      "status", "owner_decision", "notes",
    ];

    const updatedRow = [...(rows[rowIdx])];
    while (updatedRow.length < headers.length) updatedRow.push("");

    for (const field of EDITABLE_FIELDS) {
      if (body[field] !== undefined) {
        const colIdx = headers.indexOf(field);
        if (colIdx >= 0) updatedRow[colIdx] = String(body[field] || "");
      }
    }

    const sheetRow = rowIdx + 2;
    await sheets.spreadsheets.values.update({
      spreadsheetId: mktId,
      range: `Campaigns!A${sheetRow}`,
      valueInputOption: "RAW",
      requestBody: { majorDimension: "ROWS", values: [updatedRow] },
    });

    json(res, 200, { ok: true });
  } catch (err) {
    json(res, 500, { ok: false, error: err.message });
  }
}

// GET /api/marketing/campaigns/:id/metrics
async function handleGetCampaignMetrics(req, res, id) {
  try {
    const mktId  = marketingSpreadsheetId();
    const sheets = await getSheetsClient();
    const crmId  = process.env.CRM_SHEET_ID;
    const { headers, rows } = await readTabRows(sheets, mktId, "Campaigns");

    const rowData = rows.find(r => String(r[0] || "").trim() === id);
    if (!rowData) return json(res, 404, { ok: false, error: "Campaign not found" });

    const campaign = toObj(headers, rowData);
    const metrics  = await computeMetrics(sheets, crmId, campaign.utm_campaign, campaign.spend);
    json(res, 200, { ok: true, metrics });
  } catch (err) {
    json(res, 500, { ok: false, error: err.message });
  }
}

// GET /api/marketing/landing-pages
async function handleListLandingPages(req, res) {
  try {
    const qs = new URL(req.url, "http://x").searchParams;
    const filterUtm = (qs.get("utm_campaign") || "").trim().toLowerCase();

    const mktId  = marketingSpreadsheetId();
    const sheets = await getSheetsClient();
    const { headers, rows } = await readTabRows(sheets, mktId, "LandingPages");

    let pages = rows
      .filter(r => r && r.length && String(r[0] || "").trim())
      .map(r => toObj(headers, r));

    if (filterUtm) pages = pages.filter(p => norm(p.utm_campaign) === filterUtm);

    json(res, 200, { ok: true, pages });
  } catch (err) {
    json(res, 500, { ok: false, error: err.message });
  }
}

// POST /api/marketing/landing-pages
async function handleCreateLandingPage(req, res) {
  try {
    const body   = await readBody(req);
    const mktId  = marketingSpreadsheetId();
    const sheets = await getSheetsClient();

    const id  = "lp_" + crypto.randomBytes(6).toString("hex");
    const now = new Date().toISOString();

    const row = [
      id,
      body.url || "",
      body.title || "",
      body.service_type || "",
      body.city || "",
      body.utm_campaign || "",
      now,
      body.status || "Active",
      body.notes || "",
    ];

    await sheets.spreadsheets.values.append({
      spreadsheetId: mktId,
      range: "LandingPages!A:I",
      valueInputOption: "RAW",
      insertDataOption: "INSERT_ROWS",
      requestBody: { majorDimension: "ROWS", values: [row] },
    });

    json(res, 200, { ok: true, page_id: id });
  } catch (err) {
    json(res, 500, { ok: false, error: err.message });
  }
}

// PATCH /api/marketing/landing-pages/:id
async function handleUpdateLandingPage(req, res, id) {
  try {
    const body   = await readBody(req);
    const mktId  = marketingSpreadsheetId();
    const sheets = await getSheetsClient();
    const { headers, rows } = await readTabRows(sheets, mktId, "LandingPages");

    const rowIdx = rows.findIndex(r => String(r[0] || "").trim() === id);
    if (rowIdx === -1) return json(res, 404, { ok: false, error: "Landing page not found" });

    const updatedRow = [...(rows[rowIdx])];
    while (updatedRow.length < headers.length) updatedRow.push("");

    const EDITABLE = ["url", "title", "service_type", "city", "utm_campaign", "status", "notes"];
    for (const field of EDITABLE) {
      if (body[field] !== undefined) {
        const colIdx = headers.indexOf(field);
        if (colIdx >= 0) updatedRow[colIdx] = String(body[field] || "");
      }
    }

    const sheetRow = rowIdx + 2;
    await sheets.spreadsheets.values.update({
      spreadsheetId: mktId,
      range: `LandingPages!A${sheetRow}`,
      valueInputOption: "RAW",
      requestBody: { majorDimension: "ROWS", values: [updatedRow] },
    });

    json(res, 200, { ok: true });
  } catch (err) {
    json(res, 500, { ok: false, error: err.message });
  }
}

module.exports = {
  handleListCampaigns,
  handleCreateCampaign,
  handleGetCampaign,
  handleUpdateCampaign,
  handleGetCampaignMetrics,
  handleListLandingPages,
  handleCreateLandingPage,
  handleUpdateLandingPage,
  OWNER_DECISION_OPTIONS,
};

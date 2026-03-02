// api/quote-engine.js
// POST /api/quote/start   — create quote_id, log start event
// POST /api/quote/calc    — price without address, log priced event
// POST /api/quote/lock    — final price with travel fee, log locked event

const crypto = require("crypto");
const { getSheetsClient } = require("../lib/sheets");
const { getQuoteConfig } = require("../lib/sheetsConfig");
const { calculateQuote } = require("../lib/quoteEngine");

const SPREADSHEET_ID = () => process.env.CRM_SHEET_ID;

// ── Helpers ───────────────────────────────────────────────────────────────────

function nowIso() { return new Date().toISOString(); }
function newQuoteId() { return "QT-" + crypto.randomBytes(6).toString("hex").toUpperCase(); }
function newEventId() { return "EV-" + crypto.randomBytes(4).toString("hex").toUpperCase(); }

function parseBody(req) {
  return new Promise((resolve, reject) => {
    let body = "";
    req.on("data", c => (body += c));
    req.on("end", () => { try { resolve(JSON.parse(body || "{}")); } catch (e) { reject(e); } });
    req.on("error", reject);
  });
}

function json(res, status, payload) {
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(JSON.stringify(payload));
}

// Appends one row to QuoteSnapshots.
// Column order must match the schema:
// event_id, quote_id, created_at, event_type, job_type_id,
// selected_options_json, selected_addons_json, total_hours,
// labor_cost, overhead_cost, material_allowance, travel_fee,
// final_price, address_provided, pricing_version, status,
// customer_name, phone, email, address, notes
async function appendSnapshot(sheets, fields) {
  const row = [
    fields.event_id        ?? "",
    fields.quote_id        ?? "",
    fields.created_at      ?? nowIso(),
    fields.event_type      ?? "",
    fields.job_type_id     ?? "",
    fields.selected_options_json ?? "[]",
    fields.selected_addons_json  ?? "[]",
    String(fields.total_hours    ?? ""),
    String(fields.labor_cost     ?? ""),
    String(fields.overhead_cost  ?? ""),
    String(fields.material_allowance ?? ""),
    String(fields.travel_fee     ?? ""),
    String(fields.final_price    ?? ""),
    String(fields.address_provided ?? false),
    fields.pricing_version ?? "1",
    fields.status          ?? "",
    fields.customer_name   ?? "",
    fields.phone           ?? "",
    fields.email           ?? "",
    fields.address         ?? "",
    fields.notes           ?? "",
  ];

  await sheets.spreadsheets.values.append({
    spreadsheetId: SPREADSHEET_ID(),
    range: "QuoteSnapshots!A:A",
    valueInputOption: "RAW",
    insertDataOption: "INSERT_ROWS",
    requestBody: { majorDimension: "ROWS", values: [row] },
  });
}

// Resolve selected AnswerOption objects from config
function resolveOptions(config, answers) {
  const opts = [];
  for (const [qid, oid] of Object.entries(answers || {})) {
    const options = config.optionsByQuestion[qid] || [];
    const match = options.find(o => o.option_id === oid);
    if (match) opts.push(match);
  }
  return opts;
}

// Resolve selected AddOn objects from config
function resolveAddons(config, jobTypeId, addonIds) {
  const all = config.addonsByType[jobTypeId] || [];
  return all.filter(a => (addonIds || []).includes(a.addon_id));
}

// ── Handlers ──────────────────────────────────────────────────────────────────

async function handleQuoteStart(req, res) {
  try {
    const body = await parseBody(req);
    const quote_id = body.quote_id || newQuoteId();
    const created_at = nowIso();

    const sheets = await getSheetsClient();
    await appendSnapshot(sheets, {
      event_id: newEventId(),
      quote_id,
      created_at,
      event_type: "start",
      status: "started",
    });

    json(res, 200, { ok: true, quote_id });
  } catch (err) {
    console.error("[quote/start]", err.message);
    json(res, 500, { ok: false, error: err.message });
  }
}

async function handleQuoteCalc(req, res) {
  try {
    const body = await parseBody(req);
    const { quote_id, job_type_id, answers, addons } = body;

    if (!quote_id) return json(res, 400, { ok: false, error: "quote_id required" });
    if (!job_type_id) return json(res, 400, { ok: false, error: "job_type_id required" });

    const config = await getQuoteConfig();
    const jobType = config.jobTypes.find(j => j.job_type_id === job_type_id);
    if (!jobType) return json(res, 400, { ok: false, error: `Unknown job_type_id: ${job_type_id}` });

    const selectedOptions = resolveOptions(config, answers);
    const selectedAddons = resolveAddons(config, job_type_id, addons);

    // No address/zip at this stage
    const pricing = calculateQuote({
      jobType,
      selectedOptions,
      selectedAddons,
      rates: config.rates,
      serviceAreas: config.serviceAreas,
      zip: null,
    });

    const sheets = await getSheetsClient();
    await appendSnapshot(sheets, {
      event_id: newEventId(),
      quote_id,
      event_type: "priced",
      job_type_id,
      selected_options_json: JSON.stringify(answers || {}),
      selected_addons_json: JSON.stringify(addons || []),
      total_hours: pricing.hours,
      labor_cost: pricing.labor_cost,
      overhead_cost: pricing.overhead_cost,
      material_allowance: pricing.material_allowance,
      travel_fee: pricing.travel_fee,
      final_price: pricing.final_price,
      address_provided: false,
      pricing_version: pricing.pricing_version,
      status: "priced",
    });

    json(res, 200, { ok: true, quote_id, ...pricing });
  } catch (err) {
    console.error("[quote/calc]", err.message);
    json(res, 500, { ok: false, error: err.message });
  }
}

async function handleQuoteLock(req, res) {
  try {
    const body = await parseBody(req);
    const {
      quote_id, job_type_id, answers, addons,
      customer_name, phone, email, address, zip,
    } = body;

    if (!quote_id) return json(res, 400, { ok: false, error: "quote_id required" });
    if (!job_type_id) return json(res, 400, { ok: false, error: "job_type_id required" });

    const config = await getQuoteConfig();
    const jobType = config.jobTypes.find(j => j.job_type_id === job_type_id);
    if (!jobType) return json(res, 400, { ok: false, error: `Unknown job_type_id: ${job_type_id}` });

    const selectedOptions = resolveOptions(config, answers);
    const selectedAddons = resolveAddons(config, job_type_id, addons);

    // Derive ZIP: use explicit zip param first, then try to extract 5-digit code from address
    let resolvedZip = (zip && String(zip).trim()) || null;
    if (!resolvedZip && address) {
      const match = String(address).match(/\b(\d{5})\b/);
      if (match) resolvedZip = match[1];
    }

    const pricing = calculateQuote({
      jobType,
      selectedOptions,
      selectedAddons,
      rates: config.rates,
      serviceAreas: config.serviceAreas,
      zip: resolvedZip,
    });

    const sheets = await getSheetsClient();
    await appendSnapshot(sheets, {
      event_id: newEventId(),
      quote_id,
      event_type: "locked",
      job_type_id,
      selected_options_json: JSON.stringify(answers || {}),
      selected_addons_json: JSON.stringify(addons || []),
      total_hours: pricing.hours,
      labor_cost: pricing.labor_cost,
      overhead_cost: pricing.overhead_cost,
      material_allowance: pricing.material_allowance,
      travel_fee: pricing.travel_fee,
      final_price: pricing.final_price,
      address_provided: pricing.address_provided,
      pricing_version: pricing.pricing_version,
      status: pricing.photo_required ? "awaiting_photo" : "locked",
      customer_name: customer_name || "",
      phone: phone || "",
      email: email || "",
      address: address || "",
    });

    json(res, 200, {
      ok: true,
      quote_id,
      ...pricing,
      customer_name: customer_name || null,
    });
  } catch (err) {
    console.error("[quote/lock]", err.message);
    json(res, 500, { ok: false, error: err.message });
  }
}

module.exports = { handleQuoteStart, handleQuoteCalc, handleQuoteLock };

// api/quote-engine.js
// POST /api/quote/start   — create quote_id, log start event
// POST /api/quote/calc    — price without address, log priced event
// POST /api/quote/lock    — final price with travel fee, log locked event
//
// Engine selection:
//   ESTIMATOR_V2_SHEET_ID set → V2 engine (lib/quoteEngineV2)
//   otherwise                 → V1 engine (lib/quoteEngine)

const crypto = require("crypto");
const { getSheetsClient }  = require("../lib/sheets");
const { getActiveConfig, isV2Mode } = require("../lib/estimatorV2Config");
const { calculateQuote }   = require("../lib/quoteEngine");
const { calculateQuoteV2 } = require("../lib/quoteEngineV2");

const SPREADSHEET_ID = () => process.env.CRM_SHEET_ID;

// ── Helpers ───────────────────────────────────────────────────────────────────
function nowIso()    { return new Date().toISOString(); }
function newQuoteId(){ return "QT-" + crypto.randomBytes(6).toString("hex").toUpperCase(); }
function newEventId(){ return "EV-" + crypto.randomBytes(4).toString("hex").toUpperCase(); }

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
// Column order must match schema (21 cols):
// event_id, quote_id, created_at, event_type, job_type_id,
// selected_options_json, selected_addons_json, total_hours,
// labor_cost, overhead_cost, material_allowance, travel_fee,
// final_price, address_provided, pricing_version, status,
// customer_name, phone, email, address, notes
async function appendSnapshot(sheets, fields) {
  const row = [
    fields.event_id               ?? "",
    fields.quote_id               ?? "",
    fields.created_at             ?? nowIso(),
    fields.event_type             ?? "",
    fields.job_type_id            ?? "",
    fields.selected_options_json  ?? "[]",
    fields.selected_addons_json   ?? "[]",
    String(fields.total_hours     ?? ""),
    String(fields.labor_cost      ?? ""),
    String(fields.overhead_cost   ?? ""),
    String(fields.material_allowance ?? ""),
    String(fields.travel_fee      ?? ""),
    String(fields.final_price     ?? ""),
    String(fields.address_provided ?? false),
    fields.pricing_version        ?? "1",
    fields.status                 ?? "",
    fields.customer_name          ?? "",
    fields.phone                  ?? "",
    fields.email                  ?? "",
    fields.address                ?? "",
    fields.notes                  ?? "",
  ];
  await sheets.spreadsheets.values.append({
    spreadsheetId: SPREADSHEET_ID(),
    range: "QuoteSnapshots!A:A",
    valueInputOption: "RAW",
    insertDataOption: "INSERT_ROWS",
    requestBody: { majorDimension: "ROWS", values: [row] },
  });
}

// ── Option resolvers ──────────────────────────────────────────────────────────

// V1 — resolve AnswerOption objects from config
function resolveOptions(config, answers) {
  const opts = [];
  for (const [qid, oid] of Object.entries(answers || {})) {
    const options = config.optionsByQuestion[qid] || [];
    const match = options.find(o => o.option_id === oid);
    if (match) opts.push(match);
  }
  return opts;
}

// V1 — resolve selected AddOn objects
function resolveAddons(config, jobTypeId, addonIds) {
  const all = config.addonsByType[jobTypeId] || [];
  return all.filter(a => (addonIds || []).includes(a.addon_id));
}

// ── Qty application for V1 (server-side so client doesn't multiply) ───────────
// Scales a V1 pricing result by qty while keeping travel fee flat.
function applyQtyV1(pricing, qty) {
  qty = Math.max(1, Math.round(Number(qty) || 1));
  if (qty === 1) return pricing;
  const travel   = Number(pricing.travel_fee) || 0;
  const baseUnit = pricing.final_price - travel;
  const scaled   = baseUnit * qty + travel;
  return {
    ...pricing,
    final_price:        Math.round(scaled / 5) * 5,
    hours:              Math.round(pricing.hours * qty * 100) / 100,
    labor_cost:         Math.round(pricing.labor_cost * qty * 100) / 100,
    overhead_cost:      Math.round(pricing.overhead_cost * qty * 100) / 100,
    material_allowance: Math.round(pricing.material_allowance * qty * 100) / 100,
  };
}

// ── Unified price calculation ─────────────────────────────────────────────────
function computePrice({ config, jobType, answers, addons, qty, zip }) {
  qty = Math.max(1, Math.round(Number(qty) || 1));

  if (isV2Mode() && config._v2) {
    // V2 path: find full assembly row and call V2 engine
    const assembly = (config._v2.assemblies || []).find(
      a => a.assembly_id === jobType.job_type_id
    );
    if (!assembly) throw new Error(`Assembly not found for ${jobType.job_type_id}`);

    // Resolve driver multiplier options (stored in optionsByQuestion)
    const selectedDriverOptions = resolveOptions(config, answers);

    return calculateQuoteV2({
      assembly,
      qty,
      selectedDriverOptions,
      v2Data:       config._v2,
      serviceAreas: config.serviceAreas,
      zip,
    });
  }

  // V1 path: existing engine + qty scaling
  const selectedOptions = resolveOptions(config, answers);
  const selectedAddons  = resolveAddons(config, jobType.job_type_id, addons);
  const pricing = calculateQuote({
    jobType,
    selectedOptions,
    selectedAddons,
    rates:        config.rates,
    serviceAreas: config.serviceAreas,
    zip,
  });
  return applyQtyV1(pricing, qty);
}

// ── Handlers ──────────────────────────────────────────────────────────────────

async function handleQuoteStart(req, res) {
  try {
    const body = await parseBody(req);
    const quote_id   = body.quote_id || newQuoteId();
    const created_at = nowIso();

    const sheets = await getSheetsClient();
    await appendSnapshot(sheets, {
      event_id: newEventId(),
      quote_id,
      created_at,
      event_type: "start",
      status:     "started",
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
    const { quote_id, job_type_id, answers, addons, qty } = body;

    if (!quote_id)    return json(res, 400, { ok: false, error: "quote_id required" });
    if (!job_type_id) return json(res, 400, { ok: false, error: "job_type_id required" });

    const config  = await getActiveConfig();
    const jobType = config.jobTypes.find(j => j.job_type_id === job_type_id);
    if (!jobType) return json(res, 400, { ok: false, error: `Unknown job_type_id: ${job_type_id}` });

    const resolvedQty = Math.max(1, Math.round(Number(qty) || 1));
    const pricing = computePrice({ config, jobType, answers, addons, qty: resolvedQty, zip: null });

    const sheets = await getSheetsClient();
    await appendSnapshot(sheets, {
      event_id:             newEventId(),
      quote_id,
      event_type:           "priced",
      job_type_id,
      selected_options_json: JSON.stringify({ answers: answers || {}, qty: resolvedQty }),
      selected_addons_json:  JSON.stringify(addons || []),
      total_hours:           pricing.hours,
      labor_cost:            pricing.labor_cost,
      overhead_cost:         pricing.overhead_cost,
      material_allowance:    pricing.material_allowance,
      travel_fee:            pricing.travel_fee,
      final_price:           pricing.final_price,
      address_provided:      false,
      pricing_version:       pricing.pricing_version,
      status:                "priced",
    });

    json(res, 200, { ok: true, quote_id, qty: resolvedQty, ...pricing });
  } catch (err) {
    console.error("[quote/calc]", err.message);
    json(res, 500, { ok: false, error: err.message });
  }
}

async function handleQuoteLock(req, res) {
  try {
    const body = await parseBody(req);
    const {
      quote_id, job_type_id, answers, addons, qty,
      customer_name, phone, email, address, zip,
    } = body;

    if (!quote_id)    return json(res, 400, { ok: false, error: "quote_id required" });
    if (!job_type_id) return json(res, 400, { ok: false, error: "job_type_id required" });

    const config  = await getActiveConfig();
    const jobType = config.jobTypes.find(j => j.job_type_id === job_type_id);
    if (!jobType) return json(res, 400, { ok: false, error: `Unknown job_type_id: ${job_type_id}` });

    // Derive ZIP: explicit param first, then extract from address
    let resolvedZip = (zip && String(zip).trim()) || null;
    if (!resolvedZip && address) {
      const match = String(address).match(/\b(\d{5})\b/);
      if (match) resolvedZip = match[1];
    }

    const resolvedQty = Math.max(1, Math.round(Number(qty) || 1));
    const pricing = computePrice({ config, jobType, answers, addons, qty: resolvedQty, zip: resolvedZip });

    const sheets = await getSheetsClient();
    await appendSnapshot(sheets, {
      event_id:              newEventId(),
      quote_id,
      event_type:            "locked",
      job_type_id,
      selected_options_json: JSON.stringify({ answers: answers || {}, qty: resolvedQty }),
      selected_addons_json:  JSON.stringify(addons || []),
      total_hours:           pricing.hours,
      labor_cost:            pricing.labor_cost,
      overhead_cost:         pricing.overhead_cost,
      material_allowance:    pricing.material_allowance,
      travel_fee:            pricing.travel_fee,
      final_price:           pricing.final_price,
      address_provided:      pricing.address_provided,
      pricing_version:       pricing.pricing_version,
      status:                pricing.photo_required ? "awaiting_photo" : "locked",
      customer_name:         customer_name || "",
      phone:                 phone         || "",
      email:                 email         || "",
      address:               address       || "",
    });

    json(res, 200, {
      ok: true,
      quote_id,
      qty: resolvedQty,
      ...pricing,
      customer_name: customer_name || null,
    });
  } catch (err) {
    console.error("[quote/lock]", err.message);
    json(res, 500, { ok: false, error: err.message });
  }
}

module.exports = { handleQuoteStart, handleQuoteCalc, handleQuoteLock };

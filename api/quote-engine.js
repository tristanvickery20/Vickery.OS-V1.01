// api/quote-engine.js
// POST /api/quote/start   — create quote_id, log start event
// POST /api/quote/calc    — price without address, log priced event
// POST /api/quote/lock    — final price with travel fee, log locked event
//
// V2 engine only (lib/quoteEngineV2). ESTIMATOR_V2_SHEET_ID is required at startup.
//
// Classification enforcement (lib/serviceClassification):
//   MANUAL_QUOTE_ONLY      → blocked; returns manual_review response (no price)
//   READY_WITH_REVIEW_FLAG → priced; attaches material-gap disclosure + review flags
//   PRODUCTION_READY       → normal instant quote
//   UNCLASSIFIED           → allowed (raw V2 assembly, no estimator service mapping)

const crypto = require("crypto");
const { getSheetsClient }       = require("../lib/sheets");
const { getActiveConfig }       = require("../lib/estimatorV2Config");
const { hasGatePhoto }          = require("./photo-upload");
const { getEstimatorConfig }    = require("../lib/estimatorModulesConfig");
const { calculateQuoteV2 }      = require("../lib/quoteEngineV2");
const { getClassification, resolveServiceId } = require("../lib/serviceClassification");

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

// ── Source normalization ──────────────────────────────────────────────────────
const CANONICAL_SOURCES = [
  "GBP", "Organic SEO", "LSA", "Google Ads", "Direct",
  "Referral", "Yard Sign", "Truck Wrap", "Repeat Customer",
  "Facebook", "Manual Outreach", "Other",
];
function normalizeLeadSource(v) {
  if (!v) return "";
  const s = String(v).trim();
  if (!s) return "";
  const exact = CANONICAL_SOURCES.find(c => c.toLowerCase() === s.toLowerCase());
  if (exact) return exact;
  const sl = s.toLowerCase();
  if (sl.includes("gbp") || sl.includes("google business") || sl.includes("google maps")) return "GBP";
  if (sl.includes("lsa") || sl.includes("local service")) return "LSA";
  if (sl.includes("google ad")) return "Google Ads";
  if (sl.includes("organic") || sl.includes("seo")) return "Organic SEO";
  if (sl.includes("facebook") || sl.includes("fb") || sl.includes("meta")) return "Facebook";
  if (sl.includes("referral") || sl.includes("referred") || sl.includes("word of mouth")) return "Referral";
  if (sl.includes("yard sign") || sl.includes("sign")) return "Yard Sign";
  if (sl.includes("truck") || sl.includes("wrap") || sl.includes("van")) return "Truck Wrap";
  if (sl.includes("repeat") || sl.includes("returning") || sl.includes("previous")) return "Repeat Customer";
  if (sl.includes("direct") || sl.includes("walk") || sl.includes("call")) return "Direct";
  if (sl.includes("outreach") || sl.includes("door") || sl.includes("hanger")) return "Manual Outreach";
  return "Other";
}

// ── Lead upsert on lock ───────────────────────────────────────────────────────
// Creates or updates the Lead row so schedule-book can find it by last_quote_id.
// Non-fatal: any Sheets error is logged but does not break the quote response.
async function upsertLeadOnLock(sheets, { quote_id, job_type_id, customer_name, phone, address, pricing, lead_source, sms_opt_in, sms_marketing_consent, referrer_name, referrer_phone }) {
  try {
    const sheetId    = SPREADSHEET_ID();
    const cleanPhone = String(phone || "").replace(/\D/g, "");

    // ── 1. Search the Leads tab ──────────────────────────────────────────────
    const leadsRes = await sheets.spreadsheets.values.get({ spreadsheetId: sheetId, range: "Leads!A1:AZ5000" });
    const rows     = leadsRes.data.values || [];
    const headers  = rows[0] || [];
    const idxOf    = h => headers.indexOf(h);
    const phoneIdx = idxOf("phone");

    let foundRowIdx = -1;
    if (cleanPhone) {
      for (let i = 1; i < rows.length; i++) {
        const rPhone = String(rows[i][phoneIdx] || "").replace(/\D/g, "");
        if (rPhone === cleanPhone) { foundRowIdx = i; break; }
      }
    }

    if (foundRowIdx !== -1) {
      // Update existing Leads row — set last_quote_id and refresh pricing
      const row = [...(rows[foundRowIdx] || [])];
      while (row.length < headers.length) row.push("");
      const set = (h, v) => { const i = idxOf(h); if (i >= 0) row[i] = v; };
      set("last_quote_id",   quote_id);
      set("quoted_price",    String(pricing.final_price || ""));
      set("estimated_value", String(pricing.final_price || ""));
      set("pricing_version", pricing.pricing_version || "v2");
      if (!row[idxOf("name")]    && customer_name) set("name",    customer_name);
      if (!row[idxOf("address")] && address)       set("address", address);
      if (lead_source && !row[idxOf("lead_source")]) set("lead_source", normalizeLeadSource(lead_source));
      if (sms_opt_in)            set("sms_opt_in",            sms_opt_in);
      if (sms_marketing_consent) set("sms_marketing_consent", sms_marketing_consent);
      if (referrer_name)         set("referrer_name",         referrer_name);
      if (referrer_phone)        set("referrer_phone",        referrer_phone);
      const sIdx = idxOf("status");
      if (sIdx >= 0 && (!row[sIdx] || row[sIdx] === "Lead")) row[sIdx] = "Estimate Sent";
      await sheets.spreadsheets.values.update({
        spreadsheetId: sheetId,
        range:         `Leads!A${foundRowIdx + 1}`,
        valueInputOption: "RAW",
        requestBody:   { majorDimension: "ROWS", values: [row] },
      });
      console.log(`[quote/lock] Updated Leads row ${foundRowIdx + 1} last_quote_id=${quote_id}`);
      return;
    }

    // ── 2. Clients tab removed — Leads is the single source of truth.
    // Phone-match check already happened above in the Leads scan.
    // No separate Clients tab write needed.

    // ── 3. Genuinely new customer — append to Leads ──────────────────────────
    const leadId = "LEAD-" + crypto.randomBytes(4).toString("hex").toUpperCase();
    const now    = nowIso();
    const newRow = new Array(Math.max(headers.length, 27)).fill("");
    const set = (h, v) => { const i = idxOf(h); if (i >= 0) newRow[i] = v; };
    set("id",              leadId);
    set("created_at",      now);
    set("name",            customer_name || "");
    set("phone",           phone         || "");
    set("address",         address       || "");
    set("job_type",        job_type_id   || "");
    set("estimated_value", String(pricing.final_price || ""));
    set("status",          "Estimate Sent");
    set("quoted_price",    String(pricing.final_price || ""));
    set("pricing_version", pricing.pricing_version || "v2");
    set("last_quote_id",   quote_id);
    if (lead_source)            set("lead_source",            normalizeLeadSource(lead_source));
    if (sms_opt_in)             set("sms_opt_in",             sms_opt_in);
    if (sms_marketing_consent)  set("sms_marketing_consent",  sms_marketing_consent);
    if (referrer_name)          set("referrer_name",          referrer_name);
    if (referrer_phone)         set("referrer_phone",         referrer_phone);
    await sheets.spreadsheets.values.append({
      spreadsheetId: sheetId, range: "Leads!A:A",
      valueInputOption: "RAW", insertDataOption: "INSERT_ROWS",
      requestBody: { majorDimension: "ROWS", values: [newRow] },
    });
    console.log(`[quote/lock] Created Lead ${leadId} last_quote_id=${quote_id}`);
  } catch (err) {
    console.error("[quote/lock/upsertLead]", err.message);
  }
}

// ── Option resolvers ──────────────────────────────────────────────────────────

// Resolve AnswerOption objects from V2 config (used for module driver mapping).
function resolveOptions(config, answers) {
  const opts = [];
  for (const [qid, oid] of Object.entries(answers || {})) {
    const options = config.optionsByQuestion[qid] || [];
    const match = options.find(o => o.option_id === oid);
    if (match) opts.push(match);
  }
  return opts;
}

// ── Module-answer resolver ────────────────────────────────────────────────────
// Converts module-format answers { CEILING_HEIGHT: "lt9", ... } into:
//   selectedDriverOptions: [{ effect_type, effect_value }, ...]
//   disqualifiedBy: { question_id, option_id, label } | null
// Used server-side to apply enriched-question multipliers and disqualify rules.
function resolveModuleAnswers(modulesById, answers) {
  const selectedDriverOptions = [];
  let disqualifiedBy = null;
  for (const [mid, val] of Object.entries(answers || {})) {
    if (!val || val === "_unsure") continue;
    const mod = (modulesById || {})[mid];
    if (!mod) continue;
    const opt = (mod.options || []).find(o => o.value === val);
    if (!opt) continue;
    if (opt.disqualify) {
      disqualifiedBy = disqualifiedBy || { question_id: mid, option_id: val, label: opt.label };
    }
    const mult = Number(opt.multiplier);
    if (isFinite(mult) && mult !== 1.0) {
      selectedDriverOptions.push({
        effect_type:  "MULTIPLY_HOURS",
        effect_value: mult,
        _debug_source: `${mid}:${val}(×${mult})`,
      });
    }
  }
  return { selectedDriverOptions, disqualifiedBy };
}

// ── Disqualify check — checks both enriched (module) and V2 driver options ───
function checkDisqualify(config, modulesById, answers) {
  // 1. Module-based disqualify (enriched questions: CEILING_HEIGHT, PROPERTY_TYPE, etc.)
  const { disqualifiedBy } = resolveModuleAnswers(modulesById, answers);
  if (disqualifiedBy) return disqualifiedBy;
  // 2. V2 driver-based disqualify (non-enriched questions from optionsByQuestion)
  for (const [qid, oid] of Object.entries(answers || {})) {
    const options = config.optionsByQuestion[qid] || [];
    const match   = options.find(o => o.option_id === oid);
    if (match?.disqualify) return { question_id: qid, option_id: oid, label: match.label };
  }
  return null;
}

// ── Unified price calculation ─────────────────────────────────────────────────
// prebuiltDriverOptions: if provided, use instead of resolveOptions (module-format answers)
// stackCap: combined multiplier ceiling from service classification (null = no cap)
function computePrice({ config, jobType, answers, addons, qty, zip, prebuiltDriverOptions, stackCap }) {
  qty = Math.max(1, Math.round(Number(qty) || 1));

  if (config._v2) {
    // V2 path: find full assembly row and call V2 engine
    const assembly = (config._v2.assemblies || []).find(
      a => a.assembly_id === jobType.job_type_id
    );
    if (!assembly) throw new Error(`Assembly not found for ${jobType.job_type_id}`);

    // Use pre-resolved module options when available; fall back to V2 driver options
    const moduleDriverOpts  = prebuiltDriverOptions || [];
    const v2DriverOpts      = resolveOptions(config, answers);
    const selectedDriverOptions = [...moduleDriverOpts, ...v2DriverOpts];

    return calculateQuoteV2({
      assembly,
      qty,
      selectedDriverOptions,
      v2Data:       config._v2,
      serviceAreas: config.serviceAreas,
      zip,
      stackCap:     stackCap ?? null,
    });
  }

  // No V2 assembly found — unclassified service type, cannot price.
  throw new Error(`No V2 assembly found for job type: ${jobType?.job_type_id || "unknown"}`);
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
    const { quote_id, job_type_id, answers, addons, qty, photo_modules_uploaded } = body;

    if (!quote_id)    return json(res, 400, { ok: false, error: "quote_id required" });
    if (!job_type_id) return json(res, 400, { ok: false, error: "job_type_id required" });

    const [config, estRaw] = await Promise.all([getActiveConfig(), getEstimatorConfig().catch(() => ({ modulesById: {} }))]);
    const jobType = config.jobTypes.find(j => j.job_type_id === job_type_id);
    if (!jobType) return json(res, 400, { ok: false, error: `Unknown job_type_id: ${job_type_id}` });

    const resolvedQty  = Math.max(1, Math.round(Number(qty) || 1));
    const modulesById  = estRaw.modulesById || {};

    // ── Classification enforcement ────────────────────────────────────────────
    const serviceId    = resolveServiceId(job_type_id);
    const cls          = getClassification(serviceId);

    if (!cls.quoteAllowed) {
      console.log(`[quote/calc] BLOCKED job_type_id=${job_type_id} service=${serviceId} status=${cls.status} reason=${cls.blockerReason}`);
      const sheets = await getSheetsClient();
      await appendSnapshot(sheets, {
        event_id: newEventId(), quote_id, event_type: "blocked",
        job_type_id, status: "manual_review_required",
        notes: cls.blockerReason,
      });
      return json(res, 200, {
        ok: true, quote_id, qty: resolvedQty,
        final_price: 0, hours: 0, labor_cost: 0, overhead_cost: 0,
        material_allowance: 0, travel_fee: 0, address_provided: false,
        pricing_version: "v2",
        evaluation_flag: true,
        manual_review_required: true,
        classification: cls.status,
        disqualify_reason: cls.blockerReason,
        ballparkRange: cls.ballparkRange || null,
        _trace: { service_id: serviceId, classification: cls.status, quote_allowed: false, blocker: cls.blockerReason },
      });
    }

    // ── Server-side photo gate enforcement ───────────────────────────────────
    // For photo-gated services, verify that the required module photos have been
    // actually uploaded to the server for this quote session (not just client-declared).
    // hasGatePhoto() checks the in-process upload registry in api/photo-upload.js.
    if (cls.photoGate) {
      const requiredModules = cls.photoGateModules
        || (cls.photoGateModule ? [cls.photoGateModule] : []);
      const missing = requiredModules.filter(m => !hasGatePhoto(quote_id, m));
      if (missing.length > 0) {
        return json(res, 400, {
          ok: false,
          photo_gate_required: true,
          missing_modules: missing,
          error: `This service requires photos (${missing.join(", ")}) to be uploaded before pricing. Please use the quote form at vickeryelectric.com/quote.`,
        });
      }
    }

    // Resolve module-format answers (CEILING_HEIGHT, WALL_TYPE, etc.) → driver options + disqualify
    const { selectedDriverOptions: moduleDriverOpts, disqualifiedBy } = resolveModuleAnswers(modulesById, answers);

    // Server-side disqualify guard (module-based + V2 driver-based)
    const disq = disqualifiedBy || checkDisqualify(config, {}, answers);
    if (disq) {
      console.log(`[quote/calc] disqualified qid=${disq.question_id} opt=${disq.option_id}`);
      return json(res, 200, {
        ok: true, quote_id, qty: resolvedQty,
        final_price: 0, hours: 0, labor_cost: 0, overhead_cost: 0,
        material_allowance: 0, travel_fee: 0, address_provided: false,
        pricing_version: "v2", evaluation_flag: true,
        disqualify_reason: `"${disq.label}" requires an on-site evaluation.`,
        _trace: { service_id: serviceId, classification: cls.status, disqualified_by: disq },
      });
    }

    const pricing = computePrice({
      config, jobType, answers, addons, qty: resolvedQty, zip: null,
      prebuiltDriverOptions: moduleDriverOpts,
      stackCap: cls.stackCap,
    });

    if (moduleDriverOpts.length) {
      console.log(`[quote/calc] ${job_type_id} module drivers: ${moduleDriverOpts.map(d => d._debug_source).join(", ")}`);
    }
    if (pricing.stack_cap_trace?.cap_applied) {
      console.log(`[quote/calc] stack cap applied: ${job_type_id} uncapped=${pricing.stack_cap_trace.uncapped_multiplier} → capped=${pricing.stack_cap_trace.applied_multiplier}`);
    }

    // Build response — attach review flags for READY_WITH_REVIEW_FLAG services
    const responsePayload = {
      ok: true, quote_id, qty: resolvedQty,
      ...pricing,
      _trace: {
        service_id:            serviceId,
        classification:        cls.status,
        quote_allowed:         true,
        review_flag:           cls.reviewFlag,
        material_gap:          cls.materialGap,
        stack_cap_configured:  cls.stackCap,
        drivers_applied:       moduleDriverOpts.map(d => d._debug_source),
        uncapped_multiplier:   pricing.stack_cap_trace?.uncapped_multiplier,
        capped_multiplier:     pricing.stack_cap_trace?.applied_multiplier,
        cap_applied:           pricing.stack_cap_trace?.cap_applied,
      },
    };

    if (cls.reviewFlag) {
      responsePayload.review_flag         = true;
      responsePayload.material_disclosure = cls.materialNote || "Material allowance is $0 (placeholder data). Materials to be confirmed and added at actuals.";
    }

    const sheets = await getSheetsClient();
    await appendSnapshot(sheets, {
      event_id:             newEventId(),
      quote_id,
      event_type:           "priced",
      job_type_id,
      selected_options_json: JSON.stringify({ answers: answers || {}, qty: resolvedQty, classification: cls.status }),
      selected_addons_json:  JSON.stringify(addons || []),
      total_hours:           pricing.hours,
      labor_cost:            pricing.labor_cost,
      overhead_cost:         pricing.overhead_cost,
      material_allowance:    pricing.material_allowance,
      travel_fee:            pricing.travel_fee,
      final_price:           pricing.final_price,
      address_provided:      false,
      pricing_version:       pricing.pricing_version,
      status:                cls.reviewFlag ? "priced_review_required" : "priced",
    });

    json(res, 200, responsePayload);
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
      customer_name, phone, email, address, zip, lead_source,
      sms_opt_in, sms_marketing_consent,
      equipment_line_items,
      referrer_name, referrer_phone,
    } = body;

    if (!quote_id)    return json(res, 400, { ok: false, error: "quote_id required" });
    if (!job_type_id) return json(res, 400, { ok: false, error: "job_type_id required" });

    const [config, estRaw] = await Promise.all([getActiveConfig(), getEstimatorConfig().catch(() => ({ modulesById: {} }))]);
    const jobType = config.jobTypes.find(j => j.job_type_id === job_type_id);
    if (!jobType) return json(res, 400, { ok: false, error: `Unknown job_type_id: ${job_type_id}` });

    // ── Classification enforcement ────────────────────────────────────────────
    const serviceId = resolveServiceId(job_type_id);
    const cls       = getClassification(serviceId);

    if (!cls.quoteAllowed) {
      console.log(`[quote/lock] BLOCKED job_type_id=${job_type_id} service=${serviceId} status=${cls.status}`);
      const sheets = await getSheetsClient();
      await appendSnapshot(sheets, {
        event_id: newEventId(), quote_id, event_type: "blocked",
        job_type_id, status: "manual_review_required",
        customer_name: customer_name || "", phone: phone || "", email: email || "",
        address: address || "", notes: cls.blockerReason,
      });
      return json(res, 200, {
        ok: true, quote_id, qty: Math.max(1, Math.round(Number(qty) || 1)),
        final_price: 0, hours: 0, labor_cost: 0, overhead_cost: 0,
        material_allowance: 0, travel_fee: 0, address_provided: false,
        pricing_version: "v2",
        evaluation_flag: true,
        manual_review_required: true,
        classification: cls.status,
        disqualify_reason: cls.blockerReason,
        ballparkRange: cls.ballparkRange || null,
        _trace: { service_id: serviceId, classification: cls.status, quote_allowed: false, blocker: cls.blockerReason },
      });
    }

    // Derive ZIP: explicit param first, then extract from address
    let resolvedZip = (zip && String(zip).trim()) || null;
    if (!resolvedZip && address) {
      const match = String(address).match(/\b(\d{5})\b/);
      if (match) resolvedZip = match[1];
    }

    const resolvedQty  = Math.max(1, Math.round(Number(qty) || 1));
    const modulesById  = estRaw.modulesById || {};
    const { selectedDriverOptions: moduleDriverOpts } = resolveModuleAnswers(modulesById, answers);

    const pricing = computePrice({
      config, jobType, answers, addons, qty: resolvedQty, zip: resolvedZip,
      prebuiltDriverOptions: moduleDriverOpts,
      stackCap: cls.stackCap,
    });

    if (pricing.stack_cap_trace?.cap_applied) {
      console.log(`[quote/lock] stack cap applied: ${job_type_id} uncapped=${pricing.stack_cap_trace.uncapped_multiplier} → capped=${pricing.stack_cap_trace.applied_multiplier}`);
    }

    const lockResponse = {
      ok: true, quote_id, qty: resolvedQty,
      ...pricing,
      customer_name: customer_name || null,
      _trace: {
        service_id:           serviceId,
        classification:       cls.status,
        quote_allowed:        true,
        review_flag:          cls.reviewFlag,
        material_gap:         cls.materialGap,
        stack_cap_configured: cls.stackCap,
        cap_applied:          pricing.stack_cap_trace?.cap_applied,
        uncapped_multiplier:  pricing.stack_cap_trace?.uncapped_multiplier,
        capped_multiplier:    pricing.stack_cap_trace?.applied_multiplier,
      },
    };

    if (cls.reviewFlag) {
      lockResponse.review_flag         = true;
      lockResponse.material_disclosure = cls.materialNote || "Material allowance is $0 (placeholder data). Materials to be confirmed and added at actuals.";
    }

    const sheets = await getSheetsClient();
    const referrerNote = (referrer_name || referrer_phone)
      ? `Referred by: ${referrer_name || ""}${referrer_phone ? " " + referrer_phone : ""}`.trim()
      : "";

    await appendSnapshot(sheets, {
      event_id:              newEventId(),
      quote_id,
      event_type:            "locked",
      job_type_id,
      selected_options_json: JSON.stringify({ answers: answers || {}, qty: resolvedQty, classification: cls.status, equipment_line_items: equipment_line_items || [] }),
      selected_addons_json:  JSON.stringify(addons || []),
      total_hours:           pricing.hours,
      labor_cost:            pricing.labor_cost,
      overhead_cost:         pricing.overhead_cost,
      material_allowance:    pricing.material_allowance,
      travel_fee:            pricing.travel_fee,
      final_price:           pricing.final_price,
      address_provided:      pricing.address_provided,
      pricing_version:       pricing.pricing_version,
      status:                cls.reviewFlag ? "locked_review_required" : (pricing.photo_required ? "awaiting_photo" : "locked"),
      customer_name:         customer_name || "",
      phone:                 phone         || "",
      email:                 email         || "",
      address:               address       || "",
      notes:                 referrerNote,
    });

    // Upsert the Lead row so the booking can find it by last_quote_id
    await upsertLeadOnLock(sheets, { quote_id, job_type_id, customer_name, phone, address, pricing, lead_source: lead_source || "", sms_opt_in: sms_opt_in || "", sms_marketing_consent: sms_marketing_consent || "", referrer_name: referrer_name || "", referrer_phone: referrer_phone || "" });

    json(res, 200, lockResponse);
  } catch (err) {
    console.error("[quote/lock]", err.message);
    json(res, 500, { ok: false, error: err.message });
  }
}

// ── Consult request handler ───────────────────────────────────────────────────
// POST /api/quote/consult-request
// Captures lead info for services that are manual-quote-only.
// Creates a Leads row tagged consult_request and fires an owner SMS alert.
async function handleConsultRequest(req, res) {
  try {
    const body = await parseBody(req);
    const { name, phone, address, best_time, service_id, service_name, quote_id } = body;

    if (!name || !String(name).trim())  return json(res, 400, { ok: false, error: "name required" });
    if (!phone || !String(phone).trim()) return json(res, 400, { ok: false, error: "phone required" });
    const cleanPhone = String(phone).replace(/\D/g, "");
    if (cleanPhone.length < 10) return json(res, 400, { ok: false, error: "Please enter a valid phone number" });

    const sheetId = SPREADSHEET_ID();
    const sheets  = await getSheetsClient();

    const leadId = "LEAD-" + crypto.randomBytes(4).toString("hex").toUpperCase();
    const now    = new Date().toISOString();

    const leadsRes = await sheets.spreadsheets.values.get({ spreadsheetId: sheetId, range: "Leads!A1:Z1" });
    const headers  = (leadsRes.data.values || [[]])[0] || [];
    const idxOf    = h => headers.indexOf(h);

    const newRow = new Array(Math.max(headers.length, 27)).fill("");
    const set    = (h, v) => { const i = idxOf(h); if (i >= 0) newRow[i] = v; };
    set("id",          leadId);
    set("created_at",  now);
    set("name",        name    || "");
    set("phone",       phone   || "");
    set("job_type",    service_id   || "");
    set("status",      "Consult Request");
    set("lead_type",   "consult_request");
    set("notes",       [
      service_name ? `Service: ${service_name}` : "",
      address      ? `Address: ${address}`       : "",
      best_time    ? `Availability: ${best_time}` : "",
      quote_id     ? `Quote session: ${quote_id}` : "",
    ].filter(Boolean).join(" | "));
    set("estimated_value", "");
    set("lead_source",     "Website");

    await sheets.spreadsheets.values.append({
      spreadsheetId: sheetId, range: "Leads!A:A",
      valueInputOption: "RAW", insertDataOption: "INSERT_ROWS",
      requestBody: { majorDimension: "ROWS", values: [newRow] },
    });
    console.log(`[consult-request] Created Lead ${leadId} service=${service_id} phone=${phone}`);

    const ownerPhone = process.env.OWNER_PHONE;
    if (ownerPhone) {
      const { sendSms, buildMessage, CONSULT_TEMPLATES } = require("../lib/sms");
      const svcLabel = service_name || service_id || "Unknown service";
      const msg = buildMessage(CONSULT_TEMPLATES.CONSULT_REQUEST_ADMIN, {
        name:       name        || "Unknown",
        phone:      phone       || "",
        service:    svcLabel,
        address:    address     || "Not provided",
        best_time:  best_time   || "Any time",
      });
      sendSms(ownerPhone, msg).catch(err => console.error("[consult-request] SMS error:", err.message));
    }

    json(res, 200, { ok: true, lead_id: leadId });
  } catch (err) {
    console.error("[consult-request]", err.message);
    json(res, 500, { ok: false, error: err.message });
  }
}

module.exports = { handleQuoteStart, handleQuoteCalc, handleQuoteLock, handleConsultRequest, computePrice, resolveModuleAnswers };

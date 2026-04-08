// api/crew.js — lightweight helpers for the Crew Portal
// GET /api/crew/members — returns list of crew member names from Config tab
// GET /api/crew/today  — returns today's bookings (date-filtered, public endpoint)
// POST /api/crew/generate-invoice — generate invoice from a completed booking

const crypto                 = require("crypto");
const { getSheetsClient }    = require("../lib/sheets");
const { getConfig }          = require("../lib/config");
const { getEstimatorConfig } = require("../lib/estimatorModulesConfig");
const { getActiveConfig }    = require("../lib/estimatorV2Config");
const { computePrice, resolveModuleAnswers } = require("./quote-engine");
const { getCrewSession }     = require("../lib/staff");

let ASSEMBLY_TO_SERVICE = {};
try { ASSEMBLY_TO_SERVICE = require("../lib/serviceClassification").ASSEMBLY_TO_SERVICE || {}; } catch { /* optional */ }

// Modules to skip — photos and internal-only fields
const SKIP_MODULES = new Set(["WORK_AREA_PHOTOS", "PANEL_PHOTO", "UNCERTAINTY_BUFFER"]);

// Short plain-English labels for scope item fields shown to crew.
// Falls back to title-casing the moduleId (e.g. CEILING_HEIGHT → "Ceiling Height").
function shortLabel(moduleId) {
  const MAP = {
    PROPERTY_TYPE:        "Property",
    HOME_AGE:             "Building Age",
    BUILDING_AGE:         "Building Age",
    CEILING_HEIGHT:       "Ceiling Height",
    ATTIC_ACCESS:         "Attic Access",
    PANEL_BRAND:          "Panel Brand",
    PANEL_LOCATION:       "Panel Location",
    SERVICE_SIZE:         "Service Size",
    SERVICE_AMPS:         "Service Amps",
    WIRING_TYPE:          "Wiring Type",
    GROUNDING:            "Grounding",
    SWITCH_TYPE:          "Switch Type",
    SWITCH_LOCATION:      "Switch Location",
    OUTLET_TYPE:          "Outlet Type",
    FIXTURE_TYPE:         "Fixture Type",
    FAN_MOTOR_AMPS:       "Fan Motor Amps",
    CIRCUIT_AMPERAGE:     "Circuit Amps",
    WIRE_GAUGE:           "Wire Gauge",
    CONDUIT_TYPE:         "Conduit",
    JUNCTION_BOX:         "Junction Box",
    BREAKER_BRAND:        "Breaker Brand",
    BREAKER_AMPS:         "Breaker Amps",
    GFCI_REQUIRED:        "GFCI Required",
    PERMIT_REQUIRED:      "Permit Required",
    HOME_TYPE:            "Home Type",
    PROPERTY_CONDITION:   "Condition",
  };
  if (MAP[moduleId]) return MAP[moduleId];
  // Fallback: convert SOME_MODULE_ID → "Some Module Id" and clean up
  return moduleId
    .replace(/_/g, " ")
    .toLowerCase()
    .replace(/\b\w/g, c => c.toUpperCase());
}

function json(res, status, data) {
  res.writeHead(status, { "Content-Type": "application/json", "Cache-Control": "no-store" });
  res.end(JSON.stringify(data));
}

function todayLocalStr() {
  // Orange TX is CST/CDT (UTC-6/UTC-5). Use local date string.
  const d = new Date();
  const offset = d.getTimezoneOffset(); // minutes
  const local = new Date(d.getTime() - offset * 60000);
  return local.toISOString().slice(0, 10); // "YYYY-MM-DD"
}

// Decode a QuoteSnapshot into structured crew-readable items using the estimator module system.
// This is the same approach as the Lead Detail "Quote Breakdown" section.
// Returns { items: [{label, value}], qty, classification, addons: [] }
function buildScopeItems(selectedOptionsJson, selectedAddonsJson, modulesById) {
  const items = [];
  let qty = 1;
  let classification = "";
  const addons = [];

  try {
    const raw = JSON.parse(selectedOptionsJson || "{}");
    if (!Array.isArray(raw)) {
      const answers  = raw.answers        || {};
      qty            = Number(raw.qty)    || 1;
      classification = raw.classification || "";

      for (const [moduleId, value] of Object.entries(answers)) {
        if (!value || value === "_unsure" || value === "" || SKIP_MODULES.has(moduleId)) continue;
        const mod = modulesById[moduleId];
        let answer = String(value);
        if (mod && mod.options && mod.options.length) {
          const opt = mod.options.find(o => o.value === value || o.option_id === value);
          if (opt) answer = opt.label || String(value);
        }
        items.push({ label: shortLabel(moduleId), value: answer });
      }
    }
  } catch (_) { /* malformed JSON — skip */ }

  try {
    const addonIds = JSON.parse(selectedAddonsJson || "[]");
    for (const aid of addonIds) {
      if (aid && String(aid).trim()) addons.push(String(aid).trim());
    }
  } catch (_) { /* skip */ }

  return { items, qty, classification, addons };
}

async function handleGetCrewMembers(req, res) {
  try {
    const cfg = await getConfig();
    const raw = cfg.crew_members || "";
    const members = raw
      .split(",")
      .map(s => s.trim())
      .filter(Boolean);
    json(res, 200, { ok: true, members });
  } catch (err) {
    json(res, 500, { ok: false, error: err.message, members: [] });
  }
}

async function handleGetTodayJobs(req, res) {
  try {
    const sheets = await getSheetsClient();
    const spreadsheetId = process.env.CRM_SHEET_ID;
    if (!spreadsheetId) return json(res, 200, { ok: true, jobs: [] });

    // Fetch bookings, quote snapshots, and estimator config in parallel
    const [bookingsResp, quotesResp, estCfg] = await Promise.all([
      sheets.spreadsheets.values.get({ spreadsheetId, range: "Bookings!A:Z" }),
      sheets.spreadsheets.values.get({ spreadsheetId, range: "QuoteSnapshots!A:Z" }).catch(() => ({ data: { values: [] } })),
      getEstimatorConfig().catch(() => null),
    ]);

    const modulesById = estCfg ? estCfg.modulesById : {};
    const services    = estCfg ? estCfg.services    : [];

    // Build job type name lookup: job_type_id (or assembly ID) → service_name
    function resolveJobTypeName(rawId) {
      if (!rawId) return "";
      const serviceId = ASSEMBLY_TO_SERVICE[rawId] || rawId;
      const svc = services.find(s => s.service_id === serviceId);
      return svc ? svc.service_name : rawId.replace(/_/g, " ").replace(/\b\w/g, c => c.toUpperCase());
    }

    const rows = bookingsResp.data.values || [];
    if (rows.length < 2) return json(res, 200, { ok: true, jobs: [] });

    const [headers, ...data] = rows;
    const idx = Object.fromEntries(headers.map((h, i) => [h, i]));

    // Build QuoteSnapshots lookup: quote_id → { selected_options_json, selected_addons_json, job_type_id }
    // Prefer "locked" event rows (same as Lead Detail page)
    const snapshotMap = {};
    const qRows = quotesResp.data.values || [];
    if (qRows.length > 1) {
      const [qHeaders, ...qData] = qRows;
      const qi = Object.fromEntries(qHeaders.map((h, i) => [h, i]));
      qData.forEach(r => {
        const qid      = String(r[qi["quote_id"]              ?? -1] ?? "").trim();
        const evtType  = String(r[qi["event_type"]            ?? -1] ?? "").trim();
        if (!qid) return;
        const entry = {
          selected_options_json: String(r[qi["selected_options_json"] ?? -1] ?? "").trim(),
          selected_addons_json:  String(r[qi["selected_addons_json"]  ?? -1] ?? "").trim(),
          job_type_id:           String(r[qi["job_type_id"]           ?? -1] ?? "").trim(),
          notes:                 String(r[qi["notes"]                 ?? -1] ?? "").trim(),
        };
        // Prefer the "locked" snapshot (same preference as Lead Detail)
        if (!snapshotMap[qid] || evtType === "locked") snapshotMap[qid] = entry;
      });
    }

    const today = todayLocalStr();

    // Get the logged-in crew member's session so we can filter to their assigned jobs.
    // Owners see all jobs; regular crew only see jobs assigned to them.
    const session = getCrewSession(req);
    const staffId = session ? session.staffId : null;
    const isOwner = session ? session.role === "owner" : false;

    const jobs = data
      .map(r => {
        const get = col => String(r[idx[col] ?? -1] ?? "").trim();
        const dt        = get("scheduled_datetime");
        const dateStr   = dt ? dt.slice(0, 10) : "";
        const qid       = get("quote_id");
        const jobTypeId = get("job_type_id");

        // Decode scope from quote snapshot answers using estimator module system
        const snap = snapshotMap[qid] || {};
        const scopeResult = buildScopeItems(
          snap.selected_options_json,
          snap.selected_addons_json,
          modulesById,
        );

        // Plain-text fallback for manually-created bookings with no quote snapshot
        const scopeRaw     = get("scope_of_work");
        const bookingNotes = get("notes");
        const isInternalId = v => /^[A-Z]{1,3}-[A-Z0-9]{4,}$/i.test(v.trim());
        const plainScope   = scopeResult.items.length === 0
          ? ([scopeRaw, bookingNotes, snap.notes].find(v => v && !isInternalId(v)) || "")
          : "";

        // Resolve human-readable job type name (handles both assembly IDs like "A001" and service IDs)
        const jobTypeName = resolveJobTypeName(snap.job_type_id || jobTypeId);

        const latRaw = get("lat");
        const lngRaw = get("lng");
        return {
          booking_id:         get("booking_id"),
          quote_id:           qid,
          customer_name:      get("customer_name"),
          address:            get("address"),
          phone:              get("phone"),
          email:              get("email"),
          scheduled_datetime: dt,
          date:               dateStr,
          schedule_block:     get("schedule_block"),
          duration_minutes:   Number(r[idx["duration_minutes"] ?? -1] || 0),
          status:             get("status"),
          final_price:        get("final_price"),
          job_type_id:        jobTypeId,
          job_type_name:      jobTypeName,
          lat:                latRaw ? parseFloat(latRaw) : null,
          lng:                lngRaw ? parseFloat(lngRaw) : null,
          // Structured scope (from quote answers)
          scope_items:        scopeResult.items,
          scope_qty:          scopeResult.qty,
          scope_status:       scopeResult.classification,
          scope_addons:       scopeResult.addons,
          // Plain-text fallback (manually-created bookings)
          scope_of_work:      plainScope,
          // Tech assignment (single and multi)
          assigned_tech_id:   get("assigned_tech_id"),
          assigned_tech_ids:  get("assigned_tech_ids"),
        };
      })
      .filter(j => {
        if (j.date !== today || j.status === "cancelled") return false;
        // Owners see all jobs
        if (isOwner) return true;
        // No session — fall back to showing all (shouldn't normally happen)
        if (!staffId) return true;
        // Unassigned jobs: show to everyone so they can be picked up
        const hasAnyAssignment = j.assigned_tech_id || j.assigned_tech_ids;
        if (!hasAnyAssignment) return true;
        // Only show jobs where this tech is assigned
        if (j.assigned_tech_id === staffId) return true;
        if (j.assigned_tech_ids) {
          return j.assigned_tech_ids.split(",").map(s => s.trim()).includes(staffId);
        }
        return false;
      })
      .sort((a, b) => a.scheduled_datetime.localeCompare(b.scheduled_datetime));

    json(res, 200, { ok: true, jobs, today });
  } catch (err) {
    json(res, 500, { ok: false, error: err.message, jobs: [] });
  }
}

/* =========================
   GENERATE INVOICE FROM BOOKING — POST /api/crew/generate-invoice
   Called by the crew portal after a job is marked complete.
   Body: { booking_id }
   Returns: { invoice_id, invoice_number, public_token, public_url }
========================= */
function parseBody(req) {
  return new Promise((resolve) => {
    let raw = "";
    req.on("data", c => (raw += c));
    req.on("end", () => { try { resolve(JSON.parse(raw || "{}")); } catch { resolve({}); } });
  });
}

async function handleGenerateInvoice(req, res) {
  try {
    const session = getCrewSession(req);
    if (!session) return json(res, 401, { ok: false, error: "Not authenticated." });

    const body            = await parseBody(req);
    const booking_id      = String(body.booking_id || "").trim();
    const customLineItems = Array.isArray(body.custom_line_items) ? body.custom_line_items : [];
    if (!booking_id) return json(res, 400, { ok: false, error: "booking_id required." });

    const sheets        = await getSheetsClient();
    const spreadsheetId = process.env.CRM_SHEET_ID;
    if (!spreadsheetId) return json(res, 500, { ok: false, error: "CRM_SHEET_ID not configured." });

    // Fetch bookings, QuoteSnapshots, Estimator config, Invoices headers, JobTypes, Rates in parallel
    const [bookingsResp, quotesResp, estCfg, invHdrResp, jtResp, rateResp] = await Promise.all([
      sheets.spreadsheets.values.get({ spreadsheetId, range: "Bookings!A:AZ" }),
      sheets.spreadsheets.values.get({ spreadsheetId, range: "QuoteSnapshots!A:AZ" }).catch(() => ({ data: { values: [] } })),
      getEstimatorConfig().catch(() => null),
      sheets.spreadsheets.values.get({ spreadsheetId, range: "Invoices!1:1" }),
      sheets.spreadsheets.values.get({ spreadsheetId, range: "JobTypes!A:AZ" }).catch(() => ({ data: { values: [] } })),
      sheets.spreadsheets.values.get({ spreadsheetId, range: "Rates!A:AZ" }).catch(() => ({ data: { values: [] } })),
    ]);

    // Find booking
    const bRows = bookingsResp.data.values || [];
    if (bRows.length < 2) return json(res, 404, { ok: false, error: "Booking not found." });
    const [bHeaders, ...bData] = bRows;
    const bi  = Object.fromEntries(bHeaders.map((h, i) => [h, i]));
    const bGet = row => col => String(row[bi[col] ?? -1] ?? "").trim();

    const bRow = bData.find(r => bGet(r)("booking_id") === booking_id);
    if (!bRow) return json(res, 404, { ok: false, error: `Booking ${booking_id} not found.` });

    const get         = bGet(bRow);
    const quoteId     = get("quote_id");
    const finalPrice  = parseFloat(get("final_price") || "0") || 0;
    const custName    = get("customer_name");
    const custPhone   = get("phone");
    const address     = get("address");
    const schedDt     = get("scheduled_datetime");
    const serviceDate = schedDt ? schedDt.slice(0, 10) : new Date().toISOString().slice(0, 10);
    const jobTypeId   = get("job_type_id");

    // Resolve service name using estimator config
    const services = estCfg ? estCfg.services : [];
    function resolveServiceName(rawId) {
      if (!rawId) return "Electrical Services";
      const serviceId = (typeof ASSEMBLY_TO_SERVICE !== "undefined" && ASSEMBLY_TO_SERVICE[rawId]) || rawId;
      const svc = services.find(s => s.service_id === serviceId);
      return svc ? svc.service_name : rawId.replace(/_/g, " ").replace(/\b\w/g, c => c.toUpperCase());
    }

    // Get best quote snapshot for this booking
    let snapPrice = 0;
    let serviceName = resolveServiceName(jobTypeId);
    let foundSnap = null;
    let snapHeaders = [];
    const qRows = quotesResp.data.values || [];
    if (qRows.length > 1 && quoteId) {
      const [qHeaders, ...qData] = qRows;
      snapHeaders = qHeaders;
      const qi = Object.fromEntries(qHeaders.map((h, i) => [h, i]));
      const qGet = r => col => String(r[qi[col] ?? -1] ?? "").trim();
      // Prefer snapshot rows that have actual cost data (labor_cost > 0); among those prefer "locked"
      foundSnap = qData.reduce((best, r) => {
        if (qGet(r)("quote_id") !== quoteId) return best;
        if (!best) return r;
        const thisLabor = parseFloat(qGet(r)("labor_cost") || "0") || 0;
        const bestLabor = parseFloat(qGet(best)("labor_cost") || "0") || 0;
        if (thisLabor > 0 && bestLabor === 0) return r;
        if (thisLabor > 0 && bestLabor > 0 && qGet(r)("event_type") === "locked") return r;
        return best;
      }, null);
      if (foundSnap) {
        snapPrice   = parseFloat(qGet(foundSnap)("final_price") || "0") || 0;
        const snId  = qGet(foundSnap)("job_type_id") || jobTypeId;
        serviceName = resolveServiceName(snId);
      }
    }

    // Custom line items total overrides quote price
    const customTotal = customLineItems.reduce((s, li) => {
      const tot = Number(li.line_total) || Math.round(Number(li.quantity || 1) * Number(li.unit_price || 0) * 100) / 100;
      return s + tot;
    }, 0);
    const subtotal = customTotal > 0 ? customTotal : (finalPrice > 0 ? finalPrice : snapPrice);
    if (subtotal <= 0) {
      return json(res, 422, { ok: false, error: "No price found for this booking. Add line items or set a final_price first." });
    }

    // Build line items — use detailed snapshot breakdown when available
    let lineItems = [];
    if (foundSnap && snapHeaders.length) {
      const qi2  = Object.fromEntries(snapHeaders.map((h, i) => [h, i]));
      const sGet = col => String(foundSnap[qi2[col] ?? -1] ?? "").trim();

      let laborCost  = parseFloat(sGet("labor_cost"))         || 0;
      let overhead   = parseFloat(sGet("overhead_cost"))      || 0;
      let materials  = parseFloat(sGet("material_allowance")) || 0;
      let travelFee  = parseFloat(sGet("travel_fee"))         || 0;
      let totalHours = parseFloat(sGet("total_hours"))        || 0;
      let addons = [];
      try { addons = JSON.parse(sGet("selected_addons_json") || "[]"); } catch {}

      // Snapshot has no breakdown — try recomputing from stored answers
      if (laborCost === 0 && materials === 0) {
        let snapParsed = {};
        try { snapParsed = JSON.parse(sGet("selected_options_json") || "{}"); } catch {}
        const snapAnswers = snapParsed.answers || {};
        const snapQty     = snapParsed.qty || 1;
        const snapJobType = sGet("job_type_id") || jobTypeId;

        if (Object.keys(snapAnswers).length > 0 && snapJobType) {
          try {
            const [activeConfig, estRaw] = await Promise.all([
              getActiveConfig(),
              getEstimatorConfig().catch(() => ({ modulesById: {} })),
            ]);
            const jt = activeConfig.jobTypes.find(j => j.job_type_id === snapJobType);
            if (jt) {
              const modulesById = estRaw.modulesById || {};
              const { selectedDriverOptions: moduleDriverOpts } = resolveModuleAnswers(modulesById, snapAnswers);
              const rp = computePrice({
                config:               activeConfig,
                jobType:              jt,
                answers:              snapAnswers,
                addons:               [],
                qty:                  snapQty,
                prebuiltDriverOptions: moduleDriverOpts,
              });
              // Scale computed breakdown to match the snapshot's recorded final_price
              const rpTotal = rp.final_price || 0;
              const scale   = rpTotal > 0 && snapPrice > 0 ? snapPrice / rpTotal : 1;
              laborCost  = Math.round((rp.labor_cost         || 0) * scale * 100) / 100;
              overhead   = Math.round((rp.overhead_cost      || 0) * scale * 100) / 100;
              materials  = Math.round((rp.material_allowance || 0) * scale * 100) / 100;
              travelFee  = Math.round((rp.travel_fee         || 0) * scale * 100) / 100;
              totalHours = rp.hours || rp.total_hours || totalHours;
              console.log(`[crew/generate-invoice] Recomputed breakdown for ${snapJobType}: labor=${laborCost} mat=${materials} travel=${travelFee}`);
            }
          } catch (reErr) {
            console.warn("[crew/generate-invoice] pricing recompute failed:", reErr.message);
          }
        }
      }

      if (laborCost > 0 || materials > 0) {
        const laborTotal = laborCost + overhead;
        if (laborTotal > 0) {
          lineItems.push({
            id: "LI-labor", title: "Labor",
            description: totalHours > 0
              ? `${serviceName} — approx. ${totalHours.toFixed(1)} hrs`
              : serviceName,
            quantity: 1, unit_price: laborTotal, taxable: false, line_total: laborTotal,
          });
        }
        if (materials > 0) {
          lineItems.push({
            id: "LI-materials", title: "Materials & Supplies",
            description: "Electrical materials and supplies",
            quantity: 1, unit_price: materials, taxable: false, line_total: materials,
          });
        }
        if (travelFee > 0) {
          lineItems.push({
            id: "LI-travel", title: "Travel",
            description: address ? `Travel to ${address}` : "Travel / mobilization",
            quantity: 1, unit_price: travelFee, taxable: false, line_total: travelFee,
          });
        }
        addons.forEach((addon, i) => {
          const fee = parseFloat(addon.add_fee ?? addon.fee ?? "0") || 0;
          if (fee > 0) {
            lineItems.push({
              id: `LI-addon-${i}`, title: addon.name_public || addon.name || "Add-on",
              description: "", quantity: 1, unit_price: fee, taxable: false, line_total: fee,
            });
          }
        });
      }
    }

    // If the tech submitted line items from the form (includes pre-populated + any additions), use those
    if (customLineItems.length > 0) {
      lineItems = customLineItems.map((li, i) => ({
        id:          li.id || `LI-custom-${i + 1}`,
        title:       String(li.title || li.description || "Service").trim(),
        description: String(li.description || "").trim(),
        quantity:    Number(li.quantity) || 1,
        unit_price:  Number(li.unit_price) || 0,
        taxable:     Boolean(li.taxable),
        line_total:  Number(li.line_total) || Math.round(Number(li.quantity || 1) * Number(li.unit_price || 0) * 100) / 100,
      }));
    }

    // Fallback: compute proportional breakdown from JobTypes + Rates when snapshot had no cost data
    if (!lineItems.length && subtotal > 0) {
      const jtRows   = jtResp.data.values   || [];
      const rRows    = rateResp.data.values || [];
      let baseHours = 0, matAllowance = 0, laborRate = 0, overheadRate = 0;

      if (jtRows.length > 1 && jobTypeId) {
        const [jtH, ...jtData] = jtRows;
        const jti = Object.fromEntries(jtH.map((h, i) => [h, i]));
        const jtRow = jtData.find(r => String(r[jti["job_type_id"] ?? -1] ?? "").trim() === jobTypeId);
        if (jtRow) {
          baseHours    = parseFloat(String(jtRow[jti["base_hours"]        ?? -1] ?? "0")) || 0;
          matAllowance = parseFloat(String(jtRow[jti["material_allowance"] ?? -1] ?? "0")) || 0;
        }
      }

      if (rRows.length > 1) {
        const [rH, ...rData] = rRows;
        const ri  = Object.fromEntries(rH.map((h, i) => [h, i]));
        const rRow = rData[0];
        if (rRow) {
          laborRate    = parseFloat(String(rRow[ri["crew_loaded_hourly"] ?? -1] ?? "0")) || 0;
          overheadRate = parseFloat(String(rRow[ri["overhead_per_hour"]  ?? -1] ?? "0")) || 0;
        }
      }

      const rawLaborTotal = baseHours * (laborRate + overheadRate);
      const rawTotal      = rawLaborTotal + matAllowance;

      if (rawTotal > 0) {
        const laborFrac   = rawLaborTotal / rawTotal;
        const scaledLabor = Math.round(subtotal * laborFrac * 100) / 100;
        const scaledMat   = Math.round((subtotal - scaledLabor) * 100) / 100;

        if (scaledLabor > 0) {
          lineItems.push({
            id: "LI-labor", title: "Labor & Overhead",
            description: baseHours > 0
              ? `${serviceName} — approx. ${baseHours.toFixed(1)} hrs`
              : serviceName,
            quantity: 1, unit_price: scaledLabor, taxable: false, line_total: scaledLabor,
          });
        }
        if (scaledMat > 0) {
          lineItems.push({
            id: "LI-materials", title: "Materials & Supplies",
            description: "Electrical materials and supplies",
            quantity: 1, unit_price: scaledMat, taxable: false, line_total: scaledMat,
          });
        }
      }
    }

    // Last resort fallback — single Labor line with the agreed total
    if (!lineItems.length) {
      lineItems = [{
        id: "LI-1", title: "Labor",
        description: serviceName + (address ? ` — ${address}` : ""),
        quantity: 1, unit_price: subtotal, taxable: false, line_total: subtotal,
      }];
    }

    // Generate invoice
    const now          = new Date().toISOString();
    const publicToken  = crypto.randomBytes(16).toString("hex");
    const invoiceNum   = "INV-" + String(Date.now()).slice(-6);
    const invoiceId    = "INV-" + Date.now();
    const techName     = `${session.firstName} ${session.lastName}`.trim();

    const rowObj = {
      id:                 invoiceId,
      created_at:         now,
      updated_at:         now,
      invoice_number:     invoiceNum,
      status_code:        "draft",
      client_id:          "",
      property_id:        "",
      request_id:         "",
      job_id:             "",
      lead_id:            "",
      issued_at:          now,
      due_at:             "",
      subtotal:           String(subtotal),
      tax_rate:           "0",
      tax_amount:         "0",
      total:              String(subtotal),
      paid_amount:        "0",
      balance_due:        String(subtotal),
      deposit_applied:    "0",
      notes:              "",
      snapshot_json:      JSON.stringify({ booking_id, quote_id: quoteId, created_at: now }),
      sent_at:            "",
      paid_at:            "",
      void_at:            "",
      provider_ref:       "",
      provider_name:      "",
      public_token:       publicToken,
      line_items_json:    JSON.stringify(lineItems),
      change_orders_json: "[]",
      original_total:     String(subtotal),
      booking_id,
      tech_name:          techName,
      service_date:       serviceDate,
      customer_name:      custName,
      customer_phone:     custPhone,
      sms_sent_at:        "",
      sms_sent_to:        "",
      email_sent_at:      "",
      email_sent_to:      "",
    };

    const invHeaders = (invHdrResp.data.values && invHdrResp.data.values[0]) || [];
    const invRow     = invHeaders.map(h => rowObj[h] != null ? rowObj[h] : "");

    await sheets.spreadsheets.values.append({
      spreadsheetId,
      range:            "Invoices!A:A",
      valueInputOption: "RAW",
      insertDataOption: "INSERT_ROWS",
      requestBody:      { values: [invRow] },
    });

    const domain = process.env.REPLIT_DEV_DOMAIN
      || (process.env.REPLIT_DOMAINS || "").split(",")[0].trim()
      || "";
    const publicUrl = domain
      ? `https://${domain}/invoice/${publicToken}`
      : `/invoice/${publicToken}`;

    console.log(`[crew/generate-invoice] Created ${invoiceNum} for booking ${booking_id} by ${techName}`);

    json(res, 201, {
      ok:             true,
      invoice_id:     invoiceId,
      invoice_number: invoiceNum,
      public_token:   publicToken,
      public_url:     publicUrl,
      line_items:     lineItems,
    });
  } catch (err) {
    console.error("[crew/generate-invoice]", err.message);
    json(res, 500, { ok: false, error: err.message });
  }
}

/* =========================
   GET INVOICE FOR BOOKING — GET /api/crew/invoice-for-booking?booking_id=...
   Returns the most recent invoice linked to a booking_id, so the crew portal
   can show "View Invoice" without regenerating.
========================= */
async function handleGetInvoiceForBooking(req, res) {
  try {
    const session = getCrewSession(req);
    if (!session) return json(res, 401, { ok: false, error: "Not authenticated." });

    const qs         = new URL("http://x" + req.url).searchParams;
    const booking_id = String(qs.get("booking_id") || "").trim();
    if (!booking_id) return json(res, 400, { ok: false, error: "booking_id required." });

    const sheets        = await getSheetsClient();
    const spreadsheetId = process.env.CRM_SHEET_ID;
    if (!spreadsheetId) return json(res, 500, { ok: false, error: "CRM_SHEET_ID not configured." });

    const resp = await sheets.spreadsheets.values.get({
      spreadsheetId,
      range: "Invoices!A1:AZ5000",
    });
    const rows = resp.data.values || [];
    if (rows.length < 2) return json(res, 200, { ok: true, found: false });

    const [headers, ...dataRows] = rows;
    const hi = Object.fromEntries(headers.map((h, i) => [h.trim(), i]));
    const get = r => col => String(r[hi[col] ?? -1] ?? "").trim();

    // Find the most recent invoice for this booking_id (last matching row wins)
    let match = null;
    for (const row of dataRows) {
      if (get(row)("booking_id") === booking_id) match = row;
    }
    if (!match) return json(res, 200, { ok: true, found: false });

    const publicToken = get(match)("public_token");
    const domain = process.env.REPLIT_DEV_DOMAIN
      || (process.env.REPLIT_DOMAINS || "").split(",")[0].trim()
      || "";
    const publicUrl = publicToken && domain
      ? `https://${domain}/invoice/${publicToken}`
      : publicToken ? `/invoice/${publicToken}` : "";

    return json(res, 200, {
      ok:             true,
      found:          true,
      invoice_id:     get(match)("id"),
      invoice_number: get(match)("invoice_number"),
      public_token:   publicToken,
      public_url:     publicUrl,
    });
  } catch (err) {
    json(res, 500, { ok: false, error: err.message });
  }
}

module.exports = { handleGetCrewMembers, handleGetTodayJobs, handleGenerateInvoice, handleGetInvoiceForBooking };

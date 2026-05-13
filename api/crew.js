// api/crew.js — lightweight helpers for the Crew Portal
// GET /api/crew/members — returns list of crew member names from Config tab
// GET /api/crew/today  — returns today's bookings (date-filtered, public endpoint)
// POST /api/crew/generate-invoice — generate invoice from a completed booking

const crypto                 = require("crypto");
const { getSheetsClient }    = require("../lib/sheets");
const { getConfig }          = require("../lib/config");
const { getEstimatorConfig } = require("../lib/estimatorModulesConfig");
const { getCrewSession, findStaffById } = require("../lib/staff");

let ASSEMBLY_TO_SERVICE = {};
try { ASSEMBLY_TO_SERVICE = require("../lib/serviceClassification").ASSEMBLY_TO_SERVICE || {}; } catch { /* optional */ }

// 60-second in-memory cache for raw Sheets data — guards against quota spikes.
// IMPORTANT: caches *unfiltered* raw rows so per-user access-control filtering always
// runs fresh on every request, even when the cache is used as a fallback.
const _todayJobsCache = {};  // key: dateStr → { ts: epoch, bookingRows, quoteRows, estCfg }

// Internal-only modules that should not appear as scope rows
const SKIP_MODULES = new Set(["UNCERTAINTY_BUFFER"]);
// Modules that contain photo URLs — collected separately and returned as photos[]
const PHOTO_MODULES = new Set(["WORK_AREA_PHOTO", "PANEL_PHOTO", "CEILING_PHOTO", "OUTLET_PHOTO", "SWITCH_PHOTO", "OUTDOOR_PHOTO", "JOB_PHOTOS", "SITE_PHOTO", "BEFORE_PHOTO", "AFTER_PHOTO"]);

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
// Returns { items: [{label, value}], qty, classification, addons: [], photos: [url, ...] }
function buildScopeItems(selectedOptionsJson, selectedAddonsJson, modulesById) {
  const items = [];
  const photos = [];
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

        // Photo modules — extract URLs and collect separately
        if (PHOTO_MODULES.has(moduleId)) {
          const urls = extractPhotoUrls(value);
          urls.forEach(u => photos.push(u));
          continue;
        }

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

  return { items, qty, classification, addons, photos };
}

// Extract photo URLs from a module answer — supports string URL, JSON array, or comma list.
// Accepts both absolute https:// URLs and relative /uploads/ paths (locally saved files).
function extractPhotoUrls(value) {
  if (!value) return [];
  const s = String(value).trim();
  const isPhotoUrl = u => /^https?:\/\//.test(u) || /^\/uploads\//.test(u);
  // JSON array of URLs
  try {
    const arr = JSON.parse(s);
    if (Array.isArray(arr)) return arr.map(String).filter(isPhotoUrl);
  } catch {}
  // Single value that is itself a URL
  if (isPhotoUrl(s)) return [s];
  // Comma-separated URLs
  return s.split(",").map(u => u.trim()).filter(isPhotoUrl);
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
  const spreadsheetId = process.env.CRM_SHEET_ID;
  if (!spreadsheetId) return json(res, 200, { ok: true, jobs: [] });

  // Accept optional ?date=YYYY-MM-DD to view a specific day (resolved early so
  // the cache key is date-based, not user-based — raw rows are user-agnostic).
  const urlObj    = new URL(req.url, "http://x");
  const dateParam = urlObj.searchParams.get("date");
  const today = (dateParam && /^\d{4}-\d{2}-\d{2}$/.test(dateParam))
    ? dateParam
    : todayLocalStr();

  // ── 1. Fetch raw sheet data (cached by date, never by user) ──────────────
  let bookingRows, quoteRows, leadsRows, estCfg;
  const cached = _todayJobsCache[today];
  if (cached && Date.now() - cached.ts < 60_000) {
    ({ bookingRows, quoteRows, leadsRows, estCfg } = cached);
  } else {
    try {
      const sheets = await getSheetsClient();
      const [bookingsResp, quotesResp, leadsResp, estCfgResult] = await Promise.all([
        sheets.spreadsheets.values.get({ spreadsheetId, range: "Bookings!A:Z" }),
        sheets.spreadsheets.values.get({ spreadsheetId, range: "QuoteSnapshots!A:Z" }).catch(() => ({ data: { values: [] } })),
        sheets.spreadsheets.values.get({ spreadsheetId, range: "Leads!A:Z" }).catch(() => ({ data: { values: [] } })),
        getEstimatorConfig().catch(() => null),
      ]);
      bookingRows = bookingsResp.data.values || [];
      quoteRows   = quotesResp.data.values   || [];
      leadsRows   = leadsResp.data.values    || [];
      estCfg      = estCfgResult;
      // Store raw unfiltered rows — filtering always runs per-request so no
      // user identity is ever embedded in the cache.
      _todayJobsCache[today] = { ts: Date.now(), bookingRows, quoteRows, leadsRows, estCfg };
    } catch (err) {
      // Sheets quota / network error — fall back to stale cache if any exists,
      // regardless of TTL, so crew never sees a blank list after a quota spike.
      if (cached) {
        ({ bookingRows, quoteRows, leadsRows, estCfg } = cached);
        leadsRows = leadsRows || [];
      } else {
        return json(res, 500, { ok: false, error: err.message, jobs: [] });
      }
    }
  }

  // ── 2. Prepare lookups from raw rows ─────────────────────────────────────
  try {
    const modulesById = estCfg ? estCfg.modulesById : {};
    const services    = estCfg ? estCfg.services    : [];

    function resolveJobTypeName(rawId) {
      if (!rawId) return "";
      const serviceId = ASSEMBLY_TO_SERVICE[rawId] || rawId;
      const svc = services.find(s => s.service_id === serviceId);
      return svc ? svc.service_name : serviceId.replace(/_/g, " ").replace(/\b\w/g, c => c.toUpperCase());
    }

    if (bookingRows.length < 2) return json(res, 200, { ok: true, jobs: [], today });

    // Build lead lookup maps from Leads tab:
    //   quoteToLeadId : quote_id  → lead_id
    //   leadById      : lead_id   → { job_type, notes, last_quote_id, name, phone, address }
    //   leadByQuoteId : last_quote_id → lead (same record, alternate key)
    const quoteToLeadId = {};
    const leadById      = {};
    const leadByQuoteId = {};
    if (Array.isArray(leadsRows) && leadsRows.length > 1) {
      const lh = leadsRows[0] || [];
      const lIdx = Object.fromEntries(lh.map((h, i) => [String(h).trim(), i]));
      const lg = (row, col) => String(row[lIdx[col] ?? -1] ?? "").trim();
      for (const lr of leadsRows.slice(1)) {
        const lid  = lg(lr, "id");
        const lqid = lg(lr, "last_quote_id");
        if (!lid) continue;
        if (lqid) quoteToLeadId[lqid] = lid;
        const rec = {
          id:            lid,
          job_type:      lg(lr, "job_type"),
          notes:         lg(lr, "notes"),
          last_quote_id: lqid,
          name:          lg(lr, "name"),
          phone:         lg(lr, "phone"),
          address:       lg(lr, "address"),
          quoted_price:  lg(lr, "quoted_price"),
          access_instructions: lg(lr, "access_instructions"),
        };
        leadById[lid] = rec;
        if (lqid) leadByQuoteId[lqid] = rec;
      }
    }

    const [headers, ...data] = bookingRows;
    const idx = Object.fromEntries(headers.map((h, i) => [h, i]));

    // Build QuoteSnapshots lookup: quote_id → snapshot (prefer "locked" rows)
    // Also collect uploaded photo URLs from photo_uploaded event rows.
    const snapshotMap  = {};
    const uploadedPhotosByQuoteId = {}; // quote_id → string[]
    if (quoteRows.length > 1) {
      const [qHeaders, ...qData] = quoteRows;
      const qi = Object.fromEntries(qHeaders.map((h, i) => [h, i]));
      qData.forEach(r => {
        const qid     = String(r[qi["quote_id"]   ?? -1] ?? "").trim();
        const evtType = String(r[qi["event_type"] ?? -1] ?? "").trim();
        if (!qid) return;

        // photo_uploaded rows store the local file URL in the "notes" column
        if (evtType === "photo_uploaded") {
          const url = String(r[qi["notes"] ?? -1] ?? "").trim();
          if (url && (/^\/uploads\//.test(url) || /^https?:\/\//.test(url))) {
            if (!uploadedPhotosByQuoteId[qid]) uploadedPhotosByQuoteId[qid] = [];
            uploadedPhotosByQuoteId[qid].push(url);
          }
          return;
        }

        const entry = {
          selected_options_json: String(r[qi["selected_options_json"] ?? -1] ?? "").trim(),
          selected_addons_json:  String(r[qi["selected_addons_json"]  ?? -1] ?? "").trim(),
          job_type_id:           String(r[qi["job_type_id"]           ?? -1] ?? "").trim(),
          notes:                 String(r[qi["notes"]                 ?? -1] ?? "").trim(),
          lead_id:               String(r[qi["lead_id"]               ?? -1] ?? "").trim(),
        };
        if (!snapshotMap[qid] || evtType === "locked") snapshotMap[qid] = entry;
      });
    }

    // ── 3. Per-request access-control (always runs fresh, never cached) ────
    const norm = (value) => String(value || "").trim().toLowerCase().replace(/\s+/g, " ");
    const splitAssignmentValues = (value) => {
      if (Array.isArray(value)) return value.flatMap(splitAssignmentValues);
      const raw = String(value || "").trim();
      if (!raw) return [];
      try {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) return parsed.flatMap(splitAssignmentValues);
      } catch (_) {}
      return raw.split(/[|,;]/).map(v => norm(v)).filter(Boolean);
    };
    const addAlias = (set, value) => { const n = norm(value); if (n) set.add(n); };
    const assignmentFields = [
      "assigned_tech_id", "assigned_tech_ids", "assigned_to", "assigned_tech",
      "tech", "technician", "crew", "staff_id", "staff_ids", "tech_id", "tech_ids",
      "technician_id", "technician_ids", "assigned_user", "assigned_user_id",
      "assigned_name", "assigned_email",
    ];

    const session = getCrewSession(req);
    const role = norm(session ? session.role : "");
    const isPrivileged = role === "owner" || role === "admin";

    const aliasSet = new Set();
    if (session) {
      addAlias(aliasSet, session.staffId);
      addAlias(aliasSet, session.staff_id);
      addAlias(aliasSet, session.id);
      addAlias(aliasSet, session.username);
      addAlias(aliasSet, session.email);
      addAlias(aliasSet, session.phone);
      addAlias(aliasSet, session.displayName);
      addAlias(aliasSet, session.name);
      const fullName = [session.firstName || session.first_name, session.lastName || session.last_name].filter(Boolean).join(" ");
      addAlias(aliasSet, fullName);
    }

    const sessionStaffId = session ? String(session.staffId || session.staff_id || session.id || "").trim() : "";
    if (sessionStaffId) {
      const staffRow = await findStaffById(sessionStaffId).catch(() => null);
      if (staffRow) {
        addAlias(aliasSet, staffRow.staff_id);
        addAlias(aliasSet, staffRow.username);
        addAlias(aliasSet, staffRow.email);
        addAlias(aliasSet, staffRow.phone);
        addAlias(aliasSet, staffRow.name);
        addAlias(aliasSet, [staffRow.first_name, staffRow.last_name].filter(Boolean).join(" "));
      }
    }

    const assignmentMatchesCrew = (job) => {
      const values = assignmentFields.flatMap((field) => splitAssignmentValues(job[field]));
      if (values.length === 0) return true;
      if (aliasSet.size === 0) return true;
      return values.some(v => aliasSet.has(v));
    };

    // ── 4. Map + filter rows (filter uses fresh per-request identity) ───────
    const isLeadId = v => /^LEAD-/i.test(String(v || "").trim());

    const jobs = data
      .map(r => {
        const get = col => String(r[idx[col] ?? -1] ?? "").trim();
        const dt        = get("scheduled_datetime");
        const dateStr   = dt ? dt.slice(0, 10) : "";
        let   qid       = get("quote_id");
        const jobTypeId = get("job_type_id");

        // If quote_id is actually a lead ID (LEAD-xxx), resolve the real quote_id
        // from the lead record so the snapshot lookup works.
        let resolvedLeadId = get("lead_id");
        let leadRec = null;
        if (isLeadId(qid)) {
          // The "quote_id" column stores a lead ID — look up the real snapshot
          leadRec = leadById[qid] || null;
          if (!resolvedLeadId) resolvedLeadId = qid;
          const realQid = leadRec ? leadRec.last_quote_id : "";
          if (realQid) qid = realQid; // upgrade to real quote_id for snapshot lookup
        }
        if (!resolvedLeadId) resolvedLeadId = quoteToLeadId[qid] || "";
        if (!leadRec && resolvedLeadId) leadRec = leadById[resolvedLeadId] || null;

        // Primary snapshot lookup; fall back to lead's real quote_id
        let snap = snapshotMap[qid] || {};
        if (!snap.selected_options_json && leadRec && leadRec.last_quote_id && leadRec.last_quote_id !== qid) {
          snap = snapshotMap[leadRec.last_quote_id] || snap;
        }

        const scopeResult = buildScopeItems(
          snap.selected_options_json,
          snap.selected_addons_json,
          modulesById,
        );

        // Merge in uploaded photos from photo_uploaded snapshot events (stored
        // as /uploads/ paths in the "notes" column of those rows).
        const extraPhotos = [
          ...(uploadedPhotosByQuoteId[qid] || []),
          ...(leadRec && leadRec.last_quote_id && leadRec.last_quote_id !== qid
            ? (uploadedPhotosByQuoteId[leadRec.last_quote_id] || [])
            : []),
        ];
        if (extraPhotos.length) {
          // Deduplicate against photos already found in selected_options_json
          const seen = new Set(scopeResult.photos);
          extraPhotos.forEach(u => { if (!seen.has(u)) { seen.add(u); scopeResult.photos.push(u); } });
        }

        const scopeRaw     = get("scope_of_work");
        const bookingNotes = get("notes");
        const leadNotes    = leadRec ? leadRec.notes : "";
        const isInternalId = v => /^[A-Z]{1,3}-[A-Z0-9]{4,}$/i.test(v.trim());

        // Plain-text scope fallback: booking notes → lead notes → snap notes
        // (skip values that look like internal IDs)
        const plainScope = scopeResult.items.length === 0
          ? ([scopeRaw, bookingNotes, leadNotes, snap.notes].find(v => v && !isInternalId(v)) || "")
          : "";

        // Job type: prefer snapshot → booking column → lead field
        const effectiveJobTypeId = snap.job_type_id || jobTypeId || (leadRec ? leadRec.job_type : "");
        const jobTypeName = resolveJobTypeName(effectiveJobTypeId);

        // Customer info: prefer booking columns, fall back to lead record
        const customerName = get("customer_name") || (leadRec ? leadRec.name    : "");
        const phone        = get("phone")          || (leadRec ? leadRec.phone   : "");
        const address      = get("address")        || (leadRec ? leadRec.address : "");
        const finalPrice   = get("final_price")    || (leadRec ? leadRec.quoted_price : "");
        const accessNotes  = leadRec ? leadRec.access_instructions : "";

        const latRaw = get("lat");
        const lngRaw = get("lng");
        return {
          booking_id:           get("booking_id"),
          quote_id:             qid,
          lead_id:              resolvedLeadId,
          customer_name:        customerName,
          address,
          phone,
          email:                get("email"),
          scheduled_datetime:   dt,
          date:                 dateStr,
          schedule_block:       get("schedule_block"),
          duration_minutes:     Number(r[idx["duration_minutes"] ?? -1] || 0),
          status:               get("status"),
          final_price:          finalPrice,
          job_type_id:          effectiveJobTypeId,
          job_type_name:        jobTypeName,
          lat:                  latRaw ? parseFloat(latRaw) : null,
          lng:                  lngRaw ? parseFloat(lngRaw) : null,
          scope_items:          scopeResult.items,
          scope_qty:            scopeResult.qty,
          scope_status:         scopeResult.classification,
          scope_addons:         scopeResult.addons,
          scope_photos:         scopeResult.photos,
          scope_of_work:        plainScope,
          access_instructions:  accessNotes,
          arrived_at:           get("arrived_at"),
          departed_at:          get("departed_at"),
          job_duration_minutes: get("job_duration_minutes") ? Number(get("job_duration_minutes")) : null,
          assigned_tech_id:     get("assigned_tech_id"),
          assigned_tech_ids:    get("assigned_tech_ids"),
          assigned_to:          get("assigned_to"),
          assigned_tech:        get("assigned_tech"),
          tech:                 get("tech"),
          technician:           get("technician"),
          crew:                 get("crew"),
          staff_id:             get("staff_id"),
          staff_ids:            get("staff_ids"),
          tech_id:              get("tech_id"),
          tech_ids:             get("tech_ids"),
          technician_id:        get("technician_id"),
          technician_ids:       get("technician_ids"),
          assigned_user:        get("assigned_user"),
          assigned_user_id:     get("assigned_user_id"),
          assigned_name:        get("assigned_name"),
          assigned_email:       get("assigned_email"),
        };
      })
      .filter(j => {
        if (j.date !== today || norm(j.status) === "cancelled") return false;
        if (isPrivileged) return true;
        return assignmentMatchesCrew(j);
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

// Maps old CRM-style job_type_ids (used in manually-entered test data and legacy bookings)
// to the current V3 CRM JobTypes IDs so the breakdown lookup always succeeds.
const LEGACY_JT_MAP = {
  ceiling_fan:        "INSTALL_FAN",
  light_fixture:      "REPLACE_FIXTURE",
  outlet_circuit:     "ADD_OUTLET",
  outlet_replace:     "REPLACE_DEVICE",
  gfci_outlet:        "INSTALL_GFCI_BREAKER",
  panel_upgrade:      "SURGE_PROTECTOR",
  panel_troubleshoot: "TROUBLESHOOT",
  ev_charger:         "EV_CHARGER_STD",
  bath_fan:           "REPLACE_BATH_FAN",
  switch_replace:     "REPLACE_DEVICE",
  dimmer_install:     "REPLACE_DEVICE",
  fixture_replace:    "REPLACE_FIXTURE",
};

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

    // Fetch bookings, QuoteSnapshots, Estimator config, Invoices headers in parallel
    // Note: JobTypes and Rates tabs have been removed (V1 engine eliminated).
    // Cost breakdown now derives from QuoteSnapshots or falls back to flat-rate service line.
    const [bookingsResp, quotesResp, estCfg, invHdrResp] = await Promise.all([
      sheets.spreadsheets.values.get({ spreadsheetId, range: "Bookings!A:AZ" }),
      sheets.spreadsheets.values.get({ spreadsheetId, range: "QuoteSnapshots!A:AZ" }).catch(() => ({ data: { values: [] } })),
      getEstimatorConfig().catch(() => null),
      sheets.spreadsheets.values.get({ spreadsheetId, range: "Invoices!1:1" }),
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
    const jobTypeId           = get("job_type_id");
    const normalizedJobTypeId = LEGACY_JT_MAP[jobTypeId] || jobTypeId;

    // Resolve service name using estimator config
    const services = estCfg ? estCfg.services : [];
    function resolveServiceName(rawId) {
      if (!rawId) return "Electrical Services";
      const serviceId = (typeof ASSEMBLY_TO_SERVICE !== "undefined" && ASSEMBLY_TO_SERVICE[rawId]) || rawId;
      const svc = services.find(s => s.service_id === serviceId);
      return svc ? svc.service_name : serviceId.replace(/_/g, " ").replace(/\b\w/g, c => c.toUpperCase());
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

    // Build line items — use detailed snapshot breakdown when available.
    // V1 JobTypes/Rates tabs have been removed; cost breakdown comes from QuoteSnapshot fields only.
    let lineItems = [];
    let snapEquipItems = []; // hoisted so customLineItems merge block can reference it
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
      try {
        const snapOpts = JSON.parse(sGet("selected_options_json") || "{}");
        if (Array.isArray(snapOpts.equipment_line_items)) snapEquipItems = snapOpts.equipment_line_items;
      } catch {}

      // Flat-rate service line — shows the agreed price, not a labor/materials breakdown.
      // Travel and add-ons are listed separately since those are discrete charges.
      const serviceTotal = subtotal - travelFee - addons.reduce((s, a) => s + (parseFloat(a.add_fee ?? a.fee ?? "0") || 0), 0);
      if (serviceTotal > 0) {
        lineItems.push({
          id: "LI-service", title: serviceName,
          description: address || "",
          quantity: 1, unit_price: serviceTotal, taxable: false, line_total: serviceTotal,
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
      // Equipment selections from quote snapshot — always listed so crew knows what to bring
      snapEquipItems.forEach((eq, i) => {
        const delta = Number(eq.upgrade_delta) || 0;
        const label = [eq.brand, eq.name, eq.variant].filter(Boolean).join(" ");
        const desc  = delta > 0 ? `Upgrade +$${delta}` : "Included in quote";
        lineItems.push({
          id: `LI-equip-${i}`, title: `Equipment: ${label || eq.sku || "Selected product"}`,
          description: desc, quantity: 1, unit_price: delta, taxable: false, line_total: delta,
        });
      });
    }

    // If the tech submitted line items from the form (includes pre-populated + any additions), use those.
    // Equipment items from the quote snapshot are merged in so they always appear on the invoice,
    // regardless of whether custom line items were also submitted.
    if (customLineItems.length > 0) {
      const customMapped = customLineItems.map((li, i) => ({
        id:          li.id || `LI-custom-${i + 1}`,
        title:       String(li.title || li.description || "Service").trim(),
        description: String(li.description || "").trim(),
        quantity:    Number(li.quantity) || 1,
        unit_price:  Number(li.unit_price) || 0,
        taxable:     Boolean(li.taxable),
        line_total:  Number(li.line_total) || Math.round(Number(li.quantity || 1) * Number(li.unit_price || 0) * 100) / 100,
      }));
      // Merge snapshot equipment items — skip any already covered by a custom item with the same id
      const customIds = new Set(customMapped.map(li => li.id));
      const equipMerge = snapEquipItems
        .map((eq, i) => {
          const delta = Number(eq.upgrade_delta) || 0;
          const label = [eq.brand, eq.name, eq.variant].filter(Boolean).join(" ");
          return {
            id: `LI-equip-${i}`, title: `Equipment: ${label || eq.sku || "Selected product"}`,
            description: delta > 0 ? `Upgrade +$${delta}` : "Included in quote",
            quantity: 1, unit_price: delta, taxable: false, line_total: delta,
          };
        })
        .filter(li => !customIds.has(li.id));
      lineItems = [...customMapped, ...equipMerge];
    }

    // Fallback: flat-rate service line when no snapshot breakdown was available
    if (!lineItems.length && subtotal > 0) {
      lineItems.push({
        id: "LI-service", title: serviceName,
        description: address || "",
        quantity: 1, unit_price: subtotal, taxable: false, line_total: subtotal,
      });
    }

    // Last resort fallback — single service line with the agreed total
    if (!lineItems.length) {
      lineItems = [{
        id: "LI-service", title: serviceName,
        description: address || "",
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

const { appendAttachmentRow } = require("./attachments");

// ── POST /api/crew/photo — crew-session photo upload ─────────────────────────
const _crewUploadsDir = require("path").join(__dirname, "../uploads");
async function handleCrewPhotoUpload(req, res) {
  try {
    const session = getCrewSession(req);
    if (!session) return json(res, 401, { ok: false, error: "Not authenticated" });

    const body = await new Promise((resolve, reject) => {
      let raw = "";
      req.on("data", c => (raw += c));
      req.on("end", () => { try { resolve(JSON.parse(raw || "{}")); } catch (e) { reject(e); } });
      req.on("error", reject);
    });
    const { quote_id = "", booking_id = "", lead_id = "", base64, mime_type = "image/jpeg" } = body;
    if (!base64) return json(res, 400, { ok: false, error: "base64 required" });

    const ALLOWED = new Set(["image/jpeg", "image/jpg", "image/png", "image/webp", "image/heic"]);
    const EXT_MAP2 = { "image/jpeg": "jpg", "image/jpg": "jpg", "image/png": "png", "image/webp": "webp", "image/heic": "heic" };
    const type = mime_type.toLowerCase();
    if (!ALLOWED.has(type)) return json(res, 400, { ok: false, error: "Unsupported image type" });

    const fs = require("fs");
    const buf = Buffer.from(base64, "base64");
    if (buf.length > 10 * 1024 * 1024) return json(res, 400, { ok: false, error: "File too large (max 10 MB)" });
    if (!fs.existsSync(_crewUploadsDir)) fs.mkdirSync(_crewUploadsDir, { recursive: true });

    const ext  = EXT_MAP2[type] || "jpg";
    const ref  = (quote_id || booking_id || "job").replace(/[^A-Z0-9-]/gi, "");
    const fname = `crew-${ref}-${Date.now()}.${ext}`;
    fs.writeFileSync(require("path").join(_crewUploadsDir, fname), buf);
    const fileUrl  = `/uploads/${fname}`;
    const techName = [session.firstName, session.lastName].filter(Boolean).join(" ") || "Crew";

    // Log to QuoteSnapshots if we have a quote_id so the office can see it
    if (quote_id || booking_id) {
      try {
        const sheets   = await getSheetsClient();
        const crmId    = process.env.CRM_SHEET_ID;
        const noteText = `Crew photo by ${techName}${booking_id ? " · " + booking_id : ""}`;
        const newEvtId = "EV-" + crypto.randomBytes(4).toString("hex").toUpperCase();
        const row = [
          newEvtId, quote_id, new Date().toISOString(), "crew_photo_uploaded",
          "", "[]", "[]", "", "", "", "", "", "",
          "", "", "crew_photo", "", "", "", "", fileUrl,
          "", booking_id, "", "", "", "", "", "", "", noteText,
        ];
        await sheets.spreadsheets.values.append({
          spreadsheetId: crmId,
          range: "QuoteSnapshots!A:A",
          valueInputOption: "RAW",
          insertDataOption: "INSERT_ROWS",
          requestBody: { majorDimension: "ROWS", values: [row] },
        });
      } catch (_) {}
    }
    // Mirror to Attachments sheet so CRM lead detail Photos card can display it.
    // Prefer lead_id or quote_id — the lead detail card queries by those two values.
    // Fall back to booking_id only if nothing better is available.
    const attachEntityId = lead_id || quote_id || booking_id;
    if (attachEntityId) {
      appendAttachmentRow({
        entity_type: "lead",
        entity_id: attachEntityId,
        file_url: fileUrl,
        file_type: "image",
        category: "after",
        uploaded_by: techName,
      }).catch(() => {});
    }

    json(res, 200, { ok: true, url: fileUrl });
  } catch (err) {
    json(res, 500, { ok: false, error: err.message });
  }
}

module.exports = { handleGetCrewMembers, handleGetTodayJobs, handleGenerateInvoice, handleGetInvoiceForBooking, handleCrewPhotoUpload };

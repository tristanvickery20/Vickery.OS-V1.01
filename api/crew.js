// api/crew.js — lightweight helpers for the Crew Portal
// GET /api/crew/members — returns list of crew member names from Config tab
// GET /api/crew/today  — returns today's bookings (date-filtered, public endpoint)

const { getSheetsClient }    = require("../lib/sheets");
const { getConfig }          = require("../lib/config");
const { getEstimatorConfig } = require("../lib/estimatorModulesConfig");

let ASSEMBLY_TO_SERVICE = {};
try { ASSEMBLY_TO_SERVICE = require("../lib/serviceClassification").ASSEMBLY_TO_SERVICE || {}; } catch { /* optional */ }

// Modules to skip — photos and internal-only fields
const SKIP_MODULES = new Set(["WORK_AREA_PHOTOS", "PANEL_PHOTO", "UNCERTAINTY_BUFFER"]);

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
        const question = mod
          ? mod.question
          : moduleId.replace(/_/g, " ").toLowerCase().replace(/\b\w/g, c => c.toUpperCase());
        let answer = String(value);
        if (mod && mod.options && mod.options.length) {
          const opt = mod.options.find(o => o.value === value || o.option_id === value);
          if (opt) answer = opt.label || String(value);
        }
        items.push({ label: question, value: answer });
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
        };
        // Prefer the "locked" snapshot (same preference as Lead Detail)
        if (!snapshotMap[qid] || evtType === "locked") snapshotMap[qid] = entry;
      });
    }

    const today = todayLocalStr();

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
          ? ([scopeRaw, bookingNotes].find(v => v && !isInternalId(v)) || "")
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
        };
      })
      .filter(j => j.date === today && j.status !== "cancelled")
      .sort((a, b) => a.scheduled_datetime.localeCompare(b.scheduled_datetime));

    json(res, 200, { ok: true, jobs, today });
  } catch (err) {
    json(res, 500, { ok: false, error: err.message, jobs: [] });
  }
}

module.exports = { handleGetCrewMembers, handleGetTodayJobs };

// api/crew.js — lightweight helpers for the Crew Portal
// GET /api/crew/members — returns list of crew member names from Config tab
// GET /api/crew/today  — returns today's bookings (date-filtered, public endpoint)

const { getSheetsClient } = require("../lib/sheets");
const { getConfig }       = require("../lib/config");
const { getQuoteConfig }  = require("../lib/sheetsConfig");

function json(res, status, data) {
  res.writeHead(status, { "Content-Type": "application/json", "Cache-Control": "no-store" });
  res.end(JSON.stringify(data));
}

function todayLocalStr() {
  // Orange TX is CST/CDT (UTC-6/UTC-5). Use a simple local date string.
  const d = new Date();
  const offset = d.getTimezoneOffset(); // minutes
  const local = new Date(d.getTime() - offset * 60000);
  return local.toISOString().slice(0, 10); // "YYYY-MM-DD"
}

// Shorten a question prompt to a quick crew-readable label.
// "What is the ceiling height in the work area?" → "Ceiling height"
function crewLabel(prompt) {
  return prompt
    .replace(/\?.*$/, "")
    .replace(/^(what\s+(is\s+the?\s+|are\s+the?\s+|type\s+of\s+|kind\s+of\s+)|how\s+(old|many|much|long)\s+(is|are)\s+(the?\s+)?|is\s+there\s+(an?\s+)?|will\s+you\s+|is\s+this\s+|are\s+there\s+|do\s+you\s+)/i, "")
    .replace(/^\s*the\s+/i, "")
    .replace(/\s+(in\s+the\s+work\s+area|above\s+the\s+ceiling|of\s+(the\s+)?(home|building|this\s+job)|above|below)\s*$/i, "")
    .trim()
    .replace(/^\w/, c => c.toUpperCase()) || prompt.replace(/\?$/, "").trim();
}

// Decode a QuoteSnapshot into structured crew-readable items.
// Returns { items: [{label, value}], qty, classification, addons: [string] }
// Strategy: try snapshotJobTypeId first, then bookingJobTypeId, then scan all
// questions by answer key as a last resort — so we always surface data when
// a snapshot exists, even if the booking was edited to a different type code.
function buildScopeItems(selectedOptionsJson, selectedAddonsJson, questionsByType, optionsByQuestion, addonsByType, bookingJobTypeId, snapshotJobTypeId) {
  const items = [];
  let qty = null;
  let classification = "";
  const addons = [];

  try {
    const snap = JSON.parse(selectedOptionsJson || "{}");
    const answers = snap.answers || {};
    const answerKeys = Object.keys(answers).filter(k => answers[k] !== undefined && answers[k] !== null && answers[k] !== "");
    qty = snap.qty ? Number(snap.qty) : null;
    classification = snap.classification || "";

    if (answerKeys.length > 0) {
      // Build a flat question lookup from ALL types so we can always find prompts
      const allQuestions = {};
      for (const typeQuestions of Object.values(questionsByType)) {
        for (const q of typeQuestions) allQuestions[q.question_id] = q;
      }

      // Prefer snapshot's job type questions (sorted), then booking's, then any match
      const preferred  = questionsByType[snapshotJobTypeId]  || [];
      const secondary  = questionsByType[bookingJobTypeId]   || [];
      // Union: snapshot type first, then booking type extras, then anything else
      const seen = new Set();
      const orderedQuestions = [];
      for (const q of [...preferred, ...secondary]) {
        if (!seen.has(q.question_id)) { seen.add(q.question_id); orderedQuestions.push(q); }
      }
      // Fallback: any question matching an answer key that wasn't already included
      for (const key of answerKeys) {
        if (!seen.has(key) && allQuestions[key]) {
          seen.add(key);
          orderedQuestions.push(allQuestions[key]);
        }
      }

      for (const q of orderedQuestions) {
        const rawAnswer = answers[q.question_id];
        if (rawAnswer === undefined || rawAnswer === null || rawAnswer === "") continue;
        const opts = optionsByQuestion[q.question_id] || [];
        let displayAnswer;
        if (opts.length > 0) {
          const opt = opts.find(o => o.option_id === String(rawAnswer));
          displayAnswer = opt ? opt.label : String(rawAnswer);
        } else {
          displayAnswer = String(rawAnswer);
        }
        items.push({ label: crewLabel(q.prompt), value: displayAnswer });
      }
    }
  } catch (_) { /* malformed JSON — skip */ }

  try {
    const addonIds = JSON.parse(selectedAddonsJson || "[]");
    const allAddons = [...(addonsByType[snapshotJobTypeId] || []), ...(addonsByType[bookingJobTypeId] || [])];
    for (const aid of addonIds) {
      const addon = allAddons.find(a => a.addon_id === aid);
      if (addon) addons.push(addon.name_public);
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

    // Fetch bookings, quote snapshots, and quote config in parallel
    const [bookingsResp, quotesResp, qcfg] = await Promise.all([
      sheets.spreadsheets.values.get({ spreadsheetId, range: "Bookings!A:Z" }),
      sheets.spreadsheets.values.get({ spreadsheetId, range: "QuoteSnapshots!A:Z" }).catch(() => ({ data: { values: [] } })),
      getQuoteConfig().catch(() => null),
    ]);

    const rows = bookingsResp.data.values || [];
    if (rows.length < 2) return json(res, 200, { ok: true, jobs: [] });

    const [headers, ...data] = rows;
    const idx = Object.fromEntries(headers.map((h, i) => [h, i]));

    // Build job type name lookup: job_type_id → name_public
    const jobTypeNames = {};
    if (qcfg) {
      for (const jt of qcfg.jobTypes) {
        jobTypeNames[jt.job_type_id] = jt.name_public;
      }
    }

    // Build lookup from QuoteSnapshots keyed by quote_id
    // Stores: selected_options_json, selected_addons_json, job_type_id (snapshot may have it too)
    const snapshotMap = {};
    const qRows = quotesResp.data.values || [];
    if (qRows.length > 1) {
      const [qHeaders, ...qData] = qRows;
      const qi = Object.fromEntries(qHeaders.map((h, i) => [h, i]));
      qData.forEach(r => {
        const qid = String(r[qi["quote_id"] ?? -1] ?? "").trim();
        if (!qid) return;
        snapshotMap[qid] = {
          selected_options_json: String(r[qi["selected_options_json"] ?? -1] ?? "").trim(),
          selected_addons_json:  String(r[qi["selected_addons_json"]  ?? -1] ?? "").trim(),
          job_type_id:           String(r[qi["job_type_id"]           ?? -1] ?? "").trim(),
        };
      });
    }

    const today = todayLocalStr();

    const jobs = data
      .map(r => {
        const get = col => String(r[idx[col] ?? -1] ?? "").trim();
        const dt      = get("scheduled_datetime");
        const dateStr = dt ? dt.slice(0, 10) : "";
        const qid     = get("quote_id");
        const jobTypeId = get("job_type_id");

        // Build scope from quote snapshot answers (structured items)
        const snap = snapshotMap[qid] || {};
        const scopeResult = qcfg
          ? buildScopeItems(
              snap.selected_options_json,
              snap.selected_addons_json,
              qcfg.questionsByType,
              qcfg.optionsByQuestion,
              qcfg.addonsByType,
              jobTypeId,          // booking's job_type_id (may be edited/overridden)
              snap.job_type_id,   // snapshot's original job_type_id (preferred)
            )
          : { items: [], qty: null, classification: "", addons: [] };

        // Fallback plain-text scope for manually-created bookings (no quote snapshot)
        const scopeRaw   = get("scope_of_work");
        const bookingNotes = get("notes");
        const isInternalId = v => /^[A-Z]{1,3}-[A-Z0-9]{4,}$/i.test(v.trim());
        const plainScope = scopeResult.items.length === 0
          ? ([scopeRaw, bookingNotes].find(v => v && !isInternalId(v)) || "")
          : "";

        // Job type: use name_public from config; always fall back to the raw ID
        // so the crew sees something (even internal codes like A001)
        const rawJobTypeName = jobTypeNames[jobTypeId] || jobTypeNames[snap.job_type_id] || "";
        const jobTypeFallback = jobTypeId
          ? jobTypeId.replace(/_/g, " ").replace(/\b\w/g, c => c.toUpperCase())
          : "";
        const jobTypeName = rawJobTypeName || jobTypeFallback;

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
          // Structured scope (from quote answers — preferred)
          scope_items:        scopeResult.items,
          scope_qty:          scopeResult.qty,
          scope_status:       scopeResult.classification,
          scope_addons:       scopeResult.addons,
          // Plain-text fallback (for manually-created bookings)
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

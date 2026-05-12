// lib/leadQualityScore.js
// Scores each lead as A (high), B (moderate), or C (low/disqualified).
// Called at lead creation, quote lock, referral submit, and on status updates.
//
// Spec-compliant rules:
//  C — Rejected zone | commercial/industrial scope | disqualifying module answers
//      (commercial, industrial, price_shopper)
//  B — OUTER zone | complex service type (panel, generator, troubleshoot, rewire…)
//      | ready_with_review_flag | no phone
//      | incomplete data (no valid zip/city, no service type, no answered questions)
//  A — Valid service area + identifiable service + phone + ≥ 1 answered question

const { resolveZone, shouldReject } = require("./serviceArea");

// Service types that warrant B (need higher review / site visit common)
const B_SERVICE_KEYWORDS = [
  "panel", "generator", "troubleshoot", "troubleshooting", "old wiring",
  "old-wiring", "rewire", "rewiring", "service upgrade", "main service",
  "200 amp", "400 amp", "subpanel", "sub panel",
];

// Disqualifying answer values from estimator module answers (per spec)
const DISQUALIFY_VALUES = new Set([
  "commercial", "commercial_property", "industrial",
  "price_shopper", "price shopper",
]);

// Commercial / disqualifying keywords in job type or description
const C_KEYWORDS = [
  "commercial", "industrial", "warehouse", "restaurant", "retail",
  "apartment complex", "multi-family", "high-rise", "highrise", "price shopper",
];

/**
 * Score a lead's quality.
 * @param {object} lead
 *   - address {string}               — full address (ZIP/city extracted)
 *   - job_type {string}              — job type label
 *   - notes {string}                 — job description / notes
 *   - quote_snapshot_json {string}   — JSON string with { classification, answers }
 *   - lead_source {string}           — canonical lead source
 *   - phone {string}                 — contact phone number
 * @returns {"A"|"B"|"C"}
 */
function scoreLeadQuality(lead) {
  const zip     = extractZip(String(lead.address || ""));
  const city    = extractCity(String(lead.address || ""));
  const jobType = String(lead.job_type || "").toLowerCase();
  const notes   = String(lead.notes   || "").toLowerCase();
  const phone   = String(lead.phone   || "").replace(/\D/g, "");

  // ── Parse snapshot JSON ────────────────────────────────────────────────────
  let classification = "";
  let answers = {};
  let questionsAnswered = 0;
  try {
    const snap = JSON.parse(lead.quote_snapshot_json || "{}");
    classification = String(snap.classification || "").toLowerCase();
    answers = snap.answers || {};
    questionsAnswered = Object.keys(answers).filter(
      k => answers[k] && answers[k] !== "_unsure"
    ).length;
  } catch { /* ignore bad JSON */ }

  // ── Zone resolution ────────────────────────────────────────────────────────
  const zoneResult   = resolveZone(zip, city);
  const zone         = zoneResult ? zoneResult.zone : null;
  const driveMinutes = zoneResult ? zoneResult.drive_minutes : null;
  const rejectResult = shouldReject({ zone, drive_minutes: driveMinutes });

  // ── C triggers ─────────────────────────────────────────────────────────────
  // 1. Outside service area entirely
  if (rejectResult.reject) return "C";

  // 2. Commercial / industrial scope in job type or notes
  const combined = jobType + " " + notes;
  if (C_KEYWORDS.some(kw => combined.includes(kw))) return "C";

  // 3. Disqualifying module answers (commercial, industrial, price_shopper)
  const answerValues = Object.values(answers).map(v => String(v).toLowerCase());
  if (answerValues.some(v => DISQUALIFY_VALUES.has(v))) return "C";

  // 4. Classification was explicitly disqualified / manual-only
  if (classification === "disqualified" || classification === "manual_quote_only") return "C";

  // ── B triggers ─────────────────────────────────────────────────────────────
  // 1. OUTER zone (custom quote required, non-instant)
  if (zone === "OUTER") return "B";

  // 2. Complex service type
  if (B_SERVICE_KEYWORDS.some(kw => jobType.includes(kw))) return "B";

  // 3. Classification flagged for review
  if (classification === "ready_with_review_flag") return "B";

  // 4. No phone number (cannot contact)
  if (!phone) return "B";

  // 5. Insufficient data for A: must have a valid zip/city AND a service type
  //    AND at least one answered question (per spec A preconditions)
  if (!zip && !city) return "B";
  if (!jobType)      return "B";
  if (questionsAnswered === 0) return "B";   // must have ≥ 1 answered question

  // ── A — all positive signals present ──────────────────────────────────────
  return "A";
}

// ── Helpers ────────────────────────────────────────────────────────────────────

function extractZip(address) {
  const m = address.match(/\b(\d{5})(?:-\d{4})?\b/);
  return m ? m[1] : "";
}

function extractCity(address) {
  // "123 Main St, Orange, TX 77630" → city before state abbreviation
  const m = address.match(/,\s*([^,]+),\s*[A-Z]{2}/);
  return m ? m[1].trim() : "";
}

module.exports = { scoreLeadQuality };

// api/quote-config.js
// GET /api/quote/config — returns sanitized quote engine config (public, no auth needed).
// V2 engine only — requires ESTIMATOR_V2_SHEET_ID. Startup will exit(1) if missing.

const { getActiveConfig } = require("../lib/estimatorV2Config");
const { CLASSIFICATIONS, ASSEMBLY_TO_SERVICE } = require("../lib/serviceClassification");

// Build a flat map: assembly_code → ballparkRange, for the frontend disqualify path.
function buildBallparkRanges() {
  const out = {};
  for (const [assemblyCode, serviceKey] of Object.entries(ASSEMBLY_TO_SERVICE)) {
    const cls = CLASSIFICATIONS[serviceKey];
    if (cls?.ballparkRange) out[assemblyCode] = cls.ballparkRange;
  }
  // Also include direct-key lookups (job_type_id === service key)
  for (const [key, cls] of Object.entries(CLASSIFICATIONS)) {
    if (cls?.ballparkRange) out[key] = cls.ballparkRange;
  }
  return out;
}

async function handleQuoteConfig(req, res) {
  try {
    const config = await getActiveConfig();

    // Strip internal V2 data (_v2) before sending to browser
    const { _v2, ...publicConfig } = config;

    // Include ballparkRanges so the frontend can show a range card even when
    // a disqualifying answer is selected before the price engine is called.
    publicConfig.serviceBallparkRanges = buildBallparkRanges();

    res.writeHead(200, {
      "Content-Type":  "application/json",
      "Cache-Control": "public, max-age=300",
    });
    res.end(JSON.stringify(publicConfig));
  } catch (err) {
    console.error("[quote-config] error:", err.message);
    // 503 signals transient/retryable failure (quota spike, connectivity)
    // so the frontend can display "try again" rather than a blank wizard.
    res.writeHead(503, { "Content-Type": "application/json", "Retry-After": "10" });
    res.end(JSON.stringify({ error: "Quote config temporarily unavailable — please retry", detail: err.message }));
  }
}

module.exports = { handleQuoteConfig };

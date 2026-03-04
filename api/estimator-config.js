// api/estimator-config.js
// GET  /api/estimator/config  — return normalized modules + services config
// POST /api/estimator/quote   — stub (full logic in Prompt 3)

const { getEstimatorConfig } = require("../lib/estimatorModulesConfig");

function json(res, status, payload) {
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(JSON.stringify(payload));
}

async function handleEstimatorConfig(req, res) {
  try {
    const config = await getEstimatorConfig();
    json(res, 200, { ok: true, ...config });
  } catch (err) {
    console.error("[estimator-config]", err.message);
    json(res, 500, { ok: false, error: err.message });
  }
}

async function handleEstimatorQuote(req, res) {
  // Stub — full pricing logic wired in Prompt 3
  json(res, 200, { ok: true, stub: true, message: "Quote engine coming in Phase 3." });
}

module.exports = { handleEstimatorConfig, handleEstimatorQuote };

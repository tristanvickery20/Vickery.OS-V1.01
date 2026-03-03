// api/quote-config.js
// GET /api/quote/config — returns sanitized quote engine config (public, no auth needed).
// Uses V2 config when ESTIMATOR_V2_SHEET_ID is set, otherwise falls back to V1.

const { getActiveConfig } = require("../lib/estimatorV2Config");

async function handleQuoteConfig(req, res) {
  try {
    const config = await getActiveConfig();

    // Strip internal V2 data (_v2) before sending to browser
    const { _v2, ...publicConfig } = config;

    res.writeHead(200, {
      "Content-Type":  "application/json",
      "Cache-Control": "public, max-age=300",
    });
    res.end(JSON.stringify(publicConfig));
  } catch (err) {
    console.error("[quote-config] error:", err.message);
    res.writeHead(500, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "Failed to load quote config", detail: err.message }));
  }
}

module.exports = { handleQuoteConfig };

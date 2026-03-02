// api/quote-config.js
// GET /api/quote/config — returns sanitized quote engine config (public, no auth needed).

const { getQuoteConfig } = require("../lib/sheetsConfig");

async function handleQuoteConfig(req, res) {
  try {
    const config = await getQuoteConfig();
    res.writeHead(200, {
      "Content-Type": "application/json",
      "Cache-Control": "public, max-age=300",
    });
    res.end(JSON.stringify(config));
  } catch (err) {
    console.error("[quote-config] error:", err.message);
    res.writeHead(500, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "Failed to load quote config", detail: err.message }));
  }
}

module.exports = { handleQuoteConfig };

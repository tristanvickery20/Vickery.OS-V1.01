const { calculateRecessedLights } = require("../lib/pricing");

function handleQuoteApi(req, res) {
  const url = new URL(req.url, "http://localhost");
  const lights = Number(url.searchParams.get("lights") || 0);

  const result = calculateRecessedLights(lights);

  res.writeHead(200, { "Content-Type": "application/json" });
  res.end(JSON.stringify(result));
}

module.exports = { handleQuoteApi };
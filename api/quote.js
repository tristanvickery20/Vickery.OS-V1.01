// api/quote.js — legacy V1 recessed-light quick-price endpoint.
// This endpoint has been retired with the V1 quote engine.
// Use POST /api/estimator/quote or POST /api/quote/calc instead.

function handleQuoteApi(req, res) {
  res.writeHead(410, { "Content-Type": "application/json" });
  res.end(JSON.stringify({
    ok: false,
    error: "This endpoint has been retired with the V1 quote engine. " +
           "Use POST /api/estimator/quote or POST /api/quote/calc instead.",
  }));
}

module.exports = { handleQuoteApi };

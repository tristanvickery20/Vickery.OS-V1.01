// api/quotes.js
// POST /api/quotes/create — legacy Apps Script integration endpoint.
// V1 pricing engine has been removed. This endpoint now returns 410 Gone
// directing callers to use the V2 estimator API: POST /api/estimator/quote
// or the quote flow at POST /api/quote/calc + /api/quote/lock.

const { logAudit, genRequestId } = require("../lib/audit");

async function handleCreateQuote(req, res) {
  res.writeHead(410, { "Content-Type": "application/json" });
  res.end(JSON.stringify({
    ok: false,
    error: "This endpoint has been retired with the V1 quote engine. " +
           "Use POST /api/estimator/quote (V2 engine) or the quote flow " +
           "at POST /api/quote/calc + POST /api/quote/lock instead.",
    migration: {
      v2_endpoint: "POST /api/estimator/quote",
      flow_calc:   "POST /api/quote/calc",
      flow_lock:   "POST /api/quote/lock",
    },
  }));

  logAudit({
    action: "quote.create.v1.retired",
    entity_type: "quote",
    entity_id:   "n/a",
    field:       "*",
    new_value:   "410",
    note:        "V1 endpoint called after retirement",
    source:      "quote",
    request_id:  genRequestId(),
  }).catch(() => {});
}

module.exports = { handleCreateQuote };

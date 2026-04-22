// api/accounting-transactions.js
// GET /api/accounting/transactions — returns QB purchases/expenses
// GET /api/accounting/profit-loss  — returns QB P&L summary
// Falls back to empty arrays when not connected to QB.

const { getConfig } = require("../lib/config");

function json(res, status, data) {
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(JSON.stringify(data));
}

// GET /api/accounting/transactions?start=YYYY-MM-DD&end=YYYY-MM-DD&max=N
async function handleGetTransactions(req, res) {
  try {
    const cfg = await getConfig();
    if (cfg.qb_connected !== "true") {
      return json(res, 200, { ok: true, connected: false, transactions: [], message: "QuickBooks not connected." });
    }

    const url = new URL(req.url, "http://localhost");
    const start = url.searchParams.get("start") || undefined;
    const end   = url.searchParams.get("end")   || undefined;
    const max   = parseInt(url.searchParams.get("max") || "100", 10);

    // Load the QB provider dynamically so this module doesn't force QB mode
    const provider = require("../lib/accounting/qb-provider");
    const result = await provider.getTransactions({ startDate: start, endDate: end, maxResults: max });
    return json(res, 200, { ok: result.ok, connected: true, ...result });
  } catch (err) {
    return json(res, 500, { ok: false, error: err.message, transactions: [] });
  }
}

// GET /api/accounting/profit-loss?start=YYYY-MM-DD&end=YYYY-MM-DD
async function handleGetProfitLoss(req, res) {
  try {
    const cfg = await getConfig();
    if (cfg.qb_connected !== "true") {
      return json(res, 200, { ok: true, connected: false, message: "QuickBooks not connected." });
    }

    const url = new URL(req.url, "http://localhost");
    const start = url.searchParams.get("start") || undefined;
    const end   = url.searchParams.get("end")   || undefined;

    const provider = require("../lib/accounting/qb-provider");
    if (typeof provider.getProfitLoss !== "function") {
      return json(res, 200, { ok: false, error: "P&L not supported by active provider." });
    }
    const result = await provider.getProfitLoss({ startDate: start, endDate: end });
    return json(res, 200, { ok: result.ok, connected: true, ...result });
  } catch (err) {
    return json(res, 500, { ok: false, error: err.message });
  }
}

// GET /api/accounting/accounts — returns QB expense accounts for the Category dropdown
// Cached for 10 minutes since the chart of accounts rarely changes.
let _accountsCache = null;
let _accountsCacheAt = 0;
const ACCOUNTS_CACHE_TTL = 10 * 60 * 1000;

async function handleGetAccounts(req, res) {
  try {
    const cfg = await getConfig();
    if (cfg.qb_connected !== "true") {
      return json(res, 200, { ok: true, connected: false, accounts: [] });
    }

    const now = Date.now();
    if (_accountsCache && (now - _accountsCacheAt) < ACCOUNTS_CACHE_TTL) {
      return json(res, 200, { ok: true, connected: true, accounts: _accountsCache });
    }

    const provider = require("../lib/accounting/qb-provider");
    const result = await provider.getAccounts();
    if (result.ok) {
      _accountsCache = result.accounts;
      _accountsCacheAt = now;
    }
    return json(res, 200, { ok: result.ok, connected: true, accounts: result.accounts || [] });
  } catch (err) {
    return json(res, 500, { ok: false, error: err.message, accounts: [] });
  }
}

module.exports = { handleGetTransactions, handleGetProfitLoss, handleGetAccounts };

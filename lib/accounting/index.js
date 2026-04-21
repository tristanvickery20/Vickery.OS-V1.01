// lib/accounting/index.js
// Dynamic accounting provider — automatically uses QuickBooks when connected,
// falls back to mock when not. No env var required.
// Connection status is checked per-call with a 2-minute cache so the switch is instant
// the moment you connect or disconnect in Settings → Billing.

const { getConfig } = require("../config");
const mockProvider   = require("./mock-provider");

let _isQbConnected = false;
let _cacheUntil    = 0;

async function _getActiveProvider() {
  if (Date.now() < _cacheUntil) {
    return _isQbConnected ? require("./qb-provider") : mockProvider;
  }
  try {
    const cfg      = await getConfig();
    _isQbConnected = cfg.qb_connected === "true" && !!cfg.qb_access_token;
  } catch {
    _isQbConnected = false;
  }
  _cacheUntil = Date.now() + 2 * 60 * 1000; // re-check every 2 minutes
  const p = _isQbConnected ? require("./qb-provider") : mockProvider;
  console.log(`[accounting] Active provider: ${p.name} (QB connected: ${_isQbConnected})`);
  return p;
}

// Expose a way for other modules to force a refresh (e.g. after OAuth callback)
function invalidateProviderCache() {
  _cacheUntil = 0;
}

// All methods defined in base.js are proxied here.
// Each call dynamically resolves the correct provider.
const METHODS = [
  "createCustomer",
  "createInvoice",
  "sendInvoice",
  "recordPayment",
  "getInvoiceStatus",
  "getCustomerBalance",
  "getARSummary",
  "getCashSnapshot",
  "getTransactions",
  "getProfitLoss",
];

const provider = { name: "dynamic" };

for (const method of METHODS) {
  provider[method] = async (...args) => {
    const p = await _getActiveProvider();
    if (typeof p[method] !== "function") {
      return { ok: false, error: `${method} not supported by provider ${p.name}` };
    }
    return p[method](...args);
  };
}

// Expose active provider name for logging/display
Object.defineProperty(provider, "name", {
  get: () => (_isQbConnected ? "quickbooks" : "mock"),
  configurable: true,
});

provider.invalidateCache = invalidateProviderCache;
provider.getActive       = _getActiveProvider;

module.exports = provider;

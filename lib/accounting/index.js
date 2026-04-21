// lib/accounting/index.js
// Provider loader — reads ACCOUNTING_PROVIDER env var and returns the active provider singleton.
// Valid values: "mock" (default), "qb_sandbox", "qb_live"
// All API modules import the provider from here; never import a provider directly.

const VALID_PROVIDERS = ['mock', 'qb_sandbox', 'qb_live'];

function loadProvider() {
  const name = (process.env.ACCOUNTING_PROVIDER || 'mock').toLowerCase().trim();
  if (!VALID_PROVIDERS.includes(name)) {
    console.warn(`[accounting] Unknown ACCOUNTING_PROVIDER="${name}", falling back to mock.`);
    return require('./mock-provider');
  }
  if (name === 'mock') return require('./mock-provider');
  if (name === 'qb_sandbox' || name === 'qb_live') {
    return require('./qb-provider');
  }
  console.warn(`[accounting] Provider "${name}" not yet implemented — using mock.`);
  return require('./mock-provider');
}

const provider = loadProvider();
console.log(`[accounting] Active provider: ${provider.name}`);

module.exports = provider;

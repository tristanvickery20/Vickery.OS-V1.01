// lib/accounting/index.js
// CRM-native financial provider — always reads/writes from Google Sheets.
// QuickBooks has been removed from this stack. The CRM is the source of truth.

const crmProvider = require("./crm-provider");

// All method calls go directly to the CRM provider.
const provider = {
  name: "crm",
  ...crmProvider,
  // Expose a no-op for any legacy callers that still check invalidateCache
  invalidateCache: () => {},
  getActive: () => crmProvider,
};

module.exports = provider;

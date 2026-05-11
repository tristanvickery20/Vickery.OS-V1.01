// lib/paymentSettings.js
// Reads payment/financing configuration from the Config tab.
// All thresholds and toggles are admin-configurable — never hardcoded in business logic.

const { getConfig } = require("./config");

// Cache settings for 60 seconds to avoid hammering Sheets on every payment-options call
let _cache = null;
let _cacheUntil = 0;

const DEFAULTS = {
  // Payment method toggles
  allow_cash:             "true",
  allow_card:             "true",
  allow_tap_to_pay:       "true",
  allow_payment_links:    "true",
  allow_ach:              "false",
  allow_pay_later:        "true",
  allow_financing:        "true",

  // Provider names
  pay_later_provider:     "Square Afterpay",
  financing_provider:     "Wisetack",

  // Amount thresholds
  pay_later_min_amount:           "100",
  wisetack_min_amount:            "500",
  large_job_review_threshold:     "2500",
  max_online_financing_display_amount: "15000",

  // Deposit rules
  deposit_required_threshold:     "500",
  default_deposit_percent:        "25",
  minimum_deposit_amount:         "100",
  allow_pay_at_completion:        "true",

  // Risk / review gates
  require_deposit_for_large_jobs:      "true",
  require_manual_review_for_large_jobs: "false",
  require_manual_review_for_risk_flags: "false",
  require_cash_verification:            "false",

  // Processing fee rates (used to compute net_amount on payment records)
  // Square standard: 2.6% + $0.10 in-person, 2.9% + $0.30 online
  square_fee_percent:      "2.6",
  square_fixed_fee:        "0.10",
  square_online_fee_percent: "2.9",
  square_online_fixed_fee:   "0.30",

  // Afterpay: 6% + $0.30
  afterpay_fee_percent:    "6.0",
  afterpay_fixed_fee:      "0.30",

  // Wisetack: varies 3.9%–9.9%; use a conservative 8% estimate for fee tracking
  wisetack_fee_percent:    "8.0",
};

/**
 * Return the full payment settings object, merging Config tab values with defaults.
 * All numeric thresholds are returned as numbers; boolean toggles as booleans.
 */
async function getPaymentSettings(force = false) {
  if (!force && _cache && Date.now() < _cacheUntil) return _cache;

  let cfg = {};
  try {
    cfg = await getConfig();
  } catch {
    // Use defaults if Config is unreachable
  }

  function str(key)  { return cfg[key] !== undefined ? String(cfg[key]) : DEFAULTS[key] ?? ""; }
  function bool(key) { const v = str(key); return v === "true" || v === "1"; }
  function num(key)  { const v = str(key); const n = parseFloat(v); return isNaN(n) ? parseFloat(DEFAULTS[key] ?? "0") : n; }

  _cache = {
    // Toggles
    allow_cash:               bool("allow_cash"),
    allow_card:               bool("allow_card"),
    allow_tap_to_pay:         bool("allow_tap_to_pay"),
    allow_payment_links:      bool("allow_payment_links"),
    allow_ach:                bool("allow_ach"),
    allow_pay_later:          bool("allow_pay_later"),
    allow_financing:          bool("allow_financing"),

    // Provider names
    pay_later_provider:       str("pay_later_provider"),
    financing_provider:       str("financing_provider"),

    // Thresholds (numbers)
    pay_later_min_amount:            num("pay_later_min_amount"),
    wisetack_min_amount:             num("wisetack_min_amount"),
    large_job_review_threshold:      num("large_job_review_threshold"),
    max_online_financing_display_amount: num("max_online_financing_display_amount"),
    deposit_required_threshold:      num("deposit_required_threshold"),
    default_deposit_percent:         num("default_deposit_percent"),
    minimum_deposit_amount:          num("minimum_deposit_amount"),
    allow_pay_at_completion:         bool("allow_pay_at_completion"),

    // Gates
    require_deposit_for_large_jobs:       bool("require_deposit_for_large_jobs"),
    require_manual_review_for_large_jobs: bool("require_manual_review_for_large_jobs"),
    require_manual_review_for_risk_flags: bool("require_manual_review_for_risk_flags"),
    require_cash_verification:            bool("require_cash_verification"),

    // Fee rates
    square_fee_percent:        num("square_fee_percent"),
    square_fixed_fee:          num("square_fixed_fee"),
    square_online_fee_percent: num("square_online_fee_percent"),
    square_online_fixed_fee:   num("square_online_fixed_fee"),
    afterpay_fee_percent:      num("afterpay_fee_percent"),
    afterpay_fixed_fee:        num("afterpay_fixed_fee"),
    wisetack_fee_percent:      num("wisetack_fee_percent"),
  };

  _cacheUntil = Date.now() + 60_000;
  return _cache;
}

/** Estimate the processing fee for a given gross amount and provider. */
function estimateFee(gross, provider, settings) {
  const g = Number(gross) || 0;
  switch (String(provider || "").toLowerCase()) {
    case "square":
      return Math.round((g * settings.square_fee_percent / 100 + settings.square_fixed_fee) * 100) / 100;
    case "square_online":
      return Math.round((g * settings.square_online_fee_percent / 100 + settings.square_online_fixed_fee) * 100) / 100;
    case "square_afterpay":
      return Math.round((g * settings.afterpay_fee_percent / 100 + settings.afterpay_fixed_fee) * 100) / 100;
    case "wisetack":
      return Math.round(g * settings.wisetack_fee_percent / 100 * 100) / 100;
    case "cash":
    case "manual":
      return 0;
    default:
      return 0;
  }
}

/** Seed the default payment config keys into the Config tab (run at startup). */
async function seedPaymentConfigDefaults() {
  try {
    const { setConfigKeys, getConfig } = require("./config");
    const cfg = await getConfig();
    const missing = {};
    for (const [key, val] of Object.entries(DEFAULTS)) {
      if (!cfg[key]) missing[key] = val;
    }
    if (Object.keys(missing).length > 0) {
      await setConfigKeys(missing);
      console.log(`[paymentSettings] Seeded ${Object.keys(missing).length} default payment config keys.`);
    }
  } catch (err) {
    console.error("[paymentSettings] seedPaymentConfigDefaults error (non-fatal):", err.message);
  }
}

function invalidateCache() { _cacheUntil = 0; _cache = null; }

module.exports = { getPaymentSettings, estimateFee, seedPaymentConfigDefaults, invalidateCache, DEFAULTS };

// lib/paymentStatus.js
// Payment, financing, and pay-later status constants.
// computePaymentOptions() returns what to show the customer based on quote amount + risk.
// This file contains ZERO business rules about APR, approval odds, or lending terms.

// ─── Payment Status ───────────────────────────────────────────────────────────
const PAYMENT_STATUS = {
  UNPAID:                  "unpaid",
  DEPOSIT_REQUIRED:        "deposit_required",
  DEPOSIT_LINK_SENT:       "deposit_link_sent",
  DEPOSIT_PAID:            "deposit_paid",
  PAYMENT_LINK_SENT:       "payment_link_sent",
  PARTIALLY_PAID:          "partially_paid",
  PAID:                    "paid",
  FAILED:                  "failed",
  REFUNDED:                "refunded",
  CASH_RECORDED:           "cash_recorded",
  CASH_PENDING_HANDOFF:    "cash_pending_handoff",
  CASH_VERIFIED:           "cash_verified",
  PAYMENT_DISPUTED:        "payment_disputed",
  WRITE_OFF:               "write_off",
};

// ─── Financing Status (Wisetack or future provider) ──────────────────────────
const FINANCING_STATUS = {
  NOT_OFFERED:             "not_offered",
  ELIGIBLE:                "eligible",
  LINK_SENT:               "link_sent",
  CUSTOMER_STARTED:        "customer_started",
  APPROVED:                "approved",
  DECLINED:                "declined",
  ACCEPTED:                "accepted",
  FUNDED:                  "funded",
  EXPIRED:                 "expired",
  CANCELED:                "canceled",
  MANUAL_FOLLOWUP:         "manual_followup_required",
};

// ─── Pay-Later Status (Square Afterpay or future provider) ───────────────────
const PAY_LATER_STATUS = {
  NOT_OFFERED:    "not_offered",
  ELIGIBLE:       "eligible",
  LINK_SENT:      "link_sent",
  SELECTED:       "selected",
  APPROVED:       "approved",
  DECLINED:       "declined",
  COMPLETED:      "completed",
  FAILED:         "failed",
  CANCELED:       "canceled",
};

// ─── Payment Type constants ───────────────────────────────────────────────────
const PAYMENT_TYPE = {
  DEPOSIT:             "deposit",
  PROGRESS:            "progress_payment",
  FINAL:               "final_payment",
  REFUND:              "refund",
  CASH:                "cash_payment",
  FINANCING_PAYOUT:    "financing_payout",
  FINANCING_FEE:       "financing_fee",
  PROCESSING_FEE:      "card_processing_fee",
  PAY_LATER_FEE:       "pay_later_fee",
  ADJUSTMENT:          "adjustment",
  WRITE_OFF:           "write_off",
};

// ─── Payment Provider constants ───────────────────────────────────────────────
const PAYMENT_PROVIDER = {
  SQUARE:          "square",
  SQUARE_AFTERPAY: "square_afterpay",
  WISETACK:        "wisetack",
  CASH:            "cash",
  MANUAL:          "manual",
  OTHER:           "other",
};

// ─── Payment Method constants ─────────────────────────────────────────────────
const PAYMENT_METHOD = {
  CASH:          "cash",
  CARD:          "card",
  TAP_TO_PAY:    "tap_to_pay",
  APPLE_PAY:     "apple_pay",
  GOOGLE_PAY:    "google_pay",
  ACH:           "ach",
  PAYMENT_LINK:  "payment_link",
  AFTERPAY:      "afterpay",
  WISETACK:      "wisetack",
  CHECK:         "check",
  ADJUSTMENT:    "manual_adjustment",
};

// ─── Helper: is this status "effectively paid"? ───────────────────────────────
function isPaid(paymentStatus) {
  return [
    PAYMENT_STATUS.PAID,
    PAYMENT_STATUS.CASH_VERIFIED,
    PAYMENT_STATUS.CASH_RECORDED,
  ].includes(String(paymentStatus || "").toLowerCase());
}

// ─── Helper: is a financing status "satisfied" (can count as payment gate)? ───
function isFinancingFunded(financingStatus) {
  return String(financingStatus || "") === FINANCING_STATUS.FUNDED;
}

// ─── Helper: compute display label for payment_status ─────────────────────────
const PAYMENT_STATUS_LABELS = {
  unpaid:                "Unpaid",
  deposit_required:      "Deposit Required",
  deposit_link_sent:     "Deposit Link Sent",
  deposit_paid:          "Deposit Paid",
  payment_link_sent:     "Payment Link Sent",
  partially_paid:        "Partially Paid",
  paid:                  "Paid",
  failed:                "Failed",
  refunded:              "Refunded",
  cash_recorded:         "Cash Recorded",
  cash_pending_handoff:  "Cash — Pending Handoff",
  cash_verified:         "Cash Verified",
  payment_disputed:      "Payment Disputed",
  write_off:             "Written Off",
};

const FINANCING_STATUS_LABELS = {
  not_offered:             "Not Offered",
  eligible:                "Eligible",
  link_sent:               "Link Sent",
  customer_started:        "Customer Started",
  approved:                "Approved",
  declined:                "Declined",
  accepted:                "Accepted",
  funded:                  "Funded",
  expired:                 "Expired",
  canceled:                "Canceled",
  manual_followup_required: "Needs Follow-Up",
};

// ─── Core: computePaymentOptions ─────────────────────────────────────────────
/**
 * Given a quote amount and risk flags, return the set of payment options to display.
 * settings = result of getPaymentSettings()
 * riskFlags = array of strings (e.g. ["photo_required", "generator_scope", "panel_scope"])
 *
 * Returns: {
 *   standard: [{id, label, description, provider}],
 *   pay_later: {available, provider, label, description} | null,
 *   financing: {available, provider, label, description, min_amount} | null,
 *   deposit_required: bool,
 *   requires_review: bool,
 *   tier: "small" | "medium" | "large",
 * }
 */
function computePaymentOptions(amount, riskFlags = [], settings) {
  const amt = Number(amount) || 0;
  const flags = Array.isArray(riskFlags) ? riskFlags : [];
  const hasRisk = flags.length > 0;

  // Tier classification
  let tier = "small";
  if (amt >= settings.wisetack_min_amount && amt < settings.large_job_review_threshold) tier = "medium";
  if (amt >= settings.large_job_review_threshold) tier = "large";

  // Standard payment options (always show if enabled)
  const standard = [];
  if (settings.allow_card) {
    standard.push({ id: "card", label: "Card", description: "Visa, Mastercard, Amex, Discover", provider: "square" });
    if (settings.allow_tap_to_pay) {
      standard.push({ id: "tap", label: "Tap to Pay", description: "Apple Pay, Google Pay, contactless card", provider: "square" });
    }
  }
  if (settings.allow_payment_links) {
    standard.push({ id: "payment_link", label: "Payment Link", description: "We'll send a secure payment link — pay from any device", provider: "square" });
  }
  if (settings.allow_ach) {
    standard.push({ id: "ach", label: "Bank Transfer (ACH)", description: "Pay directly from your bank account", provider: "square" });
  }
  if (settings.allow_cash) {
    standard.push({ id: "cash", label: "Cash", description: "Exact change appreciated", provider: "cash" });
  }

  // Pay-later (Afterpay) — show for $100+ if enabled
  let pay_later = null;
  if (settings.allow_pay_later && amt >= settings.pay_later_min_amount) {
    pay_later = {
      available:   true,
      provider:    settings.pay_later_provider,
      label:       "Pay Later",
      description: "Split your payment into installments if eligible. Powered by " + settings.pay_later_provider + ".",
    };
  }

  // Financing (Wisetack) — show for $500+ up to display cap if enabled
  let financing = null;
  if (settings.allow_financing && amt >= settings.wisetack_min_amount && amt <= settings.max_online_financing_display_amount) {
    financing = {
      available:  true,
      provider:   settings.financing_provider,
      label:      "Monthly Payment Options",
      description: "Check if this project qualifies for monthly payments. Powered by " + settings.financing_provider + ".",
      min_amount: settings.wisetack_min_amount,
    };
  }

  // Deposit required for large jobs or if amount exceeds threshold
  const deposit_required =
    (tier === "large" && settings.require_deposit_for_large_jobs) ||
    amt >= settings.deposit_required_threshold;

  // Review required for large jobs or high-risk flags
  const requires_review =
    (tier === "large" && settings.require_manual_review_for_large_jobs) ||
    (hasRisk && settings.require_manual_review_for_risk_flags);

  return { standard, pay_later, financing, deposit_required, requires_review, tier, amount: amt };
}

module.exports = {
  PAYMENT_STATUS,
  FINANCING_STATUS,
  PAY_LATER_STATUS,
  PAYMENT_TYPE,
  PAYMENT_PROVIDER,
  PAYMENT_METHOD,
  PAYMENT_STATUS_LABELS,
  FINANCING_STATUS_LABELS,
  isPaid,
  isFinancingFunded,
  computePaymentOptions,
};

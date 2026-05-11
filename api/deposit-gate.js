const { PAYMENT_STATUS, isPaid, isFinancingFunded } = require("../lib/paymentStatus");

function requiresDeposit(status) {
  return status === "Scheduled" || status === "In Progress";
}

/**
 * shouldGate — returns true if the lead should be blocked from scheduling.
 *
 * Checks (in order):
 * 1. payment_status already satisfied (paid, cash_recorded, cash_verified, or financing funded) → never gate.
 * 2. Legacy deposit_required flag + deposit_received > 0 → not gated.
 * 3. deposit_status: "deposit_paid" or "deposit_link_sent" → not gated if deposit_paid.
 */
function shouldGate({ deposit_required, deposit_received, status, payment_status, financing_status }) {
  // If the new payment_status model says it's paid, never block
  const ps = String(payment_status || "").toLowerCase();
  if (isPaid(ps)) return false;
  if (isFinancingFunded(String(financing_status || ""))) return false;
  if (ps === PAYMENT_STATUS.DEPOSIT_PAID) return false;

  // Legacy deposit gate: deposit_required flag + gating status + no deposit received
  const depReq = String(deposit_required).toLowerCase() === "true" || deposit_required === true;
  const depRec = Number(deposit_received || 0);
  const gatingStatus = requiresDeposit(String(status || ""));
  return depReq && gatingStatus && depRec <= 0;
}

module.exports = { shouldGate };
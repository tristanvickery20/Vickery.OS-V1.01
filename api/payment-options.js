// api/payment-options.js
// GET /api/payment-options?amount=X&risk_flags=flag1,flag2
// Returns the payment option set for a given quote amount and risk context.
// Used by the quote flow and lead detail to show the right payment choices.

const url = require("url");
const { getPaymentSettings } = require("../lib/paymentSettings");
const { computePaymentOptions } = require("../lib/paymentStatus");

function json(res, code, data) {
  res.writeHead(code, { "Content-Type": "application/json" });
  res.end(JSON.stringify(data));
}

async function handleGetPaymentOptions(req, res) {
  try {
    const q = url.parse(req.url, true).query;
    const amount = parseFloat(q.amount) || 0;
    const riskFlags = q.risk_flags
      ? String(q.risk_flags).split(",").map(s => s.trim()).filter(Boolean)
      : [];

    const settings = await getPaymentSettings();
    const options  = computePaymentOptions(amount, riskFlags, settings);

    json(res, 200, {
      ok: true,
      amount,
      ...options,
      // Include key thresholds so the UI can reason about gates without another round-trip
      thresholds: {
        pay_later_min:   settings.pay_later_min_amount,
        financing_min:   settings.wisetack_min_amount,
        large_job_min:   settings.large_job_review_threshold,
        deposit_min:     settings.deposit_required_threshold,
        deposit_pct:     settings.default_deposit_percent,
        financing_max:   settings.max_online_financing_display_amount,
      },
    });
  } catch (err) {
    json(res, 500, { ok: false, error: err.message });
  }
}

module.exports = { handleGetPaymentOptions };

// api/estimator-config.js
// GET  /api/estimator/config  — return normalized modules + services config
// POST /api/estimator/quote   — validated stub (full pricing logic in Prompt 3)

const { getEstimatorConfig } = require("../lib/estimatorModulesConfig");

function json(res, status, payload) {
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(JSON.stringify(payload));
}

function readBody(req) {
  return new Promise(resolve => {
    let buf = "";
    req.on("data", c => (buf += c));
    req.on("end", () => { try { resolve(JSON.parse(buf)); } catch { resolve({}); } });
  });
}

async function handleEstimatorConfig(req, res) {
  try {
    const config = await getEstimatorConfig();
    json(res, 200, { ok: true, ...config });
  } catch (err) {
    console.error("[estimator-config]", err.message);
    json(res, 500, { ok: false, error: err.message });
  }
}

async function handleEstimatorQuote(req, res) {
  try {
    const body = await readBody(req);
    const { segment, service_id, service_name, qty, answersByModule, photoCount } = body;

    if (!segment || !service_id) {
      return json(res, 400, { ok: false, error: "segment and service_id are required" });
    }

    // Compute aggregate risk multiplier from answers (placeholder; real math in Prompt 3)
    const config = await getEstimatorConfig();
    const service = (config.services || []).find(s => s.service_id === service_id);
    const tier_result = service?.tier || "instant_with_safeguards";

    // Tally any disqualify flags from answers
    let disqualified = tier_result === "site_visit_required";
    if (!disqualified && service) {
      const modules_csv = (service.modules_csv || "").split(",").map(m => m.trim()).filter(Boolean);
      for (const mid of modules_csv) {
        const mod = config.modulesById[mid];
        const ans = answersByModule?.[mid];
        if (mod && ans) {
          const opt = (mod.options || []).find(o => o.value === ans);
          if (opt?.disqualify) { disqualified = true; break; }
        }
      }
    }

    const result_tier = disqualified ? "site_visit_required" : "instant_with_safeguards";
    const message = disqualified
      ? "Based on your answers, an on-site assessment is required before we can provide pricing."
      : `Thank you! We've received your estimate request for ${service_name || service_id}. Our team will call to confirm pricing and schedule your appointment.`;

    console.log(`[estimator/quote] service=${service_id} tier=${result_tier} qty=${qty} photos=${photoCount||0}`);

    json(res, 200, {
      ok:          true,
      tier_result: result_tier,
      disqualified,
      message,
      subtotal:    0,
      total:       0,
      payload_echo: { segment, service_id, qty, photoCount },
    });
  } catch (err) {
    console.error("[estimator/quote]", err.message);
    json(res, 500, { ok: false, error: err.message });
  }
}

module.exports = { handleEstimatorConfig, handleEstimatorQuote };

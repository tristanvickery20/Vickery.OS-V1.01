// api/estimator-config.js
// GET  /api/estimator/config  — return normalized modules + services config
// POST /api/estimator/quote   — full pricing engine (Prompt 3)

const crypto = require("crypto");
const { getEstimatorConfig }             = require("../lib/estimatorModulesConfig");
const { evaluateService, computePrice, getBasePrice } = require("../lib/estimatorEngine");
const { writeLeadSnapshot }              = require("../lib/estimatorSnapshot");

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
  const lead_id      = "LE-" + crypto.randomBytes(5).toString("hex").toUpperCase();
  const created_at   = new Date().toISOString();
  let   snapshotBase = { lead_id, created_at_iso: created_at };

  try {
    const body = await readBody(req);
    const { segment, service_id, service_name, qty = 1,
            answersByModule = {}, photoCount = 0,
            customer_name = "", customer_phone = "", customer_email = "" } = body;

    if (!segment || !service_id) {
      await writeLeadSnapshot({ ...snapshotBase, service_id, segment, status: "error",
        snapshot_json: JSON.stringify({ error: "Missing segment or service_id", body }) });
      return json(res, 400, { ok: false, error: "segment and service_id are required" });
    }

    // Load config
    const config  = await getEstimatorConfig();
    const service = (config.services || []).find(s => s.service_id === service_id);
    if (!service) {
      await writeLeadSnapshot({ ...snapshotBase, service_id, segment, status: "error",
        snapshot_json: JSON.stringify({ error: "Unknown service_id" }) });
      return json(res, 400, { ok: false, error: `Unknown service: ${service_id}` });
    }

    // Evaluate risk + disqualify
    const eval_ = evaluateService(config.modulesById, service, answersByModule, photoCount);
    const { tier_result, reasons, risk_multiplier, contingency_pct, required_photos_missing } = eval_;

    // Base price from existing calculator (or placeholder)
    let basePrice = 0, priceSource = "placeholder";
    if (tier_result !== "needs_site_visit") {
      const bp = await getBasePrice(service_id, service_name || service.service_name, qty);
      basePrice   = bp.final_price;
      priceSource = bp.source;
    }

    // Apply risk + contingency
    const { subtotal, total } = computePrice(basePrice, risk_multiplier, contingency_pct);

    const canPrice = tier_result !== "needs_site_visit" && tier_result !== "needs_photos";
    const status   = tier_result === "needs_site_visit" ? "needs_site_visit"
                   : tier_result === "needs_photos"     ? "needs_photos"
                   : priceSource === "placeholder"      ? "quoted_placeholder"
                   : "quoted";

    const snapshot = {
      config_version: config.updatedAt,
      service, qty, segment,
      answersByModule, photoCount,
      risk_multiplier, contingency_pct,
      basePrice, priceSource,
      subtotal: canPrice ? subtotal : 0,
      total:    canPrice ? total    : 0,
      tier_result, reasons,
    };

    // Write snapshot row — always, even failures
    await writeLeadSnapshot({
      ...snapshotBase,
      customer_name, customer_phone, customer_email,
      segment,
      service_id,
      service_name: service.service_name,
      tier_result,
      risk_multiplier,
      contingency_pct,
      subtotal: canPrice ? subtotal : 0,
      total:    canPrice ? total    : 0,
      answers_json:   JSON.stringify(answersByModule),
      snapshot_json:  JSON.stringify(snapshot),
      photo_urls_json: "[]",
      status,
    });

    const message = tier_result === "needs_site_visit"
      ? "Based on your answers, an on-site assessment is required before we can provide a firm quote."
      : tier_result === "needs_photos"
      ? "Photos are required for this service to proceed with an instant quote."
      : priceSource === "placeholder"
      ? `Thank you! We'll contact you to confirm pricing for your ${service.service_name}.`
      : `Your estimate is ready! Pricing reflects job complexity and site conditions.`;

    console.log(`[estimator/quote] lead=${lead_id} service=${service_id} tier=${tier_result} total=${total} src=${priceSource}`);

    json(res, 200, {
      ok: true,
      lead_id,
      tier_result,
      reasons,
      risk_multiplier,
      contingency_pct,
      subtotal: canPrice ? subtotal : 0,
      total:    canPrice ? total    : 0,
      price_source: priceSource,
      status,
      message,
    });

  } catch (err) {
    console.error("[estimator/quote]", err.message);
    await writeLeadSnapshot({ ...snapshotBase, status: "error",
      snapshot_json: JSON.stringify({ error: err.message }) }).catch(() => {});
    json(res, 500, { ok: false, error: err.message });
  }
}

module.exports = { handleEstimatorConfig, handleEstimatorQuote };

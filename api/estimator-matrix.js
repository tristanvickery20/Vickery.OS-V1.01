// api/estimator-matrix.js
// GET /api/admin/estimator-matrix
// Admin-only endpoint. Runs a matrix of pre-defined scenarios through the live
// pricing engine for each priceable service and returns all results.
// Does NOT write lead snapshots — this is read-only verification tooling.

const { getEstimatorConfig }                     = require("../lib/estimatorModulesConfig");
const { evaluateService, computePrice, getBasePrice } = require("../lib/estimatorEngine");
const { isAuthed }                               = require("../lib/auth");

const NO_CACHE = { "Content-Type": "application/json", "Cache-Control": "no-store, max-age=0" };

function json(res, status, payload) {
  res.writeHead(status, NO_CACHE);
  res.end(JSON.stringify(payload));
}

// ── Scenario definitions ──────────────────────────────────────────────────────
// Each entry: { label, tag, answers }
// tag: "base" | "middle" | "worst"
// answers: module_id → option_value (only the modules that affect pricing)

const SCENARIO_PROFILES = {

  CEILING_FAN_INSTALL: [
    {
      label: "Base — fan box exists, standard ceiling, modern home",
      tag: "base",
      answers: { FAN_EXISTING_WIRING: "yes_fan_box", CEILING_HEIGHT: "standard", FIXTURE_WEIGHT: "standard", HOME_AGE: "2005plus", UNCERTAINTY_BUFFER: "simple" },
    },
    {
      label: "Light box upgrade, standard ceiling, 1970s home",
      tag: "middle",
      answers: { FAN_EXISTING_WIRING: "yes_light_box", CEILING_HEIGHT: "standard", FIXTURE_WEIGHT: "standard", HOME_AGE: "1970_1990", UNCERTAINTY_BUFFER: "simple" },
    },
    {
      label: "Fan box exists, vaulted ceiling, 1990s home",
      tag: "middle",
      answers: { FAN_EXISTING_WIRING: "yes_fan_box", CEILING_HEIGHT: "vaulted", FIXTURE_WEIGHT: "heavy", HOME_AGE: "1990_2005", UNCERTAINTY_BUFFER: "simple" },
    },
    {
      label: "Worst — new location, vaulted ceiling, pre-1970 home",
      tag: "worst",
      answers: { FAN_EXISTING_WIRING: "no_box", CEILING_HEIGHT: "vaulted", FIXTURE_WEIGHT: "heavy", HOME_AGE: "1950_1970", UNCERTAINTY_BUFFER: "moderate" },
    },
  ],

  LIGHT_FIXTURE_INSTALL: [
    {
      label: "Base — existing box, device swap, standard ceiling, modern home",
      tag: "base",
      answers: { CIRCUIT_SCOPE: "device_swap", EXISTING_BOX: "yes", CEILING_HEIGHT: "standard", FIXTURE_WEIGHT: "standard", HOME_AGE: "2005plus", UNCERTAINTY_BUFFER: "simple" },
    },
    {
      label: "Extend existing, tall ceiling, 1990s home",
      tag: "middle",
      answers: { CIRCUIT_SCOPE: "extend_existing", EXISTING_BOX: "no", CEILING_HEIGHT: "tall", FIXTURE_WEIGHT: "standard", HOME_AGE: "1990_2005", UNCERTAINTY_BUFFER: "simple" },
    },
    {
      label: "Worst — new circuit, no box, vaulted ceiling, pre-1970 home",
      tag: "worst",
      answers: { CIRCUIT_SCOPE: "new_circuit", EXISTING_BOX: "no", CEILING_HEIGHT: "vaulted", FIXTURE_WEIGHT: "heavy", HOME_AGE: "1950_1970", UNCERTAINTY_BUFFER: "moderate" },
    },
  ],

  RECESSED_LIGHTING: [
    {
      label: "Base — attic access, standard ceiling, extend existing, modern home",
      tag: "base",
      answers: { ATTIC_ACCESS: "yes", CEILING_HEIGHT: "standard", CIRCUIT_SCOPE: "extend_existing", HOME_AGE: "2005plus", UNCERTAINTY_BUFFER: "simple" },
    },
    {
      label: "Limited attic, standard ceiling, extend existing, 1980s home",
      tag: "middle",
      answers: { ATTIC_ACCESS: "partial", CEILING_HEIGHT: "standard", CIRCUIT_SCOPE: "extend_existing", HOME_AGE: "1970_1990", UNCERTAINTY_BUFFER: "simple" },
    },
    {
      label: "No attic, standard ceiling, new circuit from panel, 1990s home",
      tag: "middle",
      answers: { ATTIC_ACCESS: "no", CEILING_HEIGHT: "standard", CIRCUIT_SCOPE: "new_circuit", HOME_AGE: "1990_2005", UNCERTAINTY_BUFFER: "moderate" },
    },
    {
      label: "Worst — no attic, tall ceiling, new circuit, pre-1970 home",
      tag: "worst",
      answers: { ATTIC_ACCESS: "no", CEILING_HEIGHT: "tall", CIRCUIT_SCOPE: "new_circuit", HOME_AGE: "1950_1970", UNCERTAINTY_BUFFER: "complex" },
    },
  ],

  DIMMER_SWITCH: [
    {
      label: "Base — device swap, drywall, modern home",
      tag: "base",
      answers: { CIRCUIT_SCOPE: "device_swap", WALL_TYPE: "drywall", HOME_AGE: "2005plus", UNCERTAINTY_BUFFER: "simple" },
    },
    {
      label: "Extend existing, plaster walls, 1980s home",
      tag: "middle",
      answers: { CIRCUIT_SCOPE: "extend_existing", WALL_TYPE: "plaster", HOME_AGE: "1970_1990", UNCERTAINTY_BUFFER: "simple" },
    },
    {
      label: "Worst — new circuit, plaster walls, pre-1970 home",
      tag: "worst",
      answers: { CIRCUIT_SCOPE: "new_circuit", WALL_TYPE: "plaster", HOME_AGE: "1950_1970", UNCERTAINTY_BUFFER: "moderate" },
    },
  ],

  OUTLET_INSTALL: [
    {
      label: "Base — device swap, drywall, modern home, near panel",
      tag: "base",
      answers: { CIRCUIT_SCOPE: "device_swap", WALL_TYPE: "drywall", CRAWLSPACE_ACCESS: "yes", DISTANCE_FROM_PANEL: "under15", ROOM_TYPE: "bedroom", HOME_AGE: "2005plus", UNCERTAINTY_BUFFER: "simple" },
    },
    {
      label: "Extend existing, drywall, 1990s home, 15–40 ft",
      tag: "middle",
      answers: { CIRCUIT_SCOPE: "extend_existing", WALL_TYPE: "drywall", CRAWLSPACE_ACCESS: "yes", DISTANCE_FROM_PANEL: "15to40", ROOM_TYPE: "living_family", HOME_AGE: "1990_2005", UNCERTAINTY_BUFFER: "simple" },
    },
    {
      label: "New circuit, plaster, 1970s home, 40–75 ft",
      tag: "middle",
      answers: { CIRCUIT_SCOPE: "new_circuit", WALL_TYPE: "plaster", CRAWLSPACE_ACCESS: "no", DISTANCE_FROM_PANEL: "40to75", ROOM_TYPE: "kitchen", HOME_AGE: "1970_1990", UNCERTAINTY_BUFFER: "moderate" },
    },
    {
      label: "Worst — new circuit, plaster, slab, far panel, pre-1970 home",
      tag: "worst",
      answers: { CIRCUIT_SCOPE: "new_circuit", WALL_TYPE: "plaster", CRAWLSPACE_ACCESS: "no", DISTANCE_FROM_PANEL: "over75", ROOM_TYPE: "kitchen", HOME_AGE: "1950_1970", UNCERTAINTY_BUFFER: "complex" },
    },
  ],

  GFCI_OUTLET: [
    {
      label: "Base — device swap, drywall, modern home",
      tag: "base",
      answers: { CIRCUIT_SCOPE: "device_swap", WALL_TYPE: "drywall", ROOM_TYPE: "bathroom", HOME_AGE: "2005plus", UNCERTAINTY_BUFFER: "simple" },
    },
    {
      label: "Extend existing, plaster, 1980s home",
      tag: "middle",
      answers: { CIRCUIT_SCOPE: "extend_existing", WALL_TYPE: "plaster", ROOM_TYPE: "kitchen", HOME_AGE: "1970_1990", UNCERTAINTY_BUFFER: "simple" },
    },
    {
      label: "Worst — new circuit, plaster, pre-1970 home",
      tag: "worst",
      answers: { CIRCUIT_SCOPE: "new_circuit", WALL_TYPE: "plaster", ROOM_TYPE: "bathroom", HOME_AGE: "1950_1970", UNCERTAINTY_BUFFER: "moderate" },
    },
  ],

  SURGE_PROTECTOR: [
    {
      label: "Base — open panel slots, modern home",
      tag: "base",
      answers: { PANEL_SPACE: "yes", HOME_AGE: "2005plus", UNCERTAINTY_BUFFER: "simple" },
    },
    {
      label: "Tandem slots available, 1980s home",
      tag: "middle",
      answers: { PANEL_SPACE: "tandem", HOME_AGE: "1970_1990", UNCERTAINTY_BUFFER: "simple" },
    },
    {
      label: "Worst — unknown panel space, pre-1970 home",
      tag: "worst",
      answers: { PANEL_SPACE: "unknown", HOME_AGE: "1950_1970", UNCERTAINTY_BUFFER: "moderate" },
    },
  ],

  OUTDOOR_LIGHTING: [
    {
      label: "Base — wood soffit, existing nearby circuit, modern home",
      tag: "base",
      answers: { OUTDOOR_MOUNTING: "wood_soffit", OUTDOOR_CIRCUIT: "yes_nearby", HOME_AGE: "2005plus", UNCERTAINTY_BUFFER: "simple" },
    },
    {
      label: "Vinyl soffit, interior circuit pass-through, 1990s home",
      tag: "middle",
      answers: { OUTDOOR_MOUNTING: "vinyl_soffit", OUTDOOR_CIRCUIT: "yes_interior", HOME_AGE: "1990_2005", UNCERTAINTY_BUFFER: "simple" },
    },
    {
      label: "Worst — stucco, new circuit from panel, pre-1970 home",
      tag: "worst",
      answers: { OUTDOOR_MOUNTING: "stucco", OUTDOOR_CIRCUIT: "no_new_run", HOME_AGE: "1950_1970", UNCERTAINTY_BUFFER: "moderate" },
    },
  ],

  MOTION_SECURITY_LIGHT: [
    {
      label: "Base — wood soffit, existing nearby circuit, modern home",
      tag: "base",
      answers: { OUTDOOR_MOUNTING: "wood_soffit", OUTDOOR_CIRCUIT: "yes_nearby", HOME_AGE: "2005plus", UNCERTAINTY_BUFFER: "simple" },
    },
    {
      label: "Vinyl soffit, interior pass-through, 1990s home",
      tag: "middle",
      answers: { OUTDOOR_MOUNTING: "vinyl_soffit", OUTDOOR_CIRCUIT: "yes_interior", HOME_AGE: "1990_2005", UNCERTAINTY_BUFFER: "simple" },
    },
    {
      label: "Worst — stucco, new circuit from panel, pre-1970 home",
      tag: "worst",
      answers: { OUTDOOR_MOUNTING: "stucco", OUTDOOR_CIRCUIT: "no_new_run", HOME_AGE: "1950_1970", UNCERTAINTY_BUFFER: "moderate" },
    },
  ],

  SMOKE_CO_DETECTOR: [
    {
      label: "Base — hardwired swap, standard ceiling, modern home",
      tag: "base",
      answers: { SMOKE_TYPE: "hardwired_swap", CEILING_HEIGHT: "standard", HOME_AGE: "2005plus", UNCERTAINTY_BUFFER: "simple" },
    },
    {
      label: "New location, tall ceiling, 1990s home",
      tag: "middle",
      answers: { SMOKE_TYPE: "new_location", CEILING_HEIGHT: "tall", HOME_AGE: "1990_2005", UNCERTAINTY_BUFFER: "simple" },
    },
    {
      label: "Worst — new location, vaulted ceiling, pre-1970 home",
      tag: "worst",
      answers: { SMOKE_TYPE: "new_location", CEILING_HEIGHT: "vaulted", HOME_AGE: "1950_1970", UNCERTAINTY_BUFFER: "moderate" },
    },
  ],
};

// ── Handler ───────────────────────────────────────────────────────────────────

async function handleEstimatorMatrix(req, res) {
  if (!isAuthed(req)) return json(res, 401, { ok: false, error: "Unauthorized" });

  try {
    const raw = await getEstimatorConfig();
    const modulesById = raw.modulesById || {};

    const serviceMap = {};
    for (const s of (raw.services || [])) {
      serviceMap[s.service_id] = s;
    }

    const results = [];

    for (const [serviceId, scenarios] of Object.entries(SCENARIO_PROFILES)) {
      const service = serviceMap[serviceId];
      if (!service) {
        results.push({ service_id: serviceId, error: "Service not found in live config" });
        continue;
      }

      for (const scenario of scenarios) {
        const eval_ = evaluateService(modulesById, service, scenario.answers, 0);
        const { tier_result, contingency_pct } = eval_;

        let price = 0;
        let priceSource = "n/a";
        let debugBreakdown = null;
        let drivers = [];

        if (tier_result !== "needs_site_visit") {
          const bp = await getBasePrice(
            serviceId, service.service_name, 1,
            scenario.answers, modulesById, service.modules_csv
          );
          price         = bp.final_price || 0;
          priceSource   = bp.source || "unknown";
          debugBreakdown = bp.debug_breakdown || null;
          drivers        = bp.debug_drivers || [];
        }

        const { total } = computePrice(price, 1.0, contingency_pct);

        results.push({
          service_id:    serviceId,
          service_name:  service.service_name,
          segment:       service.segment,
          tier:          service.tier,
          scenario_label: scenario.label,
          scenario_tag:  scenario.tag,
          answers:       scenario.answers,
          tier_result,
          contingency_pct,
          base_price:    price,
          total_price:   tier_result === "needs_site_visit" ? 0 : total,
          price_source:  priceSource,
          drivers,
          labor_cost:    debugBreakdown?.labor_cost        ?? null,
          material_cost: debugBreakdown?.material_allowance ?? null,
          disqualified:  tier_result === "needs_site_visit",
        });
      }
    }

    const generated_at = new Date().toISOString();
    json(res, 200, { ok: true, generated_at, count: results.length, results });

  } catch (err) {
    console.error("[estimator-matrix]", err.message);
    json(res, 500, { ok: false, error: err.message });
  }
}

module.exports = { handleEstimatorMatrix };

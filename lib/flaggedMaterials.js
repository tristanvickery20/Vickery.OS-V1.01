// lib/flaggedMaterials.js
// Materials excluded from instant pricing by the quote engine.
// Two categories:
//   outlier    — suspiciously high price; needs review before enabling
//   customer-supplied — customer brings their own; installer charges labor only
//
// To clear a material: move its ID from the active Set to the archive comment below.

const FLAGGED_MATERIAL_IDS = new Set([
  // ── Outliers (launch-audit 2026-03-18) ──────────────────────────────────────
  // Price in sheet is unusually high relative to typical scope; re-evaluate before enabling.
  "MAT-136",  // $48  — outlier from spec; review before enabling
  "MAT-175",  // $95  — outlier from spec; review before enabling
  "MAT-192",  // $185 — outlier from spec; review before enabling
  "MAT-202",  // $55  — outlier from spec; review before enabling

  // ── Customer-supplied fixtures & devices ─────────────────────────────────────
  // These items have a reference cost in the Materials tab for record-keeping,
  // but the engine prices them at $0 because the customer selects and supplies
  // their own product. The electrician charges labor only on these assemblies.
  "LGT-007",  // $85  — chandelier/pendant: customer chooses their own fixture
  "LGT-013",  // $35  — under-cabinet LED strip: customer often supplies
  "LGT-018",  // $18  — LED retrofit lamp kit: customer supplies bulbs
  "LGT-021",  // $4.50 — LED A19/BR30 retrofit bulb: customer supplies
  "LGT-027",  // $6.50 — LED T8 tube lamp: customer supplies
  "LGT-036",  // $150 — ceiling fan/light combo: customer picks fan model
  "CTL-001",  // $45  — smart sensor/module: customer picks their ecosystem device
  "CTL-002",  // $80  — smart bridge/hub: customer picks their hub (Lutron, SmartThings, etc.)
  "DEV-014",  // $35  — smart switch/outlet device: customer picks brand/model
]);

// CLEARED (safe to price at actuals — remove from above, add ref here):
// (none yet)

const CUSTOMER_SUPPLIED_IDS = new Set([
  "LGT-007", "LGT-013", "LGT-018", "LGT-021", "LGT-027", "LGT-036",
  "CTL-001", "CTL-002", "DEV-014",
]);

/**
 * isFlagged(matId) — returns true if this material should be excluded from instant pricing.
 */
function isFlagged(matId) {
  return FLAGGED_MATERIAL_IDS.has(matId);
}

/**
 * isCustomerSupplied(matId) — returns true if the item is intentionally $0 because
 * the customer brings their own product.
 */
function isCustomerSupplied(matId) {
  return CUSTOMER_SUPPLIED_IDS.has(matId);
}

/**
 * getFlaggedReport() — returns array of { id, reason } for logging / audit trace.
 */
function getFlaggedReport() {
  return [...FLAGGED_MATERIAL_IDS].map(id => ({
    id,
    reason: CUSTOMER_SUPPLIED_IDS.has(id)
      ? "customer-supplied — installer charges labor only"
      : "launch-audit outlier — excluded from instant pricing until reviewed",
  }));
}

module.exports = { isFlagged, isCustomerSupplied, getFlaggedReport, FLAGGED_MATERIAL_IDS, CUSTOMER_SUPPLIED_IDS };

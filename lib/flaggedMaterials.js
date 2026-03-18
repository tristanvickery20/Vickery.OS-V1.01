// lib/flaggedMaterials.js
// Materials flagged as suspicious outliers — excluded from instant pricing until reviewed.
// To clear a material: move its ID from FLAGGED_MATERIAL_IDS to the archive comment below.
//
// Flagging criteria from launch audit 2026-03-18:
//   - Known outlier from spec (MAT-136 $48, MAT-175 $95, MAT-192 $185, MAT-202 $55)
//   - Assemblies affected: A015, A019, A020, A021, A026, A029, A044, A045, A047

const FLAGGED_MATERIAL_IDS = new Set([
  "MAT-136",  // $48  — launch-audit outlier; review before enabling
  "MAT-175",  // $95  — launch-audit outlier; review before enabling
  "MAT-192",  // $185 — launch-audit outlier; review before enabling
  "MAT-202",  // $55  — launch-audit outlier; review before enabling
]);

// CLEARED (safe to price at actuals — remove from above and add here):
// (none yet)

/**
 * isFlagged(matId) — returns true if this material should be excluded from instant pricing.
 */
function isFlagged(matId) {
  return FLAGGED_MATERIAL_IDS.has(matId);
}

/**
 * getFlaggedReport() — returns array of { id, reason } for logging / audit trace.
 */
function getFlaggedReport() {
  return [...FLAGGED_MATERIAL_IDS].map(id => ({
    id,
    reason: "launch-audit outlier — excluded from instant pricing until reviewed",
  }));
}

module.exports = { isFlagged, getFlaggedReport, FLAGGED_MATERIAL_IDS };

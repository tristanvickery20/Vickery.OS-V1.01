// lib/materialSanityCheck.js — Bug 8
// Flags suspicious material costs: $0, known outliers, and "Needs Mapping" entries.
// Runnable standalone: node lib/materialSanityCheck.js
// Or call checkMaterials() programmatically.

const KNOWN_OUTLIERS = {
  "MAT-136": 48,
  "MAT-162": 38,
  "MAT-169": 8.5,
  "MAT-175": 95,
  "MAT-192": 185,
  "MAT-202": 55,
};

const ZERO_COST_THRESHOLD  = 0;
const OUTLIER_RATIO_HIGH   = 10;  // flag if cost > 10× category median
const OUTLIER_RATIO_LOW    = 0.1; // flag if cost < 10% of category median

/**
 * checkMaterials(materialsMap, assemblyItemsByAssembly)
 * Returns { zeroCost, outliers, needsMapping } arrays.
 *
 * @param {object} materialsMap              — { mat_id: { base_cost, category, ... } }
 * @param {object} assemblyItemsByAssembly   — { assembly_id: [item, ...] }
 */
function checkMaterials(materialsMap, assemblyItemsByAssembly) {
  const zeroCost     = [];
  const outlierFlags = [];
  const needsMapping = [];

  // Build set of material IDs actually referenced by at least one assembly
  const referencedIds = new Set();
  for (const items of Object.values(assemblyItemsByAssembly || {})) {
    for (const item of items) {
      if (String(item.item_type || "").toLowerCase() === "material" && item.item_ref_id) {
        referencedIds.add(item.item_ref_id);
      }
    }
  }

  // Group base_costs by category for median computation
  const byCategory = {};
  for (const [id, mat] of Object.entries(materialsMap || {})) {
    const cost = Number(mat.base_cost) || 0;
    const cat  = mat.category || "uncategorized";
    if (!byCategory[cat]) byCategory[cat] = [];
    byCategory[cat].push(cost);
  }
  const categoryMedians = {};
  for (const [cat, costs] of Object.entries(byCategory)) {
    const sorted = [...costs].sort((a, b) => a - b);
    const mid    = Math.floor(sorted.length / 2);
    categoryMedians[cat] = sorted.length % 2 === 0
      ? (sorted[mid - 1] + sorted[mid]) / 2
      : sorted[mid];
  }

  for (const [id, mat] of Object.entries(materialsMap || {})) {
    const cost      = Number(mat.base_cost) || 0;
    const cat       = mat.category || "uncategorized";
    const isRef     = referencedIds.has(id);
    const name      = mat.name || mat.material_name || id;
    const median    = categoryMedians[cat] || 0;

    // "Needs Mapping" / placeholder names
    if (/needs.?mapping|placeholder|tbd|unknown/i.test(name)) {
      needsMapping.push({ id, name, base_cost: cost, category: cat, referenced: isRef });
    }

    // $0 cost on referenced assembly materials
    if (cost <= ZERO_COST_THRESHOLD && isRef) {
      zeroCost.push({ id, name, base_cost: cost, category: cat });
    }

    // Known outliers from the spec
    if (KNOWN_OUTLIERS[id] !== undefined) {
      const expected = KNOWN_OUTLIERS[id];
      if (Math.abs(cost - expected) > 1) {
        outlierFlags.push({ id, name, base_cost: cost, expected_approx: expected, category: cat, note: "known outlier from spec" });
      }
    }

    // Ratio outlier vs category median (only for referenced materials)
    if (isRef && median > 0) {
      if (cost > median * OUTLIER_RATIO_HIGH) {
        outlierFlags.push({ id, name, base_cost: cost, category_median: median, ratio: (cost/median).toFixed(1)+"×", category: cat, note: "cost >> category median" });
      } else if (cost > 0 && cost < median * OUTLIER_RATIO_LOW) {
        outlierFlags.push({ id, name, base_cost: cost, category_median: median, ratio: (cost/median).toFixed(2)+"×", category: cat, note: "cost << category median" });
      }
    }
  }

  return { zeroCost, outliers: outlierFlags, needsMapping };
}

/**
 * printReport — console output of the sanity check results.
 */
function printReport({ zeroCost, outliers, needsMapping }) {
  const sep = "─".repeat(60);
  console.log(`\n${sep}`);
  console.log(`  MATERIAL SANITY CHECK REPORT`);
  console.log(`  Generated: ${new Date().toISOString()}`);
  console.log(sep);

  console.log(`\n▶ ZERO-COST MATERIALS (referenced by assemblies): ${zeroCost.length}`);
  for (const m of zeroCost) {
    console.log(`  ${m.id}  ${m.name}  [${m.category}]  base_cost=$${m.base_cost}`);
  }

  console.log(`\n▶ OUTLIER MATERIALS: ${outliers.length}`);
  for (const m of outliers) {
    const detail = m.expected_approx != null
      ? `expected≈$${m.expected_approx}`
      : `median=$${m.category_median?.toFixed(2)} ratio=${m.ratio}`;
    console.log(`  ${m.id}  ${m.name}  [${m.category}]  base_cost=$${m.base_cost}  (${detail})  — ${m.note}`);
  }

  console.log(`\n▶ NEEDS-MAPPING MATERIALS: ${needsMapping.length}`);
  for (const m of needsMapping) {
    console.log(`  ${m.id}  ${m.name}  [${m.category}]  base_cost=$${m.base_cost}  referenced=${m.referenced}`);
  }

  console.log(`\n${sep}\n`);
}

// ── Standalone runner ─────────────────────────────────────────────────────────
if (require.main === module) {
  (async () => {
    try {
      const { getActiveConfig } = require("./estimatorV2Config");
      const config = await getActiveConfig();
      const { materialsMap, assemblyItemsByAssembly } = config._v2;
      const results = checkMaterials(materialsMap, assemblyItemsByAssembly);
      printReport(results);
      console.log(`Summary: ${results.zeroCost.length} zero-cost | ${results.outliers.length} outliers | ${results.needsMapping.length} needs-mapping`);
    } catch (err) {
      console.error("[materialSanityCheck] Error:", err.message);
      process.exit(1);
    }
  })();
}

module.exports = { checkMaterials, printReport };

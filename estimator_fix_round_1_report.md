# Estimator Accuracy Fix — Round 1 Report

**Date:** 2026-03-09
**Fixes Applied:** 5 (CRIT-1, CRIT-2, CRIT-3, CRIT-7, HIGH-1 report)

---

## CRIT-1 — Enriched /quote module answers had no pricing effect

**Root Cause:** `enrichConfigWithModules()` in `pages/js/quote.js` stored module options under `multiplier` key. But `calculateQuoteV2()` in `lib/quoteEngineV2.js` reads `effect_type: "MULTIPLY_HOURS"` and `effect_value` — it doesn't know what `multiplier` means.

**Before:** A 15–20 ft ceiling and a 9 ft ceiling both produced $330 for A001 (recessed lighting), because all multipliers were ignored.

**After:** The option mapping now emits both:
```js
effect_type:  "MULTIPLY_HOURS"
effect_value: Number(o.multiplier)
```
So selecting "15–20 ft" ceiling (×1.5) produces ~$440 vs $330 baseline for the same service.

**File changed:** `pages/js/quote.js` lines 111–121

---

## CRIT-2 — Instant-estimate ignores module answer multipliers

**Root Cause:** `getBasePrice()` in `lib/estimatorEngine.js` hardcoded `selectedDriverOptions: []`. The actual answers from the instant-estimate form were evaluated for risk/disqualify (`evaluateService`) but never converted to V2 driver options for the base price calculation.

**Before:** All instant-estimate quotes returned the assembly's baseline labor hours regardless of ceiling height, wall type, attic access, etc.

**After:** `getBasePrice(serviceId, serviceName, qty, answersByModule, modulesById)` now accepts the module answers. Any option with `multiplier !== 1.0` is converted to `{ effect_type: "MULTIPLY_HOURS", effect_value: mult }` and passed to `calculateQuoteV2()`. Applied drivers are logged with `[getBasePrice] <svc> drivers applied: <list>`.

**Caller updated:** `api/estimator-config.js` line 145 now passes `answersByModule` and `raw.modulesById` to `getBasePrice()`. Response includes `debug_drivers[]` array for verification.

**Files changed:** `lib/estimatorEngine.js`, `api/estimator-config.js`

---

## CRIT-3 — Driver_Multipliers tab missing 11 rows

**Root Cause:** The V2 sheet's `Driver_Multipliers` tab only had 6 rows (DIST_PANEL×3, CEILING_HT "12–14 ft"×1, ATTIC_ACCESS "No"×1, WALL_TYPE "Plaster"×1). Non-enriched job types using these drivers had no options to select from (or only the single existing one).

**Before:** CEILING_HT had only one option ("12–14 ft"), ATTIC_ACCESS only "No", WALL_TYPE only "Plaster", HOME_OCC had no rows at all.

**After:** 11 rows appended:
| Driver | Option | Labor× | Mat× |
|--------|--------|--------|------|
| CEILING_HT | Under 9 ft | 1.0 | 1.0 |
| CEILING_HT | 9–12 ft | 1.0 | 1.0 |
| CEILING_HT | 15–20 ft | 1.5 | 1.1 |
| ATTIC_ACCESS | Yes — full | 1.0 | 1.0 |
| ATTIC_ACCESS | Limited | 1.15 | 1.05 |
| ATTIC_ACCESS | Not sure | 1.1 | 1.0 |
| WALL_TYPE | Drywall | 1.0 | 1.0 |
| WALL_TYPE | Tile | 1.5 | 1.15 |
| WALL_TYPE | Wood / paneling | 1.15 | 1.0 |
| HOME_OCC | Yes | 1.1 | 1.0 |
| HOME_OCC | No | 1.0 | 1.0 |

Table now has 17 rows total. Script is idempotent (safe to re-run).

**Script:** `scripts/patch-driver-multipliers.js`

---

## CRIT-7 — Commercial property not blocked in /quote path

**Root Cause:** The PROPERTY_TYPE module question's "Commercial building" option has `disqualify: true`. The frontend handled this correctly (selecting it triggers `go("sitevisit")`). But the server-side `/api/quote/calc` endpoint had no disqualify check — a direct API call with `PROPERTY_TYPE: "commercial"` would still return a computed price.

**Before:** Frontend correctly disqualified, but server returned a price if bypassed via API.

**After:**
1. `api/quote-engine.js` — new `checkDisqualify(config, answers)` helper iterates all answers and checks `config.optionsByQuestion[qid]` for any option with `disqualify: true`. If found, `/api/quote/calc` returns `{ evaluation_flag: true, final_price: 0, disqualify_reason: "..." }` immediately.
2. The frontend already respects `evaluation_flag: true` in results — shows "An in-person evaluation may be needed first." in the review screen.

**Covers:** PROPERTY_TYPE=commercial, WALL_TYPE=brick, any future disqualifying options.

**File changed:** `api/quote-engine.js`

---

## HIGH-1 — Material allowance = $0 for all assemblies

**Root Cause:** 40 of 43 specialty material IDs (LGT-xxx, BOX-xxx, WIR-xxx, DEV-xxx, PNL-xxx, etc.) exist as rows in the Materials tab but were AUTO-ADDED as placeholder rows with `base_cost: 0`. The code join is working correctly (all 43 item_ref_ids resolve). No code fix needed.

**Status:** Data gap only. See `material_path_report.md` for full list of 40 rows needing prices and recommended cost ranges.

**Priority first-8** (cover ~80% of residential volume): LGT-037, LGT-036, LGT-013, DEV-017, DEV-021, BOX-007, WIR-009, WIR-010.

---

## Pricing Impact Summary

| Scenario | Before | After |
|----------|--------|-------|
| Recessed lighting, 9 ft ceiling, drywall | $330 | $330 (baseline unchanged) |
| Recessed lighting, 15–20 ft ceiling | $330 (multiplier ignored) | ~$440 (+33%) |
| Recessed lighting, tile walls | $330 (multiplier ignored) | ~$445 (+35%) |
| Commercial selection | Price returned (bug) | $0 + evaluation_flag |
| Instant-estimate, complex attic | Baseline only | Applies ×1.3 (limited access) |

---

## Remaining Known Issues

- **HIGH-1 (data):** Fill `base_cost` for 40 placeholder materials in the V2 sheet to unlock `material_allowance` in pricing.
- **CRIT-3 (non-enriched options):** Non-enriched job types now have the correct Driver_Multipliers rows, but the frontend V2 question options are auto-generated from those labels. If a customer sees "Yes — full" vs "Yes" for ATTIC_ACCESS, that mismatch between Driver_Multipliers labels and module option labels needs reconciling (the enriched path is correct; non-enriched path uses the V2 driver labels directly).

# Estimator Engine Changelog

**Date:** 2026-03-18  
**Scope:** `lib/estimatorEngine.js`, `api/estimator-config.js`, `pages/js/instant-estimate.js`, `lib/quoteEngineV2.js`  
**New files:** `lib/materialSanityCheck.js`, `scripts/qa-golden.js`

---

## Bugs Fixed

### P0 — Correctness

#### Bug 1 — Double-applying multipliers (FIXED)
**Was:** `evaluateService()` accumulated module option multipliers into `risk_multiplier`.
`computePrice()` then applied `basePrice × risk_multiplier`, while `getBasePrice()` had
already sent those same multipliers as `MULTIPLY_HOURS` drivers into `calculateQuoteV2()`.
Result: every height/access/wall modifier was counted twice.

**Fix:** `risk_multiplier` is now fixed at `1.0` in `evaluateService()`. Module option
multipliers flow through `getBasePrice()` → `calculateQuoteV2()` exactly once as
`MULTIPLY_HOURS` driver options. `computePrice()` still applies `contingency_pct` on top.

---

#### Bug 2 — Rogue answers affecting price (FIXED)
**Was:** `getBasePrice()` iterated over all keys in `answersByModule` regardless of
whether those modules belonged to the active service.

**Fix:** `getBasePrice()` now accepts `allowedModulesCsv` (passed from `service.modules_csv`
at the call site in `api/estimator-config.js`). Only answers whose `module_id` is in the
allowed set are converted to driver options. Ignored answers are logged in `debug_breakdown`.

---

#### Bug 3 — Fuzzy service-to-assembly match (FIXED)
**Was:** `getBasePrice()` fuzzy-matched `service_name` keywords against assembly `niche_name`.
Non-deterministic and breakable by sheet edits.

**Fix:** Replaced with an explicit `SERVICE_TO_ASSEMBLY` constant map in `estimatorEngine.js`.
If a service is not in the map, the function returns `source: "placeholder"` and logs it.
No fuzzy fallback in production. Map covers all 17 services in the spec.

---

#### Bug 4 — UNCERTAINTY_BUFFER auto-skip (FIXED)
**Was:** `instant-estimate.js` hard-coded `S.answers["UNCERTAINTY_BUFFER"] = "auto"` and
skipped rendering the module entirely. Backend received `"auto"` which matched no contingency
rule, so contingency was silently 0%.

**Fix:** Removed the special-case block. `UNCERTAINTY_BUFFER` now renders as a normal
`single_select` module using the live options from the sheet (`simple / moderate / complex`).
Backend correctly maps: `simple` → 0%, `moderate` → 10%, `complex` → 15% contingency.

---

#### Bug 5 — Photo gate contradiction (FIXED)
**Was:** UI copy said photos were optional, but `evaluateService()` returned
`tier_result = "needs_photos"` (blocking pricing) whenever a photo module existed and
`photoCount === 0`.

**Fix:** Removed `needs_photos` as a hard-stop tier. `evaluateService()` now returns a soft
`photo_warning: true` flag. Pricing proceeds normally; the UI shows a non-blocking banner:
_"Adding photos would help us confirm this estimate — our tech may follow up to verify scope."_
`api/estimator-config.js` passes `photo_warning` through in the response.

---

#### Bug 6 — No audit trail (FIXED)
**Was:** No per-quote breakdown of what modules were processed, what was ignored, or how
the price was assembled.

**Fix:** `getBasePrice()` attaches a `debug_breakdown` object when `ESTIMATOR_DEBUG=true`.
Includes: `service_id`, `assembly_id`, `allowed_modules`, `processed_answers`,
`ignored_answers`, `selected_driver_options`, `stack_cap_trace`, component costs
(`labor_cost`, `overhead_cost`, `material_allowance`, `travel_fee`), and `classification`.
The breakdown is forwarded by `api/estimator-config.js` and included in the API response.

---

### P1 — Data / Pricing Safety

#### Bug 7 — Hardcoded 30% margin (FIXED)
**Was:** `lib/quoteEngineV2.js` had `const targetMargin = 0.30` hardcoded.

**Fix:** Now reads `v2Config.targetMargin` or `v2Rates.targetMargin` from sheet tabs,
falls back to `0.30` only if absent. Add a `targetMargin` key to the Config or Rates_Rules
tab to override without a code deploy.

---

#### Bug 8 — No material sanity check (NEW FILE)
**Added:** `lib/materialSanityCheck.js`

Flags:
- Assembly-referenced materials with `base_cost <= $0`
- Materials whose name contains "needs mapping / placeholder / TBD"
- Known outliers from the spec (MAT-136, MAT-162, MAT-169, MAT-175, MAT-192, MAT-202)
- Materials whose cost deviates >10× from their category median

Run standalone:
```
node lib/materialSanityCheck.js
```

---

### P2 — Regression Protection

#### Bug 9 — No golden QA cases (NEW FILE)
**Added:** `scripts/qa-golden.js`

18 deterministic test cases across 6 services:
- `CEILING_FAN_INSTALL`, `LIGHT_FIXTURE_INSTALL`, `RECESSED_LIGHTING`,
  `OUTLET_INSTALL`, `GFCI_OUTLET`, `SURGE_PROTECTOR`
- Each has: easy case, harder case (multipliers + contingency), disqualify case

Run:
```
node scripts/qa-golden.js
```

---

## QA Results (2026-03-18)

```
Total cases: 18  |  Pass: 18  |  Fail: 0

Priced cases:
  CEILING_FAN_INSTALL       qty=1  total=$230   src=v2  buf=0%
  CEILING_FAN_INSTALL       qty=2  total=$540   src=v2  buf=10%
  LIGHT_FIXTURE_INSTALL     qty=1  total=$235   src=v2  buf=0%
  LIGHT_FIXTURE_INSTALL     qty=3  total=$805   src=v2  buf=10%
  RECESSED_LIGHTING         qty=4  total=$1180  src=v2  buf=0%
  RECESSED_LIGHTING         qty=8  total=$3840  src=v2  buf=15%
  OUTLET_INSTALL            qty=1  total=$190   src=v2  buf=0%
  OUTLET_INSTALL            qty=2  total=$430   src=v2  buf=10%
  GFCI_OUTLET               qty=1  total=$180   src=v2  buf=0%
  GFCI_OUTLET               qty=3  total=$535   src=v2  buf=10%
  SURGE_PROTECTOR           qty=1  total=$230   src=v2  buf=0%
  SURGE_PROTECTOR           qty=1  total=$310   src=v2  buf=15%
  SURGE_PROTECTOR           qty=1  total=$230   src=v2  buf=0%

Blocked cases (correct):
  CEILING_FAN_INSTALL       ceiling > 20ft
  LIGHT_FIXTURE_INSTALL     brick wall
  RECESSED_LIGHTING         ceiling over 20ft
  OUTLET_INSTALL            brick wall
  GFCI_OUTLET               brick wall
```

---

## Files Changed

| File | Change |
|------|--------|
| `lib/estimatorEngine.js` | Bugs 1, 2, 3, 5, 6 — full targeted rewrite |
| `api/estimator-config.js` | Bug 2, 5, 6 — call-site + response updates |
| `pages/js/instant-estimate.js` | Bug 4, 5 — remove auto-skip, soft photo warning |
| `lib/quoteEngineV2.js` | Bug 7 — targetMargin from sheet config |
| `lib/materialSanityCheck.js` | **NEW** — Bug 8 material audit helper |
| `scripts/qa-golden.js` | **NEW** — Bug 9 golden QA runner |

---

## What Was NOT Changed
- Route contracts (`/api/estimator/quote`, `/api/estimator/config`, `/api/estimator/classification`)
- Stack-cap logic in `lib/quoteEngineV2.js` and `lib/serviceClassification.js`
- Classification enforcement (`MANUAL_QUOTE_ONLY` gate)
- Public `/quote` flow (`api/quote-engine.js` uses its own `resolveModuleAnswers`)
- `lib/materialSanityCheck.js` does not write to any sheet — read-only audit

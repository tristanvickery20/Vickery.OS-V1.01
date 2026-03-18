# Estimator Stabilization Report

**Date:** 2026-03-18  
**Trigger:** Emergency audit — suspected runaway pricing, double-stacking, and bad input data  

---

## Audit Findings

### Critical: UNCERTAINTY_BUFFER Double-Stack Confirmed

`UNCERTAINTY_BUFFER` has sheet options with labor multipliers (`moderate=1.1`, `complex=1.2`). These were flowing into `calculateQuoteV2()` as `MULTIPLY_HOURS` drivers **AND** being counted as `contingency_pct` (10% / 15%) by `evaluateService()`. A "complex" job had UB's 1.2× applied to labor hours, then another 15% contingency surcharge layered on top.

**Impact on 8-can complex recessed lighting:** $3,840 → $3,210 after fix (↓16%)

### Service ID Aliases in Snapshots

Bad IDs were confirmed to be possible: `RECESSED_LIGHTING_INSTALL`, `GFCI_OUTLET_INSTALL`, `CEILING_FAN`, `OUTLET`. Without normalization, the quote handler returned a 400 error instead of pricing.

### UNCERTAINTY_BUFFER Invalid Values

Frontend was sending `"auto"` in some paths (remnant of Bug 4). The API was silently treating unrecognized UB values as 0% contingency.

### Material Outliers

Four materials flagged as suspicious outliers from spec: MAT-136 ($48), MAT-175 ($95), MAT-192 ($185), MAT-202 ($55). Referenced by assemblies A015, A019-A020 (panel/subpanel), A029 (hot tub), A021/A026/A044/A045/A047. **Not in the 6 common residential assemblies** — pricing for fan/outlet/lighting/GFCI is unaffected by this. Excluded as a safety measure until reviewed.

---

## Changes Made

### New Files
| File | Purpose |
|------|---------|
| `lib/estimatorGuardrails.js` | Items 3, 4, 6 — normalization, UB coercion, sanity bands |
| `lib/flaggedMaterials.js` | Item 7 — outlier material exclusion |

### Modified Files
| File | Change |
|------|--------|
| `lib/estimatorEngine.js` | UB excluded from MULTIPLY_HOURS drivers (stops double-stack) |
| `lib/quoteEngineV2.js` | Flagged materials excluded from rawMaterialCost |
| `api/estimator-config.js` | Items 1, 3, 4, 5, 6 — see table below |

### `api/estimator-config.js` Changes (Item-by-Item)

| Item | What changed |
|------|--------------|
| Item 1 | `instant_with_safeguards` now returns `display_mode: "range"` with `estimated_low` (total×0.90) and `estimated_high` (total×1.15). No firm single number shown to customer. `tier: "instant"` services still get `display_mode: "exact"`. |
| Item 3 | `service_id` normalized via `normalizeServiceId()` before any lookup. Bad IDs repair silently and log a warning. |
| Item 4 | `coerceAnswers()` called before `evaluateService()`. Invalid UB values (including `"auto"`) → `"simple"`, logged to console. Fixes array tracked per request. |
| Item 5 | Every response includes `_audit` object: `service_id`, `normalized_service_id`, `qty`, `base_price_raw`, `labor_subtotal`, `material_subtotal`, `markup_pct`, `risk_multiplier_applied`, `contingency_pct_applied`, `driver_multipliers_used`, `invalid_answers_fixed`, `subtotal`, `final_total`, `display_mode`, `estimated_low`, `estimated_high`, `sanity_breach`, `review_flags`, `excluded_materials`, `tier_result`, `price_source`, `status`. |
| Item 6 | After computing total, `checkSanityBand()` is called. If total outside the configured band → `status: "review_required"`, `sanity_breach` string set, customer sees non-pricing message. No firm estimate shown. |

---

## Sanity Bands (Per-Service Guardrails)

| Service | Min | Max |
|---------|-----|-----|
| CEILING_FAN_INSTALL | $100 | $1,800 |
| LIGHT_FIXTURE_INSTALL | $100 | $2,200 |
| RECESSED_LIGHTING | $200 | $6,500 |
| OUTLET_INSTALL | $90 | $1,200 |
| GFCI_OUTLET | $80 | $900 |
| DIMMER_SWITCH | $80 | $950 |
| OUTDOOR_LIGHTING | $150 | $3,000 |
| MOTION_SECURITY_LIGHT | $150 | $1,500 |
| SMOKE_CO_DETECTOR | $50 | $700 |
| SURGE_PROTECTOR | $100 | $900 |

---

## Before / After Validation Results

All 6 scenarios tested. `display_mode: "range"` shown to customer.

| Scenario | BEFORE total | AFTER total | Low | High | Δ | Review required |
|----------|-------------|-------------|-----|------|---|-----------------|
| 1 recessed light, simple | $330 | **$330** | $295 | $380 | $0 | No |
| 3 recessed + attic + moderate | $1,080 | **$985** | $885 | $1,135 | **-$95** | No |
| Ceiling fan simple replacement | $230 | **$230** | $205 | $265 | $0 | No |
| Ceiling fan, no box + moderate | $330 | **$305** | $275 | $350 | **-$25** | No |
| GFCI simple replacement | $180 | **$180** | $160 | $205 | $0 | No |
| Standard outlet install | $190 | **$190** | $170 | $220 | $0 | No |

_Simple cases unchanged (UB "simple" multiplier=1.0 was already excluded from drivers)._
_Moderate and complex cases reduced where UB was creating a double-stack._

### Golden QA Suite (18 cases)

```
BEFORE UB fix (from prior session):
  RECESSED_LIGHTING qty=8 complex → $3,840
  CEILING_FAN qty=2 moderate → $540
  LIGHT_FIXTURE qty=3 moderate → $805
  GFCI qty=3 moderate → $535

AFTER UB fix:
  RECESSED_LIGHTING qty=8 complex → $3,210  (-$630, -16%)
  CEILING_FAN qty=2 moderate → $495         (-$45,   -8%)
  LIGHT_FIXTURE qty=3 moderate → $735       (-$70,   -9%)
  GFCI qty=3 moderate → $490                (-$45,   -8%)

Golden QA result: 18/18 PASS, 0 FAIL
```

---

## Flagged Materials Report

These 4 materials are excluded from instant pricing cost calculations until reviewed:

| ID | Cost | Assemblies | Status |
|----|------|-----------|--------|
| MAT-136 | $48 | A019, A026, A044, A045, A047 | Excluded |
| MAT-175 | $95 | A015 | Excluded |
| MAT-192 | $185 | A021, A047 | Excluded |
| MAT-202 | $55 | A020, A029, A044, A045 | Excluded |

Note: None of these assemblies correspond to the 6 residential services (fan/recessed/fixture/outlet/GFCI/dimmer), so residential pricing is unaffected. Panel and hot-tub work (A019, A020, A029) is MANUAL_QUOTE_ONLY and would not have been priced instantly regardless.

To clear a material: remove its ID from `FLAGGED_MATERIAL_IDS` in `lib/flaggedMaterials.js`.

---

## What Was NOT Changed

- Public `/quote` flow, `/api/quote-engine.js` — untouched
- `/crm/calculator` — untouched
- Block scheduling — untouched
- Classification system (`lib/serviceClassification.js`) — untouched
- Stack-cap logic in `lib/quoteEngineV2.js` (only material exclusion added)
- CRM pages, dashboard, invoicing — untouched

---

## Remaining Items (Not a Code Problem — Data)

- All 56 residential assembly material slots still show `$0`. Labor pricing is correct and working. Fill material costs in the sheet (LGT-037, BOX-007, WIR-009, etc.) to unlock `REVIEW→PRODUCTION_READY` classification and remove `review_flag` from affected services.

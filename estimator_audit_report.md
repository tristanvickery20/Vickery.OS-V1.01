# Vickery Electric — Estimator Accuracy Audit Report
**Generated:** 2026-03-09  
**Auditor:** Internal automated + manual code trace  
**Scope:** All estimator paths — `/quote` (V2 engine), `/instant-estimate` (Module engine), pricing logic, question-to-pricing maps, sheet config layers, disqualification gates

---

## Executive Summary

The estimator system is structurally sound but has **critical accuracy gaps** that cause real prices to be computed incorrectly for a meaningful subset of customer scenarios. Specifically:

- **The `/quote` enriched questions have zero pricing effect** — answers are collected but the V2 pricing engine ignores them for all but 2 question types.
- **The `/instant-estimate` base price ignores all driver multipliers** — `getBasePrice()` passes empty `selectedDriverOptions: []`, so DIST_PANEL, CEILING_HT, ATTIC_ACCESS, WALL_TYPE adjustments don't apply to the base.
- **Pre-1950 panel/circuit disqualification is broken** — hardcoded check uses wrong option value.
- **Ceiling height "Over 20 ft" disqualification partially broken** — the module opt.disqualify works, but the hardcoded safety check looks for "vaulted" which no option produces.
- **UNCERTAINTY_BUFFER contingency logic never fires** — the live option value is "auto", but the code checks for "complex" and "moderate".
- **Zero material costs in all 56 V2 job types** — needs verification whether AssemblyItems/Materials tables are populated.

**7 Critical | 5 High | 6 Medium | 3 Low**

---

## System Architecture Map

### Two Separate Estimator Paths

```
Customer
  ├── /quote (white-card wizard)
  │     └── POST /api/quote/calc
  │           └── lib/estimatorV2Config.js
  │                 Reads: Assemblies, AssemblyItems, Scenario_Drivers,
  │                        Driver_Multipliers, Rates_Rules, Config,
  │                        Materials, Tasks_Labor  [ESTIMATOR_V2_SHEET_ID]
  │                        + ServiceAreas           [CRM_SHEET_ID]
  │           └── lib/quoteEngineV2.js
  │                 Computes: (labor_hrs * qty * MULTIPLY_HOURS_drivers + drive_hrs)
  │                           * crew_rate + materials*(1+waste)*(1+markup)
  │                           * (1+overhead) * risk / (1-0.30)
  │
  └── /instant-estimate (dark wizard)
        └── POST /api/estimator/quote
              └── lib/estimatorModulesConfig.js
                    Reads: Estimator_Modules, Estimator_ServiceMatrix
                           [ESTIMATOR_V2_SHEET_ID]
              └── lib/estimatorEngine.js (evaluateService + getBasePrice)
                    evaluateService: multiplies opt.multipliers from module options
                                     + hardcoded disqualify checks
                    getBasePrice: calls calculateQuoteV2() with selectedDriverOptions:[]
                    computePrice: applies risk_multiplier * (1+contingency)
```

### Pricing Formula (V2 path — `/quote`)
```
labor_hours = assembly.blended_labor_hours * qty
for each selectedDriverOption: if MULTIPLY_HOURS → labor_hours *= factor
drive_hours = from assembly or zone default (0.25)
total_hours = labor_hours + drive_hours
labor_cost = total_hours * (JW_count * JW_burden + AP_count * AP_burden)
material_sell = Σ(qty_per_unit * qty * base_cost) * (1 + waste%) * (1 + markup%)
overhead = (labor_cost + material_sell) * overhead_rate
risk_add = (labor_cost + material_sell) * (risk_mult - 1)
base_fee = assembly.base_fee
true_cost = labor_cost + material_sell + overhead + risk_add + base_fee
sell_price = true_cost / (1 - 0.30)   ← MARGIN HARDCODED
sell_price = max(sell_price, minPrice, minTotal)
sell_price += travel_fee
final_price = round(sell_price / 5) * 5
```

### Pricing Formula (Module path — `/instant-estimate`)
```
base_price = getBasePrice(service_id)
           = calculateQuoteV2(assembly, qty, selectedDriverOptions=[], v2Data, zip=null)
           → same V2 formula but with NO driver multipliers applied

risk_multiplier = product of all opt.multiplier from answered modules (capped at 2.0)
contingency_pct = 0.15 if any answer is "_unsure" OR UNCERTAINTY_BUFFER=="complex"
                = 0.10 if UNCERTAINTY_BUFFER=="moderate"
                = 0    otherwise

subtotal = round(base_price * risk_multiplier / 5) * 5
total    = round(subtotal * (1 + contingency_pct) / 5) * 5
```

---

## Hardcoded Values Inventory

| Value | Location | Can be changed from Sheet? |
|-------|----------|---------------------------|
| Zone fees: $0/$25/$50 | `lib/quoteEngine.js`, `lib/quoteEngineV2.js` ZONE_FEES | No — hardcoded |
| V2 target margin: 30% | `lib/quoteEngineV2.js` line 106 | No — hardcoded |
| Default travel fee: $25 (unknown ZIP) | Both engines | No — hardcoded |
| Risk defaults: Low=1.0, Med=1.10, High=1.25 | `lib/quoteEngineV2.js` getRiskMultiplier() | Yes — via Rates_Rules |
| Rounding: nearest $5 | Both engines | No — hardcoded |
| Contingency if "complex": 15% | `lib/estimatorEngine.js` | No — hardcoded |
| Contingency if "moderate": 10% | `lib/estimatorEngine.js` | No — hardcoded |
| Drive time fallback: 0.25 hrs | `lib/estimatorV2Config.js` | No — hardcoded |
| "vaulted" ceiling check | `lib/estimatorEngine.js` line 41 | No — hardcoded dead code |
| "pre1960" home age check | `lib/estimatorEngine.js` line 48 | No — hardcoded, wrong value |
| "brick" wall check | `lib/estimatorEngine.js` line 36 | No — hardcoded (matches correctly) |

---

## V2 Question / Driver System State (`/quote` path)

**Drivers in Scenario_Drivers sheet:** 5 (DIST_PANEL, CEILING_HT, ATTIC_ACCESS, WALL_TYPE, HOME_OCC)  
**All 56 job types get:** the exact same 5 questions regardless of service type  
**Driver_Multipliers populated:** 4 drivers have options; HOME_OCC has none

| Driver ID | Options with Pricing Effect | Options Missing from Driver_Multipliers |
|-----------|----------------------------|----------------------------------------|
| DIST_PANEL | same_room×1.0, adjacent_room×1.1, across_house×1.25 | None |
| CEILING_HT | 12–14 ft ×1.15 | Under 9 ft, 9–12 ft, **15–20 ft**, **Over 20 ft** |
| ATTIC_ACCESS | no ×1.3 | full (yes), **limited** |
| WALL_TYPE | plaster ×1.4 | drywall, **tile ×1.5**, **wood ×1.15**, brick (should disqualify) |
| HOME_OCC | **NONE** | yes, no |

---

## Estimator Module System State (`/instant-estimate` path)

**Services:** 25 total (8 site_visit_required, 17 instant_with_safeguards)  
**Modules:** 59 total

### Modules with pricing gaps

| Module ID | Options Missing Multiplier | Impact |
|-----------|---------------------------|--------|
| PROPERTY_TYPE | single_family, townhome_duplex, apartment_condo, detached_building | No segment pricing differentiation |
| OCCUPIED | yes, no | Zero pricing impact — question asked, never used |
| CRAWLSPACE_ACCESS | yes, no, not_sure | Zero pricing impact |
| COMMERCIAL_CEILING_TYPE | open, drop, hard_lid, not_sure | Zero pricing impact |
| COMMERCIAL_WORKING_HOURS | business, not_sure | After-hours/weekend=1.25x ✓, but business/unknown=undefined |
| TROUBLESHOOTING_SYMPTOM | flicker, dead, trips, partial, other | Only burning[DIS] has effect; all others no pricing impact |
| UNCERTAINTY_BUFFER | auto | Live option value is "auto"; code checks "complex"/"moderate" — never fires |

---

## Critical Issues (Must Fix Before Relying on Pricing)

### CRIT-1: Enriched questions in `/quote` have zero pricing effect
**Severity:** Critical  
**Files:** `pages/js/quote.js` (enrichConfigWithModules), `lib/estimatorV2Config.js`, `api/quote-engine.js`  
**What happens:** `quote.js` replaces V2 Scenario_Driver questions with module-based questions via fuzzy matching. The module questions use IDs like `CEILING_HEIGHT`. The V2 pricing engine looks up answers in `config.optionsByQuestion`, which is keyed by Scenario_Driver IDs (`CEILING_HT`). These are different keys — they don't match.  
**Result:** When a customer answers enriched module questions (CEILING_HEIGHT, HOME_AGE, PANEL_LOCATION, etc.), `resolveOptions()` returns an empty array and zero pricing adjustments are applied. The quote is calculated from base hours only.  
**How to reproduce:** Select any enriched service (e.g., Ceiling Fan), answer "15–20 ft ceiling" and "No attic access". Price will be identical to "Under 9 ft" + "Full attic access".  
**Fix needed:** Either (a) add module IDs as aliases in Driver_Multipliers, or (b) map module answers to their corresponding driver IDs before submitting to `/api/quote/calc`.

---

### CRIT-2: `/instant-estimate` base price ignores all driver multipliers
**Severity:** Critical  
**File:** `lib/estimatorEngine.js` — `getBasePrice()` line 117–123  
**What happens:** `getBasePrice()` calls `calculateQuoteV2()` with `selectedDriverOptions: []`. This means DIST_PANEL, CEILING_HT, ATTIC_ACCESS, and WALL_TYPE multipliers are never applied to the base price.  
**Result:** The instant-estimate path computes a flat base price (no driver adjustments), then applies `risk_multiplier` (from module multipliers, a different scale). The V2 driver multipliers in the sheet are irrelevant to the instant estimate path.  
**Example impact:** A job "across the house from the panel" (1.25× multiplier in V2) gets the same base price as a same-room job. The risk_multiplier from modules may partially compensate (DISTANCE_FROM_PANEL module has multipliers 1.0–1.3) but these are separate systems.

---

### CRIT-3: V2 Driver_Multipliers is critically incomplete
**Severity:** Critical  
**File:** `Estimator_Modules` sheet, Driver_Multipliers tab  
**What happens:**
- `CEILING_HT` only has the "12–14 ft" option (×1.15). Options "15–20 ft" and "Over 20 ft" do not exist in Driver_Multipliers — a customer with a 15–20 ft ceiling gets NO multiplier. The Estimator_Modules config says 15–20 ft should be ×1.6.
- `ATTIC_ACCESS` only has the "no" option. "Limited / low clearance" is missing.
- `WALL_TYPE` only has "plaster." Tile (should be ×1.5) and wood (×1.15) are missing. Brick is missing (should disqualify).
- `HOME_OCC` has zero options — question always asked, never affects price.  
**Risk:** A job with 15–20 ft ceilings is potentially underpriced by 35–45% vs expected.

---

### CRIT-4: Pre-1950 home disqualification is broken (wrong option value)
**Severity:** Critical  
**File:** `lib/estimatorEngine.js` line 48  
**Code:** `if (age === "pre1960")`  
**What happens:** The HOME_AGE module's oldest option has value `"pre_1950"` (with underscore, not "pre1960"). This hardcoded check never matches any live option value.  
**Result:** A customer in a pre-1950 home doing panel upgrade, EV charger, or subpanel work is NOT disqualified and receives an instant quote. This is a safety/liability risk — knob-and-tube or aluminum wiring is not detected.  
**Also note:** The HOME_AGE module options do NOT have `disqualify: true` — they only have multipliers. The disqualify logic entirely depends on this broken hardcoded check.  
**Fix needed:** Change line 48 to `if (age === "pre_1950")`.

---

### CRIT-5: UNCERTAINTY_BUFFER contingency logic never fires
**Severity:** Critical  
**File:** `lib/estimatorEngine.js` lines 64–68  
**What happens:** The code checks `ub === "complex"` → 15% and `ub === "moderate"` → 10%. The live UNCERTAINTY_BUFFER module has only one option: `value: "auto"`. Neither "complex" nor "moderate" is a valid option the customer can select.  
**Result:** The contingency buffer is permanently stuck at 0% regardless of job complexity.  
**Also:** The `hasUnsure` flag checks for values ending in `"_unsure"`, but no live module option has value `"_unsure"` — it is a suffix pattern that never matches.  
**Fix needed:** Either restore UNCERTAINTY_BUFFER options to include "simple"/"moderate"/"complex", OR change the contingency check to match the actual option value structure.

---

### CRIT-6: Ceiling height "vaulted" disqualification hardcode is dead code
**Severity:** Critical (safety gap)  
**File:** `lib/estimatorEngine.js` line 41  
**Code:** `if (ceiling === "vaulted")`  
**What happens:** The CEILING_HEIGHT module's "Over 20 ft" option has value `"gt20"` — never `"vaulted"`. The opt.disqualify flag IS set on "gt20", so the first-loop check (`opt.disqualify`) correctly disqualifies. However, if the option data is ever changed and the disqualify flag is removed or the value changes, there is no fallback safety check.  
**Status:** Partially protected by opt.disqualify, but the hardcoded safety net is dead.  
**Fix needed:** Change line 41 to `if (ceiling === "gt20")`.

---

### CRIT-7: PROPERTY_TYPE commercial disqualification in instant-estimate works via opt.disqualify, but same module is shared with /quote
**Severity:** Critical (audit flag)  
**File:** `lib/estimatorEngine.js`, `lib/estimatorModulesConfig.js`  
**What happens:** PROPERTY_TYPE has `commercial → dis: true`. For the instant-estimate path, this correctly disqualifies via the `opt.disqualify` check. But in the `/quote` path, PROPERTY_TYPE is an enriched module question — its answers go to `resolveOptions()` which looks in V2 `optionsByQuestion`, not the module options. PROPERTY_TYPE is NOT a V2 driver, so commercial selection in `/quote` will NOT disqualify the job.  
**Risk:** A commercial customer can select "Commercial building" in the `/quote` wizard, not get disqualified, and receive an instant residential quote.

---

## High Issues

### HIGH-1: Material costs are $0 for all 56 V2 job types
**Severity:** High  
**Evidence:** All 56 V2 job types show `material_allowance: 0`. The V2 engine computes materials from `AssemblyItems` → `Materials` tables, but this requires those tabs to be populated.  
**Action needed:** Verify whether `AssemblyItems` and `Materials` tabs in the V2 sheet contain data. If empty, every quote currently prices labor only — materials are unreflected in every customer quote.

---

### HIGH-2: All 56 V2 job types get identical questions regardless of service type
**Severity:** High  
**File:** `lib/estimatorV2Config.js` line 177–179  
**Code:** `questionsByType[jt.job_type_id] = allDrivers;`  
**What happens:** Every single assembly — from Ceiling Fan to Whole-House Rewiring to Fire Alarm — is assigned the same 5 generic questions (DIST_PANEL, CEILING_HT, ATTIC_ACCESS, WALL_TYPE, HOME_OCC). There is no per-service question routing.  
**Impact:** Services like SURGE_PROTECTOR or SMOKE_CO_DETECTOR ask about ceiling height and attic access, which are irrelevant. Services like EV_CHARGER don't ask about panel capacity at all in the V2 path.

---

### HIGH-3: V2 target margin hardcoded at 30%, cannot be changed from sheet
**Severity:** High  
**File:** `lib/quoteEngineV2.js` line 106  
**Code:** `const targetMargin = 0.30;`  
**Impact:** The V1 engine correctly reads `target_margin` from the Rates sheet. The V2 engine ignores any margin value set in `Rates_Rules`. If you ever need to adjust margin, the code must be edited.

---

### HIGH-4: OCCUPIED/HOME_OCC question shown in both paths, affects price in neither
**Severity:** High  
**Details:** HOME_OCC (V2 Scenario_Drivers) has zero Driver_Multiplier options → no pricing effect. OCCUPIED (instant-estimate module) has yes/no with undefined multipliers → no pricing effect. Occupied homes require more careful, slower work and are typically 10–20% more labor-intensive.

---

### HIGH-5: Two parallel data systems for the same services can drift
**Severity:** High  
**Details:** The 17 "instant_with_safeguards" services in `Estimator_ServiceMatrix` have no guaranteed relationship to the 56 Assemblies in the V2 sheet. A service like "EV Charger" exists as both `EV_CHARGER` (module system) and `A028` (V2 system) with different base hours, questions, and pricing structures. These can diverge independently over time.

---

## Medium Issues

### MED-1: PANEL_UPGRADE lists "Upgrade main panel / service entrance" as disqualifying
**Module:** PANEL_WORK_TYPE option "Upgrade main panel / service entrance" [DIS]  
**Impact:** This IS the primary use case for PANEL_UPGRADE. Customers selecting the correct answer immediately get a site-visit response. If this is intentional, the UI should clarify. If not, this disqualify should be removed.

---

### MED-2: DIST_PANEL "same_room" has explicit MULTIPLY_HOURS=1 (no-op)
**Driver:** DIST_PANEL_same_room → MULTIPLY_HOURS × 1.0  
**Impact:** Mathematically harmless but clutters the driver table and confirms "same room" was intentionally entered. This is correct behavior. Flagged for awareness only.

---

### MED-3: PANEL_SPACE disqualification logic is split between hardcoded and module
**File:** `lib/estimatorEngine.js` lines 53–57  
**Details:** The PANEL_SPACE module option "No – panel is full" has `mult: 1.4` but no `disqualify: true`. The disqualification is only triggered by a hardcoded check for `panelSpace === "no"` — which only applies to EV_CHARGER and HOT_TUB_CIRCUIT. For other services like SUBPANEL_INSTALL, it correctly passes through. However, the 1.4× multiplier is still applied even when disqualification happens (multiplier is applied before disqualify in the loop), which is inconsistent.

---

### MED-4: FIRE_ALARM_SCOPE — all options disqualify but service is already site_visit_required
**Details:** FIRE_ALARM has tier=`site_visit_required`. Every option of FIRE_ALARM_SCOPE disqualifies. The question is asked unnecessarily — the service is already locked to site visit. This wastes a step in the wizard without adding information.

---

### MED-5: COMMERCIAL_CEILING_TYPE and COMMERCIAL_CEILING_HEIGHT show for commercial services but have no pricing impact
**Modules:** COMMERCIAL_CEILING_TYPE (all 4 options: mult=undefined), COMMERCIAL_WORKING_HOURS (2 of 4 options: mult=undefined)  
**Services affected:** REWIRE_COMMERCIAL, FIRE_ALARM, TRANSFORMER_INSTALL  
**Impact:** These are all site_visit_required services, so pricing is never computed — but the questions still collect data and should at minimum affect the disqualification logic (they don't).

---

### MED-6: No service-specific price minimums
**Details:** All 56 V2 job types share the same `min_price: $95`. Whole-House Rewiring (6.86 base hours, computed price ~$880+) will never hit the minimum. But single-item jobs like switch repair (0.48 hours, ~$64 computed) will be floored to $95. This seems intentional, but the single minimum for all services is worth revisiting as prices are more specifically calibrated.

---

## Low Issues

### LOW-1: CRAWLSPACE_ACCESS options all have undefined multipliers
**Module:** CRAWLSPACE_ACCESS (yes/no/not_sure: all mult=undefined)  
**Impact:** Asked for relevant services (outlets, circuits) but never affects pricing.

---

### LOW-2: TROUBLESHOOTING_SYMPTOM only penalizes "burning smell" (correctly)
**Details:** Flicker, dead outlet, breaker trips, partial power → no multiplier. Only burning smell → disqualify. This may be intentional (all symptom types are site visit anyway) but if ever moved to an instant tier, only burning smell would be caught.

---

### LOW-3: Cache TTL mismatch between paths
**Details:** Estimator module path (`estimatorModulesConfig.js`) caches for 5 minutes. V2 assembly path (`estimatorV2Config.js`) caches for 12 hours (configurable in Config tab via `refreshIntervalHrs`). Changes to the V2 sheet can take up to 12 hours to appear in `/quote` pricing.

---

## What Is Currently Safe vs Unsafe to Quote Instantly

### SAFE to quote instantly (with caveats)
The following services produce reasonable prices because: base hours are calibrated, the margin and overhead formulas are correct, and disqualification gates for extreme cases do function via opt.disqualify where those flags are set.

| Service | Safe? | Caveat |
|---------|-------|--------|
| OUTLET_INSTALL / GFCI_OUTLET | ✅ With caveats | Pre-1950 disqualify broken; CRIT-4 applies |
| DIMMER_SWITCH | ✅ With caveats | Ceiling height/attic questions shown but not priced |
| CEILING_FAN_INSTALL | ⚠️ Conditional | 15-20 ft ceiling underpriced; CRIT-3 applies |
| LIGHT_FIXTURE_INSTALL | ⚠️ Conditional | Same as above |
| RECESSED_LIGHTING | ⚠️ Conditional | Same + materials $0 |
| SMOKE_CO_DETECTOR | ✅ Reasonable | Flat labor job, low complexity variance |
| SURGE_PROTECTOR | ✅ Reasonable | Panel-adjacent job, lower variance |

### UNSAFE to quote instantly in current form

| Service | Reason |
|---------|--------|
| EV_CHARGER | Materials $0; pre-1950 disqualify broken; no panel capacity question in V2 path (CRIT-4, HIGH-1) |
| HOT_TUB_CIRCUIT | Same as EV; high labor variance with circuit distance |
| PANEL_UPGRADE | Materials $0; primary use case may disqualify (MED-1); pre-1950 disqualify broken |
| SUBPANEL_INSTALL | Same as above |
| OUTDOOR_LIGHTING | Exposure conditions not priced; materials $0 |
| MOTION_SECURITY_LIGHT | Height disqualify broken for 15-20 ft; materials $0 |
| COMM_LIGHTING_RETROFIT / BALLAST_REPLACE / EXIT_EMERGENCY_LIGHTS | All commercial; ceiling height/working hours have no pricing effect |
| All `site_visit_required` services | Correctly routing to site visit, but should not be surfaced to customers as instant-quotable |

---

## Exact Files Touched / Where Fixes Must Go

| Issue | File to Change |
|-------|---------------|
| CRIT-4 (pre1960 value) | `lib/estimatorEngine.js` line 48 |
| CRIT-5 (UNCERTAINTY_BUFFER values) | `scripts/upsert-estimator-data.js` MODULES_LIBRARY + `lib/estimatorEngine.js` contingency logic OR upsert new option values |
| CRIT-6 (vaulted ceiling check) | `lib/estimatorEngine.js` line 41 |
| CRIT-7 (commercial disqualify in /quote) | `pages/js/quote.js` or add PROPERTY_TYPE to V2 Scenario_Drivers |
| CRIT-1 (enriched questions have no pricing effect) | `pages/js/quote.js` enrichConfigWithModules() + submit logic, OR V2 sheet Driver_Multipliers |
| CRIT-2 (getBasePrice empty drivers) | `lib/estimatorEngine.js` getBasePrice() — pass through selectedDriverOptions |
| CRIT-3 (Driver_Multipliers incomplete) | V2 sheet: Driver_Multipliers tab |
| HIGH-1 (materials $0) | V2 sheet: AssemblyItems + Materials tabs — verify and populate |
| HIGH-2 (all JTs same questions) | V2 sheet: Scenario_Drivers — add assembly_id column to scope per service |
| HIGH-3 (margin hardcoded) | `lib/quoteEngineV2.js` line 106 — read from v2Rates |
| HIGH-4 (HOME_OCC/OCCUPIED unused) | Add options to HOME_OCC in Driver_Multipliers sheet + add multipliers to OCCUPIED module |
| MED-1 (PANEL_UPGRADE disqualify) | V2 sheet: Estimator_ServiceMatrix PANEL_UPGRADE row, PANEL_WORK_TYPE module options |

---

## Ranking Summary

| # | ID | Severity | Description |
|---|-----|----------|-------------|
| 1 | CRIT-1 | 🔴 Critical | Enriched questions in /quote have zero pricing effect |
| 2 | CRIT-2 | 🔴 Critical | Instant-estimate base price ignores driver multipliers |
| 3 | CRIT-3 | 🔴 Critical | V2 Driver_Multipliers incomplete (15–20 ft ceiling, tile, wood, limited attic missing) |
| 4 | CRIT-4 | 🔴 Critical | Pre-1950 home panel disqualify uses wrong option value ("pre1960" vs "pre_1950") |
| 5 | CRIT-5 | 🔴 Critical | UNCERTAINTY_BUFFER contingency never fires (option value "auto" ≠ "complex"/"moderate") |
| 6 | CRIT-6 | 🔴 Critical | Ceiling "vaulted" hardcoded check is dead code (value is "gt20") |
| 7 | CRIT-7 | 🔴 Critical | Commercial PROPERTY_TYPE not disqualified in /quote path |
| 8 | HIGH-1 | 🟠 High | Material costs $0 for all 56 job types — needs sheet verification |
| 9 | HIGH-2 | 🟠 High | All 56 job types share identical 5 questions, regardless of service |
| 10 | HIGH-3 | 🟠 High | V2 margin hardcoded at 30% in code, ignored in sheet |
| 11 | HIGH-4 | 🟠 High | HOME_OCC / OCCUPIED question asked in both paths, affects neither |
| 12 | HIGH-5 | 🟠 High | Two parallel module + assembly systems can drift independently |
| 13 | MED-1 | 🟡 Medium | PANEL_UPGRADE primary use case disqualifies |
| 14 | MED-2 | 🟡 Medium | DIST_PANEL same_room is a no-op multiply (harmless) |
| 15 | MED-3 | 🟡 Medium | PANEL_SPACE disqualification logic split between hardcoded + module |
| 16 | MED-4 | 🟡 Medium | FIRE_ALARM_SCOPE all-disqualify on already-disqualified service |
| 17 | MED-5 | 🟡 Medium | COMMERCIAL_CEILING_TYPE has no pricing/disqualify effect |
| 18 | MED-6 | 🟡 Medium | Single $95 minimum for all 56 services |
| 19 | LOW-1 | 🟢 Low | CRAWLSPACE_ACCESS options have no multipliers |
| 20 | LOW-2 | 🟢 Low | TROUBLESHOOTING_SYMPTOM only screens for burning smell |
| 21 | LOW-3 | 🟢 Low | Cache TTL mismatch (5 min module path vs 12 hr assembly path) |

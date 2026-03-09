# Estimator Stack Cap Report
**Generated:** 2026-03-09  
**Source:** `lib/serviceClassification.js` → `lib/quoteEngineV2.js`

## Background

QC scenario testing discovered that stacking multiple `MULTIPLY_HOURS` driver options
for certain services produced unreasonably high labor multipliers ("stack explosion").
This report documents the findings and the caps now enforced in the V2 engine.

## Stack Explosion Findings (Pre-Cap)

| Service | Scenario (Stacked Drivers) | Uncapped Multiplier | Cap Assigned |
|---|---|---|---|
| RECESSED_LIGHTING | 15-20ft ceiling + plaster + no attic + insulation | ~7.05× | **3.5×** |
| LIGHT_FIXTURE_INSTALL | 15-20ft + tile + no attic + pre-1950 home | ~6.30× | **3.75×** |
| MOTION_SECURITY_LIGHT | 15-20ft + masonry + conduit required + weatherproof | ~6.59× | **3.75×** |
| OUTDOOR_LIGHTING | 15-20ft + brick + conduit required + surge zone | ~5.45× | **3.75×** |

**Safe zone (no cap needed):** Combined multiplier ≤ 4.0×.  
**Explosion threshold:** Combined multiplier > 5.0× triggers price outliers.

## Enforcement Logic (lib/quoteEngineV2.js)

```
combinedMultiplier = product of all MULTIPLY_HOURS effect_values from selectedDriverOptions

if (stackCap != null && combinedMultiplier > stackCap):
    combinedMultiplier = stackCap   // cap applied
    capApplied = true

laborHours = laborUnit * qty * combinedMultiplier
```

Every response includes a `stack_cap_trace` object:
```json
{
  "uncapped_multiplier": 8.044,
  "applied_multiplier": 3.5,
  "cap_configured": 3.5,
  "cap_applied": true
}
```

## Services With No Cap Needed

| Service | Max Observed Multiplier | Reason |
|---|---|---|
| CEILING_FAN_INSTALL | ~2.5× | Limited driver set; attic+height capped by disqualify |
| DIMMER_SWITCH | ~2.03× | Simple drivers; only 2 stacking axes |
| OUTLET_INSTALL | ~2.34× | Single-location work; no compounding |
| GFCI_OUTLET | ~2.46× | Same as outlet |
| SURGE_PROTECTOR | ~1.5× | Minimal drivers |
| SMOKE_CO_DETECTOR | ~1.5× | Minimal drivers |

## Live Verification (post-implementation)

Scenario tested: RECESSED_LIGHTING + 15_20ft + tile + no attic + pre_1950  
- **Uncapped multiplier:** 8.044×  
- **Applied (capped) multiplier:** 3.5×  
- **Price:** $1,040 (with cap) vs. ~$2,700+ (without cap)  
- **Stack cap active:** ✓

## Files Modified

- `lib/serviceClassification.js` — `stackCap` field per service
- `lib/quoteEngineV2.js` — `stackCap` parameter in `calculateQuoteV2()`
- `api/quote-engine.js` — passes `cls.stackCap` to `computePrice()`
- `lib/estimatorEngine.js` — passes `cls.stackCap` to `calculateQuoteV2()` in `getBasePrice()`

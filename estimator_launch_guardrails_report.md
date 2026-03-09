# Estimator Launch Guardrails Report
**Generated:** 2026-03-09  
**Scope:** Production readiness enforcement for the Vickery Electric V2 estimator engine

## Overview

This report documents all production guardrails implemented based on the QC analysis
completed in the prior session. Guardrails are enforced server-side in `lib/estimatorEngine.js`,
`api/quote-engine.js`, and `lib/quoteEngineV2.js` — no client-side bypass is possible.

---

## 1. Service Classification Enforcement

**Source of truth:** `lib/serviceClassification.js`  
**Enforcement points:** `api/quote-engine.js` (POST /api/quote/calc, POST /api/quote/lock)  
and `lib/estimatorEngine.js` (getBasePrice, used by POST /api/estimator/quote)

### Classification Counts

| Classification | Count | Behavior |
|---|---|---|
| PRODUCTION_READY | 3 | Instant quote, no flags |
| READY_WITH_REVIEW_FLAG | 7 | Instant quote + material-gap disclosure in response |
| MANUAL_QUOTE_ONLY | 15 | Blocked — `manual_review_required: true`, `final_price: 0` |

### PRODUCTION_READY Services (instant, no flags)

- CEILING_FAN_INSTALL  
- SURGE_PROTECTOR  
- SMOKE_CO_DETECTOR  

### READY_WITH_REVIEW_FLAG Services (priced + disclosure)

These services have $0 material placeholders. Response always includes:
- `review_flag: true`
- `material_disclosure: "<per-service disclosure message>"`

| Service | Stack Cap | Material Note |
|---|---|---|
| LIGHT_FIXTURE_INSTALL | 3.75× | $40–$120/fixture gap |
| RECESSED_LIGHTING | 3.5× | $20–$60/light gap |
| DIMMER_SWITCH | none | ~$22–$45 gap |
| OUTLET_INSTALL | none | ~$20–$35 gap |
| GFCI_OUTLET | none | ~$25–$45 gap |
| OUTDOOR_LIGHTING | 3.75× | $50–$150 gap |
| MOTION_SECURITY_LIGHT | 3.75× | $35–$100 gap |

### MANUAL_QUOTE_ONLY Services (blocked)

**Residential — material gap blocking:**
- EV_CHARGER — missing WIR-011 + DEV-008 (~$230 sell gap)
- HOT_TUB_CIRCUIT — missing WIR-011 + PNL-007 (~$200 gap)
- PANEL_UPGRADE — missing PNL-005, PNL-006, WIR-009 (~$350+ gap)
- SUBPANEL_INSTALL — missing feeder cable WIR-012

**Commercial — all materials $0 + site visit:**
- COMM_LIGHTING_RETROFIT
- BALLAST_REPLACE
- EXIT_EMERGENCY_LIGHTS

**By design (tier = site_visit_required):**
- TROUBLESHOOT_FLICKER
- REWIRE_WHOLE_HOUSE, REWIRE_PARTIAL, REWIRE_COMMERCIAL
- FIRE_ALARM, TRANSFORMER_INSTALL
- GENERATOR_STANDBY, GENERATOR_BACKUP

---

## 2. Stack Cap Enforcement

**Source:** `lib/serviceClassification.js` (stackCap per service)  
**Engine:** `lib/quoteEngineV2.js` (calculateQuoteV2, stackCap parameter)

Four services had combined MULTIPLY_HOURS multipliers exceeding 5× in worst-case stacking:
caps prevent both pricing outliers and customer trust issues.

| Service | Pre-Cap Max | Cap Value |
|---|---|---|
| RECESSED_LIGHTING | ~7.0× | 3.5× |
| LIGHT_FIXTURE_INSTALL | ~6.3× | 3.75× |
| MOTION_SECURITY_LIGHT | ~6.6× | 3.75× |
| OUTDOOR_LIGHTING | ~5.5× | 3.75× |

Every pricing response includes `stack_cap_trace` for auditability.

---

## 3. Disqualify Logic

Server-side in `api/quote-engine.js` → `checkDisqualify()`:

1. **Module-based disqualify** (via `resolveModuleAnswers()`):
   - WALL_TYPE = "brick" → needs site visit
   - CEILING_HEIGHT = "gt20" → needs site visit
   - HOME_AGE = "pre_1950" + panel/circuit work → needs site visit
   - PANEL_SPACE = "no" + EV/circuit work → needs subpanel, site visit
   - Any option with `disqualify: true` in module config

2. **V2 driver-based disqualify** (existing option rows with `disqualify: true`)

Returns: `evaluation_flag: true`, `final_price: 0`, `disqualify_reason: <message>`

---

## 4. Response Schema

### Instant Quote (PRODUCTION_READY)
```json
{
  "ok": true, "quote_id": "QT-...", "qty": 1,
  "final_price": 230, "hours": 2.5, "pricing_version": "v2",
  "_trace": { "service_id": "CEILING_FAN_INSTALL", "classification": "PRODUCTION_READY", ... }
}
```

### Priced with Disclosure (READY_WITH_REVIEW_FLAG)
```json
{
  "ok": true, "final_price": 330,
  "review_flag": true,
  "material_disclosure": "Material allowance is $0 (placeholder data). ...",
  "_trace": { "classification": "READY_WITH_REVIEW_FLAG", "cap_applied": false, ... }
}
```

### Blocked (MANUAL_QUOTE_ONLY)
```json
{
  "ok": true, "final_price": 0,
  "manual_review_required": true,
  "classification": "MANUAL_QUOTE_ONLY",
  "disqualify_reason": "Instant pricing blocked: ...",
  "_trace": { "classification": "MANUAL_QUOTE_ONLY", "quote_allowed": false, ... }
}
```

### Disqualified
```json
{
  "ok": true, "final_price": 0, "evaluation_flag": true,
  "disqualify_reason": "\"Brick/masonry walls\" requires an on-site evaluation."
}
```

---

## 5. Admin Endpoint

`GET /api/estimator/classification` (auth-protected)

Returns live classification map from `lib/serviceClassification.js` merged with
service names from the Estimator_ServiceMatrix sheet. Includes summary counts and
assembly-to-service ID mapping.

---

## 6. Path to PRODUCTION_READY for Review-Flagged Services

Fill in material costs for these 10 assemblies to unlock 7 services → PRODUCTION_READY:

| Assembly ID | Service | Key Material |
|---|---|---|
| LGT-037 | LIGHT_FIXTURE_INSTALL | Fixture allowance |
| LGT-007 | RECESSED_LIGHTING | 4" or 6" LED wafer |
| LGT-008 | RECESSED_LIGHTING | Housing + trim |
| DEV-017 | DIMMER_SWITCH | Dimmer device |
| DEV-021 | OUTLET_INSTALL | 15A/20A duplex receptacle |
| DEV-024 | GFCI_OUTLET | GFCI device |
| BOX-007 | OUTLET_INSTALL | Single-gang box |
| BOX-006 | GFCI_OUTLET | Single-gang box |
| WIR-009 | OUTDOOR_LIGHTING / MOTION_SECURITY_LIGHT | 14/2 or 12/2 NM cable |
| WIR-010 | OUTDOOR_LIGHTING / MOTION_SECURITY_LIGHT | Weatherproof conduit |

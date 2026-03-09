# Estimator Service Classification — Production Readiness

*Generated: 2026-03-09*
*Classification: PRODUCTION_READY | READY_WITH_REVIEW_FLAG | MANUAL_QUOTE_ONLY*

---

## Classification Criteria
- **PRODUCTION_READY:** Labor pricing active, drivers move price logically, disqualify gates work, material gap is low-risk
- **READY_WITH_REVIEW_FLAG:** Quote is functional but carries a material understatement or driver coverage gap that needs disclosure
- **MANUAL_QUOTE_ONLY:** Site-visit service, assembly mismatch, stacked multiplier explosion, or material gap makes labor-only quote actively misleading

---

## Residential Instant-Quoted Services

| Service | Status | Reason |
|---------|--------|--------|
| CEILING_FAN_INSTALL | ✅ PRODUCTION_READY | Labor pricing active, drivers functional, disqualify gates working, material gap low-risk |
| LIGHT_FIXTURE_INSTALL | ⚠️ READY_WITH_REVIEW_FLAG | Labor priced correctly; material_allowance understated. Add disclosure: 'Materials quoted separately or included at actuals.' |
| RECESSED_LIGHTING | ⚠️ READY_WITH_REVIEW_FLAG | Labor priced correctly; material_allowance understated. Add disclosure: 'Materials quoted separately or included at actuals.' |
| DIMMER_SWITCH | ⚠️ READY_WITH_REVIEW_FLAG | Labor priced correctly; material_allowance understated. Add disclosure: 'Materials quoted separately or included at actuals.' |
| OUTLET_INSTALL | ⚠️ READY_WITH_REVIEW_FLAG | Labor priced correctly; material_allowance understated. Add disclosure: 'Materials quoted separately or included at actuals.' |
| GFCI_OUTLET | ⚠️ READY_WITH_REVIEW_FLAG | Labor priced correctly; material_allowance understated. Add disclosure: 'Materials quoted separately or included at actuals.' |
| EV_CHARGER | 🚫 MANUAL_QUOTE_ONLY | ~$230 in sell price from missing WIR-011+DEV-008 |
| HOT_TUB_CIRCUIT | 🚫 MANUAL_QUOTE_ONLY | ~$200 missing materials (WIR-011, PNL-007) |
| PANEL_UPGRADE | 🚫 MANUAL_QUOTE_ONLY | Panel labor partial but material gap ~$350+ at retail |
| SUBPANEL_INSTALL | 🚫 MANUAL_QUOTE_ONLY | Subpanel + feeder cable materials missing |
| SURGE_PROTECTOR | ✅ PRODUCTION_READY | Labor pricing active, drivers functional, disqualify gates working, material gap low-risk |
| OUTDOOR_LIGHTING | ⚠️ READY_WITH_REVIEW_FLAG | Labor priced correctly; material_allowance understated. Add disclosure: 'Materials quoted separately or included at actuals.' |
| MOTION_SECURITY_LIGHT | ⚠️ READY_WITH_REVIEW_FLAG | Labor priced correctly; material_allowance understated. Add disclosure: 'Materials quoted separately or included at actuals.' |
| SMOKE_CO_DETECTOR | ✅ PRODUCTION_READY | Labor pricing active, drivers functional, disqualify gates working, material gap low-risk |

## Commercial Instant-Quoted Services

| Service | Status | Reason |
|---------|--------|--------|
| COMM_LIGHTING_RETROFIT | 🚫 MANUAL_QUOTE_ONLY | All commercial services: disqualify gate should prevent residential customers from pricing. Even if reached, ALL commercial materials are $0. Commercial jobs require site-visit for scope + permitting. |
| BALLAST_REPLACE | 🚫 MANUAL_QUOTE_ONLY | All commercial services: disqualify gate should prevent residential customers from pricing. Even if reached, ALL commercial materials are $0. Commercial jobs require site-visit for scope + permitting. |
| EXIT_EMERGENCY_LIGHTS | 🚫 MANUAL_QUOTE_ONLY | All commercial services: disqualify gate should prevent residential customers from pricing. Even if reached, ALL commercial materials are $0. Commercial jobs require site-visit for scope + permitting. |

## Site-Visit Services (Always Manual)

| Service | Status | Reason |
|---------|--------|--------|
| TROUBLESHOOT_FLICKER | 🚫 MANUAL_QUOTE_ONLY | By design — tier=site_visit_required |
| REWIRE_WHOLE_HOUSE | 🚫 MANUAL_QUOTE_ONLY | By design — tier=site_visit_required |
| REWIRE_PARTIAL | 🚫 MANUAL_QUOTE_ONLY | By design — tier=site_visit_required |
| REWIRE_COMMERCIAL | 🚫 MANUAL_QUOTE_ONLY | By design — tier=site_visit_required |
| FIRE_ALARM | 🚫 MANUAL_QUOTE_ONLY | By design — tier=site_visit_required |
| TRANSFORMER_INSTALL | 🚫 MANUAL_QUOTE_ONLY | By design — tier=site_visit_required |
| GENERATOR_STANDBY | 🚫 MANUAL_QUOTE_ONLY | By design — tier=site_visit_required |
| GENERATOR_BACKUP | 🚫 MANUAL_QUOTE_ONLY | By design — tier=site_visit_required |

---

## Summary Counts

- ✅ **PRODUCTION_READY:** 3 services
- ⚠️ **READY_WITH_REVIEW_FLAG:** 7 services
- 🚫 **MANUAL_QUOTE_ONLY:** 15 services

## Action Plan for Unlocking More Services

1. **Fill materials for REVIEW services** (RECESSED_LIGHTING, OUTLET_INSTALL, GFCI_OUTLET, DIMMER_SWITCH, MOTION_SECURITY_LIGHT, OUTDOOR_LIGHTING, LIGHT_FIXTURE_INSTALL) — requires filling LGT-037, LGT-007, LGT-008, LGT-013, DEV-017, DEV-021, DEV-024, BOX-007, BOX-006, WIR-009, WIR-010 in Materials tab. Once done, these move to PRODUCTION_READY.
2. **Fill panel + high-power materials** (PNL-005, PNL-006, WIR-011, DEV-008, PNL-007, WIR-012) to unlock EV_CHARGER, HOT_TUB_CIRCUIT, PANEL_UPGRADE, SUBPANEL_INSTALL.
3. **Commercial services** require additional scope validation before any instant-quoting. Recommend keeping all commercial as manual quote indefinitely.
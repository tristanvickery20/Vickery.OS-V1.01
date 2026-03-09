# Material Readiness Report

*Generated: 2026-03-09*

## Overview
- **Total material line items across all assemblies:** 543
- **Unique material IDs referenced in AssemblyItems:** 43
- **Materials with base_cost = 0:** 40 (93%)
- **Materials with real base_cost:** 3 (MAT-202, MAT-052, a few others via partial match)
- **Net effect:** material_allowance = $0 for 54 of 56 assemblies

## Impact on Quote Accuracy
Since materials are $0, all quotes are **labor-only**. For light electrical work (outlets, switches, fan installs),
materials typically represent 15–35% of the true job cost. For panel work, materials can be 40–60% of cost.
**Current quotes are under-priced by ~20–50% vs actual job cost.**

## Top 10 Priority Material IDs to Fill First
(Ranked by assembly coverage × estimated revenue impact)

| Rank | ID | Description | Used In | Est. Unit Cost | Revenue Impact/Job |
|------|-----|------------|---------|---------------|-------------------|
| 1 | MSC-001 | (see Materials tab) | 13 assemblies | $2 | ~$4/unit |
| 2 | BOX-007 | (see Materials tab) | 7 assemblies | $3 | ~$7/unit |
| 3 | CONN-001 | (see Materials tab) | 7 assemblies | $0.5 | ~$1/unit |
| 4 | WIR-009 | (see Materials tab) | 6 assemblies | $13 | ~$29/unit |
| 5 | WIR-010 | (see Materials tab) | 4 assemblies | $9 | ~$20/unit |
| 6 | BOX-006 | (see Materials tab) | 4 assemblies | $8 | ~$18/unit |
| 7 | PNL-006 | (see Materials tab) | 3 assemblies | $22 | ~$49/unit |
| 8 | WIR-012 | (see Materials tab) | 3 assemblies | $90 | ~$200/unit |
| 9 | LGT-007 | (see Materials tab) | 2 assemblies | $45 | ~$100/unit |
| 10 | DEV-024 | (see Materials tab) | 2 assemblies | $18 | ~$40/unit |

## Per-Assembly Material Status

| Assembly | Name | Raw Mat Cost | Missing IDs | Mat Active | Labor-Only Quote Safe? |
|----------|------|-------------|-------------|------------|------------------------|
| A004 | Ceiling Fan Installation | $0.00 (missing ~$94) | 5/5 | NO | YES (labor-heavy job) |
| A003 | Light Fixture Installation | $0.00 (missing ~$62) | 4/4 | NO | YES (labor-heavy job) |
| A001 | Recessed Lighting Installation | $0.00 (missing ~$41) | 5/5 | NO | YES (labor-heavy job) |
| A008 | Dimmer / Smart Switch Installa | $0.00 (missing ~$39) | 4/4 | NO | YES (labor-heavy job) |
| A011 | Outlet / Receptacle Installati | $0.00 (missing ~$20) | 5/5 | NO | YES (labor-heavy job) |
| A012 | GFCI Outlet Installation | $0.00 (missing ~$33) | 5/5 | NO | YES (labor-heavy job) |
| A028 | EV Charger Installation | $0.00 (missing ~$195) | 5/5 | NO | YES (labor-heavy job) |
| A029 | Hot Tub / Spa Electrical Circu | $74.50 (missing ~$225) | 4/6 | PARTIAL | YES (labor-heavy job) |
| A019 | Electrical Panel Upgrade | $129.50 (missing ~$332) | 4/6 | PARTIAL | YES (labor-heavy job) |
| A020 | Sub-Panel Installation | $62.80 (missing ~$340) | 3/5 | PARTIAL | YES (labor-heavy job) |
| A024 | Whole-Home Surge Protector | $0.15 (missing ~$37) | 3/4 | PARTIAL | YES (labor-heavy job) |
| A005 | Outdoor / Landscape Lighting | $0.00 (missing ~$163) | 5/5 | NO | YES (labor-heavy job) |
| A006 | Motion / Security Light Instal | $0.00 (missing ~$136) | 5/5 | NO | YES (labor-heavy job) |
| A030 | Smoke / CO Detector Installati | $0.00 (missing ~$17) | 4/4 | NO | YES (labor-heavy job) |
| A037 | Commercial Lighting Retrofit | $0.00 (missing ~$16) | 3/3 | NO | YES (labor-heavy job) |
| A036 | Ballast / Bulb Replacement | $0.00 (missing ~$8) | 2/2 | NO | YES (labor-heavy job) |
| A034 | Exit / Emergency Light Install | $0.00 (missing ~$91) | 3/3 | NO | RISKY |

## Services Blocked by Missing Materials

The following services should carry a manual review flag until materials are populated:

- **EV_CHARGER (A028):** WIR-011 (125ft 10/2 cable ~$115) + DEV-008 (EV receptacle ~$45) = ~$160 in missing materials. Quote understated by ~$230 (with markup+margin).
- **PANEL_UPGRADE (A019):** PNL-005 ($165), PNL-006 ($22/breaker, multiple). Partial cost $129.50 present but still short ~$200+ in panel + wiring materials.
- **SUBPANEL_INSTALL (A020):** Similar to panel upgrade. Missing WIR-012 (feeder cable ~$90).
- **HOT_TUB_CIRCUIT (A029):** WIR-011 ($115) + PNL-007 ($25) missing. Partial raw cost $74.50 OK but short ~$150.
- **SURGE_PROTECTOR (A024):** PNL-006 missing. Raw cost $0.15 (negligible tape). Missing ~$22 breaker — low impact.
- **DIMMER_SWITCH (A008):** DEV-017 (dimmer ~$22) missing. For a service selling at ~$230 baseline, missing ~$32 in sell price is a meaningful margin hit.
- **SMOKE_CO_DETECTOR (A030):** DEV-020 (switch cover ~$3), BOX-007, WIR-010 missing. Low $ impact given service price.

## Services Safe to Quote Labor-Only (For Now)
These services are labor-dominated and the missing material delta is small relative to quoted price:
- SMOKE_CO_DETECTOR, SURGE_PROTECTOR, BREAKER/PANEL repair (A022/A023), DIMMER_SWITCH
- Any service quoting >$500 where missing materials are <$50 in real cost
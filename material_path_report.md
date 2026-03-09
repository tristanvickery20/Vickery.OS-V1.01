# Material Path Report — HIGH-1

**Status:** Data gap (not a code bug). Join is working correctly (43/43 material-type item_ref_ids resolve). However, 40 of 43 referenced specialty items have `base_cost: 0` because they were auto-added as placeholder rows from AssemblyItems when the workbook was built.

**Impact:** `material_allowance` = $0 for all 56 assemblies that reference any of these items. Labor pricing is unaffected. The 257 MAT-xxx rows with real prices are looked up correctly but are not referenced by AssemblyItems (those rows cover generic wire/conduit/fittings that overlap with WIR-xxx naming).

---

## Zero-Cost Material Rows (40 items needing prices)

| ID | Name | Unit | Suggested Range |
|----|------|------|-----------------|
| BOX-003 | Surface raceway boxes | ea | $4–$8 |
| BOX-004 | Data wall plate box | ea | $3–$6 |
| BOX-006 | Weatherproof junction box | ea | $6–$12 |
| BOX-007 | Device box | ea | $2–$5 |
| CON-005 | Conduit couplings | ea | $0.50–$1.50 |
| CON-007 | EMT conduit ½" 10 ft | ea | $4–$7 |
| CONN-001 | Wire connectors | ea | $0.05–$0.20 |
| CTL-001 | Sensor or smart module | ea | $20–$80 |
| CTL-002 | Smart bridge or control hub | ea | $40–$120 |
| DEV-008 | EV receptacle or inlet | ea | $25–$65 |
| DEV-009 | Range or appliance receptacle | ea | $10–$25 |
| DEV-014 | Smart switch or outlet device | ea | $20–$60 |
| DEV-017 | LED/CFL rated dimmer switch | ea | $15–$40 |
| DEV-020 | Switch cover for detector junction | ea | $2–$5 |
| DEV-021 | Duplex receptacles | ea | $3–$8 |
| DEV-023 | Switch control for fan/light | ea | $8–$20 |
| DEV-024 | GFCI device for exterior circuit | ea | $15–$30 |
| LGT-007 | Ceiling fixture (chandelier/pendant) | ea | $50–$300 |
| LGT-008 | Motion sensor flood/security light fixture | ea | $30–$80 |
| LGT-009 | Exit or alarm fixtures | ea | $40–$100 |
| LGT-010 | Exit/emergency combo fixtures | ea | $60–$150 |
| LGT-013 | Under-cabinet LED strip light | ea | $20–$60 |
| LGT-018 | LED retrofit lamp or kit | ea | $8–$20 |
| LGT-021 | LED retrofit lamps | ea | $5–$15 |
| LGT-027 | LED tubes or lamps | ea | $5–$15 |
| LGT-035 | Photo control or lighting timer | ea | $15–$40 |
| LGT-036 | Ceiling fan/light combo fixture | ea | $80–$250 |
| LGT-037 | 6" LED recessed downlight fixture | ea | $15–$45 |
| MSC-001 | Electrical tape | ea | $1–$3 |
| PNL-004 | Transformer unit | ea | $150–$600 |
| PNL-005 | 100A main breaker load center | ea | $80–$250 |
| PNL-006 | Breakers | ea | $8–$40 |
| PNL-007 | 40A 2-pole breaker | ea | $15–$35 |
| TMP-005 | 6' range cord for generator output | ea | $25–$50 |
| TMP-011 | 6' range cord for portable generator | ea | $25–$50 |
| WIR-009 | Approx 15 ft NM-B 12/2 | ea | $10–$18 |
| WIR-010 | Approx 10 ft NM-B 14/2 cable | ea | $6–$12 |
| WIR-011 | 125 ft NM-B 10/2 cable | ea | $90–$140 |
| WIR-012 | Feeder MC cable | ea | $50–$150 |
| WIR-013 | Category 6 data cable | ea | $20–$60 |

---

## Assemblies Affected (all 56 — every service has at least one zero-cost material)

A001 Recessed (Can) Lighting, A002 Under-Cabinet Lighting, A003 Chandelier & Fixture, A004 Ceiling Fan, A005 Outdoor & Landscape Lighting, A006 Motion Sensor & Security Lighting, A007 LED Lighting Upgrades, A008 Dimmer Switch, A009 Light Fixture Repair, A010 Troubleshooting (Flickering), A011 New Outlet, A012 GFCI Outlet, A013 Switch & Outlet Repair, A014 Smart Switch/Outlet, A015 Whole-House Rewiring, A016 Partial Home Rewiring, A017 Dedicated Circuits, A018 Code Compliance, A019 Service Panel Upgrade, A020 Subpanel Installation, A021 Fuse Box → Breaker, A022 Breaker Tripping, A023 Panel/Breaker Repair, A024 Surge Protection, A025 Appliance Installation, A026 Standby Generator, A027 Portable Generator Hookup, A028 EV Charger, A029 Hot Tub & Pool Wiring, A030 Smoke/CO Detector, A031 Home Automation, A032–A056 (all commercial).

---

## What Needs to Be Done

1. Open the **Materials** tab in the V2 estimator sheet (`1MbEGQyFvyXW77rKqIAanbmfY23aauheRGMFulxvZaFk`)
2. Filter for rows where `base_cost = 0` (or column F is empty/zero)
3. Fill in realistic `base_cost` values per the table above
4. The code join is correct — prices will automatically appear in quotes once filled

**Priority ordering:** LGT-037, LGT-036, LGT-013, DEV-017, DEV-021, BOX-007, WIR-009/010 cover the highest-volume residential services. Fill those 8 first for 80% coverage.

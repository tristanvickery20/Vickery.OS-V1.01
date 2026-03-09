# Estimator Scenario Validation Report

*Generated: 2026-03-09*
*Engine: V2 | Crew: 1JW+1AP @ $91/hr | Overhead: 20% | Margin: 30% | Drive: 0.25hr*
*Note: All material_allowance = $0 — placeholder prices in sheet. Labor pricing validated below.*

---

## CEILING_FAN_INSTALL — Ceiling Fan Installation
**Assembly:** A004 | **Labor hours (base):** 1.005 | **Risk class:** LOW | **Dynamic mult:** 1.15x
**Active modules:** PROPERTY_TYPE, HOME_AGE, CEILING_HEIGHT, ATTIC_ACCESS, FAN_EXISTING_BOX, FAN_CONTROL_TYPE, FIXTURE_SUPPLIED_BY

| Scenario | Drivers Applied | Total Hours | Labor Cost | Final Price | Notes |
|----------|----------------|-------------|-----------|-------------|-------|
| easy – existing box, standard ctrl, new home | none | 1.25 | $114 | **$230** | ok |
| normal – 9-12ft, wall control, 1990s home | CEILING_HEIGHT×1.1, HOME_AGE×1.05, FAN_CONTROL_TYPE×1.05 | 1.47 | $134 | **$270** | ok |
| hard – high ceiling (15-20ft), no attic, remote | CEILING_HEIGHT×1.6, ATTIC_ACCESS×1.5, HOME_AGE×1.05, FAN_CONTROL_TYPE×1.1 | 3.04 | $276 | **$555** | ok |
| stacked – high ceiling, no box, no attic, older home | CEILING_HEIGHT×1.6, ATTIC_ACCESS×1.5, HOME_AGE×1.25, FAN_EXISTING_BOX×1.25, FAN_CONTROL_TYPE×1.1 | 4.40 | $400 | **$805** | ok |
| uncertain / not-sure answers | CEILING_HEIGHT×1.3, ATTIC_ACCESS×1.2, HOME_AGE×1.1, FAN_EXISTING_BOX×1.15, FAN_CONTROL_TYPE×1.05 | 2.33 | $212 | **$425** | ok |
| disqualify – commercial property | DISQUALIFIED (PROPERTY_TYPE:commercial) | — | — | — | Site visit required |

**Price range:** $230 – $805 (3.50× baseline). Progression looks realistic for complex jobs
**Flags:** ALL_MATERIALS_MISSING

---

## LIGHT_FIXTURE_INSTALL — Light Fixture Installation
**Assembly:** A003 | **Labor hours (base):** 1.03 | **Risk class:** LOW | **Dynamic mult:** 1.15x
**Active modules:** PROPERTY_TYPE, HOME_AGE, CEILING_HEIGHT, WALL_TYPE, ATTIC_ACCESS, LIGHTING_EXISTING_LOCATION, FIXTURE_SUPPLIED_BY, FIXTURE_WEIGHT

| Scenario | Drivers Applied | Total Hours | Labor Cost | Final Price | Notes |
|----------|----------------|-------------|-----------|-------------|-------|
| easy – replace existing, <9ft drywall, standard weight | none | 1.28 | $116 | **$235** | ok |
| normal – 9-12ft, new location, 1990s home | CEILING_HEIGHT×1.1, HOME_AGE×1.05, LIGHTING_EXISTING_LOCATION×1.25 | 1.74 | $158 | **$320** | ok |
| hard – 15-20ft, tile wall, limited attic, heavy fixture | CEILING_HEIGHT×1.6, WALL_TYPE×1.5, ATTIC_ACCESS×1.25, HOME_AGE×1.05, LIGHTING_EXISTING_LOCATION×1.25, FIXTURE_WEIGHT×1.35 | 5.73 | $521 | **$1,050** | ⚠️ very high |
| stacked – 15-20ft, tile, no attic, heavy fixture, pre-1950 | CEILING_HEIGHT×1.6, WALL_TYPE×1.5, ATTIC_ACCESS×1.5, HOME_AGE×1.25, LIGHTING_EXISTING_LOCATION×1.25, FIXTURE_WEIGHT×1.35 | 8.07 | $735 | **$1,475** | ⚠️ very high |
| uncertain – mid-height, plaster, not-sure | CEILING_HEIGHT×1.3, WALL_TYPE×1.3, ATTIC_ACCESS×1.2, HOME_AGE×1.1, LIGHTING_EXISTING_LOCATION×1.1, FIXTURE_WEIGHT×1.15 | 3.16 | $287 | **$580** | ok |
| disqualify – brick wall | DISQUALIFIED (WALL_TYPE:brick) | — | — | — | Site visit required |

**Price range:** $235 – $1,475 (6.28× baseline). ⚠️ STACKED MULTIPLIERS MAY BE TOO AGGRESSIVE
**Flags:** STACK_EXPLODES, ALL_MATERIALS_MISSING

---

## RECESSED_LIGHTING — Recessed Lighting Installation
**Assembly:** A001 | **Labor hours (base):** 1.55 | **Risk class:** LOW | **Dynamic mult:** 1.15x
**Active modules:** PROPERTY_TYPE, HOME_AGE, CEILING_HEIGHT, WALL_TYPE, ATTIC_ACCESS, LIGHTING_EXISTING_LOCATION, FIXTURE_SUPPLIED_BY, RECESSED_LIGHT_CEILING_TYPE, RECESSED_LIGHT_INSULATION, RECESSED_LIGHT_COUNT

| Scenario | Drivers Applied | Total Hours | Labor Cost | Final Price | Notes |
|----------|----------------|-------------|-----------|-------------|-------|
| easy – <9ft, drywall, full attic, replace, new home (qty=1) | none | 1.80 | $164 | **$330** | ok |
| normal – 9-12ft, drywall, full attic, new location (qty=1) | CEILING_HEIGHT×1.1, HOME_AGE×1.05, LIGHTING_EXISTING_LOCATION×1.25, RECESSED_LIGHT_INSULATION×1.1 | 2.71 | $247 | **$495** | ok |
| hard – 15-20ft, tile, limited attic, plaster ceiling (qty=1) | CEILING_HEIGHT×1.6, WALL_TYPE×1.5, ATTIC_ACCESS×1.25, HOME_AGE×1.05, LIGHTING_EXISTING_LOCATION×1.25, RECESSED_LIGHT_CEILING_TYPE×1.3, RECESSED_LIGHT_INSULATION×1.1 | 8.98 | $817 | **$1,645** | ⚠️ very high |
| stacked difficult – 15-20ft, tile, no attic, plaster, pre-1950 (qty=1) | CEILING_HEIGHT×1.6, WALL_TYPE×1.5, ATTIC_ACCESS×1.5, HOME_AGE×1.25, LIGHTING_EXISTING_LOCATION×1.25, RECESSED_LIGHT_CEILING_TYPE×1.3, RECESSED_LIGHT_INSULATION×1.1 | 12.72 | $1,157 | **$2,325** | ⚠️ very high |
| uncertain – 12-14ft, plaster walls, not-sure (qty=1) | CEILING_HEIGHT×1.3, WALL_TYPE×1.3, ATTIC_ACCESS×1.2, HOME_AGE×1.1, RECESSED_LIGHT_CEILING_TYPE×1.3, RECESSED_LIGHT_INSULATION×1.1 | 5.19 | $473 | **$950** | ok |
| disqualify – ceiling height >20ft | DISQUALIFIED (CEILING_HEIGHT:gt20) | — | — | — | Site visit required |

**Price range:** $330 – $2,325 (7.05× baseline). ⚠️ STACKED MULTIPLIERS MAY BE TOO AGGRESSIVE
**Flags:** STACK_EXPLODES, ALL_MATERIALS_MISSING

---

## DIMMER_SWITCH — Dimmer / Smart Switch Installation
**Assembly:** A008 | **Labor hours (base):** 0.685 | **Risk class:** LOW | **Dynamic mult:** 1.15x
**Active modules:** PROPERTY_TYPE, HOME_AGE, WALL_TYPE, DIMMER_LOAD_TYPE, DIMMER_LED_COMPAT, DIMMER_STYLE, DEVICE_BRAND, FIXTURE_SUPPLIED_BY

| Scenario | Drivers Applied | Total Hours | Labor Cost | Final Price | Notes |
|----------|----------------|-------------|-----------|-------------|-------|
| easy – LED load, toggle, drywall, new home | none | 0.94 | $85 | **$170** | ok |
| normal – LED, smart dimmer, 1990s home | HOME_AGE×1.05, DIMMER_STYLE×1.1 | 1.04 | $95 | **$190** | ok |
| hard – fan motor load, smart dimmer, plaster wall, old home | WALL_TYPE×1.3, HOME_AGE×1.15, DIMMER_LOAD_TYPE×1.15, DIMMER_STYLE×1.1 | 1.55 | $141 | **$285** | ok |
| stacked – fan motor, smart dimmer, tile wall, pre-1950 | WALL_TYPE×1.5, HOME_AGE×1.25, DIMMER_LOAD_TYPE×1.15, DIMMER_STYLE×1.1 | 1.87 | $171 | **$345** | ok |
| uncertain – not-sure load type, not-sure style | HOME_AGE×1.1, DIMMER_LOAD_TYPE×1.1 | 1.08 | $98 | **$195** | ok |
| disqualify – brick wall | DISQUALIFIED (WALL_TYPE:brick) | — | — | — | Site visit required |

**Price range:** $170 – $345 (2.03× baseline). Progression looks realistic for complex jobs
**Flags:** ALL_MATERIALS_MISSING

---

## OUTLET_INSTALL — Outlet / Receptacle Installation
**Assembly:** A011 | **Labor hours (base):** 0.78 | **Risk class:** LOW | **Dynamic mult:** 1.15x
**Active modules:** PROPERTY_TYPE, HOME_AGE, WALL_TYPE, OUTLET_LOCATION_TYPE, EXISTING_POWER_PRESENT, FIXTURE_SUPPLIED_BY

| Scenario | Drivers Applied | Total Hours | Labor Cost | Final Price | Notes |
|----------|----------------|-------------|-----------|-------------|-------|
| easy – general interior, power present, drywall, new home | none | 1.03 | $94 | **$190** | ok |
| normal – kitchen location, power present, 1990s | HOME_AGE×1.05, OUTLET_LOCATION_TYPE×1.1 | 1.15 | $105 | **$210** | ok |
| hard – outdoor location, no power, plaster wall | WALL_TYPE×1.3, HOME_AGE×1.15, OUTLET_LOCATION_TYPE×1.2, EXISTING_POWER_PRESENT×1.25 | 2.00 | $182 | **$365** | ok |
| stacked – outdoor, no power, tile wall, pre-1950 | WALL_TYPE×1.5, HOME_AGE×1.25, OUTLET_LOCATION_TYPE×1.2, EXISTING_POWER_PRESENT×1.25 | 2.44 | $222 | **$445** | ok |
| uncertain – general, not-sure power, not-sure wall | HOME_AGE×1.1, OUTLET_LOCATION_TYPE×1.1, EXISTING_POWER_PRESENT×1.15 | 1.34 | $122 | **$245** | ok |
| disqualify – brick wall | DISQUALIFIED (WALL_TYPE:brick) | — | — | — | Site visit required |

**Price range:** $190 – $445 (2.34× baseline). Progression looks realistic for complex jobs
**Flags:** ALL_MATERIALS_MISSING

---

## GFCI_OUTLET — GFCI Outlet Installation
**Assembly:** A012 | **Labor hours (base):** 0.73 | **Risk class:** LOW | **Dynamic mult:** 1.15x
**Active modules:** PROPERTY_TYPE, HOME_AGE, WALL_TYPE, OUTLET_LOCATION_TYPE, EXISTING_POWER_PRESENT, FIXTURE_SUPPLIED_BY, GFCI_EXISTING

| Scenario | Drivers Applied | Total Hours | Labor Cost | Final Price | Notes |
|----------|----------------|-------------|-----------|-------------|-------|
| easy – replace existing, drywall, kitchen, new home | OUTLET_LOCATION_TYPE×1.1 | 1.05 | $96 | **$195** | ok |
| normal – add new, drywall, bath, 1990s | HOME_AGE×1.05, OUTLET_LOCATION_TYPE×1.1, GFCI_EXISTING×1.15 | 1.22 | $111 | **$225** | ok |
| hard – add new, outdoor, plaster, no power, old home | WALL_TYPE×1.3, HOME_AGE×1.15, OUTLET_LOCATION_TYPE×1.2, EXISTING_POWER_PRESENT×1.25, GFCI_EXISTING×1.15 | 2.13 | $194 | **$390** | ok |
| stacked – add new, outdoor, tile, no power, pre-1950 | WALL_TYPE×1.5, HOME_AGE×1.25, OUTLET_LOCATION_TYPE×1.2, EXISTING_POWER_PRESENT×1.25, GFCI_EXISTING×1.15 | 2.61 | $238 | **$480** | ok |
| uncertain – not-sure everything | HOME_AGE×1.1, OUTLET_LOCATION_TYPE×1.1, EXISTING_POWER_PRESENT×1.15, GFCI_EXISTING×1.1 | 1.37 | $124 | **$250** | ok |
| disqualify – brick wall | DISQUALIFIED (WALL_TYPE:brick) | — | — | — | Site visit required |

**Price range:** $195 – $480 (2.46× baseline). Progression looks realistic for complex jobs
**Flags:** ALL_MATERIALS_MISSING

---

## EV_CHARGER — EV Charger Installation
**Assembly:** A028 | **Labor hours (base):** 1.73 | **Risk class:** LOW | **Dynamic mult:** 1.15x
**Active modules:** PROPERTY_TYPE, HOME_AGE, EV_CHARGER_TYPE, EV_HARDWIRE_OR_PLUG, EV_PANEL_CAPACITY, DEDICATED_CIRCUIT_DISTANCE

| Scenario | Drivers Applied | Total Hours | Labor Cost | Final Price | Notes |
|----------|----------------|-------------|-----------|-------------|-------|
| easy – L1 charger, hardwired, panel ok, <25ft run | none | 1.98 | $180 | **$360** | ok |
| normal – L2 charger, hardwired, panel ok, 25-50ft | HOME_AGE×1.05, EV_CHARGER_TYPE×1.2, DEDICATED_CIRCUIT_DISTANCE×1.1 | 2.65 | $241 | **$485** | ok |
| hard – L2, plug-in, panel ok, 50-100ft run | HOME_AGE×1.05, EV_CHARGER_TYPE×1.2, EV_HARDWIRE_OR_PLUG×1.1, DEDICATED_CIRCUIT_DISTANCE×1.25 | 3.25 | $295 | **$595** | ok |
| stacked – L2, plug-in, not-sure panel, >100ft run, older home | HOME_AGE×1.25, EV_CHARGER_TYPE×1.2, EV_HARDWIRE_OR_PLUG×1.1, EV_PANEL_CAPACITY×1.1, DEDICATED_CIRCUIT_DISTANCE×1.5 | 4.96 | $451 | **$910** | ok |
| uncertain – not-sure charger type and distance | HOME_AGE×1.1, EV_CHARGER_TYPE×1.1, EV_HARDWIRE_OR_PLUG×1.05, EV_PANEL_CAPACITY×1.1, DEDICATED_CIRCUIT_DISTANCE×1.15 | 3.03 | $276 | **$555** | ok |
| disqualify – panel no capacity | DISQUALIFIED (EV_PANEL_CAPACITY:no) | — | — | — | Site visit required |

**Price range:** $360 – $910 (2.53× baseline). Progression looks realistic for complex jobs
**Flags:** ALL_MATERIALS_MISSING

---

## HOT_TUB_CIRCUIT — Hot Tub / Spa Electrical Circuit
**Assembly:** A029 | **Labor hours (base):** 1.57 | **Risk class:** HIGH | **Dynamic mult:** 1.15x
**Active modules:** PROPERTY_TYPE, HOME_AGE, HOT_TUB_POOL_EQUIPMENT, DEDICATED_CIRCUIT_DISTANCE

| Scenario | Drivers Applied | Total Hours | Labor Cost | Final Price | Notes |
|----------|----------------|-------------|-----------|-------------|-------|
| easy – hot tub only, <25ft circuit run, newer home | none | 1.82 | $166 | **$590** | ok |
| normal – pool pump, 25-50ft, 1990s home | HOME_AGE×1.05, DEDICATED_CIRCUIT_DISTANCE×1.1 | 2.06 | $188 | **$640** | ok |
| hard – heater, 50-100ft run, older home | HOME_AGE×1.15, DEDICATED_CIRCUIT_DISTANCE×1.25 | 2.51 | $228 | **$735** | ok |
| stacked – combo unit, >100ft run, pre-1950, older home | HOME_AGE×1.25, HOT_TUB_POOL_EQUIPMENT×1.25, DEDICATED_CIRCUIT_DISTANCE×1.5 | 3.93 | $358 | **$1,025** | ok |
| uncertain – not-sure equipment and distance | HOME_AGE×1.1, DEDICATED_CIRCUIT_DISTANCE×1.15 | 2.24 | $203 | **$675** | ok |
| disqualify – commercial property | DISQUALIFIED (PROPERTY_TYPE:commercial) | — | — | — | Site visit required |

**Price range:** $590 – $1,025 (1.74× baseline). Progression logical

---

## PANEL_UPGRADE — Electrical Panel Upgrade
**Assembly:** A019 | **Labor hours (base):** 3.76 | **Risk class:** LOW | **Dynamic mult:** 1.15x
**Active modules:** PROPERTY_TYPE, HOME_AGE, PANEL_WORK_TYPE, PANEL_BRAND

| Scenario | Drivers Applied | Total Hours | Labor Cost | Final Price | Notes |
|----------|----------------|-------------|-----------|-------------|-------|
| easy – add breaker, Square D panel, newer home | none | 4.01 | $365 | **$1,070** | ok |
| normal – replace breaker, Siemens, 1990s | HOME_AGE×1.05 | 4.20 | $382 | **$1,105** | ok |
| hard – subpanel work, not-sure brand, older home | HOME_AGE×1.15, PANEL_WORK_TYPE×1.25 | 5.65 | $515 | **$1,370** | ok |
| stacked – subpanel, not-sure brand, pre-1950 | HOME_AGE×1.25, PANEL_WORK_TYPE×1.25 | 6.12 | $557 | **$1,460** | ok |
| uncertain – not-sure work type | HOME_AGE×1.1 | 4.39 | $399 | **$1,140** | ok |
| disqualify – full upgrade requested | DISQUALIFIED (PANEL_WORK_TYPE:upgrade) | — | — | — | Site visit required |
| disqualify – FPE hazard panel | DISQUALIFIED (PANEL_BRAND:fpe) | — | — | — | Site visit required |

**Price range:** $1,070 – $1,460 (1.36× baseline). Progression logical

---

## SUBPANEL_INSTALL — Sub-Panel Installation
**Assembly:** A020 | **Labor hours (base):** 2.475 | **Risk class:** LOW | **Dynamic mult:** 1.15x
**Active modules:** PROPERTY_TYPE, HOME_AGE, PANEL_WORK_TYPE, PANEL_BRAND

| Scenario | Drivers Applied | Total Hours | Labor Cost | Final Price | Notes |
|----------|----------------|-------------|-----------|-------------|-------|
| easy – add breaker, Square D panel, newer home | none | 2.73 | $248 | **$660** | ok |
| normal – subpanel work, Siemens, 1990s | HOME_AGE×1.05, PANEL_WORK_TYPE×1.25 | 3.50 | $318 | **$805** | ok |
| hard – subpanel, not-sure brand, 1950s | HOME_AGE×1.15, PANEL_WORK_TYPE×1.25 | 3.81 | $347 | **$860** | ok |
| stacked – subpanel, not-sure brand, pre-1950 | HOME_AGE×1.25, PANEL_WORK_TYPE×1.25 | 4.12 | $375 | **$915** | ok |
| uncertain – not-sure work type and brand | HOME_AGE×1.1 | 2.97 | $270 | **$710** | ok |
| disqualify – full upgrade | DISQUALIFIED (PANEL_WORK_TYPE:upgrade) | — | — | — | Site visit required |

**Price range:** $660 – $915 (1.39× baseline). Progression logical

---

## SURGE_PROTECTOR — Whole-Home Surge Protector
**Assembly:** A024 | **Labor hours (base):** 1.01 | **Risk class:** LOW | **Dynamic mult:** 1.15x
**Active modules:** PROPERTY_TYPE, HOME_AGE, SURGE_TYPE, PANEL_BRAND

| Scenario | Drivers Applied | Total Hours | Labor Cost | Final Price | Notes |
|----------|----------------|-------------|-----------|-------------|-------|
| easy – whole-home SPD, known brand, newer home | none | 1.26 | $115 | **$230** | ok |
| normal – point of use, 1990s | HOME_AGE×1.05 | 1.31 | $119 | **$240** | ok |
| hard – whole-home, older home, not-sure brand | HOME_AGE×1.15 | 1.41 | $128 | **$260** | ok |
| stacked – whole-home, pre-1950, not-sure brand | HOME_AGE×1.25 | 1.51 | $138 | **$275** | ok |
| uncertain – not-sure everything | HOME_AGE×1.1 | 1.36 | $124 | **$250** | ok |
| disqualify – Zinsco panel | DISQUALIFIED (PANEL_BRAND:zinsco) | — | — | — | Site visit required |

**Price range:** $230 – $275 (1.20× baseline). Progression logical

---

## OUTDOOR_LIGHTING — Outdoor / Landscape Lighting
**Assembly:** A005 | **Labor hours (base):** 0.845 | **Risk class:** LOW | **Dynamic mult:** 1.15x
**Active modules:** PROPERTY_TYPE, HOME_AGE, CEILING_HEIGHT, WALL_TYPE, ATTIC_ACCESS, LIGHTING_EXISTING_LOCATION, FIXTURE_SUPPLIED_BY, OUTDOOR_EXPOSURE

| Scenario | Drivers Applied | Total Hours | Labor Cost | Final Price | Notes |
|----------|----------------|-------------|-----------|-------------|-------|
| easy – replace existing, <9ft, drywall, new home, sheltered | none | 1.09 | $100 | **$200** | ok |
| normal – new location, 9-12ft, some exposure, 1990s | CEILING_HEIGHT×1.1, HOME_AGE×1.05, LIGHTING_EXISTING_LOCATION×1.25, OUTDOOR_EXPOSURE×1.1 | 1.59 | $145 | **$290** | ok |
| hard – 15-20ft, tile, limited attic, full exposure | CEILING_HEIGHT×1.6, WALL_TYPE×1.5, ATTIC_ACCESS×1.25, HOME_AGE×1.05, LIGHTING_EXISTING_LOCATION×1.25, OUTDOOR_EXPOSURE×1.2 | 4.24 | $386 | **$775** | ok |
| stacked – 15-20ft, tile, no attic, full exposure, pre-1950 | CEILING_HEIGHT×1.6, WALL_TYPE×1.5, ATTIC_ACCESS×1.5, HOME_AGE×1.25, LIGHTING_EXISTING_LOCATION×1.25, OUTDOOR_EXPOSURE×1.2 | 5.95 | $542 | **$1,090** | ⚠️ very high |
| uncertain – not-sure conditions | CEILING_HEIGHT×1.3, WALL_TYPE×1.3, ATTIC_ACCESS×1.2, HOME_AGE×1.1, OUTDOOR_EXPOSURE×1.1 | 2.32 | $211 | **$425** | ok |
| disqualify – brick wall | DISQUALIFIED (WALL_TYPE:brick) | — | — | — | Site visit required |

**Price range:** $200 – $1,090 (5.45× baseline). ⚠️ STACKED MULTIPLIERS MAY BE TOO AGGRESSIVE
**Flags:** STACK_EXPLODES, ALL_MATERIALS_MISSING

---

## MOTION_SECURITY_LIGHT — Motion / Security Light Installation
**Assembly:** A006 | **Labor hours (base):** 0.88 | **Risk class:** LOW | **Dynamic mult:** 1.15x
**Active modules:** PROPERTY_TYPE, HOME_AGE, CEILING_HEIGHT, WALL_TYPE, ATTIC_ACCESS, LIGHTING_EXISTING_LOCATION, FIXTURE_SUPPLIED_BY, OUTDOOR_EXPOSURE, MOTION_SENSOR_LOCATION_HEIGHT

| Scenario | Drivers Applied | Total Hours | Labor Cost | Final Price | Notes |
|----------|----------------|-------------|-----------|-------------|-------|
| easy – replace, <9ft, drywall, new home, sheltered | none | 1.13 | $103 | **$205** | ok |
| normal – new location, 9-12ft, some exposure, 1990s | CEILING_HEIGHT×1.1, HOME_AGE×1.05, LIGHTING_EXISTING_LOCATION×1.25, OUTDOOR_EXPOSURE×1.1 | 1.65 | $150 | **$300** | ok |
| hard – 12-14ft height, tile, full exposure, 10-18ft sensor | CEILING_HEIGHT×1.3, WALL_TYPE×1.5, ATTIC_ACCESS×1.25, HOME_AGE×1.15, LIGHTING_EXISTING_LOCATION×1.25, OUTDOOR_EXPOSURE×1.2, MOTION_SENSOR_LOCATION_HEIGHT×1.2 | 4.69 | $427 | **$860** | ⚠️ very high |
| stacked – 15-20ft, tile, no attic, full exposure, pre-1950, 10-18ft | CEILING_HEIGHT×1.6, WALL_TYPE×1.5, ATTIC_ACCESS×1.5, HOME_AGE×1.25, LIGHTING_EXISTING_LOCATION×1.25, OUTDOOR_EXPOSURE×1.2, MOTION_SENSOR_LOCATION_HEIGHT×1.2 | 7.38 | $671 | **$1,350** | ⚠️ very high |
| uncertain – not-sure height and exposure | CEILING_HEIGHT×1.3, WALL_TYPE×1.3, OUTDOOR_EXPOSURE×1.1, MOTION_SENSOR_LOCATION_HEIGHT×1.15 | 2.13 | $194 | **$390** | ok |
| disqualify – sensor height >18ft | DISQUALIFIED (MOTION_SENSOR_LOCATION_HEIGHT:gt18) | — | — | — | Site visit required |

**Price range:** $205 – $1,350 (6.59× baseline). ⚠️ STACKED MULTIPLIERS MAY BE TOO AGGRESSIVE
**Flags:** STACK_EXPLODES, ALL_MATERIALS_MISSING

---

## SMOKE_CO_DETECTOR — Smoke / CO Detector Installation
**Assembly:** A030 | **Labor hours (base):** 0.6 | **Risk class:** LOW | **Dynamic mult:** 1.15x
**Active modules:** PROPERTY_TYPE, HOME_AGE, EXISTING_POWER_PRESENT

| Scenario | Drivers Applied | Total Hours | Labor Cost | Final Price | Notes |
|----------|----------------|-------------|-----------|-------------|-------|
| easy – power present, new home | none | 0.85 | $77 | **$155** | ok |
| normal – power present, 1990s home | HOME_AGE×1.05 | 0.88 | $80 | **$160** | ok |
| hard – no power (new wiring needed), older home | HOME_AGE×1.15, EXISTING_POWER_PRESENT×1.25 | 1.11 | $101 | **$205** | ok |
| stacked – no power, pre-1950 home | HOME_AGE×1.25, EXISTING_POWER_PRESENT×1.25 | 1.19 | $108 | **$215** | ok |
| uncertain – not-sure if power is present | HOME_AGE×1.1, EXISTING_POWER_PRESENT×1.15 | 1.01 | $92 | **$185** | ok |
| disqualify – commercial | DISQUALIFIED (PROPERTY_TYPE:commercial) | — | — | — | Site visit required |

**Price range:** $155 – $215 (1.39× baseline). Progression logical
**Flags:** ALL_MATERIALS_MISSING

---


# Commercial Services — Scenario Validation

## COMM_LIGHTING_RETROFIT — Commercial Lighting Retrofit
**Assembly:** A037 | **Base hours:** 0.99 | **Risk:** LOW | **Dynmult:** 1.15x

| Scenario | Drivers | Hours | Labor | Final Price |
|----------|---------|-------|-------|-------------|
| easy – replace, low ceiling, drywall, standard hours | none | 1.24 | $113 | **$225** |
| normal – new location, 9-12ft, drywall | CEILING_HEIGHT×1.1, LIGHTING_EXISTING_LOCATION×1.25 | 1.61 | $147 | **$295** |
| hard – 15-20ft, tile, limited attic | CEILING_HEIGHT×1.6, WALL_TYPE×1.5, ATTIC_ACCESS×1.25, LIGHTING_EXISTING_LOCATION×1.25 | 3.96 | $361 | **$725** |
| stacked – 15-20ft, tile, no attic, pre-1950 | CEILING_HEIGHT×1.6, WALL_TYPE×1.5, ATTIC_ACCESS×1.5, HOME_AGE×1.25, LIGHTING_EXISTING_LOCATION×1.25 | 5.82 | $530 | **$1,065** |
| uncertain – mid height, plaster, not sure | CEILING_HEIGHT×1.3, WALL_TYPE×1.3, ATTIC_ACCESS×1.2 | 2.26 | $205 | **$415** |

**Range:** $225 – $1,065
**Flags:** ALL_MATERIALS_MISSING

---

## BALLAST_REPLACE — Ballast / Bulb Replacement
**Assembly:** A036 | **Base hours:** 0.94 | **Risk:** LOW | **Dynmult:** 1.15x

| Scenario | Drivers | Hours | Labor | Final Price |
|----------|---------|-------|-------|-------------|
| easy – replace, low ceiling | none | 1.19 | $108 | **$220** |
| normal – 9-12ft ceiling | CEILING_HEIGHT×1.1 | 1.28 | $117 | **$235** |
| hard – 15-20ft, tile, limited attic | CEILING_HEIGHT×1.6, WALL_TYPE×1.5, ATTIC_ACCESS×1.25 | 3.07 | $279 | **$560** |
| stacked – 15-20ft, tile, no attic | CEILING_HEIGHT×1.6, WALL_TYPE×1.5, ATTIC_ACCESS×1.5 | 3.63 | $331 | **$665** |
| uncertain | CEILING_HEIGHT×1.3, ATTIC_ACCESS×1.2 | 1.72 | $156 | **$315** |

**Range:** $220 – $665
**Flags:** ALL_MATERIALS_MISSING

---

## EXIT_EMERGENCY_LIGHTS — Exit / Emergency Light Installation
**Assembly:** A034 | **Base hours:** 0.93 | **Risk:** HIGH | **Dynmult:** 1.15x

| Scenario | Drivers | Hours | Labor | Final Price |
|----------|---------|-------|-------|-------------|
| easy – replace, low ceiling | none | 1.18 | $107 | **$240** |
| normal – 9-12ft, new location | CEILING_HEIGHT×1.1, LIGHTING_EXISTING_LOCATION×1.25 | 1.53 | $139 | **$315** |
| hard – 15-20ft, tile, limited attic | CEILING_HEIGHT×1.6, WALL_TYPE×1.5, ATTIC_ACCESS×1.25, LIGHTING_EXISTING_LOCATION×1.25 | 3.74 | $340 | **$770** |
| stacked – 15-20ft, tile, no attic, new location, pre-1950 | CEILING_HEIGHT×1.6, WALL_TYPE×1.5, ATTIC_ACCESS×1.5, HOME_AGE×1.25, LIGHTING_EXISTING_LOCATION×1.25 | 5.48 | $499 | **$1,125** |
| uncertain | CEILING_HEIGHT×1.3, ATTIC_ACCESS×1.2 | 1.70 | $155 | **$350** |

**Range:** $240 – $1,125
**Flags:** ALL_MATERIALS_MISSING

---

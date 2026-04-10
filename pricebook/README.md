# Vickery Electric — NEE Price Book Parser

Converts the 2025 National Electrical Estimator PDF into a searchable SQLite database for cross-referencing against your estimator's labor hours.

## Setup

```
pip install pdfplumber pandas
```

## Step 1 — Place your PDF

Copy your PDF to:
```
input/national_electrical_estimator.pdf
```

## Step 2 — Run the parser

```bash
python pricebook/main.py
```

Or with a custom path:
```bash
python pricebook/main.py /path/to/your/estimator.pdf
```

## Output Files

| File | Description |
|---|---|
| `output/electrical_labor_raw.csv` | Every candidate cost row before normalization |
| `output/electrical_labor_clean.json` | Clean, normalized labor rows |
| `output/review_needed.csv` | Flagged rows with issues (missing unit, bad numbers, etc.) |
| `output/pricebook.db` | SQLite database — query with search.py |

## Step 3 — Compare against your estimator

Edit the `OUR_ASSEMBLIES` list in `compare_estimator.py` to match your assembly labor hours, then:

```bash
python pricebook/compare_estimator.py
```

Output shows each service, your hours vs NEE hours, difference, and verdict (on_target / over / under).

## Step 4 — Search manually

```bash
python pricebook/search.py output/pricebook.db "ceiling fan"
python pricebook/search.py output/pricebook.db "200 amp panel"
python pricebook/search.py output/pricebook.db "GFCI"
```

## File Structure

```
pricebook/
  main.py               — orchestrates full pipeline
  parse_pdf.py          — PDF extraction (pdfplumber)
  normalize.py          — column parsing + validation
  database.py           — SQLite operations
  search.py             — query API
  compare_estimator.py  — cross-reference against your assemblies

input/
  national_electrical_estimator.pdf   ← place your PDF here

output/
  electrical_labor_raw.csv
  electrical_labor_clean.json
  review_needed.csv
  pricebook.db
```

## Notes

- **Labor hours only** — material and installed costs are extracted if parseable but not the focus
- **Column order** the parser expects: `description | unit | man-hours | material | labor | installed`
- **Flagged rows**: rows missing a unit, non-numeric costs, or implausibly large values land in `review_needed.csv`
- The `compare_estimator.py` verdicts: **over** = you quote more hours than NEE (may be padding); **under** = you quote fewer (potential margin risk)

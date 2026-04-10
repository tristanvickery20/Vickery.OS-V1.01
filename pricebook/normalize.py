"""
normalize.py
Converts raw NEE cost rows into structured, validated records.

NEE row format:
  Description  L1@0.05  Ea  mat_cost  labor_cost  installed_cost

Labor hours come from the Craft@Hrs field: L1@0.05 → 0.05 hrs
Labor cost is the second dollar column (after material cost).
"""

import re
from typing import Optional

SOURCE_BOOK = "National Electrical Estimator"
SOURCE_YEAR = "2025"

# ── Patterns ─────────────────────────────────────────────────────────────────
CRAFT_RE  = re.compile(r'\b(L\d+|S\d+|C\d+|M\d+|E\d+)@(\d+\.?\d*)\b')
UNIT_RE   = re.compile(
    r'\b(Ea|EA|LF|lf|CLF|KLF|klf|SY|SF|sf|C|M|HR|Hr|hr|LS|ls|PR|pr|SET|BX|MSF|MFBM|Sq|Ton|Gal|Roll)\b'
)
DOLLAR_RE = re.compile(r'(\d{1,6}(?:,\d{3})*(?:\.\d{1,2})?)')

VALID_UNITS = {
    "EA", "LF", "CLF", "KLF", "SY", "SF", "C", "M",
    "HR", "LS", "PR", "SET", "BX", "MSF", "MFBM",
    "SQ", "TON", "GAL", "ROLL",
}


# ── Extraction helpers ────────────────────────────────────────────────────────

def _extract_craft(raw: str) -> tuple[Optional[str], Optional[float]]:
    """Return (crew_code, labor_hours) from Craft@Hrs field."""
    m = CRAFT_RE.search(raw)
    if not m:
        return None, None
    crew = m.group(1)
    hrs  = float(m.group(2))
    return crew, hrs


def _extract_unit(raw: str) -> Optional[str]:
    m = UNIT_RE.search(raw)
    return m.group(0).upper() if m else None


def _extract_costs(raw: str) -> tuple[Optional[float], Optional[float]]:
    """
    Extract material cost and labor cost from the dollar columns.
    In NEE the order after unit is: mat_cost  labor_cost  installed_cost.
    We strip commas from numbers before converting.
    """
    # Remove the Craft@Hrs token so its numbers don't interfere
    cleaned = CRAFT_RE.sub(" ", raw)
    nums = [float(v.replace(",", "")) for v in DOLLAR_RE.findall(cleaned)]
    mat_cost   = nums[0] if len(nums) >= 1 else None
    labor_cost = nums[1] if len(nums) >= 2 else None
    return mat_cost, labor_cost


def _extract_description(raw: str, crew: Optional[str]) -> str:
    """
    Description = everything before the Craft@Hrs token.
    """
    craft_pos = CRAFT_RE.search(raw)
    if craft_pos:
        desc = raw[:craft_pos.start()].strip().rstrip(",.:;-").strip()
    else:
        desc = raw.strip()
    return desc[:200]


# ── Validation ────────────────────────────────────────────────────────────────

def validate_row(row: dict) -> list[str]:
    issues = []

    lc = row.get("labor_cost")
    if lc is None:
        issues.append("missing_labor_cost")
    elif lc <= 0:
        issues.append("zero_or_negative_labor_cost")
    elif lc > 10_000:
        issues.append("suspiciously_high_labor_cost")

    lh = row.get("labor_hours")
    if lh is None:
        issues.append("missing_labor_hours")
    elif lh <= 0:
        issues.append("zero_labor_hours")
    elif lh > 99:
        issues.append("suspiciously_high_labor_hours")

    unit = row.get("unit")
    if unit is None:
        issues.append("missing_unit")
    elif unit not in VALID_UNITS:
        issues.append(f"unusual_unit:{unit}")

    desc = row.get("description", "")
    if not desc:
        issues.append("empty_description")
    elif len(desc) < 2:
        issues.append("description_too_short")

    return issues


# ── Main normalize function ───────────────────────────────────────────────────

def normalize_row(raw_row: dict) -> dict:
    raw = raw_row["raw_text"]
    crew, labor_hours = _extract_craft(raw)
    unit              = _extract_unit(raw)
    mat_cost, labor_cost = _extract_costs(raw)
    description       = _extract_description(raw, crew)

    row = {
        "source_book":  SOURCE_BOOK,
        "source_year":  SOURCE_YEAR,
        "page":         raw_row["page"],
        "section":      raw_row.get("section", ""),
        "item_code":    crew or "",
        "description":  description,
        "unit":         unit,
        "labor_hours":  labor_hours,
        "labor_cost":   labor_cost,
        "raw_text":     raw,
        "issues":       "",
    }

    issues = validate_row(row)
    row["issues"] = "; ".join(issues) if issues else ""
    return row


def normalize_all(raw_rows: list[dict]) -> tuple[list[dict], list[dict]]:
    """
    Normalize all rows. Returns (clean_rows, flagged_rows).
    """
    clean   = []
    flagged = []

    for raw_row in raw_rows:
        row = normalize_row(raw_row)
        if row["issues"]:
            flagged.append(row)
        else:
            clean.append(row)

    print(f"[normalize] {len(clean):,} clean rows, {len(flagged):,} flagged rows")
    return clean, flagged

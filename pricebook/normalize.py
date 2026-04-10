"""
normalize.py
Converts raw cost rows from parse_pdf.py into structured, validated records.
Extracts: item_code, description, unit, labor_hours, labor_cost.
Flags suspicious rows into an 'issues' field.
"""

import re
from typing import Optional

SOURCE_BOOK = "National Electrical Estimator"
SOURCE_YEAR = "2025"

# Valid unit tokens (case-insensitive match)
VALID_UNITS = {"EA", "LF", "CLF", "SY", "SF", "C", "M", "HR", "LS", "PR", "SET", "BX", "MSF"}
UNIT_RE = re.compile(
    r'\b(EA|Ea|CLF|LF|lf|SY|SF|sf|C\b|M\b|HR|Hr|hr|LS|PR|pr|SET|set|BX|bx)\b'
)

# Grab all numeric tokens (including dollar-prefixed)
NUM_RE  = re.compile(r'\$?(\d{1,6}(?:\.\d{1,4})?)')

# Possible item code at start: optional letter-digit combo like "16-100" or "E1234"
ITEM_CODE_RE = re.compile(r'^([A-Z]?\d{1,2}-\d{2,4}|[A-Z]{1,3}\d{2,6})\s+')


def _extract_unit(raw: str) -> Optional[str]:
    m = UNIT_RE.search(raw)
    if m:
        return m.group(0).strip().upper()
    return None


def _extract_numbers(raw: str) -> list[float]:
    """Return all numeric values found in the line, in order."""
    return [float(v) for v in NUM_RE.findall(raw)]


def _looks_like_labor_hours(val: float) -> bool:
    """Labor hours per unit are typically between 0.01 and 99."""
    return 0.001 <= val <= 99.0


def _looks_like_labor_cost(val: float) -> bool:
    """Labor cost per unit is typically between $0.50 and $9999."""
    return 0.50 <= val <= 9999.0


def _parse_columns(raw: str, nums: list[float], unit: Optional[str]) -> dict:
    """
    The Craftsman NEE column order for a cost row is typically:
      [optional item_code]  description  unit  labor_hours  mat_cost  labor_cost  installed_cost

    Strategy:
      - We want labor_hours (usually the smallest number, < 20) and labor_cost.
      - If 4+ numbers: typically [man-hours, mat, labor, installed] — take index 0 and 2.
      - If 3 numbers:  [man-hours, labor, installed] — take index 0 and 1.
      - If 2 numbers:  [man-hours or mat, labor] — take index 0 and 1 with flag.
      - labor_hours is the one that looks < 20; labor_cost is the bigger companion.
    """
    labor_hours = None
    labor_cost  = None

    if len(nums) >= 4:
        # Standard NEE layout: man_hrs, mat, labor, installed
        labor_hours = nums[0] if _looks_like_labor_hours(nums[0]) else None
        labor_cost  = nums[2] if _looks_like_labor_cost(nums[2]) else None
    elif len(nums) == 3:
        labor_hours = nums[0] if _looks_like_labor_hours(nums[0]) else None
        labor_cost  = nums[1] if _looks_like_labor_cost(nums[1]) else None
    elif len(nums) == 2:
        if _looks_like_labor_hours(nums[0]):
            labor_hours = nums[0]
            labor_cost  = nums[1] if _looks_like_labor_cost(nums[1]) else None
        elif _looks_like_labor_cost(nums[0]):
            labor_cost = nums[0]

    return {"labor_hours": labor_hours, "labor_cost": labor_cost}


def _extract_description_and_code(raw: str, unit: Optional[str]) -> tuple[str, str]:
    """
    Pull item_code (if present at start) and description (text before the unit).
    """
    item_code = ""
    text = raw.strip()

    # Strip item code from front
    m = ITEM_CODE_RE.match(text)
    if m:
        item_code = m.group(1)
        text = text[m.end():]

    # Description = everything before the first unit or number cluster
    if unit:
        unit_pos = text.upper().find(unit)
        if unit_pos > 0:
            description = text[:unit_pos].strip().rstrip(",.:;-").strip()
        else:
            description = text.split()[0] if text.split() else text
    else:
        # No unit found — description is text up to first number
        m2 = NUM_RE.search(text)
        description = text[:m2.start()].strip() if m2 else text.strip()

    return description[:200], item_code  # cap description at 200 chars


def validate_row(row: dict) -> list[str]:
    """Return list of issue strings. Empty list = clean row."""
    issues = []

    if row.get("labor_cost") is None:
        issues.append("missing_labor_cost")
    elif not isinstance(row["labor_cost"], (int, float)):
        issues.append("non_numeric_labor_cost")
    elif row["labor_cost"] <= 0:
        issues.append("zero_or_negative_labor_cost")
    elif row["labor_cost"] > 5000:
        issues.append("suspiciously_high_labor_cost")

    if row.get("labor_hours") is not None:
        if not isinstance(row["labor_hours"], (int, float)):
            issues.append("non_numeric_labor_hours")
        elif row["labor_hours"] > 99:
            issues.append("suspiciously_high_labor_hours")

    if row.get("unit") is None:
        issues.append("missing_unit")
    elif row["unit"] not in VALID_UNITS:
        issues.append(f"unusual_unit:{row['unit']}")

    if not row.get("description"):
        issues.append("empty_description")
    elif len(row["description"]) < 3:
        issues.append("description_too_short")

    return issues


def normalize_row(raw_row: dict) -> dict:
    """Convert a raw row dict into a normalized record."""
    raw = raw_row["raw_text"]
    nums = _extract_numbers(raw)
    unit = _extract_unit(raw)
    description, item_code = _extract_description_and_code(raw, unit)
    parsed = _parse_columns(raw, nums, unit)

    row = {
        "source_book":  SOURCE_BOOK,
        "source_year":  SOURCE_YEAR,
        "page":         raw_row["page"],
        "section":      raw_row.get("section", ""),
        "item_code":    item_code,
        "description":  description,
        "unit":         unit,
        "labor_hours":  parsed["labor_hours"],
        "labor_cost":   parsed["labor_cost"],
        "raw_text":     raw,
        "issues":       "",
    }

    issues = validate_row(row)
    row["issues"] = "; ".join(issues) if issues else ""
    return row


def normalize_all(raw_rows: list[dict]) -> tuple[list[dict], list[dict]]:
    """
    Normalize all raw rows.
    Returns (clean_rows, flagged_rows).
    clean_rows  = rows with no issues
    flagged_rows = rows with at least one issue
    """
    clean   = []
    flagged = []

    for raw_row in raw_rows:
        row = normalize_row(raw_row)
        if row["issues"]:
            flagged.append(row)
        else:
            clean.append(row)

    print(f"[normalize] {len(clean)} clean rows, {len(flagged)} flagged rows")
    return clean, flagged

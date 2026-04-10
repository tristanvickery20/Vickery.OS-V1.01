"""
search.py
Search API for the labor_items SQLite database.
Can be used standalone or imported by other modules.
"""

import sqlite3
from pathlib import Path
from database import open_db


def search_labor_items(
    db_path: str,
    keyword: str,
    section: str   = None,
    unit: str      = None,
    max_hours: float = None,
    min_hours: float = None,
    clean_only: bool = True,
    limit: int     = 50,
) -> list[dict]:
    """
    Search labor_items by keyword (matches description, section, raw_text).

    Args:
        db_path:    Path to pricebook.db
        keyword:    Text to search (case-insensitive)
        section:    Optional: filter to this section name (partial match)
        unit:       Optional: filter by unit (EA, LF, etc.)
        max_hours:  Optional: filter rows with labor_hours <= max_hours
        min_hours:  Optional: filter rows with labor_hours >= min_hours
        clean_only: If True, exclude rows with issues (default True)
        limit:      Max rows to return (default 50)

    Returns:
        List of dicts, each row is a labor_items record.
    """
    conn  = open_db(db_path)
    where = []
    args  = []

    if keyword:
        where.append(
            "(LOWER(description) LIKE ? OR LOWER(section) LIKE ? OR LOWER(raw_text) LIKE ?)"
        )
        kw = f"%{keyword.lower()}%"
        args += [kw, kw, kw]

    if section:
        where.append("LOWER(section) LIKE ?")
        args.append(f"%{section.lower()}%")

    if unit:
        where.append("UPPER(unit) = ?")
        args.append(unit.upper())

    if max_hours is not None:
        where.append("labor_hours <= ?")
        args.append(max_hours)

    if min_hours is not None:
        where.append("labor_hours >= ?")
        args.append(min_hours)

    if clean_only:
        where.append("(issues IS NULL OR issues = '')")

    sql = "SELECT * FROM labor_items"
    if where:
        sql += " WHERE " + " AND ".join(where)
    sql += f" ORDER BY page, id LIMIT {int(limit)}"

    cur  = conn.execute(sql, args)
    rows = [dict(r) for r in cur.fetchall()]
    conn.close()
    return rows


def get_by_section(db_path: str, section: str, limit: int = 100) -> list[dict]:
    """Return all clean rows for a given section (exact or partial match)."""
    return search_labor_items(db_path, keyword="", section=section, limit=limit)


def compare_to_estimator(
    db_path:        str,
    service_name:   str,
    our_labor_hours: float,
) -> dict:
    """
    Find the closest NEE match for a service and compare labor hours.
    Returns a comparison dict.
    """
    results = search_labor_items(db_path, keyword=service_name, limit=10)
    if not results:
        return {"match": None, "our_hours": our_labor_hours, "note": "no_match_found"}

    best = results[0]
    nee_hours = best.get("labor_hours")
    diff = None
    pct  = None
    if nee_hours and our_labor_hours:
        diff = round(our_labor_hours - nee_hours, 3)
        pct  = round((diff / nee_hours) * 100, 1) if nee_hours else None

    return {
        "service_name":   service_name,
        "our_hours":      our_labor_hours,
        "nee_hours":      nee_hours,
        "nee_description": best.get("description"),
        "nee_section":    best.get("section"),
        "nee_page":       best.get("page"),
        "diff_hours":     diff,
        "diff_pct":       pct,
        "verdict": (
            "on_target"    if diff is None else
            "over_estimate" if diff > 0.1  else
            "under_estimate" if diff < -0.1 else
            "on_target"
        ),
        "candidates": results[:5],
    }


if __name__ == "__main__":
    import sys, json

    db = sys.argv[1] if len(sys.argv) > 1 else "output/pricebook.db"
    kw = sys.argv[2] if len(sys.argv) > 2 else "ceiling fan"

    print(f"\nSearching '{kw}' in {db}...\n")
    rows = search_labor_items(db, kw, limit=20)
    print(f"Found {len(rows)} results:\n")
    for r in rows:
        hrs  = f"{r['labor_hours']:.3f} hrs" if r["labor_hours"] else "hrs=?"
        cost = f"${r['labor_cost']:.2f}"     if r["labor_cost"]  else "cost=?"
        print(f"  p{r['page']:>3}  [{r['unit'] or '?':>4}]  {hrs}  {cost}  {r['description'][:60]}")

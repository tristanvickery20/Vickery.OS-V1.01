"""
main.py
Orchestrates the full PDF → CSV → JSON → SQLite pipeline.

Usage:
    python pricebook/main.py
    python pricebook/main.py /path/to/estimator.pdf

Input:  input/national_electrical_estimator.pdf  (or path from arg)
Output: output/electrical_labor_raw.csv
        output/electrical_labor_clean.json
        output/review_needed.csv
        output/pricebook.db
"""

import sys
import csv
import json
import sqlite3
from pathlib import Path

# ── Path setup so imports work whether run from root or pricebook/ ──────────
ROOT = Path(__file__).parent
sys.path.insert(0, str(ROOT))

from parse_pdf  import extract_pages, extract_cost_rows
from normalize  import normalize_all
from database   import open_db, insert_rows, get_stats, clear_table

# ── I/O paths ───────────────────────────────────────────────────────────────
DEFAULT_PDF = Path("input/national_electrical_estimator.pdf")
OUTPUT_DIR  = Path("output")

RAW_CSV_PATH   = OUTPUT_DIR / "electrical_labor_raw.csv"
CLEAN_JSON_PATH = OUTPUT_DIR / "electrical_labor_clean.json"
REVIEW_CSV_PATH = OUTPUT_DIR / "review_needed.csv"
DB_PATH         = OUTPUT_DIR / "pricebook.db"

ALL_COLUMNS = [
    "source_book", "source_year", "page", "section",
    "item_code", "description", "unit", "labor_hours",
    "labor_cost", "raw_text", "issues",
]


def write_csv(path: Path, rows: list[dict], columns: list[str]) -> None:
    with open(path, "w", newline="", encoding="utf-8") as f:
        writer = csv.DictWriter(f, fieldnames=columns, extrasaction="ignore")
        writer.writeheader()
        writer.writerows(rows)
    print(f"[main] Wrote {len(rows):,} rows → {path}")


def write_json(path: Path, rows: list[dict]) -> None:
    with open(path, "w", encoding="utf-8") as f:
        json.dump(rows, f, indent=2, ensure_ascii=False)
    print(f"[main] Wrote {len(rows):,} rows → {path}")


def run(pdf_path: Path) -> None:
    if not pdf_path.exists():
        print(f"\n[main] ERROR: PDF not found at '{pdf_path}'")
        print(       "       Place your PDF at input/national_electrical_estimator.pdf")
        print(       "       or pass the path as an argument:  python pricebook/main.py /path/to/file.pdf\n")
        sys.exit(1)

    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    print(f"\n[main] === National Electrical Estimator Parser ===")
    print(f"[main] PDF: {pdf_path}")
    print(f"[main] Output: {OUTPUT_DIR}/\n")

    # ── Step 1: Parse PDF ──────────────────────────────────────────────────
    pages = extract_pages(str(pdf_path))
    raw_rows = extract_cost_rows(pages)

    # ── Step 2: Write raw CSV (every candidate row before normalization) ───
    raw_for_csv = [{"page": r["page"], "section": r["section"], "raw_text": r["raw_text"]} for r in raw_rows]
    write_csv(RAW_CSV_PATH, raw_for_csv, ["page", "section", "raw_text"])

    # ── Step 3: Normalize + validate ─────────────────────────────────────
    clean_rows, flagged_rows = normalize_all(raw_rows)

    # ── Step 4: Write clean JSON ──────────────────────────────────────────
    write_json(CLEAN_JSON_PATH, clean_rows)

    # ── Step 5: Write review CSV (flagged rows) ───────────────────────────
    write_csv(REVIEW_CSV_PATH, flagged_rows, ALL_COLUMNS)

    # ── Step 6: Write SQLite DB ───────────────────────────────────────────
    all_rows = clean_rows + flagged_rows   # store everything; issues column marks flags
    conn = open_db(str(DB_PATH))
    clear_table(conn)
    inserted = insert_rows(conn, all_rows)

    stats = get_stats(conn)
    conn.close()

    # ── Summary ───────────────────────────────────────────────────────────
    print(f"\n[main] ── Summary ──────────────────────────────────")
    print(f"[main]   PDF pages processed : {len(pages):,}")
    print(f"[main]   Candidate rows found: {len(raw_rows):,}")
    print(f"[main]   Clean rows          : {stats['clean_rows']:,}")
    print(f"[main]   Flagged / review    : {stats['flagged_rows']:,}")
    print(f"[main]   DB rows inserted    : {inserted:,}")
    print(f"[main]   Page range          : {stats['page_range']['min']} – {stats['page_range']['max']}")
    print(f"\n[main]   Top sections:")
    for s in stats["top_sections"]:
        print(f"[main]     {s['count']:>5}  {s['section']}")
    print(f"\n[main] ── Output files ──────────────────────────────")
    print(f"[main]   {RAW_CSV_PATH}")
    print(f"[main]   {CLEAN_JSON_PATH}")
    print(f"[main]   {REVIEW_CSV_PATH}")
    print(f"[main]   {DB_PATH}")
    print(f"\n[main] Done.\n")


if __name__ == "__main__":
    pdf = Path(sys.argv[1]) if len(sys.argv) > 1 else DEFAULT_PDF
    run(pdf)

"""
database.py
Creates and manages the SQLite pricebook database.
Table: labor_items
"""

import sqlite3
from pathlib import Path

DB_SCHEMA = """
CREATE TABLE IF NOT EXISTS labor_items (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    source_book TEXT,
    source_year TEXT,
    page        INTEGER,
    section     TEXT,
    item_code   TEXT,
    description TEXT,
    unit        TEXT,
    labor_hours REAL,
    labor_cost  REAL,
    raw_text    TEXT,
    issues      TEXT
);

CREATE INDEX IF NOT EXISTS idx_labor_description ON labor_items(description);
CREATE INDEX IF NOT EXISTS idx_labor_section     ON labor_items(section);
CREATE INDEX IF NOT EXISTS idx_labor_page        ON labor_items(page);
CREATE INDEX IF NOT EXISTS idx_labor_issues      ON labor_items(issues);
"""

COLUMNS = [
    "source_book", "source_year", "page", "section",
    "item_code", "description", "unit", "labor_hours",
    "labor_cost", "raw_text", "issues",
]


def open_db(db_path: str) -> sqlite3.Connection:
    conn = sqlite3.connect(db_path)
    conn.row_factory = sqlite3.Row
    conn.executescript(DB_SCHEMA)
    conn.commit()
    return conn


def insert_rows(conn: sqlite3.Connection, rows: list[dict]) -> int:
    if not rows:
        return 0

    placeholders = ", ".join(["?" for _ in COLUMNS])
    col_list = ", ".join(COLUMNS)
    sql = f"INSERT INTO labor_items ({col_list}) VALUES ({placeholders})"

    data = [
        tuple(row.get(col) for col in COLUMNS)
        for row in rows
    ]

    conn.executemany(sql, data)
    conn.commit()
    return len(data)


def get_stats(conn: sqlite3.Connection) -> dict:
    cur = conn.execute("SELECT COUNT(*) FROM labor_items")
    total = cur.fetchone()[0]

    cur = conn.execute("SELECT COUNT(*) FROM labor_items WHERE issues != ''")
    flagged = cur.fetchone()[0]

    cur = conn.execute("SELECT MIN(page), MAX(page) FROM labor_items")
    page_range = cur.fetchone()

    cur = conn.execute(
        "SELECT section, COUNT(*) as cnt FROM labor_items GROUP BY section ORDER BY cnt DESC LIMIT 10"
    )
    top_sections = [{"section": r[0], "count": r[1]} for r in cur.fetchall()]

    return {
        "total_rows":    total,
        "flagged_rows":  flagged,
        "clean_rows":    total - flagged,
        "page_range":    {"min": page_range[0], "max": page_range[1]},
        "top_sections":  top_sections,
    }


def clear_table(conn: sqlite3.Connection) -> None:
    conn.execute("DELETE FROM labor_items")
    conn.commit()
    print("[database] Cleared existing labor_items rows")

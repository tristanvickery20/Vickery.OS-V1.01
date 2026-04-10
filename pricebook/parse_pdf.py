"""
parse_pdf.py
Extracts labor rows from the National Electrical Estimator PDF.

NEE row format (per page header):
  Description  Craft@Hrs  Unit  Material Cost  Labor Cost  Installed Cost

Example row:
  1/2" L1@0.05 Ea .99 2.33 3.32

The Craft@Hrs field (e.g. L1@0.05) encodes:
  - Crew type (L1 = 1 journeyman, L2 = 2 journeymen, etc.)
  - Labor hours per unit (the number after @)
"""

import re
import pdfplumber

# ── Core pattern: matches the Craft@Hrs field ────────────────────────────────
# L1@0.05 | L2@1.00 | L3@0.25 etc.
CRAFT_RE = re.compile(r'\b(L\d+|S\d+|C\d+|M\d+|E\d+)@(\d+\.?\d*)\b')

# Unit comes right after the craft code
UNIT_RE = re.compile(
    r'\b(Ea|EA|LF|lf|CLF|KLF|klf|SY|SF|sf|C\b|M\b|HR|Hr|hr|LS|ls|PR|pr|SET|set|BX|MSF|MFBM|Sq|Ton|Gal|Roll)\b'
)

# Dollar amount (with optional comma separator)
DOLLAR_RE = re.compile(r'(\d{1,6}(?:,\d{3})*(?:\.\d{1,2})?)')


def _is_cost_row(line: str) -> bool:
    """A line is a cost row iff it contains a Craft@Hrs code."""
    return bool(CRAFT_RE.search(line))


def _detect_section(line: str, current: str) -> str:
    """
    Section headers in NEE are short lines in title/sentence case with no
    Craft@Hrs codes and no dollar amounts.
    """
    s = line.strip()
    if not s or _is_cost_row(s):
        return current
    # Skip the repeated column-header line
    if s.lower().startswith("material") or s.lower().startswith("craft"):
        return current
    # Reasonable header: 4-80 chars, no numbers except maybe AWG sizes
    has_dollars = bool(re.search(r'\d+\.\d{2}', s))
    if has_dollars:
        return current
    if 4 <= len(s) <= 80:
        return s
    return current


def extract_pages(pdf_path: str) -> list[dict]:
    """
    Open the PDF and return per-page dicts:
      { page: int, section: str, lines: [str], raw_page_text: str }
    """
    pages_out = []
    current_section = "UNKNOWN"

    with pdfplumber.open(pdf_path) as pdf:
        total = len(pdf.pages)
        print(f"[parse_pdf] Opened — {total} pages")

        for page_num, page in enumerate(pdf.pages, start=1):
            text = page.extract_text() or ""
            raw_lines = text.split("\n")

            # Detect section from non-cost lines
            for raw_line in raw_lines:
                current_section = _detect_section(raw_line, current_section)

            pages_out.append({
                "page":           page_num,
                "section":        current_section,
                "lines":          [l.strip() for l in raw_lines],
                "raw_page_text":  text,
            })

            if page_num % 100 == 0:
                print(f"[parse_pdf]   ... page {page_num}/{total}")

    print(f"[parse_pdf] Done — {len(pages_out)} pages read")
    return pages_out


def _merge_wrapped(lines: list[str]) -> list[str]:
    """
    Descriptions sometimes wrap. If a line has no craft code and the
    previous line is a cost row candidate, prepend to next cost row.
    Simple approach: collect non-cost lines until a cost row appears.
    """
    merged = []
    pending_desc = ""
    for line in lines:
        if not line:
            continue
        if _is_cost_row(line):
            full_line = (pending_desc + " " + line).strip() if pending_desc else line
            merged.append(full_line)
            pending_desc = ""
        else:
            # Might be description prefix or section header — keep short ones
            if len(line) < 100 and not line.lower().startswith("material"):
                pending_desc = line
            else:
                pending_desc = ""
    return merged


def extract_cost_rows(pages: list[dict]) -> list[dict]:
    """
    Pull every NEE cost row from all pages.
    Returns list of { page, section, raw_text } dicts.
    """
    rows = []
    for page_data in pages:
        page_num = page_data["page"]
        section  = page_data["section"]
        lines    = page_data["lines"]

        merged = _merge_wrapped(lines)
        for line in merged:
            if _is_cost_row(line):
                rows.append({
                    "page":     page_num,
                    "section":  section,
                    "raw_text": line,
                })

    print(f"[parse_pdf] {len(rows):,} cost rows identified")
    return rows

"""
parse_pdf.py
Extracts raw text and table-like rows from the National Electrical Estimator PDF.
Uses pdfplumber. Preserves page number and raw line text.
"""

import re
import pdfplumber

# Units commonly found in electrical estimating books
UNIT_PATTERN = re.compile(
    r'\b(EA|Ea|ea|LF|lf|CLF|SY|SF|C|M|HR|Hr|hr|LS|LS|PR|pr|SET|set|BX|bx)\b'
)

# A numeric value: integer or decimal, possibly preceded by a dollar sign
NUM_PATTERN = re.compile(r'\$?(\d{1,6}(?:\.\d{1,4})?)')

# Line is likely a cost row if it has a unit AND at least 2 numeric tokens
def is_cost_row(line: str) -> bool:
    has_unit = bool(UNIT_PATTERN.search(line))
    nums = NUM_PATTERN.findall(line)
    return has_unit and len(nums) >= 2


def detect_section(line: str, current_section: str) -> str:
    """
    Heuristically detect chapter/section headers.
    Headers are typically ALL CAPS or Title Case with no numbers.
    """
    stripped = line.strip()
    if not stripped:
        return current_section
    # All-caps line with no digits → likely a section header
    if stripped.isupper() and not any(c.isdigit() for c in stripped) and len(stripped) > 3:
        return stripped
    # Title-case line between 5–60 chars with no digits → possible section
    if stripped.istitle() and not any(c.isdigit() for c in stripped) and 5 < len(stripped) < 60:
        return stripped
    return current_section


def merge_wrapped_lines(lines: list[str]) -> list[str]:
    """
    Join continuation lines (no unit, no numbers at start) back onto the
    previous cost row so descriptions aren't split across lines.
    """
    merged = []
    for line in lines:
        stripped = line.strip()
        if not stripped:
            merged.append("")
            continue
        # Continuation: short line, no numbers, no unit — likely wrapped description
        is_continuation = (
            merged
            and not is_cost_row(stripped)
            and not stripped.isupper()
            and not stripped.istitle()
            and len(stripped) < 60
            and not NUM_PATTERN.search(stripped)
        )
        if is_continuation and merged[-1]:
            merged[-1] = merged[-1].rstrip() + " " + stripped
        else:
            merged.append(stripped)
    return merged


def extract_pages(pdf_path: str) -> list[dict]:
    """
    Read every page of the PDF.
    Returns list of { page, section, lines: [str] }.
    """
    pages_out = []
    current_section = "UNKNOWN"

    with pdfplumber.open(pdf_path) as pdf:
        total = len(pdf.pages)
        print(f"[parse_pdf] Opened PDF — {total} pages")

        for page_num, page in enumerate(pdf.pages, start=1):
            text = page.extract_text() or ""
            raw_lines = text.split("\n")

            # Update section from any headers found on this page
            for raw_line in raw_lines:
                current_section = detect_section(raw_line, current_section)

            merged = merge_wrapped_lines(raw_lines)

            pages_out.append({
                "page": page_num,
                "section": current_section,
                "lines": merged,
                "raw_page_text": text,
            })

            if page_num % 50 == 0:
                print(f"[parse_pdf]  ... page {page_num}/{total}")

    print(f"[parse_pdf] Done — {len(pages_out)} pages extracted")
    return pages_out


def extract_cost_rows(pages: list[dict]) -> list[dict]:
    """
    Walk each page's lines and pull rows that look like labor/cost data.
    Returns list of raw row dicts ready for normalize.py.
    """
    rows = []
    for page_data in pages:
        page_num = page_data["page"]
        section  = page_data["section"]
        lines    = page_data["lines"]

        for line in lines:
            if not line.strip():
                continue
            if is_cost_row(line):
                rows.append({
                    "page":     page_num,
                    "section":  section,
                    "raw_text": line.strip(),
                })

    print(f"[parse_pdf] {len(rows)} candidate cost rows identified")
    return rows

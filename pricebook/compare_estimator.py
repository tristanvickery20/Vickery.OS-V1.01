"""
compare_estimator.py
Cross-references Vickery Electric estimator labor hours against NEE book data.
Run after main.py has populated pricebook.db.

Usage:
    python pricebook/compare_estimator.py
    python pricebook/compare_estimator.py output/pricebook.db
"""

import sys
import json
from pathlib import Path

ROOT = Path(__file__).parent
sys.path.insert(0, str(ROOT))

from search import search_labor_items, compare_to_estimator

DB_DEFAULT = Path("output/pricebook.db")

# ── Your current estimator assemblies + labor hours ────────────────────────
# Edit these to match your actual assembly blended_labor_hours values.
# Format: (service_name, search_keywords, our_labor_hours, unit)

# ── NOTE on NEE hours ────────────────────────────────────────────────────────
# NEE device-only entries (outlet, switch, GFCI) assume box and wire already
# in place — "trim-out" labor only. Your service-call hours include rough-in,
# wire run, and box work, so your numbers will legitimately be higher.
# Panel and service-entrance entries are panel unit only, not full service upgrade.
# ────────────────────────────────────────────────────────────────────────────

OUR_ASSEMBLIES = [
    # (display_name,                 nee_search_keywords,       our_hrs,  unit)
    # ── Lighting ──────────────────────────────────────────────────────────────
    ("Recessed Light Install",       "recessed light fixtures",  1.5,    "EA"),
    ("Ceiling Fan Install",          "exhaust fans",             2.0,    "EA"),  # no ceiling fan entry; exhaust fan is closest
    ("Light Fixture Install",        "LED panel lights",         1.2,    "EA"),
    ("Outdoor / Security Light",     "outdoor light",            2.5,    "EA"),
    ("Motion Security Light",        "motion",                   1.5,    "EA"),
    ("Ballast Replacement",          "ballast",                  0.5,    "EA"),
    ("Exit / Emergency Light",       "emergency driver",         1.0,    "EA"),
    # ── Devices ───────────────────────────────────────────────────────────────
    ("Dimmer Switch",                "dimmer switches",          0.75,   "EA"),
    ("Standard Switch",              "1 gang single switch",     0.75,   "EA"),
    ("Outlet Install",               "1 gang duplex outlet",     0.75,   "EA"),
    ("GFCI Outlet",                  "GFCI",                     0.75,   "EA"),
    # ── Service / Panel ───────────────────────────────────────────────────────
    ("Panel Upgrade 200A",           "main lug",                 12.0,   "EA"),
    ("Subpanel Install",             "loadcenters main lugs",    8.0,    "EA"),
    ("Whole-Home Surge Protector",   "surge suppressor",         1.0,    "EA"),
    # ── Specialty Circuits ────────────────────────────────────────────────────
    ("EV Charger (240V circuit)",    "electric vehicle",         6.0,    "EA"),
    ("Hot Tub / Spa Circuit",        "hot tub",                  6.0,    "EA"),
    # ── Safety ────────────────────────────────────────────────────────────────
    ("Smoke / CO Detector",          "smoke detectors",          0.75,   "EA"),
    ("Commercial Smoke Detector",    "120 volt smoke",           0.75,   "EA"),
]


def fmt_hours(h):
    return f"{h:.3f}" if h is not None else "  N/A "


def run(db_path: Path) -> None:
    if not db_path.exists():
        print(f"\n[compare] ERROR: Database not found at '{db_path}'")
        print(  "          Run main.py first to build the database.\n")
        sys.exit(1)

    print(f"\n[compare] === Estimator vs NEE 2025 — Labor Hours Comparison ===")
    print(f"[compare] Database: {db_path}\n")

    header = f"{'Service':<36} {'Ours':>7} {'NEE':>7} {'Diff':>7} {'%':>6}  Verdict"
    print(header)
    print("─" * len(header))

    over  = []
    under = []
    miss  = []

    for (name, kw, our_hrs, unit) in OUR_ASSEMBLIES:
        result = compare_to_estimator(str(db_path), kw, our_hrs)
        nee_hrs = result.get("nee_hours")
        diff    = result.get("diff_hours")
        pct     = result.get("diff_pct")
        verdict = result.get("verdict", "no_match")

        if nee_hrs is None:
            line = f"{name:<36} {fmt_hours(our_hrs):>7}   N/A    N/A     N/A   NO MATCH"
            miss.append(name)
        else:
            verdict_str = {
                "on_target":     "✓ on target",
                "over_estimate": "▲ over",
                "under_estimate":"▼ under",
            }.get(verdict, verdict)
            line = (
                f"{name:<36} {fmt_hours(our_hrs):>7} {fmt_hours(nee_hrs):>7}"
                f" {diff:>+7.3f} {pct:>5.1f}%  {verdict_str}"
            )
            if verdict == "over_estimate":  over.append((name, diff, pct))
            if verdict == "under_estimate": under.append((name, diff, pct))

        print(line)

    print("\n")
    if over:
        print(f"  OVER-estimated ({len(over)})  — you're billing more hours than NEE suggests:")
        for n, d, p in over:
            print(f"    {n}: +{d:.3f} hrs ({p:+.1f}%)")
    if under:
        print(f"\n  UNDER-estimated ({len(under)}) — NEE suggests more hours than you're quoting:")
        for n, d, p in under:
            print(f"    {n}: {d:.3f} hrs ({p:+.1f}%)")
    if miss:
        print(f"\n  NO MATCH ({len(miss)}) — check keyword or PDF coverage:")
        for n in miss:
            print(f"    {n}")

    print(f"\n[compare] Done. Review the Diff column — positive = we quote more hours than NEE.\n")


if __name__ == "__main__":
    db = Path(sys.argv[1]) if len(sys.argv) > 1 else DB_DEFAULT
    run(db)

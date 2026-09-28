#!/usr/bin/env python3
"""
Build the Years 1–2 ("early") semester board for a program from TAU's official
program structure, next to the published Years 3–4 board.

Everything comes from data — no course ids, names or hours live in this file:
  * mandatory courses per semester  <- tochniot ydtochnit (the program page):
        a section titled for ONE year ("שנה א") is that year's mandatory list,
        its "סמסטר א/ב" sub-sections give the semester; courses listed under
        both halves of a year may be placed in either.
  * which requirement categories belong in the window, and their course pool
    (with offerings, syllabi, grades)  <- the published board's metadata: a
    category is kept unless the official program places one of its courses
    ONLY in years outside the window (e.g. core courses, "שנים ג'+ד'").

Output: data/boards/<base>_years_<a>_<b>_<year>.json — the id convention
web/lib/planner/semester-window.ts#windowBoardId resolves.

Usage:
    python scripts/build_early_years_board.py                       # mechanical_engineering_2027, years 1–2
    python scripts/build_early_years_board.py --program X_2027 --start-year 1 --shana 2026 --tcid 8715
"""

from __future__ import annotations

import argparse
import json
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

from app.analysis.board_audit import compute_board_hash  # noqa: E402
from app.analysis.program_requirements import validate_program_plan  # noqa: E402
from app.analysis.semester_board import build_semester_board  # noqa: E402
from app.scraping.tau_program_scraper import fetch_program_data  # noqa: E402
from scripts.refresh_course_data import ACADEMIC_YEAR, PROGRAM_TCID  # noqa: E402

BOARDS_DIR = ROOT / "data" / "boards"
HEBREW_NUMERALS = "אבגדהוזחט"  # א=1, ב=2, …
_YEARS_TITLE = re.compile(r"שנ(?:ה|ים)\s+([א-ט'׳\s+]+)")
_SEMESTER_TITLE = re.compile(r"סמסטר\s+([אב])")


def title_years(title: str) -> list[int]:
    """'שנה א' → [1]; "שנים ג'+ד' …" → [3, 4]; anything else → []."""
    m = _YEARS_TITLE.search(title or "")
    if not m:
        return []
    return [HEBREW_NUMERALS.index(ch) + 1 for ch in m.group(1) if ch in HEBREW_NUMERALS]


def title_half(title: str) -> str | None:
    m = _SEMESTER_TITLE.search(title or "")
    return {"א": "a", "ב": "b"}[m.group(1)] if m else None


def is_listed(kurs: dict) -> bool:
    return (kurs.get("mevutal") or "0") != "1" and (kurs.get("hidekurs") or "0") != "1"


def as_number(value) -> float | None:
    try:
        return float(value)
    except (TypeError, ValueError):
        return None


def read_official(tcid: str, shana: int) -> list[dict]:
    cache = ROOT / "data" / "raw_html" / f"tau_program_{tcid}_{shana}.json"
    body = fetch_program_data(tcid, str(shana), cache_path=cache)
    return body[0].get("rama") or [] if body else []


def official_years_by_course(sections: list[dict]) -> dict[str, set[int]]:
    """course id → every program year the official page lists it under."""
    years: dict[str, set[int]] = {}
    for section in sections:
        section_years = title_years(section.get("teurrama", ""))
        for sub in [section, *(section.get("rama") or [])]:
            for kurs in sub.get("kurs") or []:
                if is_listed(kurs) and section_years:
                    years.setdefault(kurs["kursshow"], set()).update(section_years)
    return years


def mandatory_specs(sections: list[dict], window_years: list[int]) -> list[dict]:
    """Mandatory courses of the window's single-year sections, with their allowed semesters."""
    by_id: dict[str, dict] = {}
    for section in sections:
        years = title_years(section.get("teurrama", ""))
        if len(years) != 1 or years[0] not in window_years:
            continue
        year = years[0]
        for sub in section.get("rama") or []:
            half = title_half(sub.get("teurrama", ""))
            halves = [half] if half else ["a", "b"]
            for kurs in sub.get("kurs") or []:
                if not is_listed(kurs):
                    continue
                spec = by_id.setdefault(kurs["kursshow"], {
                    "course_id": kurs["kursshow"],
                    "name_he": " ".join((kurs.get("teurkurs") or "").split()),
                    "weekly_hours": as_number(kurs.get("shaotuni")),
                    "credits": as_number(kurs.get("mishkal")),
                    "allowed_semesters": [],
                    "source_note": "tau_program_official",
                })
                for h in halves:
                    sem = f"year_{year}_semester_{h}"
                    if sem not in spec["allowed_semesters"]:
                        spec["allowed_semesters"].append(sem)
    for spec in by_id.values():
        spec["recommended_semester"] = spec["allowed_semesters"][0]
    return list(by_id.values())


def window_categories(late_block: dict, official_years: dict[str, set[int]], window_years: list[int]) -> list[dict]:
    """
    Keep a category unless the official program confines one of its courses to other years.
    Kept categories are OPTIONAL here (min 0): their degree minimum is tracked by the program's
    own board, and TAU's Years 1–2 semesters are already near the load cap, so the window lets
    the student (or the co-pilot) choose where they fit instead of forcing the whole minimum.
    """
    kept = []
    for cat in late_block.get("categories", []):
        outside = any(
            official_years.get(cid) and not official_years[cid] & set(window_years)
            for cid in cat.get("course_ids", [])
        )
        if not outside:
            kept.append({**cat, "min_courses": 0})
    return kept


def remap_repository_course(course: dict, semester_ids: list[str]) -> dict:
    """The same catalog record, allowed in the window's semesters matching its offering (A/B)."""
    offered = {s.lower() for s in course.get("offered_semesters") or []}
    allowed = [s for s in semester_ids if s[-1] in offered] or list(semester_ids)
    return {**course, "effective_allowed_semesters": allowed}


def build(program_id: str, start_year: int, tcid: str, shana: int) -> Path:
    base, year = re.fullmatch(r"(.+)_(\d{4})", program_id).groups()
    late = json.loads((BOARDS_DIR / f"{program_id}.json").read_text(encoding="utf-8"))
    late_meta = late["metadata"]
    late_block = late_meta["program_requirements_categories"]

    window_years = [start_year, start_year + 1]
    sections = read_official(tcid, shana)
    specs = mandatory_specs(sections, window_years)
    if not specs:
        raise SystemExit(f"No official mandatory courses for years {window_years} (tcid={tcid}, shana={shana}).")
    categories = window_categories(late_block, official_years_by_course(sections), window_years)
    kept_ids = {c["category_id"] for c in categories}
    repository = [c for c in late_meta.get("program_repository_courses", []) if c.get("category_id") in kept_ids]

    # The window's required hours are its own mandatory load (its categories are optional).
    mandatory_hours = sum(s["weekly_hours"] or 0 for s in specs)

    program = {
        "program_id": base,
        "program_name_he": late_block.get("program_name_he"),
        "total_required_hours": round(mandatory_hours, 1),
        "ui": {"other_category_label": late_block.get("other_category_label")},
        "requirements": {
            "mandatory_courses": {"courses": specs, "course_ids": [s["course_id"] for s in specs]},
            "elective_categories": categories,
            # Core-course minimum applies only when the window keeps core categories.
            "core_categories": [c for c in categories if c.get("is_core")],
            "core_courses_total_min": late_block.get("core_courses_total_min") if any(c.get("is_core") for c in categories) else 0,
        },
    }
    board = build_semester_board(plan={"selected_courses": []}, program=program, start_year=start_year)

    # Official program facts win over the local DB for names, hours and credits.
    by_id = {s["course_id"]: s for s in specs}
    for semester in board["semesters"]:
        for course in semester["courses"]:
            spec = by_id.get(course["course_id"])
            if spec:
                course.update({k: spec[k] for k in ("name_he", "weekly_hours", "credits")})
                course["weekly_hours_source"] = f"tau_program_{shana}"
                course["official_data_year"] = shana
        semester["total_weekly_hours"] = round(sum(c.get("weekly_hours") or 0 for c in semester["courses"]), 1)

    board["metadata"]["program_requirements_validation"] = validate_program_plan(board, program, [])

    semester_ids = [s["semester_id"] for s in board["semesters"]]
    board["metadata"]["program_repository_courses"] = [remap_repository_course(c, semester_ids) for c in repository]
    board["metadata"]["window_of_program_id"] = program_id
    board["metadata"]["board_data_version"] = compute_board_hash(board)

    out = BOARDS_DIR / f"{base}_years_{window_years[0]}_{window_years[1]}_{year}.json"
    out.write_text(json.dumps(board, ensure_ascii=False, indent=2), encoding="utf-8")
    return out


def main() -> int:
    cli = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    cli.add_argument("--program", default="mechanical_engineering_2027")
    cli.add_argument("--start-year", type=int, default=1)
    cli.add_argument("--tcid", default=PROGRAM_TCID)
    cli.add_argument("--shana", type=int, default=ACADEMIC_YEAR)
    args = cli.parse_args()
    out = build(args.program, args.start_year, args.tcid, args.shana)
    board = json.loads(out.read_text(encoding="utf-8"))
    print(f"[early-board] wrote {out.relative_to(ROOT)}")
    for sem in board["semesters"]:
        print(f"  {sem['semester_id']:20s} {len(sem['courses'])} courses  {sem['total_weekly_hours']} h")
    meta = board["metadata"]
    print(f"  categories: {[c['category_id'] for c in meta['program_requirements_categories']['categories']]}")
    print(f"  repository: {len(meta['program_repository_courses'])} courses; "
          f"required hours {meta['program_requirements_categories']['total_required_hours']}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

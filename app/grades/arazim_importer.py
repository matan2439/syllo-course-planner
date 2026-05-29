"""
Arazim / TAU Refactor grade importer.

Data source: https://arazim-project.com/data/grades.json
  - 13,000+ courses keyed by undashed course ID ("05424320")
  - Structure: {course_id: {semester: {group: [{moed, distribution, mean, ...}]}}}
  - semester format: "2024b" (year + a/b), group: "00"/"01"/...
  - moed 0 = מועד א (primary exam), moed 1 = מועד ב (makeup), etc.
  - distribution: list of 10+ ints (student count per decile bucket)
  - mean: average grade for that moed sitting

Usage:
    # Import grades for all 2027 ME courses
    python -m app.grades.arazim_importer --all-2027

    # Import specific courses (dashed or undashed)
    python -m app.grades.arazim_importer --courses 0542-4320 0542-4123

    # Force re-download of grades.json
    python -m app.grades.arazim_importer --all-2027 --force-refresh
"""

from __future__ import annotations

import json
import re
import urllib.request
from datetime import datetime, timezone
from pathlib import Path
from typing import Optional

from app.database.db import _DB_PATH, ensure_grade_stats_table, save_grade_stats
from app.models.grade_stats import CourseGradeStats, normalize_for_grade_source

GRADES_URL  = "https://arazim-project.com/data/grades.json"
SOURCE_NAME = "Arazim TAU Refactor"
SOURCE_URL  = "https://arazim-project.com/tau-refactor/"
CACHE_PATH  = Path("data/grades/arazim_grades.json")

_2027_BOARD_PATH = Path("data/parsed_json/mechanical_semester_board_2027.json")


# ---------------------------------------------------------------------------
# Download / cache
# ---------------------------------------------------------------------------

def fetch_arazim_grades(force_refresh: bool = False) -> dict:
    """Download grades.json and cache it locally; return the parsed dict.

    The file is ~11 MB.  On a warm cache hit it is loaded from disk.
    """
    CACHE_PATH.parent.mkdir(parents=True, exist_ok=True)

    if CACHE_PATH.exists() and not force_refresh:
        print(f"[arazim] Loading from cache: {CACHE_PATH}")
        return json.loads(CACHE_PATH.read_text(encoding="utf-8"))

    print(f"[arazim] Downloading {GRADES_URL} …")
    req = urllib.request.Request(
        GRADES_URL,
        headers={"User-Agent": "tau-course-planner/1.0 (educational research)"},
    )
    with urllib.request.urlopen(req, timeout=60) as resp:
        raw = resp.read()

    CACHE_PATH.write_bytes(raw)
    print(f"[arazim] Cached to {CACHE_PATH} ({len(raw):,} bytes)")
    return json.loads(raw.decode("utf-8"))


# ---------------------------------------------------------------------------
# Parsing helpers
# ---------------------------------------------------------------------------

def _semester_code(semester_str: str) -> str:
    """Convert "2024b" → "ב", "2023a" → "א"."""
    return "ב" if semester_str.endswith("b") else "א"


def _semester_year(semester_str: str) -> Optional[int]:
    m = re.match(r"^(\d{4})[ab]$", semester_str)
    return int(m.group(1)) if m else None


def _moed_code(moed_int: int) -> str:
    return {0: "א", 1: "ב"}.get(moed_int, str(moed_int))


def _student_count(distribution: list) -> int:
    """Total students = sum of distribution buckets."""
    return sum(int(x) for x in distribution)


# ---------------------------------------------------------------------------
# Core extraction
# ---------------------------------------------------------------------------

def extract_course_records(
    grades_data: dict,
    course_id: str,
    source_url: str = SOURCE_URL,
    fetched_at: str = "",
) -> list[CourseGradeStats]:
    """
    Extract all grade records for a course from the raw grades_data dict.

    Returns one CourseGradeStats per (semester, moed), aggregated across all
    teaching groups.  Groups are combined with a weighted average weighted by
    student count.

    The 'average of averages' the user sees in the web UI corresponds to:
        sum(mean * n_students for all moed-0 records) / sum(n_students for all moed-0)

    Returns an empty list if the course is not in grades_data.
    """
    lookup_id = normalize_for_grade_source(course_id)
    raw = grades_data.get(lookup_id)
    if not raw:
        return []

    # Normalise course_id to canonical dashed form (e.g. "0542-4320")
    digits = lookup_id
    canonical_id = f"{digits[:4]}-{digits[4:]}" if len(digits) == 8 else course_id

    records: list[CourseGradeStats] = []

    for semester_str, groups_data in raw.items():
        year = _semester_year(semester_str)
        sem  = _semester_code(semester_str)

        # Aggregate across groups for each moed
        # Structure: {moed_int: {total_weight, weighted_sum_mean, weighted_sum_med, weighted_sum_std, n}}
        agg: dict[int, dict] = {}

        for group_id, moed_list in groups_data.items():
            for entry in moed_list:
                moed_int  = entry.get("moed", 0)
                dist      = entry.get("distribution", [])
                mean_val  = entry.get("mean")
                med_val   = entry.get("median")
                std_val   = entry.get("standard_deviation")
                n         = _student_count(dist)

                if n == 0 or mean_val is None:
                    continue

                if moed_int not in agg:
                    agg[moed_int] = {
                        "weight": 0,
                        "sum_mean": 0.0,
                        "sum_med": 0.0,
                        "med_weight": 0,
                        "sum_std": 0.0,
                        "std_weight": 0,
                    }
                a = agg[moed_int]
                a["weight"]     += n
                a["sum_mean"]   += mean_val * n
                if med_val is not None:
                    a["sum_med"]    += med_val * n
                    a["med_weight"] += n
                if std_val is not None:
                    a["sum_std"]    += std_val * n
                    a["std_weight"] += n

        for moed_int, a in agg.items():
            if a["weight"] == 0:
                continue
            avg   = round(a["sum_mean"] / a["weight"], 2)
            med   = round(a["sum_med"]  / a["med_weight"], 2) if a["med_weight"] else None
            std   = round(a["sum_std"]  / a["std_weight"], 2) if a["std_weight"] else None

            records.append(CourseGradeStats(
                course_id          = canonical_id,
                year               = year,
                semester           = sem,
                moed               = _moed_code(moed_int),
                lecturer_name      = None,
                average_grade      = avg,
                median_grade       = med,
                standard_deviation = std,
                pass_rate          = None,
                num_students       = a["weight"],
                source_name        = SOURCE_NAME,
                source_url         = source_url,
                fetched_at         = fetched_at,
            ))

    return records


def compute_overall_average(records: list[CourseGradeStats]) -> Optional[dict]:
    """
    Compute a single weighted average across all moed-א (first exam) records.
    This matches what the Arazim web UI shows as ממוצע.

    Returns None if no data.
    """
    primary = [r for r in records if r.moed == "א" and r.average_grade is not None and r.num_students]
    if not primary:
        # Fallback: use all records
        primary = [r for r in records if r.average_grade is not None and r.num_students]
    if not primary:
        return None

    total_n    = sum(r.num_students for r in primary)
    total_avg  = sum(r.average_grade * r.num_students for r in primary) / total_n
    years      = sorted({r.year for r in primary if r.year})
    return {
        "average_grade": round(total_avg, 2),
        "sample_size":   total_n,
        "years":         years,
        "record_count":  len(primary),
    }


# ---------------------------------------------------------------------------
# Batch importer
# ---------------------------------------------------------------------------

def import_arazim_courses(
    course_ids: list[str],
    db_path: Path = _DB_PATH,
    force_refresh: bool = False,
    _grades_data_override: dict | None = None,
) -> dict[str, dict]:
    """
    Import Arazim grade data for a list of course IDs into the DB.

    Returns a summary dict {course_id: {status, avg_grade, sample_size, years}}.
    """
    grades_data = _grades_data_override if _grades_data_override is not None else fetch_arazim_grades(force_refresh)
    ensure_grade_stats_table(db_path)
    fetched_at  = datetime.now(timezone.utc).isoformat()

    summary: dict[str, dict] = {}
    total_inserted = 0

    for cid in course_ids:
        lookup_id = normalize_for_grade_source(cid)
        records   = extract_course_records(grades_data, cid,
                                           source_url=SOURCE_URL,
                                           fetched_at=fetched_at)
        if not records:
            summary[cid] = {"status": "not_found", "lookup_id": lookup_id}
            continue

        n = save_grade_stats(records, db_path)
        total_inserted += n
        overall = compute_overall_average(records)
        summary[cid] = {
            "status":        "matched",
            "lookup_id":     lookup_id,
            "avg_grade":     overall["average_grade"] if overall else None,
            "sample_size":   overall["sample_size"]   if overall else None,
            "years":         overall["years"]          if overall else [],
            "records":       len(records),
            "inserted":      n,
        }

    print(f"[arazim] Imported {total_inserted} records for {len(course_ids)} courses.")
    return summary


def import_2027_board_courses(
    db_path: Path = _DB_PATH,
    force_refresh: bool = False,
) -> dict[str, dict]:
    """Import Arazim grades for all 56 repository courses in the 2027 board."""
    board = json.loads(_2027_BOARD_PATH.read_text(encoding="utf-8"))
    repo  = board["metadata"]["program_repository_courses"]
    course_ids = [r["course_id"] for r in repo]
    print(f"[arazim] Importing {len(course_ids)} 2027 ME courses …")
    return import_arazim_courses(course_ids, db_path, force_refresh)


# ---------------------------------------------------------------------------
# CLI
# ---------------------------------------------------------------------------

def _print_summary(summary: dict[str, dict]) -> None:
    matched     = [c for c, v in summary.items() if v["status"] == "matched"]
    not_found   = [c for c, v in summary.items() if v["status"] == "not_found"]

    print()
    print("=" * 55)
    print(f"Arazim import summary")
    print("=" * 55)
    print(f"  matched  : {len(matched)}")
    print(f"  not_found: {len(not_found)}")
    if not_found:
        print(f"  not found IDs: {not_found}")
    if matched:
        print(f"\n  Matched courses:")
        for cid in matched[:10]:
            v = summary[cid]
            print(f"    {cid}  avg={v.get('avg_grade')}  n={v.get('sample_size')}  "
                  f"years={v.get('years')}  records={v.get('records')}")
        if len(matched) > 10:
            print(f"    … and {len(matched) - 10} more")


if __name__ == "__main__":
    import argparse

    cli = argparse.ArgumentParser(
        description="Import Arazim/TAU-Refactor grade data for TAU courses"
    )
    cli.add_argument("--all-2027", action="store_true",
                     help="Import all 56 courses from the 2027 ME board")
    cli.add_argument("--courses", nargs="+", metavar="COURSE_ID",
                     help="Specific course IDs to import (dashed or undashed)")
    cli.add_argument("--force-refresh", action="store_true",
                     help="Re-download grades.json even if cached")
    cli.add_argument("--db", default=str(_DB_PATH), metavar="PATH")
    args = cli.parse_args()

    db = Path(args.db)

    if args.all_2027:
        summary = import_2027_board_courses(db_path=db, force_refresh=args.force_refresh)
    elif args.courses:
        summary = import_arazim_courses(args.courses, db_path=db, force_refresh=args.force_refresh)
    else:
        cli.print_help()
        raise SystemExit(0)

    _print_summary(summary)

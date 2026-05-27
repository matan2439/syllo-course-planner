"""
Grade statistics importer — TAU Refactor / TAU Factor.

Downloads (or loads from cache) a JSON file of historical grade data,
normalizes field names across multiple source formats, and saves records
to the course_grade_stats table.

This is an unofficial secondary source.  Official TAU course data always
takes precedence for metadata; grade statistics are supplemental only.

CLI
---
    python -m app.grades.grade_stats_importer \\
        --source-url https://example.com/grades.json \\
        --cache data/grades/grades.json \\
        [--db data/database.sqlite] \\
        [--max-age-hours 24]

Supported JSON formats
----------------------
The importer accepts any of the following top-level shapes:

    • Array of record objects                         →  [{...}, ...]
    • Object with a "data", "grades", or "courses" key →  {"data": [{...}, ...]}

Each record may use English camelCase, English snake_case, or Hebrew field names.
Unknown fields are ignored; missing optional fields default to None.

Field name aliases
------------------
course_id       : courseId | course_id | courseNum | מספר_קורס | id
year            : year | academicYear | שנה
semester        : semester | סמסטר  (1/"א"/"a" → "א"; 2/"ב"/"b" → "ב")
moed            : moed | מועד | examPeriod  ("A"/"a" → "א"; "B"/"b" → "ב")
lecturer_name   : lecturer | lecturerName | lecturer_name | מרצה | instructors
average_grade   : average | avg | averageGrade | average_grade | ממוצע
median_grade    : median | medianGrade | median_grade | חציון
standard_deviation: standardDeviation | std | sd | standard_deviation | סטיית_תקן
pass_rate       : passRate | pass_rate | passPercent | passRatio
                  (values > 1.0 are treated as percentages and divided by 100)
num_students    : numStudents | num_students | numTested | tested | מספר_נבחנים | count | n
"""

from __future__ import annotations

import json
import re
import urllib.request
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from app.database.db import _DB_PATH, init_db, save_grade_stats
from app.models.grade_stats import CourseGradeStats

# ---------------------------------------------------------------------------
# Field-name alias maps
# ---------------------------------------------------------------------------

_COURSE_ID_ALIASES = {"courseId", "course_id", "courseNum", "מספר_קורס", "id"}
_YEAR_ALIASES      = {"year", "academicYear", "שנה"}
_SEMESTER_ALIASES  = {"semester", "סמסטר"}
_MOED_ALIASES      = {"moed", "מועד", "examPeriod"}
_LECTURER_ALIASES  = {"lecturer", "lecturerName", "lecturer_name", "מרצה", "instructors"}
_AVG_ALIASES       = {"average", "avg", "averageGrade", "average_grade", "ממוצע"}
_MED_ALIASES       = {"median", "medianGrade", "median_grade", "חציון"}
_STD_ALIASES       = {"standardDeviation", "std", "sd", "standard_deviation", "סטיית_תקן"}
_PASS_ALIASES      = {"passRate", "pass_rate", "passPercent", "passRatio"}
_STUDENTS_ALIASES  = {"numStudents", "num_students", "numTested", "tested",
                      "מספר_נבחנים", "count", "n"}

_SEMESTER_NORM = {
    "1": "א", "א": "א", "a": "א",
    "2": "ב", "ב": "ב", "b": "ב",
    "3": "קיץ", "summer": "קיץ",
}
_MOED_NORM = {
    "a": "א", "A": "א", "א": "א", "1": "א",
    "b": "ב", "B": "ב", "ב": "ב", "2": "ב",
}


# ---------------------------------------------------------------------------
# Normalizer
# ---------------------------------------------------------------------------

def _pick(record: dict, aliases: set[str]) -> Any:
    """Return the first matching value from *record* for any key in *aliases*."""
    for key in aliases:
        if key in record:
            return record[key]
    return None


def _normalize_record(
    raw: dict,
    source_name: str,
    source_url: str | None,
    fetched_at: str,
) -> CourseGradeStats | None:
    """Parse one raw dict into a CourseGradeStats, or return None if course_id is missing."""
    from app.database.db import _normalize_course_id  # local import to avoid circulars

    raw_id = _pick(raw, _COURSE_ID_ALIASES)
    if raw_id is None:
        return None
    course_id = _normalize_course_id(str(raw_id))

    # Semester normalisation
    sem_raw = _pick(raw, _SEMESTER_ALIASES)
    semester = _SEMESTER_NORM.get(str(sem_raw).strip().lower(), str(sem_raw)) if sem_raw else None

    # Moed normalisation
    moed_raw = _pick(raw, _MOED_ALIASES)
    moed = _MOED_NORM.get(str(moed_raw).strip(), str(moed_raw)) if moed_raw else None

    # Lecturer — may be a list
    lecturer_raw = _pick(raw, _LECTURER_ALIASES)
    if isinstance(lecturer_raw, list):
        lecturer_name = ", ".join(str(x) for x in lecturer_raw) or None
    elif lecturer_raw:
        lecturer_name = str(lecturer_raw).strip() or None
    else:
        lecturer_name = None

    # Float fields
    def _float(aliases: set) -> float | None:
        v = _pick(raw, aliases)
        try:
            return float(v) if v is not None else None
        except (TypeError, ValueError):
            return None

    # Int fields
    def _int(aliases: set) -> int | None:
        v = _pick(raw, aliases)
        try:
            return int(v) if v is not None else None
        except (TypeError, ValueError):
            return None

    pass_rate = _float(_PASS_ALIASES)
    if pass_rate is not None and pass_rate > 1.0:
        pass_rate = pass_rate / 100.0   # percentage → ratio

    return CourseGradeStats(
        course_id          = course_id,
        year               = _int(_YEAR_ALIASES),
        semester           = semester,
        moed               = moed,
        lecturer_name      = lecturer_name,
        average_grade      = _float(_AVG_ALIASES),
        median_grade       = _float(_MED_ALIASES),
        standard_deviation = _float(_STD_ALIASES),
        pass_rate          = pass_rate,
        num_students       = _int(_STUDENTS_ALIASES),
        source_name        = source_name,
        source_url         = source_url,
        fetched_at         = fetched_at,
    )


def parse_grades_json(
    data: list | dict,
    source_name: str = "TAU Refactor",
    source_url: str | None = None,
    fetched_at: str = "",
) -> list[CourseGradeStats]:
    """
    Parse a raw JSON payload (list or dict) into a list of CourseGradeStats.
    Records missing a course_id are silently skipped.
    """
    if isinstance(data, dict):
        for key in ("data", "grades", "courses", "results"):
            if key in data and isinstance(data[key], list):
                data = data[key]
                break
        else:
            data = list(data.values()) if all(isinstance(v, dict) for v in data.values()) else []

    results: list[CourseGradeStats] = []
    for raw in data:
        if not isinstance(raw, dict):
            continue
        record = _normalize_record(raw, source_name, source_url, fetched_at)
        if record is not None:
            results.append(record)
    return results


# ---------------------------------------------------------------------------
# Fetch / cache
# ---------------------------------------------------------------------------

def fetch_or_load(
    source_url: str | None,
    cache_path: Path,
    max_age_hours: float = 24.0,
) -> list | dict:
    """
    Return the parsed JSON payload from *cache_path* if it is fresh enough,
    otherwise download from *source_url* and write to *cache_path*.

    Raises ValueError if neither cache nor URL is available.
    """
    now = datetime.now(timezone.utc).timestamp()
    use_cache = False
    if cache_path.exists():
        age_hours = (now - cache_path.stat().st_mtime) / 3600.0
        use_cache = age_hours < max_age_hours

    if use_cache:
        return json.loads(cache_path.read_text(encoding="utf-8"))

    if not source_url:
        if cache_path.exists():
            return json.loads(cache_path.read_text(encoding="utf-8"))
        raise ValueError("No source URL and no cache file found.")

    print(f"[grades] Downloading from {source_url} …")
    req = urllib.request.Request(
        source_url,
        headers={"User-Agent": "tau-course-planner/1.0 (educational tool)"},
    )
    with urllib.request.urlopen(req, timeout=30) as resp:
        raw_bytes = resp.read()

    cache_path.parent.mkdir(parents=True, exist_ok=True)
    cache_path.write_bytes(raw_bytes)
    print(f"[grades] Cached to {cache_path}")

    return json.loads(raw_bytes.decode("utf-8"))


# ---------------------------------------------------------------------------
# High-level importer
# ---------------------------------------------------------------------------

def import_grade_stats(
    source_url: str | None = None,
    cache_path: Path = Path("data/grades/grades.json"),
    db_path: Path = _DB_PATH,
    source_name: str = "TAU Refactor",
    max_age_hours: float = 24.0,
) -> int:
    """
    Download (or load from cache) grade statistics and save them to the DB.
    Returns the number of records inserted.
    """
    fetched_at = datetime.now(timezone.utc).isoformat()

    data = fetch_or_load(source_url, cache_path, max_age_hours)
    stats = parse_grades_json(data, source_name=source_name,
                              source_url=source_url, fetched_at=fetched_at)

    if not stats:
        print("[grades] No records parsed — check the JSON format.")
        return 0

    init_db(db_path)
    inserted = save_grade_stats(stats, db_path)
    return inserted


# ---------------------------------------------------------------------------
# CLI
# ---------------------------------------------------------------------------

if __name__ == "__main__":
    import argparse

    cli = argparse.ArgumentParser(
        description="Import TAU Refactor / TAU Factor grade statistics into the planner DB"
    )
    cli.add_argument("--source-url",    default=None, metavar="URL",
                     help="URL to download grade statistics JSON from")
    cli.add_argument("--cache",         default="data/grades/grades.json", metavar="PATH",
                     help="Local cache path for the downloaded JSON (default: data/grades/grades.json)")
    cli.add_argument("--db",           default=str(_DB_PATH), metavar="PATH",
                     help=f"Database path (default: {_DB_PATH})")
    cli.add_argument("--source-name",  default="TAU Refactor", metavar="NAME",
                     help="Display name for attribution (default: TAU Refactor)")
    cli.add_argument("--max-age-hours", type=float, default=24.0, metavar="N",
                     help="Re-download if cache is older than N hours (default: 24)")
    args = cli.parse_args()

    n = import_grade_stats(
        source_url    = args.source_url,
        cache_path    = Path(args.cache),
        db_path       = Path(args.db),
        source_name   = args.source_name,
        max_age_hours = args.max_age_hours,
    )
    print(f"[grades] Inserted {n} grade record(s).")

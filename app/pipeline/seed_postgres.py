"""
Seed Postgres from local SQLite and JSON sources.

Sources
-------
data/database.sqlite
data/programs/mechanical_engineering_2027_enriched.json
data/programs/mechanical_engineering_mandatory_2027.json
data/parsed_json/mechanical_semester_board_2027.json

Design
------
Two separate layers are kept intentionally independent:

  1. Extraction layer  — pure Python, reads local files, returns plain dicts.
                         No database connection; fully unit-testable.
  2. Upsert layer      — writes to Postgres via psycopg2.  Every write uses
                         ON CONFLICT so the script is safe to run multiple
                         times without duplicating rows.

Usage
-----
    # Preview (no DB needed):
    python -m app.pipeline.seed_postgres --dry-run

    # Real seed (DATABASE_URL must be set in .env or environment):
    DATABASE_URL=postgresql://... python -m app.pipeline.seed_postgres

    # Explicit URL override:
    python -m app.pipeline.seed_postgres --database-url postgresql://...
"""

from __future__ import annotations

import argparse
import json
import logging
import sqlite3
import sys
import uuid
from dataclasses import dataclass, field
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from app.config import settings

logger = logging.getLogger(__name__)

# ── Source file paths ─────────────────────────────────────────────────────────

_ENRICHED_PATH  = Path("data/programs/mechanical_engineering_2027_enriched.json")
_MANDATORY_PATH = Path("data/programs/mechanical_engineering_mandatory_2027.json")
_BOARD_PATH     = Path("data/parsed_json/mechanical_semester_board_2027.json")
_SQLITE_PATH    = Path("data/database.sqlite")

BASE_PROGRAM_ID = "mechanical_engineering"
ACADEMIC_YEAR   = 2027

# ── Result containers ─────────────────────────────────────────────────────────


@dataclass
class SeedData:
    program:          dict[str, Any]
    program_version:  dict[str, Any]
    courses:          list[dict[str, Any]]
    course_offerings: list[dict[str, Any]]
    course_groups:    list[dict[str, Any]]
    prerequisites:    list[dict[str, Any]]
    categories:       list[dict[str, Any]]
    program_courses:  list[dict[str, Any]]
    grade_stats:      list[dict[str, Any]]
    syllabus_sources: list[dict[str, Any]]
    warnings:         list[str] = field(default_factory=list)


@dataclass
class SeedResult:
    programs:          int = 0
    program_versions:  int = 0
    courses:           int = 0
    course_offerings:  int = 0
    course_groups:     int = 0
    prerequisites:     int = 0
    course_categories: int = 0
    program_courses:   int = 0
    mandatory_courses: int = 0
    grade_stats:       int = 0
    syllabus_sources:  int = 0
    import_runs:       int = 0
    warnings:          list[str] = field(default_factory=list)


# ── Extraction layer (pure Python — no DB) ───────────────────────────────────


def extract_programs(enriched: dict[str, Any]) -> dict[str, Any]:
    """One row for the programs table; strips academic year from program_id."""
    return {
        "program_id": BASE_PROGRAM_ID,
        "name_he":    enriched.get("program_name_he"),
        "name_en":    enriched.get("program_name"),
        "faculty":    enriched.get("faculty"),
    }


def extract_program_version(enriched: dict[str, Any]) -> dict[str, Any]:
    """One row for program_versions; stores the full enriched JSON as raw_json."""
    return {
        "program_id":           BASE_PROGRAM_ID,
        "academic_year":        ACADEMIC_YEAR,
        "academic_year_he":     enriched.get("academic_year_he"),
        "is_active":            True,
        "source_type":          enriched.get("source_type"),
        "total_required_hours": enriched.get("total_required_hours"),
        "notes":                enriched.get("notes", []),
        "raw_json":             enriched,
    }


def extract_courses_from_sqlite(path: Path) -> list[dict[str, Any]]:
    """Read all courses from SQLite; column names are mapped to Postgres schema."""
    conn = sqlite3.connect(str(path))
    conn.row_factory = sqlite3.Row
    try:
        rows = conn.execute(
            "SELECT * FROM courses ORDER BY course_id"
        ).fetchall()
        result = []
        for r in rows:
            result.append({
                "course_id":              r["course_id"],
                "name_he":                r["name_he"],
                "name_en":                r["name_en"],
                "faculty":                r["faculty"],
                "department":             r["department"],
                "credits":                r["credits"],
                "lecture_hours":          r["lecture_hours"],
                "tutorial_hours":         r["tutorial_hours"],
                "lab_hours":              r["lab_hours"],
                "weekly_hours":           None,  # not stored in SQLite schema
                "course_description":     r["course_description"],
                "assignments":            r["assignments"],
                "exam_info":              r["exam_info"],
                "topics":                 _parse_json(r["topics_json"]),
                "syllabus_links":         _parse_json(r["syllabus_links_json"]),
                "prerequisites_raw_text": r["prerequisites_raw_text"],
                "last_seen_year":         r["year"],
                "last_seen_semester":     r["semester"],
                # Private fields used by extract_course_offerings only:
                "_year":                  r["year"],
                "_semester":              r["semester"],
            })
        return result
    finally:
        conn.close()


def extract_course_stubs_from_board(
    board: dict[str, Any], known_ids: set[str]
) -> list[dict[str, Any]]:
    """Minimal courses rows for board-repo courses not already in SQLite."""
    repo = board.get("metadata", {}).get("program_repository_courses", [])
    stubs = []
    for c in repo:
        cid = c.get("course_id", "")
        if cid and cid not in known_ids:
            stubs.append({
                "course_id":              cid,
                "name_he":                c.get("name_he"),
                "name_en":                None,
                "faculty":                None,
                "department":             None,
                "credits":                None,
                "lecture_hours":          None,
                "tutorial_hours":         None,
                "lab_hours":              None,
                "weekly_hours":           c.get("weekly_hours"),
                "course_description":     None,
                "assignments":            None,
                "exam_info":              None,
                "topics":                 [],
                "syllabus_links":         [],
                "prerequisites_raw_text": None,
                "last_seen_year":         None,
                "last_seen_semester":     None,
                "_year":                  None,
                "_semester":              None,
            })
    return stubs


def extract_mandatory_stubs(
    mandatory: dict[str, Any], known_ids: set[str]
) -> list[dict[str, Any]]:
    """Minimal course rows for mandatory courses not in SQLite or board repo."""
    stubs = []
    for c in mandatory.get("courses", []):
        cid = c.get("course_id", "")
        if cid and cid not in known_ids:
            stubs.append({
                "course_id":              cid,
                "name_he":                c.get("name_he"),
                "name_en":                None,
                "faculty":                None,
                "department":             None,
                "credits":                None,
                "lecture_hours":          None,
                "tutorial_hours":         None,
                "lab_hours":              None,
                "weekly_hours":           c.get("weekly_hours"),
                "course_description":     None,
                "assignments":            None,
                "exam_info":              None,
                "topics":                 [],
                "syllabus_links":         [],
                "prerequisites_raw_text": None,
                "last_seen_year":         None,
                "last_seen_semester":     None,
                "_year":                  None,
                "_semester":              None,
            })
    return stubs


def extract_course_offerings(courses: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """One course_offering row per SQLite course that has both year and semester."""
    seen: set[tuple[str, int, str]] = set()
    offerings = []
    for c in courses:
        year = c.get("_year")
        sem  = c.get("_semester")
        cid  = c.get("course_id", "")
        if cid and year is not None and sem:
            key = (cid, year, sem)
            if key not in seen:
                seen.add(key)
                offerings.append({"course_id": cid, "year": year, "semester": sem})
    return offerings


def extract_course_groups_from_sqlite(
    path: Path,
) -> tuple[list[dict[str, Any]], list[str]]:
    """
    Read course_groups from SQLite and enrich each row with year from courses.

    SQLite course_groups has no year column, so year is resolved from a
    {course_id -> year} lookup built from the courses table.

    Returns (groups, warnings) — warnings lists course_ids whose year is NULL.
    """
    conn = sqlite3.connect(str(path))
    conn.row_factory = sqlite3.Row
    warnings: list[str] = []
    try:
        year_lookup: dict[str, int | None] = {
            r["course_id"]: r["year"]
            for r in conn.execute("SELECT course_id, year FROM courses").fetchall()
        }
        groups = []
        for r in conn.execute("SELECT * FROM course_groups").fetchall():
            cid  = r["course_id"]
            year = year_lookup.get(cid)
            if year is None:
                warnings.append(
                    f"course_groups: year not resolved for {cid} — stored as NULL"
                )
            groups.append({
                "course_id":     cid,
                "year":          year,
                "semester":      r["semester"],
                "group_number":  r["group_number"],
                "lecturer":      r["lecturer"],
                "teaching_type": r["teaching_type"],
                "day":           r["day"],
                "start_time":    r["start_time"],
                "end_time":      r["end_time"],
                "building":      r["building"],
                "room":          r["room"],
                "syllabus_url":  r["syllabus_url"],
                "moodle_url":    None,
            })
        return groups, warnings
    finally:
        conn.close()


def extract_prerequisites_from_sqlite(path: Path) -> list[dict[str, Any]]:
    conn = sqlite3.connect(str(path))
    conn.row_factory = sqlite3.Row
    try:
        return [
            {
                "course_id":              r["course_id"],
                "prerequisite_course_id": r["prerequisite_course_id"],
                "source":                 "parsed",
            }
            for r in conn.execute("SELECT * FROM prerequisites").fetchall()
        ]
    finally:
        conn.close()


def extract_course_categories(enriched: dict[str, Any]) -> list[dict[str, Any]]:
    """Return 5 category rows from enriched JSON requirements section."""
    reqs = enriched.get("requirements", {})
    cats: list[dict[str, Any]] = []
    for cc in reqs.get("core_categories", []):
        cats.append({
            "category_id":   cc["category_id"],
            "name_he":       cc.get("name_he"),
            "min_courses":   cc.get("min_courses", 0),
            "max_courses":   None,
            "display_order": len(cats),
        })
    for section_key in ("advanced_labs", "other_specialization"):
        sec = reqs.get(section_key)
        if isinstance(sec, dict):
            cats.append({
                "category_id":   sec["category_id"],
                "name_he":       sec.get("name_he"),
                "min_courses":   sec.get("min_courses", 0),
                "max_courses":   None,
                "display_order": len(cats),
            })
    return cats


def extract_program_courses(
    enriched: dict[str, Any],
    mandatory: dict[str, Any],
) -> list[dict[str, Any]]:
    """
    All courses belonging to this program version.

    Electives come from elective_courses + other_specialization_electives.
    Mandatory (is_mandatory=True) come from mandatory JSON.
    If a mandatory course also appears in electives, its row is updated in-place.
    """
    by_id: dict[str, dict[str, Any]] = {}

    for c in enriched.get("elective_courses", []):
        cid = c.get("course_id", "")
        if cid:
            by_id[cid] = {
                "course_id":         cid,
                "category_id":       c.get("category_id"),
                "is_mandatory":      False,
                "locked_by_default": False,
                "allowed_semesters": [],
                "offered_semesters": c.get("offered_semesters", []),
            }

    for c in enriched.get("other_specialization_electives", []):
        cid = c.get("course_id", "")
        if cid and cid not in by_id:
            by_id[cid] = {
                "course_id":         cid,
                "category_id":       "other_specialization",
                "is_mandatory":      False,
                "locked_by_default": False,
                "allowed_semesters": [],
                "offered_semesters": [],
            }

    for c in mandatory.get("courses", []):
        cid = c.get("course_id", "")
        if not cid:
            continue
        if cid in by_id:
            by_id[cid]["is_mandatory"]      = True
            by_id[cid]["locked_by_default"] = c.get("locked_by_default", True)
            by_id[cid]["allowed_semesters"] = c.get("allowed_semesters", [])
        else:
            by_id[cid] = {
                "course_id":         cid,
                "category_id":       None,
                "is_mandatory":      True,
                "locked_by_default": c.get("locked_by_default", True),
                "allowed_semesters": c.get("allowed_semesters", []),
                "offered_semesters": [],
            }

    return list(by_id.values())


def extract_grade_stats_from_sqlite(path: Path) -> list[dict[str, Any]]:
    """
    Read course_grade_stats from SQLite.

    Deduplicates on (course_id, year, semester, moed, source_name) so the
    same import run does not produce duplicate rows in Postgres.
    """
    conn = sqlite3.connect(str(path))
    conn.row_factory = sqlite3.Row
    try:
        rows = conn.execute(
            "SELECT * FROM course_grade_stats "
            "ORDER BY course_id, year, semester, moed"
        ).fetchall()
        seen: set[tuple] = set()
        result = []
        for r in rows:
            key = (r["course_id"], r["year"], r["semester"], r["moed"], r["source_name"])
            if key in seen:
                continue
            seen.add(key)
            fetched_at: datetime | None = None
            raw = r["fetched_at"]
            if raw:
                try:
                    fetched_at = datetime.fromisoformat(str(raw))
                except (ValueError, TypeError):
                    pass
            result.append({
                "course_id":          r["course_id"],
                "year":               r["year"],
                "semester":           r["semester"],
                "moed":               r["moed"],
                "lecturer_name":      r["lecturer_name"],
                "average_grade":      r["average_grade"],
                "median_grade":       r["median_grade"],
                "standard_deviation": r["standard_deviation"],
                "pass_rate":          r["pass_rate"],
                "num_students":       r["num_students"],
                "source_name":        r["source_name"] or "Arazim TAU Refactor",
                "source_url":         r["source_url"],
                "fetched_at":         fetched_at,
            })
        return result
    finally:
        conn.close()


def extract_syllabus_sources(groups: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Unique syllabus URLs from course_groups rows that have a syllabus_url."""
    seen: set[tuple[str, str]] = set()
    sources = []
    for g in groups:
        url = g.get("syllabus_url")
        cid = g.get("course_id", "")
        if url and cid:
            key = (cid, url)
            if key not in seen:
                seen.add(key)
                sources.append({
                    "course_id":    cid,
                    "year":         g.get("year"),
                    "semester":     g.get("semester"),
                    "group_number": g.get("group_number"),
                    "url":          url,
                    "is_active":    True,
                    "source":       "tau_ims",
                    "fetched_at":   None,
                })
    return sources


def extract_all(
    enriched_path: Path = _ENRICHED_PATH,
    mandatory_path: Path = _MANDATORY_PATH,
    board_path: Path = _BOARD_PATH,
    sqlite_path: Path = _SQLITE_PATH,
) -> SeedData:
    """Load and transform all seed data from local sources. No DB needed."""
    enriched  = json.loads(enriched_path.read_text("utf-8"))
    mandatory = json.loads(mandatory_path.read_text("utf-8"))
    board     = json.loads(board_path.read_text("utf-8"))

    program         = extract_programs(enriched)
    program_version = extract_program_version(enriched)

    # Courses: full records from SQLite, then stubs from board/mandatory
    sqlite_courses = extract_courses_from_sqlite(sqlite_path)
    known_ids      = {c["course_id"] for c in sqlite_courses}
    board_stubs    = extract_course_stubs_from_board(board, known_ids)
    known_ids     |= {c["course_id"] for c in board_stubs}
    mand_stubs     = extract_mandatory_stubs(mandatory, known_ids)
    all_courses    = sqlite_courses + board_stubs + mand_stubs

    course_offerings             = extract_course_offerings(all_courses)
    groups, group_warnings       = extract_course_groups_from_sqlite(sqlite_path)
    prerequisites                = extract_prerequisites_from_sqlite(sqlite_path)
    categories                   = extract_course_categories(enriched)
    program_courses              = extract_program_courses(enriched, mandatory)
    grade_stats                  = extract_grade_stats_from_sqlite(sqlite_path)
    syllabus_sources             = extract_syllabus_sources(groups)

    return SeedData(
        program          = program,
        program_version  = program_version,
        courses          = all_courses,
        course_offerings = course_offerings,
        course_groups    = groups,
        prerequisites    = prerequisites,
        categories       = categories,
        program_courses  = program_courses,
        grade_stats      = grade_stats,
        syllabus_sources = syllabus_sources,
        warnings         = group_warnings,
    )


# ── Upsert layer (requires psycopg2 + live Postgres) ─────────────────────────


def upsert_all(db_url: str, data: SeedData) -> SeedResult:
    """
    Write all extracted data to Postgres.  Every table uses ON CONFLICT so
    running the script twice is safe — no rows will be duplicated.
    """
    import psycopg2           # noqa: PLC0415 (local import — not required for tests)
    import psycopg2.extras    # noqa: PLC0415

    result = SeedResult(warnings=list(data.warnings))
    conn = psycopg2.connect(db_url)
    conn.autocommit = False
    cur = conn.cursor()
    try:
        pv_id = _upsert_programs_and_version(cur, data, result)
        _upsert_courses(cur, data.courses)
        result.courses = len(data.courses)
        _upsert_course_offerings(cur, data.course_offerings)
        result.course_offerings = len(data.course_offerings)
        _upsert_course_groups(cur, data.course_groups)
        result.course_groups = len(data.course_groups)
        _upsert_prerequisites(cur, data.prerequisites)
        result.prerequisites = len(data.prerequisites)
        _upsert_course_categories(cur, data.categories, pv_id)
        result.course_categories = len(data.categories)
        _upsert_program_courses(cur, data.program_courses, pv_id)
        result.program_courses  = len(data.program_courses)
        result.mandatory_courses = sum(1 for c in data.program_courses if c.get("is_mandatory"))
        _replace_grade_stats(cur, data.grade_stats)
        result.grade_stats = len(data.grade_stats)
        _replace_syllabus_sources(cur, data.syllabus_sources)
        result.syllabus_sources = len(data.syllabus_sources)
        _insert_import_run(cur, result)
        result.import_runs = 1
        conn.commit()
    except Exception:
        conn.rollback()
        raise
    finally:
        cur.close()
        conn.close()
    return result


# ── Private upsert helpers ───────────────────────────────────────────────────


def _new_id() -> str:
    return str(uuid.uuid4())


def _upsert_programs_and_version(cur: Any, data: SeedData, result: SeedResult) -> str:
    """Insert/update programs + program_versions; return program_version UUID."""
    import psycopg2.extras  # noqa: PLC0415

    p = data.program
    cur.execute(
        """
        INSERT INTO programs (id, program_id, name_he, name_en, faculty)
        VALUES (%s, %s, %s, %s, %s)
        ON CONFLICT (program_id) DO UPDATE SET
            name_he = EXCLUDED.name_he,
            name_en = EXCLUDED.name_en,
            faculty = EXCLUDED.faculty
        """,
        (_new_id(), p["program_id"], p.get("name_he"), p.get("name_en"), p.get("faculty")),
    )
    result.programs = 1

    pv = data.program_version
    cur.execute(
        """
        INSERT INTO program_versions
            (id, program_id, academic_year, academic_year_he, is_active,
             source_type, total_required_hours, notes, raw_json)
        VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s)
        ON CONFLICT (program_id, academic_year) DO UPDATE SET
            total_required_hours = EXCLUDED.total_required_hours,
            notes      = EXCLUDED.notes,
            raw_json   = EXCLUDED.raw_json,
            updated_at = now()
        RETURNING id
        """,
        (
            _new_id(), BASE_PROGRAM_ID, ACADEMIC_YEAR,
            pv.get("academic_year_he"), True,
            pv.get("source_type"),
            pv.get("total_required_hours"),
            json.dumps(pv.get("notes", []), ensure_ascii=False),
            json.dumps(pv.get("raw_json", {}), ensure_ascii=False),
        ),
    )
    pv_id = str(cur.fetchone()[0])
    result.program_versions = 1
    return pv_id


def _upsert_courses(cur: Any, courses: list[dict[str, Any]]) -> None:
    if not courses:
        return
    import psycopg2.extras  # noqa: PLC0415

    psycopg2.extras.execute_batch(
        cur,
        """
        INSERT INTO courses
            (id, course_id, name_he, name_en, faculty, department,
             credits, lecture_hours, tutorial_hours, lab_hours, weekly_hours,
             course_description, assignments, exam_info, topics, syllabus_links,
             prerequisites_raw_text, last_seen_year, last_seen_semester)
        VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)
        ON CONFLICT (course_id) DO UPDATE SET
            name_he                = COALESCE(EXCLUDED.name_he, courses.name_he),
            name_en                = COALESCE(EXCLUDED.name_en, courses.name_en),
            faculty                = COALESCE(EXCLUDED.faculty, courses.faculty),
            department             = COALESCE(EXCLUDED.department, courses.department),
            credits                = COALESCE(EXCLUDED.credits, courses.credits),
            weekly_hours           = COALESCE(EXCLUDED.weekly_hours, courses.weekly_hours),
            course_description     = COALESCE(EXCLUDED.course_description, courses.course_description),
            last_seen_year         = COALESCE(EXCLUDED.last_seen_year, courses.last_seen_year),
            last_seen_semester     = COALESCE(EXCLUDED.last_seen_semester, courses.last_seen_semester),
            updated_at             = now()
        """,
        [
            (
                _new_id(), c["course_id"],
                c.get("name_he"), c.get("name_en"), c.get("faculty"), c.get("department"),
                c.get("credits"), c.get("lecture_hours"), c.get("tutorial_hours"),
                c.get("lab_hours"), c.get("weekly_hours"),
                c.get("course_description"), c.get("assignments"), c.get("exam_info"),
                json.dumps(c.get("topics", []), ensure_ascii=False),
                json.dumps(c.get("syllabus_links", []), ensure_ascii=False),
                c.get("prerequisites_raw_text"),
                c.get("last_seen_year"), c.get("last_seen_semester"),
            )
            for c in courses
        ],
    )


def _upsert_course_offerings(cur: Any, offerings: list[dict[str, Any]]) -> None:
    if not offerings:
        return
    import psycopg2.extras  # noqa: PLC0415

    psycopg2.extras.execute_batch(
        cur,
        """
        INSERT INTO course_offerings (id, course_id, year, semester)
        VALUES (%s, %s, %s, %s)
        ON CONFLICT (course_id, year, semester) DO NOTHING
        """,
        [(_new_id(), o["course_id"], o["year"], o["semester"]) for o in offerings],
    )


def _upsert_course_groups(cur: Any, groups: list[dict[str, Any]]) -> None:
    if not groups:
        return
    import psycopg2.extras  # noqa: PLC0415

    psycopg2.extras.execute_batch(
        cur,
        """
        INSERT INTO course_groups
            (id, course_id, year, semester, group_number, lecturer,
             teaching_type, day, start_time, end_time, building, room,
             syllabus_url, moodle_url)
        VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)
        ON CONFLICT (course_id, year, semester, group_number) DO NOTHING
        """,
        [
            (
                _new_id(), g["course_id"], g.get("year"), g.get("semester"),
                g.get("group_number"), g.get("lecturer"), g.get("teaching_type"),
                g.get("day"), g.get("start_time"), g.get("end_time"),
                g.get("building"), g.get("room"),
                g.get("syllabus_url"), g.get("moodle_url"),
            )
            for g in groups
        ],
    )


def _upsert_prerequisites(cur: Any, prereqs: list[dict[str, Any]]) -> None:
    if not prereqs:
        return
    import psycopg2.extras  # noqa: PLC0415

    psycopg2.extras.execute_batch(
        cur,
        """
        INSERT INTO prerequisites (id, course_id, prerequisite_course_id, source)
        VALUES (%s, %s, %s, %s)
        ON CONFLICT (course_id, prerequisite_course_id) DO NOTHING
        """,
        [
            (_new_id(), p["course_id"], p["prerequisite_course_id"], p.get("source", "parsed"))
            for p in prereqs
        ],
    )


def _upsert_course_categories(
    cur: Any, categories: list[dict[str, Any]], pv_id: str
) -> None:
    if not categories:
        return
    import psycopg2.extras  # noqa: PLC0415

    psycopg2.extras.execute_batch(
        cur,
        """
        INSERT INTO course_categories
            (id, program_version_id, category_id, name_he,
             min_courses, max_courses, display_order)
        VALUES (%s, %s, %s, %s, %s, %s, %s)
        ON CONFLICT (program_version_id, category_id) DO UPDATE SET
            name_he       = EXCLUDED.name_he,
            min_courses   = EXCLUDED.min_courses,
            display_order = EXCLUDED.display_order
        """,
        [
            (
                _new_id(), pv_id, c["category_id"], c.get("name_he"),
                c.get("min_courses", 0), c.get("max_courses"), c.get("display_order", 0),
            )
            for c in categories
        ],
    )


def _upsert_program_courses(
    cur: Any, pc_list: list[dict[str, Any]], pv_id: str
) -> None:
    if not pc_list:
        return
    import psycopg2.extras  # noqa: PLC0415

    psycopg2.extras.execute_batch(
        cur,
        """
        INSERT INTO program_courses
            (id, program_version_id, course_id, category_id,
             is_mandatory, locked_by_default, allowed_semesters, offered_semesters)
        VALUES (%s, %s, %s, %s, %s, %s, %s, %s)
        ON CONFLICT (program_version_id, course_id) DO UPDATE SET
            category_id       = COALESCE(EXCLUDED.category_id, program_courses.category_id),
            is_mandatory      = EXCLUDED.is_mandatory,
            locked_by_default = EXCLUDED.locked_by_default,
            allowed_semesters = EXCLUDED.allowed_semesters,
            offered_semesters = EXCLUDED.offered_semesters
        """,
        [
            (
                _new_id(), pv_id, c["course_id"], c.get("category_id"),
                c.get("is_mandatory", False), c.get("locked_by_default", False),
                json.dumps(c.get("allowed_semesters", []), ensure_ascii=False),
                json.dumps(c.get("offered_semesters", []), ensure_ascii=False),
            )
            for c in pc_list
        ],
    )


def _replace_grade_stats(cur: Any, stats: list[dict[str, Any]]) -> None:
    """Full replace per course_id (mirrors the SQLite save_grade_stats pattern)."""
    if not stats:
        return
    import psycopg2.extras  # noqa: PLC0415

    course_ids = list({s["course_id"] for s in stats})
    psycopg2.extras.execute_batch(
        cur, "DELETE FROM grade_stats WHERE course_id = %s", [(cid,) for cid in course_ids]
    )
    psycopg2.extras.execute_batch(
        cur,
        """
        INSERT INTO grade_stats
            (id, course_id, year, semester, moed, lecturer_name,
             average_grade, median_grade, standard_deviation,
             pass_rate, num_students, source_name, source_url, fetched_at)
        VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)
        """,
        [
            (
                _new_id(), s["course_id"], s.get("year"), s.get("semester"),
                s.get("moed"), s.get("lecturer_name"),
                s.get("average_grade"), s.get("median_grade"), s.get("standard_deviation"),
                s.get("pass_rate"), s.get("num_students"), s.get("source_name"),
                s.get("source_url"), s.get("fetched_at"),
            )
            for s in stats
        ],
    )


def _replace_syllabus_sources(cur: Any, sources: list[dict[str, Any]]) -> None:
    """Full replace per course_id for syllabus_sources (no unique constraint)."""
    if not sources:
        return
    import psycopg2.extras  # noqa: PLC0415

    course_ids = list({s["course_id"] for s in sources})
    psycopg2.extras.execute_batch(
        cur, "DELETE FROM syllabus_sources WHERE course_id = %s", [(cid,) for cid in course_ids]
    )
    psycopg2.extras.execute_batch(
        cur,
        """
        INSERT INTO syllabus_sources
            (id, course_id, year, semester, group_number, url,
             is_active, source, fetched_at)
        VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s)
        """,
        [
            (
                _new_id(), s["course_id"], s.get("year"), s.get("semester"),
                s.get("group_number"), s["url"],
                s.get("is_active", True), s.get("source", "tau_ims"), s.get("fetched_at"),
            )
            for s in sources
        ],
    )


def _insert_import_run(cur: Any, result: SeedResult) -> None:
    cur.execute(
        """
        INSERT INTO import_runs
            (id, source_name, status, completed_at,
             courses_processed, courses_inserted, metadata)
        VALUES (%s, 'seed_from_local', 'completed', now(), %s, %s, %s)
        """,
        (
            _new_id(), result.courses, result.courses,
            json.dumps({
                "program_id":    BASE_PROGRAM_ID,
                "academic_year": ACADEMIC_YEAR,
                "program_courses": result.program_courses,
                "grade_stats":     result.grade_stats,
                "course_groups":   result.course_groups,
            }),
        ),
    )


# ── Orchestration ─────────────────────────────────────────────────────────────


def seed_all(
    db_url: str | None = None,
    *,
    dry_run: bool = False,
    enriched_path: Path = _ENRICHED_PATH,
    mandatory_path: Path = _MANDATORY_PATH,
    board_path: Path = _BOARD_PATH,
    sqlite_path: Path = _SQLITE_PATH,
) -> SeedResult:
    """
    Extract data from local sources and upsert into Postgres.

    Parameters
    ----------
    db_url    : Postgres connection URL.  Falls back to settings.database_url.
                Not required when dry_run=True.
    dry_run   : If True, extract and report counts without writing to the DB.
    """
    resolved_url = db_url or settings.database_url
    if not dry_run and not resolved_url:
        raise RuntimeError(
            "DATABASE_URL is not configured.\n"
            "Set it in your .env file or pass --database-url:\n\n"
            "  DATABASE_URL=postgresql://... python -m app.pipeline.seed_postgres\n"
            "  python -m app.pipeline.seed_postgres --database-url postgresql://...\n\n"
            "Use --dry-run to preview counts without a database connection."
        )

    data = extract_all(enriched_path, mandatory_path, board_path, sqlite_path)

    if dry_run:
        mandatory_count = sum(1 for c in data.program_courses if c.get("is_mandatory"))
        return SeedResult(
            programs          = 1,
            program_versions  = 1,
            courses           = len(data.courses),
            course_offerings  = len(data.course_offerings),
            course_groups     = len(data.course_groups),
            prerequisites     = len(data.prerequisites),
            course_categories = len(data.categories),
            program_courses   = len(data.program_courses),
            mandatory_courses = mandatory_count,
            grade_stats       = len(data.grade_stats),
            syllabus_sources  = len(data.syllabus_sources),
            import_runs       = 0,
            warnings          = data.warnings,
        )

    return upsert_all(resolved_url, data)


# ── Output ────────────────────────────────────────────────────────────────────


def _print_summary(result: SeedResult, dry_run: bool) -> None:
    label = "[DRY-RUN] Would seed" if dry_run else "Seeded"
    print(f"\n{label} to Postgres:")
    print(f"  programs          : {result.programs}")
    print(f"  program_versions  : {result.program_versions}")
    print(f"  courses           : {result.courses}")
    print(f"  course_offerings  : {result.course_offerings}")
    print(f"  course_groups     : {result.course_groups}")
    print(f"  prerequisites     : {result.prerequisites}")
    print(f"  course_categories : {result.course_categories}")
    print(f"  program_courses   : {result.program_courses}")
    print(f"    of which mandatory: {result.mandatory_courses}")
    print(f"  grade_stats       : {result.grade_stats}")
    print(f"  syllabus_sources  : {result.syllabus_sources}")
    if not dry_run:
        print(f"  import_runs       : {result.import_runs}")
    if result.warnings:
        print(f"\n  warnings ({len(result.warnings)}):")
        for w in result.warnings[:10]:
            print(f"    ⚠ {w}")
        if len(result.warnings) > 10:
            print(f"    … and {len(result.warnings) - 10} more")
    print()


# ── Helpers ───────────────────────────────────────────────────────────────────


def _parse_json(raw: Any) -> list | dict:
    if not raw:
        return []
    try:
        return json.loads(raw)
    except (json.JSONDecodeError, TypeError):
        return []


# ── CLI ───────────────────────────────────────────────────────────────────────


def _build_parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(
        description="Seed Postgres from local SQLite and JSON data.",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog=(
            "Examples:\n"
            "  python -m app.pipeline.seed_postgres --dry-run\n"
            "  DATABASE_URL=postgresql://... python -m app.pipeline.seed_postgres\n"
            "  python -m app.pipeline.seed_postgres --database-url postgresql://...\n"
        ),
    )
    p.add_argument(
        "--dry-run",
        action="store_true",
        help="Print what would be seeded without writing to the database.",
    )
    p.add_argument(
        "--database-url",
        metavar="URL",
        default=None,
        help="Postgres connection URL (overrides DATABASE_URL env var).",
    )
    return p


def main(argv: list[str] | None = None) -> int:
    logging.basicConfig(level=logging.WARNING)
    args = _build_parser().parse_args(argv)

    try:
        result = seed_all(
            db_url   = args.database_url,
            dry_run  = args.dry_run,
        )
    except RuntimeError as exc:
        print(f"\nError: {exc}", file=sys.stderr)
        return 1

    _print_summary(result, dry_run=args.dry_run)
    return 0


if __name__ == "__main__":
    sys.exit(main())

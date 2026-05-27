"""
SQLite persistence layer for merged course records.

Tables
------
courses            : one row per course_id (upsert on re-import)
course_groups      : one row per group within a course
prerequisites      : one row per (course_id, prerequisite_course_id) pair
course_grade_stats : historical grade statistics (secondary/unofficial source)
"""

import json
import re
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Optional

from sqlalchemy import (
    Column,
    DateTime,
    Float,
    Integer,
    MetaData,
    String,
    Table,
    Text,
    UniqueConstraint,
    create_engine,
    select,
)

# ---------------------------------------------------------------------------
# Configuration
# ---------------------------------------------------------------------------

_DB_PATH = Path("data/database.sqlite")
_DB_URL_TEMPLATE = "sqlite:///{path}"

metadata = MetaData()

# ---------------------------------------------------------------------------
# Table definitions
# ---------------------------------------------------------------------------

courses = Table(
    "courses",
    metadata,
    Column("id",                     Integer, primary_key=True, autoincrement=True),
    Column("course_id",              String,  nullable=False, unique=True),
    Column("name_he",                Text),
    Column("name_en",                Text),
    Column("faculty",                Text),
    Column("department",             Text),
    Column("year",                   Integer),
    Column("semester",               String),
    Column("credits",                Float),
    Column("lecture_hours",          Float),
    Column("tutorial_hours",         Float),
    Column("lab_hours",              Float),
    Column("prerequisites_raw_text", Text),
    Column("course_description",     Text),
    Column("assignments",            Text),
    Column("exam_info",              Text),
    Column("topics_json",            Text),
    Column("syllabus_links_json",    Text),
    Column("source_files_json",      Text),
    Column("created_at",             DateTime),
    Column("updated_at",             DateTime),
)

course_groups = Table(
    "course_groups",
    metadata,
    Column("id",            Integer, primary_key=True, autoincrement=True),
    Column("course_id",     String,  nullable=False),
    Column("group_number",  String),
    Column("lecturer",      Text),
    Column("teaching_type", String),
    Column("day",           String),
    Column("start_time",    String),
    Column("end_time",      String),
    Column("building",      Text),
    Column("room",          String),
    Column("semester",      String),
    Column("syllabus_url",  Text),
    UniqueConstraint("course_id", "group_number", name="uq_course_group"),
)

prerequisites = Table(
    "prerequisites",
    metadata,
    Column("id",                     Integer, primary_key=True, autoincrement=True),
    Column("course_id",              String, nullable=False),
    Column("prerequisite_course_id", String, nullable=False),
    UniqueConstraint("course_id", "prerequisite_course_id", name="uq_prereq"),
)

course_grade_stats = Table(
    "course_grade_stats",
    metadata,
    Column("id",                 Integer, primary_key=True, autoincrement=True),
    Column("course_id",          String,  nullable=False),
    Column("year",               Integer),
    Column("semester",           String),
    Column("moed",               String),
    Column("lecturer_name",      Text),
    Column("average_grade",      Float),
    Column("median_grade",       Float),
    Column("standard_deviation", Float),
    Column("pass_rate",          Float),
    Column("num_students",       Integer),
    Column("source_name",        String),
    Column("source_url",         Text),
    Column("fetched_at",         String),
)


# ---------------------------------------------------------------------------
# Engine factory
# ---------------------------------------------------------------------------

def _make_engine(db_path: Path = _DB_PATH):
    db_path.parent.mkdir(parents=True, exist_ok=True)
    return create_engine(_DB_URL_TEMPLATE.format(path=db_path.as_posix()))


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------

def init_db(db_path: Path = _DB_PATH) -> None:
    """Create all tables (no-op if they already exist)."""
    engine = _make_engine(db_path)
    metadata.create_all(engine)


def save_merged_course(merged: dict[str, Any], db_path: Path = _DB_PATH) -> None:
    """Insert or replace a merged course record (upsert by course_id)."""
    engine = _make_engine(db_path)
    now = datetime.now(timezone.utc)
    course_id = merged["course_id"]

    with engine.begin() as conn:
        # ── courses ────────────────────────────────────────────────────────
        existing = conn.execute(
            select(courses.c.id, courses.c.created_at).where(courses.c.course_id == course_id)
        ).first()

        row = {
            "course_id":              course_id,
            "name_he":                merged.get("name_he"),
            "name_en":                merged.get("name_en"),
            "faculty":                merged.get("faculty"),
            "department":             merged.get("department"),
            "year":                   merged.get("year"),
            "semester":               merged.get("semester"),
            "credits":                merged.get("credits"),
            "lecture_hours":          merged.get("lecture_hours"),
            "tutorial_hours":         merged.get("tutorial_hours"),
            "lab_hours":              merged.get("lab_hours"),
            "prerequisites_raw_text": merged.get("prerequisites_raw_text"),
            "course_description":     merged.get("course_description"),
            "assignments":            merged.get("assignments"),
            "exam_info":              merged.get("exam_info"),
            "topics_json":            json.dumps(merged.get("topics", []),          ensure_ascii=False),
            "syllabus_links_json":    json.dumps(merged.get("syllabus_links", []), ensure_ascii=False),
            "source_files_json":      json.dumps(merged.get("source_files", {}),   ensure_ascii=False),
            "updated_at":             now,
        }

        if existing:
            row["created_at"] = existing.created_at
            conn.execute(
                courses.update().where(courses.c.course_id == course_id).values(**row)
            )
        else:
            row["created_at"] = now
            conn.execute(courses.insert().values(**row))

        # ── course_groups (delete + re-insert) ─────────────────────────────
        conn.execute(
            course_groups.delete().where(course_groups.c.course_id == course_id)
        )
        for g in merged.get("groups", []):
            start_time, end_time = _split_time_slot(g.get("time_slot"))
            conn.execute(course_groups.insert().values(
                course_id     = course_id,
                group_number  = g.get("group_num"),
                lecturer      = ", ".join(g.get("teachers", [])),
                teaching_type = g.get("teaching_method"),
                day           = g.get("day"),
                start_time    = start_time,
                end_time      = end_time,
                building      = g.get("building"),
                room          = g.get("room"),
                semester      = g.get("semester"),
                syllabus_url  = g.get("syllabus_url"),
            ))

        # ── prerequisites (delete + re-insert) ─────────────────────────────
        conn.execute(
            prerequisites.delete().where(prerequisites.c.course_id == course_id)
        )
        for prereq_id in merged.get("prerequisite_course_ids", []):
            conn.execute(prerequisites.insert().values(
                course_id              = course_id,
                prerequisite_course_id = prereq_id,
            ))


def get_course_by_id(course_id: str, db_path: Path = _DB_PATH) -> Optional[dict[str, Any]]:
    """Return the merged course dict for a given course_id, or None if not found."""
    normalized = _normalize_course_id(course_id)
    engine = _make_engine(db_path)

    with engine.connect() as conn:
        row = conn.execute(
            select(courses).where(courses.c.course_id == normalized)
        ).mappings().first()

        if row is None:
            return None

        result = dict(row)
        result["topics"]         = json.loads(result.pop("topics_json")         or "[]")
        result["syllabus_links"] = json.loads(result.pop("syllabus_links_json") or "[]")
        result["source_files"]   = json.loads(result.pop("source_files_json")   or "{}")

        groups_rows = conn.execute(
            select(course_groups).where(course_groups.c.course_id == normalized)
        ).mappings().all()
        result["groups"] = [dict(r) for r in groups_rows]

        prereq_rows = conn.execute(
            select(prerequisites.c.prerequisite_course_id).where(
                prerequisites.c.course_id == normalized
            )
        ).all()
        result["prerequisite_course_ids"] = [r[0] for r in prereq_rows]

        return result


def get_course_display_name(
    course_id: str,
    db_path: Path = _DB_PATH,
) -> str | None:
    """Return name_he (or name_en fallback) for *course_id*, or None if not found."""
    if not db_path.exists():
        return None
    normalized = _normalize_course_id(course_id)
    engine = _make_engine(db_path)
    with engine.connect() as conn:
        row = conn.execute(
            select(courses.c.name_he, courses.c.name_en)
            .where(courses.c.course_id == normalized)
        ).first()
    if row is None:
        return None
    return row.name_he or row.name_en or None


def get_course_display_names(
    course_ids: list[str],
    db_path: Path = _DB_PATH,
) -> dict[str, str | None]:
    """
    Batch lookup of display names.

    Returns {original_course_id -> display_name}.  Missing entries map to None.
    The input IDs are normalised internally so callers need not pre-normalise.
    """
    if not course_ids or not db_path.exists():
        return {cid: None for cid in course_ids}
    norm_map = {cid: _normalize_course_id(cid) for cid in course_ids}
    engine = _make_engine(db_path)
    with engine.connect() as conn:
        rows = conn.execute(
            select(courses.c.course_id, courses.c.name_he, courses.c.name_en)
            .where(courses.c.course_id.in_(set(norm_map.values())))
        ).all()
    db_names: dict[str, str | None] = {
        row.course_id: row.name_he or row.name_en or None for row in rows
    }
    return {cid: db_names.get(norm_map[cid]) for cid in course_ids}


def save_grade_stats(
    stats: list,          # list[CourseGradeStats] — avoid circular import with string type
    db_path: Path = _DB_PATH,
) -> int:
    """
    Replace all grade-stat rows for the courses present in *stats*, then
    insert fresh rows.  Returns the number of rows inserted.

    Accepts a list of CourseGradeStats (or plain dicts with the same keys).
    Treats unofficial grade data as a full-replace cache: every import of a
    course wipes its previous rows to avoid duplicates.
    """
    if not stats:
        return 0
    engine = _make_engine(db_path)

    def _val(record, key: str):
        return getattr(record, key, None) if not isinstance(record, dict) else record.get(key)

    with engine.begin() as conn:
        affected_ids: set[str] = set()
        for s in stats:
            cid = _normalize_course_id(_val(s, "course_id") or "")
            if cid:
                affected_ids.add(cid)

        for cid in affected_ids:
            conn.execute(
                course_grade_stats.delete().where(course_grade_stats.c.course_id == cid)
            )

        inserted = 0
        for s in stats:
            cid = _normalize_course_id(_val(s, "course_id") or "")
            if not cid:
                continue
            conn.execute(course_grade_stats.insert().values(
                course_id          = cid,
                year               = _val(s, "year"),
                semester           = _val(s, "semester"),
                moed               = _val(s, "moed"),
                lecturer_name      = _val(s, "lecturer_name"),
                average_grade      = _val(s, "average_grade"),
                median_grade       = _val(s, "median_grade"),
                standard_deviation = _val(s, "standard_deviation"),
                pass_rate          = _val(s, "pass_rate"),
                num_students       = _val(s, "num_students"),
                source_name        = _val(s, "source_name") or "TAU Refactor",
                source_url         = _val(s, "source_url"),
                fetched_at         = _val(s, "fetched_at") or "",
            ))
            inserted += 1
    return inserted


def get_grade_stats(course_id: str, db_path: Path = _DB_PATH) -> list:
    """
    Return all grade-stat rows for *course_id* as CourseGradeStats instances.
    Returns an empty list if the table does not exist or course is not found.
    """
    from app.models.grade_stats import CourseGradeStats  # local to avoid circular at module load

    if not db_path.exists():
        return []
    normalized = _normalize_course_id(course_id)
    engine = _make_engine(db_path)
    try:
        with engine.connect() as conn:
            rows = conn.execute(
                select(course_grade_stats).where(
                    course_grade_stats.c.course_id == normalized
                ).order_by(
                    course_grade_stats.c.year.desc(),
                    course_grade_stats.c.semester,
                    course_grade_stats.c.moed,
                )
            ).mappings().all()
        return [CourseGradeStats.model_validate(dict(r)) for r in rows]
    except Exception:
        return []


def list_courses(db_path: Path = _DB_PATH) -> list[dict[str, Any]]:
    """Return a list of summary dicts (course_id, name_he, year, semester, faculty)."""
    engine = _make_engine(db_path)
    with engine.connect() as conn:
        rows = conn.execute(
            select(
                courses.c.course_id,
                courses.c.name_he,
                courses.c.year,
                courses.c.semester,
                courses.c.faculty,
            ).order_by(courses.c.course_id)
        ).mappings().all()
    return [dict(r) for r in rows]


def get_prerequisites(course_id: str, db_path: Path = _DB_PATH) -> list[str]:
    """Return prerequisite course IDs for a course."""
    normalized = _normalize_course_id(course_id)
    engine = _make_engine(db_path)
    with engine.connect() as conn:
        rows = conn.execute(
            select(prerequisites.c.prerequisite_course_id).where(
                prerequisites.c.course_id == normalized
            )
        ).all()
    return [r[0] for r in rows]


# ---------------------------------------------------------------------------
# Internal helpers
# ---------------------------------------------------------------------------

def _split_time_slot(time_slot: Optional[str]) -> tuple[Optional[str], Optional[str]]:
    """Split '12:00-15:00' into ('12:00', '15:00'). Returns (None, None) if absent."""
    if not time_slot:
        return None, None
    parts = time_slot.split("-", 1)
    if len(parts) == 2:
        return parts[0].strip(), parts[1].strip()
    return time_slot.strip(), None


def _normalize_course_id(raw: str) -> str:
    """Convert '03682157' or '0368-2157' to '0368-2157'."""
    digits = re.sub(r"\D", "", raw)
    if len(digits) == 8:
        return f"{digits[:4]}-{digits[4:]}"
    return raw


# ---------------------------------------------------------------------------
# CLI
# ---------------------------------------------------------------------------

if __name__ == "__main__":
    import argparse

    cli = argparse.ArgumentParser(description="TAU course database CLI")
    cli.add_argument("--init",               action="store_true", help="Create tables")
    cli.add_argument("--import-merged-json", metavar="PATH",      help="Import a merged JSON file")
    cli.add_argument("--get-course",         metavar="COURSE_ID", help="Print course record")
    cli.add_argument("--list-courses",       action="store_true", help="List all courses")
    cli.add_argument("--db",                 metavar="PATH",      default=str(_DB_PATH),
                     help=f"Database path (default: {_DB_PATH})")
    args = cli.parse_args()

    db_path = Path(args.db)

    if args.init:
        init_db(db_path)
        print(f"[db] Tables created in {db_path}")

    elif args.import_merged_json:
        p = Path(args.import_merged_json)
        if not p.exists():
            print(f"[error] File not found: {p}")
            raise SystemExit(1)
        merged = json.loads(p.read_text(encoding="utf-8"))
        init_db(db_path)
        save_merged_course(merged, db_path)
        print(f"[db] Imported course_id={merged['course_id']} groups={len(merged.get('groups', []))} prereqs={len(merged.get('prerequisite_course_ids', []))}")

    elif args.get_course:
        record = get_course_by_id(args.get_course, db_path)
        if record is None:
            print(f"[db] Course not found: {args.get_course}")
        else:
            print(f"course_id  : {record['course_id']}")
            print(f"year       : {record['year']}")
            print(f"semester   : {record['semester']}")
            print(f"faculty    : {record['faculty']}")
            print(f"credits    : {record['credits']}")
            print(f"lecture_h  : {record['lecture_hours']}")
            print(f"groups     : {len(record['groups'])}")
            print(f"prereqs    : {record['prerequisite_course_ids']}")

    elif args.list_courses:
        rows = list_courses(db_path)
        if not rows:
            print("[db] No courses in database.")
        else:
            for r in rows:
                print(f"  {r['course_id']}  year={r['year']}  sem={r['semester']}  faculty={r['faculty']}")

    else:
        cli.print_help()

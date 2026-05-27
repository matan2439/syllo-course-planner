"""
Eligibility engine: given a set of completed courses, determine which courses
in the database are eligible (all prerequisites met) or blocked.
"""

import re
from pathlib import Path
from typing import Any

from app.database.db import _DB_PATH, _make_engine, prerequisites, courses
from sqlalchemy import select


# ---------------------------------------------------------------------------
# Normalisation
# ---------------------------------------------------------------------------

def normalize_course_id(course_id: str) -> str:
    """Convert '03682157' or '0368.2157' to '0368-2157'."""
    digits = re.sub(r"\D", "", course_id)
    if len(digits) == 8:
        return f"{digits[:4]}-{digits[4:]}"
    return course_id


# ---------------------------------------------------------------------------
# Core check
# ---------------------------------------------------------------------------

def check_course_eligibility(
    course_id: str,
    completed_course_ids: list[str],
    db_path: Path = _DB_PATH,
) -> dict[str, Any]:
    """
    Return an eligibility record for one course.

    Keys
    ----
    course_id              : normalised course ID
    eligible               : True if all direct prerequisites are satisfied
    direct_prerequisites   : list of all direct prerequisite IDs
    satisfied_prerequisites: subset of direct_prerequisites that are completed
    missing_prerequisites  : subset of direct_prerequisites that are not completed
    explanation            : human-readable summary string
    """
    normalized = normalize_course_id(course_id)
    completed_set = {normalize_course_id(c) for c in completed_course_ids if c.strip()}

    engine = _make_engine(db_path)
    with engine.connect() as conn:
        rows = conn.execute(
            select(prerequisites.c.prerequisite_course_id).where(
                prerequisites.c.course_id == normalized
            )
        ).all()

    direct_prereqs = [r[0] for r in rows]
    satisfied = [p for p in direct_prereqs if normalize_course_id(p) in completed_set]
    missing   = [p for p in direct_prereqs if normalize_course_id(p) not in completed_set]
    eligible  = len(missing) == 0

    if not direct_prereqs:
        explanation = "No prerequisites — always eligible."
    elif eligible:
        explanation = f"All {len(direct_prereqs)} prerequisite(s) satisfied."
    else:
        explanation = f"Missing {len(missing)} prerequisite(s): {missing}."

    return {
        "course_id":               normalized,
        "eligible":                eligible,
        "direct_prerequisites":    direct_prereqs,
        "satisfied_prerequisites": satisfied,
        "missing_prerequisites":   missing,
        "explanation":             explanation,
    }


# ---------------------------------------------------------------------------
# Bulk queries
# ---------------------------------------------------------------------------

def list_eligible_courses(
    completed_course_ids: list[str],
    db_path: Path = _DB_PATH,
) -> list[dict[str, Any]]:
    """Return eligibility records for every course in the DB that is eligible."""
    all_ids = _all_course_ids(db_path)
    results = [check_course_eligibility(cid, completed_course_ids, db_path) for cid in all_ids]
    return [r for r in results if r["eligible"]]


def list_blocked_courses(
    completed_course_ids: list[str],
    db_path: Path = _DB_PATH,
) -> list[dict[str, Any]]:
    """Return eligibility records for every course in the DB that is blocked."""
    all_ids = _all_course_ids(db_path)
    results = [check_course_eligibility(cid, completed_course_ids, db_path) for cid in all_ids]
    return [r for r in results if not r["eligible"]]


# ---------------------------------------------------------------------------
# Internal helpers
# ---------------------------------------------------------------------------

def _all_course_ids(db_path: Path) -> list[str]:
    engine = _make_engine(db_path)
    with engine.connect() as conn:
        rows = conn.execute(select(courses.c.course_id).order_by(courses.c.course_id)).all()
    return [r[0] for r in rows]


# ---------------------------------------------------------------------------
# CLI
# ---------------------------------------------------------------------------

if __name__ == "__main__":
    import argparse

    cli = argparse.ArgumentParser(description="TAU course eligibility CLI")
    cli.add_argument("--check-course", metavar="COURSE_ID",
                     help="Check eligibility for a single course")
    cli.add_argument("--completed",    metavar="IDS",       nargs="?", const="", default="",
                     help="Comma-separated list of completed course IDs (omit or pass '' for none)")
    cli.add_argument("--eligible",     action="store_true",
                     help="List all eligible courses")
    cli.add_argument("--blocked",      action="store_true",
                     help="List all blocked courses")
    cli.add_argument("--db",           metavar="PATH",      default=str(_DB_PATH),
                     help=f"Database path (default: {_DB_PATH})")
    args = cli.parse_args()

    db_path   = Path(args.db)
    completed = [c.strip() for c in args.completed.split(",") if c.strip()]

    if args.check_course:
        r = check_course_eligibility(args.check_course, completed, db_path)
        print(f"course_id  : {r['course_id']}")
        print(f"eligible   : {r['eligible']}")
        print(f"prereqs    : {r['direct_prerequisites']}")
        print(f"satisfied  : {r['satisfied_prerequisites']}")
        print(f"missing    : {r['missing_prerequisites']}")
        print(f"explanation: {r['explanation']}")

    elif args.eligible:
        rows = list_eligible_courses(completed, db_path)
        print(f"[eligibility] {len(rows)} eligible course(s):")
        for r in rows:
            print(f"  {r['course_id']}  {r['explanation']}")

    elif args.blocked:
        rows = list_blocked_courses(completed, db_path)
        print(f"[eligibility] {len(rows)} blocked course(s):")
        for r in rows:
            print(f"  {r['course_id']}  {r['explanation']}")

    else:
        cli.print_help()

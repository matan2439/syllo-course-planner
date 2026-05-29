"""
Verification report for grade statistics infrastructure and 2027 board data.

Usage:
    python -m app.pipeline.verify_grade_stats
"""

from __future__ import annotations

import json
import sqlite3
from pathlib import Path

_DB_PATH    = Path("data/database.sqlite")
_BOARD_PATH = Path("data/parsed_json/mechanical_semester_board_2027.json")
_CONFIG_PATH = Path("data/config/grade_sources.json")


def verify() -> dict:
    # ── DB state ──────────────────────────────────────────────────────────────
    table_exists = False
    row_count    = 0
    source_names: list[str] = []
    sample_courses: list[dict] = []

    if _DB_PATH.exists():
        conn = sqlite3.connect(_DB_PATH)
        tables = [r[0] for r in conn.execute(
            "SELECT name FROM sqlite_master WHERE type='table'"
        ).fetchall()]
        table_exists = "course_grade_stats" in tables
        if table_exists:
            row_count = conn.execute("SELECT COUNT(*) FROM course_grade_stats").fetchone()[0]
            raw_names = conn.execute(
                "SELECT DISTINCT source_name FROM course_grade_stats"
            ).fetchall()
            source_names = [r[0] for r in raw_names if r[0]]
            sample_rows = conn.execute(
                "SELECT course_id, average_grade, num_students, source_name "
                "FROM course_grade_stats LIMIT 5"
            ).fetchall()
            sample_courses = [
                {"course_id": r[0], "avg": r[1], "n": r[2], "source": r[3]}
                for r in sample_rows
            ]
        conn.close()

    # ── Source config ─────────────────────────────────────────────────────────
    from app.grades.grade_stats_importer import get_configured_source_url, _ENV_VAR
    source_url = get_configured_source_url()
    source_configured = source_url is not None

    # ── Board stats ───────────────────────────────────────────────────────────
    from collections import Counter
    tf_counts: Counter = Counter()
    repo_count = 0
    sample_missing: list[dict] = []

    if _BOARD_PATH.exists():
        board = json.loads(_BOARD_PATH.read_text(encoding="utf-8"))
        repo  = board["metadata"].get("program_repository_courses", [])
        repo_count = len(repo)
        for r in repo:
            status = r.get("tau_factor_status", "unknown")
            tf_counts[status] += 1
            if status not in ("matched",) and len(sample_missing) < 5:
                sample_missing.append({
                    "course_id":       r["course_id"],
                    "lookup_id":       r.get("tau_factor_lookup_id"),
                    "status":          status,
                })

    return {
        "table_exists":      table_exists,
        "row_count":         row_count,
        "source_names":      source_names,
        "sample_courses":    sample_courses,
        "source_configured": source_configured,
        "source_url":        source_url,
        "env_var":           _ENV_VAR,
        "config_path":       str(_CONFIG_PATH),
        "repo_courses_checked": repo_count,
        "matched":           tf_counts.get("matched", 0),
        "source_unconfigured": tf_counts.get("source_unconfigured", 0),
        "not_started":       tf_counts.get("not_started", 0),
        "not_found":         tf_counts.get("not_found", 0),
        "failed":            tf_counts.get("failed", 0),
        "sample_missing":    sample_missing,
    }


def main() -> None:
    v = verify()

    print("=" * 55)
    print("Grade Stats Verification")
    print("=" * 55)
    print(f"  course_grade_stats table exists : {v['table_exists']}")
    print(f"  grade stat rows in DB           : {v['row_count']}")
    if v["source_names"]:
        print(f"  source names                    : {v['source_names']}")
    if v["sample_courses"]:
        print(f"  sample matched courses:")
        for c in v["sample_courses"]:
            print(f"    {c['course_id']}  avg={c['avg']}  n={c['n']}  src={c['source']}")
    print()
    print(f"  source URL configured           : {v['source_configured']}")
    if v["source_configured"]:
        print(f"    url: {v['source_url']}")
    else:
        print(f"    set {v['env_var']} or edit {v['config_path']}")
    print()
    print(f"  2027 repo courses checked       : {v['repo_courses_checked']}")
    print(f"  matched grade stats             : {v['matched']}")
    print(f"  source_unconfigured             : {v['source_unconfigured']}")
    print(f"  not_started                     : {v['not_started']}")
    print(f"  not_found                       : {v['not_found']}")
    print(f"  failed                          : {v['failed']}")
    if v["sample_missing"]:
        print(f"  sample unmatched courses:")
        for c in v["sample_missing"]:
            print(f"    {c['course_id']} (lookup: {c['lookup_id']}) status={c['status']}")

    print()
    print("How to import grade data:")
    print("  python -m app.grades.grade_stats_importer --file path/to/grades.json")
    print("  python -m app.grades.grade_stats_importer --file path/to/grades.csv")
    print("  python -m app.grades.grade_stats_importer --source-url https://...")


if __name__ == "__main__":
    main()

"""
Elective audit report.

For each course in a user-supplied list, reports eligibility, difficulty,
weekly hours, and prerequisite status against a set of completed courses.
"""

import csv
import json
from pathlib import Path
from typing import Any

from app.database.db import _DB_PATH, get_course_by_id, get_course_display_names, get_grade_stats
from app.analysis.eligibility_engine import check_course_eligibility, normalize_course_id
from app.analysis.difficulty_estimator import estimate_course_difficulty
from app.analysis.instructor_uncertainty import estimate_instructor_uncertainty
from app.pipeline.bulk_import_courses import load_course_ids


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------

def audit_courses(
    course_ids: list[str],
    completed_course_ids: list[str],
    max_difficulty: float | None = None,
    max_weekly_hours: float | None = None,
    program_requirements: dict[str, Any] | None = None,
    db_path: Path = _DB_PATH,
) -> list[dict[str, Any]]:
    """
    Return one audit record per course ID.

    Statuses
    --------
    eligible         : in DB, all prereqs satisfied, passes filters
    blocked          : in DB, one or more prereqs missing
    missing_from_db  : course ID not found in the database
    filtered_out     : eligible but excluded by max_difficulty / max_weekly_hours
    """
    results: list[dict[str, Any]] = []

    for course_id in course_ids:
        normalized = normalize_course_id(course_id)
        record = get_course_by_id(normalized, db_path)

        # Load grade stats once — reused by both difficulty estimator and instructor uncertainty
        grade_stats = get_grade_stats(normalized, db_path)

        if record is None:
            results.append({
                "course_id":                      normalized,
                "name_he":                        None,
                "status":                         "missing_from_db",
                "missing_prerequisites":          [],
                "missing_prerequisite_details":   [],
                "satisfied_prerequisites":        [],
                "grade_signal":                   None,
                "difficulty_score":               None,
                "difficulty_level":               None,
                "workload_score":                 None,
                "conceptual_complexity_score":    None,
                "prerequisite_depth_score":       None,
                "assessment_intensity_score":     None,
                "difficulty_confidence":          None,
                "difficulty_warnings":            [],
                "instructor_uncertainty":         estimate_instructor_uncertainty(None, grade_stats),
                "weekly_hours":                   None,
                "syllabus_url":                   None,
                "syllabus_links":                 [],
                "reasons":                        ["Not found in database."],
            })
            continue

        elig = check_course_eligibility(normalized, completed_course_ids, db_path)
        diff = estimate_course_difficulty(normalized, db_path, grade_stats=grade_stats)
        inst = estimate_instructor_uncertainty(record, grade_stats)
        weekly_hours = _sum_hours(record)

        difficulty_score = diff["final_difficulty_score"]
        difficulty_level = diff["difficulty_level"]

        # Syllabus URL fallback chain
        syllabus_links: list[str] = record.get("syllabus_links") or []
        syllabus_url: str | None = None
        for g in record.get("groups") or []:
            if g.get("syllabus_url"):
                syllabus_url = g["syllabus_url"]
                break
        if not syllabus_url and syllabus_links:
            syllabus_url = syllabus_links[0]

        reasons: list[str] = [elig["explanation"]]
        if difficulty_level:
            reasons.append(f"Difficulty: {difficulty_level} ({difficulty_score}).")
        if weekly_hours:
            reasons.append(f"Weekly hours: {weekly_hours}.")

        # Batch lookup for missing prerequisite display names
        missing_prereq_ids = elig["missing_prerequisites"]
        missing_prereq_name_map = (
            get_course_display_names(missing_prereq_ids, db_path) if missing_prereq_ids else {}
        )
        missing_prerequisite_details = [
            {
                "course_id":   p,
                "name_he":     missing_prereq_name_map.get(p),
                "known_in_db": missing_prereq_name_map.get(p) is not None,
            }
            for p in missing_prereq_ids
        ]

        # Determine status
        if not elig["eligible"]:
            status = "blocked"
        elif max_difficulty is not None and difficulty_score is not None and difficulty_score > max_difficulty:
            status = "filtered_out"
            reasons.append(f"Filtered: difficulty {difficulty_score} > max {max_difficulty}.")
        elif max_weekly_hours is not None and weekly_hours is not None and weekly_hours > max_weekly_hours:
            status = "filtered_out"
            reasons.append(f"Filtered: weekly hours {weekly_hours} > max {max_weekly_hours}.")
        else:
            status = "eligible"

        results.append({
            "course_id":                   normalized,
            "name_he":                     record.get("name_he"),
            "status":                      status,
            "missing_prerequisites":       elig["missing_prerequisites"],
            "missing_prerequisite_details": missing_prerequisite_details,
            "satisfied_prerequisites":     elig["satisfied_prerequisites"],
            "grade_signal":                diff.get("grade_signal"),
            "difficulty_score":            difficulty_score,
            "difficulty_level":            difficulty_level,
            "workload_score":              diff.get("workload_score"),
            "conceptual_complexity_score": diff.get("conceptual_complexity_score"),
            "prerequisite_depth_score":    diff.get("prerequisite_depth_score"),
            "assessment_intensity_score":  diff.get("assessment_intensity_score"),
            "difficulty_confidence":       diff.get("confidence"),
            "difficulty_warnings":         diff.get("warnings", []),
            "instructor_uncertainty":      inst,
            "weekly_hours":                weekly_hours,
            "syllabus_url":                syllabus_url,
            "syllabus_links":              syllabus_links,
            "reasons":                     reasons,
        })

    if program_requirements is not None:
        _enrich_with_categories(results, program_requirements)

    return results


def _enrich_with_categories(
    results: list[dict[str, Any]],
    program_requirements: dict[str, Any],
) -> None:
    """Add program_category_id / name_he / needs_category_review to each record."""
    from app.analysis.program_requirements import build_course_category_map
    cat_map = build_course_category_map(program_requirements)
    for r in results:
        info = cat_map.get(r["course_id"])
        r["program_category_id"]      = info["category_id"]   if info else None
        r["program_category_name_he"] = info["name_he"]       if info else None
        r["needs_category_review"]    = info["needs_review"]  if info else False


# ---------------------------------------------------------------------------
# Formatting helpers
# ---------------------------------------------------------------------------

def print_audit_table(results: list[dict[str, Any]]) -> None:
    """Print a concise fixed-width table to stdout."""
    counts: dict[str, int] = {}
    for r in results:
        counts[r["status"]] = counts.get(r["status"], 0) + 1

    print(
        f"SUMMARY:  eligible={counts.get('eligible', 0)}"
        f"  blocked={counts.get('blocked', 0)}"
        f"  missing_from_db={counts.get('missing_from_db', 0)}"
        f"  filtered_out={counts.get('filtered_out', 0)}"
    )
    print()

    header = f"{'COURSE_ID':<14} {'STATUS':<17} {'DIFF':>5}  {'HOURS':>5}  MISSING_PREREQS"
    print(header)
    print("-" * len(header))

    for r in results:
        diff  = f"{r['difficulty_score']:.2f}" if r["difficulty_score"] is not None else "-"
        hours = f"{r['weekly_hours']:.1f}"     if r["weekly_hours"]     is not None else "-"
        missing = ", ".join(r["missing_prerequisites"]) if r["missing_prerequisites"] else ""
        print(f"{r['course_id']:<14} {r['status']:<17} {diff:>5}  {hours:>5}  {missing}")


# ---------------------------------------------------------------------------
# CSV export
# ---------------------------------------------------------------------------

_CSV_COLUMNS = [
    "course_id", "name_he", "status",
    "missing_prerequisites", "satisfied_prerequisites",
    "difficulty_score", "difficulty_level", "weekly_hours",
    "reasons",
]
_LIST_FIELDS = {"missing_prerequisites", "satisfied_prerequisites", "reasons"}


def write_audit_csv(results: list[dict[str, Any]], path: Path) -> None:
    """Write audit results to a UTF-8-BOM CSV so Hebrew opens correctly in Excel."""
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", encoding="utf-8-sig", newline="") as f:
        writer = csv.DictWriter(f, fieldnames=_CSV_COLUMNS)
        writer.writeheader()
        for r in results:
            row = {}
            for col in _CSV_COLUMNS:
                val = r.get(col)
                if col in _LIST_FIELDS and isinstance(val, list):
                    row[col] = "; ".join(str(v) for v in val)
                elif val is None:
                    row[col] = ""
                else:
                    row[col] = val
            writer.writerow(row)


# ---------------------------------------------------------------------------
# Internal helpers
# ---------------------------------------------------------------------------

def _sum_hours(record: dict[str, Any]) -> float | None:
    values = [
        record.get("lecture_hours"),
        record.get("tutorial_hours"),
        record.get("lab_hours"),
    ]
    known = [v for v in values if v is not None]
    return sum(known) if known else None


# ---------------------------------------------------------------------------
# CLI
# ---------------------------------------------------------------------------

if __name__ == "__main__":
    import argparse

    cli = argparse.ArgumentParser(description="TAU elective audit report")
    cli.add_argument("--file",             required=True,
                     help="Path to course list file")
    cli.add_argument("--completed",        default=None, nargs="?", const="",
                     help="Comma-separated completed course IDs (overrides profile)")
    cli.add_argument("--profile",          default=None, metavar="PATH",
                     help="Path to user profile JSON")
    cli.add_argument("--max-difficulty",   type=float, default=None,
                     help="Mark courses above this difficulty as filtered_out (overrides profile)")
    cli.add_argument("--max-weekly-hours", type=float, default=None,
                     help="Mark courses above this hour count as filtered_out (overrides profile)")
    cli.add_argument("--program-json",      default=None, metavar="PATH",
                     help="Path to program JSON — enriches courses with category info")
    cli.add_argument("--output-json",      default=None,
                     help="Save full JSON report to this path")
    cli.add_argument("--output-csv",       default=None,
                     help="Save CSV report (UTF-8-BOM) to this path")
    cli.add_argument("--db",              default=str(_DB_PATH),
                     help=f"Database path (default: {_DB_PATH})")
    args = cli.parse_args()

    src = Path(args.file)
    if not src.exists():
        print(f"[error] File not found: {src}")
        raise SystemExit(1)

    # Load profile (if provided) then let explicit CLI flags override
    profile = None
    if args.profile:
        from app.models.user_profile import load_user_profile
        profile = load_user_profile(args.profile)
        print(f"[audit] Profile: {profile.profile_name}")

    if args.completed is not None:
        completed = [c.strip() for c in args.completed.split(",") if c.strip()]
    elif profile:
        completed = list(profile.completed_course_ids)
    else:
        completed = []

    max_difficulty   = args.max_difficulty   if args.max_difficulty   is not None else (profile.max_difficulty   if profile else None)
    max_weekly_hours = args.max_weekly_hours if args.max_weekly_hours is not None else (profile.max_weekly_hours if profile else None)

    course_ids = load_course_ids(src)
    db_path    = Path(args.db)

    prog_reqs = None
    if args.program_json:
        from app.analysis.program_requirements import load_program_requirements
        prog_path = Path(args.program_json)
        if prog_path.exists():
            prog_reqs = load_program_requirements(prog_path)
            print(f"[audit] Program: {prog_reqs.get('program_name_he') or prog_path.name}")
        else:
            print(f"[warn] Program JSON not found: {prog_path}")

    print(f"[audit] {len(course_ids)} course(s) from {src.name}  "
          f"completed={len(completed)}")
    print()

    results = audit_courses(
        course_ids           = course_ids,
        completed_course_ids = completed,
        max_difficulty       = max_difficulty,
        max_weekly_hours     = max_weekly_hours,
        program_requirements = prog_reqs,
        db_path              = db_path,
    )

    print_audit_table(results)

    if args.output_json:
        out = Path(args.output_json)
        out.parent.mkdir(parents=True, exist_ok=True)
        out.write_text(json.dumps(results, ensure_ascii=False, indent=2), encoding="utf-8")
        print(f"\n[audit] JSON saved to {out}")

    if args.output_csv:
        out_csv = Path(args.output_csv)
        write_audit_csv(results, out_csv)
        print(f"[audit] CSV saved to {out_csv}")

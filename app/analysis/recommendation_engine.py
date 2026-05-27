"""
Basic rule-based course recommendation engine.

Eligible courses are ranked by:
  1. Unlocked dependents count (more = better)
  2. Lower difficulty (lower = better)
  3. Data completeness (more fields filled = better)
"""

from pathlib import Path
from typing import Any

from app.database.db import _DB_PATH, _make_engine, courses
from app.analysis.eligibility_engine import check_course_eligibility, normalize_course_id
from app.analysis.difficulty_estimator import estimate_course_difficulty
from app.analysis.prerequisite_graph import get_direct_dependent_courses
from sqlalchemy import select


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------

def recommend_courses(
    completed_course_ids: list[str],
    max_difficulty: float | None = None,
    max_weekly_hours: float | None = None,
    limit: int = 10,
    db_path: Path = _DB_PATH,
) -> list[dict[str, Any]]:
    """
    Return up to `limit` recommended courses, ranked best-first.

    Filters applied (in order):
      - not already completed
      - eligible (all direct prerequisites satisfied)
      - difficulty_score <= max_difficulty  (if provided)
      - weekly_hours     <= max_weekly_hours (if provided)
    """
    completed_set = {normalize_course_id(c) for c in completed_course_ids if c.strip()}
    all_courses   = _load_all_courses(db_path)

    recommendations: list[dict[str, Any]] = []

    for row in all_courses:
        course_id = row["course_id"]

        # skip already completed
        if course_id in completed_set:
            continue

        # eligibility check
        elig = check_course_eligibility(course_id, completed_course_ids, db_path)
        if not elig["eligible"]:
            continue

        # difficulty
        diff = estimate_course_difficulty(course_id, db_path)
        difficulty_score = diff["difficulty_score"]
        difficulty_level = diff["difficulty_level"]

        if max_difficulty is not None and difficulty_score is not None:
            if difficulty_score > max_difficulty:
                continue

        # weekly hours
        weekly_hours = _sum_hours(row)
        if max_weekly_hours is not None and weekly_hours is not None:
            if weekly_hours > max_weekly_hours:
                continue

        # unlocked dependents
        unlocked = get_direct_dependent_courses(course_id, db_path)
        unlocked_count = len(unlocked)

        # reasons
        reasons = _build_reasons(elig, diff, unlocked_count, weekly_hours)

        # ranking key (higher = better)
        rank = _rank_score(difficulty_score, unlocked_count, row)

        recommendations.append({
            "course_id":              course_id,
            "name_he":                row.get("name_he"),
            "difficulty_score":       difficulty_score,
            "difficulty_level":       difficulty_level,
            "weekly_hours":           weekly_hours,
            "direct_prerequisites":   elig["direct_prerequisites"],
            "unlocked_courses_count": unlocked_count,
            "reasons":                reasons,
            "_rank":                  rank,
        })

    recommendations.sort(key=lambda r: r["_rank"], reverse=True)
    for r in recommendations:
        del r["_rank"]

    return recommendations[:limit]


# ---------------------------------------------------------------------------
# Internal helpers
# ---------------------------------------------------------------------------

def _load_all_courses(db_path: Path) -> list[dict[str, Any]]:
    engine = _make_engine(db_path)
    with engine.connect() as conn:
        rows = conn.execute(select(courses).order_by(courses.c.course_id)).mappings().all()
    return [dict(r) for r in rows]


def _sum_hours(row: dict[str, Any]) -> float:
    return sum(
        h for h in (row.get("lecture_hours"), row.get("tutorial_hours"), row.get("lab_hours"))
        if h is not None
    )


def _rank_score(difficulty_score: float | None, unlocked_count: int, row: dict[str, Any]) -> float:
    score = 0.0
    # more unlocked dependents is a strong positive signal
    score += unlocked_count * 2.0
    # lower difficulty is preferred
    if difficulty_score is not None:
        score -= difficulty_score * 0.5
    # data completeness bonus
    score += _completeness_bonus(row)
    return score


def _completeness_bonus(row: dict[str, Any]) -> float:
    bonus = 0.0
    if row.get("name_he"):            bonus += 0.2
    if row.get("course_description"): bonus += 0.3
    if row.get("lecture_hours"):      bonus += 0.2
    if row.get("exam_info"):          bonus += 0.15
    if row.get("assignments"):        bonus += 0.15
    return bonus


def _build_reasons(
    elig: dict[str, Any],
    diff: dict[str, Any],
    unlocked_count: int,
    weekly_hours: float,
) -> list[str]:
    reasons = []
    n = len(elig["satisfied_prerequisites"])
    if n == 0:
        reasons.append("No prerequisites required.")
    else:
        reasons.append(f"All {n} prerequisite(s) satisfied.")
    if diff["difficulty_level"]:
        reasons.append(f"Difficulty: {diff['difficulty_level']} ({diff['difficulty_score']}).")
    if weekly_hours:
        reasons.append(f"Weekly hours: {weekly_hours}.")
    if unlocked_count:
        reasons.append(f"Unlocks {unlocked_count} further course(s).")
    return reasons


# ---------------------------------------------------------------------------
# CLI
# ---------------------------------------------------------------------------

if __name__ == "__main__":
    import argparse

    cli = argparse.ArgumentParser(description="TAU course recommendation CLI")
    cli.add_argument("--completed",        metavar="IDS",   nargs="?", const="", default=None,
                     help="Comma-separated completed course IDs (overrides profile)")
    cli.add_argument("--profile",          metavar="PATH",  default=None,
                     help="Path to user profile JSON")
    cli.add_argument("--max-difficulty",   metavar="FLOAT", type=float, default=None,
                     help="Exclude courses above this difficulty score (overrides profile)")
    cli.add_argument("--max-weekly-hours", metavar="FLOAT", type=float, default=None,
                     help="Exclude courses above this weekly hour count (overrides profile)")
    cli.add_argument("--limit",            metavar="N",     type=int, default=10,
                     help="Maximum number of results (default: 10)")
    cli.add_argument("--db",               metavar="PATH",  default=str(_DB_PATH),
                     help=f"Database path (default: {_DB_PATH})")
    args = cli.parse_args()

    # Load profile (if provided) then let explicit CLI flags override
    profile = None
    if args.profile:
        from app.models.user_profile import load_user_profile
        profile = load_user_profile(args.profile)
        print(f"[recommend] Profile: {profile.profile_name}")

    if args.completed is not None:
        completed = [c.strip() for c in args.completed.split(",") if c.strip()]
    elif profile:
        completed = list(profile.completed_course_ids)
    else:
        completed = []

    max_difficulty   = args.max_difficulty   if args.max_difficulty   is not None else (profile.max_difficulty   if profile else None)
    max_weekly_hours = args.max_weekly_hours if args.max_weekly_hours is not None else (profile.max_weekly_hours if profile else None)

    db_path = Path(args.db)

    results = recommend_courses(
        completed_course_ids = completed,
        max_difficulty       = max_difficulty,
        max_weekly_hours     = max_weekly_hours,
        limit                = args.limit,
        db_path              = db_path,
    )

    print(f"[recommend] {len(results)} course(s) recommended "
          f"(completed={len(completed)}"
          + (f", max_difficulty={max_difficulty}" if max_difficulty is not None else "")
          + (f", max_weekly_hours={max_weekly_hours}" if max_weekly_hours is not None else "")
          + ")")

    for i, r in enumerate(results, 1):
        print(f"  {i}. {r['course_id']}  difficulty={r['difficulty_score']} ({r['difficulty_level']})"
              f"  hours={r['weekly_hours']}  unlocks={r['unlocked_courses_count']}")
        for reason in r["reasons"]:
            print(f"       - {reason}")

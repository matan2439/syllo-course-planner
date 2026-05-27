"""
Course plan builder.

Selects a recommended subset of eligible courses from an elective audit result,
respecting a total weekly hours budget, a difficulty cap, and a course count limit.
"""

import json
from pathlib import Path
from typing import Any

from app.database.db import _DB_PATH
from app.analysis.prerequisite_graph import get_direct_dependent_courses


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------

def build_course_plan(
    audit_results: list[dict[str, Any]],
    max_total_weekly_hours: float | None = None,
    max_difficulty: float | None = None,
    limit: int = 5,
    program_requirements: dict[str, Any] | None = None,
    db_path: Path = _DB_PATH,
) -> dict[str, Any]:
    """
    Select a recommended course plan from an elective audit result.

    Only eligible courses are considered. Courses are ranked by difficulty
    (lower = better), unlocked dependents count (more = better), and whether
    weekly hours are known. Greedy selection stops when the hours budget or
    course limit is reached.

    Returns a dict with keys:
        selected_courses, total_weekly_hours, average_difficulty,
        explanation, rejected_courses_summary
    """
    eligible = [r for r in audit_results if r["status"] == "eligible"]

    # Difficulty filter
    over_difficulty: list[dict] = []
    if max_difficulty is not None:
        candidates, over_difficulty = [], []
        for c in eligible:
            ds = c.get("difficulty_score")
            if ds is not None and ds > max_difficulty:
                over_difficulty.append(c)
            else:
                candidates.append(c)
        eligible = candidates

    total_eligible = len(eligible) + len(over_difficulty)

    # Required categories from program requirements
    required_cat_ids = _get_required_category_ids(program_requirements)

    # Unlocked counts from DB (best-effort; returns {} if DB absent)
    unlocked = _get_unlocked_counts([c["course_id"] for c in eligible], db_path)

    # Rank and sort (descending — best first)
    # Courses from unsatisfied required categories get a large bonus
    ranked = sorted(
        eligible,
        key=lambda c: _rank_score(c, unlocked.get(c["course_id"], 0), required_cat_ids),
        reverse=True,
    )

    # Greedy selection with dynamic category tracking
    selected:      list[dict] = []
    over_budget:   list[dict] = []
    limit_reached: list[dict] = []
    used_hours     = 0.0
    satisfied_cats: set[str]  = set()

    for c in ranked:
        if len(selected) >= limit:
            limit_reached.append(c)
            continue
        hours = c.get("weekly_hours") or 0.0
        if max_total_weekly_hours is not None and used_hours + hours > max_total_weekly_hours:
            over_budget.append(c)
            continue
        selected.append(c)
        used_hours += hours
        cat_id = c.get("program_category_id")
        if cat_id:
            satisfied_cats.add(cat_id)

    # Output metrics
    known_hours = [c["weekly_hours"] for c in selected if c.get("weekly_hours") is not None]
    total_hours = round(sum(known_hours), 1) if known_hours else None

    diff_scores = [c["difficulty_score"] for c in selected if c.get("difficulty_score") is not None]
    avg_diff = round(sum(diff_scores) / len(diff_scores), 2) if diff_scores else None

    explanation = _build_explanation(
        selected, total_eligible, max_difficulty, over_difficulty,
        max_total_weekly_hours, used_hours, limit, limit_reached,
    )

    return {
        "selected_courses": [
            _format_course(c, unlocked.get(c["course_id"], 0), required_cat_ids)
            for c in selected
        ],
        "total_weekly_hours": total_hours,
        "average_difficulty": avg_diff,
        "explanation": explanation,
        "rejected_courses_summary": {
            "total_eligible": total_eligible,
            "not_selected": len(over_difficulty) + len(over_budget) + len(limit_reached),
            "rejection_reasons": {
                "over_difficulty":   len(over_difficulty),
                "over_hours_budget": len(over_budget),
                "limit_reached":     len(limit_reached),
            },
        },
    }


# ---------------------------------------------------------------------------
# Ranking
# ---------------------------------------------------------------------------

def _rank_score(
    course: dict[str, Any],
    unlocked_count: int,
    required_cat_ids: set[str] | None = None,
) -> float:
    score = 0.0
    cat_id = course.get("program_category_id")
    if required_cat_ids and cat_id in required_cat_ids:
        score += 10.0                  # strong bonus for filling a required category (beats max difficulty bonus of 8.0)
    diff = course.get("difficulty_score")
    if diff is not None:
        score += (5.0 - diff) * 2.0   # lower difficulty → higher score
    score += unlocked_count * 1.5     # more unlocked courses → higher score
    if course.get("weekly_hours") is not None:
        score += 0.5                   # known hours preferred over unknown
    return score


# ---------------------------------------------------------------------------
# Internal helpers
# ---------------------------------------------------------------------------

def _get_required_category_ids(
    program_requirements: dict[str, Any] | None,
) -> set[str]:
    """Return the set of elective_category IDs that have min_courses > 0 and no needs_review flag."""
    if not program_requirements:
        return set()
    reqs = program_requirements.get("requirements", {})
    return {
        cat["category_id"]
        for cat in reqs.get("elective_categories", [])
        if cat.get("min_courses", 1) > 0 and not cat.get("needs_review")
    }


def _selection_reason(
    course: dict[str, Any],
    required_cat_ids: set[str] | None,
) -> str:
    cat_id   = course.get("program_category_id")
    cat_name = course.get("program_category_name_he")
    if required_cat_ids and cat_id and cat_id in required_cat_ids:
        return f"הקורס נבחר כדי להשלים את קטגוריית {cat_name or cat_id}"
    if not cat_id or cat_id == "uncategorized":
        return "הקורס נבחר כבחירה נוספת להשלמת מכסת השעות"
    return f"הקורס נבחר כבחירה נוספת מקטגוריית {cat_name or cat_id}"


def _get_unlocked_counts(course_ids: list[str], db_path: Path) -> dict[str, int]:
    if not db_path.exists():
        return {}
    result = {}
    for cid in course_ids:
        try:
            deps = get_direct_dependent_courses(cid, db_path)
            result[cid] = len(deps)
        except Exception:
            result[cid] = 0
    return result


def _format_course(
    course: dict[str, Any],
    unlocked_count: int,
    required_cat_ids: set[str] | None = None,
) -> dict[str, Any]:
    return {
        "course_id":                  course["course_id"],
        "name_he":                    course.get("name_he"),
        "difficulty_score":           course.get("difficulty_score"),
        "difficulty_level":           course.get("difficulty_level"),
        "weekly_hours":               course.get("weekly_hours"),
        "unlocked_courses_count":     unlocked_count,
        "program_category_id":        course.get("program_category_id"),
        "program_category_name_he":   course.get("program_category_name_he"),
        "needs_category_review":      course.get("needs_category_review", False),
        "selection_reason":           _selection_reason(course, required_cat_ids),
    }


def _build_explanation(
    selected: list[dict],
    total_eligible: int,
    max_difficulty: float | None,
    over_difficulty: list[dict],
    max_total_weekly_hours: float | None,
    used_hours: float,
    limit: int,
    limit_reached: list[dict],
) -> str:
    parts = [f"Selected {len(selected)} of {total_eligible} eligible course(s)."]
    if max_difficulty is not None and over_difficulty:
        parts.append(f"Excluded {len(over_difficulty)} course(s) above difficulty {max_difficulty}.")
    if max_total_weekly_hours is not None:
        parts.append(f"Budget: {used_hours:.1f}/{max_total_weekly_hours} weekly hours used.")
    if limit_reached:
        parts.append(
            f"Limit of {limit} reached; {len(limit_reached)} further eligible course(s) not included."
        )
    return " ".join(parts)


# ---------------------------------------------------------------------------
# CLI
# ---------------------------------------------------------------------------

if __name__ == "__main__":
    import argparse

    cli = argparse.ArgumentParser(description="TAU course plan builder")
    cli.add_argument("--audit-json",             required=True,  metavar="PATH",
                     help="Path to elective audit JSON")
    cli.add_argument("--program-json",           default=None,   metavar="PATH",
                     help="Path to program JSON — enables category-aware selection")
    cli.add_argument("--profile",                default=None,   metavar="PATH",
                     help="Path to user profile JSON")
    cli.add_argument("--max-total-weekly-hours", type=float,     default=None, metavar="FLOAT",
                     help="Total weekly hours budget for the selected plan")
    cli.add_argument("--max-difficulty",         type=float,     default=None, metavar="FLOAT",
                     help="Exclude courses above this difficulty (overrides profile)")
    cli.add_argument("--limit",                  type=int,       default=5,    metavar="N",
                     help="Maximum number of courses to select (default: 5)")
    cli.add_argument("--output-json",            default=None,   metavar="PATH",
                     help="Save plan to JSON")
    cli.add_argument("--db",                     default=str(_DB_PATH), metavar="PATH",
                     help=f"Database path (default: {_DB_PATH})")
    args = cli.parse_args()

    audit_path = Path(args.audit_json)
    if not audit_path.exists():
        print(f"[error] Audit JSON not found: {audit_path}")
        raise SystemExit(1)

    audit_results = json.loads(audit_path.read_text(encoding="utf-8"))

    prog_reqs = None
    if args.program_json:
        from app.analysis.program_requirements import load_program_requirements
        prog_path = Path(args.program_json)
        if prog_path.exists():
            prog_reqs = load_program_requirements(prog_path)
            print(f"[plan] Program: {prog_reqs.get('program_name_he') or prog_path.name}")
        else:
            print(f"[warn] Program JSON not found: {prog_path}")

    profile = None
    if args.profile:
        from app.models.user_profile import load_user_profile
        profile = load_user_profile(args.profile)
        print(f"[plan] Profile: {profile.profile_name}")

    max_difficulty = (
        args.max_difficulty if args.max_difficulty is not None
        else (profile.max_difficulty if profile else None)
    )

    plan = build_course_plan(
        audit_results          = audit_results,
        max_total_weekly_hours = args.max_total_weekly_hours,
        max_difficulty         = max_difficulty,
        limit                  = args.limit,
        program_requirements   = prog_reqs,
        db_path                = Path(args.db),
    )

    # Print summary
    print(f"\n[plan] {plan['explanation']}")
    print(f"       total_hours={plan['total_weekly_hours']}  "
          f"avg_difficulty={plan['average_difficulty']}")
    print()

    for i, c in enumerate(plan["selected_courses"], 1):
        name = c.get("name_he") or ""
        print(f"  {i}. {c['course_id']}  diff={c['difficulty_score']} ({c['difficulty_level']})"
              f"  hours={c['weekly_hours']}  unlocks={c['unlocked_courses_count']}"
              + (f"  {name}" if name else ""))

    rs = plan["rejected_courses_summary"]["rejection_reasons"]
    not_selected = plan["rejected_courses_summary"]["not_selected"]
    if not_selected:
        print(f"\n  Rejected ({not_selected}): "
              f"over_difficulty={rs['over_difficulty']}  "
              f"over_budget={rs['over_hours_budget']}  "
              f"limit_reached={rs['limit_reached']}")

    if args.output_json:
        out = Path(args.output_json)
        out.parent.mkdir(parents=True, exist_ok=True)
        out.write_text(json.dumps(plan, ensure_ascii=False, indent=2), encoding="utf-8")
        print(f"\n[plan] JSON saved to {out}")

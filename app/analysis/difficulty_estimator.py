"""
Rule-based course difficulty estimator.

Score range : 1.0 – 5.0
Levels      : easy (1–2) | medium (2–3.2) | hard (3.2–4.2) | very_hard (4.2–5)
"""

from pathlib import Path
from typing import Any

from app.database.db import _DB_PATH, get_course_by_id

# ---------------------------------------------------------------------------
# Keywords that signal academic depth / workload
# ---------------------------------------------------------------------------

_ADVANCED_KEYWORDS = {
    # Hebrew
    "מתקדם", "הוכחה", "פרויקט", "אלגוריתם", "מעבדה",
    # English
    "advanced", "proof", "project", "algorithm", "lab",
}


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------

def estimate_course_difficulty(
    course_id: str,
    db_path: Path = _DB_PATH,
) -> dict[str, Any]:
    """
    Return a difficulty record for the given course.

    Keys
    ----
    course_id        : str
    difficulty_score : float  (1.0 – 5.0)
    difficulty_level : str    (easy | medium | hard | very_hard)
    factors          : dict   (individual signal contributions)
    explanation      : str
    """
    record = get_course_by_id(course_id, db_path)
    if record is None:
        return {
            "course_id":        course_id,
            "difficulty_score": None,
            "difficulty_level": None,
            "factors":          {},
            "explanation":      f"Course {course_id} not found in database.",
        }

    score = 1.0
    factors: dict[str, float] = {}

    # ── weekly hours (up to +1.0) ────────────────────────────────────────────
    total_hours = sum(
        h for h in (
            record.get("lecture_hours"),
            record.get("tutorial_hours"),
            record.get("lab_hours"),
        )
        if h is not None
    )
    hours_bonus = min(total_hours / 6.0, 1.0)   # 6 h/week → full point
    score += hours_bonus
    factors["hours_bonus"] = round(hours_bonus, 3)

    # ── prerequisites (up to +1.0) ───────────────────────────────────────────
    prereq_count = len(record.get("prerequisite_course_ids", []))
    prereq_bonus = min(prereq_count * 0.25, 1.0)
    score += prereq_bonus
    factors["prereq_bonus"] = round(prereq_bonus, 3)

    # ── exam (+0.4) ──────────────────────────────────────────────────────────
    exam_bonus = 0.4 if record.get("exam_info") else 0.0
    score += exam_bonus
    factors["exam_bonus"] = exam_bonus

    # ── assignments (+0.3) ───────────────────────────────────────────────────
    assign_bonus = 0.3 if record.get("assignments") else 0.0
    score += assign_bonus
    factors["assign_bonus"] = assign_bonus

    # ── advanced keywords (up to +0.8) ───────────────────────────────────────
    text_blob = " ".join(filter(None, [
        record.get("course_description", ""),
        record.get("assignments", ""),
        record.get("exam_info", ""),
    ])).lower()
    matched_keywords = {kw for kw in _ADVANCED_KEYWORDS if kw.lower() in text_blob}
    keyword_bonus = min(len(matched_keywords) * 0.16, 0.8)
    score += keyword_bonus
    factors["keyword_bonus"]    = round(keyword_bonus, 3)
    factors["matched_keywords"] = sorted(matched_keywords)

    # ── cap ──────────────────────────────────────────────────────────────────
    score = min(round(score, 2), 5.0)

    level = _difficulty_level(score)
    explanation = (
        f"Score {score}: {hours_bonus:.2f} from hours, "
        f"{prereq_bonus:.2f} from {prereq_count} prereq(s), "
        f"{exam_bonus:.1f} exam, {assign_bonus:.1f} assignments, "
        f"{keyword_bonus:.2f} from {len(matched_keywords)} keyword(s)."
    )

    return {
        "course_id":        record["course_id"],
        "difficulty_score": score,
        "difficulty_level": level,
        "factors":          factors,
        "explanation":      explanation,
    }


# ---------------------------------------------------------------------------
# Internal helpers
# ---------------------------------------------------------------------------

def _difficulty_level(score: float) -> str:
    if score < 2.0:
        return "easy"
    if score < 3.2:
        return "medium"
    if score < 4.2:
        return "hard"
    return "very_hard"


# ---------------------------------------------------------------------------
# CLI
# ---------------------------------------------------------------------------

if __name__ == "__main__":
    import argparse

    cli = argparse.ArgumentParser(description="TAU course difficulty estimator CLI")
    cli.add_argument("--course", metavar="COURSE_ID", required=True,
                     help="Course ID to estimate (digits or hyphenated)")
    cli.add_argument("--db",    metavar="PATH",      default=str(_DB_PATH),
                     help=f"Database path (default: {_DB_PATH})")
    args = cli.parse_args()

    result = estimate_course_difficulty(args.course, Path(args.db))

    print(f"course_id       : {result['course_id']}")
    print(f"difficulty_score: {result['difficulty_score']}")
    print(f"difficulty_level: {result['difficulty_level']}")
    f = result["factors"]
    print(f"factors         : hours={f.get('hours_bonus')}  prereqs={f.get('prereq_bonus')}  "
          f"exam={f.get('exam_bonus')}  assignments={f.get('assign_bonus')}  "
          f"keywords={f.get('keyword_bonus')} {f.get('matched_keywords')}")
    print(f"explanation     : {result['explanation']}")

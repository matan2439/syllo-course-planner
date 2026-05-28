"""
Rule-based course difficulty estimator — 4-subscore model.

Score range : 1.0 – 5.0
Levels      : easy (1.0–2.0) | medium (2.0–3.2) | hard (3.2–4.2) | very_hard (4.2–5.0)

Weights
-------
  conceptual_complexity  35 %
  workload               30 %
  prerequisite_depth     20 %
  assessment_intensity   15 %

Confidence is the weighted fraction of subscores backed by *official* data.
A warning is emitted when confidence < 0.6.
If a CourseOverride is supplied and its data is used, confidence is penalised
by 0.10 (offset by override.confidence_adjustment) and an extra warning is added.
"""

from pathlib import Path
from typing import Any, Optional

from app.database.db import _DB_PATH, get_course_by_id
from app.models.course_override import CourseOverride
from app.models.grade_stats import CourseGradeStats, compute_grade_signal

# ---------------------------------------------------------------------------
# Keyword sets — signal conceptual depth
# ---------------------------------------------------------------------------

_COMPLEXITY_KEYWORDS_HE: set[str] = {
    "מתקדם", "הוכחה", "הוכחות", "תכן", "מודל", "מודלים",
    "נומרי", "חישובי", "אנליטי", "דינמיקה", "תרמודינמיקה",
    "זרימה", "אלסטיות", "אלמנטים סופיים", "בקרה", "אופטימיזציה",
    "הסתברות", "סטטיסטיקה", "משוואות דיפרנציאליות", "מעבר חום",
    "חוזק", "מכניקה", "אלגוריתם", "סימולציה", "פרויקט",
}

_COMPLEXITY_KEYWORDS_EN: set[str] = {
    "advanced", "proof", "model", "modeling", "numerical", "computational",
    "analytical", "dynamics", "thermodynamics", "fluid", "elasticity",
    "finite elements", "control", "optimization", "probability", "statistics",
    "differential equations", "heat transfer", "mechanics", "algorithm",
    "simulation", "project",
}

_WEIGHTS: dict[str, float] = {
    "workload":              0.30,
    "conceptual_complexity": 0.35,
    "prerequisite_depth":    0.20,
    "assessment_intensity":  0.15,
}


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------

def estimate_course_difficulty(
    course_id: str,
    db_path: Path = _DB_PATH,
    override: Optional[CourseOverride] = None,
    grade_stats: Optional[list[CourseGradeStats]] = None,
) -> dict[str, Any]:
    """
    Return a multi-dimensional difficulty record for *course_id*.

    Keys
    ----
    course_id                    : str
    workload_score               : float | None   (1.0–5.0; None when hours unknown)
    conceptual_complexity_score  : float | None   (1.0–5.0; None when no text at all)
    prerequisite_depth_score     : float           (1.0–5.0; always computed)
    assessment_intensity_score   : float           (1.0–4.5; always computed)
    final_difficulty_score       : float | None   (weighted average; None when course missing)
    difficulty_level             : str | None
    confidence                   : float           (0.0–1.0; based on official data only)
    factors                      : dict
    explanation                  : str
    warnings                     : list[str]

    If *override* is provided and contains manual_weekly_hours, that value is used
    as a fallback when official hours are absent.  User notes are included in the
    keyword text blob for conceptual complexity analysis.  Confidence is penalised
    by 0.10 (adjustable via override.confidence_adjustment) and a warning is added.

    If *grade_stats* is None (default), the function tries to load grade stats
    from *db_path*.  Pass an empty list to skip the DB lookup.  The grade signal
    is a weak adjustment (capped at ±0.28 after confidence scaling) and never
    dominates the 4-subscore model.  It is reported separately as "grade_signal".
    """
    # Auto-load grade stats when caller doesn't supply them
    if grade_stats is None:
        try:
            from app.database.db import get_grade_stats
            grade_stats = get_grade_stats(course_id, db_path)
        except Exception:
            grade_stats = []

    record = get_course_by_id(course_id, db_path)
    if record is None:
        return {
            "course_id":                   course_id,
            "workload_score":              None,
            "conceptual_complexity_score": None,
            "prerequisite_depth_score":    None,
            "assessment_intensity_score":  None,
            "final_difficulty_score":      None,
            "difficulty_level":            None,
            "confidence":                  0.0,
            "factors":                     {},
            "explanation":                 f"Course {course_id} not found in database.",
            "warnings":                    [f"Course {course_id} not found in database."],
            "grade_signal":                compute_grade_signal(grade_stats or []),
        }

    # ── Override data extraction ─────────────────────────────────────────────
    override_hours_used = False
    override_notes_used = False
    user_text = ""
    if override is not None:
        user_text = override.extra_text()
        if user_text:
            override_notes_used = True

    # ── 1. Workload subscore ─────────────────────────────────────────────────
    hour_fields = (
        record.get("lecture_hours"),
        record.get("tutorial_hours"),
        record.get("lab_hours"),
    )
    has_official_hours = any(h is not None for h in hour_fields)
    official_total     = sum(h for h in hour_fields if h is not None)

    if has_official_hours:
        workload_hours = official_total
        workload_score: float | None = round(min(1.0 + workload_hours * (4.0 / 9.0), 5.0), 2)
    elif override is not None and override.manual_weekly_hours is not None:
        workload_hours = override.manual_weekly_hours
        workload_score = round(min(1.0 + workload_hours * (4.0 / 9.0), 5.0), 2)
        override_hours_used = True
    else:
        workload_hours = 0.0
        workload_score = None

    # ── 2. Conceptual complexity subscore ────────────────────────────────────
    has_official_description = bool(record.get("course_description"))
    has_any_description      = has_official_description or bool(user_text)

    text_blob = " ".join(filter(None, [
        record.get("course_description", ""),
        record.get("assignments", ""),
        record.get("exam_info", ""),
        user_text,
    ]))
    text_lower  = text_blob.lower()
    matched_he  = {kw for kw in _COMPLEXITY_KEYWORDS_HE if kw in text_lower}
    matched_en  = {kw for kw in _COMPLEXITY_KEYWORDS_EN if kw in text_lower}
    all_matched = matched_he | matched_en

    if has_any_description:
        conceptual_score: float | None = round(min(1.0 + len(all_matched) * 0.20, 5.0), 2)
    else:
        conceptual_score = None

    # ── 3. Prerequisite depth subscore ───────────────────────────────────────
    prereq_count = len(record.get("prerequisite_course_ids") or [])
    prereq_score = round(min(1.0 + prereq_count * 0.5, 5.0), 2)

    # ── 4. Assessment intensity subscore ─────────────────────────────────────
    has_exam        = bool(record.get("exam_info"))
    has_assignments = bool(record.get("assignments"))
    syllabus_links  = record.get("syllabus_links") or []
    has_syllabus    = bool(syllabus_links) or any(
        g.get("syllabus_url") for g in (record.get("groups") or [])
    )
    has_assessment_data = has_exam or has_assignments or has_syllabus

    assessment_base = 1.0
    if has_exam:
        assessment_base += 2.0
    if has_assignments:
        assessment_base += 1.5
    assessment_score = round(min(assessment_base, 5.0), 2)

    # ── 5. Confidence (official data only, then penalised for override use) ──
    confidence = round(
        _WEIGHTS["workload"]              * (1.0 if has_official_hours       else 0.0)
        + _WEIGHTS["conceptual_complexity"] * (1.0 if has_official_description else 0.0)
        + _WEIGHTS["prerequisite_depth"]                                           # always known
        + _WEIGHTS["assessment_intensity"]  * (1.0 if has_assessment_data     else 0.0),
        2,
    )

    override_used = override_hours_used or override_notes_used
    if override_used:
        adj = override.confidence_adjustment if override is not None else 0.0
        confidence = round(max(0.0, min(1.0, confidence - 0.10 + adj)), 2)

    # ── 6. Weighted final score ───────────────────────────────────────────────
    final_score = round(
        _WEIGHTS["workload"]              * (workload_score   if workload_score   is not None else 1.0)
        + _WEIGHTS["conceptual_complexity"] * (conceptual_score if conceptual_score is not None else 1.0)
        + _WEIGHTS["prerequisite_depth"]    * prereq_score
        + _WEIGHTS["assessment_intensity"]  * assessment_score,
        2,
    )
    final_score = round(max(1.0, min(final_score, 5.0)), 2)

    # ── 7. Grade-based signal (optional, weak) ───────────────────────────────
    grade_signal = compute_grade_signal(grade_stats or [])
    if grade_signal:
        # Effective adjustment is scaled by signal confidence so it stays minor
        effective_adj = round(grade_signal["adjustment"] * grade_signal["confidence"], 3)
        final_score   = round(max(1.0, min(5.0, final_score + effective_adj)), 2)

    level = _difficulty_level(final_score)

    # ── 8. Warnings ──────────────────────────────────────────────────────────
    warnings: list[str] = []
    if confidence < 0.6:
        warnings.append("ציון הקושי מבוסס על מידע חלקי")
    if override_used:
        warnings.append("מדד זה כולל מידע שהוזן ידנית")

    # ── 9. Factors / explanation ──────────────────────────────────────────────
    factors: dict[str, Any] = {
        "total_hours":      workload_hours,
        "matched_keywords": sorted(all_matched),
        "prereq_count":     prereq_count,
        "has_exam":         has_exam,
        "has_assignments":  has_assignments,
        "override_used":    override_used,
    }

    explanation_parts: list[str] = []
    if workload_score is not None:
        src = " (manual)" if override_hours_used else ""
        explanation_parts.append(f"workload {workload_score:.1f} ({workload_hours}h/wk{src})")
    if conceptual_score is not None:
        src = " (incl. notes)" if override_notes_used and not has_official_description else ""
        explanation_parts.append(
            f"conceptual {conceptual_score:.1f} ({len(all_matched)} keyword(s){src})"
        )
    explanation_parts.append(f"prereqs {prereq_score:.1f} ({prereq_count})")
    explanation_parts.append(
        f"assessment {assessment_score:.1f} "
        f"({'exam+hw' if has_exam and has_assignments else 'exam' if has_exam else 'hw' if has_assignments else 'none'})"
    )
    explanation_parts.append(f"→ final {final_score} [{level}] conf={confidence:.2f}")

    return {
        "course_id":                   record["course_id"],
        "workload_score":              workload_score,
        "conceptual_complexity_score": conceptual_score,
        "prerequisite_depth_score":    prereq_score,
        "assessment_intensity_score":  assessment_score,
        "final_difficulty_score":      final_score,
        "difficulty_level":            level,
        "confidence":                  confidence,
        "factors":                     factors,
        "explanation":                 " | ".join(explanation_parts),
        "warnings":                    warnings,
        "grade_signal":                grade_signal,
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
# Lightweight estimator (no DB record required)
# ---------------------------------------------------------------------------

# Category-to-conceptual-complexity baseline (engineering subdomain priors)
_CATEGORY_COMPLEXITY_BASELINE: dict[str, float] = {
    "fluids":               2.8,
    "solids":               2.6,
    "systems":              2.8,
    "advanced_labs":        2.4,
    "other_specialization": 2.2,
}


def estimate_difficulty_lightweight(
    weekly_hours: Optional[float],
    prereq_count: int,
    teaching_format: Optional[list[dict]],
    category_id: Optional[str],
    name_he: Optional[str],
) -> dict[str, Any]:
    """Estimate difficulty using only program-page data (no DB record).

    Uses: hours → workload, prereq_count → depth, teaching_format → assessment,
    category_id + name_he → conceptual complexity baseline + keyword boost.

    Confidence is capped at 0.55 (below the 0.6 "uncertain" warning threshold),
    so the UI always shows the partial-confidence indicator for these estimates.
    """
    # 1. Workload subscore
    if weekly_hours is not None:
        workload_score: Optional[float] = round(min(1.0 + weekly_hours * (4.0 / 9.0), 5.0), 2)
    else:
        workload_score = None

    # 2. Conceptual complexity — category baseline + name-keyword boost
    base = _CATEGORY_COMPLEXITY_BASELINE.get(category_id or "", 2.0)
    text = (name_he or "").lower()
    matched = (
        {kw for kw in _COMPLEXITY_KEYWORDS_HE if kw in text}
        | {kw for kw in _COMPLEXITY_KEYWORDS_EN if kw in text}
    )
    conceptual_score: float = round(min(base + len(matched) * 0.15, 5.0), 2)

    # 3. Prerequisite depth subscore
    prereq_score: float = round(min(1.0 + prereq_count * 0.5, 5.0), 2)

    # 4. Assessment intensity — detect lab in teaching_format
    has_lab = any(
        "מעבדה" in (f.get("type") or "") or "lab" in (f.get("type") or "").lower()
        for f in (teaching_format or [])
    )
    assessment_score: float = round(min(1.0 + (2.0 if has_lab else 0.0), 5.0), 2)

    # 5. Weighted final score (fall back to 1.5 for unknown workload)
    final_score = round(
        _WEIGHTS["workload"]              * (workload_score if workload_score is not None else 1.5)
        + _WEIGHTS["conceptual_complexity"] * conceptual_score
        + _WEIGHTS["prerequisite_depth"]    * prereq_score
        + _WEIGHTS["assessment_intensity"]  * assessment_score,
        2,
    )
    final_score = round(max(1.0, min(final_score, 5.0)), 2)

    # 6. Confidence — capped at 0.55 (always triggers partial-data warning)
    confidence: float = 0.35
    if workload_score is not None:
        confidence += 0.15
    if matched:
        confidence += 0.05
    confidence = round(min(confidence, 0.55), 2)

    return {
        "workload_score":              workload_score,
        "conceptual_complexity_score": conceptual_score,
        "prerequisite_depth_score":    prereq_score,
        "assessment_intensity_score":  assessment_score,
        "final_difficulty_score":      final_score,
        "difficulty_level":            _difficulty_level(final_score),
        "confidence":                  confidence,
        "factors": {
            "total_hours":  weekly_hours or 0.0,
            "prereq_count": prereq_count,
            "has_lab":      has_lab,
            "override_used": False,
        },
        "explanation": (
            f"lightweight: workload={workload_score} conceptual={conceptual_score}"
            f" prereqs={prereq_score} assessment={assessment_score}"
            f" → {final_score} [{_difficulty_level(final_score)}] conf={confidence}"
        ),
        "warnings": ["ציון הקושי מבוסס על מידע חלקי"],
        "grade_signal": None,
    }


# ---------------------------------------------------------------------------
# CLI
# ---------------------------------------------------------------------------

if __name__ == "__main__":
    import argparse

    cli = argparse.ArgumentParser(description="TAU course difficulty estimator CLI")
    cli.add_argument("--course",    metavar="COURSE_ID", required=True,
                     help="Course ID to estimate (digits or hyphenated)")
    cli.add_argument("--db",       metavar="PATH",      default=str(_DB_PATH),
                     help=f"Database path (default: {_DB_PATH})")
    cli.add_argument("--overrides", metavar="PATH",     default=None,
                     help="Path to course_overrides.json")
    args = cli.parse_args()

    override = None
    if args.overrides:
        from app.models.course_override import load_course_overrides
        from app.analysis.eligibility_engine import normalize_course_id
        overrides = load_course_overrides(args.overrides)
        override  = overrides.get(normalize_course_id(args.course))

    result = estimate_course_difficulty(args.course, Path(args.db), override=override)

    print(f"course_id               : {result['course_id']}")
    print(f"final_difficulty_score  : {result['final_difficulty_score']}")
    print(f"difficulty_level        : {result['difficulty_level']}")
    print(f"confidence              : {result['confidence']}")
    print(f"workload_score          : {result['workload_score']}")
    print(f"conceptual_complexity   : {result['conceptual_complexity_score']}")
    print(f"prerequisite_depth      : {result['prerequisite_depth_score']}")
    print(f"assessment_intensity    : {result['assessment_intensity_score']}")
    f = result["factors"]
    print(f"factors                 : hours={f.get('total_hours')}  prereqs={f.get('prereq_count')}  "
          f"keywords={f.get('matched_keywords')}  override_used={f.get('override_used')}")
    print(f"explanation             : {result['explanation']}")
    if result["warnings"]:
        print(f"warnings                : {result['warnings']}")

"""
Instructor uncertainty modeling.

Course difficulty and workload can vary by instructor and semester.
This module estimates and represents that uncertainty explicitly.

Rules
-----
1. If current lecturer is unknown → warning + uncertainty += 0.40
2. If grade stats come from multiple distinct lecturers → uncertainty += 0.20
3. If current lecturer is not among historical lecturers (both known) →
   instructor_changed_warning = True, warning added, uncertainty += 0.20
4. Never assume one lecturer is easier/harder unless grade data supports it.

Score range: 0.0 (no uncertainty) – 1.0 (maximum uncertainty).
"""

from __future__ import annotations

from typing import Any

from app.models.grade_stats import CourseGradeStats


# Lecturer field names accepted from DB group objects (scraped data varies)
_LECTURER_KEYS = ("teacher", "lecturer", "instructor", "מרצה", "מרצים", "staff")

# Honorific titles stripped during fuzzy name matching
_TITLES = frozenset({
    "פרופ", "פרופ'", 'ד"ר', "ד'ר", "פרופסור",
    "dr", "dr.", "prof", "prof.",
})


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------

def estimate_instructor_uncertainty(
    record: dict | None,
    grade_stats: list[CourseGradeStats],
) -> dict[str, Any]:
    """
    Compute instructor-uncertainty metadata for a single course.

    Parameters
    ----------
    record      : merged_courses DB row (may be None if course not in DB)
    grade_stats : historical grade records for this course (may be empty)

    Returns
    -------
    dict with keys:
        current_lecturers            – list[str], from current course groups
        historical_lecturers         – list[str], unique names from grade stats
        instructor_uncertainty_score – float 0.0–1.0
        instructor_notes             – None (populated by frontend from localStorage)
        instructor_changed_warning   – bool (current ∉ historical, both non-empty)
        warnings                     – list[str] (Hebrew, for display)
    """
    current_lecturers    = _extract_current_lecturers(record)
    historical_lecturers = _extract_historical_lecturers(grade_stats)

    score    = 0.0
    warnings: list[str] = []
    changed  = False

    # Rule 1 — current lecturer unknown
    if not current_lecturers:
        score += 0.40
        warnings.append("מרצה הסמסטר לא ידוע")

    # Rule 2 — grade data mixes multiple instructors
    if len(historical_lecturers) > 1:
        score += 0.20

    # Rule 3 — current instructor not represented in historical data
    if current_lecturers and historical_lecturers:
        current_norm = {_normalize_name(n) for n in current_lecturers}
        hist_norm    = {_normalize_name(n) for n in historical_lecturers}
        if not current_norm & hist_norm:
            changed = True
            score  += 0.20
            warnings.append(
                "נתוני הציונים ההיסטוריים עשויים לא לשקף את המרצה הנוכחי"
            )

    # Supplementary uncertainty: grade data exists but carries no lecturer attribution
    stats_with_name = [s for s in grade_stats if s.lecturer_name and s.lecturer_name.strip()]
    if grade_stats and not stats_with_name:
        score += 0.10

    # Supplementary uncertainty: very thin historical record (< 2 years)
    years_count = len({s.year for s in grade_stats if s.year})
    if 0 < years_count < 2:
        score += 0.10

    return {
        "current_lecturers":            current_lecturers,
        "historical_lecturers":         historical_lecturers,
        "instructor_uncertainty_score": round(min(1.0, score), 2),
        "instructor_notes":             None,  # filled by frontend from localStorage overrides
        "instructor_changed_warning":   changed,
        "warnings":                     warnings,
    }


# ---------------------------------------------------------------------------
# Internal helpers
# ---------------------------------------------------------------------------

def _extract_current_lecturers(record: dict | None) -> list[str]:
    """Return lecturer names from a course's groups array (scraped DB data)."""
    if not record:
        return []
    lecturers: list[str] = []
    for group in record.get("groups") or []:
        if not isinstance(group, dict):
            continue
        for key in _LECTURER_KEYS:
            val = group.get(key)
            if val is None:
                continue
            names = val if isinstance(val, list) else [val]
            for name in names:
                s = str(name).strip()
                if s and s not in lecturers:
                    lecturers.append(s)
    return lecturers


def _extract_historical_lecturers(grade_stats: list[CourseGradeStats]) -> list[str]:
    """
    Return unique non-empty lecturer names from grade statistics.
    A single record's lecturer_name may be a comma-joined list (from the importer).
    """
    seen: set[str] = set()
    result: list[str] = []
    for stat in grade_stats:
        if not stat.lecturer_name:
            continue
        for part in stat.lecturer_name.split(","):
            name = part.strip()
            if name and name not in seen:
                seen.add(name)
                result.append(name)
    return result


def _normalize_name(name: str) -> str:
    """
    Strip honorific titles and lowercase a lecturer name for fuzzy comparison.
    E.g. 'פרופ. כהן' and 'כהן' → 'כהן' (match).
    """
    tokens = [t.strip("'\".,") for t in name.lower().split()]
    return " ".join(t for t in tokens if t not in _TITLES)

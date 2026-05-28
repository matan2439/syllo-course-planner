"""
Historical grade statistics model.

Grade data is treated as a secondary, unofficial source (TAU Refactor / TAU Factor).
It supplements but never overrides official course metadata.
"""

from __future__ import annotations

import re
from typing import Any, Optional
from pydantic import BaseModel, ConfigDict, Field


def normalize_for_tau_factor(course_id: str) -> str:
    """Normalise a course ID to the TAU Factor / TAU Refactor format (digits only).

    TAU Factor identifies courses without the hyphen separator.
    Leading zeroes are always preserved.

    Examples
    --------
    >>> normalize_for_tau_factor("0542-4320")
    '05424320'
    >>> normalize_for_tau_factor("05424320")
    '05424320'
    >>> normalize_for_tau_factor("0542 4320")
    '05424320'
    """
    return re.sub(r"\D", "", str(course_id))


class CourseGradeStats(BaseModel):
    model_config = ConfigDict(extra="ignore")

    course_id:          str
    year:               Optional[int]   = None
    semester:           Optional[str]   = None   # "א", "ב", "summer"
    moed:               Optional[str]   = None   # "א", "ב"
    lecturer_name:      Optional[str]   = None
    average_grade:      Optional[float] = None   # 0–100
    median_grade:       Optional[float] = None   # 0–100
    standard_deviation: Optional[float] = None
    pass_rate:          Optional[float] = None   # 0.0–1.0
    num_students:       Optional[int]   = None
    source_name:        str  = "TAU Refactor"
    source_url:         Optional[str]   = None
    fetched_at:         str  = ""


# ---------------------------------------------------------------------------
# Grade signal aggregation
# ---------------------------------------------------------------------------

_MIN_STUDENTS = 15   # below this, ignore the signal


def compute_grade_signal(stats: list[CourseGradeStats]) -> dict[str, Any] | None:
    """
    Aggregate a list of grade records into a single difficulty signal dict.

    Returns None when there is insufficient data (fewer than _MIN_STUDENTS total
    or no average_grade values).

    The signal includes a small *adjustment* (range: –0.3 to +0.4) that the
    difficulty estimator may add to its 4-subscore final score.  The adjustment
    is further scaled by *confidence* before being applied, so even at worst it
    shifts the score by at most 0.28 points — never enough to dominate the model.

    Signal keys
    -----------
    average_grade        : weighted average (by num_students)
    median_grade         : weighted median   (may be None)
    standard_deviation   : weighted std dev  (may be None)
    pass_rate            : weighted pass rate (may be None)
    num_students_total   : total students across all records
    years_available      : sorted list of years with data
    adjustment           : raw score shift (–0.3 … +0.4)
    confidence           : 0.0–1.0, based on volume and years
    source_name          : display name for attribution
    source_url           : first URL seen in the records (may be None)
    """
    valid = [s for s in stats if s.average_grade is not None and s.num_students]
    if not valid:
        return None

    total_students = sum(s.num_students for s in valid)
    if total_students < _MIN_STUDENTS:
        return None

    def _weighted_avg(records, attr: str) -> float | None:
        subset = [s for s in records if getattr(s, attr) is not None and s.num_students]
        if not subset:
            return None
        total = sum(s.num_students for s in subset)
        return sum(getattr(s, attr) * s.num_students for s in subset) / total

    weighted_avg = _weighted_avg(valid, "average_grade")       # guaranteed non-None
    weighted_med = _weighted_avg(valid, "median_grade")
    weighted_std = _weighted_avg(valid, "standard_deviation")
    weighted_pr  = _weighted_avg(valid, "pass_rate")

    years = sorted({s.year for s in valid if s.year})

    # ── Adjustment ────────────────────────────────────────────────────────
    # Low average → harder; well above average → slightly easier.
    # This is intentionally weak: a 10-point shift in average changes
    # final difficulty by < 0.1 after confidence scaling.
    adj = 0.0
    if weighted_avg < 55:
        adj = 0.40
    elif weighted_avg < 65:
        adj = 0.25
    elif weighted_avg < 72:
        adj = 0.10
    elif weighted_avg > 82:
        adj = -0.10
    elif weighted_avg > 88:
        adj = -0.20

    # High spread → added uncertainty signal
    if weighted_std is not None and weighted_std > 18:
        adj += 0.10

    adj = round(max(-0.30, min(0.40, adj)), 2)

    # ── Confidence ────────────────────────────────────────────────────────
    # More students + more years = more reliable.
    # Caps at 0.85 to always preserve humility about unofficial data.
    student_factor = min(1.0, total_students / 300)
    years_factor   = min(1.0, len(years) / 4)
    confidence     = round(min(0.85, student_factor * 0.65 + years_factor * 0.35), 2)

    source_names = [s.source_name for s in valid if s.source_name]
    source_urls  = [s.source_url  for s in valid if s.source_url]

    return {
        "average_grade":      round(weighted_avg, 1),
        "median_grade":       round(weighted_med, 1) if weighted_med  is not None else None,
        "standard_deviation": round(weighted_std, 1) if weighted_std  is not None else None,
        "pass_rate":          round(weighted_pr,  3) if weighted_pr   is not None else None,
        "num_students_total": total_students,
        "years_available":    years,
        "adjustment":         adj,
        "confidence":         confidence,
        "source_name":        source_names[0] if source_names else "TAU Refactor",
        "source_url":         source_urls[0]  if source_urls  else None,
    }

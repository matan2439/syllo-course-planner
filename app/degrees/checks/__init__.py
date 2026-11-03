"""Gates over degree evidence: completeness, freshness (and, later, consistency)."""
from pydantic import BaseModel


class CheckResult(BaseModel):
    name: str
    passed: bool
    problems: list[str] = []


from app.degrees.checks.coverage import check_coverage, check_freshness  # noqa: E402

from app.degrees.checks.consistency import (  # noqa: E402
    check_courses_known,
    check_double_counting,
    check_mandatory_offered,
    check_plannable,
    check_totals,
)

__all__ = [
    "CheckResult",
    "check_coverage",
    "check_freshness",
    "check_courses_known",
    "check_double_counting",
    "check_mandatory_offered",
    "check_plannable",
    "check_totals",
]

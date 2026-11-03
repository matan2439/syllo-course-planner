"""Gates over degree evidence: completeness, freshness (and, later, consistency)."""
from pydantic import BaseModel


class CheckResult(BaseModel):
    name: str
    passed: bool
    problems: list[str] = []


from app.degrees.checks.coverage import check_coverage, check_freshness  # noqa: E402

__all__ = ["CheckResult", "check_coverage", "check_freshness"]

"""Coverage (every evidence item accounted for) and freshness (all evidence live) gates."""
from datetime import datetime, timezone

from app.degrees.checks import CheckResult
from app.degrees.evidence import EvidenceItem
from app.degrees.spec import DegreeSpec, MappedTo, NotPlanningRule, resolve_spec_path


def _aware(value: datetime) -> datetime:
    return value.replace(tzinfo=timezone.utc) if value.tzinfo is None else value


def check_coverage(items: list[EvidenceItem], spec: DegreeSpec) -> CheckResult:
    problems: list[tuple[str, str]] = []
    seen: set[str] = set()
    for item in items:
        seen.add(item.id)
        entry = spec.coverage.get(item.id)
        if entry is None:
            problems.append((item.id, f"unaccounted: {item.id} ({item.source_url})"))
        elif isinstance(entry, MappedTo):
            if not resolve_spec_path(spec, entry.mapped_to):
                problems.append(
                    (item.id, f"unresolved mapping: {item.id} -> {entry.mapped_to} ({item.source_url})")
                )
        elif isinstance(entry, NotPlanningRule) and not entry.not_planning_rule.strip():
            problems.append((item.id, f"blank reason: {item.id} ({item.source_url})"))
    for key in spec.coverage:
        if key not in seen:
            problems.append((key, f"stale coverage key (not in evidence): {key}"))
    return CheckResult(name="coverage", passed=not problems, problems=[p for _, p in sorted(problems)])


def check_freshness(items: list[EvidenceItem], run_started_at: datetime) -> CheckResult:
    start = _aware(run_started_at)
    problems: list[tuple[str, str]] = []
    for item in items:
        if item.from_cache or item.data.get("not_fetched") or _aware(item.fetched_at) < start:
            problems.append((
                item.id,
                f"not fresh: {item.id} ({item.source_url}) "
                f"(from_cache={item.from_cache}, fetched_at={item.fetched_at.isoformat()})",
            ))
    return CheckResult(name="freshness", passed=not problems, problems=[p for _, p in sorted(problems)])

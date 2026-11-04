"""Coverage (every evidence item accounted for) and freshness (all evidence live) gates."""
from datetime import datetime, timezone

from app.degrees.checks import CheckResult
from app.degrees.evidence import EvidenceItem
from app.degrees.spec import DegreeSpec, MappedTo, NotPlanningRule, resolve_spec_path


def _aware(value: datetime) -> datetime:
    return value.replace(tzinfo=timezone.utc) if value.tzinfo is None else value


UNREAD_NOT_GAP = "unread page not in known_gaps"


def coverage_gaps(items: list[EvidenceItem], spec: DegreeSpec) -> tuple[list[tuple[EvidenceItem, str]], list[str]]:
    """The one coverage predicate: ([(item, reason)], stale keys).

    reason is "unaccounted" (no entry), "unresolved mapping" (``mapped_to`` names no spec node),
    "blank reason" (``not_planning_rule`` is empty) or "unread page not in known_gaps" (an item
    with ``data.unread`` - a PDF page without a text layer - whose entry is anything but
    ``mapped_to: known_gaps[...]``: nobody read that page, so it can only be a known gap).
    A stale key names no evidence item.
    """
    open_items: list[tuple[EvidenceItem, str]] = []
    for item in items:
        entry = spec.coverage.get(item.id)
        if entry is None:
            open_items.append((item, "unaccounted"))
        elif item.data.get("unread") and not (
                isinstance(entry, MappedTo) and entry.mapped_to.startswith("known_gaps[")):
            open_items.append((item, UNREAD_NOT_GAP))
        elif isinstance(entry, MappedTo):
            if not resolve_spec_path(spec, entry.mapped_to):
                open_items.append((item, "unresolved mapping"))
        elif isinstance(entry, NotPlanningRule) and not entry.not_planning_rule.strip():
            open_items.append((item, "blank reason"))
    seen = {i.id for i in items}
    return open_items, sorted(k for k in spec.coverage if k not in seen)


def check_coverage(items: list[EvidenceItem], spec: DegreeSpec) -> CheckResult:
    problems: list[tuple[str, str]] = []
    if not items:
        problems.append(("", "no evidence collected"))
    open_items, stale = coverage_gaps(items, spec)
    for item, reason in open_items:
        entry = spec.coverage.get(item.id)
        if isinstance(entry, MappedTo):  # unresolved, or an unread page mapped outside known_gaps
            detail = f"{item.id} -> {entry.mapped_to} ({item.source_url})"
        else:
            detail = f"{item.id} ({item.source_url})"
        problems.append((item.id, f"{reason}: {detail}"))
    for key in stale:
        problems.append((key, f"stale coverage key (not in evidence): {key}"))
    return CheckResult(name="coverage", passed=not problems, problems=[p for _, p in sorted(problems)])


def check_freshness(items: list[EvidenceItem], run_started_at: datetime) -> CheckResult:
    start = _aware(run_started_at)
    problems: list[tuple[str, str]] = []
    if not items:
        problems.append(("", "no evidence collected"))
    for item in items:
        if item.from_cache or item.data.get("not_fetched") or _aware(item.fetched_at) < start:
            problems.append((
                item.id,
                f"not fresh: {item.id} ({item.source_url}) "
                f"(from_cache={item.from_cache}, fetched_at={item.fetched_at.isoformat()})",
            ))
    return CheckResult(name="freshness", passed=not problems, problems=[p for _, p in sorted(problems)])

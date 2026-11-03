from datetime import datetime, timedelta, timezone

from app.degrees.checks import CheckResult, check_coverage, check_freshness
from app.degrees.evidence import EvidenceItem
from app.degrees.spec import Category, DegreeSpec, MappedTo, NotPlanningRule

NOW = datetime(2026, 11, 3, 12, 0, tzinfo=timezone.utc)


def _item(id_: str, *, from_cache=False, fetched_at=NOW, data=None) -> EvidenceItem:
    return EvidenceItem(
        id=id_, source_url=f"https://example.test/{id_}", fetched_at=fetched_at, from_cache=from_cache,
        kind="rule_text", path=["x"], raw_text="t", data=data or {},
    )


def _spec(coverage) -> DegreeSpec:
    return DegreeSpec.model_validate({
        "program_id": "p", "institution": "tau", "source_year": 2027, "total_required_credits": 160,
        "mandatory_courses": [], "categories": [Category(
            category_id="fluids", name_he="x", course_ids=["0542-4120"]).model_dump()],
        "group_minimums": {}, "ui": {}, "legacy": {}, "coverage": coverage,
    })


def test_all_mapped_passes():
    spec = _spec({"a": {"mapped_to": "categories[fluids]"}, "b": {"not_planning_rule": "informational"}})
    result = check_coverage([_item("a"), _item("b")], spec)
    assert isinstance(result, CheckResult)
    assert result.passed and result.problems == []


def test_unaccounted_item_fails_and_names_it():
    result = check_coverage([_item("zzz")], _spec({}))
    assert not result.passed
    assert "zzz" in result.problems[0] and "https://example.test/zzz" in result.problems[0]


def test_mapping_to_missing_spec_path_fails():
    result = check_coverage([_item("a")], _spec({"a": {"mapped_to": "categories[nope]"}}))
    assert not result.passed
    assert "a" in result.problems[0] and "categories[nope]" in result.problems[0]


def test_blank_reason_fails():
    result = check_coverage([_item("a")], _spec({"a": {"not_planning_rule": "   "}}))
    assert not result.passed and "blank reason: a" in result.problems[0]


def test_stale_coverage_key_fails():
    result = check_coverage([], _spec({"gone": {"not_planning_rule": "ok"}}))
    assert not result.passed and "stale coverage key" in result.problems[0] and "gone" in result.problems[0]


def test_problems_sorted_by_id():
    result = check_coverage([_item("b"), _item("a")], _spec({}))
    assert "a" in result.problems[0] and "b" in result.problems[1]


def test_freshness_fails_on_cached_item():
    old = NOW - timedelta(days=1)
    items = [_item("c", from_cache=True, fetched_at=old), _item("d", fetched_at=old),
             _item("e", from_cache=True, data={"not_fetched": True})]
    result = check_freshness(items, NOW)
    assert not result.passed and len(result.problems) == 3
    assert all("https://example.test/" in p for p in result.problems)


def test_freshness_passes_live():
    assert check_freshness([_item("a", fetched_at=NOW + timedelta(seconds=1))], NOW).passed


def test_freshness_treats_naive_as_utc():
    naive = NOW.replace(tzinfo=None)
    assert check_freshness([_item("a", fetched_at=naive)], NOW).passed

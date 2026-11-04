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
    assert not result.passed
    assert any("stale coverage key" in p and "gone" in p for p in result.problems)


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


def test_coverage_fails_on_empty_evidence():
    result = check_coverage([], _spec({}))
    assert not result.passed and result.problems == ["no evidence collected"]


def test_freshness_fails_on_empty_evidence():
    result = check_freshness([], NOW)
    assert not result.passed and result.problems == ["no evidence collected"]


def test_blank_mapped_to_fails():
    result = check_coverage([_item("a")], _spec({"a": {"mapped_to": ""}}))
    assert not result.passed and "unresolved mapping: a" in result.problems[0]


def _gap_spec(coverage) -> DegreeSpec:
    spec = _spec(coverage)
    return spec.model_validate({**spec.model_dump(), "known_gaps": [
        {"gap_id": "scanned", "description": "scanned page", "source_ids": ["pdf:d:unread-page-2"]}]})


UNREAD = {"page": 2, "unread": True}


def test_unread_page_mapped_to_known_gap_passes():
    spec = _gap_spec({"pdf:d:unread-page-2": {"mapped_to": "known_gaps[scanned]"}})
    assert check_coverage([_item("pdf:d:unread-page-2", data=UNREAD)], spec).passed


def test_unread_page_mapped_elsewhere_fails():
    for entry in ({"mapped_to": "categories[fluids]"}, {"not_planning_rule": "just a scan"}):
        result = check_coverage([_item("pdf:d:unread-page-2", data=UNREAD)], _gap_spec({"pdf:d:unread-page-2": entry}))
        assert not result.passed
        assert result.problems[0].startswith("unread page not in known_gaps: pdf:d:unread-page-2"), result.problems


def test_unread_page_to_missing_gap_is_unresolved():
    result = check_coverage([_item("pdf:d:unread-page-2", data=UNREAD)],
                            _gap_spec({"pdf:d:unread-page-2": {"mapped_to": "known_gaps[nope]"}}))
    assert not result.passed and result.problems[0].startswith("unresolved mapping:")


def test_coverage_gaps_is_shared_with_todo():
    from app.degrees.checks.coverage import UNREAD_NOT_GAP, coverage_gaps

    spec = _gap_spec({"pdf:d:unread-page-2": {"not_planning_rule": "x"}})
    gaps, _ = coverage_gaps([_item("pdf:d:unread-page-2", data=UNREAD)], spec)
    assert [(i.id, r) for i, r in gaps] == [("pdf:d:unread-page-2", UNREAD_NOT_GAP)]

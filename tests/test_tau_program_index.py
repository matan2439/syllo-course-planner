from unittest.mock import Mock, patch

import pytest
import requests

from app.scraping.tau_program_scraper import (
    ProgramSelectionError,
    find_unique_program,
    search_program_index,
)


def _program(tcid: str, title: str, *, school: str = "0510", degree: str = "1") -> dict:
    return {
        "tcid": tcid,
        "tclongkey": f"key-{tcid}",
        "teur": title,
        "title": title,
        "toar": degree,
        "faculta": "0500",
        "betsefer": school,
        "pail": "1",
        "showtochnit": "1",
        "shana": "2025",
        "teurshana": 'תשפ"ו (2025-2026)',
    }


def test_search_program_index_uses_the_official_get_programs_contract() -> None:
    response = Mock()
    response.raise_for_status.return_value = None
    response.json.return_value = {
        "data": {"getPrograms": {"total": 1, "results": [_program("1234", "הנדסת חשמל")]}}
    }

    with patch("app.scraping.tau_program_scraper.requests.post", return_value=response) as post:
        results = search_program_index(
            {"faculta": ["0500"], "betsefer": ["0510"], "toar": ["1"], "safa": "1"},
            size=50,
        )

    assert [result.tcid for result in results] == ["1234"]
    payload = post.call_args.kwargs["json"]
    assert "query getPrograms" in payload["query"]
    assert payload["variables"] == {
        "search": {"faculta": ["0500"], "betsefer": ["0510"], "toar": ["1"], "safa": "1"},
        "from": 0,
        "size": 50,
    }


def test_find_unique_program_requires_exact_authoritative_identity() -> None:
    search_results = [
        _program("1111", "הנדסת חשמל"),
        _program("2222", "הנדסת חשמל ופיזיקה"),
        _program("3333", "הנדסת חשמל", school="0512", degree="2"),
    ]

    selected = find_unique_program(
        search_results,
        title_he="  הנדסת   חשמל ",
        degree_level="1",
        school_code="0510",
    )

    assert selected.tcid == "1111"
    assert selected.title_he == "הנדסת חשמל"


def test_search_program_index_fails_closed_on_transport_or_shape_errors() -> None:
    with patch(
        "app.scraping.tau_program_scraper.requests.post",
        side_effect=requests.exceptions.Timeout("offline"),
    ):
        assert search_program_index({"toar": ["1"]}) == []

    malformed = Mock()
    malformed.raise_for_status.return_value = None
    malformed.json.return_value = {"data": {"getPrograms": {"results": "not-a-list"}}}
    with patch("app.scraping.tau_program_scraper.requests.post", return_value=malformed):
        assert search_program_index({"toar": ["1"]}) == []


@pytest.mark.parametrize(
    "results",
    [
        [],
        [_program("1111", "הנדסת חשמל"), _program("2222", "הנדסת חשמל")],
    ],
)
def test_find_unique_program_fails_closed_for_missing_or_ambiguous_results(results: list[dict]) -> None:
    with pytest.raises(ProgramSelectionError):
        find_unique_program(
            results,
            title_he="הנדסת חשמל",
            degree_level="1",
            school_code="0510",
        )

"""Curation overlay: shape of the committed ME overlay, and the loader's stale-entry guards."""
import copy
import sys
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "scripts"))

import degree  # noqa: E402
from app.degrees.curation import (  # noqa: E402
    StaleCurationError, apply_curation, curation_path, entry_boards, load_curation, validate_entries,
)
from app.degrees.registry import get_program  # noqa: E402
from app.degrees.spec import spec_path  # noqa: E402

ME = get_program("mechanical_engineering_2027")


def test_me_overlay_entries_have_reasons_and_unique_targets():
    entries = load_curation(curation_path(spec_path(ME)))
    assert entries, "ME overlay is committed"
    keys = set(degree.board_paths(ME))
    seen = set()
    for e in entries:
        assert e["reason"].strip(), e
        for board in entry_boards(e):
            assert board in keys, e
            key = (board, e["course_id"], e["field"])
            assert key not in seen, key
            seen.add(key)


def _board():
    return {
        "semesters": [
            {"semester_id": "s_a", "total_weekly_hours": 3, "courses": [{"course_id": "M1", "weekly_hours": 3}]},
            {"semester_id": "s_b", "total_weekly_hours": 0, "courses": []},
        ],
        "metadata": {
            "program_requirements_categories": {"categories": [{"category_id": "cat", "is_core": True}]},
            "program_repository_courses": [{"course_id": "E1", "name_he": "x"}],
        },
    }


def _entry(**kw):
    return {"board": "b", "course_id": None, "reason": "test", **kw}


def test_apply_sets_omits_and_places():
    board = _board()
    entries = [
        _entry(course_id="M1", field="placement", value={"s_b": 0}),
        _entry(course_id="E1", field="name_source", value="program_json"),
        _entry(course_id="M1", field="note", value="moved"),
        _entry(field="metadata.program_requirements_categories.categories[cat].is_core", omit=True),
        _entry(field="semesters[s_b].total_weekly_hours", value=3),
    ]
    validate_entries(entries)
    assert apply_curation(board, entries, "b") == 5
    assert board["semesters"][0]["courses"] == []
    assert board["semesters"][1]["courses"] == [{"course_id": "M1", "weekly_hours": 3, "note": "moved"}]
    assert board["metadata"]["program_repository_courses"][0]["name_source"] == "program_json"
    assert "is_core" not in board["metadata"]["program_requirements_categories"]["categories"][0]
    assert board["semesters"][1]["total_weekly_hours"] == 3


def test_entries_for_other_boards_are_ignored():
    board = _board()
    before = copy.deepcopy(board)
    assert apply_curation(board, [_entry(board="other", course_id="E1", field="x", value=1)], "b") == 0
    assert board == before


@pytest.mark.parametrize("entry", [
    _entry(course_id="GONE", field="name_he", value="y"),                 # course no longer built
    _entry(course_id="E1", field="name_he", value="x"),                   # builder already produces it
    _entry(course_id="E1", field="missing", omit=True),                   # nothing to omit
    _entry(course_id="M1", field="placement", value={"s_a": 0}),          # already placed there
    _entry(course_id="E1", field="placement", value={"s_a": 0}),          # not a placed course
    _entry(field="metadata.nope.x", value=1),                             # path gone
    _entry(field="semesters[s_z].total_weekly_hours", value=1),           # selector gone
])
def test_stale_entries_fail_loudly(entry):
    with pytest.raises(StaleCurationError):
        apply_curation(_board(), [entry], "b")


@pytest.mark.parametrize("entries", [
    [_entry(course_id="E1", field="x", value=1, reason=" ")],
    [_entry(course_id="E1", field="x", value=1), _entry(course_id="E1", field="x", value=2)],
    [_entry(board=["b", "c"], course_id="E1", field="x", value=1), _entry(board="c", course_id="E1", field="x", value=2)],
    [_entry(course_id="E1", field="x")],                                   # neither value nor omit
    [_entry(course_id="E1", field="x", value=1, omit=True)],               # both
    [_entry(course_id="E1", field="placement", value=["s_a"])],
    [{**_entry(course_id="E1", field="x", value=1), "extra": True}],
])
def test_invalid_entries_rejected(entries):
    with pytest.raises(ValueError):
        validate_entries(entries)

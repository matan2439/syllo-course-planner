"""Curation overlay: shape of the committed ME overlay, and the loader's stale/divergence guards."""
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


def test_me_overlay_entries_have_reasons_unique_targets_and_retire_tags():
    entries = load_curation(curation_path(spec_path(ME)))
    assert entries, "ME overlay is committed"
    keys = set(degree.board_paths(ME))
    seen = set()
    for e in entries:
        assert e["reason"].strip(), e
        assert e["retire"] in ("post_migration", None), e
        assert ("built" in e) != bool(e.get("built_missing")), e
        for board in entry_boards(e):
            assert board in keys, e
            key = (board, e["course_id"], e["field"])
            assert key not in seen, key
            seen.add(key)
    # Durable hand corrections are the minority; everything else goes with the first real update.
    durable = {e["course_id"] for e in entries if e["retire"] is None}
    assert {"0542-3792", "0542-3780", "0542-3791", "0542-4624"} <= durable


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
    return {"board": "b", "course_id": None, "retire": "post_migration", "reason": "test", **kw}


def test_apply_sets_omits_and_places_when_built_matches():
    board = _board()
    entries = [
        _entry(course_id="M1", field="placement", value={"s_b": 0}, built={"s_a": 0}),
        _entry(course_id="E1", field="name_source", value="program_json", built_missing=True),
        _entry(course_id="M1", field="note", value="moved", built_missing=True),
        _entry(field="metadata.program_requirements_categories.categories[cat].is_core", omit=True, built=True),
        _entry(field="semesters[s_b].total_weekly_hours", value=3, built=0, retire=None),
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
    entry = _entry(board="other", course_id="E1", field="x", value=1, built_missing=True)
    assert apply_curation(board, [entry], "b") == 0
    assert board == before


def test_divergence_raises():
    # The overlay was written when the build said "x"; fresh official data now says "y".
    board = _board()
    board["metadata"]["program_repository_courses"][0]["name_he"] = "y"
    with pytest.raises(StaleCurationError, match="diverged"):
        apply_curation(board, [_entry(course_id="E1", field="name_he", value="kept", built="x")], "b")
    with pytest.raises(StaleCurationError, match="diverged"):  # the field now exists where it was absent
        apply_curation(_board(), [_entry(course_id="E1", field="name_he", value="kept", built_missing=True)], "b")
    with pytest.raises(StaleCurationError, match="diverged"):
        apply_curation(_board(), [_entry(course_id="M1", field="placement", value={"s_b": 0}, built={"s_b": 1})], "b")


def test_convergence_raises():
    with pytest.raises(StaleCurationError, match="already produces"):
        apply_curation(_board(), [_entry(course_id="E1", field="name_he", value="x", built="old")], "b")
    with pytest.raises(StaleCurationError, match="already produces"):
        apply_curation(_board(), [_entry(course_id="E1", field="gone", omit=True, built=1)], "b")


@pytest.mark.parametrize("entry", [
    _entry(course_id="GONE", field="name_he", value="y", built="x"),                 # course no longer built
    _entry(course_id="E1", field="placement", value={"s_a": 0}, built={"s_a": 1}),   # not a placed course
    _entry(field="metadata.nope.x", value=1, built=0),                               # path gone
    _entry(field="semesters[s_z].total_weekly_hours", value=1, built=0),             # selector gone
])
def test_missing_targets_raise(entry):
    with pytest.raises(StaleCurationError):
        apply_curation(_board(), [entry], "b")


@pytest.mark.parametrize("entries", [
    [_entry(course_id="E1", field="x", value=1, built=0, reason=" ")],
    [_entry(course_id="E1", field="x", value=1, built=0), _entry(course_id="E1", field="x", value=2, built=0)],
    [_entry(board=["b", "c"], course_id="E1", field="x", value=1, built=0),
     _entry(board="c", course_id="E1", field="x", value=2, built=0)],
    [_entry(course_id="E1", field="x", built=0)],                                   # neither value nor omit
    [_entry(course_id="E1", field="x", value=1, omit=True, built=0)],               # both
    [_entry(course_id="E1", field="x", value=1)],                                   # no built
    [_entry(course_id="E1", field="x", value=1, built=0, built_missing=True)],     # both built forms
    [_entry(course_id="E1", field="x", omit=True, built_missing=True)],            # omit of nothing
    [_entry(course_id="E1", field="x", value=1, built=1)],                          # no-op
    [{k: v for k, v in _entry(course_id="E1", field="x", value=1, built=0).items() if k != "retire"}],
    [_entry(course_id="E1", field="x", value=1, built=0, retire="someday")],
    [_entry(course_id="E1", field="placement", value=["s_a"], built={"s_a": 0})],
    [{**_entry(course_id="E1", field="x", value=1, built=0), "extra": True}],
])
def test_invalid_entries_rejected(entries):
    with pytest.raises(ValueError):
        validate_entries(entries)


# ---------------------------------------------------------------- byte-stable writer


def test_conform_keeps_previous_layout_without_changing_values():
    old = {"b": 1, "a": {"y": 2, "x": 1}, "items": [{"course_id": "c2", "v": 1}, {"course_id": "c1", "v": 2}]}
    new = {"a": {"x": 1.0, "y": 3, "z": 0}, "items": [{"course_id": "c1", "v": 2.0}, {"course_id": "c2", "v": 5}],
           "b": 1.0, "new": True}
    out = degree.conform(new, old, keep_timestamps=False)
    assert out == new
    assert list(out) == ["b", "a", "items", "new"]                  # previous key order, new keys last
    assert list(out["a"]) == ["y", "x", "z"]
    assert isinstance(out["b"], int) and isinstance(out["a"]["x"], int)  # equal value keeps old spelling
    assert out["a"]["y"] == 3                                        # a changed value is the new one
    assert [i["course_id"] for i in out["items"]] == ["c1", "c2"]    # the build's item order wins
    assert isinstance(out["items"][0]["v"], int)


def test_offline_conform_neither_restamps_nor_drops_fetch_times():
    old = {"courses": [{"course_id": "a", "syllabus_last_fetched_at": "2026-06-10", "s": "old"},
                       {"course_id": "b", "s": "x"}]}
    new = {"courses": [{"course_id": "a", "s": "old"},                                   # stamp lost in build
                       {"course_id": "b", "s": "x", "syllabus_last_fetched_at": "now"},  # re-stamped from cache
                       {"course_id": "c", "syllabus_last_fetched_at": "now"}]}           # brand-new record
    out = degree.conform(new, old, keep_timestamps=True)
    assert out["courses"][0]["syllabus_last_fetched_at"] == "2026-06-10"
    assert "syllabus_last_fetched_at" not in out["courses"][1]
    assert "syllabus_last_fetched_at" not in out["courses"][2]
    live = degree.conform(new, old, keep_timestamps=False)
    assert live["courses"][1]["syllabus_last_fetched_at"] == "now"

"""Tests for the annual/multi-placement-aware verify-live spot-check
(scripts.course_planner_pipeline.verify_board_placements)."""

from scripts.course_planner_pipeline import verify_board_placements


def _board(*placements):
    """placements: (semester_id, course_dict) tuples -> board with semesters."""
    sems: dict[str, dict] = {}
    for sem_id, course in placements:
        sems.setdefault(sem_id, {"semester_id": sem_id, "courses": []})
        sems[sem_id]["courses"].append(course)
    return {"semesters": list(sems.values())}


A = "year_3_semester_a"
B = "year_3_semester_b"


def test_annual_in_both_span_semesters_passes():
    annual = {
        "course_id": "0542-3792",
        "is_annual": True,
        "spans_semesters": [A, B],
        "count_hours_once": True,
        "effective_allowed_semesters": [A, B],
    }
    local = _board((A, annual), (B, annual))
    live = _board((A, annual), (B, annual))
    ok, msgs = verify_board_placements(local, live)
    assert ok, msgs


def test_annual_missing_one_span_fails():
    annual = {
        "course_id": "0542-3792",
        "is_annual": True,
        "spans_semesters": [A, B],
        "count_hours_once": True,
        "effective_allowed_semesters": [A, B],
    }
    local = _board((A, annual), (B, annual))
    live = _board((B, annual))  # missing the A placement live
    ok, msgs = verify_board_placements(local, live)
    assert not ok
    assert any("missing live placement" in m and "0542-3792" in m for m in msgs)


def test_annual_missing_count_hours_once_live_fails():
    local_c = {"course_id": "0542-3792", "is_annual": True, "spans_semesters": [A, B], "count_hours_once": True}
    live_c = {"course_id": "0542-3792", "is_annual": True, "spans_semesters": [A, B]}  # no count_hours_once
    local = _board((A, local_c), (B, local_c))
    live = _board((A, live_c), (B, live_c))
    ok, msgs = verify_board_placements(local, live)
    assert not ok
    assert any("count_hours_once" in m for m in msgs)


def test_normal_single_semester_passes():
    c = {"course_id": "0542-3780", "effective_allowed_semesters": [B]}
    local = _board((B, c))
    live = _board((B, c))
    ok, msgs = verify_board_placements(local, live)
    assert ok, msgs


def test_normal_placed_locally_but_missing_live_fails():
    c = {"course_id": "0542-3780", "effective_allowed_semesters": [B]}
    local = _board((B, c))
    live = {"semesters": []}
    ok, msgs = verify_board_placements(local, live)
    assert not ok
    assert any("missing from live board" in m for m in msgs)


def test_normal_duplicated_into_unexpected_semester_fails():
    c = {"course_id": "0542-3780", "effective_allowed_semesters": [A, B]}
    local = _board((B, c))
    live = _board((A, c), (B, c))  # appears in an unexpected extra live semester
    ok, msgs = verify_board_placements(local, live)
    assert not ok
    assert any("unexpected live semester" in m for m in msgs)


def test_live_placement_outside_effective_fails():
    c_local = {"course_id": "0542-3780", "effective_allowed_semesters": [B]}
    c_live = {"course_id": "0542-3780", "effective_allowed_semesters": [B], "_x": 1}
    local = _board((B, c_local))
    # live places it in A even though effective is B-only
    live = _board((A, c_live))
    ok, msgs = verify_board_placements(local, live)
    assert not ok
    assert any("outside effective_allowed_semesters" in m for m in msgs)

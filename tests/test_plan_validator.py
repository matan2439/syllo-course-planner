"""
Tests for plan_validator: validate_course_placement and validate_entire_board.
Covers all 6 rules plus board-level aggregation and semester_board integration.
"""

import pytest
from pathlib import Path

from app.analysis.plan_validator import validate_course_placement, validate_entire_board
from app.database.db import init_db, save_merged_course
from app.analysis.semester_board import build_semester_board


# ---------------------------------------------------------------------------
# Board / course fixtures
# ---------------------------------------------------------------------------

def _board(*semesters_spec) -> dict:
    """
    Build a minimal board dict.
    Each semester_spec is (semester_id, [(course_id, [prereq_ids]), ...]).
    """
    semesters = []
    for sem_id, courses in semesters_spec:
        semesters.append({
            "semester_id": sem_id,
            "courses": [
                {"course_id": cid, "prerequisites": prereqs}
                for cid, prereqs in courses
            ],
        })
    return {"semesters": semesters}


# Semester IDs used in tests
S1 = "year_3_semester_a"
S2 = "year_3_semester_b"
S3 = "year_4_semester_a"
S4 = "year_4_semester_b"


# ---------------------------------------------------------------------------
# validate_course_placement — Rule 1: satisfied by completed
# ---------------------------------------------------------------------------

def test_valid_prereq_completed():
    board = _board(
        (S1, [("A", ["P"])]),
    )
    r = validate_course_placement("A", S1, board, completed_course_ids=["P"])
    assert r["valid"]
    assert "P" in r["satisfied_by_completed"]
    assert r["severity"] == "ok"


def test_valid_no_prereqs():
    board = _board((S1, [("A", [])]))
    r = validate_course_placement("A", S1, board, completed_course_ids=[])
    assert r["valid"]
    assert r["severity"] == "ok"


def test_valid_multiple_prereqs_all_completed():
    board = _board((S1, [("A", ["P1", "P2"])]))
    r = validate_course_placement("A", S1, board, completed_course_ids=["P1", "P2"])
    assert r["valid"]
    assert set(r["satisfied_by_completed"]) == {"P1", "P2"}


# ---------------------------------------------------------------------------
# Rule 2: satisfied by earlier semester
# ---------------------------------------------------------------------------

def test_valid_prereq_in_earlier_semester():
    board = _board(
        (S1, [("P", [])]),
        (S2, [("A", ["P"])]),
    )
    r = validate_course_placement("A", S2, board, completed_course_ids=[])
    assert r["valid"]
    assert "P" in r["satisfied_by_earlier_semesters"]


def test_valid_prereq_two_semesters_earlier():
    board = _board(
        (S1, [("P", [])]),
        (S2, []),
        (S3, [("A", ["P"])]),
    )
    r = validate_course_placement("A", S3, board, completed_course_ids=[])
    assert r["valid"]
    assert "P" in r["satisfied_by_earlier_semesters"]


# ---------------------------------------------------------------------------
# Rule 3: same-semester prereq is invalid
# ---------------------------------------------------------------------------

def test_invalid_prereq_same_semester():
    board = _board(
        (S1, [("P", []), ("A", ["P"])]),
    )
    r = validate_course_placement("A", S1, board, completed_course_ids=[])
    assert not r["valid"]
    assert "P" in r["prerequisites_scheduled_same_semester"]
    assert r["severity"] == "error"


# ---------------------------------------------------------------------------
# Rule 4: later-semester prereq is invalid
# ---------------------------------------------------------------------------

def test_invalid_prereq_later_semester():
    board = _board(
        (S1, [("A", ["P"])]),
        (S2, [("P", [])]),
    )
    r = validate_course_placement("A", S1, board, completed_course_ids=[])
    assert not r["valid"]
    assert "P" in r["prerequisites_scheduled_too_late"]
    assert r["severity"] == "error"


# ---------------------------------------------------------------------------
# Rule 5: missing prereq is invalid
# ---------------------------------------------------------------------------

def test_invalid_prereq_missing():
    board = _board((S1, [("A", ["P"])]))
    r = validate_course_placement("A", S1, board, completed_course_ids=[])
    assert not r["valid"]
    assert "P" in r["missing_prerequisites"]
    assert r["severity"] == "error"


def test_invalid_prereq_missing_not_completed():
    board = _board((S2, [("A", ["P"])]))
    # P is not completed and not placed anywhere
    r = validate_course_placement("A", S2, board, completed_course_ids=["Q"])
    assert not r["valid"]
    assert "P" in r["missing_prerequisites"]
    assert "Q" not in r["missing_prerequisites"]


# ---------------------------------------------------------------------------
# Rule 6: unknown target semester
# ---------------------------------------------------------------------------

def test_invalid_unknown_target_semester():
    board = _board((S1, [("A", [])]))
    r = validate_course_placement("A", "nonexistent", board, completed_course_ids=[])
    assert not r["valid"]
    assert r["severity"] == "error"


# ---------------------------------------------------------------------------
# Mixed prerequisite states
# ---------------------------------------------------------------------------

def test_mixed_prereqs_one_missing():
    board = _board(
        (S1, [("P1", [])]),
        (S2, [("A", ["P1", "P2"])]),
    )
    r = validate_course_placement("A", S2, board, completed_course_ids=[])
    assert not r["valid"]
    assert "P1" in r["satisfied_by_earlier_semesters"]
    assert "P2" in r["missing_prerequisites"]


def test_mixed_prereqs_completed_and_earlier():
    board = _board(
        (S1, [("P1", [])]),
        (S2, [("A", ["P1", "P2"])]),
    )
    r = validate_course_placement("A", S2, board, completed_course_ids=["P2"])
    assert r["valid"]
    assert "P1" in r["satisfied_by_earlier_semesters"]
    assert "P2" in r["satisfied_by_completed"]


# ---------------------------------------------------------------------------
# Override prerequisites parameter
# ---------------------------------------------------------------------------

def test_override_prerequisites_param():
    # Board says A has no prereqs, but we pass prereqs=["P"]
    board = _board((S2, [("A", []), ("P", [])]))
    # P is in S2 (same semester) — should be invalid
    r = validate_course_placement("A", S2, board, completed_course_ids=[], prerequisites=["P"])
    assert not r["valid"]
    assert "P" in r["prerequisites_scheduled_same_semester"]


def test_override_prerequisites_empty():
    board = _board((S1, [("A", ["P"])]))
    r = validate_course_placement("A", S1, board, completed_course_ids=[], prerequisites=[])
    assert r["valid"]  # no prereqs → valid


# ---------------------------------------------------------------------------
# Explanation and severity
# ---------------------------------------------------------------------------

def test_explanation_valid():
    board = _board((S1, [("P", [])]), (S2, [("A", ["P"])]))
    r = validate_course_placement("A", S2, board, completed_course_ids=[])
    assert r["explanation"]
    assert "מסופקות" in r["explanation"]


def test_explanation_invalid_contains_reason():
    board = _board((S1, [("A", ["P"])]))
    r = validate_course_placement("A", S1, board, completed_course_ids=[])
    assert r["explanation"]
    # Should mention the missing/invalid prereq somehow
    assert "P" in r["explanation"] or "לא" in r["explanation"]


# ---------------------------------------------------------------------------
# validate_entire_board
# ---------------------------------------------------------------------------

def test_entire_board_all_valid():
    board = _board(
        (S1, [("P", [])]),
        (S2, [("A", ["P"])]),
    )
    result = validate_entire_board(board, completed_course_ids=[])
    assert result["valid"]
    assert result["summary"]["invalid_placements"] == 0
    assert result["summary"]["valid_placements"] == 2


def test_entire_board_one_invalid():
    board = _board(
        (S1, [("A", ["P"])]),  # P missing
        (S2, [("P", [])]),     # P placed AFTER A
    )
    result = validate_entire_board(board, completed_course_ids=[])
    assert not result["valid"]
    assert result["summary"]["invalid_placements"] >= 1
    assert len(result["board_errors"]) >= 1


def test_entire_board_multiple_errors():
    board = _board(
        (S1, [("A", ["P1"]), ("B", ["P2"])]),
    )
    result = validate_entire_board(board, completed_course_ids=[])
    assert not result["valid"]
    assert result["summary"]["invalid_placements"] == 2


def test_entire_board_empty():
    board = _board((S1, []), (S2, []))
    result = validate_entire_board(board, completed_course_ids=[])
    assert result["valid"]
    assert result["summary"]["total_courses"] == 0


def test_entire_board_course_results_per_course():
    board = _board(
        (S1, [("P", [])]),
        (S2, [("A", ["P"]), ("B", [])]),
    )
    result = validate_entire_board(board, completed_course_ids=[])
    cids = {r["course_id"] for r in result["course_results"]}
    assert cids == {"P", "A", "B"}


def test_moving_prereq_later_invalidates_dependent():
    """
    Simulate: A depends on P. Initially P before A. Move P to after A.
    Board reflects new state → A becomes invalid.
    """
    # P in S1 (earlier than S2) — valid
    board_valid = _board((S1, [("P", [])]), (S2, [("A", ["P"])]))
    r_valid = validate_entire_board(board_valid, [])
    assert r_valid["valid"]

    # P moved to S3 (after A in S2) — A invalid
    board_invalid = _board((S2, [("A", ["P"])]), (S3, [("P", [])]))
    r_invalid = validate_entire_board(board_invalid, [])
    assert not r_invalid["valid"]
    a_result = next(r for r in r_invalid["course_results"] if r["course_id"] == "A")
    assert "P" in a_result["prerequisites_scheduled_too_late"]


# ---------------------------------------------------------------------------
# Integration — semester_board embeds validation_status
# ---------------------------------------------------------------------------

@pytest.fixture
def tmp_db(tmp_path):
    db = tmp_path / "pv_test.sqlite"
    init_db(db)
    return db


def _course(course_id: str, prereqs=None, **kwargs) -> dict:
    return {
        "course_id": course_id, "name_he": course_id, "name_en": None,
        "faculty": None, "department": None, "year": 2025, "semester": None,
        "credits": None, "lecture_hours": 3.0, "tutorial_hours": None,
        "lab_hours": None, "prerequisites_raw_text": None,
        "prerequisite_course_ids": prereqs or [],
        "course_description": None, "topics": [], "assignments": None,
        "exam_info": None, "syllabus_links": [], "groups": [], "source_files": {},
        **kwargs,
    }


def _plan(*course_ids, prereqs_map=None) -> dict:
    prereqs_map = prereqs_map or {}
    return {
        "selected_courses": [
            {
                "course_id": cid,
                "name_he":   cid,
                "weekly_hours":    3.0,
                "difficulty_score": 2.0,
                "difficulty_level": "medium",
                "prerequisites":   prereqs_map.get(cid, []),
            }
            for cid in course_ids
        ]
    }


def test_board_courses_have_validation_status(tmp_db):
    save_merged_course(_course("A"), tmp_db)
    board = build_semester_board(_plan("A"), db_path=tmp_db)
    courses = [c for s in board["semesters"] for c in s["courses"]]
    assert any(c["course_id"] == "A" for c in courses)
    for c in courses:
        assert "validation_status" in c
        assert c["validation_status"] in ("ok", "error")


def test_board_metadata_has_completed_ids(tmp_db):
    save_merged_course(_course("A"), tmp_db)
    board = build_semester_board(_plan("A"), completed_course_ids=["X"], db_path=tmp_db)
    assert board["metadata"]["completed_course_ids"] == ["X"]


def test_board_metadata_has_validation_summary(tmp_db):
    save_merged_course(_course("A"), tmp_db)
    board = build_semester_board(_plan("A"), db_path=tmp_db)
    assert "board_validation" in board["metadata"]
    bv = board["metadata"]["board_validation"]
    assert "valid" in bv and "invalid_count" in bv


def test_board_course_valid_when_prereq_completed(tmp_db):
    save_merged_course(_course("A", prereqs=["P"]), tmp_db)
    board = build_semester_board(_plan("A"), completed_course_ids=["P"], db_path=tmp_db)
    courses = [c for s in board["semesters"] for c in s["courses"]]
    a = next((c for c in courses if c["course_id"] == "A"), None)
    assert a is not None
    assert a["validation_status"] == "ok"


def test_board_course_invalid_when_prereq_missing(tmp_db):
    save_merged_course(_course("A", prereqs=["P"]), tmp_db)
    # P not in plan, not completed
    board = build_semester_board(
        _plan("A", prereqs_map={"A": ["P"]}),
        completed_course_ids=[],
        db_path=tmp_db,
    )
    courses = [c for s in board["semesters"] for c in s["courses"]]
    a = next((c for c in courses if c["course_id"] == "A"), None)
    assert a is not None
    assert a["validation_status"] == "error"
    assert "P" in a["validation_errors"]


def test_board_valid_when_prereq_scheduled_earlier(tmp_db):
    save_merged_course(_course("P"), tmp_db)
    save_merged_course(_course("A", prereqs=["P"]), tmp_db)
    # Both in plan — topological sort puts P before A
    board = build_semester_board(
        _plan("A", "P", prereqs_map={"A": ["P"]}),
        completed_course_ids=[],
        db_path=tmp_db,
    )
    courses = [c for s in board["semesters"] for c in s["courses"]]
    a = next((c for c in courses if c["course_id"] == "A"), None)
    assert a is not None
    # P should be placed before A by the topological sort
    p_sem = next(s["semester_id"] for s in board["semesters"] if any(c["course_id"] == "P" for c in s["courses"]))
    a_sem = next(s["semester_id"] for s in board["semesters"] if any(c["course_id"] == "A" for c in s["courses"]))
    sem_ids = [s["semester_id"] for s in board["semesters"]]
    assert sem_ids.index(p_sem) < sem_ids.index(a_sem)
    assert a["validation_status"] == "ok"

import pytest
from pathlib import Path

from app.database.db import init_db, save_merged_course
from app.analysis.eligibility_engine import (
    normalize_course_id,
    check_course_eligibility,
    list_eligible_courses,
    list_blocked_courses,
)


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _course(course_id: str, prereqs: list[str]) -> dict:
    return {
        "course_id": course_id,
        "name_he": course_id,
        "name_en": None,
        "faculty": None,
        "department": None,
        "year": 2025,
        "semester": None,
        "credits": None,
        "lecture_hours": None,
        "tutorial_hours": None,
        "lab_hours": None,
        "prerequisites_raw_text": None,
        "prerequisite_course_ids": prereqs,
        "course_description": None,
        "topics": [],
        "assignments": None,
        "exam_info": None,
        "syllabus_links": [],
        "groups": [],
        "source_files": {},
    }


@pytest.fixture
def tmp_db(tmp_path):
    db = tmp_path / "elig_test.sqlite"
    init_db(db)
    return db


@pytest.fixture
def populated_db(tmp_db):
    """
    A: no prereqs
    B: requires A
    C: requires A, B
    """
    save_merged_course(_course("A", []),         tmp_db)
    save_merged_course(_course("B", ["A"]),      tmp_db)
    save_merged_course(_course("C", ["A", "B"]), tmp_db)
    return tmp_db


# ---------------------------------------------------------------------------
# normalize_course_id
# ---------------------------------------------------------------------------

def test_normalize_digits_only():
    assert normalize_course_id("03682157") == "0368-2157"

def test_normalize_already_hyphenated():
    assert normalize_course_id("0368-2157") == "0368-2157"

def test_normalize_dot_separator():
    assert normalize_course_id("0368.2157") == "0368-2157"

def test_normalize_short_passthrough():
    assert normalize_course_id("abc") == "abc"

def test_normalize_strips_spaces():
    assert normalize_course_id("0368 2157") == "0368-2157"


# ---------------------------------------------------------------------------
# check_course_eligibility — eligible cases
# ---------------------------------------------------------------------------

def test_no_prereqs_always_eligible(populated_db):
    r = check_course_eligibility("A", [], populated_db)
    assert r["eligible"] is True

def test_satisfied_prereq_eligible(populated_db):
    r = check_course_eligibility("B", ["A"], populated_db)
    assert r["eligible"] is True

def test_all_prereqs_satisfied(populated_db):
    r = check_course_eligibility("C", ["A", "B"], populated_db)
    assert r["eligible"] is True

def test_satisfied_list_populated(populated_db):
    r = check_course_eligibility("B", ["A"], populated_db)
    assert "A" in r["satisfied_prerequisites"]

def test_missing_list_empty_when_eligible(populated_db):
    r = check_course_eligibility("B", ["A"], populated_db)
    assert r["missing_prerequisites"] == []


# ---------------------------------------------------------------------------
# check_course_eligibility — blocked cases
# ---------------------------------------------------------------------------

def test_missing_prereq_blocked(populated_db):
    r = check_course_eligibility("B", [], populated_db)
    assert r["eligible"] is False

def test_missing_list_populated(populated_db):
    r = check_course_eligibility("B", [], populated_db)
    assert "A" in r["missing_prerequisites"]

def test_partial_prereqs_still_blocked(populated_db):
    r = check_course_eligibility("C", ["A"], populated_db)
    assert r["eligible"] is False
    assert "B" in r["missing_prerequisites"]
    assert "A" in r["satisfied_prerequisites"]

def test_empty_completed_blocks_course_with_prereqs(populated_db):
    r = check_course_eligibility("C", [], populated_db)
    assert r["eligible"] is False
    assert set(r["missing_prerequisites"]) == {"A", "B"}


# ---------------------------------------------------------------------------
# check_course_eligibility — structure
# ---------------------------------------------------------------------------

def test_result_has_all_keys(populated_db):
    r = check_course_eligibility("B", ["A"], populated_db)
    assert {
        "course_id", "eligible", "direct_prerequisites",
        "satisfied_prerequisites", "missing_prerequisites", "explanation",
    } == set(r.keys())

def test_course_id_is_normalized(populated_db):
    save_merged_course(_course("0368-2157", ["0368-1105"]), populated_db)
    r = check_course_eligibility("03682157", ["03681105"], populated_db)
    assert r["course_id"] == "0368-2157"
    assert r["eligible"] is True

def test_explanation_non_empty(populated_db):
    r = check_course_eligibility("B", [], populated_db)
    assert isinstance(r["explanation"], str) and len(r["explanation"]) > 0

def test_explanation_no_prereqs(populated_db):
    r = check_course_eligibility("A", [], populated_db)
    assert "No prerequisites" in r["explanation"]

def test_explanation_eligible(populated_db):
    r = check_course_eligibility("B", ["A"], populated_db)
    assert "satisfied" in r["explanation"]

def test_explanation_blocked(populated_db):
    r = check_course_eligibility("B", [], populated_db)
    assert "Missing" in r["explanation"]


# ---------------------------------------------------------------------------
# list_eligible_courses
# ---------------------------------------------------------------------------

def test_list_eligible_empty_completed(populated_db):
    rows = list_eligible_courses([], populated_db)
    ids = [r["course_id"] for r in rows]
    assert "A" in ids          # no prereqs
    assert "B" not in ids
    assert "C" not in ids

def test_list_eligible_with_a_completed(populated_db):
    rows = list_eligible_courses(["A"], populated_db)
    ids = [r["course_id"] for r in rows]
    assert "A" in ids
    assert "B" in ids
    assert "C" not in ids

def test_list_eligible_all_completed(populated_db):
    rows = list_eligible_courses(["A", "B"], populated_db)
    ids = [r["course_id"] for r in rows]
    assert set(ids) == {"A", "B", "C"}

def test_list_eligible_empty_db(tmp_db):
    assert list_eligible_courses([], tmp_db) == []


# ---------------------------------------------------------------------------
# list_blocked_courses
# ---------------------------------------------------------------------------

def test_list_blocked_empty_completed(populated_db):
    rows = list_blocked_courses([], populated_db)
    ids = [r["course_id"] for r in rows]
    assert "B" in ids
    assert "C" in ids
    assert "A" not in ids

def test_list_blocked_a_completed(populated_db):
    rows = list_blocked_courses(["A"], populated_db)
    ids = [r["course_id"] for r in rows]
    assert "C" in ids
    assert "B" not in ids

def test_list_blocked_all_completed(populated_db):
    rows = list_blocked_courses(["A", "B", "C"], populated_db)
    assert rows == []

def test_list_blocked_empty_db(tmp_db):
    assert list_blocked_courses([], tmp_db) == []


# ---------------------------------------------------------------------------
# Integration: real DB
# ---------------------------------------------------------------------------

_REAL_DB = Path("data/database.sqlite")


@pytest.fixture
def real_db():
    if not _REAL_DB.exists():
        pytest.skip(f"Missing: {_REAL_DB}")
    return _REAL_DB


def test_real_eligible_with_prereq(real_db):
    r = check_course_eligibility("0368-2157", ["03681105"], real_db)
    assert r["eligible"] is True

def test_real_blocked_without_prereq(real_db):
    r = check_course_eligibility("0368-2157", [], real_db)
    assert r["eligible"] is False
    assert "03681105" in r["missing_prerequisites"]

def test_real_list_eligible_includes_software1(real_db):
    rows = list_eligible_courses(["03681105"], real_db)
    ids = [r["course_id"] for r in rows]
    assert "0368-2157" in ids

def test_real_list_blocked_includes_software1(real_db):
    rows = list_blocked_courses([], real_db)
    ids = [r["course_id"] for r in rows]
    assert "0368-2157" in ids

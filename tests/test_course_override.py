"""
Tests for CourseOverride model, load/save helpers, and difficulty estimator
override integration.
"""

import json
import pytest
from pathlib import Path

from app.models.course_override import CourseOverride, load_course_overrides, save_course_overrides
from app.database.db import init_db, save_merged_course
from app.analysis.difficulty_estimator import estimate_course_difficulty


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _override(**kwargs) -> CourseOverride:
    return CourseOverride.model_validate(kwargs)


def _course(course_id: str, **kwargs) -> dict:
    base = {
        "course_id": course_id, "name_he": course_id, "name_en": None,
        "faculty": None, "department": None, "year": 2025, "semester": None,
        "credits": None, "lecture_hours": None, "tutorial_hours": None,
        "lab_hours": None, "prerequisites_raw_text": None,
        "prerequisite_course_ids": [], "course_description": None,
        "topics": [], "assignments": None, "exam_info": None,
        "syllabus_links": [], "groups": [], "source_files": {},
    }
    base.update(kwargs)
    return base


@pytest.fixture
def tmp_db(tmp_path):
    db = tmp_path / "ov_test.sqlite"
    init_db(db)
    return db


# ---------------------------------------------------------------------------
# CourseOverride model
# ---------------------------------------------------------------------------

def test_default_override_has_no_data():
    ov = CourseOverride()
    assert not ov.has_any_data()


def test_override_with_notes_has_data():
    ov = _override(user_notes="interesting course")
    assert ov.has_any_data()


def test_override_with_manual_hours_has_data():
    ov = _override(manual_weekly_hours=4.0)
    assert ov.has_any_data()


def test_override_extra_text_combines_notes():
    ov = _override(user_notes="dynamics", manual_conceptual_complexity_note="hard proofs")
    txt = ov.extra_text()
    assert "dynamics" in txt
    assert "hard proofs" in txt


def test_override_extra_text_empty_by_default():
    ov = CourseOverride()
    assert ov.extra_text() == ""


def test_override_confidence_adjustment_bounds():
    with pytest.raises(Exception):
        CourseOverride.model_validate({"confidence_adjustment": 2.0})


def test_override_extra_ignore_unknown_fields():
    ov = CourseOverride.model_validate({"unknown_field": "x", "user_notes": "hi"})
    assert ov.user_notes == "hi"


# ---------------------------------------------------------------------------
# load_course_overrides
# ---------------------------------------------------------------------------

def test_load_missing_file_returns_empty(tmp_path):
    result = load_course_overrides(tmp_path / "absent.json")
    assert result == {}


def test_load_valid_file(tmp_path):
    data = {"courses": {"0001-0001": {"user_notes": "tough", "manual_weekly_hours": 5.0}}}
    p = tmp_path / "ov.json"
    p.write_text(json.dumps(data), encoding="utf-8")
    result = load_course_overrides(p)
    assert "0001-0001" in result
    assert result["0001-0001"].user_notes == "tough"
    assert result["0001-0001"].manual_weekly_hours == 5.0


def test_load_returns_course_override_instances(tmp_path):
    data = {"courses": {"X": {}}}
    p = tmp_path / "ov.json"
    p.write_text(json.dumps(data), encoding="utf-8")
    result = load_course_overrides(p)
    assert isinstance(result["X"], CourseOverride)


def test_load_empty_courses_dict(tmp_path):
    data = {"courses": {}}
    p = tmp_path / "ov.json"
    p.write_text(json.dumps(data), encoding="utf-8")
    assert load_course_overrides(p) == {}


def test_load_multiple_courses(tmp_path):
    data = {"courses": {"A": {"user_notes": "n1"}, "B": {"user_notes": "n2"}}}
    p = tmp_path / "ov.json"
    p.write_text(json.dumps(data), encoding="utf-8")
    result = load_course_overrides(p)
    assert len(result) == 2
    assert result["A"].user_notes == "n1"
    assert result["B"].user_notes == "n2"


# ---------------------------------------------------------------------------
# save_course_overrides
# ---------------------------------------------------------------------------

def test_save_creates_file(tmp_path):
    overrides = {"0001-0001": _override(user_notes="test")}
    out = tmp_path / "out.json"
    save_course_overrides(overrides, out)
    assert out.exists()


def test_save_roundtrip(tmp_path):
    original = {"0001-0001": _override(user_notes="test", manual_weekly_hours=3.5)}
    out = tmp_path / "out.json"
    save_course_overrides(original, out)
    loaded = load_course_overrides(out)
    assert loaded["0001-0001"].user_notes == "test"
    assert loaded["0001-0001"].manual_weekly_hours == 3.5


def test_save_creates_parent_dirs(tmp_path):
    out = tmp_path / "nested" / "deep" / "out.json"
    save_course_overrides({}, out)
    assert out.exists()


def test_save_empty_overrides(tmp_path):
    out = tmp_path / "empty.json"
    save_course_overrides({}, out)
    data = json.loads(out.read_text(encoding="utf-8"))
    assert data == {"courses": {}}


# ---------------------------------------------------------------------------
# Difficulty estimator — no override (baseline)
# ---------------------------------------------------------------------------

def test_no_override_no_hours_workload_none(tmp_db):
    save_merged_course(_course("X"), tmp_db)
    result = estimate_course_difficulty("X", tmp_db)
    assert result["workload_score"] is None


def test_no_override_no_description_conceptual_none(tmp_db):
    save_merged_course(_course("X"), tmp_db)
    result = estimate_course_difficulty("X", tmp_db)
    assert result["conceptual_complexity_score"] is None


def test_no_override_no_warning_about_manual(tmp_db):
    save_merged_course(_course("X", lecture_hours=3.0), tmp_db)
    result = estimate_course_difficulty("X", tmp_db)
    assert not any("ידנית" in w for w in result["warnings"])


# ---------------------------------------------------------------------------
# Difficulty estimator — manual_weekly_hours override
# ---------------------------------------------------------------------------

def test_manual_hours_fills_missing_workload(tmp_db):
    save_merged_course(_course("X"), tmp_db)
    ov = _override(manual_weekly_hours=4.0)
    result = estimate_course_difficulty("X", tmp_db, override=ov)
    assert result["workload_score"] is not None


def test_manual_hours_not_used_when_official_exists(tmp_db):
    save_merged_course(_course("X", lecture_hours=2.0), tmp_db)
    ov = _override(manual_weekly_hours=9.0)
    result = estimate_course_difficulty("X", tmp_db, override=ov)
    expected = round(min(1.0 + 2.0 * (4.0 / 9.0), 5.0), 2)
    assert result["workload_score"] == pytest.approx(expected)


def test_manual_hours_score_value(tmp_db):
    save_merged_course(_course("X"), tmp_db)
    ov = _override(manual_weekly_hours=4.5)
    result = estimate_course_difficulty("X", tmp_db, override=ov)
    expected = round(min(1.0 + 4.5 * (4.0 / 9.0), 5.0), 2)
    assert result["workload_score"] == pytest.approx(expected)


def test_manual_hours_adds_override_warning(tmp_db):
    save_merged_course(_course("X"), tmp_db)
    ov = _override(manual_weekly_hours=4.0)
    result = estimate_course_difficulty("X", tmp_db, override=ov)
    assert any("ידנית" in w for w in result["warnings"])


def test_manual_hours_override_used_in_factors(tmp_db):
    save_merged_course(_course("X"), tmp_db)
    ov = _override(manual_weekly_hours=4.0)
    result = estimate_course_difficulty("X", tmp_db, override=ov)
    assert result["factors"]["override_used"] is True


# ---------------------------------------------------------------------------
# Difficulty estimator — notes override (conceptual complexity)
# ---------------------------------------------------------------------------

def test_user_notes_enable_conceptual_score(tmp_db):
    save_merged_course(_course("X"), tmp_db)  # no official description
    ov = _override(user_notes="advanced dynamics simulation")
    result = estimate_course_difficulty("X", tmp_db, override=ov)
    assert result["conceptual_complexity_score"] is not None


def test_user_notes_add_keywords(tmp_db):
    save_merged_course(_course("X"), tmp_db)
    ov = _override(user_notes="dynamics simulation advanced")
    result = estimate_course_difficulty("X", tmp_db, override=ov)
    assert len(result["factors"]["matched_keywords"]) > 0


def test_complexity_note_adds_keywords(tmp_db):
    save_merged_course(_course("X"), tmp_db)
    ov = _override(manual_conceptual_complexity_note="differential equations proof")
    result = estimate_course_difficulty("X", tmp_db, override=ov)
    assert result["conceptual_complexity_score"] is not None
    assert len(result["factors"]["matched_keywords"]) > 0


def test_notes_override_warning_added(tmp_db):
    save_merged_course(_course("X"), tmp_db)
    ov = _override(user_notes="advanced topics")
    result = estimate_course_difficulty("X", tmp_db, override=ov)
    assert any("ידנית" in w for w in result["warnings"])


def test_notes_do_not_duplicate_official_keywords(tmp_db):
    save_merged_course(_course("X", course_description="dynamics simulation"), tmp_db)
    ov = _override(user_notes="dynamics simulation")
    result_with = estimate_course_difficulty("X", tmp_db, override=ov)
    result_without = estimate_course_difficulty("X", tmp_db)
    # Should have same keyword count (no duplicates in a set)
    assert (result_with["factors"]["matched_keywords"]
            == result_without["factors"]["matched_keywords"])


# ---------------------------------------------------------------------------
# Difficulty estimator — confidence handling
# ---------------------------------------------------------------------------

def test_override_lowers_confidence(tmp_db):
    save_merged_course(_course("X"), tmp_db)
    result_base = estimate_course_difficulty("X", tmp_db)
    ov = _override(manual_weekly_hours=3.0)
    result_with  = estimate_course_difficulty("X", tmp_db, override=ov)
    # Base confidence doesn't include workload (no hours); override penalises
    assert result_with["confidence"] <= result_base["confidence"]


def test_confidence_adjustment_positive_offsets_penalty(tmp_db):
    save_merged_course(_course("X"), tmp_db)
    ov_no_adj    = _override(manual_weekly_hours=3.0, confidence_adjustment=0.0)
    ov_with_adj  = _override(manual_weekly_hours=3.0, confidence_adjustment=0.5)
    r_no  = estimate_course_difficulty("X", tmp_db, override=ov_no_adj)
    r_adj = estimate_course_difficulty("X", tmp_db, override=ov_with_adj)
    assert r_adj["confidence"] > r_no["confidence"]


def test_confidence_bounded_between_0_and_1(tmp_db):
    save_merged_course(_course("X"), tmp_db)
    ov = _override(manual_weekly_hours=3.0, confidence_adjustment=-1.0)
    result = estimate_course_difficulty("X", tmp_db, override=ov)
    assert 0.0 <= result["confidence"] <= 1.0


def test_no_override_no_penalty(tmp_db):
    save_merged_course(_course("X", lecture_hours=3.0,
                                course_description="dynamics",
                                exam_info="final"), tmp_db)
    result_base = estimate_course_difficulty("X", tmp_db)
    result_none = estimate_course_difficulty("X", tmp_db, override=None)
    assert result_base["confidence"] == result_none["confidence"]


# ---------------------------------------------------------------------------
# Difficulty estimator — empty / no-op override
# ---------------------------------------------------------------------------

def test_empty_override_no_effect(tmp_db):
    save_merged_course(_course("X", lecture_hours=3.0), tmp_db)
    ov = CourseOverride()  # all defaults, no data
    result_base  = estimate_course_difficulty("X", tmp_db)
    result_empty = estimate_course_difficulty("X", tmp_db, override=ov)
    assert result_base["workload_score"] == result_empty["workload_score"]
    assert result_base["confidence"]     == result_empty["confidence"]
    assert not any("ידנית" in w for w in result_empty["warnings"])

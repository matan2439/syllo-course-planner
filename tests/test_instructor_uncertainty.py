"""
Tests for instructor uncertainty modeling.

Covers: extraction helpers, scoring rules, warnings, edge cases, and
integration with elective_audit and semester_board.
"""

import pytest
from pathlib import Path

from app.analysis.instructor_uncertainty import (
    estimate_instructor_uncertainty,
    _extract_current_lecturers,
    _extract_historical_lecturers,
    _normalize_name,
)
from app.models.grade_stats import CourseGradeStats
from app.database.db import init_db, save_merged_course, save_grade_stats
from app.analysis.elective_audit import audit_courses
from app.analysis.semester_board import build_semester_board


# ---------------------------------------------------------------------------
# Fixtures / helpers
# ---------------------------------------------------------------------------

def _record(course_id: str = "0001-0001", groups=None, **kwargs) -> dict:
    base = {
        "course_id": course_id, "name_he": "קורס", "name_en": None,
        "faculty": None, "department": None, "year": 2025, "semester": None,
        "credits": None, "lecture_hours": 3.0, "tutorial_hours": None,
        "lab_hours": None, "prerequisites_raw_text": None,
        "prerequisite_course_ids": [], "course_description": None,
        "topics": [], "assignments": None, "exam_info": None,
        "syllabus_links": [], "groups": groups or [], "source_files": {},
    }
    base.update(kwargs)
    return base


def _stat(course_id="0001-0001", lecturer_name=None, year=2024, **kwargs) -> CourseGradeStats:
    return CourseGradeStats(
        course_id=course_id, year=year, average_grade=74.0, num_students=80,
        lecturer_name=lecturer_name, **kwargs
    )


@pytest.fixture
def tmp_db(tmp_path):
    db = tmp_path / "iu_test.sqlite"
    init_db(db)
    return db


# ---------------------------------------------------------------------------
# _extract_current_lecturers
# ---------------------------------------------------------------------------

def test_extract_none_record():
    assert _extract_current_lecturers(None) == []


def test_extract_no_groups():
    assert _extract_current_lecturers(_record()) == []


def test_extract_teacher_key():
    r = _record(groups=[{"teacher": "ד\"ר לוי"}])
    assert "ד\"ר לוי" in _extract_current_lecturers(r)


def test_extract_lecturer_key():
    r = _record(groups=[{"lecturer": "פרופ. כהן"}])
    assert "פרופ. כהן" in _extract_current_lecturers(r)


def test_extract_list_value():
    r = _record(groups=[{"teacher": ["ד\"ר א", "ד\"ר ב"]}])
    names = _extract_current_lecturers(r)
    assert "ד\"ר א" in names
    assert "ד\"ר ב" in names


def test_extract_deduplicates():
    r = _record(groups=[{"teacher": "פרופ. כהן"}, {"lecturer": "פרופ. כהן"}])
    assert _extract_current_lecturers(r).count("פרופ. כהן") == 1


def test_extract_multiple_groups():
    r = _record(groups=[{"teacher": "א"}, {"teacher": "ב"}])
    names = _extract_current_lecturers(r)
    assert "א" in names and "ב" in names


def test_extract_ignores_non_dict_groups():
    r = _record(groups=["bad", {"teacher": "כהן"}])
    assert "כהן" in _extract_current_lecturers(r)


# ---------------------------------------------------------------------------
# _extract_historical_lecturers
# ---------------------------------------------------------------------------

def test_hist_empty_stats():
    assert _extract_historical_lecturers([]) == []


def test_hist_none_lecturer():
    assert _extract_historical_lecturers([_stat(lecturer_name=None)]) == []


def test_hist_single():
    result = _extract_historical_lecturers([_stat(lecturer_name="פרופ. כהן")])
    assert result == ["פרופ. כהן"]


def test_hist_deduplicates():
    stats = [_stat(lecturer_name="כהן", year=2022), _stat(lecturer_name="כהן", year=2023)]
    assert len(_extract_historical_lecturers(stats)) == 1


def test_hist_comma_joined():
    stats = [_stat(lecturer_name="כהן, לוי")]
    result = _extract_historical_lecturers(stats)
    assert "כהן" in result
    assert "לוי" in result


def test_hist_multiple_records():
    stats = [_stat(lecturer_name="א"), _stat(lecturer_name="ב")]
    result = _extract_historical_lecturers(stats)
    assert set(result) == {"א", "ב"}


# ---------------------------------------------------------------------------
# _normalize_name
# ---------------------------------------------------------------------------

def test_normalize_strips_prof():
    assert _normalize_name("פרופ. כהן") == "כהן"


def test_normalize_strips_dr():
    assert _normalize_name('ד"ר לוי') == "לוי"


def test_normalize_case_insensitive():
    assert _normalize_name("PROF. Smith") == "smith"


def test_normalize_no_title():
    assert _normalize_name("כהן") == "כהן"


# ---------------------------------------------------------------------------
# estimate_instructor_uncertainty — basic cases
# ---------------------------------------------------------------------------

def test_no_data_at_all():
    # No record, no grade stats → unknown lecturer warning
    result = estimate_instructor_uncertainty(None, [])
    assert "מרצה הסמסטר לא ידוע" in result["warnings"]
    assert result["instructor_uncertainty_score"] == pytest.approx(0.40)
    assert result["current_lecturers"] == []
    assert result["historical_lecturers"] == []


def test_returns_required_keys():
    result = estimate_instructor_uncertainty(None, [])
    required = {"current_lecturers", "historical_lecturers", "instructor_uncertainty_score",
                "instructor_notes", "instructor_changed_warning", "warnings"}
    assert required.issubset(result.keys())


def test_instructor_notes_is_none():
    # The backend never fills instructor_notes — that's done by the frontend
    result = estimate_instructor_uncertainty(_record(), [])
    assert result["instructor_notes"] is None


def test_no_current_lecturer_warning():
    result = estimate_instructor_uncertainty(_record(groups=[]), [])
    assert "מרצה הסמסטר לא ידוע" in result["warnings"]


def test_known_current_no_history_no_warning():
    r = _record(groups=[{"teacher": "כהן"}])
    result = estimate_instructor_uncertainty(r, [])
    assert result["current_lecturers"] == ["כהן"]
    assert "מרצה הסמסטר לא ידוע" not in result["warnings"]
    assert result["instructor_uncertainty_score"] == pytest.approx(0.0)


# ---------------------------------------------------------------------------
# Rule 2 — multiple historical lecturers
# ---------------------------------------------------------------------------

def test_single_historical_no_variance_penalty():
    stats = [_stat(lecturer_name="כהן", year=2022), _stat(lecturer_name="כהן", year=2023)]
    r = _record(groups=[{"teacher": "כהן"}])
    result = estimate_instructor_uncertainty(r, stats)
    assert result["instructor_uncertainty_score"] < 0.20


def test_multiple_historical_adds_score():
    stats = [_stat(lecturer_name="כהן"), _stat(lecturer_name="לוי")]
    r = _record(groups=[{"teacher": "כהן"}])
    result = estimate_instructor_uncertainty(r, stats)
    assert result["instructor_uncertainty_score"] >= 0.20


# ---------------------------------------------------------------------------
# Rule 3 — current not in historical
# ---------------------------------------------------------------------------

def test_current_in_historical_no_change_warning():
    stats = [_stat(lecturer_name="פרופ. כהן")]
    r = _record(groups=[{"teacher": "כהן"}])  # matches after title stripping
    result = estimate_instructor_uncertainty(r, stats)
    assert not result["instructor_changed_warning"]
    assert "נתוני הציונים" not in " ".join(result["warnings"])


def test_current_not_in_historical_change_warning():
    stats = [_stat(lecturer_name="לוי")]
    r = _record(groups=[{"teacher": "כהן"}])
    result = estimate_instructor_uncertainty(r, stats)
    assert result["instructor_changed_warning"]
    assert any("נתוני הציונים" in w for w in result["warnings"])


def test_change_warning_adds_score():
    stats = [_stat(lecturer_name="לוי")]
    r_different = _record(groups=[{"teacher": "כהן"}])
    r_same      = _record(groups=[{"teacher": "לוי"}])
    score_diff = estimate_instructor_uncertainty(r_different, stats)["instructor_uncertainty_score"]
    score_same = estimate_instructor_uncertainty(r_same, stats)["instructor_uncertainty_score"]
    assert score_diff > score_same


def test_empty_history_no_change_warning():
    r = _record(groups=[{"teacher": "כהן"}])
    result = estimate_instructor_uncertainty(r, [])
    assert not result["instructor_changed_warning"]


# ---------------------------------------------------------------------------
# Supplementary uncertainty — grade data quality
# ---------------------------------------------------------------------------

def test_grade_stats_with_no_lecturer_adds_score():
    stats = [_stat(lecturer_name=None)]
    r = _record(groups=[{"teacher": "כהן"}])
    result = estimate_instructor_uncertainty(r, stats)
    assert result["instructor_uncertainty_score"] >= 0.10


def test_single_year_adds_score():
    stats = [_stat(year=2024, lecturer_name="כהן")]
    r = _record(groups=[{"teacher": "כהן"}])
    result_single = estimate_instructor_uncertainty(r, stats)

    stats_multi = [_stat(year=2023, lecturer_name="כהן"), _stat(year=2024, lecturer_name="כהן")]
    result_multi = estimate_instructor_uncertainty(r, stats_multi)

    assert result_single["instructor_uncertainty_score"] > result_multi["instructor_uncertainty_score"]


def test_no_grade_stats_does_not_add_supplementary():
    # Empty grade_stats → supplementary penalties don't fire
    r = _record(groups=[{"teacher": "כהן"}])
    result = estimate_instructor_uncertainty(r, [])
    assert result["instructor_uncertainty_score"] == pytest.approx(0.0)


# ---------------------------------------------------------------------------
# Score cap
# ---------------------------------------------------------------------------

def test_score_capped_at_1():
    # Worst case: no current, multiple historical, no lecturer attribution
    stats = [_stat(lecturer_name="א"), _stat(lecturer_name="ב"),
             _stat(lecturer_name=None), _stat(year=2024, lecturer_name="ג")]
    result = estimate_instructor_uncertainty(None, stats)
    assert result["instructor_uncertainty_score"] <= 1.0


# ---------------------------------------------------------------------------
# Integration — elective_audit
# ---------------------------------------------------------------------------

def test_audit_includes_instructor_uncertainty(tmp_db):
    save_merged_course(_record("0001-0001"), tmp_db)
    results = audit_courses(["0001-0001"], [], db_path=tmp_db)
    assert len(results) == 1
    assert "instructor_uncertainty" in results[0]
    iu = results[0]["instructor_uncertainty"]
    assert "instructor_uncertainty_score" in iu
    assert "warnings" in iu


def test_audit_missing_from_db_has_instructor_uncertainty(tmp_db):
    results = audit_courses(["9999-9999"], [], db_path=tmp_db)
    assert "instructor_uncertainty" in results[0]


def test_audit_unknown_lecturer_warning_in_result(tmp_db):
    save_merged_course(_record("0001-0001"), tmp_db)
    results = audit_courses(["0001-0001"], [], db_path=tmp_db)
    iu = results[0]["instructor_uncertainty"]
    assert "מרצה הסמסטר לא ידוע" in iu["warnings"]


def test_audit_grade_stats_used_for_historical(tmp_db):
    save_merged_course(_record("0001-0001"), tmp_db)
    save_grade_stats([_stat("0001-0001", lecturer_name="כהן")], tmp_db)
    results = audit_courses(["0001-0001"], [], db_path=tmp_db)
    iu = results[0]["instructor_uncertainty"]
    assert "כהן" in iu["historical_lecturers"]


# ---------------------------------------------------------------------------
# Integration — semester_board
# ---------------------------------------------------------------------------

def _plan(course_ids: list[str], **kwargs) -> dict:
    return {
        "selected_courses": [
            {
                "course_id": cid, "name_he": cid,
                "weekly_hours": 3.0, "difficulty_score": 2.0,
                "difficulty_level": "medium",
                **kwargs,
            }
            for cid in course_ids
        ]
    }


def test_board_elective_has_instructor_uncertainty(tmp_db):
    save_merged_course(_record("0001-0001"), tmp_db)
    board = build_semester_board(_plan(["0001-0001"]), db_path=tmp_db)
    courses = [c for sem in board["semesters"] for c in sem["courses"]]
    assert any(c["course_id"] == "0001-0001" for c in courses)
    course = next(c for c in courses if c["course_id"] == "0001-0001")
    assert "instructor_uncertainty" in course

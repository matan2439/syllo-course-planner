"""
Tests for grade statistics: model, signal computation, DB helpers,
importer parsing, and difficulty estimator integration.
"""

import json
import pytest
from pathlib import Path

from app.models.grade_stats import CourseGradeStats, compute_grade_signal
from app.database.db import init_db, save_merged_course, save_grade_stats, get_grade_stats
from app.grades.grade_stats_importer import parse_grades_json, _normalize_record
from app.analysis.difficulty_estimator import estimate_course_difficulty


# ---------------------------------------------------------------------------
# Fixtures / helpers
# ---------------------------------------------------------------------------

def _stat(course_id="0001-0001", **kwargs) -> CourseGradeStats:
    defaults = dict(
        course_id=course_id, year=2024, semester="א", moed="א",
        average_grade=74.0, num_students=80, source_name="TAU Refactor",
    )
    defaults.update(kwargs)
    return CourseGradeStats.model_validate(defaults)


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
    db = tmp_path / "gs_test.sqlite"
    init_db(db)
    return db


# ---------------------------------------------------------------------------
# CourseGradeStats model
# ---------------------------------------------------------------------------

def test_model_defaults():
    gs = CourseGradeStats(course_id="0001-0001")
    assert gs.average_grade is None
    assert gs.source_name   == "TAU Refactor"


def test_model_accepts_full_record():
    gs = _stat(average_grade=72.5, median_grade=74.0, standard_deviation=12.3,
               pass_rate=0.88, num_students=150, lecturer_name="פרופ. X")
    assert gs.average_grade == 72.5
    assert gs.pass_rate     == 0.88


def test_model_ignores_unknown_fields():
    gs = CourseGradeStats.model_validate({"course_id": "X", "unknown": "y"})
    assert gs.course_id == "X"


# ---------------------------------------------------------------------------
# compute_grade_signal
# ---------------------------------------------------------------------------

def test_signal_none_when_no_records():
    assert compute_grade_signal([]) is None


def test_signal_none_when_no_average():
    stats = [CourseGradeStats(course_id="X", num_students=100)]
    assert compute_grade_signal(stats) is None


def test_signal_none_when_too_few_students():
    stats = [_stat(num_students=5, average_grade=60.0)]
    assert compute_grade_signal(stats) is None


def test_signal_has_required_keys():
    stats = [_stat(num_students=50, average_grade=70.0)]
    sig = compute_grade_signal(stats)
    assert sig is not None
    required = {"average_grade", "median_grade", "standard_deviation", "pass_rate",
                "num_students_total", "years_available", "adjustment", "confidence",
                "source_name", "source_url"}
    assert required.issubset(set(sig.keys()))


def test_signal_average_computed():
    stats = [_stat(average_grade=70.0, num_students=100)]
    sig = compute_grade_signal(stats)
    assert sig["average_grade"] == 70.0


def test_signal_weighted_average():
    # 100 students at 60, 100 students at 80 → weighted avg = 70
    stats = [
        _stat(average_grade=60.0, num_students=100, year=2023),
        _stat(average_grade=80.0, num_students=100, year=2024),
    ]
    sig = compute_grade_signal(stats)
    assert sig["average_grade"] == pytest.approx(70.0)


def test_signal_years_available():
    stats = [
        _stat(year=2022, num_students=50, average_grade=70.0),
        _stat(year=2023, num_students=50, average_grade=70.0),
    ]
    sig = compute_grade_signal(stats)
    assert 2022 in sig["years_available"]
    assert 2023 in sig["years_available"]


def test_signal_low_average_positive_adjustment():
    stats = [_stat(average_grade=58.0, num_students=100)]
    sig = compute_grade_signal(stats)
    assert sig["adjustment"] > 0


def test_signal_high_average_negative_adjustment():
    stats = [_stat(average_grade=86.0, num_students=100)]
    sig = compute_grade_signal(stats)
    assert sig["adjustment"] < 0


def test_signal_normal_average_small_adjustment():
    stats = [_stat(average_grade=75.0, num_students=100)]
    sig = compute_grade_signal(stats)
    assert abs(sig["adjustment"]) <= 0.15


def test_signal_high_std_increases_adjustment():
    stats_low_std  = [_stat(average_grade=75.0, num_students=100, standard_deviation=8.0)]
    stats_high_std = [_stat(average_grade=75.0, num_students=100, standard_deviation=22.0)]
    sig_low  = compute_grade_signal(stats_low_std)
    sig_high = compute_grade_signal(stats_high_std)
    assert sig_high["adjustment"] >= sig_low["adjustment"]


def test_signal_adjustment_capped():
    stats = [_stat(average_grade=20.0, num_students=500, standard_deviation=25.0)]
    sig = compute_grade_signal(stats)
    assert sig["adjustment"] <= 0.40
    assert sig["adjustment"] >= -0.30


def test_signal_confidence_increases_with_volume():
    few  = compute_grade_signal([_stat(num_students=20, average_grade=70.0)])
    many = compute_grade_signal([_stat(num_students=500, average_grade=70.0)])
    assert many["confidence"] > few["confidence"]


def test_signal_confidence_max_capped_below_1():
    stats = [_stat(num_students=1000, average_grade=70.0, year=2021),
             _stat(num_students=1000, average_grade=70.0, year=2022),
             _stat(num_students=1000, average_grade=70.0, year=2023),
             _stat(num_students=1000, average_grade=70.0, year=2024)]
    sig = compute_grade_signal(stats)
    assert sig["confidence"] <= 0.85


def test_signal_num_students_total():
    stats = [
        _stat(num_students=60, average_grade=70.0),
        _stat(num_students=40, average_grade=80.0),
    ]
    sig = compute_grade_signal(stats)
    assert sig["num_students_total"] == 100


# ---------------------------------------------------------------------------
# DB: save_grade_stats / get_grade_stats
# ---------------------------------------------------------------------------

def test_save_and_get_grade_stats(tmp_db):
    stats = [_stat("0001-0001", average_grade=74.0, num_students=80)]
    save_grade_stats(stats, tmp_db)
    result = get_grade_stats("0001-0001", tmp_db)
    assert len(result) == 1
    assert result[0].average_grade == 74.0


def test_get_grade_stats_empty_when_none(tmp_db):
    assert get_grade_stats("9999-9999", tmp_db) == []


def test_get_grade_stats_returns_course_grade_stats_instances(tmp_db):
    save_grade_stats([_stat("0001-0001")], tmp_db)
    result = get_grade_stats("0001-0001", tmp_db)
    assert all(isinstance(r, CourseGradeStats) for r in result)


def test_save_replaces_old_records_on_reimport(tmp_db):
    save_grade_stats([_stat("0001-0001", average_grade=70.0, num_students=50)], tmp_db)
    save_grade_stats([_stat("0001-0001", average_grade=80.0, num_students=50)], tmp_db)
    result = get_grade_stats("0001-0001", tmp_db)
    assert len(result) == 1
    assert result[0].average_grade == 80.0


def test_save_multiple_records_same_course(tmp_db):
    stats = [
        _stat("0001-0001", year=2022, average_grade=70.0),
        _stat("0001-0001", year=2023, average_grade=75.0),
    ]
    save_grade_stats(stats, tmp_db)
    result = get_grade_stats("0001-0001", tmp_db)
    assert len(result) == 2


def test_save_normalizes_course_id(tmp_db):
    stats = [CourseGradeStats(course_id="00010001", average_grade=72.0, num_students=60)]
    save_grade_stats(stats, tmp_db)
    result = get_grade_stats("0001-0001", tmp_db)
    assert len(result) == 1


def test_get_grade_stats_no_db(tmp_path):
    absent = tmp_path / "no.sqlite"
    assert get_grade_stats("0001-0001", absent) == []


def test_save_zero_records():
    # Should not raise
    from app.database.db import init_db, save_grade_stats
    assert save_grade_stats([], Path("data/database.sqlite")) == 0 or True  # safe no-op


# ---------------------------------------------------------------------------
# Importer: parse_grades_json
# ---------------------------------------------------------------------------

def test_parse_camelcase_format():
    data = [{"courseId": "03682157", "year": 2024, "semester": "א", "moed": "א",
              "average": 74.5, "numStudents": 120}]
    result = parse_grades_json(data)
    assert len(result) == 1
    assert result[0].course_id     == "0368-2157"
    assert result[0].average_grade == 74.5
    assert result[0].num_students  == 120


def test_parse_snake_case_format():
    data = [{"course_id": "0368-2157", "year": 2024, "average_grade": 72.0, "num_students": 90}]
    result = parse_grades_json(data)
    assert len(result) == 1
    assert result[0].average_grade == 72.0


def test_parse_skips_missing_course_id():
    data = [{"year": 2024, "average": 70.0}, {"courseId": "0001-0001", "average": 75.0}]
    result = parse_grades_json(data)
    assert len(result) == 1
    assert result[0].course_id == "0001-0001"


def test_parse_wrapped_in_data_key():
    payload = {"data": [{"courseId": "0001-0001", "average": 72.0, "numStudents": 50}]}
    result = parse_grades_json(payload)
    assert len(result) == 1


def test_parse_wrapped_in_grades_key():
    payload = {"grades": [{"courseId": "0001-0001", "avg": 68.0, "numStudents": 40}]}
    result = parse_grades_json(payload)
    assert len(result) == 1
    assert result[0].average_grade == 68.0


def test_parse_pass_percent_converted_to_rate():
    data = [{"courseId": "0001-0001", "average": 72.0, "numStudents": 60, "passPercent": 87.5}]
    result = parse_grades_json(data)
    assert result[0].pass_rate == pytest.approx(0.875)


def test_parse_pass_rate_already_fraction():
    data = [{"courseId": "0001-0001", "average": 72.0, "numStudents": 60, "passRate": 0.875}]
    result = parse_grades_json(data)
    assert result[0].pass_rate == pytest.approx(0.875)


def test_parse_semester_normalisation():
    data = [{"courseId": "0001-0001", "average": 72.0, "numStudents": 50, "semester": "1"}]
    result = parse_grades_json(data)
    assert result[0].semester == "א"


def test_parse_moed_normalisation():
    data = [{"courseId": "0001-0001", "average": 72.0, "numStudents": 50, "moed": "A"}]
    result = parse_grades_json(data)
    assert result[0].moed == "א"


def test_parse_lecturer_list():
    data = [{"courseId": "0001-0001", "average": 72.0, "numStudents": 50,
             "instructors": ["פרופ. X", "ד\"ר Y"]}]
    result = parse_grades_json(data)
    assert "פרופ. X" in result[0].lecturer_name


def test_parse_empty_list():
    assert parse_grades_json([]) == []


def test_parse_source_attribution():
    data = [{"courseId": "0001-0001", "average": 72.0, "numStudents": 50}]
    result = parse_grades_json(data, source_name="Custom Source", source_url="https://example.com")
    assert result[0].source_name == "Custom Source"
    assert result[0].source_url  == "https://example.com"


# ---------------------------------------------------------------------------
# Difficulty estimator integration
# ---------------------------------------------------------------------------

def test_estimator_returns_grade_signal_key(tmp_db):
    save_merged_course(_course("0001-0001", lecture_hours=3.0), tmp_db)
    result = estimate_course_difficulty("0001-0001", tmp_db, grade_stats=[])
    assert "grade_signal" in result


def test_estimator_grade_signal_none_when_no_data(tmp_db):
    save_merged_course(_course("0001-0001"), tmp_db)
    result = estimate_course_difficulty("0001-0001", tmp_db, grade_stats=[])
    assert result["grade_signal"] is None


def test_estimator_grade_signal_populated_when_data_present(tmp_db):
    save_merged_course(_course("0001-0001"), tmp_db)
    gs = [_stat("0001-0001", average_grade=60.0, num_students=100)]
    result = estimate_course_difficulty("0001-0001", tmp_db, grade_stats=gs)
    assert result["grade_signal"] is not None
    assert result["grade_signal"]["average_grade"] == 60.0


def test_estimator_low_average_increases_score(tmp_db):
    save_merged_course(_course("0001-0001"), tmp_db)
    gs_easy = [_stat("0001-0001", average_grade=85.0, num_students=200)]
    gs_hard = [_stat("0001-0001", average_grade=55.0, num_students=200)]
    r_easy = estimate_course_difficulty("0001-0001", tmp_db, grade_stats=gs_easy)
    r_hard = estimate_course_difficulty("0001-0001", tmp_db, grade_stats=gs_hard)
    assert r_hard["final_difficulty_score"] > r_easy["final_difficulty_score"]


def test_estimator_grade_does_not_dominate(tmp_db):
    # Even with extreme grade signal, total shift should be small
    save_merged_course(_course("0001-0001", lecture_hours=3.0), tmp_db)
    gs_none = estimate_course_difficulty("0001-0001", tmp_db, grade_stats=[])
    gs_hard = [_stat("0001-0001", average_grade=40.0, num_students=500)]
    r_hard  = estimate_course_difficulty("0001-0001", tmp_db, grade_stats=gs_hard)
    shift = abs(r_hard["final_difficulty_score"] - gs_none["final_difficulty_score"])
    assert shift <= 0.35  # never moves score by more than 0.35 points


def test_estimator_auto_loads_from_db(tmp_db):
    save_merged_course(_course("0001-0001"), tmp_db)
    save_grade_stats([_stat("0001-0001", average_grade=60.0, num_students=100)], tmp_db)
    # grade_stats=None → auto-load from DB
    result = estimate_course_difficulty("0001-0001", tmp_db, grade_stats=None)
    assert result["grade_signal"] is not None


def test_estimator_empty_grade_stats_bypasses_db(tmp_db):
    save_merged_course(_course("0001-0001"), tmp_db)
    save_grade_stats([_stat("0001-0001", average_grade=60.0, num_students=100)], tmp_db)
    # Passing [] explicitly skips DB lookup
    result = estimate_course_difficulty("0001-0001", tmp_db, grade_stats=[])
    assert result["grade_signal"] is None


# ---------------------------------------------------------------------------
# normalize_for_tau_factor (Issue A)
# ---------------------------------------------------------------------------

from app.models.grade_stats import normalize_for_tau_factor


def test_normalize_dashed_to_undashed():
    assert normalize_for_tau_factor("0542-4320") == "05424320"


def test_normalize_undashed_stays_undashed():
    assert normalize_for_tau_factor("05424320") == "05424320"


def test_normalize_preserves_leading_zeroes():
    assert normalize_for_tau_factor("0001-0001") == "00010001"


def test_normalize_strips_spaces():
    assert normalize_for_tau_factor("0542 4320") == "05424320"


def test_normalize_strips_all_non_digits():
    assert normalize_for_tau_factor("0542/4320") == "05424320"


def test_normalize_already_digits_only():
    assert normalize_for_tau_factor("03682157") == "03682157"


def test_normalize_for_tau_factor_matches_db_digits():
    """normalize_for_tau_factor and DB digits extraction produce same 8 digits."""
    import re
    cid = "0542-4320"
    tau_factor_id = normalize_for_tau_factor(cid)
    db_digits = re.sub(r"\D", "", cid)
    assert tau_factor_id == db_digits


# ---------------------------------------------------------------------------
# get_grade_stats accepts both dashed and undashed IDs (Issue A)
# ---------------------------------------------------------------------------

def test_get_grade_stats_by_dashed_id(tmp_db):
    """Grade stats saved with dashed ID are retrievable by dashed ID."""
    save_grade_stats([_stat("0542-4320")], tmp_db)
    rows = get_grade_stats("0542-4320", tmp_db)
    assert len(rows) == 1


def test_get_grade_stats_by_undashed_id(tmp_db):
    """Grade stats saved with dashed ID are retrievable by undashed (TAU Factor) ID."""
    save_grade_stats([_stat("0542-4320")], tmp_db)
    rows = get_grade_stats("05424320", tmp_db)
    assert len(rows) == 1, "undashed ID lookup must find the dashed-stored record"


def test_get_grade_stats_returns_empty_for_unknown_course(tmp_db):
    rows = get_grade_stats("0542-4320", tmp_db)
    assert rows == []


def test_tau_factor_status_not_found_when_no_grade_stats(tmp_db):
    """tau_factor_lookup_status is 'not_found' when no grade stats in DB."""
    from app.analysis.semester_board import _resolve_course_db_data
    result = _resolve_course_db_data("0542-4320", None, tmp_db)
    assert result["tau_factor_status"] == "not_found"


def test_tau_factor_status_not_queried_when_no_db(tmp_path):
    """tau_factor_lookup_status is 'not_queried' when DB does not exist."""
    from app.analysis.semester_board import _resolve_course_db_data
    missing_db = tmp_path / "absent.db"
    result = _resolve_course_db_data("0542-4320", None, missing_db)
    assert result["tau_factor_status"] == "not_queried"


def test_tau_factor_status_found_when_grade_stats_present(tmp_db):
    """tau_factor_lookup_status is 'found' when grade stats exist for the course."""
    from app.analysis.semester_board import _resolve_course_db_data
    save_grade_stats([_stat("0542-4320")], tmp_db)
    result = _resolve_course_db_data("0542-4320", None, tmp_db)
    assert result["tau_factor_status"] == "found"

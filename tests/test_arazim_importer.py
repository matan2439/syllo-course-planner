"""
Tests for app.grades.arazim_importer.
All tests use a minimal fixture — no live network calls.
"""

from __future__ import annotations

import json
from pathlib import Path

import pytest

from app.grades.arazim_importer import (
    extract_course_records,
    compute_overall_average,
    import_arazim_courses,
    _semester_code,
    _semester_year,
    _moed_code,
    _student_count,
)
from app.models.grade_stats import normalize_for_grade_source
from app.database.db import init_db, get_grade_stats

# ---------------------------------------------------------------------------
# Minimal grades.json fixture
# ---------------------------------------------------------------------------

_FIXTURE_GRADES: dict = {
    "05424320": {
        "2024b": {
            "00": [
                {"moed": 0, "distribution": [3, 1, 2, 4, 5, 6, 7, 8, 9, 5], "mean": 72.4},
                {"moed": 1, "distribution": [2, 1, 1, 2, 3, 4, 5, 6, 7, 4], "mean": 73.1},
            ],
            "01": [
                {"moed": 0, "distribution": [3, 1, 2, 4, 5, 6, 7, 8, 9, 5],
                 "mean": 72.4, "median": 74.0, "standard_deviation": 15.2},
                {"moed": 1, "distribution": [2, 1, 1, 2, 3, 4, 5, 6, 7, 4],
                 "mean": 73.1, "median": 75.0, "standard_deviation": 14.8},
            ],
        },
        "2022b": {
            "01": [
                {"moed": 0, "distribution": [5, 2, 3, 6, 7, 8, 9, 10, 8, 4],
                 "mean": 68.5, "median": 71.0, "standard_deviation": 16.0},
            ],
        },
    },
    "05424123": {
        "2023b": {
            "01": [
                {"moed": 0, "distribution": [1, 0, 1, 2, 3, 5, 6, 8, 9, 5],
                 "mean": 79.2, "median": 82.0, "standard_deviation": 14.1},
            ],
        },
    },
}


# ---------------------------------------------------------------------------
# Helper tests
# ---------------------------------------------------------------------------

def test_semester_code_b():
    assert _semester_code("2024b") == "ב"


def test_semester_code_a():
    assert _semester_code("2023a") == "א"


def test_semester_year():
    assert _semester_year("2024b") == 2024
    assert _semester_year("2019a") == 2019


def test_moed_code():
    assert _moed_code(0) == "א"
    assert _moed_code(1) == "ב"


def test_student_count():
    assert _student_count([3, 1, 2, 4, 5, 6, 7, 8, 9, 5]) == 50


# ---------------------------------------------------------------------------
# extract_course_records
# ---------------------------------------------------------------------------

def test_extract_returns_records():
    records = extract_course_records(_FIXTURE_GRADES, "0542-4320")
    assert len(records) > 0


def test_extract_uses_dashed_course_id():
    records = extract_course_records(_FIXTURE_GRADES, "0542-4320")
    for r in records:
        assert r.course_id == "0542-4320"


def test_extract_also_accepts_undashed():
    records = extract_course_records(_FIXTURE_GRADES, "05424320")
    assert len(records) > 0
    for r in records:
        assert r.course_id == "0542-4320"


def test_extract_missing_course_returns_empty():
    records = extract_course_records(_FIXTURE_GRADES, "0542-9999")
    assert records == []


def test_extract_per_semester_records():
    """Should produce one record per (semester, moed), merging groups."""
    records = extract_course_records(_FIXTURE_GRADES, "0542-4320")
    # 2024b has moed 0 and 1; 2022b has moed 0 → 3 records
    assert len(records) == 3


def test_extract_groups_aggregated_by_weighted_mean():
    """Groups 00 and 01 for the same semester+moed are combined."""
    records = extract_course_records(_FIXTURE_GRADES, "0542-4320")
    # For 2024b moed 0: group 00 has 50 students with mean 72.4,
    #                   group 01 has 50 students with mean 72.4
    # Combined: (50*72.4 + 50*72.4) / 100 = 72.4
    moed_a_2024 = next(
        r for r in records if r.year == 2024 and r.semester == "ב" and r.moed == "א"
    )
    assert abs(moed_a_2024.average_grade - 72.4) < 0.01
    assert moed_a_2024.num_students == 100  # 50 + 50 combined


def test_extract_source_name():
    from app.grades.arazim_importer import SOURCE_NAME
    records = extract_course_records(_FIXTURE_GRADES, "0542-4320")
    for r in records:
        assert r.source_name == SOURCE_NAME


def test_extract_has_median_where_available():
    records = extract_course_records(_FIXTURE_GRADES, "0542-4320")
    # group "01" has median; group "00" does not; combined should have weighted median
    moed_a_2024 = next(
        r for r in records if r.year == 2024 and r.semester == "ב" and r.moed == "א"
    )
    assert moed_a_2024.median_grade is not None


# ---------------------------------------------------------------------------
# compute_overall_average
# ---------------------------------------------------------------------------

def test_overall_average_uses_primary_exam():
    records = extract_course_records(_FIXTURE_GRADES, "0542-4320")
    overall = compute_overall_average(records)
    assert overall is not None
    assert "average_grade" in overall
    assert "sample_size" in overall
    assert overall["sample_size"] > 0


def test_overall_average_weighted_by_students():
    """Weighted average: 2024b has 100 students avg=72.4; 2022b has 62 avg=68.5."""
    records = extract_course_records(_FIXTURE_GRADES, "0542-4320")
    overall = compute_overall_average(records)
    n1, a1 = 100, 72.4   # 2024b moed א
    n2, a2 = 62,  68.5   # 2022b moed א
    expected = (n1 * a1 + n2 * a2) / (n1 + n2)
    assert abs(overall["average_grade"] - round(expected, 2)) < 0.5


def test_overall_average_none_for_missing():
    overall = compute_overall_average([])
    assert overall is None


def test_overall_average_years():
    records = extract_course_records(_FIXTURE_GRADES, "0542-4320")
    overall = compute_overall_average(records)
    assert 2024 in overall["years"]
    assert 2022 in overall["years"]


# ---------------------------------------------------------------------------
# DB integration
# ---------------------------------------------------------------------------

def test_import_saves_to_db(tmp_path):
    db = tmp_path / "test.db"
    init_db(db)
    summary = import_arazim_courses(["0542-4320"], db_path=db,
                                    _grades_data_override=_FIXTURE_GRADES)
    assert summary["0542-4320"]["status"] == "matched"
    rows = get_grade_stats("0542-4320", db)
    assert len(rows) > 0
    assert all(r.source_name == "Arazim TAU Refactor" for r in rows)


def test_import_not_found(tmp_path):
    db = tmp_path / "test.db"
    init_db(db)
    summary = import_arazim_courses(["0542-9999"], db_path=db,
                                    _grades_data_override=_FIXTURE_GRADES)
    assert summary["0542-9999"]["status"] == "not_found"
    assert get_grade_stats("0542-9999", db) == []


def test_import_dashed_and_undashed_both_work(tmp_path):
    """Importing with dashed ID works; retrieving with either form works."""
    db = tmp_path / "test.db"
    init_db(db)
    import_arazim_courses(["0542-4320"], db_path=db,
                          _grades_data_override=_FIXTURE_GRADES)
    assert get_grade_stats("0542-4320", db)   # dashed lookup
    assert get_grade_stats("05424320",  db)   # undashed lookup


def test_import_undashed_id_as_input(tmp_path):
    """Passing undashed course ID as input still finds and saves correctly."""
    db = tmp_path / "test.db"
    init_db(db)
    summary = import_arazim_courses(["05424320"], db_path=db,
                                    _grades_data_override=_FIXTURE_GRADES)
    assert summary["05424320"]["status"] == "matched"


def test_import_multiple_courses(tmp_path):
    db = tmp_path / "test.db"
    init_db(db)
    summary = import_arazim_courses(["0542-4320", "0542-4123"], db_path=db,
                                    _grades_data_override=_FIXTURE_GRADES)
    assert summary["0542-4320"]["status"] == "matched"
    assert summary["0542-4123"]["status"] == "matched"


# ---------------------------------------------------------------------------
# normalize_for_grade_source (re-verified for Arazim)
# ---------------------------------------------------------------------------

def test_normalize_for_arazim_lookup():
    """normalize_for_grade_source must produce the key format used by grades.json."""
    assert normalize_for_grade_source("0542-4320") == "05424320"
    assert normalize_for_grade_source("05424320")  == "05424320"

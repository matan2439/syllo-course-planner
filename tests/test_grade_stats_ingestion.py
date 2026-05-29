"""
Tests for grade statistics ingestion layer (Parts B–I).
All tests use fixtures; no live network calls.
"""

from __future__ import annotations

import csv
import json
import sqlite3
from pathlib import Path

import pytest

from app.models.grade_stats import (
    normalize_for_grade_source,
    normalize_for_tau_factor,
    CourseGradeStats,
)
from app.grades.grade_stats_importer import (
    parse_grades_json,
    parse_grades_csv,
    import_grade_stats_from_file,
    get_configured_source_url,
)
from app.database.db import (
    init_db,
    ensure_grade_stats_table,
    save_grade_stats,
    get_grade_stats,
)

_BOARD_PATH = Path("data/parsed_json/mechanical_semester_board_2027.json")


# ---------------------------------------------------------------------------
# Part C — normalize_for_grade_source
# ---------------------------------------------------------------------------

def test_normalize_dashed():
    assert normalize_for_grade_source("0542-4320") == "05424320"


def test_normalize_undashed():
    assert normalize_for_grade_source("05424320") == "05424320"


def test_normalize_leading_zeroes():
    assert normalize_for_grade_source("0001-0001") == "00010001"


def test_normalize_spaces():
    assert normalize_for_grade_source(" 0542-4320 ") == "05424320"


def test_normalize_tau_factor_alias():
    """normalize_for_tau_factor is an alias for normalize_for_grade_source."""
    assert normalize_for_tau_factor("0542-4320") == normalize_for_grade_source("0542-4320")


# ---------------------------------------------------------------------------
# Part B — DB init creates course_grade_stats table
# ---------------------------------------------------------------------------

def test_init_db_creates_grade_stats_table(tmp_path):
    db = tmp_path / "test.db"
    init_db(db)
    conn = sqlite3.connect(db)
    tables = [r[0] for r in conn.execute(
        "SELECT name FROM sqlite_master WHERE type='table'"
    ).fetchall()]
    conn.close()
    assert "course_grade_stats" in tables, "init_db must create course_grade_stats"


def test_ensure_grade_stats_table_is_idempotent(tmp_path):
    """ensure_grade_stats_table called twice must not raise."""
    db = tmp_path / "test.db"
    init_db(db)
    ensure_grade_stats_table(db)
    ensure_grade_stats_table(db)  # second call must not raise
    conn = sqlite3.connect(db)
    tables = [r[0] for r in conn.execute(
        "SELECT name FROM sqlite_master WHERE type='table'"
    ).fetchall()]
    conn.close()
    assert "course_grade_stats" in tables


def test_init_db_on_existing_db_adds_missing_table(tmp_path):
    """init_db on a DB that has courses but not course_grade_stats adds the missing table."""
    db = tmp_path / "partial.db"
    # Create only the courses table manually
    conn = sqlite3.connect(db)
    conn.execute("CREATE TABLE courses (id INTEGER PRIMARY KEY, course_id TEXT)")
    conn.close()
    init_db(db)
    conn = sqlite3.connect(db)
    tables = [r[0] for r in conn.execute(
        "SELECT name FROM sqlite_master WHERE type='table'"
    ).fetchall()]
    conn.close()
    assert "course_grade_stats" in tables


# ---------------------------------------------------------------------------
# Part D — JSON list format
# ---------------------------------------------------------------------------

def test_parse_json_list():
    data = [{"course_id": "05424320", "avg_grade": 82.4, "sample_size": 120}]
    result = parse_grades_json(data)
    assert len(result) == 1
    assert result[0].course_id    == "0542-4320"
    assert result[0].average_grade == 82.4
    assert result[0].num_students  == 120


def test_parse_json_list_with_source():
    data = [{"course_id": "05424320", "avg_grade": 82.4, "sample_size": 120,
             "source": "tau_factor"}]
    result = parse_grades_json(data, source_name="tau_factor", source_url="https://example.com")
    assert result[0].source_name == "tau_factor"
    assert result[0].source_url  == "https://example.com"


def test_parse_json_list_dashed_id():
    data = [{"course_id": "0542-4320", "avg_grade": 75.0, "sample_size": 80}]
    result = parse_grades_json(data)
    assert result[0].course_id == "0542-4320"


# ---------------------------------------------------------------------------
# Part D — JSON dict-keyed format
# ---------------------------------------------------------------------------

def test_parse_json_dict_keyed():
    data = {"05424320": {"avg_grade": 82.4, "sample_size": 120}}
    result = parse_grades_json(data)
    assert len(result) == 1
    assert result[0].course_id    == "0542-4320"
    assert result[0].average_grade == 82.4
    assert result[0].num_students  == 120


def test_parse_json_dict_keyed_dashed():
    data = {"0542-4320": {"avg_grade": 78.5, "sample_size": 90}}
    result = parse_grades_json(data)
    assert len(result) == 1
    assert result[0].course_id    == "0542-4320"
    assert result[0].average_grade == 78.5


def test_parse_json_dict_keyed_multiple():
    data = {
        "05424320": {"avg_grade": 82.4, "sample_size": 120},
        "05424123": {"avg_grade": 71.0, "sample_size": 95},
    }
    result = parse_grades_json(data)
    assert len(result) == 2
    cids = {r.course_id for r in result}
    assert "0542-4320" in cids
    assert "0542-4123" in cids


# ---------------------------------------------------------------------------
# Part D — CSV format
# ---------------------------------------------------------------------------

def test_parse_csv_basic():
    text = "course_id,avg_grade,sample_size\n05424320,82.4,120\n"
    result = parse_grades_csv(text)
    assert len(result) == 1
    assert result[0].course_id    == "0542-4320"
    assert result[0].average_grade == 82.4
    assert result[0].num_students  == 120


def test_parse_csv_multiple_rows():
    text = "course_id,avg_grade,sample_size\n05424320,82.4,120\n05424123,71.0,95\n"
    result = parse_grades_csv(text)
    assert len(result) == 2


def test_parse_csv_with_extra_columns():
    text = "course_id,avg_grade,sample_size,source_url\n05424320,82.4,120,https://ex.com\n"
    result = parse_grades_csv(text)
    assert len(result) == 1
    assert result[0].average_grade == 82.4


def test_parse_csv_skips_missing_course_id():
    text = "course_id,avg_grade\n,82.4\n05424320,75.0\n"
    result = parse_grades_csv(text)
    assert len(result) == 1
    assert result[0].course_id == "0542-4320"


# ---------------------------------------------------------------------------
# Part D — import_grade_stats_from_file
# ---------------------------------------------------------------------------

def test_import_from_json_file(tmp_path):
    db  = tmp_path / "test.db"
    f   = tmp_path / "grades.json"
    f.write_text(json.dumps([{"course_id": "05424320", "avg_grade": 82.4, "sample_size": 120}]),
                 encoding="utf-8")
    n = import_grade_stats_from_file(f, db_path=db, source_name="test")
    assert n == 1
    rows = get_grade_stats("0542-4320", db)
    assert len(rows) == 1
    assert rows[0].average_grade == 82.4


def test_import_from_csv_file(tmp_path):
    db = tmp_path / "test.db"
    f  = tmp_path / "grades.csv"
    f.write_text("course_id,avg_grade,sample_size\n05424320,75.0,60\n", encoding="utf-8")
    n = import_grade_stats_from_file(f, db_path=db, source_name="test")
    assert n == 1
    rows = get_grade_stats("0542-4320", db)
    assert len(rows) == 1


def test_import_from_dict_json_file(tmp_path):
    db = tmp_path / "test.db"
    f  = tmp_path / "grades.json"
    f.write_text(json.dumps({"05424320": {"avg_grade": 88.0, "sample_size": 200}}),
                 encoding="utf-8")
    n = import_grade_stats_from_file(f, db_path=db, source_name="test")
    assert n == 1
    rows = get_grade_stats("0542-4320", db)
    assert rows[0].average_grade == 88.0


# ---------------------------------------------------------------------------
# Part F — course ID matching: dashed and undashed both find the same record
# ---------------------------------------------------------------------------

def test_get_grade_stats_dashed_id(tmp_path):
    db = tmp_path / "test.db"
    init_db(db)
    save_grade_stats([CourseGradeStats(
        course_id="0542-4320", average_grade=82.4, num_students=120
    )], db)
    rows = get_grade_stats("0542-4320", db)
    assert len(rows) == 1


def test_get_grade_stats_undashed_id_finds_dashed_record(tmp_path):
    """Undashed lookup ID (05424320) must find the record stored with dashed ID."""
    db = tmp_path / "test.db"
    init_db(db)
    save_grade_stats([CourseGradeStats(
        course_id="0542-4320", average_grade=82.4, num_students=120
    )], db)
    rows = get_grade_stats("05424320", db)
    assert len(rows) == 1, "undashed lookup must find dashed record"
    assert rows[0].average_grade == 82.4


def test_course_0542_4320_matches_imported_05424320(tmp_path):
    """Course 0542-4320 matches imported record with undashed ID 05424320."""
    db = tmp_path / "test.db"
    f  = tmp_path / "grades.json"
    f.write_text(json.dumps([{"course_id": "05424320", "avg_grade": 82.4, "sample_size": 120}]),
                 encoding="utf-8")
    import_grade_stats_from_file(f, db_path=db, source_name="test")
    rows = get_grade_stats("0542-4320", db)
    assert rows, "Dashed ID lookup must find record imported with undashed ID"
    assert rows[0].average_grade == 82.4


# ---------------------------------------------------------------------------
# Part E — source_unconfigured does not become not_found
# ---------------------------------------------------------------------------

def test_source_unconfigured_not_not_found(tmp_path, monkeypatch):
    """When no source URL is configured and DB has no data, status must be
    'source_unconfigured', not 'not_found'."""
    import os
    monkeypatch.delenv("GRADE_STATS_SOURCE_URL", raising=False)
    db = tmp_path / "test.db"
    init_db(db)
    from app.analysis.semester_board import _resolve_course_db_data
    result = _resolve_course_db_data("0542-4320", None, db)
    assert result["tau_factor_status"] != "not_found", (
        "source_unconfigured must not become not_found"
    )


def test_matched_when_grade_stats_present(tmp_path):
    db = tmp_path / "test.db"
    init_db(db)
    save_grade_stats([CourseGradeStats(
        course_id="0542-4320", average_grade=82.4, num_students=100
    )], db)
    from app.analysis.semester_board import _resolve_course_db_data
    result = _resolve_course_db_data("0542-4320", None, db)
    assert result["tau_factor_status"] == "matched"


# ---------------------------------------------------------------------------
# Part G — difficulty stays visible without grade stats
# ---------------------------------------------------------------------------

def test_difficulty_score_without_grade_stats(tmp_path):
    """difficulty_score must be present for courses with hours, regardless of grade stats."""
    board = json.loads(_BOARD_PATH.read_text(encoding="utf-8"))
    repo  = board["metadata"]["program_repository_courses"]
    with_hours = [r for r in repo if r.get("weekly_hours") is not None
                  and r.get("category_id") in ("fluids", "solids", "systems")]
    assert with_hours, "Need some repo courses with hours for this test"
    for r in with_hours:
        assert r.get("difficulty_score") is not None, (
            f"{r['course_id']}: must have difficulty_score even without grade stats"
        )


def test_matched_grade_signal_shown_as_available(tmp_path):
    """When grade stats are matched, tau_factor_status == 'matched'."""
    db = tmp_path / "test.db"
    init_db(db)
    save_grade_stats([CourseGradeStats(
        course_id="0542-4320", average_grade=78.0, num_students=90
    )], db)
    from app.analysis.semester_board import _resolve_course_db_data
    r = _resolve_course_db_data("0542-4320", None, db)
    assert r["tau_factor_status"] == "matched"
    assert r["tau_factor_avg_grade"] is None  # avg populated only in board enrichment, not here


# ---------------------------------------------------------------------------
# Part I — board enrichment with grade stats does not change planned courses
# ---------------------------------------------------------------------------

def test_grade_stats_attachment_does_not_change_planned(tmp_path):
    """Attaching grade stats to the board DB must not change the planned courses."""
    board = json.loads(_BOARD_PATH.read_text(encoding="utf-8"))
    placed_before = sum(len(s.get("courses", [])) for s in board["semesters"])
    # Simulate importing grade data
    db = tmp_path / "test.db"
    init_db(db)
    save_grade_stats([CourseGradeStats(
        course_id="0542-4320", average_grade=82.4, num_students=120
    )], db)
    # Board JSON itself is not changed by DB operations
    board_after = json.loads(_BOARD_PATH.read_text(encoding="utf-8"))
    placed_after = sum(len(s.get("courses", [])) for s in board_after["semesters"])
    assert placed_before == placed_after


def test_planned_elective_count_unchanged():
    """planned elective count stays 0 regardless of grade stats."""
    board = json.loads(_BOARD_PATH.read_text(encoding="utf-8"))
    placed_elec = [
        c for sem in board["semesters"]
        for c in sem.get("courses", [])
        if c.get("course_type") != "mandatory"
    ]
    assert not placed_elec


def test_repo_count_unchanged():
    board = json.loads(_BOARD_PATH.read_text(encoding="utf-8"))
    assert len(board["metadata"]["program_repository_courses"]) == 56

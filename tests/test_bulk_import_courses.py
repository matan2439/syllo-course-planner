"""
Tests for the bulk import pipeline.

import_course_pipeline is monkeypatched so no network calls are made.
time.sleep is monkeypatched to keep tests fast.
"""

import json
import pytest
from pathlib import Path

from app.database.db import init_db, save_merged_course
from app.pipeline.bulk_import_courses import load_course_ids, bulk_import_courses, _normalize


# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------

@pytest.fixture
def tmp_db(tmp_path):
    db = tmp_path / "bulk_test.sqlite"
    init_db(db)
    return db


def _mock_pipeline_ok(course_id, year, **kwargs):
    return {
        "course_id":    course_id,
        "groups_count": 5,
        "syllabus_url": "https://example.com/syllabus",
        "merged_path":  f"data/parsed_json/merged_{course_id}.json",
        "db_imported":  True,
    }


def _mock_pipeline_fail(course_id, year, **kwargs):
    raise RuntimeError(f"Network error for {course_id}")


# ---------------------------------------------------------------------------
# _normalize
# ---------------------------------------------------------------------------

def test_normalize_digits():     assert _normalize("03682157") == "0368-2157"
def test_normalize_hyphen():     assert _normalize("0368-2157") == "0368-2157"
def test_normalize_passthrough(): assert _normalize("abc") == "abc"


# ---------------------------------------------------------------------------
# load_course_ids
# ---------------------------------------------------------------------------

def test_load_basic(tmp_path):
    f = tmp_path / "courses.txt"
    f.write_text("0368-1105\n0368-2157\n", encoding="utf-8")
    assert load_course_ids(f) == ["0368-1105", "0368-2157"]


def test_load_skips_blank_lines(tmp_path):
    f = tmp_path / "courses.txt"
    f.write_text("0368-1105\n\n0368-2157\n", encoding="utf-8")
    assert load_course_ids(f) == ["0368-1105", "0368-2157"]


def test_load_skips_comments(tmp_path):
    f = tmp_path / "courses.txt"
    f.write_text("# comment\n0368-1105\n# another\n0368-2157\n", encoding="utf-8")
    assert load_course_ids(f) == ["0368-1105", "0368-2157"]


def test_load_normalises_ids(tmp_path):
    f = tmp_path / "courses.txt"
    f.write_text("03682157\n", encoding="utf-8")
    assert load_course_ids(f) == ["0368-2157"]


def test_load_empty_file(tmp_path):
    f = tmp_path / "courses.txt"
    f.write_text("", encoding="utf-8")
    assert load_course_ids(f) == []


def test_load_only_comments(tmp_path):
    f = tmp_path / "courses.txt"
    f.write_text("# just a comment\n", encoding="utf-8")
    assert load_course_ids(f) == []


# ---------------------------------------------------------------------------
# bulk_import_courses — basic
# ---------------------------------------------------------------------------

def test_imports_all_courses(monkeypatch, tmp_path, tmp_db):
    monkeypatch.setattr("app.pipeline.bulk_import_courses.import_course_pipeline", _mock_pipeline_ok)
    monkeypatch.setattr("app.pipeline.bulk_import_courses.time.sleep", lambda _: None)

    report = bulk_import_courses(
        ["0368-1105", "0368-2157"], year=2025, delay_seconds=0,
        db_path=tmp_db, report_dir=tmp_path / "reports",
    )
    assert report["imported"] == 2
    assert report["skipped"]  == 0
    assert report["failed"]   == 0


def test_report_has_all_keys(monkeypatch, tmp_path, tmp_db):
    monkeypatch.setattr("app.pipeline.bulk_import_courses.import_course_pipeline", _mock_pipeline_ok)
    monkeypatch.setattr("app.pipeline.bulk_import_courses.time.sleep", lambda _: None)

    report = bulk_import_courses(
        ["0368-1105"], year=2025, delay_seconds=0,
        db_path=tmp_db, report_dir=tmp_path / "reports",
    )
    assert {"year", "total_requested", "imported", "skipped", "failed",
            "started_at", "finished_at", "course_results"} == set(report.keys())


def test_total_requested_matches(monkeypatch, tmp_path, tmp_db):
    monkeypatch.setattr("app.pipeline.bulk_import_courses.import_course_pipeline", _mock_pipeline_ok)
    monkeypatch.setattr("app.pipeline.bulk_import_courses.time.sleep", lambda _: None)

    report = bulk_import_courses(
        ["A", "B", "C"], year=2025, delay_seconds=0,
        db_path=tmp_db, report_dir=tmp_path / "reports",
    )
    assert report["total_requested"] == 3


def test_course_results_populated(monkeypatch, tmp_path, tmp_db):
    monkeypatch.setattr("app.pipeline.bulk_import_courses.import_course_pipeline", _mock_pipeline_ok)
    monkeypatch.setattr("app.pipeline.bulk_import_courses.time.sleep", lambda _: None)

    report = bulk_import_courses(
        ["0368-1105", "0368-2157"], year=2025, delay_seconds=0,
        db_path=tmp_db, report_dir=tmp_path / "reports",
    )
    assert len(report["course_results"]) == 2
    assert all(r["status"] == "imported" for r in report["course_results"])


# ---------------------------------------------------------------------------
# Report file
# ---------------------------------------------------------------------------

def test_report_file_written(monkeypatch, tmp_path, tmp_db):
    monkeypatch.setattr("app.pipeline.bulk_import_courses.import_course_pipeline", _mock_pipeline_ok)
    monkeypatch.setattr("app.pipeline.bulk_import_courses.time.sleep", lambda _: None)

    report_dir = tmp_path / "reports"
    bulk_import_courses(
        ["0368-1105"], year=2025, delay_seconds=0,
        db_path=tmp_db, report_dir=report_dir,
    )
    files = list(report_dir.glob("bulk_import_*.json"))
    assert len(files) == 1


def test_report_file_valid_json(monkeypatch, tmp_path, tmp_db):
    monkeypatch.setattr("app.pipeline.bulk_import_courses.import_course_pipeline", _mock_pipeline_ok)
    monkeypatch.setattr("app.pipeline.bulk_import_courses.time.sleep", lambda _: None)

    report_dir = tmp_path / "reports"
    bulk_import_courses(
        ["0368-1105"], year=2025, delay_seconds=0,
        db_path=tmp_db, report_dir=report_dir,
    )
    f = list(report_dir.glob("bulk_import_*.json"))[0]
    data = json.loads(f.read_text(encoding="utf-8"))
    assert data["year"] == 2025
    assert data["imported"] == 1


# ---------------------------------------------------------------------------
# --skip-existing
# ---------------------------------------------------------------------------

def _minimal_course(course_id):
    return {
        "course_id": course_id, "name_he": course_id, "name_en": None,
        "faculty": None, "department": None, "year": 2025, "semester": None,
        "credits": None, "lecture_hours": None, "tutorial_hours": None,
        "lab_hours": None, "prerequisites_raw_text": None,
        "prerequisite_course_ids": [], "course_description": None,
        "topics": [], "assignments": None, "exam_info": None,
        "syllabus_links": [], "groups": [], "source_files": {},
    }


def test_skip_existing_skips_known_course(monkeypatch, tmp_path, tmp_db):
    save_merged_course(_minimal_course("0368-1105"), tmp_db)

    called = []
    def mock_pipeline(course_id, year, **kwargs):
        called.append(course_id)
        return _mock_pipeline_ok(course_id, year, **kwargs)

    monkeypatch.setattr("app.pipeline.bulk_import_courses.import_course_pipeline", mock_pipeline)
    monkeypatch.setattr("app.pipeline.bulk_import_courses.time.sleep", lambda _: None)

    report = bulk_import_courses(
        ["0368-1105", "0368-2157"], year=2025, skip_existing=True, delay_seconds=0,
        db_path=tmp_db, report_dir=tmp_path / "reports",
    )
    assert report["skipped"] == 1
    assert report["imported"] == 1
    assert "0368-1105" not in called
    assert "0368-2157" in called


def test_skip_existing_false_reimports(monkeypatch, tmp_path, tmp_db):
    save_merged_course(_minimal_course("0368-1105"), tmp_db)

    called = []
    def mock_pipeline(course_id, year, **kwargs):
        called.append(course_id)
        return _mock_pipeline_ok(course_id, year, **kwargs)

    monkeypatch.setattr("app.pipeline.bulk_import_courses.import_course_pipeline", mock_pipeline)
    monkeypatch.setattr("app.pipeline.bulk_import_courses.time.sleep", lambda _: None)

    report = bulk_import_courses(
        ["0368-1105"], year=2025, skip_existing=False, delay_seconds=0,
        db_path=tmp_db, report_dir=tmp_path / "reports",
    )
    assert report["imported"] == 1
    assert "0368-1105" in called


# ---------------------------------------------------------------------------
# --limit
# ---------------------------------------------------------------------------

def test_limit_restricts_imports(monkeypatch, tmp_path, tmp_db):
    called = []
    def mock_pipeline(course_id, year, **kwargs):
        called.append(course_id)
        return _mock_pipeline_ok(course_id, year, **kwargs)

    monkeypatch.setattr("app.pipeline.bulk_import_courses.import_course_pipeline", mock_pipeline)
    monkeypatch.setattr("app.pipeline.bulk_import_courses.time.sleep", lambda _: None)

    report = bulk_import_courses(
        ["A", "B", "C", "D"], year=2025, limit=2, delay_seconds=0,
        db_path=tmp_db, report_dir=tmp_path / "reports",
    )
    assert report["total_requested"] == 2
    assert len(called) == 2


def test_limit_none_imports_all(monkeypatch, tmp_path, tmp_db):
    called = []
    def mock_pipeline(course_id, year, **kwargs):
        called.append(course_id)
        return _mock_pipeline_ok(course_id, year, **kwargs)

    monkeypatch.setattr("app.pipeline.bulk_import_courses.import_course_pipeline", mock_pipeline)
    monkeypatch.setattr("app.pipeline.bulk_import_courses.time.sleep", lambda _: None)

    bulk_import_courses(
        ["A", "B", "C"], year=2025, limit=None, delay_seconds=0,
        db_path=tmp_db, report_dir=tmp_path / "reports",
    )
    assert len(called) == 3


# ---------------------------------------------------------------------------
# --continue-on-error
# ---------------------------------------------------------------------------

def test_stop_on_first_error_by_default(monkeypatch, tmp_path, tmp_db):
    calls = []
    def mock_pipeline(course_id, year, **kwargs):
        calls.append(course_id)
        raise RuntimeError("boom")

    monkeypatch.setattr("app.pipeline.bulk_import_courses.import_course_pipeline", mock_pipeline)
    monkeypatch.setattr("app.pipeline.bulk_import_courses.time.sleep", lambda _: None)

    report = bulk_import_courses(
        ["A", "B", "C"], year=2025, continue_on_error=False, delay_seconds=0,
        db_path=tmp_db, report_dir=tmp_path / "reports",
    )
    assert len(calls) == 1        # stopped after first failure
    assert report["failed"] == 1


def test_continue_on_error_processes_all(monkeypatch, tmp_path, tmp_db):
    calls = []
    def mock_pipeline(course_id, year, **kwargs):
        calls.append(course_id)
        raise RuntimeError("boom")

    monkeypatch.setattr("app.pipeline.bulk_import_courses.import_course_pipeline", mock_pipeline)
    monkeypatch.setattr("app.pipeline.bulk_import_courses.time.sleep", lambda _: None)

    report = bulk_import_courses(
        ["A", "B", "C"], year=2025, continue_on_error=True, delay_seconds=0,
        db_path=tmp_db, report_dir=tmp_path / "reports",
    )
    assert len(calls) == 3
    assert report["failed"] == 3


def test_continue_on_error_mixed(monkeypatch, tmp_path, tmp_db):
    def mock_pipeline(course_id, year, **kwargs):
        if course_id == "B":
            raise RuntimeError("fail")
        return _mock_pipeline_ok(course_id, year, **kwargs)

    monkeypatch.setattr("app.pipeline.bulk_import_courses.import_course_pipeline", mock_pipeline)
    monkeypatch.setattr("app.pipeline.bulk_import_courses.time.sleep", lambda _: None)

    report = bulk_import_courses(
        ["A", "B", "C"], year=2025, continue_on_error=True, delay_seconds=0,
        db_path=tmp_db, report_dir=tmp_path / "reports",
    )
    assert report["imported"] == 2
    assert report["failed"]   == 1
    statuses = {r["course_id"]: r["status"] for r in report["course_results"]}
    assert statuses == {"A": "imported", "B": "failed", "C": "imported"}

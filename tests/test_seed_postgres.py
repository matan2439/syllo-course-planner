"""
Tests for app/pipeline/seed_postgres.py — extraction layer only.

All tests run against real local files (data/database.sqlite and
data/programs/*.json) but require NO Postgres connection.  The upsert
layer (psycopg2) is never called here, so normal pytest always passes.
"""

from __future__ import annotations

import os
from pathlib import Path
from unittest.mock import MagicMock, patch

import pytest

from app.pipeline.seed_postgres import (
    BASE_PROGRAM_ID,
    ACADEMIC_YEAR,
    SeedResult,
    extract_course_categories,
    extract_course_groups_from_sqlite,
    extract_course_offerings,
    extract_courses_from_sqlite,
    extract_grade_stats_from_sqlite,
    extract_mandatory_stubs,
    extract_course_stubs_from_board,
    extract_prerequisites_from_sqlite,
    extract_program_courses,
    extract_program_version,
    extract_programs,
    extract_syllabus_sources,
    extract_all,
    seed_all,
    _BOARD_PATH as _BOARD,
)

_SQLITE   = Path("data/database.sqlite")
_ENRICHED = Path("data/programs/mechanical_engineering_2027_enriched.json")
_MANDATORY = Path("data/programs/mechanical_engineering_mandatory_2027.json")
_BOARD    = Path("data/parsed_json/mechanical_semester_board_2027.json")

import json

_enriched_json  = json.loads(_ENRICHED.read_text("utf-8"))
_mandatory_json = json.loads(_MANDATORY.read_text("utf-8"))
_board_json     = json.loads(_BOARD.read_text("utf-8"))


# ── 1. SQLite course extraction ───────────────────────────────────────────────

def test_extract_courses_from_sqlite_count_and_fields():
    """SQLite has 31 course records; each has required fields."""
    courses = extract_courses_from_sqlite(_SQLITE)
    assert len(courses) == 31, f"Expected 31 SQLite courses, got {len(courses)}"

    required = {"course_id", "name_he", "topics", "syllabus_links",
                "last_seen_year", "last_seen_semester"}
    for c in courses:
        for field in required:
            assert field in c, f"Missing field '{field}' in course {c.get('course_id')}"

    # topics and syllabus_links must be lists (not raw JSON strings)
    for c in courses:
        assert isinstance(c["topics"], list), \
            f"topics should be list, got {type(c['topics'])} for {c['course_id']}"
        assert isinstance(c["syllabus_links"], list), \
            f"syllabus_links should be list for {c['course_id']}"


def test_extract_courses_no_duplicate_course_ids():
    """course_id is unique across all extracted course records."""
    courses = extract_courses_from_sqlite(_SQLITE)
    ids = [c["course_id"] for c in courses]
    assert len(ids) == len(set(ids)), "Duplicate course_ids found in SQLite extraction"


def test_extract_program_version_includes_board_json():
    """extract_program_version loads board_json from the board path when it exists."""
    pv = extract_program_version(_enriched_json, _BOARD)
    assert pv["board_json"] is not None, "board_json should be loaded from _BOARD_PATH"
    assert isinstance(pv["board_json"], dict), "board_json should be a dict"
    assert "semesters" in pv["board_json"], "board_json should have 'semesters' key"
    assert "metadata" in pv["board_json"], "board_json should have 'metadata' key"
    repo = pv["board_json"]["metadata"].get("program_repository_courses", [])
    assert len(repo) == 56, f"Expected 56 repo courses in board_json, got {len(repo)}"


# ── 2. course_groups year enrichment ─────────────────────────────────────────

def test_extract_course_groups_count():
    """All 113 course_groups rows are returned."""
    groups, _ = extract_course_groups_from_sqlite(_SQLITE)
    assert len(groups) == 113, f"Expected 113 groups, got {len(groups)}"


def test_extract_course_groups_year_enriched_from_courses():
    """Year is populated from the courses table for groups whose course is known."""
    groups, warnings = extract_course_groups_from_sqlite(_SQLITE)

    # At least one group should have a resolved year (non-null)
    resolved = [g for g in groups if g["year"] is not None]
    assert resolved, "No groups had their year resolved from courses table"

    # Warnings are emitted for groups whose year could not be resolved
    unresolved = [g for g in groups if g["year"] is None]
    assert len(unresolved) == len(warnings), (
        f"Expected {len(unresolved)} warnings for null-year groups, got {len(warnings)}"
    )


def test_extract_course_groups_has_required_fields():
    """All group dicts carry the expected schema keys."""
    groups, _ = extract_course_groups_from_sqlite(_SQLITE)
    required = {"course_id", "year", "semester", "group_number", "lecturer"}
    for g in groups:
        for f in required:
            assert f in g, f"Missing field '{f}' in group {g}"


# ── 3. Program JSON extraction ────────────────────────────────────────────────

def test_extract_programs_strips_year_from_program_id():
    """Base program_id ('mechanical_engineering') is set; academic year is stripped."""
    prog = extract_programs(_enriched_json)
    assert prog["program_id"] == BASE_PROGRAM_ID
    assert str(ACADEMIC_YEAR) not in prog["program_id"]
    assert prog["name_he"], "name_he should be non-empty"


def test_extract_program_version_year_and_hours():
    """program_version has correct academic_year and total_required_hours."""
    pv = extract_program_version(_enriched_json)
    assert pv["academic_year"] == ACADEMIC_YEAR
    assert pv["total_required_hours"] == 185
    assert pv["program_id"] == BASE_PROGRAM_ID
    assert isinstance(pv["raw_json"], dict), "raw_json should be the full enriched dict"
    assert isinstance(pv["notes"], list)


def test_extract_course_categories_count_and_ids():
    """All 5 categories are extracted with correct category_ids."""
    cats = extract_course_categories(_enriched_json)
    assert len(cats) == 5, f"Expected 5 categories, got {len(cats)}"

    ids = {c["category_id"] for c in cats}
    expected = {"fluids", "solids", "systems", "advanced_labs", "other_specialization"}
    assert ids == expected, f"Category IDs mismatch: {ids}"

    for c in cats:
        assert "name_he" in c
        assert "min_courses" in c
        assert isinstance(c["display_order"], int)


# ── 4. Mandatory course extraction ───────────────────────────────────────────

def test_extract_program_courses_mandatory_flagged():
    """All 12 mandatory courses have is_mandatory=True."""
    pc = extract_program_courses(_enriched_json, _mandatory_json)

    mandatory_ids = {c["course_id"] for c in _mandatory_json.get("courses", [])}
    assert len(mandatory_ids) == 12, f"Expected 12 mandatory courses, got {len(mandatory_ids)}"

    mandatory_pc = {c["course_id"] for c in pc if c.get("is_mandatory")}
    for mid in mandatory_ids:
        assert mid in mandatory_pc, f"Mandatory course {mid} not flagged in program_courses"


def test_extract_program_courses_electives_not_mandatory():
    """Elective-only courses (not in mandatory JSON) have is_mandatory=False."""
    mandatory_ids = {c["course_id"] for c in _mandatory_json.get("courses", [])}
    pc = extract_program_courses(_enriched_json, _mandatory_json)

    for c in pc:
        if c["course_id"] not in mandatory_ids:
            assert not c.get("is_mandatory"), (
                f"Course {c['course_id']} should not be mandatory"
            )


def test_extract_program_courses_total_count():
    """Total program_courses = electives (56) + mandatory-only (those not in electives)."""
    pc = extract_program_courses(_enriched_json, _mandatory_json)
    # 17 elective + 39 other_spec = 56 elective rows, plus up to 12 mandatory
    # Some mandatory may already be in electives, so total is between 56 and 68
    assert 56 <= len(pc) <= 68, f"Unexpected program_courses count: {len(pc)}"
    # No duplicate course_ids
    ids = [c["course_id"] for c in pc]
    assert len(ids) == len(set(ids)), "Duplicate course_ids in program_courses"


# ── 5. Upsert-payload idempotency ─────────────────────────────────────────────

def test_full_courses_list_no_duplicates():
    """After combining SQLite + board stubs + mandatory stubs, course_ids are unique."""
    sqlite_courses = extract_courses_from_sqlite(_SQLITE)
    known = {c["course_id"] for c in sqlite_courses}
    board_stubs = extract_course_stubs_from_board(_board_json, known)
    known |= {c["course_id"] for c in board_stubs}
    mand_stubs = extract_mandatory_stubs(_mandatory_json, known)

    all_courses = sqlite_courses + board_stubs + mand_stubs
    ids = [c["course_id"] for c in all_courses]
    assert len(ids) == len(set(ids)), "Duplicate course_ids in combined courses list"

    # Count sanity: ≥ 56 (board repo size) and ≤ 100 (generous upper bound)
    assert len(ids) >= 56
    assert len(ids) <= 100


def test_grade_stats_no_duplicates_after_dedup():
    """Extracted grade_stats rows are deduplicated on (course_id, year, semester, moed)."""
    stats = extract_grade_stats_from_sqlite(_SQLITE)
    assert len(stats) > 0, "Expected grade_stats rows from SQLite"

    keys = [
        (s["course_id"], s["year"], s["semester"], s["moed"], s["source_name"])
        for s in stats
    ]
    assert len(keys) == len(set(keys)), "Duplicate grade_stats rows after extraction"


def test_syllabus_sources_are_unique_url_per_course():
    """extract_syllabus_sources deduplicates (course_id, url) pairs."""
    groups, _ = extract_course_groups_from_sqlite(_SQLITE)
    sources = extract_syllabus_sources(groups)

    pairs = [(s["course_id"], s["url"]) for s in sources]
    assert len(pairs) == len(set(pairs)), "Duplicate (course_id, url) in syllabus_sources"


# ── 6. Dry-run without DATABASE_URL ──────────────────────────────────────────

def test_dry_run_returns_counts_without_db():
    """seed_all(dry_run=True) extracts and returns counts with no DB connection."""
    fake_settings = MagicMock()
    fake_settings.database_url = ""

    with patch("app.pipeline.seed_postgres.settings", fake_settings):
        result = seed_all(db_url=None, dry_run=True)

    assert isinstance(result, SeedResult)
    assert result.programs == 1
    assert result.program_versions == 1
    assert result.courses >= 56          # SQLite + board stubs
    assert result.course_groups == 113
    assert result.prerequisites == 39
    assert result.course_categories == 5
    assert result.program_courses >= 56
    assert result.mandatory_courses == 12
    assert result.grade_stats > 0
    assert result.import_runs == 0       # dry-run never writes import_runs


def test_dry_run_does_not_import_psycopg2(monkeypatch):
    """dry_run path never calls upsert_all, so psycopg2 is never needed."""
    # Monkeypatching upsert_all to raise if called — should not be reached
    fake_settings = MagicMock()
    fake_settings.database_url = ""

    def _boom(*a, **kw):
        raise AssertionError("upsert_all should NOT be called in dry_run mode")

    with patch("app.pipeline.seed_postgres.settings", fake_settings), \
         patch("app.pipeline.seed_postgres.upsert_all", _boom):
        result = seed_all(db_url=None, dry_run=True)

    assert result.programs == 1


# ── 7. Missing DATABASE_URL ───────────────────────────────────────────────────

def test_missing_database_url_raises_runtime_error():
    """seed_all() raises RuntimeError with a helpful message when no URL configured."""
    fake_settings = MagicMock()
    fake_settings.database_url = ""

    with patch("app.pipeline.seed_postgres.settings", fake_settings):
        with pytest.raises(RuntimeError, match="DATABASE_URL"):
            seed_all(db_url=None, dry_run=False)


def test_explicit_db_url_skips_settings_lookup():
    """Passing db_url=<bad> raises connection error (not the 'no URL' RuntimeError)."""
    fake_settings = MagicMock()
    fake_settings.database_url = ""

    with patch("app.pipeline.seed_postgres.settings", fake_settings):
        # With a bad URL but dry_run=False, it should try to connect (not raise RuntimeError)
        # We verify by checking the error is NOT the "DATABASE_URL" RuntimeError
        with pytest.raises(Exception) as exc_info:
            seed_all(db_url="postgresql://bad:bad@localhost:5999/nodb", dry_run=False)

        assert "DATABASE_URL" not in str(exc_info.value), (
            "A bad-but-present URL should attempt connection, not raise the missing-URL error"
        )


# ── 8. No Postgres required for normal pytest ─────────────────────────────────

def test_module_imports_without_psycopg2():
    """seed_postgres can be imported without a live Postgres installation."""
    # This test is implicitly satisfied by the fact that the whole test file
    # runs without psycopg2 being called at module level.  We verify the
    # module-level import worked by checking a constant.
    from app.pipeline import seed_postgres as sp
    assert sp.BASE_PROGRAM_ID == "mechanical_engineering"
    assert sp.ACADEMIC_YEAR == 2027

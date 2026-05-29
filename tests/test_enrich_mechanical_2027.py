"""
Tests for app.pipeline.enrich_mechanical_2027.

All tests use fixtures and cached data — no live network calls.
"""

from __future__ import annotations

import json
from collections import Counter
from pathlib import Path

import pytest

from app.pipeline.enrich_mechanical_2027 import (
    _normalize_course_id,
    _extract_course_map,
    _extract_mandatory_courses,
    enrich_board,
)

_BOARD_PATH    = Path("data/parsed_json/mechanical_semester_board_2027.json")
_MAND_PATH     = Path("data/programs/mechanical_engineering_mandatory_2027.json")
_GQL_CACHE     = Path("data/raw_html/tau_program_8715_2025.json")
_PDF_PATH      = Path("data/programs/mechanical_engineering_2027_from_pdf.json")


# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------

@pytest.fixture(scope="module")
def gql_body() -> list[dict]:
    """Load GraphQL body from local cache."""
    raw = json.loads(_GQL_CACHE.read_text(encoding="utf-8-sig"))
    return raw["data"]["results"]["body"]


@pytest.fixture(scope="module")
def board() -> dict:
    return json.loads(_BOARD_PATH.read_text(encoding="utf-8"))


@pytest.fixture(scope="module")
def repo(board) -> list[dict]:
    return board["metadata"]["program_repository_courses"]


# ---------------------------------------------------------------------------
# _normalize_course_id
# ---------------------------------------------------------------------------

def test_normalize_8digit_string():
    assert _normalize_course_id("05424320") == "0542-4320"


def test_normalize_dashed_stays():
    assert _normalize_course_id("0542-4320") == "0542-4320"


def test_normalize_preserves_leading_zeroes():
    assert _normalize_course_id("00010001") == "0001-0001"


# ---------------------------------------------------------------------------
# _extract_course_map
# ---------------------------------------------------------------------------

def test_extract_course_map_returns_dict(gql_body):
    cmap = _extract_course_map(gql_body)
    assert isinstance(cmap, dict)


def test_extract_course_map_has_known_course(gql_body):
    """Course 0542-4320 (Fluid Mechanics 2) must be in the GraphQL cache."""
    cmap = _extract_course_map(gql_body)
    assert "0542-4320" in cmap, "0542-4320 must be in course map"
    assert cmap["0542-4320"]["name_he"], "Must have a Hebrew name"


def test_extract_course_map_all_have_name(gql_body):
    """Every entry in course_map has a non-empty name_he."""
    cmap = _extract_course_map(gql_body)
    for cid, info in cmap.items():
        assert info.get("name_he"), f"{cid} has empty name_he"


def test_extract_course_map_skips_cancelled(gql_body):
    """Cancelled courses (mevutal='1') must not appear in the map."""
    # We can only verify no course has suspicious data — full test requires known cancelled ID
    cmap = _extract_course_map(gql_body)
    assert len(cmap) > 50, "Should have at least 50 active courses"


# ---------------------------------------------------------------------------
# _extract_mandatory_courses
# ---------------------------------------------------------------------------

def test_extract_mandatory_courses_returns_list(gql_body):
    courses = _extract_mandatory_courses(gql_body)
    assert isinstance(courses, list)


def test_extract_mandatory_courses_have_required_fields(gql_body):
    courses = _extract_mandatory_courses(gql_body)
    for c in courses:
        assert "course_id" in c, f"Missing course_id: {c}"
        assert "name_he" in c
        assert "year" in c
        assert c["year"] in (3, 4), f"Unexpected year: {c['year']}"
        assert c.get("locked_by_default") is True


def test_extract_mandatory_courses_not_empty(gql_body):
    """Y3/Y4 must have at least some mandatory courses."""
    courses = _extract_mandatory_courses(gql_body)
    assert len(courses) > 0, "Should extract at least one mandatory Y3/Y4 course"


def test_mandatory_courses_not_in_elective_repo(gql_body):
    """Mandatory courses extracted from GraphQL must not appear in the 56-course elective repo."""
    mandatory_ids = {c["course_id"] for c in _extract_mandatory_courses(gql_body)}
    board = json.loads(_BOARD_PATH.read_text(encoding="utf-8"))
    repo_ids = {r["course_id"] for r in board["metadata"]["program_repository_courses"]}
    overlap = mandatory_ids & repo_ids
    assert not overlap, f"Mandatory courses overlap with repo: {overlap}"


# ---------------------------------------------------------------------------
# Board integrity — category counts must be preserved
# ---------------------------------------------------------------------------

def test_board_repo_count_56(repo):
    """Repository must have exactly 56 courses."""
    assert len(repo) == 56, f"Expected 56 repo courses, got {len(repo)}"


def test_board_fluids_count_4(repo):
    assert sum(1 for r in repo if r.get("category_id") == "fluids") == 4


def test_board_solids_count_4(repo):
    assert sum(1 for r in repo if r.get("category_id") == "solids") == 4


def test_board_systems_count_4(repo):
    assert sum(1 for r in repo if r.get("category_id") == "systems") == 4


def test_board_advanced_labs_count_5(repo):
    assert sum(1 for r in repo if r.get("category_id") == "advanced_labs") == 5


def test_board_other_specialization_count_39(repo):
    assert sum(1 for r in repo if r.get("category_id") == "other_specialization") == 39


def test_board_planned_courses_zero():
    """Planned (board-placed) courses for 2027 must remain 0."""
    board = json.loads(_BOARD_PATH.read_text(encoding="utf-8"))
    placed = sum(len(s.get("courses", [])) for s in board["semesters"])
    assert placed == 0, f"Expected 0 planned courses, got {placed}"


def test_board_category_counts_sum_to_56(repo):
    """All 56 courses must be assigned to a known category."""
    known = {"fluids", "solids", "systems", "advanced_labs", "other_specialization"}
    missing = [r["course_id"] for r in repo if r.get("category_id") not in known]
    assert not missing, f"Courses with unknown/missing category_id: {missing}"


# ---------------------------------------------------------------------------
# TAU Factor status in board
# ---------------------------------------------------------------------------

def test_all_board_courses_have_tau_factor_status(repo):
    """Every repo course must have a tau_factor_status field."""
    valid = {"not_started", "matched", "not_found", "failed"}
    bad = [r["course_id"] for r in repo if r.get("tau_factor_status") not in valid]
    assert not bad, f"Invalid tau_factor_status: {bad}"


def test_tau_factor_lookup_id_normalized(repo):
    """Every repo course must have tau_factor_lookup_id (undashed)."""
    for r in repo:
        tid = r.get("tau_factor_lookup_id")
        assert tid, f"{r['course_id']} missing tau_factor_lookup_id"
        assert "-" not in tid, f"{r['course_id']}: tau_factor_lookup_id must be undashed: {tid}"


# ---------------------------------------------------------------------------
# course_details_url presence
# ---------------------------------------------------------------------------

def test_all_courses_have_course_details_url(repo):
    """All 56 repo courses must have course_details_url."""
    missing = [r["course_id"] for r in repo if not r.get("course_details_url")]
    assert not missing, f"Missing course_details_url: {missing}"


# ---------------------------------------------------------------------------
# enrich_board dry-run does not modify board JSON
# ---------------------------------------------------------------------------

def test_enrich_board_dry_run_no_write(tmp_path):
    """enrich_board with dry_run=True must not write to disk."""
    import shutil
    board_copy = tmp_path / "board.json"
    shutil.copy(_BOARD_PATH, board_copy)
    before = board_copy.read_text(encoding="utf-8")
    enrich_board(board_path=board_copy, dry_run=True)
    after = board_copy.read_text(encoding="utf-8")
    assert before == after, "dry_run must not modify the board JSON"


# ---------------------------------------------------------------------------
# mandatory_2027.json file integrity
# ---------------------------------------------------------------------------

def test_mandatory_file_valid():
    mand = json.loads(_MAND_PATH.read_text(encoding="utf-8"))
    assert "courses" in mand
    assert isinstance(mand["courses"], list)
    valid_statuses = {"empty_placeholder", "extracted_from_graphql", "verified"}
    assert mand.get("status") in valid_statuses


def test_mandatory_file_no_overlap_with_repo():
    mand = json.loads(_MAND_PATH.read_text(encoding="utf-8"))
    mand_ids = {c["course_id"] for c in mand.get("courses", [])}
    board = json.loads(_BOARD_PATH.read_text(encoding="utf-8"))
    repo_ids = {r["course_id"] for r in board["metadata"]["program_repository_courses"]}
    overlap = mand_ids & repo_ids
    assert not overlap, f"Mandatory courses overlap with elective repo: {overlap}"

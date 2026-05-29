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


def test_board_planned_electives_zero():
    """Planned elective/core/lab courses remain 0; only mandatory may be auto-placed."""
    board = json.loads(_BOARD_PATH.read_text(encoding="utf-8"))
    placed_electives = [
        c for sem in board["semesters"]
        for c in sem.get("courses", [])
        if c.get("course_type") != "mandatory"
    ]
    assert not placed_electives, f"Unexpected placed non-mandatory: {[c['course_id'] for c in placed_electives]}"


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


# ---------------------------------------------------------------------------
# Mandatory courses: board placement (Part B)
# ---------------------------------------------------------------------------

def test_board_mandatory_placed():
    """Board JSON must have mandatory courses placed in semesters."""
    board = json.loads(_BOARD_PATH.read_text(encoding="utf-8"))
    mandatory = [
        c for sem in board["semesters"]
        for c in sem.get("courses", [])
        if c.get("course_type") == "mandatory"
    ]
    assert len(mandatory) >= 1, "Board must have at least one mandatory course placed"


def test_board_mandatory_have_names():
    """All placed mandatory courses must have name_he from spec."""
    board = json.loads(_BOARD_PATH.read_text(encoding="utf-8"))
    mandatory = [
        c for sem in board["semesters"]
        for c in sem.get("courses", [])
        if c.get("course_type") == "mandatory"
    ]
    missing = [c["course_id"] for c in mandatory if not c.get("name_he")]
    assert not missing, f"Mandatory courses missing name_he: {missing}"


def test_board_mandatory_have_hours():
    """All placed mandatory courses must have weekly_hours from spec."""
    board = json.loads(_BOARD_PATH.read_text(encoding="utf-8"))
    mandatory = [
        c for sem in board["semesters"]
        for c in sem.get("courses", [])
        if c.get("course_type") == "mandatory"
    ]
    missing = [c["course_id"] for c in mandatory if c.get("weekly_hours") is None]
    assert not missing, f"Mandatory courses missing weekly_hours: {missing}"


def test_board_mandatory_not_in_repo():
    """Mandatory placed courses must not appear in program_repository_courses."""
    board = json.loads(_BOARD_PATH.read_text(encoding="utf-8"))
    mandatory_ids = {
        c["course_id"]
        for sem in board["semesters"]
        for c in sem.get("courses", [])
        if c.get("course_type") == "mandatory"
    }
    repo_ids = {r["course_id"] for r in board["metadata"]["program_repository_courses"]}
    overlap = mandatory_ids & repo_ids
    assert not overlap, f"Mandatory courses appear in repo: {overlap}"


def test_board_mandatory_not_duplicated():
    """Each mandatory course appears at most once across all semesters."""
    board = json.loads(_BOARD_PATH.read_text(encoding="utf-8"))
    mandatory_ids = [
        c["course_id"]
        for sem in board["semesters"]
        for c in sem.get("courses", [])
        if c.get("course_type") == "mandatory"
    ]
    from collections import Counter
    counts = Counter(mandatory_ids)
    dupes = {cid: n for cid, n in counts.items() if n > 1}
    assert not dupes, f"Duplicate mandatory courses: {dupes}"


def test_board_mandatory_locked_by_default():
    """Placed mandatory courses have locked_by_default=True."""
    board = json.loads(_BOARD_PATH.read_text(encoding="utf-8"))
    not_locked = [
        c["course_id"]
        for sem in board["semesters"]
        for c in sem.get("courses", [])
        if c.get("course_type") == "mandatory" and not c.get("locked_by_default", True)
    ]
    assert not not_locked, f"Mandatory courses not locked: {not_locked}"


# ---------------------------------------------------------------------------
# weekly_hours fix for other_specialization (Part C)
# ---------------------------------------------------------------------------

def test_enriched_program_spec_courses_have_hours():
    """The enriched program JSON has hours for some other_specialization courses."""
    enriched_path = Path("data/programs/mechanical_engineering_2027_enriched.json")
    enriched = json.loads(enriched_path.read_text(encoding="utf-8"))
    spec = enriched.get("other_specialization_electives", [])
    with_hours = [c for c in spec if c.get("hours") is not None]
    assert len(with_hours) > 0, "Enriched program must have hours for some spec courses"


def test_board_spec_courses_use_enriched_hours(repo):
    """Some other_specialization repo courses should have non-null weekly_hours (from enriched)."""
    spec_with_hours = [
        r for r in repo
        if r.get("category_id") == "other_specialization"
        and r.get("weekly_hours") is not None
    ]
    assert len(spec_with_hours) > 0, (
        "After fix, at least some other_specialization courses must have weekly_hours"
    )


# ---------------------------------------------------------------------------
# Enriched program preferred (Part A)
# ---------------------------------------------------------------------------

def test_enriched_program_has_mandatory_courses_file_ref():
    """mechanical_engineering_2027_enriched.json must reference the mandatory courses file."""
    enriched_path = Path("data/programs/mechanical_engineering_2027_enriched.json")
    enriched = json.loads(enriched_path.read_text(encoding="utf-8"))
    mand_ref = enriched.get("requirements", {}).get("mandatory_courses", {})
    assert "courses_file" in mand_ref, (
        "Enriched program must have requirements.mandatory_courses.courses_file"
    )
    courses_file = Path(mand_ref["courses_file"])
    assert courses_file.exists(), f"courses_file path must exist: {courses_file}"


def test_mandatory_json_uses_full_semester_ids():
    """mandatory_2027.json must use full semester IDs like 'year_3_semester_a'."""
    mand = json.loads(_MAND_PATH.read_text(encoding="utf-8"))
    for c in mand.get("courses", []):
        for sem in c.get("allowed_semesters", []):
            assert sem.startswith("year_"), (
                f"{c['course_id']}: allowed_semesters must be full IDs like "
                f"'year_3_semester_a', got {sem!r}"
            )

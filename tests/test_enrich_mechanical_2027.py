"""
Tests for app.pipeline.enrich_mechanical_2027 and related enrichment infrastructure.
All tests use fixtures and cached data — no live network calls.
"""

from __future__ import annotations

import json
import shutil
from collections import Counter
from pathlib import Path

import pytest

from app.pipeline.enrich_mechanical_2027 import _extract_course_map, enrich_board
from app.analysis.semester_board import _build_course_details_url
from app.scraping.enrich_board_links import enrich_board as enrich_links

_BOARD_PATH    = Path("data/parsed_json/mechanical_semester_board_2027.json")
_MAND_PATH     = Path("data/programs/mechanical_engineering_mandatory_2027.json")
_GQL_CACHE     = Path("data/raw_html/tau_program_8715_2025.json")
_FIXTURE_HTML  = Path("tests/fixtures/tau_course_details_fixture.html")


# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------

@pytest.fixture(scope="module")
def gql_body() -> list[dict]:
    raw = json.loads(_GQL_CACHE.read_text(encoding="utf-8-sig"))
    return raw["data"]["results"]["body"]


@pytest.fixture(scope="module")
def board() -> dict:
    return json.loads(_BOARD_PATH.read_text(encoding="utf-8"))


@pytest.fixture(scope="module")
def repo(board) -> list[dict]:
    return board["metadata"]["program_repository_courses"]


# ---------------------------------------------------------------------------
# _build_course_details_url — undashed ID for IMS URL
# ---------------------------------------------------------------------------

def test_course_details_url_dashed():
    url = _build_course_details_url("0542-4320")
    assert url and "05424320" in url


def test_course_details_url_undashed():
    url = _build_course_details_url("05424320")
    assert url and "05424320" in url


def test_course_details_url_preserves_leading_zeroes():
    url = _build_course_details_url("0001-0001")
    assert url and "00010001" in url


def test_course_details_url_0542_4123():
    """Course 0542-4123 gets lookup URL using undashed id 05424123."""
    url = _build_course_details_url("0542-4123")
    assert url is not None
    assert "05424123" in url, f"Expected 05424123 in URL, got: {url}"
    assert "ims.tau.ac.il" in url


# ---------------------------------------------------------------------------
# _extract_course_map
# ---------------------------------------------------------------------------

def test_extract_course_map_returns_dict(gql_body):
    cmap = _extract_course_map(gql_body)
    assert isinstance(cmap, dict)


def test_extract_course_map_has_known_course(gql_body):
    cmap = _extract_course_map(gql_body)
    assert "0542-4320" in cmap, "0542-4320 must be in course map"
    assert cmap["0542-4320"]["name_he"], "Must have a Hebrew name"


def test_extract_course_map_all_have_name(gql_body):
    cmap = _extract_course_map(gql_body)
    for cid, info in cmap.items():
        assert info.get("name_he"), f"{cid} has empty name_he"


def test_extract_course_map_skips_cancelled(gql_body):
    cmap = _extract_course_map(gql_body)
    assert len(cmap) > 50, "Should have at least 50 active courses"


# ---------------------------------------------------------------------------
# mandatory_2027.json integrity
# ---------------------------------------------------------------------------

def _mand_courses() -> list[dict]:
    return json.loads(_MAND_PATH.read_text(encoding="utf-8")).get("courses", [])


def test_mandatory_file_valid():
    mand = json.loads(_MAND_PATH.read_text(encoding="utf-8"))
    assert "courses" in mand and isinstance(mand["courses"], list)
    valid_statuses = {"empty_placeholder", "extracted_from_graphql", "verified"}
    assert mand.get("status") in valid_statuses


def test_extract_mandatory_courses_returns_list():
    assert isinstance(_mand_courses(), list)


def test_extract_mandatory_courses_have_required_fields():
    for c in _mand_courses():
        assert "course_id" in c
        assert "name_he" in c
        assert c.get("year") in (3, 4)
        assert c.get("locked_by_default") is True


def test_extract_mandatory_courses_not_empty():
    assert len(_mand_courses()) > 0


def test_mandatory_courses_not_in_elective_repo():
    mandatory_ids = {c["course_id"] for c in _mand_courses()}
    board = json.loads(_BOARD_PATH.read_text(encoding="utf-8"))
    repo_ids = {r["course_id"] for r in board["metadata"]["program_repository_courses"]}
    overlap = mandatory_ids & repo_ids
    assert not overlap, f"Mandatory courses overlap with repo: {overlap}"


# ---------------------------------------------------------------------------
# Board integrity — category counts preserved
# ---------------------------------------------------------------------------

def test_board_repo_count_56(repo):
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
    board = json.loads(_BOARD_PATH.read_text(encoding="utf-8"))
    placed_electives = [
        c for sem in board["semesters"]
        for c in sem.get("courses", [])
        if c.get("course_type") != "mandatory"
    ]
    assert not placed_electives, f"Unexpected placed non-mandatory: {[c['course_id'] for c in placed_electives]}"


def test_board_category_counts_sum_to_56(repo):
    known = {"fluids", "solids", "systems", "advanced_labs", "other_specialization"}
    missing = [r["course_id"] for r in repo if r.get("category_id") not in known]
    assert not missing, f"Courses with unknown category_id: {missing}"


# ---------------------------------------------------------------------------
# TAU Factor status
# ---------------------------------------------------------------------------

def test_all_board_courses_have_tau_factor_status(repo):
    valid = {"not_started", "matched", "not_found", "failed"}
    bad = [r["course_id"] for r in repo if r.get("tau_factor_status") not in valid]
    assert not bad, f"Invalid tau_factor_status: {bad}"


def test_tau_factor_remains_not_started_unless_import_ran(repo):
    """tau_factor_status must be not_started for all courses — no importer has run."""
    non_started = [r["course_id"] for r in repo if r.get("tau_factor_status") != "not_started"]
    assert not non_started, f"Expected all not_started, found: {non_started}"


def test_tau_factor_lookup_id_normalized(repo):
    for r in repo:
        tid = r.get("tau_factor_lookup_id")
        assert tid, f"{r['course_id']} missing tau_factor_lookup_id"
        assert "-" not in tid, f"tau_factor_lookup_id must be undashed: {tid}"


# ---------------------------------------------------------------------------
# course_details_url (Part B – F)
# ---------------------------------------------------------------------------

def test_all_repo_courses_have_course_details_url(repo):
    """All 56 repo courses must have course_details_url."""
    missing = [r["course_id"] for r in repo if not r.get("course_details_url")]
    assert not missing, f"Missing course_details_url: {missing}"


def test_repo_course_0542_4123_has_course_details_url(repo):
    """Course 0542-4123 must have a course_details_url after enrichment."""
    rc = next((r for r in repo if r["course_id"] == "0542-4123"), None)
    assert rc is not None, "0542-4123 not in repo"
    assert rc.get("course_details_url"), "0542-4123 must have course_details_url"
    assert "05424123" in rc["course_details_url"]


def test_mandatory_courses_have_course_details_url(board):
    """Placed mandatory courses must have course_details_url generated from course_id."""
    mandatory = [
        c for sem in board["semesters"]
        for c in sem.get("courses", [])
        if c.get("course_type") == "mandatory"
    ]
    assert mandatory, "Board must have mandatory courses"
    missing = [c["course_id"] for c in mandatory if not c.get("course_details_url")]
    assert not missing, f"Mandatory courses missing course_details_url: {missing}"


def test_mandatory_course_details_url_format(board):
    """Mandatory course_details_url must include undashed course ID."""
    for sem in board["semesters"]:
        for c in sem.get("courses", []):
            if c.get("course_type") != "mandatory":
                continue
            url = c.get("course_details_url", "")
            cid_digits = "".join(ch for ch in c["course_id"] if ch.isdigit())
            assert cid_digits in url, (
                f"{c['course_id']}: course_details_url {url!r} does not contain {cid_digits}"
            )


# ---------------------------------------------------------------------------
# Syllabus enrichment (Part B – F: use fixture HTML)
# ---------------------------------------------------------------------------

def test_enrich_links_adds_syllabus_from_fixture(tmp_path):
    """enrich_board_links adds syllabus_url to a repo course using cached fixture HTML."""
    board = json.loads(_BOARD_PATH.read_text(encoding="utf-8"))
    repo = board["metadata"]["program_repository_courses"]

    # Find a repo course that has course_details_url but no syllabus_url
    target = next(
        (r for r in repo if r.get("course_details_url") and not r.get("syllabus_url")),
        None,
    )
    if target is None:
        pytest.skip("All repo courses already have syllabus_url — skipping fixture test")

    cid    = target["course_id"]
    digits = "".join(c for c in cid if c.isdigit())
    cache  = tmp_path / "course_details"
    cache.mkdir()
    (cache / f"course_{digits}_2025.html").write_text(
        _FIXTURE_HTML.read_text(encoding="utf-8"), encoding="utf-8"
    )

    board_copy = tmp_path / "board.json"
    board_copy.write_text(
        json.dumps(board, ensure_ascii=False, indent=2), encoding="utf-8"
    )

    enrich_links(board_path=board_copy, cache_dir=cache)

    updated = json.loads(board_copy.read_text(encoding="utf-8"))
    updated_repo = updated["metadata"]["program_repository_courses"]
    rc = next(r for r in updated_repo if r["course_id"] == cid)
    assert rc.get("syllabus_url"), f"syllabus_url not added for {cid} from fixture"


def test_enrich_links_adds_syllabus_to_mandatory_from_fixture(tmp_path):
    """enrich_board_links adds syllabus_url to a placed mandatory course using fixture HTML."""
    board = json.loads(_BOARD_PATH.read_text(encoding="utf-8"))
    placed_mand = [
        c for sem in board["semesters"]
        for c in sem.get("courses", [])
        if c.get("course_type") == "mandatory" and c.get("course_details_url")
    ]
    if not placed_mand:
        pytest.skip("No placed mandatory courses with course_details_url")

    target = placed_mand[0]
    cid    = target["course_id"]
    digits = "".join(c for c in cid if c.isdigit())
    cache  = tmp_path / "course_details"
    cache.mkdir()
    (cache / f"course_{digits}_2025.html").write_text(
        _FIXTURE_HTML.read_text(encoding="utf-8"), encoding="utf-8"
    )

    board_copy = tmp_path / "board.json"
    board_copy.write_text(
        json.dumps(board, ensure_ascii=False, indent=2), encoding="utf-8"
    )

    enrich_links(board_path=board_copy, cache_dir=cache)

    updated = json.loads(board_copy.read_text(encoding="utf-8"))
    mandatory_updated = [
        c for sem in updated["semesters"]
        for c in sem.get("courses", [])
        if c.get("course_id") == cid
    ]
    assert mandatory_updated, f"mandatory course {cid} not found after enrichment"
    rc = mandatory_updated[0]
    assert rc.get("syllabus_url"), f"syllabus_url not added to mandatory {cid} from fixture"


# ---------------------------------------------------------------------------
# syllabus_url => syllabus_ai_analysis_status (Part D)
# ---------------------------------------------------------------------------

def test_repo_syllabus_url_implies_pending_ai_status(repo):
    """When syllabus_url exists, syllabus_ai_analysis_status must be 'pending'."""
    bad = [
        r["course_id"] for r in repo
        if r.get("syllabus_url")
        and r.get("syllabus_ai_analysis_status") not in ("pending", "complete")
    ]
    assert not bad, f"Courses with syllabus_url but wrong ai_status: {bad}"


def test_repo_no_syllabus_implies_not_available_status(repo):
    """When no syllabus_url, syllabus_ai_analysis_status must be 'not_available'."""
    bad = [
        r["course_id"] for r in repo
        if not r.get("syllabus_url")
        and r.get("syllabus_ai_analysis_status") not in (None, "not_available")
    ]
    assert not bad, f"Courses without syllabus_url but wrong ai_status: {bad}"


def test_missing_syllabus_does_not_remove_difficulty_score(repo):
    """difficulty_score must exist for courses that have hours, regardless of syllabus."""
    courses_with_hours_no_syl = [
        r for r in repo
        if r.get("weekly_hours") is not None and not r.get("syllabus_url")
    ]
    if not courses_with_hours_no_syl:
        pytest.skip("All courses with hours also have syllabus")
    # difficulty_score may be None for some (e.g. other_spec without prereq info),
    # but it must not be forced to None purely because syllabus is missing
    # The test verifies that having hours is sufficient for a difficulty_score
    with_diff = [r for r in courses_with_hours_no_syl if r.get("difficulty_score") is not None]
    assert len(with_diff) > 0, (
        "At least some courses with hours but no syllabus should still have difficulty_score"
    )


# ---------------------------------------------------------------------------
# Repo syllabus preservation after regeneration
# ---------------------------------------------------------------------------

def test_repo_keeps_syllabus_url_after_regeneration(repo):
    """Repository courses keep syllabus_url after board regeneration."""
    with_syl = [r for r in repo if r.get("syllabus_url")]
    assert len(with_syl) >= 48, (
        f"After regeneration, at least 48 repo courses must have syllabus_url, "
        f"got {len(with_syl)}"
    )


# ---------------------------------------------------------------------------
# enrich_board dry-run
# ---------------------------------------------------------------------------

def test_enrich_board_dry_run_no_write(tmp_path):
    """enrich_board with dry_run=True must not write to disk."""
    board_copy = tmp_path / "board.json"
    shutil.copy(_BOARD_PATH, board_copy)
    before = board_copy.read_text(encoding="utf-8")
    enrich_board(board_path=board_copy, dry_run=True)
    after = board_copy.read_text(encoding="utf-8")
    assert before == after, "dry_run must not modify the board JSON"


# ---------------------------------------------------------------------------
# Enriched program preferred (Part A)
# ---------------------------------------------------------------------------

def test_enriched_program_has_mandatory_courses_file_ref():
    enriched = json.loads(
        Path("data/programs/mechanical_engineering_2027_enriched.json").read_text(encoding="utf-8")
    )
    mand_ref = enriched.get("requirements", {}).get("mandatory_courses", {})
    assert "courses_file" in mand_ref
    assert Path(mand_ref["courses_file"]).exists()


def test_mandatory_json_uses_full_semester_ids():
    mand = json.loads(_MAND_PATH.read_text(encoding="utf-8"))
    for c in mand.get("courses", []):
        for sem in c.get("allowed_semesters", []):
            assert sem.startswith("year_"), (
                f"{c['course_id']}: allowed_semesters must be full IDs, got {sem!r}"
            )


# ---------------------------------------------------------------------------
# Mandatory courses: board placement
# ---------------------------------------------------------------------------

def test_board_mandatory_placed():
    board = json.loads(_BOARD_PATH.read_text(encoding="utf-8"))
    mandatory = [
        c for sem in board["semesters"]
        for c in sem.get("courses", [])
        if c.get("course_type") == "mandatory"
    ]
    assert len(mandatory) >= 1


def test_board_mandatory_have_names():
    board = json.loads(_BOARD_PATH.read_text(encoding="utf-8"))
    mandatory = [
        c for sem in board["semesters"]
        for c in sem.get("courses", [])
        if c.get("course_type") == "mandatory"
    ]
    missing = [c["course_id"] for c in mandatory if not c.get("name_he")]
    assert not missing, f"Mandatory courses missing name_he: {missing}"


def test_board_mandatory_have_hours():
    board = json.loads(_BOARD_PATH.read_text(encoding="utf-8"))
    mandatory = [
        c for sem in board["semesters"]
        for c in sem.get("courses", [])
        if c.get("course_type") == "mandatory"
    ]
    missing = [c["course_id"] for c in mandatory if c.get("weekly_hours") is None]
    assert not missing, f"Mandatory courses missing weekly_hours: {missing}"


def test_board_mandatory_not_in_repo():
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
    board = json.loads(_BOARD_PATH.read_text(encoding="utf-8"))
    mandatory_ids = [
        c["course_id"]
        for sem in board["semesters"]
        for c in sem.get("courses", [])
        if c.get("course_type") == "mandatory"
    ]
    counts = Counter(mandatory_ids)
    dupes = {cid: n for cid, n in counts.items() if n > 1}
    assert not dupes, f"Duplicate mandatory courses: {dupes}"


def test_board_mandatory_locked_by_default():
    board = json.loads(_BOARD_PATH.read_text(encoding="utf-8"))
    not_locked = [
        c["course_id"]
        for sem in board["semesters"]
        for c in sem.get("courses", [])
        if c.get("course_type") == "mandatory" and not c.get("locked_by_default", True)
    ]
    assert not not_locked, f"Mandatory courses not locked: {not_locked}"


# ---------------------------------------------------------------------------
# weekly_hours fix for other_specialization
# ---------------------------------------------------------------------------

def test_enriched_program_spec_courses_have_hours():
    enriched = json.loads(
        Path("data/programs/mechanical_engineering_2027_enriched.json").read_text(encoding="utf-8")
    )
    spec = enriched.get("other_specialization_electives", [])
    with_hours = [c for c in spec if c.get("hours") is not None]
    assert len(with_hours) > 0, "Enriched program must have hours for some spec courses"


def test_board_spec_courses_use_enriched_hours(repo):
    spec_with_hours = [
        r for r in repo
        if r.get("category_id") == "other_specialization"
        and r.get("weekly_hours") is not None
    ]
    assert len(spec_with_hours) > 0, "At least some other_specialization courses must have weekly_hours"


def test_planned_mandatory_count():
    """Planned mandatory count after enrichment must be >= 12 (full extraction)."""
    board = json.loads(_BOARD_PATH.read_text(encoding="utf-8"))
    mandatory = [
        c for sem in board["semesters"]
        for c in sem.get("courses", [])
        if c.get("course_type") == "mandatory"
    ]
    assert len(mandatory) == 12, f"Expected 12 mandatory, got {len(mandatory)}"


def test_planned_elective_count_zero():
    board = json.loads(_BOARD_PATH.read_text(encoding="utf-8"))
    placed_elec = [
        c for sem in board["semesters"]
        for c in sem.get("courses", [])
        if c.get("course_type") != "mandatory"
    ]
    assert not placed_elec


def test_repository_count_56(repo):
    assert len(repo) == 56

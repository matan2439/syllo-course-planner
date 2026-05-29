"""
Tests for course-details URL extraction and modal data model (Tasks B-F).

Covers:
- build_course_details_url in tau_program_parser
- _build_course_details_url in semester_board
- board JSON has course_details_url / syllabus_url / official_details_available
- enrich_pdf_program preserves PDF categories when adding URLs
- board JSON never replaces known names with blank
- Parser extracts course_details_url from _parse_kurs
"""

from __future__ import annotations

import json
from pathlib import Path

import pytest

from app.parsing.tau_program_parser import (
    build_course_details_url,
    _parse_kurs,
    parse_program_body,
    enrich_pdf_program,
)
from app.analysis.semester_board import (
    _build_course_details_url as _sb_build_url,
    _build_program_repository_courses,
)

_PDF_PATH  = Path("data/programs/mechanical_engineering_2027_from_pdf.json")
_BOARD_PATH = Path("data/parsed_json/mechanical_semester_board_2027.json")
_FIXTURE   = Path("tests/fixtures/tau_program_fixture.json")


# ---------------------------------------------------------------------------
# build_course_details_url (parser module)
# ---------------------------------------------------------------------------

def test_build_course_details_url_with_hyphen():
    url = build_course_details_url("0542-4120", 2025)
    assert url == "https://ims.tau.ac.il/tal/kr/search_l.aspx?course_num=05424120&year=2025"


def test_build_course_details_url_digits_only():
    url = build_course_details_url("05424120", 2025)
    assert url == "https://ims.tau.ac.il/tal/kr/search_l.aspx?course_num=05424120&year=2025"


def test_build_course_details_url_default_year():
    url = build_course_details_url("0542-4120")
    assert "year=2025" in url


def test_build_course_details_url_short_id_returns_none():
    """Fewer than 7 digits → None (not a valid course ID)."""
    assert build_course_details_url("123") is None


def test_build_course_details_url_different_year():
    url = build_course_details_url("0512-1204", 2026)
    assert "year=2026" in url
    assert "05121204" in url


# ---------------------------------------------------------------------------
# _parse_kurs includes course_details_url
# ---------------------------------------------------------------------------

def test_parse_kurs_includes_course_details_url():
    kurs = {
        "kursshow": "0542-4120",
        "kursid":   "05424120",
        "teurkurs": "תרמודינמיקה (2)",
        "shaotuni": "4",
        "mishkal":  "4",
        "drishotkedem": "0",
        "drishotmakbilot": "0",
    }
    result = _parse_kurs(kurs, shana=2025)
    assert result["course_details_url"] is not None
    assert "05424120" in result["course_details_url"]
    assert "year=2025" in result["course_details_url"]


def test_parse_kurs_detail_source_type_is_tau_program():
    kurs = {"kursshow": "0542-4120", "teurkurs": "test", "shaotuni": "4",
            "mishkal": "4", "drishotkedem": "0", "drishotmakbilot": "0"}
    result = _parse_kurs(kurs)
    assert result["detail_source_type"] == "tau_program_expanded_row"


# ---------------------------------------------------------------------------
# parse_program_body — courses from fixture have course_details_url
# ---------------------------------------------------------------------------

@pytest.fixture(scope="module")
def fixture_data():
    with open(_FIXTURE, encoding="utf-8") as f:
        return json.load(f)


@pytest.fixture(scope="module")
def program_data(fixture_data):
    return parse_program_body(fixture_data["data"]["results"]["body"])


def test_mandatory_courses_have_details_url(program_data):
    for c in program_data["mandatory_courses"]:
        assert c.get("course_details_url"), f"{c['course_id']} missing course_details_url"


def test_elective_core_courses_have_details_url(program_data):
    for c in program_data["elective_core_courses"]:
        assert c.get("course_details_url"), f"{c['course_id']} missing course_details_url"


# ---------------------------------------------------------------------------
# _build_program_repository_courses — URL enrichment
# ---------------------------------------------------------------------------

@pytest.fixture(scope="module")
def pdf_prog():
    return json.loads(_PDF_PATH.read_text(encoding="utf-8"))


@pytest.fixture(scope="module")
def repo(pdf_prog):
    return _build_program_repository_courses(pdf_prog)


def test_all_56_have_course_details_url(repo):
    missing = [r["course_id"] for r in repo if not r.get("course_details_url")]
    assert not missing, f"Missing course_details_url: {missing}"


def test_all_56_official_details_available(repo):
    not_set = [r["course_id"] for r in repo if not r.get("official_details_available")]
    assert not not_set, f"official_details_available not set: {not_set}"


def test_course_details_url_format(repo):
    for rc in repo:
        url = rc.get("course_details_url", "")
        assert url.startswith("https://ims.tau.ac.il/tal/kr/search_l.aspx"), \
            f"{rc['course_id']}: unexpected URL format: {url}"
        assert "course_num=" in url
        assert "year=2025" in url


def test_elective_courses_detail_source_is_tau_program(repo, pdf_prog):
    elec_ids = {e["course_id"] for e in pdf_prog.get("elective_courses", [])}
    for rc in repo:
        if rc["course_id"] in elec_ids:
            src = rc.get("detail_source_type")
            assert src in ("tau_program_expanded_row", "syllabus"), \
                f"{rc['course_id']}: unexpected detail_source_type={src}"


def test_known_names_not_replaced_with_blank(repo, pdf_prog):
    """Enrichment must never replace a non-null PDF name with null/empty."""
    pdf_names = {e["course_id"]: e["name_he"] for e in pdf_prog.get("elective_courses", []) if e.get("name_he")}
    repo_map = {r["course_id"]: r for r in repo}
    for cid, expected in pdf_names.items():
        if cid in repo_map:
            assert repo_map[cid]["name_he"] == expected, \
                f"{cid}: name was replaced — expected '{expected}', got '{repo_map[cid]['name_he']}'"


def test_pdf_categories_preserved_after_enrichment(repo, pdf_prog):
    """category_id from PDF must not be overwritten during enrichment."""
    pdf_cats = {e["course_id"]: e["category_id"] for e in pdf_prog.get("elective_courses", []) if e.get("category_id")}
    repo_map = {r["course_id"]: r for r in repo}
    for cid, expected_cat in pdf_cats.items():
        if cid in repo_map:
            assert repo_map[cid]["category_id"] == expected_cat, \
                f"{cid}: category overwritten — expected '{expected_cat}', got '{repo_map[cid]['category_id']}'"


# ---------------------------------------------------------------------------
# Board JSON (regenerated) — has URL data
# ---------------------------------------------------------------------------

@pytest.fixture(scope="module")
def board():
    return json.loads(_BOARD_PATH.read_text(encoding="utf-8"))


@pytest.fixture(scope="module")
def board_repo(board):
    return board["metadata"]["program_repository_courses"]


def test_board_json_all_have_course_details_url(board_repo):
    missing = [r["course_id"] for r in board_repo if not r.get("course_details_url")]
    assert not missing, f"Board JSON missing course_details_url: {missing}"


def test_board_json_has_some_syllabus_urls(board_repo):
    """At least one course in the board repo should have a syllabus_url from DB."""
    with_syllabus = [r for r in board_repo if r.get("syllabus_url")]
    assert with_syllabus, "Expected some courses with syllabus_url from DB"


def test_board_json_syllabus_url_format(board_repo):
    """Syllabus URLs from DB should start with ims.tau.ac.il."""
    for r in board_repo:
        syl = r.get("syllabus_url")
        if syl:
            assert "tau.ac.il" in syl, f"Unexpected syllabus_url: {syl}"


def test_board_json_planned_electives_still_zero(board):
    placed_elec = [
        c for sem in board["semesters"]
        for c in sem.get("courses", [])
        if c.get("course_type") != "mandatory"
    ]
    assert not placed_elec, f"Non-mandatory courses must not be auto-placed: {[c['course_id'] for c in placed_elec]}"


# ---------------------------------------------------------------------------
# enrich_pdf_program — URL data preserved, categories unchanged
# ---------------------------------------------------------------------------

def test_enrich_pdf_program_preserves_category_when_url_added():
    """Adding course_details_url via enrichment must not change category_id."""
    pdf_prog = {
        "program_id": "test",
        "elective_courses": [
            {"course_id": "0542-4120", "name_he": "תרמודינמיקה (2)", "hours": 4,
             "category_id": "fluids", "prerequisites": []},
        ],
        "other_specialization_electives": [],
    }
    page_d = {
        "mandatory_courses": [],
        "elective_core_courses": [
            {"course_id": "0542-4120", "name_he": "שם מדף", "weekly_hours": 4.0,
             "category_id": "systems",  # DIFFERENT — must not overwrite
             "course_details_url": "https://ims.tau.ac.il/tal/kr/search_l.aspx?course_num=05424120&year=2025"},
        ],
        "specialization_courses": [],
    }
    enriched, _ = enrich_pdf_program(pdf_prog, page_d)
    c = enriched["elective_courses"][0]
    assert c["category_id"] == "fluids", "category_id must not be overwritten by enrichment"
    assert c["name_he"] == "תרמודינמיקה (2)", "Known PDF name must not be replaced"


def test_course_with_details_url_shows_official_data_available():
    """A course that has course_details_url should be considered to have official data."""
    # This is a data-model test: official_details_available=True when URL is present
    prog = json.loads(_PDF_PATH.read_text(encoding="utf-8"))
    repo = _build_program_repository_courses(prog)
    for rc in repo:
        assert rc.get("official_details_available"), \
            f"{rc['course_id']}: official_details_available must be True (has course_details_url)"

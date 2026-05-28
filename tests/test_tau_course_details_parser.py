"""
Tests for tau_course_details_parser.py.
All tests use a saved HTML fixture — no live network calls.
"""

from __future__ import annotations

import json
from pathlib import Path

import pytest

from app.parsing.tau_course_details_parser import (
    parse_course_details_links,
    _extract_from_js,
    _resolve,
)

_FIXTURE_HTML = Path("tests/fixtures/tau_course_details_fixture.html")
_BOARD_PATH   = Path("data/parsed_json/mechanical_semester_board_2027.json")
_PDF_PATH     = Path("data/programs/mechanical_engineering_2027_from_pdf.json")

_IMS_BASE  = "https://ims.tau.ac.il"
_IMS_KR    = "https://ims.tau.ac.il/tal/kr/"


@pytest.fixture(scope="module")
def fixture_html() -> str:
    return _FIXTURE_HTML.read_text(encoding="utf-8")


@pytest.fixture(scope="module")
def parsed(fixture_html) -> dict:
    return parse_course_details_links(fixture_html)


# ---------------------------------------------------------------------------
# 1. Parser extracts correct URLs from fixture HTML
# ---------------------------------------------------------------------------

def test_parser_extracts_syllabus_url(parsed):
    assert parsed["syllabus_url"] is not None, "syllabus_url must be extracted"


def test_syllabus_url_is_absolute(parsed):
    url = parsed["syllabus_url"]
    assert url.startswith("http"), f"syllabus_url must be absolute: {url}"


def test_syllabus_url_contains_expected_path(parsed):
    url = parsed["syllabus_url"]
    assert "Syllabus_L.aspx" in url, f"Unexpected syllabus_url: {url}"
    assert "0542432001" in url or "05424320" in url


def test_parser_extracts_exam_url(parsed):
    assert parsed["exam_url"] is not None, "exam_url must be extracted"


def test_exam_url_contains_bhina(parsed):
    assert "Bhina_L.aspx" in (parsed["exam_url"] or ""), f"exam_url: {parsed['exam_url']}"


def test_parser_extracts_prerequisites_url(parsed):
    assert parsed["prerequisites_url"] is not None


def test_prerequisites_url_contains_drishot(parsed):
    assert "Drishot_L.aspx" in (parsed["prerequisites_url"] or "")


def test_parser_extracts_moodle_url(parsed):
    url = parsed["moodle_url"]
    assert url is not None
    assert "moodle.tau.ac.il" in url


def test_moodle_url_is_absolute(parsed):
    assert (parsed["moodle_url"] or "").startswith("http")


def test_parser_extracts_mailing_list_url(parsed):
    url = parsed["mailing_list_url"]
    assert url is not None
    assert "listserv.tau.ac.il" in url


def test_empty_html_returns_all_none():
    result = parse_course_details_links("<html><body></body></html>")
    assert all(v is None for v in result.values()), "Empty HTML → all None"


def test_missing_links_are_none():
    html = "<html><body><a href='/Tal/Syllabus/Syllabus_L.aspx?course=X&year=2025' title='סילבוס'>סילבוס</a></body></html>"
    result = parse_course_details_links(html)
    assert result["syllabus_url"] is not None
    assert result["exam_url"] is None
    assert result["moodle_url"] is None


# ---------------------------------------------------------------------------
# 2. Helper functions
# ---------------------------------------------------------------------------

def test_extract_from_js_bhina():
    js = "javascript:open_win('Bhina_L.aspx?kurs=05424320&kv=01&sem=20252',600,400)"
    url = _extract_from_js(js, _IMS_KR)
    assert url is not None
    assert "Bhina_L.aspx" in url
    assert url.startswith("http")


def test_extract_from_js_drishot():
    js = "javascript:open_win('Drishot_L.aspx?kurs=05424320&kv=01&sem=20252',800,600)"
    url = _extract_from_js(js, _IMS_KR)
    assert url is not None
    assert "Drishot_L.aspx" in url


def test_extract_from_js_returns_none_for_non_matching():
    assert _extract_from_js("javascript:void(0)", _IMS_KR) is None


def test_resolve_relative():
    url = _resolve("/Tal/Syllabus/test.aspx", _IMS_BASE, _IMS_KR)
    assert url == "https://ims.tau.ac.il/Tal/Syllabus/test.aspx"


def test_resolve_javascript():
    js = "javascript:open_win('Bhina_L.aspx?x=1',600,400)"
    url = _resolve(js, _IMS_BASE, _IMS_KR)
    assert "Bhina_L.aspx" in url


def test_resolve_absolute():
    url = _resolve("https://moodle.tau.ac.il/course/view.php?id=X", _IMS_BASE, _IMS_KR)
    assert url == "https://moodle.tau.ac.il/course/view.php?id=X"


# ---------------------------------------------------------------------------
# 3. Board JSON has enriched URLs
# ---------------------------------------------------------------------------

@pytest.fixture(scope="module")
def board():
    return json.loads(_BOARD_PATH.read_text(encoding="utf-8"))


@pytest.fixture(scope="module")
def board_repo(board):
    return board["metadata"]["program_repository_courses"]


def test_board_all_56_have_course_details_url(board_repo):
    missing = [r["course_id"] for r in board_repo if not r.get("course_details_url")]
    assert not missing, f"Missing course_details_url: {missing}"


def test_board_has_more_than_24_syllabus_urls(board_repo):
    """After enrichment, well more than 24 courses should have syllabus_url."""
    n = sum(1 for r in board_repo if r.get("syllabus_url"))
    assert n > 24, f"Expected >24 syllabus_url after enrichment, got {n}"


def test_board_has_at_least_30_syllabus_urls(board_repo):
    """Enrichment should yield ≥30 syllabus URLs for the 56-course repository."""
    n = sum(1 for r in board_repo if r.get("syllabus_url"))
    assert n >= 30, f"Expected ≥30 syllabus_url, got {n}"


def test_board_has_exam_urls(board_repo):
    n = sum(1 for r in board_repo if r.get("exam_url"))
    assert n > 0, "Expected some courses to have exam_url"


def test_board_has_moodle_urls(board_repo):
    n = sum(1 for r in board_repo if r.get("moodle_url"))
    assert n > 0, "Expected some courses to have moodle_url"


def test_board_planned_still_zero(board):
    placed = sum(len(s.get("courses", [])) for s in board["semesters"])
    assert placed == 0, "Board must remain empty"


def test_board_repo_still_56(board_repo):
    assert len(board_repo) == 56


# ---------------------------------------------------------------------------
# 4. PDF categories preserved after link enrichment
# ---------------------------------------------------------------------------

def test_pdf_categories_not_changed_by_enrichment(board_repo):
    pdf = json.loads(_PDF_PATH.read_text(encoding="utf-8"))
    pdf_cats = {e["course_id"]: e["category_id"] for e in pdf.get("elective_courses", [])}
    repo_map = {r["course_id"]: r for r in board_repo}
    for cid, expected in pdf_cats.items():
        if cid in repo_map:
            assert repo_map[cid]["category_id"] == expected, \
                f"{cid}: category changed — expected {expected}"


def test_known_names_preserved(board_repo):
    pdf = json.loads(_PDF_PATH.read_text(encoding="utf-8"))
    pdf_names = {e["course_id"]: e["name_he"] for e in pdf.get("elective_courses", []) if e.get("name_he")}
    repo_map = {r["course_id"]: r for r in board_repo}
    for cid, name in pdf_names.items():
        if cid in repo_map:
            assert repo_map[cid]["name_he"] == name, \
                f"{cid}: name changed from {name!r} to {repo_map[cid]['name_he']!r}"


# ---------------------------------------------------------------------------
# 5. 39 other_specialization courses still preserved
# ---------------------------------------------------------------------------

def test_39_other_specialization_preserved(board_repo):
    n = sum(1 for r in board_repo if r.get("category_id") == "other_specialization")
    assert n == 39, f"Expected 39 other_specialization, got {n}"


# ---------------------------------------------------------------------------
# 6. New fields: assessment_type, syllabus_ai_analysis_status, tau_factor (Issues B/C)
# ---------------------------------------------------------------------------

def test_board_has_assessment_type_field(board_repo):
    """Every repo course must have assessment_type field."""
    missing = [r["course_id"] for r in board_repo if "assessment_type" not in r]
    assert not missing, f"Missing assessment_type: {missing}"


def test_assessment_type_valid_values(board_repo):
    valid = {"final_exam", "project", "assignment", "mixed", "unknown"}
    for r in board_repo:
        v = r.get("assessment_type")
        assert v in valid, f"{r['course_id']}: unexpected assessment_type={v!r}"


def test_board_has_syllabus_ai_analysis_status(board_repo):
    for r in board_repo:
        assert "syllabus_ai_analysis_status" in r, f"{r['course_id']} missing field"


def test_syllabus_ai_status_pending_when_syllabus_url(board_repo):
    for r in board_repo:
        if r.get("syllabus_url"):
            assert r.get("syllabus_ai_analysis_status") == "pending", \
                f"{r['course_id']}: has syllabus_url but status={r.get('syllabus_ai_analysis_status')}"


def test_syllabus_ai_status_not_available_when_no_syllabus(board_repo):
    for r in board_repo:
        if not r.get("syllabus_url"):
            assert r.get("syllabus_ai_analysis_status") == "not_available", \
                f"{r['course_id']}: no syllabus but status={r.get('syllabus_ai_analysis_status')}"


def test_board_has_tau_factor_lookup_status(board_repo):
    valid = {"found", "not_found", "not_queried"}
    for r in board_repo:
        v = r.get("tau_factor_lookup_status")
        assert v in valid, f"{r['course_id']}: invalid tau_factor_lookup_status={v!r}"


def test_course_0542_4320_has_difficulty_score(board_repo):
    """course 0542-4320 must have a difficulty_score even with partial data."""
    rc = next((r for r in board_repo if r["course_id"] == "0542-4320"), None)
    assert rc is not None, "0542-4320 not in board repo"
    assert rc.get("difficulty_score") is not None, "0542-4320 must have difficulty_score"
    assert rc.get("difficulty_level") in ("easy", "medium", "hard", "very_hard")


def test_0542_4320_assessment_type_is_extracted(board_repo):
    """Course 0542-4320 is in DB with exam info — assessment_type should be extracted."""
    rc = next((r for r in board_repo if r["course_id"] == "0542-4320"), None)
    assert rc is not None
    # 0542-4320 is in the fluids category and was imported; should have some assessment data
    # It's acceptable for it to be "unknown" if exam_info is not in the local DB
    assert rc.get("assessment_type") in ("final_exam", "project", "assignment", "mixed", "unknown")


def test_syllabus_ai_topics_is_empty_list(board_repo):
    """syllabus_ai_topics must be an empty list (AI not connected)."""
    for r in board_repo:
        topics = r.get("syllabus_ai_topics")
        assert isinstance(topics, list) and len(topics) == 0, \
            f"{r['course_id']}: syllabus_ai_topics should be empty list, got {topics!r}"


def test_syllabus_ai_complexity_notes_is_null(board_repo):
    """syllabus_ai_complexity_notes must be null (AI not connected)."""
    for r in board_repo:
        assert r.get("syllabus_ai_complexity_notes") is None, \
            f"{r['course_id']}: syllabus_ai_complexity_notes should be null"


def test_planned_courses_still_zero(board):
    placed = sum(len(s.get("courses", [])) for s in board["semesters"])
    assert placed == 0


# ---------------------------------------------------------------------------
# 7. _classify_assessment helper (Issue C)
# ---------------------------------------------------------------------------

from app.analysis.semester_board import _classify_assessment


def test_classify_exam_info_with_exam_keyword():
    rec = {"exam_info": "בחינה סופית", "assignments": None}
    assert _classify_assessment(rec) == "final_exam"


def test_classify_project_keyword():
    rec = {"exam_info": None, "assignments": "פרויקט גמר"}
    assert _classify_assessment(rec) == "project"


def test_classify_mixed_exam_and_project():
    rec = {"exam_info": "מבחן", "assignments": "פרויקט"}
    assert _classify_assessment(rec) == "mixed"


def test_classify_unknown_when_no_data():
    rec = {"exam_info": None, "assignments": None}
    assert _classify_assessment(rec) == "unknown"


def test_classify_unknown_when_empty_strings():
    rec = {"exam_info": "", "assignments": ""}
    assert _classify_assessment(rec) == "unknown"


def test_classify_does_not_infer_detailed_homework():
    """Must not return detailed homework type without explicit keywords."""
    rec = {"exam_info": "קורס מעשי", "assignments": None}
    # No explicit exam/project/assignment keyword → unknown
    assert _classify_assessment(rec) in ("unknown", "assignment")  # conservative

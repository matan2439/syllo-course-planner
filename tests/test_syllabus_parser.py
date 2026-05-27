import pytest
from pathlib import Path

from app.parsing.syllabus_parser import parse_syllabus, extract_prerequisite_ids

_SYLLABUS_01 = Path("data/raw_html/syllabus_03682157_2025_01.html")


# ── extract_prerequisite_ids ─────────────────────────────────────────────────

def test_prereq_plain_digits():
    assert extract_prerequisite_ids("(03681105)") == ["03681105"]

def test_prereq_with_hyphen():
    assert extract_prerequisite_ids("0368-1105") == ["03681105"]

def test_prereq_with_dot():
    assert extract_prerequisite_ids("0368.1105") == ["03681105"]

def test_prereq_multiple():
    ids = extract_prerequisite_ids("0368-1105 and 0368-1201")
    assert "03681105" in ids
    assert "03681201" in ids
    assert len(ids) == 2

def test_prereq_deduplicates():
    ids = extract_prerequisite_ids("03681105 and 0368-1105")
    assert ids == ["03681105"]

def test_prereq_empty_string():
    assert extract_prerequisite_ids("") == []

def test_prereq_no_match():
    assert extract_prerequisite_ids("אין דרישות קדם") == []

def test_prereq_ignores_short_numbers():
    assert extract_prerequisite_ids("chapter 12 and page 345") == []


# ── parse_syllabus — missing fields / edge cases ─────────────────────────────

def test_parse_returns_none_on_empty_html():
    assert parse_syllabus("<html><body></body></html>") is None

def test_parse_returns_none_on_no_structure():
    assert parse_syllabus("<html><body><p>hello</p></body></html>") is None

def test_parse_minimal_html_no_crash():
    html = """
    <html><body>
      <div class="data-table-cell">
        <small class="data-table-cell-label">מספר קורס</small>
        <span>0368-2157-01</span>
      </div>
    </body></html>
    """
    result = parse_syllabus(html)
    assert result is not None
    assert result.course_id == "0368-2157"
    assert result.credits is None
    assert result.lecture_hours is None
    assert result.tutorial_hours is None
    assert result.lab_hours is None
    assert result.prerequisite_course_ids == []
    assert result.topics == []

def test_parse_source_file_stored():
    html = """
    <html><body>
      <div class="data-table-cell">
        <small class="data-table-cell-label">מספר קורס</small>
        <span>0368-2157-01</span>
      </div>
    </body></html>
    """
    result = parse_syllabus(html, source_file="some/path/syllabus.html")
    assert result.source_file == "some/path/syllabus.html"

def test_parse_extracts_prereqs_from_cell():
    html = """
    <html><body>
      <div class="data-table-cell">
        <small class="data-table-cell-label">מספר קורס</small>
        <span>0368-2157-01</span>
      </div>
      <div class="data-table-cell">
        <small class="data-table-cell-label">קורסי קדם נדרשים</small>
        <span>מבוא (03681105) ועוד מבוא (03681201)</span>
      </div>
    </body></html>
    """
    result = parse_syllabus(html)
    assert result is not None
    assert "03681105" in result.prerequisite_course_ids
    assert "03681201" in result.prerequisite_course_ids

def test_parse_raw_text_excerpt_max_500_chars():
    long_desc = "א" * 600
    html = f"""
    <html><body>
      <div class="data-table-cell">
        <small class="data-table-cell-label">מספר קורס</small>
        <span>0368-2157-01</span>
      </div>
      <div id="div_dataToc"><p>{long_desc}</p></div>
    </body></html>
    """
    result = parse_syllabus(html)
    assert result is not None
    assert result.raw_text_excerpt is not None
    assert len(result.raw_text_excerpt) <= 500


# ── integration: real cached file ────────────────────────────────────────────

@pytest.fixture
def html_syllabus_01():
    if not _SYLLABUS_01.exists():
        pytest.skip(f"Cache file missing: {_SYLLABUS_01}")
    return _SYLLABUS_01.read_text(encoding="utf-8")


def test_real_course_id(html_syllabus_01):
    result = parse_syllabus(html_syllabus_01)
    assert result is not None
    assert result.course_id == "0368-2157"

def test_real_name_he(html_syllabus_01):
    result = parse_syllabus(html_syllabus_01)
    assert result.name_he == "תוכנה 1"

def test_real_lecture_hours(html_syllabus_01):
    result = parse_syllabus(html_syllabus_01)
    assert result.lecture_hours == 3.0

def test_real_prerequisite_ids(html_syllabus_01):
    result = parse_syllabus(html_syllabus_01)
    assert "03681105" in result.prerequisite_course_ids

def test_real_prerequisites_raw_text_not_empty(html_syllabus_01):
    result = parse_syllabus(html_syllabus_01)
    assert result.prerequisites_raw_text is not None
    assert len(result.prerequisites_raw_text) > 5

def test_real_description_not_empty(html_syllabus_01):
    result = parse_syllabus(html_syllabus_01)
    assert result.course_description is not None
    assert len(result.course_description) > 50

def test_real_raw_excerpt_within_limit(html_syllabus_01):
    result = parse_syllabus(html_syllabus_01)
    assert result.raw_text_excerpt is not None
    assert len(result.raw_text_excerpt) <= 500

def test_real_source_file_none_when_not_passed(html_syllabus_01):
    result = parse_syllabus(html_syllabus_01)
    assert result.source_file is None

import pytest
from pathlib import Path
from app.parsing.course_search_parser import parse_course_search_result

_CACHE = Path("data/raw_html")
_HTML_5001 = _CACHE / "course_03005001_2024.html"
_HTML_2157 = _CACHE / "course_03682157_2025.html"


# ── fixtures ────────────────────────────────────────────────────────────────

@pytest.fixture
def html_5001():
    if not _HTML_5001.exists():
        pytest.skip(f"Cache file missing: {_HTML_5001}")
    return _HTML_5001.read_text(encoding="utf-8")


@pytest.fixture
def html_2157():
    if not _HTML_2157.exists():
        pytest.skip(f"Cache file missing: {_HTML_2157}")
    return _HTML_2157.read_text(encoding="utf-8")


# ── empty / bad input ────────────────────────────────────────────────────────

def test_returns_none_on_empty_html():
    assert parse_course_search_result("<html><body></body></html>", 2024) is None


def test_returns_none_on_no_course_rows():
    assert parse_course_search_result("<html><body><table></table></body></html>", 2024) is None


# ── course 0300-5001 (First Aid, 2 groups) ───────────────────────────────────

def test_course_id_5001(html_5001):
    r = parse_course_search_result(html_5001, 2024)
    assert r is not None
    assert r.course_id == "0300-5001"


def test_course_name_5001(html_5001):
    r = parse_course_search_result(html_5001, 2024)
    assert r.name_hebrew == "עזרה ראשונה"


def test_faculty_5001(html_5001):
    r = parse_course_search_result(html_5001, 2024)
    assert r.faculty is not None
    assert "מדעים מדויקים" in r.faculty


def test_year_5001(html_5001):
    r = parse_course_search_result(html_5001, 2024)
    assert r.year == 2024


def test_group_count_5001(html_5001):
    r = parse_course_search_result(html_5001, 2024)
    assert len(r.groups) == 2


def test_group_numbers_5001(html_5001):
    r = parse_course_search_result(html_5001, 2024)
    nums = {g.group_num for g in r.groups}
    assert nums == {"01", "02"}


def test_both_semesters_5001(html_5001):
    r = parse_course_search_result(html_5001, 2024)
    sems = {g.semester for g in r.groups}
    assert "א'" in sems
    assert "ב'" in sems


def test_semesters_field_5001(html_5001):
    r = parse_course_search_result(html_5001, 2024)
    assert set(r.semesters) == {"א'", "ב'"}


def test_syllabus_urls_5001(html_5001):
    r = parse_course_search_result(html_5001, 2024)
    for g in r.groups:
        assert g.syllabus_url is not None
        assert "Syllabus" in g.syllabus_url
        assert g.syllabus_url.startswith("https://")


def test_moodle_urls_5001(html_5001):
    r = parse_course_search_result(html_5001, 2024)
    for g in r.groups:
        assert g.moodle_url is not None
        assert "moodle.tau.ac.il" in g.moodle_url


# ── course 0368-2157 (Software 1, 18 groups) ────────────────────────────────

def test_course_id_2157(html_2157):
    r = parse_course_search_result(html_2157, 2025)
    assert r is not None
    assert r.course_id == "0368-2157"


def test_course_name_2157(html_2157):
    r = parse_course_search_result(html_2157, 2025)
    assert r.name_hebrew == "תוכנה 1"


def test_faculty_2157(html_2157):
    r = parse_course_search_result(html_2157, 2025)
    assert r.faculty is not None
    assert "מדעי המחשב" in r.faculty


def test_department_2157(html_2157):
    r = parse_course_search_result(html_2157, 2025)
    assert r.department == "מדעי המחשב"


def test_year_2157(html_2157):
    r = parse_course_search_result(html_2157, 2025)
    assert r.year == 2025


def test_many_groups_2157(html_2157):
    r = parse_course_search_result(html_2157, 2025)
    assert len(r.groups) >= 15


def test_both_semesters_2157(html_2157):
    r = parse_course_search_result(html_2157, 2025)
    assert "א'" in r.semesters
    assert "ב'" in r.semesters


def test_lecture_groups_have_teachers_2157(html_2157):
    r = parse_course_search_result(html_2157, 2025)
    lecture_groups = [g for g in r.groups if g.teaching_method == "שיעור"]
    assert len(lecture_groups) > 0
    for g in lecture_groups:
        assert len(g.teachers) > 0, f"Group {g.group_num} has no teacher"


def test_all_groups_have_syllabus_2157(html_2157):
    r = parse_course_search_result(html_2157, 2025)
    for g in r.groups:
        assert g.syllabus_url is not None
        assert g.syllabus_url.startswith("https://")


def test_group_01_details_2157(html_2157):
    r = parse_course_search_result(html_2157, 2025)
    g01 = next((g for g in r.groups if g.group_num == "01"), None)
    assert g01 is not None
    assert g01.teaching_method == "שיעור"
    assert g01.semester == "א'"
    assert g01.time_slot == "12:00-15:00"
    assert any("קליינבורט" in t for t in g01.teachers)

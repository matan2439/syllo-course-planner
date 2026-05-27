import json
import pytest
from pathlib import Path

from app.parsing.merge_course_data import merge_course_and_syllabus, _collect_syllabus_links

# ── fixtures ─────────────────────────────────────────────────────────────────

COURSE = {
    "course_id": "0368-2157",
    "name_hebrew": "תוכנה 1",
    "name_english": None,
    "faculty": "מדעים מדויקים/מדעי המחשב",
    "department": "מדעי המחשב",
    "year": 2025,
    "semester": None,
    "semesters": ["א'", "ב'"],
    "groups": [
        {
            "group_num": "01",
            "teachers": ["ד\"ר קליינבורט מיכל"],
            "teaching_method": "שיעור",
            "semester": "א'",
            "building": "אודיטור' לב",
            "room": "009",
            "day": "ב",
            "time_slot": "12:00-15:00",
            "syllabus_url": "https://ims.tau.ac.il/Tal/Syllabus/Syllabus_L.aspx?course=0368215701&year=2025",
            "moodle_url": "https://moodle.tau.ac.il/course/view.php?id=0368215701",
        },
        {
            "group_num": "02",
            "teachers": ["מר שברין איליה"],
            "teaching_method": "תרגיל",
            "semester": "א'",
            "building": "שרייבר מתמטיקה",
            "room": "008",
            "day": "ד",
            "time_slot": "16:00-17:00",
            "syllabus_url": "https://ims.tau.ac.il/Tal/Syllabus/Syllabus_L.aspx?course=0368215702&year=2025",
            "moodle_url": "https://moodle.tau.ac.il/course/view.php?id=0368215702",
        },
    ],
}

SYLLABUS = {
    "course_id": "0368-2157",
    "name_he": "תוכנה 1",
    "name_en": None,
    "credits": None,
    "lecture_hours": 3.0,
    "tutorial_hours": None,
    "lab_hours": None,
    "prerequisites_raw_text": "מבוא מורחב למדעי המחשב (03681105)",
    "prerequisite_course_ids": ["03681105"],
    "course_description": "הקורס עוסק בהבנת מתודולוגיות שמסייעות בפיתוח תוכנה בקנה מידה גדול.",
    "topics": [],
    "assignments": "בחינה סופית",
    "exam_info": "בחינה סופית",
    "raw_text_excerpt": "הקורס עוסק",
    "source_file": "data/raw_html/syllabus_03682157_2025_01.html",
}


# ── identity ──────────────────────────────────────────────────────────────────

def test_course_id_from_course():
    r = merge_course_and_syllabus(COURSE, SYLLABUS)
    assert r["course_id"] == "0368-2157"

def test_course_id_fallback_to_syllabus():
    r = merge_course_and_syllabus({}, SYLLABUS)
    assert r["course_id"] == "0368-2157"

def test_course_id_unknown_when_both_missing():
    r = merge_course_and_syllabus({}, {})
    assert r["course_id"] == "unknown"


# ── name ─────────────────────────────────────────────────────────────────────

def test_name_he_from_course_name_hebrew():
    r = merge_course_and_syllabus(COURSE, {})
    assert r["name_he"] == "תוכנה 1"

def test_name_he_fallback_to_syllabus():
    r = merge_course_and_syllabus({}, SYLLABUS)
    assert r["name_he"] == "תוכנה 1"

def test_name_en_is_none_when_missing():
    r = merge_course_and_syllabus(COURSE, SYLLABUS)
    assert r["name_en"] is None


# ── structural fields (course-search primary) ─────────────────────────────────

def test_faculty_from_course():
    r = merge_course_and_syllabus(COURSE, SYLLABUS)
    assert r["faculty"] == "מדעים מדויקים/מדעי המחשב"

def test_department_from_course():
    r = merge_course_and_syllabus(COURSE, SYLLABUS)
    assert r["department"] == "מדעי המחשב"

def test_year_from_course():
    r = merge_course_and_syllabus(COURSE, SYLLABUS)
    assert r["year"] == 2025

def test_semester_first_from_semesters_list():
    r = merge_course_and_syllabus(COURSE, SYLLABUS)
    assert r["semester"] == "א'"

def test_groups_from_course():
    r = merge_course_and_syllabus(COURSE, SYLLABUS)
    assert len(r["groups"]) == 2
    assert r["groups"][0]["group_num"] == "01"

def test_groups_empty_when_course_missing():
    r = merge_course_and_syllabus({}, SYLLABUS)
    assert r["groups"] == []


# ── syllabus_links ────────────────────────────────────────────────────────────

def test_syllabus_links_extracted_from_groups():
    r = merge_course_and_syllabus(COURSE, SYLLABUS)
    assert len(r["syllabus_links"]) == 2
    assert all("Syllabus" in url for url in r["syllabus_links"])

def test_syllabus_links_deduplicated():
    course = {**COURSE, "groups": [
        {**COURSE["groups"][0]},
        {**COURSE["groups"][0]},  # duplicate
    ]}
    r = merge_course_and_syllabus(course, SYLLABUS)
    assert len(r["syllabus_links"]) == 1

def test_syllabus_links_empty_when_no_groups():
    r = merge_course_and_syllabus({}, SYLLABUS)
    assert r["syllabus_links"] == []

def test_collect_syllabus_links_skips_none():
    groups = [{"syllabus_url": None}, {"syllabus_url": "https://example.com/s"}]
    assert _collect_syllabus_links(groups) == ["https://example.com/s"]


# ── depth fields (syllabus primary) ──────────────────────────────────────────

def test_lecture_hours_from_syllabus():
    r = merge_course_and_syllabus(COURSE, SYLLABUS)
    assert r["lecture_hours"] == 3.0

def test_lecture_hours_fallback_to_course():
    course_with_hours = {**COURSE, "lecture_hours": 2.0}
    r = merge_course_and_syllabus(course_with_hours, {})
    assert r["lecture_hours"] == 2.0

def test_credits_none_when_missing():
    r = merge_course_and_syllabus(COURSE, SYLLABUS)
    assert r["credits"] is None

def test_credits_from_syllabus():
    syl = {**SYLLABUS, "credits": 3.0}
    r = merge_course_and_syllabus(COURSE, syl)
    assert r["credits"] == 3.0

def test_prerequisite_ids_from_syllabus():
    r = merge_course_and_syllabus(COURSE, SYLLABUS)
    assert r["prerequisite_course_ids"] == ["03681105"]

def test_prerequisite_ids_empty_when_syllabus_missing():
    r = merge_course_and_syllabus(COURSE, {})
    assert r["prerequisite_course_ids"] == []

def test_description_from_syllabus():
    r = merge_course_and_syllabus(COURSE, SYLLABUS)
    assert r["course_description"] is not None
    assert "תוכנה" in r["course_description"]

def test_assignments_from_syllabus():
    r = merge_course_and_syllabus(COURSE, SYLLABUS)
    assert r["assignments"] == "בחינה סופית"

def test_exam_info_from_syllabus():
    r = merge_course_and_syllabus(COURSE, SYLLABUS)
    assert r["exam_info"] == "בחינה סופית"


# ── source_files ──────────────────────────────────────────────────────────────

def test_source_files_syllabus_tracked():
    r = merge_course_and_syllabus(COURSE, SYLLABUS)
    assert "syllabus" in r["source_files"]
    assert "03682157" in r["source_files"]["syllabus"]

def test_source_files_no_course_key_when_missing():
    r = merge_course_and_syllabus(COURSE, SYLLABUS)
    assert "course_search" not in r["source_files"]  # COURSE fixture has no source_file

def test_source_files_both_tracked():
    course = {**COURSE, "source_file": "data/parsed_json/course_03682157_2025.json"}
    r = merge_course_and_syllabus(course, SYLLABUS)
    assert "course_search" in r["source_files"]
    assert "syllabus" in r["source_files"]


# ── robustness ────────────────────────────────────────────────────────────────

def test_no_crash_both_empty():
    r = merge_course_and_syllabus({}, {})
    assert r["course_id"] == "unknown"
    assert r["groups"] == []
    assert r["syllabus_links"] == []
    assert r["prerequisite_course_ids"] == []
    assert r["topics"] == []

def test_all_required_keys_present():
    r = merge_course_and_syllabus(COURSE, SYLLABUS)
    expected_keys = {
        "course_id", "name_he", "name_en", "faculty", "department",
        "year", "semester", "groups", "syllabus_links", "credits",
        "lecture_hours", "tutorial_hours", "lab_hours",
        "prerequisites_raw_text", "prerequisite_course_ids",
        "course_description", "topics", "assignments", "exam_info",
        "source_files",
    }
    assert expected_keys == set(r.keys())


# ── integration: real JSON files ──────────────────────────────────────────────

_COURSE_JSON   = Path("data/parsed_json/course_03682157_2025.json")
_SYLLABUS_JSON = Path("data/parsed_json/syllabus_03682157_2025_01.json")


@pytest.fixture
def real_course():
    if not _COURSE_JSON.exists():
        pytest.skip(f"Missing: {_COURSE_JSON}")
    return json.loads(_COURSE_JSON.read_text(encoding="utf-8"))


@pytest.fixture
def real_syllabus():
    if not _SYLLABUS_JSON.exists():
        pytest.skip(f"Missing: {_SYLLABUS_JSON}")
    return json.loads(_SYLLABUS_JSON.read_text(encoding="utf-8"))


def test_real_merge_course_id(real_course, real_syllabus):
    r = merge_course_and_syllabus(real_course, real_syllabus)
    assert r["course_id"] == "0368-2157"

def test_real_merge_groups_count(real_course, real_syllabus):
    r = merge_course_and_syllabus(real_course, real_syllabus)
    assert len(r["groups"]) == 19

def test_real_merge_syllabus_links_count(real_course, real_syllabus):
    r = merge_course_and_syllabus(real_course, real_syllabus)
    assert len(r["syllabus_links"]) == 19

def test_real_merge_lecture_hours(real_course, real_syllabus):
    r = merge_course_and_syllabus(real_course, real_syllabus)
    assert r["lecture_hours"] == 3.0

def test_real_merge_prereqs(real_course, real_syllabus):
    r = merge_course_and_syllabus(real_course, real_syllabus)
    assert "03681105" in r["prerequisite_course_ids"]

def test_real_merge_semesters(real_course, real_syllabus):
    r = merge_course_and_syllabus(real_course, real_syllabus)
    assert r["semester"] in ("א'", "ב'")

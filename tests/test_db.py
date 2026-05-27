import json
import pytest
from pathlib import Path

from app.database.db import (
    init_db,
    save_merged_course,
    get_course_by_id,
    get_course_display_name,
    get_course_display_names,
    list_courses,
    get_prerequisites,
    _split_time_slot,
    _normalize_course_id,
)

# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------

MERGED = {
    "course_id": "0368-2157",
    "name_he": "תוכנה 1",
    "name_en": None,
    "faculty": "מדעים מדויקים/מדעי המחשב",
    "department": "מדעי המחשב",
    "year": 2025,
    "semester": "א'",
    "credits": None,
    "lecture_hours": 3.0,
    "tutorial_hours": None,
    "lab_hours": None,
    "prerequisites_raw_text": "מבוא מורחב למדעי המחשב (03681105)",
    "prerequisite_course_ids": ["03681105"],
    "course_description": "הקורס עוסק בפיתוח תוכנה.",
    "topics": [],
    "assignments": "בחינה סופית",
    "exam_info": "בחינה סופית",
    "syllabus_links": [
        "https://ims.tau.ac.il/Tal/Syllabus/Syllabus_L.aspx?course=0368215701&year=2025",
        "https://ims.tau.ac.il/Tal/Syllabus/Syllabus_L.aspx?course=0368215702&year=2025",
    ],
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
            "moodle_url": None,
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
            "moodle_url": None,
        },
    ],
    "source_files": {
        "course_search": "data/parsed_json/course_03682157_2025.json",
        "syllabus": "data/raw_html/syllabus_03682157_2025_01.html",
    },
}


@pytest.fixture
def tmp_db(tmp_path):
    db = tmp_path / "test.sqlite"
    init_db(db)
    return db


# ---------------------------------------------------------------------------
# init_db
# ---------------------------------------------------------------------------

def test_init_creates_tables(tmp_path):
    db = tmp_path / "fresh.sqlite"
    assert not db.exists()
    init_db(db)
    assert db.exists()


def test_init_is_idempotent(tmp_path):
    db = tmp_path / "idem.sqlite"
    init_db(db)
    init_db(db)  # second call must not raise


# ---------------------------------------------------------------------------
# save_merged_course + get_course_by_id
# ---------------------------------------------------------------------------

def test_save_and_get_course_id(tmp_db):
    save_merged_course(MERGED, tmp_db)
    record = get_course_by_id("0368-2157", tmp_db)
    assert record is not None
    assert record["course_id"] == "0368-2157"


def test_get_by_digits_normalizes(tmp_db):
    save_merged_course(MERGED, tmp_db)
    record = get_course_by_id("03682157", tmp_db)
    assert record is not None
    assert record["course_id"] == "0368-2157"


def test_get_returns_none_for_missing(tmp_db):
    assert get_course_by_id("9999-9999", tmp_db) is None


def test_save_groups_count(tmp_db):
    save_merged_course(MERGED, tmp_db)
    record = get_course_by_id("0368-2157", tmp_db)
    assert len(record["groups"]) == 2


def test_save_group_lecturer_joined(tmp_db):
    save_merged_course(MERGED, tmp_db)
    record = get_course_by_id("0368-2157", tmp_db)
    g01 = next(g for g in record["groups"] if g["group_number"] == "01")
    assert "קליינבורט" in g01["lecturer"]


def test_save_group_time_split(tmp_db):
    save_merged_course(MERGED, tmp_db)
    record = get_course_by_id("0368-2157", tmp_db)
    g01 = next(g for g in record["groups"] if g["group_number"] == "01")
    assert g01["start_time"] == "12:00"
    assert g01["end_time"] == "15:00"


def test_save_prerequisites(tmp_db):
    save_merged_course(MERGED, tmp_db)
    record = get_course_by_id("0368-2157", tmp_db)
    assert "03681105" in record["prerequisite_course_ids"]


def test_save_syllabus_links_roundtrip(tmp_db):
    save_merged_course(MERGED, tmp_db)
    record = get_course_by_id("0368-2157", tmp_db)
    assert isinstance(record["syllabus_links"], list)
    assert len(record["syllabus_links"]) == 2


def test_save_topics_roundtrip(tmp_db):
    merged = {**MERGED, "topics": ["topic A", "topic B"]}
    save_merged_course(merged, tmp_db)
    record = get_course_by_id("0368-2157", tmp_db)
    assert record["topics"] == ["topic A", "topic B"]


def test_save_source_files_roundtrip(tmp_db):
    save_merged_course(MERGED, tmp_db)
    record = get_course_by_id("0368-2157", tmp_db)
    assert isinstance(record["source_files"], dict)
    assert "syllabus" in record["source_files"]


def test_scalar_fields(tmp_db):
    save_merged_course(MERGED, tmp_db)
    record = get_course_by_id("0368-2157", tmp_db)
    assert record["year"] == 2025
    assert record["lecture_hours"] == 3.0
    assert record["semester"] == "א'"


# ---------------------------------------------------------------------------
# Re-import (upsert — no duplicates)
# ---------------------------------------------------------------------------

def test_reimport_no_duplicate_course_row(tmp_db):
    save_merged_course(MERGED, tmp_db)
    save_merged_course(MERGED, tmp_db)
    assert len(list_courses(tmp_db)) == 1


def test_reimport_updates_field(tmp_db):
    save_merged_course(MERGED, tmp_db)
    updated = {**MERGED, "lecture_hours": 4.0}
    save_merged_course(updated, tmp_db)
    record = get_course_by_id("0368-2157", tmp_db)
    assert record["lecture_hours"] == 4.0


def test_reimport_replaces_groups(tmp_db):
    save_merged_course(MERGED, tmp_db)
    one_group = {**MERGED, "groups": [MERGED["groups"][0]]}
    save_merged_course(one_group, tmp_db)
    record = get_course_by_id("0368-2157", tmp_db)
    assert len(record["groups"]) == 1


def test_reimport_replaces_prerequisites(tmp_db):
    save_merged_course(MERGED, tmp_db)
    no_prereqs = {**MERGED, "prerequisite_course_ids": []}
    save_merged_course(no_prereqs, tmp_db)
    record = get_course_by_id("0368-2157", tmp_db)
    assert record["prerequisite_course_ids"] == []


# ---------------------------------------------------------------------------
# get_course_display_name
# ---------------------------------------------------------------------------

def test_display_name_returns_name_he(tmp_db):
    save_merged_course(MERGED, tmp_db)
    name = get_course_display_name("0368-2157", tmp_db)
    assert name == "תוכנה 1"


def test_display_name_fallback_to_name_en(tmp_db):
    course = {**MERGED, "name_he": None, "name_en": "Software 1"}
    save_merged_course(course, tmp_db)
    name = get_course_display_name("0368-2157", tmp_db)
    assert name == "Software 1"


def test_display_name_none_when_not_found(tmp_db):
    assert get_course_display_name("9999-9999", tmp_db) is None


def test_display_name_none_when_no_db(tmp_path):
    absent_db = tmp_path / "absent.sqlite"
    assert get_course_display_name("0368-2157", absent_db) is None


def test_display_name_normalizes_digits(tmp_db):
    save_merged_course(MERGED, tmp_db)
    assert get_course_display_name("03682157", tmp_db) == "תוכנה 1"


# ---------------------------------------------------------------------------
# get_course_display_names (batch)
# ---------------------------------------------------------------------------

def test_display_names_batch_known(tmp_db):
    save_merged_course(MERGED, tmp_db)
    result = get_course_display_names(["0368-2157"], tmp_db)
    assert result["0368-2157"] == "תוכנה 1"


def test_display_names_batch_unknown_maps_to_none(tmp_db):
    save_merged_course(MERGED, tmp_db)
    result = get_course_display_names(["0368-2157", "9999-9999"], tmp_db)
    assert result["9999-9999"] is None


def test_display_names_batch_empty_input(tmp_db):
    assert get_course_display_names([], tmp_db) == {}


def test_display_names_batch_no_db(tmp_path):
    absent_db = tmp_path / "absent.sqlite"
    result = get_course_display_names(["0368-2157"], absent_db)
    assert result == {"0368-2157": None}


def test_display_names_batch_preserves_original_keys(tmp_db):
    save_merged_course(MERGED, tmp_db)
    # Pass un-normalized key; result should map the original key
    result = get_course_display_names(["03682157"], tmp_db)
    assert "03682157" in result
    assert result["03682157"] == "תוכנה 1"


# ---------------------------------------------------------------------------
# list_courses
# ---------------------------------------------------------------------------

def test_list_courses_empty(tmp_db):
    assert list_courses(tmp_db) == []


def test_list_courses_after_import(tmp_db):
    save_merged_course(MERGED, tmp_db)
    rows = list_courses(tmp_db)
    assert len(rows) == 1
    assert rows[0]["course_id"] == "0368-2157"


def test_list_courses_has_expected_keys(tmp_db):
    save_merged_course(MERGED, tmp_db)
    row = list_courses(tmp_db)[0]
    assert {"course_id", "name_he", "year", "semester", "faculty"} <= set(row.keys())


# ---------------------------------------------------------------------------
# get_prerequisites
# ---------------------------------------------------------------------------

def test_get_prerequisites_returns_list(tmp_db):
    save_merged_course(MERGED, tmp_db)
    prereqs = get_prerequisites("0368-2157", tmp_db)
    assert prereqs == ["03681105"]


def test_get_prerequisites_by_digits(tmp_db):
    save_merged_course(MERGED, tmp_db)
    prereqs = get_prerequisites("03682157", tmp_db)
    assert "03681105" in prereqs


def test_get_prerequisites_empty_for_unknown(tmp_db):
    assert get_prerequisites("9999-9999", tmp_db) == []


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def test_split_time_slot_normal():
    assert _split_time_slot("12:00-15:00") == ("12:00", "15:00")


def test_split_time_slot_none():
    assert _split_time_slot(None) == (None, None)


def test_split_time_slot_no_dash():
    start, end = _split_time_slot("12:00")
    assert start == "12:00"
    assert end is None


def test_normalize_course_id_with_dash():
    assert _normalize_course_id("0368-2157") == "0368-2157"


def test_normalize_course_id_digits_only():
    assert _normalize_course_id("03682157") == "0368-2157"


def test_normalize_course_id_short():
    assert _normalize_course_id("abc") == "abc"


# ---------------------------------------------------------------------------
# Integration: real merged JSON
# ---------------------------------------------------------------------------

_MERGED_JSON = Path("data/parsed_json/merged_course_03682157_2025.json")


@pytest.fixture
def real_merged():
    if not _MERGED_JSON.exists():
        pytest.skip(f"Missing: {_MERGED_JSON}")
    return json.loads(_MERGED_JSON.read_text(encoding="utf-8"))


def test_real_import_course_id(tmp_db, real_merged):
    save_merged_course(real_merged, tmp_db)
    record = get_course_by_id("0368-2157", tmp_db)
    assert record["course_id"] == "0368-2157"


def test_real_import_groups_count(tmp_db, real_merged):
    save_merged_course(real_merged, tmp_db)
    record = get_course_by_id("0368-2157", tmp_db)
    assert len(record["groups"]) == 19


def test_real_import_prereqs(tmp_db, real_merged):
    save_merged_course(real_merged, tmp_db)
    prereqs = get_prerequisites("0368-2157", tmp_db)
    assert "03681105" in prereqs


def test_real_import_lecture_hours(tmp_db, real_merged):
    save_merged_course(real_merged, tmp_db)
    record = get_course_by_id("0368-2157", tmp_db)
    assert record["lecture_hours"] == 3.0

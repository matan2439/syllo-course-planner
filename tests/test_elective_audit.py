import csv
import json
import pytest
from pathlib import Path

from app.database.db import init_db, save_merged_course
from app.analysis.elective_audit import audit_courses, print_audit_table, write_audit_csv


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _course(course_id: str, **kwargs) -> dict:
    base = {
        "course_id": course_id, "name_he": course_id, "name_en": None,
        "faculty": None, "department": None, "year": 2025, "semester": None,
        "credits": None, "lecture_hours": None, "tutorial_hours": None,
        "lab_hours": None, "prerequisites_raw_text": None,
        "prerequisite_course_ids": [], "course_description": None,
        "topics": [], "assignments": None, "exam_info": None,
        "syllabus_links": [], "groups": [], "source_files": {},
    }
    base.update(kwargs)
    return base


@pytest.fixture
def tmp_db(tmp_path):
    db = tmp_path / "audit_test.sqlite"
    init_db(db)
    return db


@pytest.fixture
def populated_db(tmp_db):
    """
    FREE  : no prereqs, 2h
    GATED : requires FREE, 3h, has exam
    HEAVY : no prereqs, 8h (heavy workload)
    HARD  : no prereqs, exam + assignments + lots of hours → high difficulty
    """
    save_merged_course(_course("FREE",  lecture_hours=2.0), tmp_db)
    save_merged_course(_course("GATED", prerequisite_course_ids=["FREE"],
                               lecture_hours=3.0, exam_info="final"), tmp_db)
    save_merged_course(_course("HEAVY", lecture_hours=8.0), tmp_db)
    save_merged_course(_course("HARD",  lecture_hours=6.0, exam_info="e",
                               assignments="hw",
                               prerequisite_course_ids=["FREE"]), tmp_db)
    return tmp_db


# ---------------------------------------------------------------------------
# Status: missing_from_db
# ---------------------------------------------------------------------------

def test_missing_from_db_status(tmp_db):
    results = audit_courses(["UNKNOWN"], [], db_path=tmp_db)
    assert results[0]["status"] == "missing_from_db"


def test_missing_from_db_no_difficulty(tmp_db):
    results = audit_courses(["UNKNOWN"], [], db_path=tmp_db)
    assert results[0]["difficulty_score"] is None


def test_missing_from_db_reason(tmp_db):
    results = audit_courses(["UNKNOWN"], [], db_path=tmp_db)
    assert any("Not found" in r for r in results[0]["reasons"])


def test_missing_from_db_empty_prereqs(tmp_db):
    results = audit_courses(["UNKNOWN"], [], db_path=tmp_db)
    assert results[0]["missing_prerequisites"] == []
    assert results[0]["satisfied_prerequisites"] == []


# ---------------------------------------------------------------------------
# Status: eligible
# ---------------------------------------------------------------------------

def test_eligible_no_prereqs(populated_db):
    results = audit_courses(["FREE"], [], db_path=populated_db)
    assert results[0]["status"] == "eligible"


def test_eligible_with_satisfied_prereqs(populated_db):
    results = audit_courses(["GATED"], ["FREE"], db_path=populated_db)
    assert results[0]["status"] == "eligible"


def test_eligible_satisfied_list(populated_db):
    results = audit_courses(["GATED"], ["FREE"], db_path=populated_db)
    assert "FREE" in results[0]["satisfied_prerequisites"]


def test_eligible_missing_list_empty(populated_db):
    results = audit_courses(["GATED"], ["FREE"], db_path=populated_db)
    assert results[0]["missing_prerequisites"] == []


# ---------------------------------------------------------------------------
# Status: blocked
# ---------------------------------------------------------------------------

def test_blocked_missing_prereq(populated_db):
    results = audit_courses(["GATED"], [], db_path=populated_db)
    assert results[0]["status"] == "blocked"


def test_blocked_missing_list_populated(populated_db):
    results = audit_courses(["GATED"], [], db_path=populated_db)
    assert "FREE" in results[0]["missing_prerequisites"]


def test_blocked_satisfied_list_empty(populated_db):
    results = audit_courses(["GATED"], [], db_path=populated_db)
    assert results[0]["satisfied_prerequisites"] == []


# ---------------------------------------------------------------------------
# Status: filtered_out
# ---------------------------------------------------------------------------

def test_filtered_out_by_difficulty(populated_db):
    # HEAVY: 8h → hours_bonus=1.0, base=1.0 → score ≥ 2.0
    results = audit_courses(["HEAVY"], [], max_difficulty=1.5, db_path=populated_db)
    assert results[0]["status"] == "filtered_out"


def test_filtered_out_reason_mentions_difficulty(populated_db):
    results = audit_courses(["HEAVY"], [], max_difficulty=1.5, db_path=populated_db)
    assert any("Filtered" in r and "difficulty" in r for r in results[0]["reasons"])


def test_filtered_out_by_weekly_hours(populated_db):
    results = audit_courses(["HEAVY"], [], max_weekly_hours=4.0, db_path=populated_db)
    assert results[0]["status"] == "filtered_out"


def test_filtered_out_reason_mentions_hours(populated_db):
    results = audit_courses(["HEAVY"], [], max_weekly_hours=4.0, db_path=populated_db)
    assert any("Filtered" in r and "hours" in r for r in results[0]["reasons"])


def test_blocked_not_filtered(populated_db):
    # GATED is blocked (no prereq), so should stay blocked, not filtered_out
    results = audit_courses(["GATED"], [], max_difficulty=1.0, db_path=populated_db)
    assert results[0]["status"] == "blocked"


def test_no_filter_eligible_stays_eligible(populated_db):
    results = audit_courses(["FREE"], [], max_difficulty=None, max_weekly_hours=None,
                            db_path=populated_db)
    assert results[0]["status"] == "eligible"


# ---------------------------------------------------------------------------
# Result structure
# ---------------------------------------------------------------------------

def test_result_has_all_keys(populated_db):
    results = audit_courses(["FREE"], [], db_path=populated_db)
    required = {
        "course_id", "name_he", "status", "missing_prerequisites",
        "missing_prerequisite_details", "satisfied_prerequisites",
        "difficulty_score", "difficulty_level",
        "workload_score", "conceptual_complexity_score", "prerequisite_depth_score",
        "assessment_intensity_score", "difficulty_confidence", "difficulty_warnings",
        "weekly_hours", "syllabus_url", "syllabus_links", "reasons",
    }
    assert required.issubset(set(results[0].keys()))


def test_weekly_hours_computed(populated_db):
    results = audit_courses(["FREE"], [], db_path=populated_db)
    assert results[0]["weekly_hours"] == 2.0


def test_weekly_hours_none_when_no_data(tmp_db):
    save_merged_course(_course("X"), tmp_db)
    results = audit_courses(["X"], [], db_path=tmp_db)
    assert results[0]["weekly_hours"] is None


def test_difficulty_score_present(populated_db):
    results = audit_courses(["FREE"], [], db_path=populated_db)
    assert results[0]["difficulty_score"] is not None


def test_reasons_is_list(populated_db):
    results = audit_courses(["FREE"], [], db_path=populated_db)
    assert isinstance(results[0]["reasons"], list)
    assert len(results[0]["reasons"]) >= 1


def test_ordering_preserved(populated_db):
    ids = ["GATED", "FREE", "HEAVY"]
    results = audit_courses(ids, [], db_path=populated_db)
    assert [r["course_id"] for r in results] == ids


# ---------------------------------------------------------------------------
# Mixed batch
# ---------------------------------------------------------------------------

def test_mixed_batch(populated_db):
    results = audit_courses(["FREE", "GATED", "UNKNOWN"], ["FREE"], db_path=populated_db)
    by_id = {r["course_id"]: r["status"] for r in results}
    assert by_id["FREE"]    == "eligible"
    assert by_id["GATED"]   == "eligible"
    assert by_id["UNKNOWN"] == "missing_from_db"


def test_counts_in_mixed_batch(populated_db):
    results = audit_courses(["FREE", "GATED", "UNKNOWN"], [], db_path=populated_db)
    statuses = [r["status"] for r in results]
    assert statuses.count("eligible")        == 1
    assert statuses.count("blocked")         == 1
    assert statuses.count("missing_from_db") == 1


# ---------------------------------------------------------------------------
# missing_prerequisite_details
# ---------------------------------------------------------------------------

def test_missing_prerequisite_details_present_when_blocked(populated_db):
    results = audit_courses(["GATED"], [], db_path=populated_db)
    assert "missing_prerequisite_details" in results[0]


def test_missing_prerequisite_details_contains_free(populated_db):
    results = audit_courses(["GATED"], [], db_path=populated_db)
    details = results[0]["missing_prerequisite_details"]
    assert any(d["course_id"] == "FREE" for d in details)


def test_missing_prerequisite_details_known_in_db_true(populated_db):
    results = audit_courses(["GATED"], [], db_path=populated_db)
    details = results[0]["missing_prerequisite_details"]
    free_detail = next(d for d in details if d["course_id"] == "FREE")
    assert free_detail["known_in_db"] is True


def test_missing_prerequisite_details_has_name_he(populated_db):
    results = audit_courses(["GATED"], [], db_path=populated_db)
    details = results[0]["missing_prerequisite_details"]
    free_detail = next(d for d in details if d["course_id"] == "FREE")
    # name_he for FREE is "FREE" in our fixture (_course sets name_he=course_id)
    assert free_detail["name_he"] is not None


def test_missing_prerequisite_details_empty_when_eligible(populated_db):
    results = audit_courses(["FREE"], [], db_path=populated_db)
    assert results[0]["missing_prerequisite_details"] == []


def test_missing_prerequisite_details_empty_for_missing_from_db(tmp_db):
    results = audit_courses(["UNKNOWN"], [], db_path=tmp_db)
    assert results[0]["missing_prerequisite_details"] == []


# ---------------------------------------------------------------------------
# print_audit_table (smoke test — just verify it doesn't raise)
# ---------------------------------------------------------------------------

def test_print_audit_table_runs(populated_db, capsys):
    results = audit_courses(["FREE", "GATED", "UNKNOWN"], [], db_path=populated_db)
    print_audit_table(results)
    out = capsys.readouterr().out
    assert "SUMMARY" in out
    assert "eligible" in out
    assert "blocked" in out
    assert "missing_from_db" in out


# ---------------------------------------------------------------------------
# write_audit_csv
# ---------------------------------------------------------------------------

def test_csv_file_created(populated_db, tmp_path):
    results = audit_courses(["FREE", "GATED", "UNKNOWN"], [], db_path=populated_db)
    out = tmp_path / "audit.csv"
    write_audit_csv(results, out)
    assert out.exists()


def test_csv_row_count(populated_db, tmp_path):
    results = audit_courses(["FREE", "GATED", "UNKNOWN"], [], db_path=populated_db)
    out = tmp_path / "audit.csv"
    write_audit_csv(results, out)
    rows = list(csv.DictReader(out.open(encoding="utf-8-sig")))
    assert len(rows) == 3


def test_csv_has_expected_columns(populated_db, tmp_path):
    results = audit_courses(["FREE"], [], db_path=populated_db)
    out = tmp_path / "audit.csv"
    write_audit_csv(results, out)
    reader = csv.DictReader(out.open(encoding="utf-8-sig"))
    assert set(reader.fieldnames) == {
        "course_id", "name_he", "status",
        "missing_prerequisites", "satisfied_prerequisites",
        "difficulty_score", "difficulty_level", "weekly_hours", "reasons",
    }


def test_csv_list_fields_joined_with_semicolons(populated_db, tmp_path):
    results = audit_courses(["GATED"], [], db_path=populated_db)
    out = tmp_path / "audit.csv"
    write_audit_csv(results, out)
    row = list(csv.DictReader(out.open(encoding="utf-8-sig")))[0]
    # missing_prerequisites should be "FREE" (one item, no semicolon needed)
    assert row["missing_prerequisites"] == "FREE"


def test_csv_multiple_missing_prereqs_semicolon(tmp_path):
    result = [{
        "course_id": "X", "name_he": None, "status": "blocked",
        "missing_prerequisites": ["A", "B", "C"],
        "satisfied_prerequisites": [],
        "difficulty_score": 2.0, "difficulty_level": "medium",
        "weekly_hours": 3.0,
        "reasons": ["Missing 3.", "Difficulty: medium."],
    }]
    out = tmp_path / "audit.csv"
    write_audit_csv(result, out)
    row = list(csv.DictReader(out.open(encoding="utf-8-sig")))[0]
    assert row["missing_prerequisites"] == "A; B; C"
    assert row["reasons"] == "Missing 3.; Difficulty: medium."


def test_csv_none_fields_become_empty_string(tmp_path):
    result = [{
        "course_id": "X", "name_he": None, "status": "missing_from_db",
        "missing_prerequisites": [], "satisfied_prerequisites": [],
        "difficulty_score": None, "difficulty_level": None,
        "weekly_hours": None, "reasons": ["Not found in database."],
    }]
    out = tmp_path / "audit.csv"
    write_audit_csv(result, out)
    row = list(csv.DictReader(out.open(encoding="utf-8-sig")))[0]
    assert row["difficulty_score"] == ""
    assert row["weekly_hours"] == ""
    assert row["name_he"] == ""


def test_csv_encoding_is_utf8_bom(populated_db, tmp_path):
    results = audit_courses(["FREE"], [], db_path=populated_db)
    out = tmp_path / "audit.csv"
    write_audit_csv(results, out)
    raw = out.read_bytes()
    assert raw[:3] == b"\xef\xbb\xbf"   # UTF-8 BOM


def test_csv_empty_results(tmp_path):
    out = tmp_path / "audit.csv"
    write_audit_csv([], out)
    rows = list(csv.DictReader(out.open(encoding="utf-8-sig")))
    assert rows == []


def test_csv_status_values_correct(populated_db, tmp_path):
    results = audit_courses(["FREE", "GATED", "UNKNOWN"], [], db_path=populated_db)
    out = tmp_path / "audit.csv"
    write_audit_csv(results, out)
    rows = {r["course_id"]: r["status"]
            for r in csv.DictReader(out.open(encoding="utf-8-sig"))}
    assert rows["FREE"]    == "eligible"
    assert rows["GATED"]   == "blocked"
    assert rows["UNKNOWN"] == "missing_from_db"


# ---------------------------------------------------------------------------
# Integration: real DB
# ---------------------------------------------------------------------------

_REAL_DB = Path("data/database.sqlite")
_REAL_LIST = Path("data/course_lists/mechanical_electives_2025.txt")


@pytest.fixture
def real_db():
    if not _REAL_DB.exists():
        pytest.skip(f"Missing: {_REAL_DB}")
    return _REAL_DB


@pytest.fixture
def real_list():
    if not _REAL_LIST.exists():
        pytest.skip(f"Missing: {_REAL_LIST}")
    from app.pipeline.bulk_import_courses import load_course_ids
    return load_course_ids(_REAL_LIST)


def test_real_audit_has_missing_from_db(real_db, real_list):
    results = audit_courses(real_list, [], db_path=real_db)
    statuses = {r["status"] for r in results}
    assert "missing_from_db" in statuses


def test_real_audit_has_eligible(real_db, real_list):
    results = audit_courses(real_list, [], db_path=real_db)
    statuses = {r["status"] for r in results}
    assert "eligible" in statuses


def test_real_audit_result_count_matches_input(real_db, real_list):
    results = audit_courses(real_list, ["0542-2200", "0542-2600"], db_path=real_db)
    assert len(results) == len(real_list)


def test_real_audit_filter_reduces_eligible(real_db, real_list):
    all_results      = audit_courses(real_list, [], db_path=real_db)
    filtered_results = audit_courses(real_list, [], max_difficulty=1.5, db_path=real_db)
    eligible_all      = sum(1 for r in all_results      if r["status"] == "eligible")
    eligible_filtered = sum(1 for r in filtered_results if r["status"] == "eligible")
    assert eligible_filtered <= eligible_all

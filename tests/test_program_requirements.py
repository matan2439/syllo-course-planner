"""
Tests for program_requirements.py.

Covers:
1. JSON loading
2. Category min_courses validation
3. Total hours remaining calculation
4. Unknown hours warning
5. Board course enrichment with category
6. Repository grouping by category (via semester_board)
7. Planner prioritises missing categories
8. Semester layout order (year_3_a → year_3_b → year_4_a → year_4_b)
9. Generic program requirements with a fake second program
"""

import json
import pytest
from pathlib import Path

from app.analysis.program_requirements import (
    load_program_requirements,
    validate_program_plan,
    build_course_category_map,
    get_program_categories_for_frontend,
    resolve_category_course_ids,
)
from app.database.db import init_db, save_merged_course
from app.analysis.elective_audit import audit_courses
from app.analysis.course_plan_builder import build_course_plan, _get_required_category_ids
from app.analysis.semester_board import build_semester_board


# ---------------------------------------------------------------------------
# Helpers / fixtures
# ---------------------------------------------------------------------------

def _prog(categories=None, total_hours=100, mandatory_ids=None) -> dict:
    """Build a minimal program dict for testing."""
    return {
        "program_id":        "test_prog",
        "program_name_he":   "תוכנית בדיקה",
        "total_required_hours": total_hours,
        "requirements": {
            "mandatory_courses": {
                "name_he":    "חובה",
                "course_ids": mandatory_ids or [],
            },
            "elective_categories": categories or [],
        },
    }


def _cat(cat_id, name_he, min_courses, course_ids, needs_review=False) -> dict:
    return {
        "category_id": cat_id,
        "name_he":     name_he,
        "min_courses": min_courses,
        "course_ids":  course_ids,
        "needs_review": needs_review,
    }


def _board(*semesters_spec) -> dict:
    """Build a minimal board dict from (semester_id, [(course_id, hours)]) specs."""
    semesters = []
    for sem_id, courses in semesters_spec:
        semesters.append({
            "semester_id": sem_id,
            "courses": [
                {"course_id": cid, "weekly_hours": hrs, "prerequisites": []}
                for cid, hrs in courses
            ],
        })
    return {"semesters": semesters}


def _course_record(course_id, **kwargs) -> dict:
    return {
        "course_id": course_id, "name_he": course_id, "name_en": None,
        "faculty": None, "department": None, "year": 2025, "semester": None,
        "credits": None, "lecture_hours": 3.0, "tutorial_hours": None,
        "lab_hours": None, "prerequisites_raw_text": None,
        "prerequisite_course_ids": [], "course_description": None,
        "topics": [], "assignments": None, "exam_info": None,
        "syllabus_links": [], "groups": [], "source_files": {},
        **kwargs,
    }


def _audit_record(course_id, status="eligible", cat_id=None, cat_name=None, hours=3.0) -> dict:
    return {
        "course_id":                 course_id,
        "name_he":                   course_id,
        "status":                    status,
        "missing_prerequisites":     [],
        "missing_prerequisite_details": [],
        "satisfied_prerequisites":   [],
        "difficulty_score":          2.0,
        "difficulty_level":          "medium",
        "weekly_hours":              hours,
        "syllabus_url":              None,
        "syllabus_links":            [],
        "reasons":                   [],
        "program_category_id":       cat_id,
        "program_category_name_he":  cat_name,
        "needs_category_review":     False,
    }


@pytest.fixture
def tmp_db(tmp_path):
    db = tmp_path / "pr_test.sqlite"
    init_db(db)
    return db


# ---------------------------------------------------------------------------
# 1. JSON loading
# ---------------------------------------------------------------------------

def test_load_real_program_json():
    path = Path("data/programs/mechanical_engineering_2025.json")
    if not path.exists():
        pytest.skip("program JSON not found")
    prog = load_program_requirements(path)
    assert prog["program_id"] == "mechanical_engineering_2025"
    assert "requirements" in prog
    assert prog.get("total_required_hours") == 185


def test_load_returns_dict(tmp_path):
    data = _prog()
    p = tmp_path / "prog.json"
    p.write_text(json.dumps(data), encoding="utf-8")
    result = load_program_requirements(p)
    assert result["program_id"] == "test_prog"


# ---------------------------------------------------------------------------
# 2. Category min_courses validation
# ---------------------------------------------------------------------------

def test_category_satisfied_by_planned():
    prog = _prog(categories=[_cat("A", "קטגוריה A", 1, ["C1", "C2"])])
    board = _board(("year_3_semester_a", [("C1", 3.0)]))
    r = validate_program_plan(board, prog, [])
    assert r["valid"]
    cat = r["category_results"][0]
    assert cat["satisfied"]
    assert cat["selected_count"] == 1


def test_category_satisfied_by_completed():
    prog = _prog(categories=[_cat("A", "קטגוריה A", 1, ["C1"])])
    board = _board(("year_3_semester_a", []))
    r = validate_program_plan(board, prog, completed_course_ids=["C1"])
    assert r["valid"]
    assert r["category_results"][0]["satisfied"]


def test_category_unsatisfied_when_missing():
    prog = _prog(categories=[_cat("A", "קטגוריה A", 1, ["C1"])])
    board = _board(("year_3_semester_a", [("C2", 3.0)]))  # C2 not in category
    r = validate_program_plan(board, prog, [])
    assert not r["valid"]
    assert not r["category_results"][0]["satisfied"]
    assert "A" in r["missing_required_categories"]


def test_needs_review_category_not_required():
    prog = _prog(categories=[_cat("unc", "לא מסווג", 1, ["C1"], needs_review=True)])
    board = _board(("year_3_semester_a", []))
    r = validate_program_plan(board, prog, [])
    assert r["valid"]  # needs_review=True → not a hard requirement


def test_category_min_two():
    prog = _prog(categories=[_cat("B", "קטגוריה B", 2, ["C1", "C2", "C3"])])
    board = _board(("year_3_semester_a", [("C1", 3.0), ("C2", 3.0)]))
    r = validate_program_plan(board, prog, [])
    assert r["valid"]
    assert r["category_results"][0]["selected_count"] == 2


def test_multiple_categories_all_satisfied():
    prog = _prog(categories=[
        _cat("X", "X", 1, ["C1"]),
        _cat("Y", "Y", 1, ["C2"]),
    ])
    board = _board(("year_3_semester_a", [("C1", 3.0), ("C2", 3.0)]))
    r = validate_program_plan(board, prog, [])
    assert r["valid"]


def test_multiple_categories_one_missing():
    prog = _prog(categories=[
        _cat("X", "X", 1, ["C1"]),
        _cat("Y", "Y", 1, ["C2"]),
    ])
    board = _board(("year_3_semester_a", [("C1", 3.0)]))
    r = validate_program_plan(board, prog, [])
    assert not r["valid"]
    assert "Y" in r["missing_required_categories"]


# ---------------------------------------------------------------------------
# 3. Total hours remaining calculation
# ---------------------------------------------------------------------------

def test_remaining_hours():
    prog = _prog(total_hours=10)
    board = _board(("year_3_semester_a", [("C1", 3.0), ("C2", 4.0)]))
    r = validate_program_plan(board, prog, [])
    assert r["planned_hours"] == pytest.approx(7.0)
    assert r["remaining_hours"] == pytest.approx(3.0)


def test_remaining_hours_none_when_no_total():
    prog = _prog(total_hours=None)
    prog.pop("total_required_hours", None)
    board = _board(("year_3_semester_a", [("C1", 3.0)]))
    r = validate_program_plan(board, prog, [])
    assert r["remaining_hours"] is None


def test_remaining_hours_zero_when_exceeds():
    prog = _prog(total_hours=5)
    board = _board(("year_3_semester_a", [("C1", 3.0), ("C2", 4.0)]))  # 7 > 5
    r = validate_program_plan(board, prog, [])
    assert r["remaining_hours"] == 0.0


# ---------------------------------------------------------------------------
# 4. Unknown hours warning
# ---------------------------------------------------------------------------

def test_unknown_hours_warning():
    prog = _prog()
    board = _board(("year_3_semester_a", [("C1", None), ("C2", 3.0)]))
    r = validate_program_plan(board, prog, [])
    assert r["unknown_hours_courses"] == 1
    assert any("ידועות" in w for w in r["warnings"])


def test_no_unknown_hours_no_warning():
    prog = _prog()
    board = _board(("year_3_semester_a", [("C1", 3.0)]))
    r = validate_program_plan(board, prog, [])
    assert r["unknown_hours_courses"] == 0
    assert not any("ידועות" in w for w in r["warnings"])


# ---------------------------------------------------------------------------
# 5. Board course enrichment with category
# ---------------------------------------------------------------------------

def test_build_course_category_map_basic():
    prog = _prog(categories=[_cat("A", "קטגוריה A", 1, ["C1", "C2"])])
    cat_map = build_course_category_map(prog)
    assert cat_map["C1"]["category_id"] == "A"
    assert cat_map["C1"]["name_he"] == "קטגוריה A"
    assert cat_map["C2"]["category_id"] == "A"


def test_build_course_category_map_needs_review():
    prog = _prog(categories=[_cat("unc", "לא מסווג", 0, ["C1"], needs_review=True)])
    cat_map = build_course_category_map(prog)
    assert cat_map["C1"]["needs_review"] is True


def test_board_course_enrichment_via_semester_board(tmp_db):
    save_merged_course(_course_record("A"), tmp_db)
    prog = _prog(categories=[_cat("fluids", "זורמים", 1, ["A"])])
    plan = {
        "selected_courses": [{
            "course_id":              "A",
            "name_he":                "A",
            "weekly_hours":           3.0,
            "difficulty_score":       2.0,
            "difficulty_level":       "medium",
            "program_category_id":    "fluids",
            "program_category_name_he": "זורמים",
            "needs_category_review":  False,
        }]
    }
    board = build_semester_board(plan, program=prog, db_path=tmp_db)
    courses = [c for s in board["semesters"] for c in s["courses"]]
    a = next(c for c in courses if c["course_id"] == "A")
    assert a["program_category_id"] == "fluids"
    assert a["program_category_name_he"] == "זורמים"


def test_board_metadata_has_program_requirements(tmp_db):
    save_merged_course(_course_record("A"), tmp_db)
    prog = _prog(categories=[_cat("fluids", "זורמים", 1, ["A"])])
    plan = {
        "selected_courses": [{
            "course_id": "A", "name_he": "A", "weekly_hours": 3.0,
            "difficulty_score": 2.0, "difficulty_level": "medium",
        }]
    }
    board = build_semester_board(plan, program=prog, db_path=tmp_db)
    assert "program_requirements_validation" in board["metadata"]
    assert "program_requirements_categories" in board["metadata"]


# ---------------------------------------------------------------------------
# 6. Elective audit enriches courses with category
# ---------------------------------------------------------------------------

def test_audit_enrich_with_categories(tmp_db):
    save_merged_course(_course_record("A"), tmp_db)
    prog = _prog(categories=[_cat("fluids", "זורמים", 1, ["A"])])
    results = audit_courses(["A"], [], program_requirements=prog, db_path=tmp_db)
    assert len(results) == 1
    assert results[0]["program_category_id"] == "fluids"
    assert results[0]["program_category_name_he"] == "זורמים"
    assert results[0]["needs_category_review"] is False


def test_audit_uncategorized_course(tmp_db):
    save_merged_course(_course_record("Z"), tmp_db)
    prog = _prog(categories=[_cat("fluids", "זורמים", 1, ["A"])])
    results = audit_courses(["Z"], [], program_requirements=prog, db_path=tmp_db)
    assert results[0]["program_category_id"] is None


# ---------------------------------------------------------------------------
# 7. Planner prioritises missing categories
# ---------------------------------------------------------------------------

def test_planner_required_category_ids():
    prog = _prog(categories=[
        _cat("A", "קטגוריה A", 1, []),
        _cat("B", "קטגוריה B", 0, []),  # min=0 → not required
        _cat("C", "קטגוריה C", 1, [], needs_review=True),  # review → not required
    ])
    ids = _get_required_category_ids(prog)
    assert "A" in ids
    assert "B" not in ids
    assert "C" not in ids


def test_planner_selects_required_category_first():
    prog = _prog(categories=[
        _cat("rare", "נדיר", 1, ["RARE1"]),
        _cat("common", "שכיח", 0, ["C1", "C2", "C3"]),
    ])
    # RARE1 has high difficulty (score=4.5) but is in required category
    # C1-C3 have low difficulty (score=1.0) but category is not required
    audit = [
        _audit_record("RARE1", cat_id="rare",   cat_name="נדיר",  hours=3.0),
        _audit_record("C1",    cat_id="common", cat_name="שכיח",  hours=3.0),
        _audit_record("C2",    cat_id="common", cat_name="שכיח",  hours=3.0),
    ]
    # Override difficulty scores
    audit[0]["difficulty_score"] = 4.5
    audit[1]["difficulty_score"] = 1.0
    audit[2]["difficulty_score"] = 1.0

    plan = build_course_plan(audit, limit=1, program_requirements=prog)
    selected_ids = [c["course_id"] for c in plan["selected_courses"]]
    assert "RARE1" in selected_ids


def test_planner_selection_reason_category():
    prog = _prog(categories=[_cat("fluids", "זורמים", 1, ["C1"])])
    audit = [_audit_record("C1", cat_id="fluids", cat_name="זורמים")]
    plan = build_course_plan(audit, limit=1, program_requirements=prog)
    reason = plan["selected_courses"][0]["selection_reason"]
    assert "זורמים" in reason


def test_planner_selection_reason_additional():
    prog = _prog(categories=[_cat("unc", "בחירה נוספת", 0, ["C1"], needs_review=True)])
    audit = [_audit_record("C1", cat_id="unc", cat_name="בחירה נוספת")]
    plan = build_course_plan(audit, limit=1, program_requirements=prog)
    reason = plan["selected_courses"][0]["selection_reason"]
    # uncategorized or not-required → "נוספת" reason
    assert "נוספת" in reason or "unc" in reason


# ---------------------------------------------------------------------------
# 8. Semester layout order
# ---------------------------------------------------------------------------

def test_semesters_order_is_y3a_y3b_y4a_y4b(tmp_db):
    """Board semesters must be in chronological order: 3a, 3b, 4a, 4b."""
    plan = {"selected_courses": []}
    board = build_semester_board(plan, start_year=3, db_path=tmp_db)
    sem_ids = [s["semester_id"] for s in board["semesters"]]
    assert sem_ids == [
        "year_3_semester_a",
        "year_3_semester_b",
        "year_4_semester_a",
        "year_4_semester_b",
    ]


def test_course_placed_after_prerequisite_in_semesters(tmp_db):
    """Prerequisite courses must appear in earlier semesters than their dependents."""
    save_merged_course(_course_record("P"), tmp_db)
    save_merged_course(_course_record("A", prerequisite_course_ids=["P"]), tmp_db)
    plan = {
        "selected_courses": [
            {"course_id": "A", "name_he": "A", "weekly_hours": 3.0, "difficulty_score": 2.0, "difficulty_level": "medium"},
            {"course_id": "P", "name_he": "P", "weekly_hours": 3.0, "difficulty_score": 2.0, "difficulty_level": "medium"},
        ]
    }
    board = build_semester_board(plan, db_path=tmp_db)
    sem_ids = [s["semester_id"] for s in board["semesters"]]
    p_sem = next(s["semester_id"] for s in board["semesters"] if any(c["course_id"] == "P" for c in s["courses"]))
    a_sem = next(s["semester_id"] for s in board["semesters"] if any(c["course_id"] == "A" for c in s["courses"]))
    assert sem_ids.index(p_sem) < sem_ids.index(a_sem)


# ---------------------------------------------------------------------------
# 9. Generic program requirements with a second (fake) program
# ---------------------------------------------------------------------------

def test_generic_second_program():
    prog = {
        "program_id":         "test_cs_2025",
        "program_name_he":    "מדעי המחשב",
        "total_required_hours": 40,
        "requirements": {
            "mandatory_courses": {"name_he": "חובה", "course_ids": ["M1"]},
            "elective_categories": [
                _cat("theory",   "תיאוריה",   1, ["T1", "T2"]),
                _cat("systems",  "מערכות",    1, ["S1"]),
                _cat("elective", "בחירה חופשית", 0, ["E1", "E2"]),
            ],
        },
    }
    board = _board(
        ("year_3_semester_a", [("M1", 4.0), ("T1", 3.0)]),
        ("year_3_semester_b", [("S1", 3.0)]),
    )
    r = validate_program_plan(board, prog, completed_course_ids=[])
    # M1 mandatory + T1 satisfies theory + S1 satisfies systems
    assert r["valid"]
    assert r["planned_hours"] == pytest.approx(10.0)
    assert r["remaining_hours"] == pytest.approx(30.0)
    theory_res = next(c for c in r["category_results"] if c["category_id"] == "theory")
    assert theory_res["satisfied"]


def test_generic_second_program_missing_mandatory():
    prog = {
        "program_id":         "test_cs_2025",
        "program_name_he":    "מדעי המחשב",
        "total_required_hours": 40,
        "requirements": {
            "mandatory_courses": {"name_he": "חובה", "course_ids": ["M1"]},
            "elective_categories": [],
        },
    }
    board = _board(("year_3_semester_a", [("T1", 3.0)]))  # M1 missing
    r = validate_program_plan(board, prog, completed_course_ids=[])
    assert not r["valid"]
    assert "M1" in r["missing_mandatory_courses"]


def test_get_program_categories_for_frontend():
    prog = _prog(categories=[
        _cat("A", "קטגוריה A", 1, ["C1", "C2"]),
        _cat("B", "קטגוריה B", 2, ["C3"], needs_review=True),
    ])
    result = get_program_categories_for_frontend(prog)
    assert result["total_required_hours"] == 100
    cats = result["categories"]
    assert len(cats) == 2
    assert cats[0]["category_id"] == "A"
    assert "C1" in cats[0]["course_ids"]
    assert cats[1]["needs_review"] is True

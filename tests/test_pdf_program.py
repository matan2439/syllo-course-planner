"""
Tests for the PDF-derived Mechanical Engineering תשפ"ז program.

Covers:
  - JSON file loads and has expected structure
  - Core category membership (fluids / solids / systems)
  - Advanced-labs category membership
  - 0542-4093 is not offered in תשפ"ז
  - program_requirements validation: 6 core courses total, 1 per sub-group,
    1 advanced lab
  - Prerequisite names are preserved in elective_courses entries
  - Prerequisite resolver fills course_id when name matches DB, keeps name_he
    regardless
  - get_program_categories_for_frontend includes core_courses_total_min
  - _build_allowed_course_ids works with the PDF-format program
"""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

import pytest

from app.analysis.eligibility_engine import normalize_course_id
from app.analysis.prerequisite_resolver import (
    resolve_prerequisites_in_program,
    resolve_prereq_list,
    format_prereq_display,
)
from app.analysis.program_requirements import (
    get_program_categories_for_frontend,
    validate_program_plan,
    get_all_program_course_ids,
    _get_unified_categories,
)
from app.analysis.semester_board import (
    build_semester_board,
    _build_allowed_course_ids,
    _build_season_prefs_from_program,
    _build_program_repository_courses,
)


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

PDF_PROGRAM_PATH = Path("data/programs/mechanical_engineering_2027_from_pdf.json")


def _load_pdf_program() -> dict[str, Any]:
    return json.loads(PDF_PROGRAM_PATH.read_text(encoding="utf-8"))


def _make_board_with_courses(course_ids: list[str], *, program=None) -> dict[str, Any]:
    """Build a minimal board dict for validation tests."""
    sems = [
        {"semester_id": "year_3_semester_a", "courses": []},
        {"semester_id": "year_3_semester_b", "courses": []},
        {"semester_id": "year_4_semester_a", "courses": []},
        {"semester_id": "year_4_semester_b", "courses": []},
    ]
    for i, cid in enumerate(course_ids):
        sems[i % 4]["courses"].append({"course_id": cid, "weekly_hours": 4.0})
    return {"semesters": sems}


# ---------------------------------------------------------------------------
# Part A: JSON file loads
# ---------------------------------------------------------------------------

def test_pdf_program_file_exists():
    assert PDF_PROGRAM_PATH.exists(), "PDF-derived program JSON not found"


def test_pdf_program_loads_valid_json():
    prog = _load_pdf_program()
    assert isinstance(prog, dict)


def test_pdf_program_has_required_top_level_keys():
    prog = _load_pdf_program()
    for key in ("program_id", "program_name_he", "academic_year_he",
                "source_type", "total_required_hours", "requirements",
                "elective_courses", "other_specialization_electives"):
        assert key in prog, f"Missing key: {key}"


def test_pdf_program_source_is_pdf():
    prog = _load_pdf_program()
    assert prog["source_type"] == "uploaded_pdf"


def test_pdf_program_total_hours():
    prog = _load_pdf_program()
    assert prog["total_required_hours"] == 185


# ---------------------------------------------------------------------------
# Part B: requirements structure
# ---------------------------------------------------------------------------

def test_requirements_has_core_courses_total_min():
    prog = _load_pdf_program()
    assert prog["requirements"]["core_courses_total_min"] == 6


def test_requirements_has_three_core_categories():
    prog = _load_pdf_program()
    cats = prog["requirements"]["core_categories"]
    ids  = [c["category_id"] for c in cats]
    assert "fluids"  in ids
    assert "solids"  in ids
    assert "systems" in ids


def test_requirements_has_advanced_labs():
    prog = _load_pdf_program()
    assert prog["requirements"]["advanced_labs"]["category_id"] == "advanced_labs"
    assert prog["requirements"]["advanced_labs"]["min_courses"] == 1


# ---------------------------------------------------------------------------
# Part C: core category membership
# ---------------------------------------------------------------------------

def test_fluids_contains_correct_courses():
    prog = _load_pdf_program()
    cats = {c["category_id"]: c for c in prog["requirements"]["core_categories"]}
    fluids_ids = [normalize_course_id(x) for x in cats["fluids"]["course_ids"]]
    assert "0542-4120" in fluids_ids
    assert "0542-4123" in fluids_ids
    assert "0542-4320" in fluids_ids
    assert "0542-4352" in fluids_ids


def test_solids_contains_correct_courses():
    prog = _load_pdf_program()
    cats = {c["category_id"]: c for c in prog["requirements"]["core_categories"]}
    solids_ids = [normalize_course_id(x) for x in cats["solids"]["course_ids"]]
    assert "0542-4220" in solids_ids
    assert "0542-4221" in solids_ids
    assert "0542-4223" in solids_ids
    assert "0542-4224" in solids_ids


def test_systems_contains_correct_courses():
    prog = _load_pdf_program()
    cats = {c["category_id"]: c for c in prog["requirements"]["core_categories"]}
    systems_ids = [normalize_course_id(x) for x in cats["systems"]["course_ids"]]
    assert "0542-4420" in systems_ids
    assert "0542-4422" in systems_ids
    assert "0542-4455" in systems_ids
    assert "0542-4622" in systems_ids


def test_advanced_labs_contains_expected_courses():
    prog = _load_pdf_program()
    labs_ids = [
        normalize_course_id(x)
        for x in prog["requirements"]["advanced_labs"]["course_ids"]
    ]
    assert "0542-4391" in labs_ids
    assert "0542-4624" in labs_ids
    assert "0581-4131" in labs_ids
    assert "0542-4094" in labs_ids


def test_0542_4093_not_offered_in_year():
    prog = _load_pdf_program()
    course = next(
        (c for c in prog["elective_courses"] if c["course_id"] == "0542-4093"),
        None,
    )
    assert course is not None, "0542-4093 should be present in elective_courses"
    assert course["offered_in_year"] is False


def test_0542_4093_has_no_offered_semesters():
    prog = _load_pdf_program()
    course = next(c for c in prog["elective_courses"] if c["course_id"] == "0542-4093")
    assert course["offered_semesters"] == []


# ---------------------------------------------------------------------------
# Part D: other_specialization_electives
# ---------------------------------------------------------------------------

def test_other_specialization_electives_count():
    prog = _load_pdf_program()
    ids = [e["course_id"] for e in prog["other_specialization_electives"]]
    expected_ids = [
        "0542-4124", "0542-4125", "0542-4131", "0542-4132", "0542-4135",
        "0542-4179", "0542-4191", "0542-4226", "0542-4275", "0542-4321",
        "0542-4322", "0542-4351", "0542-4425", "0542-4524", "0542-4527",
        "0542-4559", "0542-4621", "0542-4722", "0509-4010", "0512-1203",
        "0512-1202", "0512-2508", "0512-4200", "0512-4362", "0512-4700",
        "0512-4702", "0571-1818", "0571-3802", "0571-4174", "0555-4000",
        "0555-4432", "0555-4555", "0555-4562", "0555-3160", "0555-4630",
        "0555-4550", "0542-4011", "0542-4012", "0542-3112",
    ]
    assert set(ids) == set(expected_ids)


# ---------------------------------------------------------------------------
# Part E: offered_semesters / _get_unified_categories / _build_allowed_course_ids
# ---------------------------------------------------------------------------

def test_unified_categories_returns_fluids_solids_systems_labs_other():
    prog = _load_pdf_program()
    cats = _get_unified_categories(prog)
    cat_ids = [c["category_id"] for c in cats]
    for cid in ("fluids", "solids", "systems", "advanced_labs", "other_specialization"):
        assert cid in cat_ids, f"Missing category: {cid}"


def test_build_allowed_course_ids_includes_core_courses():
    prog = _load_pdf_program()
    allowed = _build_allowed_course_ids(prog)
    assert allowed is not None
    assert "0542-4120" in allowed  # fluids
    assert "0542-4221" in allowed  # solids
    assert "0542-4622" in allowed  # systems
    assert "0542-4391" in allowed  # advanced_labs


def test_build_allowed_course_ids_includes_other_specialization():
    prog = _load_pdf_program()
    allowed = _build_allowed_course_ids(prog)
    assert "0512-1203" in allowed
    assert "0542-4011" in allowed


def test_get_all_program_course_ids_covers_all_categories():
    prog  = _load_pdf_program()
    ids   = get_all_program_course_ids(prog)
    assert "0542-4120" in ids
    assert "0542-4391" in ids
    assert "0512-1203" in ids


def test_offered_semesters_season_prefs():
    prog = _load_pdf_program()
    prefs = _build_season_prefs_from_program(prog)
    # 0542-4120 offered_semesters: ["A"]
    assert prefs.get("0542-4120") == "a"
    # 0542-4123 offered_semesters: ["B"]
    assert prefs.get("0542-4123") == "b"


# ---------------------------------------------------------------------------
# Part F: prerequisite resolver
# ---------------------------------------------------------------------------

def test_prerequisites_present_in_elective_courses():
    prog = _load_pdf_program()
    # 0542-4120 has one prereq
    course = next(c for c in prog["elective_courses"] if c["course_id"] == "0542-4120")
    assert len(course["prerequisites"]) >= 1
    prereq = course["prerequisites"][0]
    assert prereq["name_he"]  # name is non-empty
    assert prereq.get("resolution_status") == "unresolved"


def test_prereq_name_preserved_after_resolve(tmp_path):
    """name_he is always kept, whether or not course_id is resolved."""
    no_db = tmp_path / "absent.db"
    prereqs = [{"name_he": "תרמודינמיקה (1)", "course_id": None, "resolution_status": "unresolved"}]
    resolved = resolve_prereq_list(prereqs, db_path=no_db)
    assert resolved[0]["name_he"] == "תרמודינמיקה (1)"


def test_prereq_status_set_to_unresolved_when_no_db(tmp_path):
    no_db = tmp_path / "absent.db"
    prereqs = [{"name_he": "שם לא קיים", "course_id": None, "resolution_status": "unresolved"}]
    resolved = resolve_prereq_list(prereqs, db_path=no_db)
    assert resolved[0]["resolution_status"] == "unresolved"


def test_format_prereq_display_prefers_name():
    prereq = {"name_he": "מכניקת הזורמים (1)", "course_id": "0542-2500", "resolution_status": "resolved"}
    assert format_prereq_display(prereq) == "מכניקת הזורמים (1)"


def test_format_prereq_display_falls_back_to_id():
    prereq = {"name_he": None, "course_id": "0542-2500", "resolution_status": "unresolved"}
    assert format_prereq_display(prereq) == "0542-2500"


def test_resolve_prerequisites_in_program_does_not_mutate_original(tmp_path):
    no_db = tmp_path / "absent.db"
    prog  = _load_pdf_program()
    orig_status = prog["elective_courses"][0]["prerequisites"][0]["resolution_status"]
    resolve_prerequisites_in_program(prog, db_path=no_db)
    assert prog["elective_courses"][0]["prerequisites"][0]["resolution_status"] == orig_status


# ---------------------------------------------------------------------------
# Part G: frontend categories data
# ---------------------------------------------------------------------------

def test_get_program_categories_for_frontend_includes_core_total_min():
    prog   = _load_pdf_program()
    result = get_program_categories_for_frontend(prog)
    assert result["core_courses_total_min"] == 6


def test_get_program_categories_for_frontend_includes_all_categories():
    prog   = _load_pdf_program()
    result = get_program_categories_for_frontend(prog)
    cat_ids = [c["category_id"] for c in result["categories"]]
    for cid in ("fluids", "solids", "systems", "advanced_labs", "other_specialization"):
        assert cid in cat_ids


def test_get_program_categories_for_frontend_has_other_category_label():
    prog   = _load_pdf_program()
    result = get_program_categories_for_frontend(prog)
    assert result.get("other_category_label") == "קורסים באישור מיוחד"


def test_get_program_categories_for_frontend_total_hours():
    prog   = _load_pdf_program()
    result = get_program_categories_for_frontend(prog)
    assert result["total_required_hours"] == 185


# ---------------------------------------------------------------------------
# Part H: requirements validation
# ---------------------------------------------------------------------------

def _board_with(course_ids: list[str]) -> dict[str, Any]:
    sems = [
        {"semester_id": "year_3_semester_a", "courses": []},
        {"semester_id": "year_3_semester_b", "courses": []},
        {"semester_id": "year_4_semester_a", "courses": []},
        {"semester_id": "year_4_semester_b", "courses": []},
    ]
    for i, cid in enumerate(course_ids):
        sems[i % 4]["courses"].append({"course_id": cid, "weekly_hours": 4.0})
    return {"semesters": sems}


def test_validation_fails_when_less_than_6_core_courses():
    prog  = _load_pdf_program()
    # Only 5 core courses (2 fluids + 2 solids + 1 system)
    board = _board_with([
        "0542-4120", "0542-4352",   # fluids (2)
        "0542-4220", "0542-4221",   # solids (2)
        "0542-4420",                # systems (1)
    ])
    result = validate_program_plan(board, prog, [])
    assert result["core_courses_selected"] == 5
    assert result["core_courses_satisfied"] is False
    assert "core_total" in result["missing_required_categories"]


def test_validation_passes_with_6_core_courses():
    prog  = _load_pdf_program()
    board = _board_with([
        "0542-4120", "0542-4352",           # fluids (2)
        "0542-4220", "0542-4221",           # solids (2)
        "0542-4420", "0542-4422",           # systems (2)
    ])
    result = validate_program_plan(board, prog, [])
    assert result["core_courses_selected"] == 6
    assert result["core_courses_satisfied"] is True


def test_validation_fails_with_no_fluids():
    prog  = _load_pdf_program()
    board = _board_with([
        "0542-4220", "0542-4221",           # solids (2)
        "0542-4420", "0542-4422",           # systems (2)
        "0542-4223", "0542-4224",           # solids (more)
    ])
    result = validate_program_plan(board, prog, [])
    fluids_result = next(r for r in result["category_results"] if r["category_id"] == "fluids")
    assert not fluids_result["satisfied"]


def test_validation_fails_with_no_advanced_lab():
    prog  = _load_pdf_program()
    board = _board_with([
        "0542-4120", "0542-4352",
        "0542-4220", "0542-4221",
        "0542-4420", "0542-4422",
        # no lab
    ])
    result = validate_program_plan(board, prog, [])
    lab_result = next(r for r in result["category_results"] if r["category_id"] == "advanced_labs")
    assert not lab_result["satisfied"]
    assert "advanced_labs" in result["missing_required_categories"]


def test_validation_passes_all_requirements():
    prog  = _load_pdf_program()
    board = _board_with([
        "0542-4120", "0542-4352",           # fluids (2)
        "0542-4220", "0542-4221",           # solids (2)
        "0542-4420", "0542-4422",           # systems (2) → 6 core total
        "0542-4391",                        # advanced lab
    ])
    result = validate_program_plan(board, prog, [])
    assert result["core_courses_satisfied"] is True
    lab_result = next(r for r in result["category_results"] if r["category_id"] == "advanced_labs")
    assert lab_result["satisfied"]
    assert not result["missing_required_categories"]


def test_core_courses_total_min_is_none_for_classic_program():
    """Classic format programs have no core_courses_total_min."""
    classic_prog = {
        "program_name_he": "Test",
        "total_required_hours": 100,
        "requirements": {
            "elective_categories": [
                {"category_id": "cat_a", "name_he": "A", "min_courses": 1,
                 "course_ids": ["0000-0001"]}
            ]
        }
    }
    result = get_program_categories_for_frontend(classic_prog)
    assert result["core_courses_total_min"] is None


# ---------------------------------------------------------------------------
# Part I: 2027 board stabilization
# ---------------------------------------------------------------------------

_STALE_2025_ELECTIVES = {
    "0512-1203",
    "0512-4362",
    "0542-4224",
    "0512-4200",
    "0512-4702",
}
_BOARD_2027_PATH = Path("data/parsed_json/mechanical_semester_board_2027.json")


def _load_2027_board() -> dict[str, Any]:
    return json.loads(_BOARD_2027_PATH.read_text(encoding="utf-8"))


def test_2027_board_file_exists():
    assert _BOARD_2027_PATH.exists(), "mechanical_semester_board_2027.json is missing"


def test_2027_initial_board_has_zero_placed_courses():
    board = _load_2027_board()
    placed = [
        c["course_id"]
        for sem in board["semesters"]
        for c in sem.get("courses", [])
    ]
    assert placed == [], f"Expected 0 placed courses, got: {placed}"


def test_2027_board_has_program_repository_courses():
    board = _load_2027_board()
    repo = board.get("metadata", {}).get("program_repository_courses", [])
    assert len(repo) == 56, f"Expected 56 PDF courses in repository, got {len(repo)}"


def test_2027_stale_2025_electives_not_in_placed_courses():
    board = _load_2027_board()
    placed_ids = {
        c["course_id"]
        for sem in board["semesters"]
        for c in sem.get("courses", [])
    }
    contamination = placed_ids & _STALE_2025_ELECTIVES
    assert not contamination, f"Stale 2025 courses found in 2027 semesters: {contamination}"


def test_2027_stale_courses_may_be_in_repo_but_never_placed():
    """Courses shared between 2025 and 2027 programs are allowed in the 2027
    repository (they belong to the program) but must never be pre-placed."""
    board = _load_2027_board()
    placed_ids = {
        c["course_id"]
        for sem in board["semesters"]
        for c in sem.get("courses", [])
    }
    contamination = placed_ids & _STALE_2025_ELECTIVES
    assert not contamination, (
        f"Old electives pre-placed in 2027 semesters: {contamination}"
    )


def test_build_program_repository_courses_returns_56_entries():
    prog = _load_pdf_program()
    repo = _build_program_repository_courses(prog)
    assert len(repo) == 56


def test_build_program_repository_courses_no_duplicates():
    prog = _load_pdf_program()
    repo = _build_program_repository_courses(prog)
    ids = [r["course_id"] for r in repo]
    assert len(ids) == len(set(ids)), "Duplicate course_ids in program_repository_courses"


def test_build_program_repository_courses_electives_have_category():
    prog = _load_pdf_program()
    repo = _build_program_repository_courses(prog)
    elective_ids = {e["course_id"] for e in prog.get("elective_courses", [])}
    for r in repo:
        if r["course_id"] in elective_ids:
            assert r["category_id"] is not None, (
                f"Elective {r['course_id']} missing category_id in program_repository_courses"
            )


def test_2027_board_build_from_empty_plan_produces_zero_placed(tmp_path):
    """build_semester_board with empty selected_courses and 2027 PDF program → 0 placed."""
    prog  = _load_pdf_program()
    board = build_semester_board({"selected_courses": []}, program=prog)
    placed = [
        c["course_id"]
        for sem in board["semesters"]
        for c in sem.get("courses", [])
    ]
    assert placed == [], f"Expected 0 placed, got: {placed}"

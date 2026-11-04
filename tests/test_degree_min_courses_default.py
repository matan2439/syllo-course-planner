"""A category with no stated minimum is "no minimum" (0), never silently "at least 1"."""
from app.analysis.course_plan_builder import _get_required_category_ids
from app.analysis.program_requirements import get_program_categories_for_frontend, validate_program_plan
from app.degrees.spec import DegreeSpec, spec_to_program


def _spec() -> DegreeSpec:
    return DegreeSpec.model_validate({
        "program_id": "p", "institution": "tau", "source_year": 2027, "total_required_credits": 20,
        "mandatory_courses": [],
        "categories": [
            {"category_id": "free", "name_he": "free", "course_ids": ["0599-1001"]},
            {"category_id": "req", "name_he": "req", "min_courses": 2, "course_ids": ["0599-2001", "0599-2002"]},
        ],
        "group_minimums": {}, "ui": {}, "legacy": {},
    })


def test_spec_to_program_emits_zero_for_unstated_minimum():
    cats = {c["category_id"]: c for c in spec_to_program(_spec())["requirements"]["elective_categories"]}
    assert cats["free"]["min_courses"] == 0
    assert cats["req"]["min_courses"] == 2


# Raw program dicts (a hand-written or older program file) with min_courses absent.
_PROGRAM = {
    "total_required_hours": 20,
    "requirements": {"elective_categories": [
        {"category_id": "free", "name_he": "free", "course_ids": ["0599-1001"]},
        {"category_id": "req", "name_he": "req", "min_courses": 1, "course_ids": ["0599-2001"]},
    ]},
}


def test_validation_treats_missing_min_courses_as_zero():
    result = validate_program_plan({"semesters": []}, _PROGRAM, [])
    by_id = {r["category_id"]: r for r in result["category_results"]}
    assert by_id["free"]["min_courses"] == 0
    assert by_id["free"]["satisfied"] and by_id["free"]["missing_count"] == 0
    assert result["missing_required_categories"] == ["req"]


def test_frontend_block_treats_missing_min_courses_as_zero():
    cats = {c["category_id"]: c for c in get_program_categories_for_frontend(_PROGRAM)["categories"]}
    assert cats["free"]["min_courses"] == 0 and cats["req"]["min_courses"] == 1


def test_plan_builder_does_not_require_category_without_minimum():
    assert _get_required_category_ids(_PROGRAM) == {"req"}

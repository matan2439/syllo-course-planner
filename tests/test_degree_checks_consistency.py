import json
from pathlib import Path

from app.degrees.checks import (
    check_courses_known,
    check_double_counting,
    check_mandatory_offered,
    check_plannable,
    check_totals,
)
from app.degrees.registry import get_program
from app.degrees.spec import DegreeSpec, load_spec, spec_path

ROOT = Path(__file__).resolve().parents[1]


def _spec(*, mandatory=(), categories=(), group_minimums=None, general=None, total=20,
          double_counting="forbidden") -> DegreeSpec:
    return DegreeSpec.model_validate({
        "program_id": "p", "institution": "tau", "source_year": 2027, "total_required_credits": total,
        "mandatory_courses": [
            {"course_id": c, "year": 1, "semester": s, "placement_rule": "r"} for c, s in mandatory
        ],
        "categories": [
            {"category_id": cid, "name_he": cid, "course_ids": ids, **kw} for cid, ids, kw in categories
        ],
        "group_minimums": group_minimums or {}, "general_requirement": general,
        "double_counting": double_counting, "ui": {}, "legacy": {},
    })


def _fact(credits=4, semesters=("A", "B"), status="offered", hours=4):
    return {
        "program": {"credits": credits, "weekly_hours": hours} if credits is not None else None,
        "offering": {"offered_semesters": list(semesters), "status": status},
    }


# ---------------------------------------------------------------- courses_known


def test_courses_known_passes_and_warns_on_unknown_offering():
    spec = _spec(mandatory=[("A-1", "A")], categories=[("c", ["C-1"], {})])
    facts = {"A-1": _fact(), "C-1": _fact(status="unknown", semesters=())}
    result = check_courses_known(spec, facts)
    assert result.passed
    assert result.problems == ["warn: offering unknown for C-1"]


def test_courses_known_fails_without_credits():
    spec = _spec(mandatory=[("A-1", "A"), ("A-2", "A")])
    result = check_courses_known(spec, {"A-1": _fact(credits=None)})
    assert not result.passed
    assert "no credits for A-1" in result.problems and "no credits for A-2" in result.problems


def test_courses_known_extra_credits_supplement():
    spec = _spec(mandatory=[("A-1", "A")])
    assert check_courses_known(spec, {}, {"A-1": 3.0}).passed


# ---------------------------------------------------------------- double counting


def test_double_counting_flags_course_in_two_categories():
    spec = _spec(categories=[("x", ["C-1"], {}), ("y", ["C-1"], {})])
    result = check_double_counting(spec)
    assert not result.passed and "C-1" in result.problems[0]


def test_double_counting_flags_mandatory_in_category_and_respects_allowed_listed():
    kwargs = dict(mandatory=[("A-1", "A")], categories=[("x", ["A-1"], {})])
    assert not check_double_counting(_spec(**kwargs)).passed
    assert check_double_counting(_spec(**kwargs, double_counting="allowed_listed")).passed
    assert check_double_counting(_spec(categories=[("x", ["C-1"], {}), ("y", ["C-2"], {})])).passed


# ---------------------------------------------------------------- mandatory offered


def test_mandatory_offered_passes_and_warns_on_missing_facts():
    spec = _spec(mandatory=[("A-1", "A"), ("A-2", "either")])
    result = check_mandatory_offered(spec, {"A-1": _fact(semesters=("A",))})
    assert result.passed
    assert result.problems == ["warn: no offering data for mandatory A-2"]


def test_mandatory_offered_fails_on_not_offered_and_wrong_semester():
    spec = _spec(mandatory=[("A-1", "A"), ("A-2", "B")])
    facts = {"A-1": _fact(status="not_offered", semesters=()), "A-2": _fact(semesters=("A",))}
    result = check_mandatory_offered(spec, facts)
    assert not result.passed and len(result.problems) == 2


# ---------------------------------------------------------------- totals


def test_totals_pass_with_group_minimum_arithmetic():
    # mandatory 4; fluids min 1 (3); solids min 1 (4); core group of 3 needs 1 more: smallest left = 4
    spec = _spec(
        total=20,
        mandatory=[("A-1", "A")],
        categories=[("fl", ["F-1", "F-2"], {"min_courses": 1, "group": "core"}),
                    ("so", ["S-1", "S-2"], {"min_courses": 1, "group": "core"})],
        group_minimums={"core": 3},
    )
    facts = {"A-1": _fact(4), "F-1": _fact(3), "F-2": _fact(5), "S-1": _fact(4), "S-2": _fact(6)}
    result = check_totals(spec, facts)
    assert result.passed, result.problems


def test_totals_fail_when_minimum_exceeds_total_and_show_numbers():
    spec = _spec(total=10, mandatory=[("A-1", "A")], categories=[("c", ["C-1"], {"min_courses": 1})])
    result = check_totals(spec, {"A-1": _fact(8), "C-1": _fact(4)})
    assert not result.passed
    assert "minimum required 12 exceeds total 10" in result.problems[0]
    assert "mandatory 8" in result.problems[0] and "c 4" in result.problems[0]


def test_totals_fail_when_full_selection_cannot_reach_total():
    spec = _spec(total=30, mandatory=[("A-1", "A")], categories=[("c", ["C-1"], {})])
    result = check_totals(spec, {"A-1": _fact(8), "C-1": _fact(4)})
    assert not result.passed and "reaches only 12 of 30" in result.problems[0]


def test_totals_general_requirement_counts_when_credits_known():
    spec = _spec(
        total=10, mandatory=[("A-1", "A")],
        general={"category_id": "g", "min_courses": 2, "course_ids": ["G-1", "G-2", "G-3"]},
    )
    facts = {"A-1": _fact(8), "G-1": _fact(2), "G-2": _fact(2), "G-3": _fact(3)}
    result = check_totals(spec, facts)  # required 8 + 4 = 12 > 10
    assert not result.passed and "general 4" in result.problems[0]


def test_totals_missing_credits_fails():
    assert not check_totals(_spec(mandatory=[("A-1", "A")]), {}).passed


# ---------------------------------------------------------------- plannable


def test_plannable_passes_clean_board_and_fails_on_error():
    ok = {"semesters": [{"semester_id": "s1", "courses": []}]}
    assert check_plannable(ok).passed
    bad = {"semesters": [{"semester_id": "s1", "courses": [{"name_he": "x"}]}]}
    result = check_plannable(bad)
    assert not result.passed and "missing_course_id" in result.problems[0]


# ---------------------------------------------------------------- ME


def test_me_spec_passes_all():
    program = get_program("mechanical_engineering_2027")
    spec = load_spec(spec_path(program))
    facts = json.loads((ROOT / "data/official/tau_course_facts_2026.json").read_text(encoding="utf-8"))
    board = json.loads((ROOT / "data/boards/mechanical_engineering_2027.json").read_text(encoding="utf-8"))
    # The facts file only covers the Y3/Y4 + elective courses; Y1/Y2 credits come from the builder's
    # own early-year course index.
    early = json.loads((ROOT / "data/config/early_year_courses.json").read_text(encoding="utf-8"))
    extra = {r["courseId"]: r["creditHours"] for r in early[program.id]}

    results = [
        check_courses_known(spec, facts, extra),
        check_double_counting(spec),
        check_mandatory_offered(spec, facts),
        check_totals(spec, facts, extra),
        check_plannable(board),
    ]
    failed = {r.name: r.problems for r in results if not r.passed}
    assert not failed, failed

import json
from pathlib import Path

from app.degrees.checks import (
    check_board_carries_requirements,
    check_courses_known,
    check_degree_length,
    check_double_counting,
    check_known_gaps,
    check_mandatory_offered,
    check_plannable,
    check_rules_enforced,
    check_totals,
)
from app.degrees.facts import load_program_facts
from app.degrees.registry import get_program
from app.degrees.spec import DegreeSpec, load_spec, spec_path

ROOT = Path(__file__).resolve().parents[1]


def _spec(*, mandatory=(), categories=(), group_minimums=None, general=None, total=20,
          double_counting="forbidden", allowed=()) -> DegreeSpec:
    return DegreeSpec.model_validate({
        "program_id": "p", "institution": "tau", "source_year": 2027, "total_required_credits": total,
        "mandatory_courses": [
            {"course_id": c, "year": 1, "semester": s, "placement_rule": "r"} for c, s in mandatory
        ],
        "categories": [
            {"category_id": cid, "name_he": cid, "course_ids": ids, **kw} for cid, ids, kw in categories
        ],
        "group_minimums": group_minimums or {}, "general_requirement": general,
        "double_counting": double_counting, "allowed_double_counted": list(allowed), "ui": {}, "legacy": {},
    })


def _fact(credits=4, semesters=("A", "B"), status="offered", hours=4):
    return {
        "program": {"credits": credits, "weekly_hours": hours} if credits is not None else None,
        "offering": {"offered_semesters": list(semesters), "status": status},
    }


# ---------------------------------------------------------------- degree_length


def _years_spec(*years, degree_years=None, rules=(), conflicts=()) -> DegreeSpec:
    data = {
        "program_id": "p", "institution": "tau", "source_year": 2027, "total_required_credits": 20,
        "mandatory_courses": [{"course_id": f"M-{i}", "year": y, "semester": "A", "placement_rule": "r"}
                              for i, y in enumerate(years)],
        "categories": [], "group_minimums": {}, "ui": {}, "legacy": {},
        "course_rules": [{"rule_id": f"dur-{i}", "kind": "study_duration", "course_ids": [], "params": params,
                          "source_ids": ["s"], "enforced_by": "board", "note": "n"}
                         for i, params in enumerate(rules)],
        "source_conflicts": list(conflicts),
    }
    if degree_years is not None:
        data["degree_years"] = degree_years
    return DegreeSpec.model_validate(data)


def test_degree_length_passes_a_four_year_degree():
    result = check_degree_length(_years_spec(1, 1, 2, 3, 4))
    assert result.passed and result.problems == []


def test_degree_length_passes_three_and_five_year_degrees():
    assert check_degree_length(_years_spec(1, 2, 3, degree_years=3)).passed
    assert check_degree_length(_years_spec(1, 2, 3, 4, 5, degree_years=5)).passed


def test_degree_length_passes_an_electives_only_final_year():
    """A year with no mandatory course (e.g. an electives-only final year) is not a refusal."""
    for years, n in [((1, 2, 3), 4), ((1, 3, 4), 4), ((1, 2), 3)]:
        result = check_degree_length(_years_spec(*years, degree_years=n))
        assert result.passed and result.problems == [], (years, n)


def test_degree_length_fails_a_mandatory_course_outside_the_degree():
    result = check_degree_length(_years_spec(1, 2, 3, 4, 5))
    assert not result.passed
    assert result.problems == ["mandatory M-4 is in year 5, outside the degree's years 1-4 (degree_years 4)"]
    result = check_degree_length(_years_spec(0, 1, 2, 3, degree_years=3))
    assert result.problems == ["mandatory M-0 is in year 0, outside the degree's years 1-3 (degree_years 3)"]


def test_degree_length_cross_checks_study_duration_rules():
    ok = _years_spec(1, 2, 3, 4, rules=[{"semesters": 8, "years": 4}, {"extension_years": 1}])
    assert check_degree_length(ok).passed
    bad = _years_spec(1, 2, 3, degree_years=3, rules=[{"semesters": 8, "years": 4}])
    result = check_degree_length(bad)
    assert not result.passed
    ask = "; record a source_conflicts entry and ask the owner which source governs"
    assert result.problems == [
        "study_duration rule dur-0 says 4 years, but degree_years is 3" + ask,
        "study_duration rule dur-0 says 8 semesters, but degree_years 3 is 6 semesters" + ask,
    ]


def test_degree_length_duration_conflict_stays_red_and_names_the_conflict():
    """A 4.5-year (9-semester) program whose page shows 4 years: recorded as a source conflict,
    still red (the owner decides which source governs; whole years cannot express 4.5 yet)."""
    spec = _years_spec(1, 2, 3, 4, rules=[{"semesters": 9, "years": 4.5}], conflicts=[
        {"course_id": None, "description": "page shows 4 years; regulations say 9 semesters",
         "sources": ["T:body:years", "s"]},
        {"course_id": None, "description": "unrelated", "sources": ["other"]},
    ])
    result = check_degree_length(spec)
    assert not result.passed
    tail = ("; recorded as source_conflicts[0] ('page shows 4 years; regulations say 9 semesters')"
            " — the owner decides which source governs")
    assert result.problems == [
        "study_duration rule dur-0 says 4.5 years, but degree_years is 4" + tail,
        "study_duration rule dur-0 says 9 semesters (not whole years: degree_years cannot express it yet), "
        "but degree_years 4 is 8 semesters" + tail,
    ]


def test_degree_years_is_validated():
    import pytest
    from pydantic import ValidationError
    assert _years_spec(1).degree_years == 4
    for n in (2, 7):
        with pytest.raises(ValidationError):
            _years_spec(1, degree_years=n)


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
    assert check_double_counting(_spec(**kwargs, double_counting="allowed_listed", allowed=["A-1"])).passed
    assert check_double_counting(_spec(categories=[("x", ["C-1"], {}), ("y", ["C-2"], {})])).passed


def test_double_counting_unlisted_duplicate_fails_under_allowed_listed():
    cats = [("x", ["C-1", "C-2"], {}), ("y", ["C-1", "C-2"], {})]
    result = check_double_counting(_spec(categories=cats, double_counting="allowed_listed", allowed=["C-1"]))
    assert not result.passed
    assert len(result.problems) == 1 and "C-2" in result.problems[0]


def test_double_counting_allow_list_with_forbidden_fails():
    result = check_double_counting(_spec(categories=[("x", ["C-1"], {})], allowed=["C-1"]))
    assert not result.passed and "allow-list set but double_counting is forbidden" in result.problems


# ---------------------------------------------------------------- mandatory offered


def test_mandatory_offered_warns_when_offered_without_semesters():
    result = check_mandatory_offered(_spec(mandatory=[("A-1", "A")]), {"A-1": _fact(semesters=())})
    assert result.passed and "warn:" in result.problems[0]


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


def test_totals_general_requirement_uses_stated_credits_without_warning():
    general = {"category_id": "g", "min_courses": 3, "credits_required": 6, "course_ids": ["G-1", "G-2"]}
    spec = _spec(total=10, mandatory=[("A-1", "A")], general=general)
    result = check_totals(spec, {"A-1": _fact(8)})  # G-* have no credits; 8 + 6 = 14 > 10
    assert not result.passed and "general 6" in result.problems[0]
    assert not any(p.startswith("warn:") for p in result.problems)
    ok = check_totals(_spec(total=14, mandatory=[("A-1", "A")], general=general), {"A-1": _fact(8)})
    assert ok.passed and ok.problems == []


def test_totals_general_requirement_without_credits_warns():
    general = {"category_id": "g", "min_courses": 3, "course_ids": ["G-1"]}
    result = check_totals(_spec(total=8, mandatory=[("A-1", "A")], general=general), {"A-1": _fact(8)})
    assert result.passed
    assert result.problems == ["warn: general requirement credits unknown (3 courses); excluded from totals"]


def test_totals_extra_credits_never_override_facts():
    spec = _spec(total=8, mandatory=[("A-1", "A")])
    assert not check_totals(spec, {"A-1": _fact(12)}, {"A-1": 1.0}).passed  # 12 from facts, not 1
    assert check_totals(spec, {"A-1": _fact(8)}, {"A-1": 99.0}).passed


def test_totals_fail_when_category_min_exceeds_listed_courses():
    spec = _spec(total=50, categories=[("c", ["C-1"], {"min_courses": 2})])
    result = check_totals(spec, {"C-1": _fact(4)})
    assert not result.passed and any("needs 2 courses but lists 1" in p for p in result.problems)


def test_totals_fail_when_group_minimum_cannot_be_met():
    spec = _spec(total=50, categories=[("c", ["C-1"], {"min_courses": 1, "group": "core"})],
                 group_minimums={"core": 3})
    result = check_totals(spec, {"C-1": _fact(4)})
    assert not result.passed and "group core needs 2 more courses but only 0 remain" in result.problems


def test_totals_missing_credits_fails():
    assert not check_totals(_spec(mandatory=[("A-1", "A")]), {}).passed


# ---------------------------------------------------------------- plannable


def test_plannable_passes_clean_board_and_fails_on_error():
    ok = {"semesters": [{"semester_id": "s1", "courses": []}]}
    assert check_plannable(ok).passed
    bad = {"semesters": [{"semester_id": "s1", "courses": [{"name_he": "x"}]}]}
    result = check_plannable(bad)
    assert not result.passed and "missing_course_id" in result.problems[0]


# ---------------------------------------------------------------- rules_enforced


def _with_rules(*rules) -> DegreeSpec:
    data = _spec().model_dump(mode="json")
    data["course_rules"] = [
        {"rule_id": rid, "kind": "annual", "course_ids": ["A-1"], "source_ids": ["e"],
         "enforced_by": by, "note": f"note {rid}"} for rid, by in rules
    ]
    return DegreeSpec.model_validate(data)


def test_rules_enforced_passes_when_board_enforces_or_no_rules():
    assert check_rules_enforced(_spec()).passed
    result = check_rules_enforced(_with_rules(("r1", "board")))
    assert result.passed and result.problems == []


def test_rules_enforced_fails_per_unenforced_rule():
    result = check_rules_enforced(_with_rules(("r1", "board"), ("r2", "none"), ("r3", "none")))
    assert not result.passed and result.name == "rules_enforced"
    assert result.problems == ["unenforced rule r2: note r2", "unenforced rule r3: note r3"]


def test_known_gaps_fail_one_problem_per_gap():
    assert check_known_gaps(_spec()).passed
    data = _spec().model_dump(mode="json")
    data["known_gaps"] = [{"gap_id": "g1", "description": "unread pdf", "source_ids": ["e"]}]
    result = check_known_gaps(DegreeSpec.model_validate(data))
    assert not result.passed and result.name == "known_gaps"
    assert result.problems == ["known gap g1: unread pdf"]


# ---------------------------------------------------------------- board carries requirements


def test_board_carries_generic_group_minimum():
    spec = _spec(categories=[("c1", ["A"], {"group": "core", "min_courses": 1}),
                             ("t1", ["B"], {"group": "track", "min_courses": 0}),
                             ("e1", ["C"], {})],  # a plain category: every category reaches the board list
                 group_minimums={"core": 6, "track": 12})
    result = check_board_carries_requirements(spec)
    assert result.passed and result.name == "board_carries_requirements"


def test_board_carries_passes_core_only_and_plain_categories():
    spec = _spec(categories=[("c1", ["A"], {"group": "core", "min_courses": 1}),
                             ("e1", ["B"], {"min_courses": None})],
                 group_minimums={"core": 1})
    assert check_board_carries_requirements(spec).passed


def test_board_carries_fails_on_category_min_credits():
    spec = _spec(categories=[("e1", ["A", "B"], {"min_credits": 6})])
    result = check_board_carries_requirements(spec)
    assert not result.passed
    assert len(result.problems) == 1 and "categories[e1].min_credits" in result.problems[0]


def test_board_carries_fails_on_category_the_board_never_receives():
    # an unkeyed category in a non-core group with no plain category beside it reaches no board list
    spec = _spec(categories=[("c1", ["A"], {"group": "core", "min_courses": 1}),
                             ("t1", ["B"], {"group": "track", "min_courses": 1})],
                 group_minimums={"core": 1})
    result = check_board_carries_requirements(spec)
    assert not result.passed
    assert any("categories[t1]" in p for p in result.problems)



def test_board_carries_names_shadowed_keyed_category():
    # a keyed category is dropped once a plain category makes spec_to_program emit elective_categories
    data = _spec(categories=[("labs", ["A"], {"min_courses": 1}), ("e1", ["B"], {})]).model_dump()
    data["legacy"] = {"requirement_category_keys": {"advanced_labs": "labs"}}
    result = check_board_carries_requirements(DegreeSpec.model_validate(data))
    assert not result.passed
    assert len(result.problems) == 1
    assert "categories[labs]" in result.problems[0] and "requirements.advanced_labs" in result.problems[0]
    assert "shadowed" in result.problems[0] and "elective_categories" in result.problems[0]


def _general(credits_required, min_courses=3):
    return {"category_id": "g", "name_he": "g", "min_courses": min_courses,
            "credits_required": credits_required, "course_ids": ["G1"]}


def test_board_carries_general_credits_matching_course_count_passes():
    assert check_board_carries_requirements(_spec(general=_general(6))).passed  # TAU: 3 x 2


def test_board_carries_general_credits_mismatch_fails():
    result = check_board_carries_requirements(_spec(general=_general(8)))
    assert not result.passed
    assert len(result.problems) == 1
    assert "general_requirement.credits_required" in result.problems[0] and "8" in result.problems[0]


def test_board_carries_general_credits_unverifiable_fails(monkeypatch):
    from app.degrees.checks import consistency
    monkeypatch.setattr(consistency, "load_institution", lambda _id: {"id": "tau", "generalRequirement": {}})
    result = check_board_carries_requirements(_spec(general=_general(6)))
    assert not result.passed
    assert "general_requirement.credits_required" in result.problems[0]
    assert "creditsPerCourse" in result.problems[0]

# ---------------------------------------------------------------- ME


def test_me_spec_passes_all():
    program = get_program("mechanical_engineering_2027")
    spec = load_spec(spec_path(program))
    facts = load_program_facts(program.source_year, program.source_ids["tcid"])
    board = json.loads((ROOT / "data/boards/mechanical_engineering_2027.json").read_text(encoding="utf-8"))

    results = [
        check_courses_known(spec, facts),
        check_double_counting(spec),
        check_mandatory_offered(spec, facts),
        check_totals(spec, facts),
        check_plannable(board),
        check_degree_length(spec),
        check_board_carries_requirements(spec),
    ]
    failed = {r.name: r.problems for r in results if not r.passed}
    assert not failed, failed

    # `degree.py refresh` covers every course the spec references (all mandatory years,
    # every category, the general pool), so no extra credits are needed.
    referenced = {m.course_id for m in spec.mandatory_courses}
    referenced |= {c for cat in spec.categories for c in cat.course_ids}
    referenced |= set(spec.general_requirement["course_ids"])
    assert referenced <= set(facts)
    # Honest remaining warning: שער רוח courses are not in the program listing, so TAU
    # publishes no per-course credits for them there. The requirement's total (6, from the
    # official שער רוח sections) is stated in credits_required, so totals no longer warns.
    by_name = {r.name: set(r.problems) for r in results}
    assert by_name["courses_known"] == {"warn: general requirement: 88 course(s) have no credits"}
    assert by_name["mandatory_offered"] == set()
    assert spec.general_requirement["credits_required"] == 6
    assert by_name["totals"] == set()
    assert not by_name["double_counting"] and not by_name["plannable"]

"""The EE core rule may claim board enforcement only when its evaluator inputs survive."""
import copy
import json
from pathlib import Path

import pytest

from app.degrees.checks.consistency import check_rules_enforced
from app.degrees.spec import load_spec

DATA = Path(__file__).resolve().parents[1] / "data"
RULE_ID = "core-four-distinct-tracks"


@pytest.fixture
def core_release():
    spec = load_spec(DATA / "degrees/tau/electrical_engineering/2027/spec.json")
    board = json.loads((DATA / "boards/electrical_engineering_2027.json").read_text(encoding="utf-8"))
    rule = next(rule for rule in spec.course_rules if rule.rule_id == RULE_ID)
    rule = rule.model_copy(update={"enforced_by": "board"})
    spec = spec.model_copy(update={"course_rules": [rule]})
    board["metadata"]["degree_rules"] = [rule.model_dump()]
    return spec, board


def test_actual_main_board_carries_full_core_definition_and_current_track_pool(core_release):
    spec, board = core_release
    rule = spec.course_rules[0]
    track = {cid for cat in spec.categories if cat.group == "track" for cid in cat.course_ids}
    assert set(rule.course_ids) - track == {"0512-4262", "0555-4551"}
    assert check_rules_enforced(spec, {"board": board}).passed
    assert not check_rules_enforced(spec).passed
    assert not check_rules_enforced(spec, {"early_years": board}).passed


@pytest.mark.parametrize("mutation", [
    "remove_rule", "duplicate_rule", "remove_members", "drop_historical_core",
    "widen_core", "reassign_core", "remove_minimum", "lower_minimum", "widen_minimum",
    "remove_categories", "remove_track_category", "remove_track_group", "remove_track_course",
    "widen_track_pool", "labs_in_track", "remove_lab_pool", "widen_lab_pool", "remove_candidate",
])
def test_missing_or_changed_board_inputs_fail(core_release, mutation):
    spec, board = core_release
    meta = board["metadata"]
    definition = meta["degree_rules"][0]
    requirements = meta["program_requirements_categories"]
    categories = requirements["categories"]
    track = next(cat for cat in categories if cat.get("group") == "track")
    if mutation == "remove_rule":
        meta.pop("degree_rules")
    elif mutation == "duplicate_rule":
        meta["degree_rules"].append(copy.deepcopy(definition))
    elif mutation == "remove_members":
        definition["params"].pop("category_members")
    elif mutation == "drop_historical_core":
        definition["course_ids"].remove("0512-4262")
        definition["params"]["category_members"]["signal_processing"].remove("0512-4262")
    elif mutation == "widen_core":
        definition["course_ids"].append("0512-4290")
        definition["params"]["category_members"]["signal_processing"].append("0512-4290")
    elif mutation == "reassign_core":
        definition["params"]["category_members"]["communications"].append("0512-4264")
    elif mutation == "remove_minimum":
        requirements.pop("group_minimums")
    elif mutation == "lower_minimum":
        requirements["group_minimums"]["track"] = 11
    elif mutation == "widen_minimum":
        requirements["group_minimums"]["track"] = 13
    elif mutation == "remove_categories":
        requirements.pop("categories")
    elif mutation == "remove_track_category":
        categories.remove(track)
    elif mutation == "remove_track_group":
        track.pop("group")
    elif mutation == "remove_track_course":
        track["course_ids"].pop()
    elif mutation == "widen_track_pool":
        track["course_ids"].append("UNKNOWN")
    elif mutation == "labs_in_track":
        next(cat for cat in categories if cat["category_id"] == "advanced_labs")["group"] = "track"
    elif mutation == "remove_lab_pool":
        categories[:] = [cat for cat in categories if cat["category_id"] != "advanced_labs"]
    elif mutation == "widen_lab_pool":
        next(cat for cat in categories if cat["category_id"] == "advanced_labs")["course_ids"].append(track["course_ids"][0])
    elif mutation == "remove_candidate":
        cid = track["course_ids"][0]
        meta["program_repository_courses"] = [c for c in meta["program_repository_courses"] if c["course_id"] != cid]
    result = check_rules_enforced(spec, {"board": board})
    assert not result.passed
    assert any(RULE_ID in problem for problem in result.problems)


@pytest.mark.parametrize("field,value", [
    ("min_courses", 3), ("min_courses", True), ("min_distinct_categories", 3),
    ("within_track_courses_min", 11), ("within_track_courses_min", 12.0),
    ("labs_excluded_from_track_count", False), ("unsupported", True),
    ("category_members", {}), ("category_members", {"communications": "0512-4100"}),
    ("category_members", {"communications": [""]}),
])
def test_matching_malformed_spec_and_board_cannot_claim_enforcement(core_release, field, value):
    spec, board = core_release
    rule = spec.course_rules[0]
    rule = rule.model_copy(update={"params": {**rule.params, field: value}})
    spec = spec.model_copy(update={"course_rules": [rule]})
    board["metadata"]["degree_rules"] = [rule.model_dump()]
    assert not check_rules_enforced(spec, {"board": board}).passed


def test_unenforced_core_remains_a_release_blocker(core_release):
    spec, board = core_release
    rule = spec.course_rules[0].model_copy(update={"enforced_by": "none"})
    result = check_rules_enforced(spec.model_copy(update={"course_rules": [rule]}), {"board": board})
    assert not result.passed
    assert any(f"unenforced rule {RULE_ID}" in problem for problem in result.problems)


@pytest.mark.parametrize("mutation", ["wrong_kind", "duplicate_id", "incomplete_union", "unknown_track", "duplicate_member"])
def test_invalid_core_identity_and_membership_shapes_fail(core_release, mutation):
    spec, board = core_release
    rule = spec.course_rules[0].model_copy(deep=True)
    if mutation == "wrong_kind":
        rule.kind = "language_requirement"
    elif mutation == "duplicate_id":
        rule.course_ids.append(rule.course_ids[0])
    elif mutation == "incomplete_union":
        rule.course_ids.pop()
    elif mutation == "unknown_track":
        rule.params["category_members"]["unknown"] = rule.params["category_members"].pop("communications")
    elif mutation == "duplicate_member":
        rule.params["category_members"]["communications"].append("0512-4100")
    board["metadata"]["degree_rules"] = [rule.model_dump()]
    result = check_rules_enforced(spec.model_copy(update={"course_rules": [rule]}), {"board": board})
    assert not result.passed


@pytest.fixture
def self_reference_release():
    spec = load_spec(DATA / "degrees/tau/electrical_engineering/2027/spec.json")
    rule = next(rule for rule in spec.course_rules if rule.rule_id == "excl-0512-4506-as-printed")
    boards = {
        name: json.loads((DATA / "boards" / filename).read_text(encoding="utf-8"))
        for name, filename in (
            ("board", "electrical_engineering_2027.json"),
            ("early_years", "electrical_engineering_years_1_2_2027.json"),
        )
    }
    # Simulate a rebuild copying the accepted definition, without editing generated files.
    for board in boards.values():
        board["metadata"]["degree_rules"] = [
            rule.model_dump() if definition["rule_id"] == rule.rule_id else definition
            for definition in board["metadata"]["degree_rules"]
        ]
    return spec.model_copy(update={"course_rules": [rule]}), boards


def test_published_self_reference_requires_exact_definition_in_both_windows(self_reference_release):
    spec, boards = self_reference_release
    assert spec.course_rules[0].params["published_self_reference"] is True
    assert spec.course_rules[0].enforced_by == "board"
    assert check_rules_enforced(spec, boards).passed
    for name in boards:
        broken = copy.deepcopy(boards)
        broken[name]["metadata"]["degree_rules"] = []
        assert not check_rules_enforced(spec, broken).passed
        broken[name]["metadata"]["degree_rules"] = [spec.course_rules[0].model_dump()]
        broken[name]["metadata"]["degree_rules"][0]["params"]["other_course_as_printed"] = "05124507"
        assert not check_rules_enforced(spec, broken).passed


@pytest.mark.parametrize("ids,params", [
    ([], {"published_self_reference": True, "other_course_as_printed": "05124506"}),
    (["0512-4506", "0512-4506"], {"published_self_reference": True, "other_course_as_printed": "05124506"}),
    (["0512-4506", "0512-4507"], {"published_self_reference": True, "other_course_as_printed": "05124506"}),
    (["0512-4506"], {"published_self_reference": False, "other_course_as_printed": "05124506"}),
    (["0512-4506"], {"published_self_reference": 1, "other_course_as_printed": "05124506"}),
    (["0512-4506"], {"published_self_reference": True, "other_course_as_printed": "05124507"}),
    (["0512-4506"], {"published_self_reference": True}),
    (["0512-4506"], {"published_self_reference": True, "other_course_as_printed": 5124506}),
    (["0512-4506"], {"published_self_reference": True, "other_course_as_printed": "05124506", "unknown": True}),
    (["COURSE"], {"published_self_reference": True, "other_course_as_printed": "COURSE"}),
    (["", "0512-4506"], {}),
])
def test_all_other_exclusion_shapes_fail_even_when_copied_to_both_windows(self_reference_release, ids, params):
    spec, boards = self_reference_release
    rule = spec.course_rules[0].model_copy(update={"course_ids": ids, "params": params})
    for board in boards.values():
        board["metadata"]["degree_rules"] = [rule.model_dump()]
    result = check_rules_enforced(spec.model_copy(update={"course_rules": [rule]}), boards)
    assert not result.passed


@pytest.mark.parametrize("printed", ["0512.4506", " 0512-4506 "])
def test_self_reference_compares_digits_without_inferring_another_course(self_reference_release, printed):
    spec, boards = self_reference_release
    rule = spec.course_rules[0]
    rule = rule.model_copy(update={"params": {**rule.params, "other_course_as_printed": printed}})
    for board in boards.values():
        board["metadata"]["degree_rules"] = [rule.model_dump()]
    assert check_rules_enforced(spec.model_copy(update={"course_rules": [rule]}), boards).passed

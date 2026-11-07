import copy
import json
from pathlib import Path

from app.degrees.checks.consistency import check_rules_enforced
from app.degrees.facts import load_program_facts
from app.degrees.offering_windows import apply_offering_windows
from app.degrees.spec import load_spec

ROOT = Path(__file__).resolve().parent.parent
DATA = ROOT / "data"
COURSE = "0512-4013"
RULE = "window-0512-4013"


def test_audited_course_exclusions_must_reach_both_windows():
    spec = load_spec(DATA / "degrees/tau/electrical_engineering/2027/spec.json")
    verified = [rule for rule in spec.course_rules
                if rule.kind == "mutually_exclusive" and rule.enforced_by == "board"
                and len(rule.course_ids) == 2 and not rule.params]
    assert len(verified) == 5
    spec = spec.model_copy(update={"course_rules": verified})
    boards = {
        "board": json.loads((DATA / "boards/electrical_engineering_2027.json").read_text(encoding="utf-8")),
        "early_years": json.loads((DATA / "boards/electrical_engineering_years_1_2_2027.json").read_text(encoding="utf-8")),
    }
    assert check_rules_enforced(spec, boards).passed
    rules = boards["early_years"]["metadata"]["degree_rules"]
    rules.remove(verified[0].model_dump())
    assert not check_rules_enforced(spec, boards).passed


def test_built_ee_offering_window_and_release_check():
    spec = load_spec(DATA / "degrees/tau/electrical_engineering/2027/spec.json")
    facts = load_program_facts(2026, "7622")
    boards = {
        window: json.loads((DATA / "boards" / name).read_text(encoding="utf-8"))
        for window, name in (
            ("board", "electrical_engineering_2027.json"),
            ("early_years", "electrical_engineering_years_1_2_2027.json"),
        )
    }
    window_rule = next(rule for rule in spec.course_rules if rule.rule_id == RULE)
    assert window_rule.enforced_by == "board"
    eligibility = next(rule for rule in spec.course_rules if rule.rule_id == "cohort-0512-4013")
    assert eligibility.enforced_by == "none"
    assert eligibility.model_dump() in boards["board"]["metadata"]["degree_rules"]
    spec = spec.model_copy(update={"course_rules": [window_rule]})
    assert check_rules_enforced(spec, boards, facts).passed
    assert not check_rules_enforced(spec, {"board": boards["board"]}, facts).passed

    for window, expected in (("board", []), ("early_years", ["year_1_semester_b", "year_2_semester_a"])):
        broken = copy.deepcopy(boards)
        meta = broken[window]["metadata"]
        row = next(c for c in meta["program_repository_courses"] if c["course_id"] == COURSE)
        assert row["offering_window_semesters"] == row["effective_allowed_semesters"] == expected
        assert row["offered_semesters"] == ["A", "B"]
        row.pop("offering_window_semesters")
        assert not check_rules_enforced(spec, broken, facts).passed
        row["offering_window_semesters"] = expected
        row["effective_allowed_semesters"] = [*expected, "year_4_semester_a"]
        assert not check_rules_enforced(spec, broken, facts).passed
        row["effective_allowed_semesters"] = expected
        meta["degree_rules"] = []
        assert not check_rules_enforced(spec, broken, facts).passed


def test_window_intersects_verified_offerings_without_falling_back():
    course = {
        "course_id": COURSE, "offered_semesters": ["A"],
        "offering_source_confidence": "high", "offered_in_year": True,
    }
    board = {
        "semesters": [
            {"semester_id": sid}
            for sid in ("year_1_semester_a", "year_1_semester_b", "year_2_semester_a")
        ],
        "metadata": {
            "degree_rules": [{
                "kind": "offering_window", "course_ids": [COURSE], "params": {"semesters": [2, 3]},
            }],
            "program_repository_courses": [course],
        },
    }
    apply_offering_windows(board)
    assert course["offering_window_semesters"] == ["year_2_semester_a"]

    course["offering_source_confidence"] = "unverified"
    apply_offering_windows(board)
    assert course["offering_window_semesters"] == []

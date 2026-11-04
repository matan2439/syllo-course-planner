from datetime import datetime, timezone

from app.degrees.coverage_suggest import suggest_coverage
from app.degrees.evidence import EvidenceItem
from app.degrees.spec import DegreeSpec, MappedTo, resolve_spec_path

NOW = datetime(2026, 11, 4, tzinfo=timezone.utc)
T = "tau:8715:2026"


def _item(id_, kind, course_id=None, cancelled=False) -> EvidenceItem:
    return EvidenceItem(id=id_, source_url="https://example.test", fetched_at=NOW, from_cache=False,
                        kind=kind, path=["x"], raw_text="t", course_id=course_id, cancelled=cancelled)


def _spec(legacy=None) -> DegreeSpec:
    return DegreeSpec.model_validate({
        "program_id": "p", "institution": "tau", "source_year": 2026, "total_required_credits": 160,
        "mandatory_courses": [{"course_id": "M-1", "year": 1, "semester": "A", "placement_rule": "r"},
                              {"course_id": "BOTH", "year": 1, "semester": "A", "placement_rule": "r"}],
        "categories": [
            {"category_id": "fluids", "name_he": "f", "course_ids": ["F-1", "TWO"]},
            {"category_id": "solids", "name_he": "s", "course_ids": ["S-1", "TWO", "BOTH"]},
        ],
        "group_minimums": {}, "general_requirement": {"category_id": "g", "course_ids": ["G-1"]},
        "ui": {}, "legacy": legacy or {},
    })


def test_course_listing_mapped_to_its_single_home():
    spec = _spec()
    items = [_item(f"{T}:rama:1:kurs:M1", "course_listing", "M-1"),
             _item(f"{T}:rama:2:kurs:F1", "course_listing", "F-1"),
             _item(f"{T}:rama:2:kurs:G1", "course_listing", "G-1")]
    out = suggest_coverage(items, spec)
    assert out == {
        f"{T}:rama:1:kurs:M1": MappedTo(mapped_to="mandatory_courses[M-1]"),
        f"{T}:rama:2:kurs:F1": MappedTo(mapped_to="categories[fluids].course_ids[F-1]"),
        f"{T}:rama:2:kurs:G1": MappedTo(mapped_to="general_requirement"),
    }
    assert all(resolve_spec_path(spec, t) for e in out.values() for t in e.targets)


def test_course_facts_follow_the_course():
    items = [_item(f"{T}:timetable:S-1", "course_fact", "S-1"), _item("tau:ims:2026:M-1", "course_fact", "M-1")]
    out = suggest_coverage(items, _spec())
    assert out[f"{T}:timetable:S-1"].mapped_to == "categories[solids].course_ids[S-1]"
    assert out["tau:ims:2026:M-1"].mapped_to == "mandatory_courses[M-1]"


def test_ambiguous_unknown_and_cancelled_courses_are_left_out():
    items = [_item("a", "course_listing", "TWO"),       # two categories
             _item("b", "course_listing", "BOTH"),      # mandatory and a category
             _item("c", "course_listing", "NOPE"),      # not in the spec
             _item("d", "course_listing", "M-1", cancelled=True),
             _item("e", "course_listing", None)]
    assert suggest_coverage(items, _spec()) == {}


def test_rule_policy_and_program_texts_are_never_suggested():
    items = [_item(f"{T}:rama:1:kurs:M1:hearakurs:abc", "rule_text", "M-1"),
             _item(f"{T}:rama:1:hesber:abc", "rule_text"),
             _item(f"{T}:body:terms:abc", "policy_text"),
             _item(f"{T}:body:teurtochnit", "program_text")]
    assert suggest_coverage(items, _spec()) == {}


def test_section_mapped_only_when_legacy_names_its_ramaid():
    legacy = {"sections": [{"ramaid": 7, "category_id": "fluids"},
                           {"ramaid": "8", "category_id": "fluids"}, {"ramaid": "8", "category_id": "solids"},
                           {"ramaid": "9", "category_id": "unknown_cat"}]}
    items = [_item(f"{T}:rama:7", "section"), _item(f"{T}:rama:8", "section"),
             _item(f"{T}:rama:9", "section"), _item(f"{T}:rama:10", "section")]
    out = suggest_coverage(items, _spec(legacy))
    assert out == {f"{T}:rama:7": MappedTo(mapped_to="categories[fluids]")}
    assert suggest_coverage(items, _spec()) == {}


def _core_note(id_, course_id, track="אופטיקה ופוטוניקה") -> EvidenceItem:
    return EvidenceItem(id=id_, source_url="https://example.test", fetched_at=NOW, from_cache=False,
                        kind="rule_text", path=["x"], raw_text=f"קורס ליבה במסלול {track}", course_id=course_id,
                        data={"core_of_track": track})


def _spec_with_rules(*rules) -> DegreeSpec:
    spec = _spec().model_dump()
    spec["course_rules"] = [{"rule_id": rid, "kind": "distinct_categories", "course_ids": ids,
                             "params": {"min_courses": 1, "min_distinct_categories": 1,
                                        "category_members": {"fluids": [i for i in ids if i in ("F-1", "TWO")],
                                                             "solids": [i for i in ids if i not in ("F-1", "TWO")]}},
                             "source_ids": ["x"], "enforced_by": "none", "note": "n"} for rid, ids in rules]
    for r in spec["course_rules"]:
        r["params"]["category_members"] = {k: v for k, v in r["params"]["category_members"].items() if v}
    return DegreeSpec.model_validate(spec)


def test_core_of_track_note_maps_to_the_one_distinct_categories_rule_listing_the_course():
    spec = _spec_with_rules(("core", ["F-1", "S-1"]), ("other", ["TWO"]))
    items = [_core_note(f"{T}:rama:1:kurs:F1:hearakurs:a", "F-1"), _core_note(f"{T}:rama:1:kurs:T:hearakurs:a", "TWO")]
    out = suggest_coverage(items, spec)
    assert out == {items[0].id: MappedTo(mapped_to="course_rules[core]"),
                   items[1].id: MappedTo(mapped_to="course_rules[other]")}
    assert all(resolve_spec_path(spec, t) for e in out.values() for t in e.targets)


def test_core_of_track_note_without_exactly_one_rule_is_left_out():
    two_rules = _spec_with_rules(("a", ["F-1", "S-1"]), ("b", ["F-1", "TWO"]))
    assert suggest_coverage([_core_note("n1", "F-1")], two_rules) == {}      # two rules list it
    assert suggest_coverage([_core_note("n2", "G-1")], two_rules) == {}      # no rule lists it
    assert suggest_coverage([_core_note("n3", "F-1")], _spec()) == {}        # no rules at all
    plain = _item("n4", "rule_text", "F-1")                                   # an ordinary note
    assert suggest_coverage([plain], _spec_with_rules(("a", ["F-1", "S-1"]))) == {}

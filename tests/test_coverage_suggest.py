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
                        data={"core_of_track": [track]})


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


# ---- multi-home courses (a course the spec holds in several places)

def _listing(id_, course_id, path, data=None, cancelled=False) -> EvidenceItem:
    return EvidenceItem(id=id_, source_url="https://example.test", fetched_at=NOW, from_cache=False,
                        kind="course_listing", path=list(path), raw_text="t", course_id=course_id,
                        cancelled=cancelled, data=data or {})


def _multi_spec() -> DegreeSpec:
    spec = _spec().model_dump()
    spec["categories"] = [
        {"category_id": "comm", "name_he": "מסלול  <b>תקשורת</b>", "course_ids": ["X-1", "Y-1", "BOTH"]},
        {"category_id": "sig", "name_he": "מסלול עיבוד אותות", "course_ids": ["X-1", "Y-1"]},
        {"category_id": "dup", "name_he": "מסלול עיבוד אותות", "course_ids": ["Y-1"]},
    ]
    return DegreeSpec.model_validate(spec)


def test_multi_home_listing_goes_to_the_category_named_by_its_section():
    spec = _multi_spec()
    items = [_listing(f"{T}:rama:5:kurs:X1", "X-1", ["שנה ג'", "קורסי מסלול", "מסלול תקשורת"]),
             _listing(f"{T}:rama:6:kurs:X1", "X-1", ["שנה ג'", "קורסי מסלול", " מסלול   עיבוד אותות "]),
             _listing(f"{T}:rama:5:kurs:BOTH", "BOTH", ["שנה ג'", "מסלול תקשורת"])]   # mandatory + comm
    out = suggest_coverage(items, spec)
    assert out == {items[0].id: MappedTo(mapped_to="categories[comm].course_ids[X-1]"),
                   items[1].id: MappedTo(mapped_to="categories[sig].course_ids[X-1]"),
                   items[2].id: MappedTo(mapped_to="categories[comm].course_ids[BOTH]")}
    assert all(resolve_spec_path(spec, t) for e in out.values() for t in e.targets)


def test_multi_home_listing_is_never_guessed():
    spec = _multi_spec()
    items = [_listing("a", "X-1", ["שנה ג'", "סמסטר א' (5) - קורסי חובה"]),       # path names no category
             _listing("b", "Y-1", ["שנה ג'", "מסלול עיבוד אותות"]),               # two categories share the name
             _listing("c", "X-1", ["מסלול תקשורת", "משהו אחר"]),                  # only the LAST element counts
             _listing("d", "X-1", ["מסלול תקשורת"], cancelled=True),
             _listing("e", "BOTH", ["מסלול עיבוד אותות"])]                       # sig does not hold BOTH
    assert suggest_coverage(items, spec) == {}


def test_multi_home_listing_matches_a_repeated_sections_other_locations():
    spec = _multi_spec()
    section = EvidenceItem(id=f"{T}:rama:9", source_url="https://example.test", fetched_at=NOW, from_cache=False,
                           kind="section", path=["סיכום", "רשימה משותפת"], raw_text="רשימה משותפת",
                           data={"also_at": ["שנה ג' > קורסי מסלול > מסלול תקשורת"]})
    listing = _listing(f"{T}:rama:9:kurs:X1", "X-1", ["סיכום", "רשימה משותפת"])
    pdf_style = _listing("pdf:1", "X-1", ["עמוד"], data={"also_at": [{"page": 2, "path": ["א", "מסלול עיבוד אותות"]}]})
    out = suggest_coverage([section, listing, pdf_style], spec)
    assert out[listing.id] == MappedTo(mapped_to="categories[comm].course_ids[X-1]")
    assert out[pdf_style.id] == MappedTo(mapped_to="categories[sig].course_ids[X-1]")


def test_multi_home_course_fact_goes_to_mandatory_or_every_home():
    spec = _multi_spec()
    items = [_item(f"{T}:timetable:BOTH", "course_fact", "BOTH"), _item("tau:ims:2026:X-1", "course_fact", "X-1"),
             _item(f"{T}:timetable:Y-1", "course_fact", "Y-1"), _item("cancelled", "course_fact", "X-1", cancelled=True)]
    out = suggest_coverage(items, spec)
    assert out == {
        items[0].id: MappedTo(mapped_to="mandatory_courses[BOTH]"),
        items[1].id: MappedTo(mapped_to=["categories[comm].course_ids[X-1]", "categories[sig].course_ids[X-1]"]),
        items[2].id: MappedTo(mapped_to=["categories[comm].course_ids[Y-1]", "categories[sig].course_ids[Y-1]",
                                         "categories[dup].course_ids[Y-1]"]),
    }
    assert all(resolve_spec_path(spec, t) for e in out.values() for t in e.targets)


# ---- reusing another degree's mappings

from app.degrees.coverage_suggest import reuse_coverage  # noqa: E402
from app.degrees.spec import NotPlanningRule  # noqa: E402


def _ev(id_, text, kind="rule_text") -> EvidenceItem:
    return EvidenceItem(id=id_, source_url="https://example.test", fetched_at=NOW, from_cache=False,
                        kind=kind, path=["x"], raw_text=text)


def test_reuse_copies_identical_evidence_only_into_uncovered_resolvable_ids():
    here = _spec().model_copy(update={"coverage": {"kept": NotPlanningRule(not_planning_rule="mine")}})
    other = _spec().model_copy(update={"coverage": {
        "same": MappedTo(mapped_to="categories[fluids]"),
        "npr": NotPlanningRule(not_planning_rule="policy"),
        "two": MappedTo(mapped_to=["categories[fluids]", "mandatory_courses[M-1]"]),
        "differs": MappedTo(mapped_to="categories[fluids]"),
        "kept": MappedTo(mapped_to="categories[solids]"),
        "unresolved": MappedTo(mapped_to=["categories[fluids]", "categories[nope]"]),
        "only_other": MappedTo(mapped_to="categories[fluids]"),
    }})
    mine = [_ev(i, "same text") for i in ("same", "npr", "two", "kept", "unresolved", "uncovered_there")]
    mine.append(_ev("differs", "new wording"))
    theirs = [_ev(i, "same text") for i in ("same", "npr", "two", "kept", "unresolved", "only_other",
                                            "uncovered_there")]
    theirs.append(_ev("differs", "old wording"))
    result = reuse_coverage(mine, here, theirs, other)
    assert result.copied == {"same": MappedTo(mapped_to="categories[fluids]"),
                             "npr": NotPlanningRule(not_planning_rule="policy"),
                             "two": MappedTo(mapped_to=["categories[fluids]", "mandatory_courses[M-1]"])}
    assert result.needs_review == {"unresolved": other.coverage["unresolved"]}
    assert result.differing == ["differs"]
    assert "kept" not in result.copied  # never overwrites


def test_reuse_leaves_course_items_homed_here_to_suggestions():
    # ME-style: a shared tau:ims id with a degree-specific reason must not leak into another degree
    other = _spec().model_copy(update={"coverage": {
        "tau:ims:2026:F-1": NotPlanningRule(not_planning_rule="Specialization-track elective TAU marks as not taught"),
        "tau:ims:2026:ZZ-9": NotPlanningRule(not_planning_rule="not in this degree"),
        "pdf:sentence": NotPlanningRule(not_planning_rule="admin policy"),
    }})
    mine = [_ev("tau:ims:2026:F-1", "same", kind="course_fact").model_copy(update={"course_id": "F-1"}),
            _ev("tau:ims:2026:ZZ-9", "same", kind="course_fact").model_copy(update={"course_id": "ZZ-9"}),
            _ev("pdf:sentence", "same", kind="policy_text")]
    result = reuse_coverage(mine, _spec(), list(mine), other)
    assert result.needs_review == {"tau:ims:2026:F-1": other.coverage["tau:ims:2026:F-1"]}
    assert result.copied == {"tau:ims:2026:ZZ-9": other.coverage["tau:ims:2026:ZZ-9"],   # no home here
                             "pdf:sentence": other.coverage["pdf:sentence"]}

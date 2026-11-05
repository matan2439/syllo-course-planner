"""The committed ME spec accounts for every item of the committed official evidence."""
import json

from app.degrees.checks import check_coverage
from app.degrees.coverage_suggest import suggest_coverage
from app.degrees.evidence import EvidenceItem
from app.degrees.registry import get_program
from app.degrees.spec import NotPlanningRule, load_spec, spec_path


def _load():
    path = spec_path(get_program("mechanical_engineering_2027"))
    items = [EvidenceItem.model_validate(i)
             for i in json.loads(path.with_name("evidence.json").read_text(encoding="utf-8"))]
    return items, load_spec(path)


def test_me_coverage_passes_on_committed_evidence():
    items, spec = _load()
    result = check_coverage(items, spec)
    assert result.passed, result.problems[:20]


def test_not_planning_rule_reasons_are_concrete():
    _, spec = _load()
    short = {k: e.not_planning_rule for k, e in spec.coverage.items()
             if isinstance(e, NotPlanningRule) and len(e.not_planning_rule.strip()) < 10}
    assert not short, short


def test_suggestions_agree_with_committed_coverage():
    """Every auto-suggestion is what the reviewed coverage says (hand edits never contradict it)."""
    items, spec = _load()
    suggested = suggest_coverage(items, spec)
    assert suggested
    assert {k: spec.coverage.get(k) for k in suggested} == suggested


def test_course_rules_unenforced_set_is_pinned():
    """Honest gate: exactly these official rules are recorded but not enforced yet. Shrink
    this set as the board/planner learns to enforce them; never grow it silently."""
    from app.degrees.checks import check_rules_enforced

    _, spec = _load()
    result = check_rules_enforced(spec)
    unenforced = {p.split(":")[0].removeprefix("unenforced rule ") for p in result.problems}
    assert unenforced == {
        "cohort-excellence-0542-4011-0542-4012",
        "equiv-0542-1510-0509-1510",
        "exempt-music-tech-shaar-ruach",
        "prereq-sub-0512-4362-0542-3243",
        "window-0542-2500",
        "year-0509-4010",
        # faculty regulations (Terms_BA.pdf), read and mapped item by item
        "duration-extension",
        "graduate-courses-max-2-per-semester",
        "load-min-75pct-approval",
        "prereq-before-or-concurrent",
        "prereq-conditional-reserve-or-eligible-student",
        "year-progression",
    }
    assert {r.rule_id for r in spec.course_rules if r.enforced_by == "board"} == {
        "annual-0542-3792", "duration-8-semesters"}


def test_every_course_rule_is_backed_by_mapped_evidence():
    items, spec = _load()
    ids = {i.id for i in items}
    for rule in spec.course_rules:
        assert rule.source_ids and set(rule.source_ids) <= ids, rule.rule_id
        for sid in rule.source_ids:
            assert spec.coverage[sid].maps_to(f"course_rules[{rule.rule_id}]")


def test_failing_checks_are_exactly_the_unenforced_rules():
    """Honest gate: of the spec-only checks, only rules_enforced fails (the regulations PDF was
    read and mapped, so no known gap remains)."""
    from app.degrees.checks import check_known_gaps, check_rules_enforced

    _, spec = _load()
    gaps = check_known_gaps(spec)
    assert gaps.passed, gaps.problems
    assert not check_rules_enforced(spec).passed and len(check_rules_enforced(spec).problems) == 12


def test_regulations_pdf_is_fully_mapped():
    """Every Terms_BA.pdf item has a coverage entry, and the program-page link to it is no gap."""
    items, spec = _load()
    pdf_ids = {i.id for i in items if i.id.startswith("pdf:b6a7c762f8db:")}
    assert len(pdf_ids) == 364 and pdf_ids <= set(spec.coverage)
    assert spec.coverage["tau:8715:2026:body:terms:8026588cd798"].not_planning_rule


def test_known_gaps_are_backed_by_mapped_evidence():
    _, spec = _load()
    for gap in spec.known_gaps:
        assert gap.source_ids
        for sid in gap.source_ids:
            assert spec.coverage[sid].maps_to(f"known_gaps[{gap.gap_id}]")


def test_source_conflict_sources_are_covered_evidence():
    items, spec = _load()
    ids = {i.id for i in items}
    assert {c.course_id for c in spec.source_conflicts} == {
        None, "0542-2500", "0542-2200", "0542-2600", "0542-4135", "0542-4132",
        "0542-4010", "0542-4092", "0542-4020", "0542-4456",
    }
    for conflict in spec.source_conflicts:
        assert conflict.sources, conflict
        assert set(conflict.sources) <= ids and set(conflict.sources) <= set(spec.coverage), conflict


def test_board_enforced_rules_hold_in_committed_board():
    """annual-0542-3792 claims board enforcement: the committed board must actually encode it."""
    from pathlib import Path

    _, spec = _load()
    (rule,) = [r for r in spec.course_rules if r.rule_id == "annual-0542-3792"]
    assert rule.enforced_by == "board"
    board_file = Path(__file__).resolve().parents[1] / "data/boards/mechanical_engineering_2027.json"
    board = json.loads(board_file.read_text(encoding="utf-8"))
    records = [c for s in board["semesters"] for c in s["courses"] if c["course_id"] == "0542-3792"]
    assert records
    for c in records:
        assert c["is_annual"] is True and c["count_hours_once"] is True
        assert c["spans_semesters"] == ["year_3_semester_a", "year_3_semester_b"]


def test_duration_rule_holds_in_committed_boards():
    """duration-8-semesters claims board enforcement: the two boards hold exactly 8 semesters."""
    from pathlib import Path

    _, spec = _load()
    (rule,) = [r for r in spec.course_rules if r.rule_id == "duration-8-semesters"]
    assert rule.enforced_by == "board" and rule.params["semesters"] == 8
    boards = Path(__file__).resolve().parents[1] / "data/boards"
    ids = [s["semester_id"]
           for name in ("mechanical_engineering_years_1_2_2027.json", "mechanical_engineering_2027.json")
           for s in json.loads((boards / name).read_text(encoding="utf-8"))["semesters"]]
    assert ids == [f"year_{y}_semester_{s}" for y in (1, 2, 3, 4) for s in ("a", "b")]

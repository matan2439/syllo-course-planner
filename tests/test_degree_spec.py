import json
from pathlib import Path

import pytest

from app.degrees.registry import get_program
from app.degrees.spec import (
    DegreeSpec,
    load_spec,
    program_to_spec,
    resolve_spec_path,
    spec_path,
    spec_to_program,
)

ROOT = Path(__file__).resolve().parents[1]
ENRICHED = ROOT / "data" / "programs" / "mechanical_engineering_2027_enriched.json"
ME_ID = "mechanical_engineering_2027"


def _enriched() -> dict:
    return json.loads(ENRICHED.read_text(encoding="utf-8"))


@pytest.fixture(scope="module")
def me_spec() -> DegreeSpec:
    return program_to_spec(_enriched(), get_program(ME_ID))


def test_round_trip_me_program(me_spec):
    assert spec_to_program(me_spec) == _enriched()


def test_round_trip_survives_json_serialization(me_spec):
    reloaded = DegreeSpec.model_validate_json(me_spec.model_dump_json())
    assert spec_to_program(reloaded) == _enriched()


def test_spec_path_layout():
    path = spec_path(get_program(ME_ID))
    assert path == ROOT / "data" / "degrees" / "tau" / "mechanical_engineering" / "2027" / "spec.json"


def test_committed_me_spec_matches_migration(me_spec):
    committed = load_spec(spec_path(get_program(ME_ID)))
    assert committed.coverage == {}
    fresh = me_spec.model_dump(exclude={"coverage"})
    assert committed.model_dump(exclude={"coverage"}) == fresh


def test_me_spec_generic_fields(me_spec):
    assert me_spec.program_id == ME_ID
    assert me_spec.institution == "tau"
    assert me_spec.source_year == 2026
    assert me_spec.total_required_credits == 185
    assert me_spec.catalog_year_policy == "start_year"
    assert me_spec.group_minimums == {"core": 6}
    assert me_spec.double_counting == "forbidden"
    core = [c.category_id for c in me_spec.categories if c.group == "core"]
    assert core == ["fluids", "solids", "systems"]
    years = {m.year for m in me_spec.mandatory_courses}
    assert years == {1, 2, 3, 4}
    ids = [m.course_id for m in me_spec.mandatory_courses]
    assert len(ids) == len(set(ids))
    assert me_spec.general_requirement["category_id"] == "shaar_ruach"


def test_mandatory_semesters_from_allowed_semesters(me_spec):
    by_id = {m.course_id: m for m in me_spec.mandatory_courses}
    assert by_id["0512-1204"].semester == "A"
    assert by_id["0512-1204"].placement_rule == "fixed_semester"
    assert by_id["0542-3620"].semester == "either"
    assert by_id["0542-3620"].placement_rule == "choose_one_allowed_semester"
    assert by_id["0542-1510"].year == 1 and by_id["0542-1510"].semester == "A"


def test_resolve_spec_path(me_spec):
    spec = me_spec
    assert resolve_spec_path(spec, "mandatory_courses[0512-1204]")
    assert not resolve_spec_path(spec, "mandatory_courses[9999-9999]")
    assert resolve_spec_path(spec, "categories[fluids]")
    assert not resolve_spec_path(spec, "categories[nope]")
    assert resolve_spec_path(spec, "categories[fluids].course_ids[0542-4120]")
    assert not resolve_spec_path(spec, "categories[fluids].course_ids[0542-4220]")
    assert not resolve_spec_path(spec, "categories[nope].course_ids[0542-4120]")
    assert resolve_spec_path(spec, "total_required_credits")
    assert resolve_spec_path(spec, "general_requirement")
    assert not resolve_spec_path(spec.model_copy(update={"general_requirement": None}), "general_requirement")
    assert resolve_spec_path(spec, "group_minimums.core")
    assert not resolve_spec_path(spec, "group_minimums.labs")
    assert resolve_spec_path(spec, "catalog_year_policy")
    assert not resolve_spec_path(spec.model_copy(update={"catalog_year_policy": None}), "catalog_year_policy")


@pytest.mark.parametrize(
    "bad",
    ["", "nope", "mandatory_courses", "mandatory_courses[]", "categories[fluids].course_ids",
     "categories[fluids].x[1]", "group_minimums.", "total_required_credits.x", "categories[a]]", None],
)
def test_resolve_spec_path_malformed_returns_false(me_spec, bad):
    assert resolve_spec_path(me_spec, bad) is False


def test_coverage_entry_shapes(me_spec):
    spec = DegreeSpec.model_validate(
        {**me_spec.model_dump(), "coverage": {"a": {"mapped_to": "categories[fluids]"}, "b": {"not_planning_rule": "x"}}}
    )
    assert set(spec.coverage) == {"a", "b"}
    with pytest.raises(ValueError):
        DegreeSpec.model_validate({**me_spec.model_dump(), "coverage": {"a": {"bogus": "x"}}})


def test_y3_mandatory_file_wins_over_early_year_duplicate(me_spec):
    # 0542-2500 is Y2B in early_year_courses.json but Y3A in the legacy mandatory file.
    rows = [m for m in me_spec.mandatory_courses if m.course_id == "0542-2500"]
    assert [(m.year, m.semester) for m in rows] == [(3, "A")]

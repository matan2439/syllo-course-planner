import json
from pathlib import Path

import pytest

from app.degrees.registry import DEFAULT_PATH, get_program, load_institution, load_registry


def test_get_program_source_ids():
    p = get_program("mechanical_engineering_2027")
    assert p.source_ids["tcid"] == "8715"
    assert p.source_year == 2026
    assert p.is_family_default is True


def test_unknown_program_raises_keyerror():
    with pytest.raises(KeyError):
        get_program("nope_2027")


def test_python_and_ts_read_same_file():
    raw = json.loads(Path(DEFAULT_PATH).read_text(encoding="utf-8"))
    assert [p.id for p in load_registry()] == [e["id"] for e in raw["programs"]]


def test_load_institution():
    assert load_institution("tau")["id"] == "tau"
    with pytest.raises(KeyError):
        load_institution("nope")


# ---------------------------------------------------------------- the registry validates itself

from app.degrees.registry import ProgramEntry  # noqa: E402


def _write_registry(tmp_path, programs):
    path = tmp_path / "programs.json"
    path.write_text(json.dumps({"programs": programs}, ensure_ascii=False), encoding="utf-8")
    return path


def _raw(**over):
    me = next(p for p in json.loads(Path(DEFAULT_PATH).read_text(encoding="utf-8"))["programs"]
              if p["id"] == "mechanical_engineering_2027")
    return {**me, **over}


def test_id_may_carry_an_institution_prefix(tmp_path):
    path = _write_registry(tmp_path, [_raw(id="foo:bar_2027", familyId="bar")])
    assert [p.id for p in load_registry(path)] == ["foo:bar_2027"]


@pytest.mark.parametrize("bad", ["Bar_2027", "foo:Bar_2027", "foo:", ":bar_2027", "a:b:c_2027", "bar-2027"])
def test_malformed_ids_are_rejected(tmp_path, bad):
    with pytest.raises(ValueError):
        load_registry(_write_registry(tmp_path, [_raw(id=bad, familyId="bar")]))


def test_a_family_needs_exactly_one_default(tmp_path):
    none = [_raw(id="bar_2027", familyId="bar", isFamilyDefault=False)]
    with pytest.raises(ValueError, match="bar"):
        load_registry(_write_registry(tmp_path, none))
    two = [_raw(id="bar_2027", familyId="bar"), _raw(id="bar_2028", familyId="bar", year=2028)]
    with pytest.raises(ValueError, match="bar"):
        load_registry(_write_registry(tmp_path, two))


def test_duplicate_ids_are_rejected(tmp_path):
    dup = [_raw(id="bar_2027", familyId="bar"), _raw(id="bar_2027", familyId="baz")]
    with pytest.raises(ValueError, match="bar_2027"):
        load_registry(_write_registry(tmp_path, dup))


def test_get_program_reads_the_registry_path_at_call_time(monkeypatch, tmp_path):
    import app.degrees.registry as registry

    monkeypatch.setattr(registry, "DEFAULT_PATH", _write_registry(tmp_path, [_raw(id="bar_2027", familyId="bar")]))
    assert get_program("bar_2027").family_id == "bar"
    assert isinstance(registry.load_registry()[0], ProgramEntry)

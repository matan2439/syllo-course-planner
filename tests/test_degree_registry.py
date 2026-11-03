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

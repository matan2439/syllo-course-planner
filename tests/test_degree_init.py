"""`degree.py init`: scaffold a draft degree from TAU's official program index.

The fixture is a trimmed LIVE getPrograms payload (see its _note); 8715 is ME's own program.
"""
import json
import shutil
import sys
from datetime import datetime, timezone
from pathlib import Path
from unittest.mock import Mock

import pytest

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "scripts"))

import degree  # noqa: E402
from app.degrees import registry, scaffold, spec as spec_mod  # noqa: E402
from app.degrees.evidence import EvidenceItem  # noqa: E402
from app.degrees.spec import load_spec  # noqa: E402
from app.scraping.tau_program_scraper import ProgramIndexEntry  # noqa: E402

FIXTURE = ROOT / "tests" / "fixtures" / "tau_program_index_fixture.json"
ME_TITLE = "תוכנית חד-חוגית בהנדסה מכנית"  # tcid 8715 in the live index: toar ראשון, betsefer 0540


def _payload(extra_rows=()):
    doc = json.loads(FIXTURE.read_text(encoding="utf-8"))
    doc["data"]["getPrograms"]["results"] += list(extra_rows)
    return doc


@pytest.fixture
def sandbox(tmp_path, monkeypatch):
    """A copy of the real registry, a scratch degrees dir, and the trimmed live index as TAU's answer."""
    reg = tmp_path / "programs.json"
    shutil.copyfile(registry.DEFAULT_PATH, reg)
    monkeypatch.setattr(registry, "DEFAULT_PATH", reg)
    monkeypatch.setattr(spec_mod, "DEGREES_DIR", tmp_path / "degrees")
    response = Mock()
    response.raise_for_status.return_value = None
    response.json.return_value = _payload()
    post = Mock(return_value=response)
    monkeypatch.setattr("app.scraping.tau_program_scraper.requests.post", post)
    calls = []

    def fake_collect(entry, live, offline):
        calls.append((entry.id, live, offline))
        now = datetime(2026, 11, 4, tzinfo=timezone.utc)
        return [EvidenceItem(id=f"e{i}", source_url="https://example.test", fetched_at=now, from_cache=False,
                             kind=kind, path=[], raw_text="x") for i, kind in
                enumerate(["section", "course_listing", "course_listing"])]

    monkeypatch.setattr(degree, "collect", fake_collect)
    return {"registry": reg, "post": post, "response": response, "collect_calls": calls, "tmp": tmp_path}


def _init(title=ME_TITLE, base="mechanical_engineering_copy", shana="2026"):
    args = ["init", "--institution", "tau", "--title-he", title, "--level", "ראשון", "--school", "0540",
            "--shana", shana, "--name-en", "Mechanical Engineering (copy)"]
    if base is not None:
        args += ["--base", base]
    return degree.main(args)


def test_init_sends_the_verified_index_search(sandbox):
    assert _init() == 0
    call = sandbox["post"].call_args
    assert call.args[0] == "https://tochniot.tau.ac.il/graphql"
    body = call.kwargs["json"]
    assert body["variables"] == {"search": {"safa": "1", "freeSearch": ME_TITLE}, "from": 0, "size": 100}
    assert "getPrograms(search: $search, from: $from, size: $size)" in body["query"]


def test_init_writes_draft_entry_and_skeleton(sandbox, capsys):
    before = sandbox["registry"].read_text(encoding="utf-8")
    assert _init() == 0
    out = capsys.readouterr().out

    raw = json.loads(sandbox["registry"].read_text(encoding="utf-8"))
    old = json.loads(before)
    assert raw["programs"][:-1] == old["programs"] and raw["_note"] == old["_note"]  # appended, order kept
    new = raw["programs"][-1]
    assert new["id"] == "mechanical_engineering_copy_2027"
    assert new["status"] == "draft" and new["sourceYear"] == 2026 and new["year"] == 2027
    assert new["sourceIds"] == {"tcid": "8715"}
    assert new["nameHe"] == ME_TITLE and new["nameEn"] == "Mechanical Engineering (copy)"
    assert new["familyId"] == "mechanical_engineering_copy" and new["isFamilyDefault"] is True
    assert new["capabilities"] == [] and new["track"] is None
    assert new["yearLabelHe"] == '2027 (תשפ"ז)'
    assert new["boardJsonFile"] == "mechanical_engineering_copy_semester_board_2027.json"
    assert list(new) == list(old["programs"][0])  # same key order as the existing entries
    text = sandbox["registry"].read_text(encoding="utf-8")
    assert text == json.dumps(raw, ensure_ascii=False, indent=2) + "\n"
    registry.load_registry(sandbox["registry"])  # still valid

    entry = registry.get_program("mechanical_engineering_copy_2027")
    spec = load_spec(spec_mod.spec_path(entry))
    assert spec.program_id == entry.id and spec.institution == "tau" and spec.source_year == 2026
    assert spec.total_required_credits == 0
    assert spec.mandatory_courses == [] and spec.categories == [] and spec.coverage == {}
    assert spec.catalog_year_policy == registry.load_institution("tau")["catalogYearPolicy"]

    assert sandbox["collect_calls"] == [(entry.id, True, False)]
    evidence = json.loads(spec_mod.spec_path(entry).with_name("evidence.json").read_text(encoding="utf-8"))
    assert len(evidence) == 3
    assert "course_listing" in out and "2" in out


def test_init_level_alias(sandbox):
    assert degree.main(["init", "--title-he", ME_TITLE, "--level", "1", "--school", "0540", "--shana", "2026",
                        "--name-en", "x", "--base", "me_alias"]) == 0


def test_init_refuses_ambiguous_program(sandbox, capsys):
    rows = _payload()["data"]["getPrograms"]["results"]
    twin = {**next(r for r in rows if r["tcid"] == "8715"), "tcid": "9999", "tclongkey": "099999999999"}
    sandbox["response"].json.return_value = _payload([twin])
    before = sandbox["registry"].read_text(encoding="utf-8")
    assert _init() == 2
    err = capsys.readouterr().err
    assert "8715" in err and "9999" in err and err.count(ME_TITLE) >= 2
    assert sandbox["registry"].read_text(encoding="utf-8") == before
    assert not (sandbox["tmp"] / "degrees").exists()


def test_init_refuses_missing_program_listing_candidates(sandbox, capsys):
    assert _init(title="תוכנית שאינה קיימת") == 2
    err = capsys.readouterr().err
    assert "8715" in err and "8701" in err and "7843" in err  # every candidate the index returned


def test_init_matches_chug_when_the_index_has_no_betsefer(sandbox):
    assert degree.main(["init", "--title-he", "תוכנית חד-חוגית במדע והנדסה של חומרים", "--level", "ראשון",
                        "--school", "0581", "--shana", "2026", "--name-en", "Materials", "--base",
                        "materials_engineering"]) == 0
    assert registry.get_program("materials_engineering_2027").source_ids == {"tcid": "7843"}


def test_init_refuses_a_year_the_index_does_not_list(sandbox, capsys):
    assert _init(shana="2025") == 2
    assert "current catalog year" in capsys.readouterr().err
    assert not (sandbox["tmp"] / "degrees").exists()


@pytest.mark.parametrize("base", ["tau:mechanical_copy", "Mechanical", "me-copy", "1me"])
def test_init_refuses_an_invalid_base(sandbox, capsys, base):
    before = sandbox["registry"].read_text(encoding="utf-8")
    assert _init(base=base) == 2
    assert "base" in capsys.readouterr().err
    assert sandbox["registry"].read_text(encoding="utf-8") == before


def test_init_requires_name_en(sandbox, capsys):
    assert degree.main(["init", "--title-he", ME_TITLE, "--level", "1", "--school", "0540",
                        "--shana", "2026"]) == 2
    assert "--name-en" in capsys.readouterr().err


def test_init_refuses_existing_id(sandbox, capsys):
    before = sandbox["registry"].read_text(encoding="utf-8")
    assert _init(base="mechanical_engineering") == 2
    assert "mechanical_engineering_2027" in capsys.readouterr().err
    assert sandbox["registry"].read_text(encoding="utf-8") == before
    assert sandbox["collect_calls"] == []


def test_init_rolls_back_the_spec_when_the_registry_write_fails(sandbox, monkeypatch):
    def boom(entry, path=None):
        raise OSError("disk full")

    monkeypatch.setattr(registry, "add_program", boom)
    with pytest.raises(OSError):
        _init()
    assert not list((sandbox["tmp"] / "degrees").rglob("spec.json"))


def test_init_refuses_other_institutions(sandbox, capsys):
    code = degree.main(["init", "--institution", "huji", "--title-he", "x", "--level", "1",
                        "--school", "1", "--shana", "2026", "--name-en", "x"])
    assert code == 2
    assert "new university needs adapters" in capsys.readouterr().err
    sandbox["post"].assert_not_called()


def test_registry_entry_and_new_spec():
    idx = ProgramIndexEntry(tcid="8715", tclongkey="054211010000", title_he=ME_TITLE, degree_level="ראשון",
                            faculty_code="0500", school_code="0540", academic_year="2026",
                            academic_year_he='תשפ"ז', active=True, visible=True, chug_code="0542")
    entry = scaffold.registry_entry(idx, 2026, "electrical_engineering", "מגמה כלשהי", name_en="EE")
    assert entry.id == "electrical_engineering_2027" and entry.track == "מגמה כלשהי"
    assert entry.year_label_he == '2027 (תשפ"ז)' and entry.name_en == "EE"
    spec = scaffold.new_spec(entry)
    assert spec.program_id == entry.id and spec.legacy == {} and spec.known_gaps == []
    with pytest.raises(ValueError):
        scaffold.registry_entry(idx, 2026, "tau:electrical", None)

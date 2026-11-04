"""`degree.py init`: scaffold a draft degree from TAU's official program index."""
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


@pytest.fixture
def sandbox(tmp_path, monkeypatch):
    """A copy of the real registry, a scratch degrees dir, and the fixture index as TAU's answer."""
    reg = tmp_path / "programs.json"
    shutil.copyfile(registry.DEFAULT_PATH, reg)
    monkeypatch.setattr(registry, "DEFAULT_PATH", reg)
    monkeypatch.setattr(spec_mod, "DEGREES_DIR", tmp_path / "degrees")
    response = Mock()
    response.raise_for_status.return_value = None
    response.json.return_value = json.loads(FIXTURE.read_text(encoding="utf-8"))
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
    return {"registry": reg, "post": post, "collect_calls": calls, "tmp": tmp_path}


def _init(*extra):
    return degree.main(["init", "--institution", "tau", "--title-he", "הנדסת חשמל", "--level", "1",
                        "--school", "0510", "--shana", "2026", *extra])


def test_init_writes_draft_entry_and_skeleton(sandbox, capsys):
    before = sandbox["registry"].read_text(encoding="utf-8")
    assert _init("--base", "electrical_engineering") == 0
    out = capsys.readouterr().out

    raw = json.loads(sandbox["registry"].read_text(encoding="utf-8"))
    old = json.loads(before)
    assert raw["programs"][:-1] == old["programs"] and raw["_note"] == old["_note"]  # appended, order kept
    new = raw["programs"][-1]
    assert new["id"] == "electrical_engineering_2027"
    assert new["status"] == "draft" and new["sourceYear"] == 2026 and new["year"] == 2027
    assert new["sourceIds"] == {"tcid": "1111"}
    assert new["nameHe"] == "הנדסת חשמל" and new["nameEn"]
    assert new["familyId"] == "electrical_engineering" and new["isFamilyDefault"] is True
    assert new["capabilities"] == [] and new["track"] is None
    assert new["boardJsonFile"] == "electrical_engineering_semester_board_2027.json"
    assert list(new) == list(old["programs"][0])  # same key order as the existing entries
    text = sandbox["registry"].read_text(encoding="utf-8")
    assert text == json.dumps(raw, ensure_ascii=False, indent=2) + "\n"
    registry.load_registry(sandbox["registry"])  # still valid

    entry = registry.get_program("electrical_engineering_2027")
    spec = load_spec(spec_mod.spec_path(entry))
    assert spec.program_id == entry.id and spec.institution == "tau" and spec.source_year == 2026
    assert spec.total_required_credits == 0
    assert spec.mandatory_courses == [] and spec.categories == [] and spec.coverage == {}
    assert spec.catalog_year_policy == registry.load_institution("tau")["catalogYearPolicy"]

    assert sandbox["collect_calls"] == [(entry.id, True, False)]
    evidence = json.loads(spec_mod.spec_path(entry).with_name("evidence.json").read_text(encoding="utf-8"))
    assert len(evidence) == 3
    assert "course_listing" in out and "2" in out


def test_init_refuses_ambiguous_program(sandbox, capsys):
    before = sandbox["registry"].read_text(encoding="utf-8")
    code = degree.main(["init", "--institution", "tau", "--title-he", "הנדסה ביו-רפואית", "--level", "1",
                        "--school", "0510", "--shana", "2026", "--base", "biomedical_engineering"])
    assert code == 2
    err = capsys.readouterr().err
    assert "4441" in err and "4442" in err and err.count("הנדסה ביו-רפואית") >= 2
    assert sandbox["registry"].read_text(encoding="utf-8") == before
    assert not (sandbox["tmp"] / "degrees").exists()


def test_init_refuses_missing_program_listing_candidates(sandbox, capsys):
    code = degree.main(["init", "--institution", "tau", "--title-he", "הנדסת אין כזו", "--level", "1",
                        "--school", "0510", "--shana", "2026", "--base", "nothing"])
    assert code == 2
    err = capsys.readouterr().err
    assert "1111" in err and "2222" in err  # every candidate the index returned


def test_init_refuses_existing_id(sandbox, capsys):
    before = sandbox["registry"].read_text(encoding="utf-8")
    code = degree.main(["init", "--institution", "tau", "--title-he", "הנדסת חשמל", "--level", "1",
                        "--school", "0510", "--shana", "2026", "--base", "mechanical_engineering"])
    assert code == 2
    assert "mechanical_engineering_2027" in capsys.readouterr().err
    assert sandbox["registry"].read_text(encoding="utf-8") == before
    assert sandbox["collect_calls"] == []


def test_init_refuses_other_institutions(sandbox, capsys):
    code = degree.main(["init", "--institution", "huji", "--title-he", "x", "--level", "1",
                        "--school", "1", "--shana", "2026"])
    assert code == 2
    assert "new university needs adapters" in capsys.readouterr().err
    sandbox["post"].assert_not_called()


def test_registry_entry_and_new_spec():
    idx = ProgramIndexEntry(tcid="1111", tclongkey="k", title_he="הנדסת חשמל", degree_level="1",
                            faculty_code="0500", school_code="0510", academic_year="2026",
                            academic_year_he='תשפ"ז (2026-2027)', active=True, visible=True)
    entry = scaffold.registry_entry(idx, 2026, "electrical_engineering", "מגמה כלשהי")
    assert entry.id == "electrical_engineering_2027" and entry.track == "מגמה כלשהי"
    assert entry.year_label_he == '2027 (תשפ"ז)'
    spec = scaffold.new_spec(entry)
    assert spec.program_id == entry.id and spec.legacy == {} and spec.known_gaps == []

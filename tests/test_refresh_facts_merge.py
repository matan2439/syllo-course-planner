"""The per-year facts snapshot is shared by every program: a refresh merges, never drops."""
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "scripts"))

import refresh_course_data as rcd  # noqa: E402
from app.degrees.registry import get_program  # noqa: E402


def _fact(tag):
    return {"ims": {"status": "offered", "url": tag}, "program": None, "timetable": None,
            "offering": {"status": "offered", "offered_semesters": ["A"], "url": tag, "source": "ims"}}


def test_refresh_of_program_b_keeps_program_a_facts(monkeypatch, tmp_path):
    monkeypatch.setattr(rcd, "OFFICIAL_DIR", tmp_path / "official")
    monkeypatch.setattr(rcd, "REPORT_DIR", tmp_path / "reports")
    # Program A refreshed earlier: two courses, one of which program B shares.
    rcd.write_facts({"A-1": _fact("a1"), "SHARED": _fact("old")}, 2026)

    monkeypatch.setattr(rcd, "spec_course_ids", lambda entry: ["B-1", "SHARED"])
    monkeypatch.setattr(rcd, "official_facts",
                        lambda ids, year, offline, live, tcid: {cid: _fact(f"new:{cid}") for cid in ids})
    summary = rcd.refresh(get_program("mechanical_engineering_2027"), 2026, offline=True, boards=[])

    facts = json.loads(rcd.facts_path(2026).read_text(encoding="utf-8"))
    assert set(facts) == {"A-1", "B-1", "SHARED"}
    assert facts["A-1"]["ims"]["url"] == "a1"            # program A's course untouched
    assert facts["SHARED"]["ims"]["url"] == "new:SHARED"  # shared course updated
    assert summary["facts"] == 2

"""The per-year facts snapshot is shared by every program: a refresh merges, never drops."""
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "scripts"))

import refresh_course_data as rcd  # noqa: E402
import app.degrees.facts as facts_mod  # noqa: E402
from app.degrees.registry import get_program  # noqa: E402


def _fact(tag):
    return {"ims": {"status": "offered", "url": tag}, "program": None, "timetable": None,
            "offering": {"status": "offered", "offered_semesters": ["A"], "url": tag, "source": "ims"}}


def test_refresh_of_program_b_keeps_program_a_facts(monkeypatch, tmp_path):
    monkeypatch.setattr(facts_mod, "OFFICIAL_DIR", tmp_path / "official")
    monkeypatch.setattr(rcd, "REPORT_DIR", tmp_path / "reports")
    # Program A refreshed earlier: two courses, one of which program B shares.
    rcd.write_facts({"A-1": _fact("a1"), "SHARED": _fact("old")}, 2026, "8715")

    monkeypatch.setattr(rcd, "spec_course_ids", lambda entry: ["B-1", "SHARED"])
    monkeypatch.setattr(rcd, "official_facts",
                        lambda ids, year, offline, live, tcid: {cid: _fact(f"new:{cid}") for cid in ids})
    summary = rcd.refresh(get_program("mechanical_engineering_2027"), 2026, offline=True, boards=[])

    facts = json.loads(rcd.facts_path(2026).read_text(encoding="utf-8"))
    assert set(facts) == {"A-1", "B-1", "SHARED"}
    assert facts["A-1"]["ims"]["url"] == "a1"            # program A's course untouched
    assert facts["SHARED"]["ims"]["url"] == "new:SHARED"  # shared course updated
    assert summary["facts"] == 2


# ---------------------------------------------------------------- program-scoped facts

from app.degrees.facts import load_program_facts  # noqa: E402


def _full(credits, timetable=("A",), ims_status="offered", tag="x"):
    ims = {"status": ims_status, "url": f"ims:{tag}", "offered_semesters": ["A", "B"]}
    if ims_status == "unknown":
        ims = {"status": "unknown", "url": f"ims:{tag}", "reason": "fetch failed: boom"}
    return {"ims": ims,
            "program": None if credits is None else {"credits": credits, "weekly_hours": credits, "teaching_format": []},
            "timetable": list(timetable) if timetable else None,
            "offering": {"status": "offered", "offered_semesters": list(timetable or ["A", "B"]),
                         "url": f"off:{tag}", "source": "program_timetable" if timetable else "ims"}}


def test_two_programs_sharing_a_course_keep_their_own_program_view(monkeypatch, tmp_path):
    monkeypatch.setattr(facts_mod, "OFFICIAL_DIR", tmp_path / "official")
    rcd.write_facts({"SHARED": _full(3, ("A",), tag="me")}, 2026, tcid="8715")
    rcd.write_facts({"SHARED": _full(5, ("B",), tag="other")}, 2026, tcid="9999")

    path = rcd.facts_path(2026)
    me, other = load_program_facts(2026, "8715", path), load_program_facts(2026, "9999", path)
    assert me["SHARED"]["program"]["credits"] == 3 and me["SHARED"]["timetable"] == ["A"]
    assert other["SHARED"]["program"]["credits"] == 5 and other["SHARED"]["timetable"] == ["B"]
    assert me["SHARED"]["offering"]["url"] == "off:me"
    assert me["SHARED"]["ims"] == other["SHARED"]["ims"]  # IMS is the only course-wide fact

    # Degree #2 not listing the course in its program (program: None) never nulls ME's view.
    rcd.write_facts({"SHARED": _full(None, None, tag="other2")}, 2026, tcid="9999")
    assert load_program_facts(2026, "8715", path)["SHARED"]["program"]["credits"] == 3


def test_null_or_unknown_never_replaces_an_existing_fact(monkeypatch, tmp_path):
    monkeypatch.setattr(facts_mod, "OFFICIAL_DIR", tmp_path / "official")
    rcd.write_facts({"C-1": _full(4, ("A",), tag="good")}, 2026, "8715")
    good = load_program_facts(2026, "8715", rcd.facts_path(2026))["C-1"]

    # A degraded run: IMS fetch failed, no program row, no timetable.
    rcd.write_facts({"C-1": _full(None, None, ims_status="unknown", tag="bad")}, 2026, "8715")
    kept = load_program_facts(2026, "8715", rcd.facts_path(2026))["C-1"]
    assert kept["ims"] == good["ims"]
    assert kept["program"] == good["program"]
    assert kept["timetable"] == ["A"]
    assert kept["offering"]["status"] == "offered" and kept["offering"]["offered_semesters"] == ["A"]
    assert kept["offering"]["source"] == "program_timetable"


def test_good_new_values_still_replace_old_ones(monkeypatch, tmp_path):
    monkeypatch.setattr(facts_mod, "OFFICIAL_DIR", tmp_path / "official")
    rcd.write_facts({"C-1": _full(4, ("A",), tag="old")}, 2026, "8715")
    rcd.write_facts({"C-1": _full(6, ("B",), tag="new")}, 2026, "8715")
    fact = load_program_facts(2026, "8715", rcd.facts_path(2026))["C-1"]
    assert fact["program"]["credits"] == 6 and fact["timetable"] == ["B"] and fact["ims"]["url"] == "ims:new"


def test_course_that_left_the_timetable_is_dropped_after_a_full_read(monkeypatch, tmp_path):
    monkeypatch.setattr(facts_mod, "OFFICIAL_DIR", tmp_path / "official")
    rcd.write_facts({"C-1": _full(4, ("A",), tag="old")}, 2026, "8715")

    # A successful run that read both sources: the course is gone from both, IMS says not offered.
    gone = {"ims": {"status": "not_offered", "url": "ims:gone", "offered_semesters": []},
            "program": None, "timetable": None,
            "offering": {"status": "not_offered", "offered_semesters": [], "url": "ims:gone", "source": "ims"},
            rcd.SOURCES_READ: True}
    rcd.write_facts({"C-1": gone}, 2026, "8715")
    fact = load_program_facts(2026, "8715", rcd.facts_path(2026))["C-1"]
    assert fact["program"] is None and fact["timetable"] is None
    assert fact["offering"]["status"] == "not_offered"
    assert rcd.SOURCES_READ not in json.loads(rcd.facts_path(2026).read_text(encoding="utf-8"))["C-1"]


def test_official_facts_marks_sources_read_only_when_both_were_read(monkeypatch):
    monkeypatch.setattr(rcd, "read_ims", lambda *a, **k: {"status": "offered", "url": "u", "offered_semesters": ["A"]})
    monkeypatch.setattr(rcd, "read_program", lambda *a, **k: {"X-1": {"credits": 3}})
    monkeypatch.setattr(rcd, "read_timetable", lambda *a, **k: {"X-1": ["A"]})
    assert rcd.official_facts(["X-1"], 2026, offline=False, live=False, tcid="8715")["X-1"][rcd.SOURCES_READ] is True

    monkeypatch.setattr(rcd, "read_timetable", lambda *a, **k: {})  # offline, no cache
    assert rcd.official_facts(["X-1"], 2026, offline=True, live=False, tcid="8715")["X-1"][rcd.SOURCES_READ] is False


def test_refresh_into_another_facts_file_leaves_the_committed_one_alone(monkeypatch, tmp_path):
    monkeypatch.setattr(facts_mod, "OFFICIAL_DIR", tmp_path / "official")
    monkeypatch.setattr(rcd, "REPORT_DIR", tmp_path / "reports")
    rcd.write_facts({"OTHER": _full(2, tag="committed")}, 2026, "8715")
    committed = rcd.facts_path(2026).read_text(encoding="utf-8")

    monkeypatch.setattr(rcd, "spec_course_ids", lambda entry: ["B-1"])
    monkeypatch.setattr(rcd, "official_facts",
                        lambda ids, year, offline, live, tcid: {cid: _full(3, tag=cid) for cid in ids})
    target = tmp_path / "out" / "official" / "tau_course_facts_2026.json"
    rcd.refresh(get_program("mechanical_engineering_2027"), 2026, offline=True, boards=[], facts_file=target)

    assert rcd.facts_path(2026).read_text(encoding="utf-8") == committed
    written = load_program_facts(2026, "8715", target)
    assert set(written) == {"OTHER", "B-1"}  # seeded from the committed snapshot


def test_refresh_never_writes_boards(monkeypatch, tmp_path):
    import inspect

    assert "apply_boards" not in inspect.signature(rcd.refresh).parameters
    monkeypatch.setattr(facts_mod, "OFFICIAL_DIR", tmp_path / "official")
    monkeypatch.setattr(rcd, "REPORT_DIR", tmp_path / "reports")
    board = tmp_path / "board.json"
    board.write_text(json.dumps({"semesters": [], "metadata": {"program_repository_courses": [
        {"course_id": "B-1", "offered_semesters": ["B"]}]}}), encoding="utf-8")
    before = board.read_text(encoding="utf-8")
    monkeypatch.setattr(rcd, "spec_course_ids", lambda entry: [])
    monkeypatch.setattr(rcd, "official_facts",
                        lambda ids, year, offline, live, tcid: {cid: _full(3, tag=cid) for cid in ids})
    rcd.refresh(get_program("mechanical_engineering_2027"), 2026, offline=True, boards=[board])
    assert board.read_text(encoding="utf-8") == before


# ---------------------------------------------------------------- no ME defaults at import


def test_refresh_module_resolves_no_program_at_import():
    import inspect

    for name in ("DEFAULT_PROGRAM", "ACADEMIC_YEAR", "PROGRAM_TCID", "BOARDS", "OFFICIAL_DIR"):
        assert not hasattr(rcd, name), name  # OFFICIAL_DIR lives only in app/degrees/facts.py
    for fn in (rcd.read_program, rcd.read_timetable, rcd.resolve_offering, rcd.official_facts, rcd.write_facts):
        tcid = inspect.signature(fn).parameters["tcid"]
        assert tcid.default is inspect.Parameter.empty, fn.__name__


def _gitignored_inputs_missing() -> str | None:
    raw = ROOT / "data" / "raw_html"
    if not (ROOT / "data" / "database.sqlite").exists():
        return "data/database.sqlite"
    if not raw.is_dir() or not any(p.name != ".gitkeep" for p in raw.iterdir()):
        return "data/raw_html/"
    return None


def test_second_program_refresh_keeps_me_build_identical(monkeypatch, tmp_path):
    """Degree #2 (a fake TAU program sharing two ME courses) refreshes into the shared facts
    snapshot with different program/timetable values; ME's offline build is still byte-identical."""
    import shutil
    import subprocess

    import app.degrees.registry as registry
    import app.degrees.spec as spec_mod
    import degree
    from app.degrees.facts import load_stored

    missing = _gitignored_inputs_missing()
    if missing:
        import pytest
        pytest.skip(f"ME build needs gitignored local inputs ({missing} absent, e.g. in CI)")

    me = get_program("mechanical_engineering_2027")
    me_raw = next(p for p in json.loads(registry.DEFAULT_PATH.read_text(encoding="utf-8"))["programs"]
                  if p["id"] == me.id)
    fake_raw = {**me_raw, "id": "fake_program_2027", "base": "fake_program", "familyId": "fake_program",
                "nameEn": "Fake Program", "boardJsonFile": "fake_semester_board_2027.json",
                "sourceIds": {"tcid": "9999"}, "status": "draft", "isFamilyDefault": True}
    reg = tmp_path / "programs.json"
    reg.write_text(json.dumps({"programs": [me_raw, fake_raw]}, ensure_ascii=False), encoding="utf-8")
    monkeypatch.setattr(registry, "DEFAULT_PATH", reg)
    fake = get_program("fake_program_2027")

    shared = ["0512-1204", "0542-3620"]  # two ME mandatory courses
    me_spec = spec_mod.load_spec(spec_mod.spec_path(me))
    assert set(shared) <= {m.course_id for m in me_spec.mandatory_courses}
    monkeypatch.setattr(spec_mod, "DEGREES_DIR", tmp_path / "degrees")
    spec_file = spec_mod.spec_path(fake)
    spec_file.parent.mkdir(parents=True)
    spec_file.write_text(json.dumps({
        "program_id": fake.id, "institution": "tau", "source_year": fake.source_year,
        "total_required_credits": 10,
        "mandatory_courses": [{"course_id": c, "year": 1, "semester": "A", "placement_rule": "fixed"} for c in shared],
        "categories": [], "group_minimums": {}, "ui": {}, "legacy": {},
    }), encoding="utf-8")

    committed_facts = rcd.facts_path(me.source_year)
    stored = load_stored(committed_facts)
    out = tmp_path / "out"
    facts_file = out / "official" / committed_facts.name
    facts_file.parent.mkdir(parents=True)
    shutil.copyfile(committed_facts, facts_file)

    # Degree #2's own sources disagree with ME's for the shared courses; IMS is one page per course.
    seen_tcids = set()
    monkeypatch.setattr(rcd, "REPORT_DIR", tmp_path / "reports")
    monkeypatch.setattr(rcd, "read_program", lambda year, offline, live, tcid: seen_tcids.add(tcid) or {
        c: {"weekly_hours": 99, "credits": 99, "teaching_format": []} for c in shared})
    monkeypatch.setattr(rcd, "read_timetable", lambda year, offline, live, tcid: {c: ["B"] for c in shared})
    monkeypatch.setattr(rcd, "read_ims", lambda cid, year, offline, live=False: stored[cid]["ims"])
    summary = rcd.refresh(fake, offline=True, facts_file=facts_file)
    assert seen_tcids == {"9999"} and summary["facts"] == 2

    written = load_stored(facts_file)
    for c in shared:
        assert written[c]["programs"]["9999"]["program"]["credits"] == 99
        assert written[c]["programs"]["9999"]["timetable"] == ["B"]
        assert written[c]["programs"]["8715"] == stored[c]["programs"]["8715"]
    assert load_program_facts(me.source_year, "8715", facts_file) == load_program_facts(me.source_year, "8715")
    assert committed_facts.read_text(encoding="utf-8") == json.dumps(stored, ensure_ascii=False, indent=2,
                                                                     sort_keys=True)

    committed = degree.board_paths(me)
    built = degree.board_paths(me, data_dir=out)
    for name, src in committed.items():
        built[name].parent.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(src, built[name])
    proc = subprocess.run(
        [sys.executable, str(ROOT / "scripts" / "degree.py"), "build", "--program", me.id,
         "--offline", "--out-dir", str(out)],
        cwd=ROOT, capture_output=True, text=True, encoding="utf-8", errors="replace")
    assert proc.returncode == 0, proc.stdout[-3000:] + proc.stderr[-3000:]
    for name, src in committed.items():
        assert built[name].read_bytes() == src.read_bytes(), name
    assert degree.early_index_path(out).read_bytes() == degree.early_index_path().read_bytes()

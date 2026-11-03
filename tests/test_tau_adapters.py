import copy
import json
import shutil
from pathlib import Path

import pytest

from app.degrees import evidence as ev
from app.degrees.adapters import tau
from app.degrees.evidence import EvidenceItem, collect_evidence, text_id
from app.degrees.registry import get_program

FIX = Path(__file__).parent / "fixtures"
PROGRAM_FIXTURE = FIX / "tau_program_evidence_fixture.json"
SCHEDULE_FIXTURE = FIX / "tau_schedule_fixture.json"


def _body(path: Path) -> list[dict]:
    return json.loads(path.read_text(encoding="utf-8"))["data"]["results"]["body"]


def _count(nodes, key):
    n = 0
    for node in nodes:
        n += len(node.get(key) or []) if key == "kurs" else 0
        children = node.get("rama") or []
        if key == "rama":
            n += len(children)
        n += _count(children, key)
    return n


@pytest.fixture
def program():
    return get_program("mechanical_engineering_2027")


@pytest.fixture
def env(tmp_path, monkeypatch):
    """Hermetic: cache dir in tmp with the fixtures, fetchers + IMS stubbed, no network."""
    raw = tmp_path / "raw_html"
    raw.mkdir()
    shutil.copy(PROGRAM_FIXTURE, raw / "tau_program_8715_2026.json")
    shutil.copy(SCHEDULE_FIXTURE, raw / "tau_schedule_8715_2026.json")
    state = {"program": _body(PROGRAM_FIXTURE), "calls": []}
    monkeypatch.setattr(tau, "RAW_DIR", raw)

    def fake_program(tcid, shana, safa="1", cache_path=None, force_refresh=False):
        state["calls"].append(("program", force_refresh))
        return copy.deepcopy(state["program"])

    def fake_schedule(tcid, shana, safa="1", cache_path=None, force_refresh=False):
        state["calls"].append(("schedule", force_refresh))
        return _body(SCHEDULE_FIXTURE)

    monkeypatch.setattr(tau, "fetch_program_data", fake_program)
    monkeypatch.setattr(tau, "fetch_schedule_data", fake_schedule)
    monkeypatch.setattr(tau, "_ims_cache_path", lambda cid, year: tmp_path / f"no_ims_{cid}.html")
    monkeypatch.setattr(
        tau, "_read_ims",
        lambda cid, year, offline, live: {"status": "offered", "url": f"https://ims/{cid}",
                                          "offered_semesters": ["A"], "name_he": "קורס"},
    )
    return state


def _ids(items):
    return [i.id for i in items]


def test_ids_are_stable_across_runs(program, env):
    first = collect_evidence(program, live=False, offline=False)
    second = collect_evidence(program, live=False, offline=False)
    assert _ids(first) == _ids(second)
    assert _ids(first) == sorted(_ids(first))


def test_every_section_and_course_emitted(program, env):
    items = collect_evidence(program, live=False, offline=False)
    body = env["program"]
    assert sum(i.kind == "section" for i in items) == _count(body, "rama")
    assert sum(i.kind == "course_listing" for i in items) == _count(body, "kurs")


def test_text_only_sections_emit_items(program, env):
    items = collect_evidence(program, live=False, offline=False)
    section = next(i for i in items if i.id.endswith(":rama:23") and i.kind == "section")
    assert section.path and section.raw_text
    rules = [i for i in items if i.kind == "rule_text" and ":rama:23:hesber:" in i.id]
    assert len(rules) == 1
    # every non-empty hesber in the tree has a rule_text item
    assert any(i.kind == "program_text" for i in items)
    assert any(i.kind == "policy_text" for i in items)


def test_rule_text_id_changes_when_text_changes(program, env):
    before = {i.id for i in tau.tochniot_evidence(program, False, False)}
    node = next(r for r in env["program"][0]["rama"] if r["ramaid"] == "23")
    node["hesber"] = node["hesber"] + "<p>טקסט חדש</p>"
    after = {i.id for i in tau.tochniot_evidence(program, False, False)}
    assert len(before - after) == 1 and len(after - before) == 1
    assert ":rama:23:hesber:" in next(iter(before - after))
    assert ":rama:23:hesber:" in next(iter(after - before))


def test_text_id_ignores_markup_and_whitespace():
    assert text_id("<p>a&nbsp; b</p>") == text_id("a b")
    assert len(text_id("x")) == 12


def test_cancelled_course_still_emitted(program, env):
    items = tau.tochniot_evidence(program, False, False)
    cancelled = [i for i in items if i.kind == "course_listing" and i.cancelled]
    assert len(cancelled) == 1
    assert cancelled[0].course_id


def test_live_sets_from_cache_false(program, env):
    cached = collect_evidence(program, live=False, offline=False)
    assert cached and all(i.from_cache for i in cached if not i.id.startswith("tau:ims:"))
    assert all(f is False for _, f in env["calls"])
    live = collect_evidence(program, live=True, offline=False)
    assert live and all(i.from_cache is False for i in live)
    assert ("program", True) in env["calls"] and ("schedule", True) in env["calls"]


def test_kinds_and_course_facts(program, env):
    items = collect_evidence(program, live=False, offline=False)
    listing_ids = {i.course_id for i in items if i.kind == "course_listing"}
    ims = {i.course_id for i in items if i.id.startswith("tau:ims:2026:")}
    assert ims == listing_ids
    tt = [i for i in items if ":timetable:" in i.id]
    assert tt and all(set(i.data["semesters"]) <= {"A", "B"} for i in tt)
    assert all(i.fetched_at.tzinfo is not None for i in items)


def test_offline_without_cache_is_empty(program, env, tmp_path, monkeypatch):
    monkeypatch.setattr(tau, "RAW_DIR", tmp_path / "empty")
    assert tau.tochniot_evidence(program, False, True) == []
    assert tau.timetable_evidence(program, False, True) == []


def test_string_encoded_lists_parse(program, env):
    body = env["program"][0]
    body["terms"] = repr(body["terms"])
    body["prev_newsletters"] = json.dumps(body["prev_newsletters"], ensure_ascii=False)
    env["program"] = [body]
    assert any(i.kind == "policy_text" for i in tau.tochniot_evidence(program, False, False))


def test_duplicate_ids_raise(program, env, monkeypatch):
    def dup(p, live, offline):
        now = tau.datetime.now(tau.timezone.utc)
        item = EvidenceItem(id="x:1", source_url="u", fetched_at=now, from_cache=True,
                            kind="section", path=[], raw_text="t")
        return [item, item]

    monkeypatch.setitem(ev.ADAPTERS, "tau_tochniot", dup)
    with pytest.raises(ValueError, match="duplicate"):
        collect_evidence(program, live=False, offline=False)

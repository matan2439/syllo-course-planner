import copy
import json
import shutil
from pathlib import Path

import pytest

from app.degrees import evidence as ev
from app.degrees.adapters import tau
from datetime import datetime, timezone

from app.degrees.evidence import EvidenceFetchError, EvidenceItem, collect_evidence, text_id
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
    state = {"program": _body(PROGRAM_FIXTURE), "calls": [], "empty": False, "ims": None, "ims_cache": False}
    monkeypatch.setattr(tau, "RAW_DIR", raw)

    def fake_program(tcid, shana, safa="1", cache_path=None, force_refresh=False):
        state["calls"].append(("program", force_refresh))
        if state["empty"] and force_refresh:
            return []
        return copy.deepcopy(state["program"])

    def fake_schedule(tcid, shana, safa="1", cache_path=None, force_refresh=False):
        state["calls"].append(("schedule", force_refresh))
        return _body(SCHEDULE_FIXTURE)

    monkeypatch.setattr(tau, "fetch_program_data", fake_program)
    monkeypatch.setattr(tau, "fetch_schedule_data", fake_schedule)
    ims_dir = tmp_path / "ims"
    ims_dir.mkdir()
    state["ims_dir"] = ims_dir
    monkeypatch.setattr(tau, "_ims_cache_path", lambda cid, year: ims_dir / f"{cid}.html")

    def fake_ims(cid, year, offline, live):
        if state["ims"]:
            return dict(state["ims"], url=f"https://ims/{cid}")
        return {"status": "offered", "url": f"https://ims/{cid}", "offered_semesters": ["A"], "name_he": "קורס"}

    monkeypatch.setattr(tau, "_read_ims", fake_ims)
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


def _fresh(i, start):
    """Freshness predicate: downloaded in this run."""
    return (not i.from_cache) and i.fetched_at >= start


def test_live_sets_from_cache_false(program, env):
    start = datetime.now(timezone.utc)
    cached = collect_evidence(program, live=False, offline=False)
    assert cached and all(i.from_cache for i in cached if not i.id.startswith("tau:ims:"))
    assert all(f is False for _, f in env["calls"])
    live = collect_evidence(program, live=True, offline=False)
    assert live and all(i.from_cache is False for i in live)
    assert all(_fresh(i, start) for i in live)
    assert ("program", True) in env["calls"] and ("schedule", True) in env["calls"]


def test_kinds_and_course_facts(program, env):
    items = collect_evidence(program, live=False, offline=False)
    listing_ids = {i.course_id for i in items if i.kind == "course_listing"}
    ims = {i.course_id for i in items if i.id.startswith("tau:ims:2026:")}
    assert ims == listing_ids
    tt = [i for i in items if ":timetable:" in i.id]
    assert tt and all(set(i.data["semesters"]) <= {"A", "B"} for i in tt)
    assert all(i.fetched_at.tzinfo is not None for i in items)


def test_offline_without_cache_raises(program, env, tmp_path, monkeypatch):
    monkeypatch.setattr(tau, "RAW_DIR", tmp_path / "empty")
    with pytest.raises(EvidenceFetchError):
        tau.tochniot_evidence(program, False, True)
    with pytest.raises(EvidenceFetchError):
        tau.timetable_evidence(program, False, True)


def test_live_empty_fetch_raises(program, env):
    env["empty"] = True
    with pytest.raises(EvidenceFetchError):
        tau.tochniot_evidence(program, True, False)
    # ims must not fall back to the stale cached program when live
    with pytest.raises(EvidenceFetchError):
        tau.ims_evidence(program, True, False)


def test_ims_live_refetches_program_course_list(program, env):
    tau.ims_evidence(program, True, False)
    assert ("program", True) in env["calls"]


def test_ims_offline_no_cache_is_not_fresh(program, env):
    start = datetime.now(timezone.utc)
    env["ims"] = {"status": "unknown", "reason": "not cached"}
    items = tau.ims_evidence(program, False, True)
    assert items
    for i in items:
        assert i.from_cache is True and i.fetched_at < start and not _fresh(i, start)
        assert i.data["not_fetched"] is True


def test_ims_live_fetch_failure_is_not_fresh(program, env):
    start = datetime.now(timezone.utc)
    env["ims"] = {"status": "unknown", "reason": "fetch failed: x"}
    items = tau.ims_evidence(program, True, False)
    assert items and all(not _fresh(i, start) and i.data["not_fetched"] for i in items)


def test_ims_live_failure_with_old_cache_uses_mtime(program, env):
    env["ims"] = {"status": "unknown", "reason": "fetch failed: x"}
    first = sorted(i.course_id for i in tau.tochniot_evidence(program, False, False) if i.course_id)[0]
    (env["ims_dir"] / f"{first}.html").write_text("x")
    start = datetime.now(timezone.utc)
    item = next(i for i in tau.ims_evidence(program, True, False) if i.course_id == first)
    assert item.from_cache is True and "not_fetched" not in item.data
    assert item.fetched_at <= datetime.now(timezone.utc)


def test_ims_live_success_is_fresh(program, env):
    start = datetime.now(timezone.utc)
    assert all(_fresh(i, start) for i in tau.ims_evidence(program, True, False))


def _first_kurs(env):
    node = env["program"][0]["rama"][0]
    while not node.get("kurs"):
        node = node["rama"][0]
    return node, node["kurs"][0]


def test_course_note_emits_rule_text_and_rewording_changes_only_it(program, env):
    _, k = _first_kurs(env)
    k["hearakurs"] = "choose one of courses 3 or 4"
    k["idkunkurs"] = "<p>course replaced by 0509.1510</p>"
    before = tau.tochniot_evidence(program, False, False)
    notes = [i for i in before if i.kind == "rule_text" and ":kurs:" in i.id]
    assert {i.id.split(":")[-2] for i in notes} == {"hearakurs", "idkunkurs"}
    assert all(i.course_id for i in notes)
    k["hearakurs"] = "choose one of courses 3, 4 or 5"
    after = tau.tochniot_evidence(program, False, False)
    b, a = {i.id for i in before}, {i.id for i in after}
    assert len(b - a) == 1 and len(a - b) == 1
    assert ":hearakurs:" in next(iter(a - b))


def test_course_listing_data_and_section_mishkal(program, env):
    node, k = _first_kurs(env)
    k["hidekurs"] = "1"
    node["mishkal"] = "SECTIONCREDITS"
    items = tau.tochniot_evidence(program, False, False)
    listing = next(i for i in items if i.kind == "course_listing" and i.course_id == tau._refresh().dashed(k["kursshow"]))
    for f in ("hidekurs", "ofenhoraa1", "shaot1"):
        assert f in listing.data
    sec = next(i for i in items if i.id.endswith(f":rama:{node['ramaid']}") and i.kind == "section")
    assert "SECTIONCREDITS" in sec.raw_text


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


def test_real_shaped_list_notes_emit_rule_text(program, env):
    items = tau.tochniot_evidence(program, False, False)
    notes = [i for i in items if i.kind == "rule_text" and ":kurs:" in i.id]
    hea = [i for i in notes if ":hearakurs:" in i.id]
    idk = [i for i in notes if ":idkunkurs:" in i.id]
    assert hea and all(i.course_id and i.data.get("teurhearakurs") for i in hea)
    assert any(i.raw_text.startswith("&nbsp;") for i in hea)
    assert idk and idk[0].data["misheara"] == "120" and idk[0].data["taarichidkun"]
    assert "0509.1510" in idk[0].raw_text


def test_string_encoded_list_note_parses(program, env):
    _, k = _first_kurs(env)
    k["hearakurs"] = repr([{"teurhearakurs": "string encoded note"}])
    items = tau.tochniot_evidence(program, False, False)
    assert any(i.raw_text == "string encoded note" for i in items)

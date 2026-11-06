"""degree.py todo: the coverage worklist, --apply-suggestions idempotence, exit codes."""
import json
import sys
from datetime import datetime, timezone
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "scripts"))

import degree  # noqa: E402
from app.degrees.registry import get_program  # noqa: E402
from app.degrees.scaffold import new_spec  # noqa: E402
from app.degrees.spec import MappedTo, MandatoryCourse, NotPlanningRule, load_spec, write_spec  # noqa: E402

ME = get_program("mechanical_engineering_2027")
NOW = datetime(2026, 11, 1, tzinfo=timezone.utc).isoformat()


def item(id_, kind="rule_text", path=("a",), text="<b>שלום&nbsp;עולם</b>  כלל", course_id=None):
    return {"id": id_, "source_url": f"https://x/{id_}", "fetched_at": NOW, "from_cache": False,
            "kind": kind, "path": list(path), "raw_text": text, "course_id": course_id}


@pytest.fixture
def env(tmp_path, monkeypatch):
    spec_file = tmp_path / "spec.json"
    monkeypatch.setattr(degree, "spec_path", lambda entry: spec_file)
    monkeypatch.setattr(degree, "get_program", lambda pid: ME)
    spec = new_spec(ME).model_copy(update={"mandatory_courses": [
        MandatoryCourse(course_id="0512-1204", year=3, semester="A", placement_rule="")]})
    write_spec(spec, spec_file)

    def put(items):
        (tmp_path / "evidence.json").write_text(json.dumps(items, ensure_ascii=False), encoding="utf-8")
    return tmp_path, spec_file, put


def set_coverage(spec_file, coverage):
    spec = load_spec(spec_file)
    parsed = {k: MappedTo(**v) if "mapped_to" in v else NotPlanningRule(**v) for k, v in coverage.items()}
    write_spec(spec.model_copy(update={"coverage": parsed}), spec_file)


def run(capfd, *extra):
    code = degree.main(["todo", "--program", ME.id, *extra])
    return code, capfd.readouterr().out


def test_lists_exactly_the_unaccounted_items_untruncated(env, capfd):
    tmp, spec_file, put = env
    long = "ארוך " * 200
    put([item("rule:aaa", text=long), item("rule:bbb", kind="section", path=("s", "t")), item("rule:ccc")])
    set_coverage(spec_file, {"rule:ccc": {"not_planning_rule": "n/a"}})
    code, out = run(capfd)
    assert code == 1
    assert "rule:aaa" in out and "rule:bbb" in out and "rule:ccc" not in out
    assert long.strip() in out and "https://x/rule:aaa" in out
    assert out.index("## rule_text") < out.index("## section")  # grouped by kind
    assert (tmp / "todo.md").read_text(encoding="utf-8") == out


def test_text_is_stripped_of_html(env, capfd):
    _, _, put = env
    put([item("rule:aaa")])
    _, out = run(capfd)
    assert "שלום עולם כלל" in out and "<b>" not in out and "&nbsp;" not in out


def test_stale_keys_are_reported_and_fail(env, capfd):
    _, spec_file, put = env
    put([item("rule:aaa")])
    set_coverage(spec_file, {"rule:aaa": {"not_planning_rule": "n/a"}, "rule:gone": {"not_planning_rule": "x"}})
    code, out = run(capfd)
    assert code == 1 and "rule:gone" in out


def test_exit_zero_when_nothing_left(env, capfd):
    _, spec_file, put = env
    put([item("rule:aaa")])
    set_coverage(spec_file, {"rule:aaa": {"not_planning_rule": "n/a"}})
    code, out = run(capfd)
    assert code == 0 and "0 unaccounted" in out


def test_apply_suggestions_fills_missing_only_and_is_idempotent(env, capfd):
    _, spec_file, put = env
    put([item("c:1", kind="course_fact", course_id="0512-1204"),
         item("c:2", kind="course_fact", course_id="0512-1204"), item("rule:zzz")])
    set_coverage(spec_file, {"c:2": {"not_planning_rule": "kept"}})
    code, out = run(capfd, "--apply-suggestions")
    assert code == 1 and "rule:zzz" in out and "id: c:1" not in out
    after = load_spec(spec_file)
    assert after.coverage["c:1"] == MappedTo(mapped_to="mandatory_courses[0512-1204]")
    assert after.coverage["c:2"].not_planning_rule == "kept"
    first = spec_file.read_bytes()
    run(capfd, "--apply-suggestions")
    assert spec_file.read_bytes() == first


def test_missing_evidence_is_an_error(env, capfd):
    code, _ = run(capfd)
    assert code == 2


def test_todo_md_is_gitignored():
    assert "data/degrees/**/todo.md" in (ROOT / ".gitignore").read_text(encoding="utf-8")


def test_empty_evidence_fails_like_check_coverage(env, capfd):
    _, _, put = env
    put([])
    code, out = run(capfd)
    assert code == 1 and "no evidence collected" in out


def test_coverage_gaps_match_check_coverage():
    from app.degrees.checks import check_coverage
    from app.degrees.checks.coverage import coverage_gaps
    from app.degrees.evidence import EvidenceItem

    items = [EvidenceItem.model_validate(item(f"rule:{n}")) for n in ("none", "bad", "blank", "ok", "map")]
    spec = new_spec(ME).model_copy(update={"coverage": {
        "rule:bad": MappedTo(mapped_to="categories[nope]"),
        "rule:blank": NotPlanningRule(not_planning_rule=" "),
        "rule:ok": NotPlanningRule(not_planning_rule="n/a"),
        "rule:map": MappedTo(mapped_to="categories[nope]"),
        "rule:gone": NotPlanningRule(not_planning_rule="x"),
    }})
    gaps, stale = coverage_gaps(items, spec)
    flagged = {i.id for i, _ in gaps} | set(stale)
    problems = check_coverage(items, spec).problems
    assert flagged == {"rule:none", "rule:bad", "rule:blank", "rule:map", "rule:gone"}
    assert len(problems) == len(flagged)
    assert all(any(k in p for p in problems) for k in flagged)


def test_unread_page_must_go_to_known_gaps(env, capfd):
    _, spec_file, put = env
    put([dict(item("pdf:d:unread-page-2", text="[page 2 has no extractable text]"), data={"page": 2, "unread": True})])
    set_coverage(spec_file, {"pdf:d:unread-page-2": {"not_planning_rule": "scanned page"}})
    code, out = run(capfd)
    assert code == 1
    assert "- id: pdf:d:unread-page-2 (unread page not in known_gaps)" in out and "1 unaccounted" in out


def test_todo_names_every_target_and_the_unresolved_ones(env, capfd):
    _, spec_file, put = env
    put([item("rule:1"), item("rule:2")])
    set_coverage(spec_file, {"rule:1": {"mapped_to": ["categories[nope]", "mandatory_courses[0512-1204]"]},
                             "rule:2": {"mapped_to": "categories[gone]"}})
    code, out = run(capfd)
    assert code == 1
    assert ("- id: rule:1 (unresolved mapping) -> categories[nope], mandatory_courses[0512-1204] "
            "[unresolved: categories[nope]]") in out
    assert "- id: rule:2 (unresolved mapping) -> categories[gone]" in out


def test_reuse_from_copies_then_suggests_and_never_overwrites(tmp_path, monkeypatch, capfd):
    here_dir, other_dir = tmp_path / "here", tmp_path / "other"
    here_dir.mkdir(), other_dir.mkdir()
    other_entry = ME.model_copy(update={"id": "other_degree_2027"})
    entries = {ME.id: ME, other_entry.id: other_entry}
    monkeypatch.setattr(degree, "get_program", lambda pid: entries[pid])
    monkeypatch.setattr(degree, "spec_path",
                        lambda entry: (here_dir if entry.id == ME.id else other_dir) / "spec.json")
    base = new_spec(ME).model_copy(update={"mandatory_courses": [
        MandatoryCourse(course_id="0512-1204", year=3, semester="A", placement_rule="")]})
    write_spec(base.model_copy(update={"coverage": {"r:kept": NotPlanningRule(not_planning_rule="mine")}}),
               here_dir / "spec.json")
    write_spec(base.model_copy(update={"coverage": {
        "r:same": NotPlanningRule(not_planning_rule="theirs"),
        "r:kept": NotPlanningRule(not_planning_rule="theirs"),
        "r:diff": NotPlanningRule(not_planning_rule="theirs"),
        "c:1": NotPlanningRule(not_planning_rule="ME-specific reason"),
        "p:1": NotPlanningRule(not_planning_rule="policy"),
        "r:bad": MappedTo(mapped_to="categories[nope]"),
    }}), other_dir / "spec.json")
    shared = [item("r:same"), item("r:kept"), item("c:1", kind="course_fact", course_id="0512-1204"),
              item("r:bad"), item("p:1", kind="policy_text")]
    (here_dir / "evidence.json").write_text(json.dumps(
        shared + [item("r:diff", text="new"), item("c:2", kind="course_fact", course_id="0512-1204")],
        ensure_ascii=False), encoding="utf-8")
    (other_dir / "evidence.json").write_text(json.dumps(shared + [item("r:diff", text="old")], ensure_ascii=False),
                                             encoding="utf-8")
    other_before = (other_dir / "spec.json").read_bytes()
    code, out = run(capfd, "--reuse-from", other_entry.id, "--apply-suggestions")
    after = load_spec(here_dir / "spec.json")
    assert after.coverage["r:same"].not_planning_rule == "theirs"
    assert after.coverage["r:kept"].not_planning_rule == "mine"
    assert after.coverage["p:1"].not_planning_rule == "policy"
    # a course item homed here is never reused: the suggestion fills it
    assert after.coverage["c:1"] == MappedTo(mapped_to="mandatory_courses[0512-1204]")
    assert after.coverage["c:2"] == MappedTo(mapped_to="mandatory_courses[0512-1204]")
    assert "r:diff" not in after.coverage and "r:bad" not in after.coverage
    assert "reused 2 coverage entries from other_degree_2027" in out
    assert "2 need review" in out and "1 skipped (evidence text differs)" in out
    todo_md = (here_dir / "todo.md").read_text(encoding="utf-8")
    assert todo_md == out
    reused = out.split("## reused from other_degree_2027 (verify)")[1].split("##")[0]
    assert "- r:same: " in reused and "- p:1: " in reused and '"policy"' in reused and "c:1" not in reused
    review = out.split("## needs review")[1].split("##")[0]
    assert "- r:bad: " in review and "categories[nope]" in review and "- c:1: " in review
    assert "- r:diff" in out.split("## not reused from other_degree_2027 (evidence text differs)")[1]
    assert code == 1  # r:diff and r:bad still open
    assert (other_dir / "spec.json").read_bytes() == other_before
    first = (here_dir / "spec.json").read_bytes()
    run(capfd, "--reuse-from", other_entry.id, "--apply-suggestions")
    assert (here_dir / "spec.json").read_bytes() == first


def test_reuse_from_self_unknown_degree_or_missing_files_is_an_error(env, capfd, monkeypatch):
    tmp, spec_file, put = env
    put([item("rule:aaa")])
    before = spec_file.read_bytes()
    code = degree.main(["todo", "--program", ME.id, "--reuse-from", ME.id])
    assert code == 2 and "itself" in capfd.readouterr().err

    other = ME.model_copy(update={"id": "other_degree_2027"})
    entries = {ME.id: ME, other.id: other}

    def lookup(pid):
        if pid not in entries:
            raise KeyError(pid)
        return entries[pid]
    monkeypatch.setattr(degree, "get_program", lookup)
    code = degree.main(["todo", "--program", ME.id, "--reuse-from", "no_such_degree_2027"])
    assert code == 2 and "no such registry program" in capfd.readouterr().err

    other_dir = tmp / "other"
    other_dir.mkdir()
    monkeypatch.setattr(degree, "spec_path",
                        lambda entry: spec_file if entry.id == ME.id else other_dir / "spec.json")
    code = degree.main(["todo", "--program", ME.id, "--reuse-from", other.id])     # no evidence there
    assert code == 2 and "evidence.json not found" in capfd.readouterr().err
    (other_dir / "evidence.json").write_text("[]", encoding="utf-8")
    code = degree.main(["todo", "--program", ME.id, "--reuse-from", other.id])     # no spec there
    assert code == 2 and "spec.json not found" in capfd.readouterr().err
    assert spec_file.read_bytes() == before

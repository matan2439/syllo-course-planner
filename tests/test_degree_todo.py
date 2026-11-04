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
    parsed = {k: NotPlanningRule(**v) for k, v in coverage.items()}
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

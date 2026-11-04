"""degree.py publish: the gate a new degree passes before it goes live (hermetic: build,
the check run and evidence are monkeypatched; the registry is a tmp copy)."""
import json
import shutil
import sys
from datetime import datetime, timezone
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "scripts"))

import degree  # noqa: E402
from app.degrees import registry  # noqa: E402
from app.degrees import spec as spec_mod  # noqa: E402
from app.degrees.checks import CheckResult  # noqa: E402
from app.degrees.evidence import EvidenceItem  # noqa: E402

NEW_ID = "publish_probe_2027"
T1 = datetime(2026, 11, 4, 9, 0, tzinfo=timezone.utc)
T2 = datetime(2026, 11, 4, 9, 5, tzinfo=timezone.utc)


def _items():
    rows = [("e1", "https://tau.example/program", T1, "section"),
            ("e2", "https://tau.example/program", T2, "rule_text"),
            ("e3", "https://tau.example/course/1", T1, "course_listing"),
            ("e4", "https://tau.example/course/2", T2, "course_listing")]
    return [EvidenceItem(id=i, source_url=u, fetched_at=t, from_cache=False, kind=k, path=[], raw_text="x")
            for i, u, t, k in rows]


def _run(results, skipped=()):
    passed = all(r.passed for r in results) and not skipped
    return degree.CheckRun(results=list(results), skipped=list(skipped), items=_items(),
                           report="# report\n", passed=passed)


ALL_PASS = [CheckResult(name=n, passed=True) for n in ("coverage", "freshness", "courses_known", "plannable")]


@pytest.fixture
def sandbox(tmp_path, monkeypatch):
    """A tmp registry with a draft degree added, scratch degrees dir, and a call log."""
    reg = tmp_path / "programs.json"
    shutil.copyfile(registry.DEFAULT_PATH, reg)
    monkeypatch.setattr(registry, "DEFAULT_PATH", reg)
    me = registry.get_program("mechanical_engineering_2027")
    me_spec = spec_mod.spec_path(me)
    monkeypatch.setattr(spec_mod, "DEGREES_DIR", tmp_path / "degrees")
    # The other live degree degree.py builds (the 2025 entries have no spec.json: never rebuilt).
    spec_mod.spec_path(me).parent.mkdir(parents=True)
    shutil.copyfile(me_spec, spec_mod.spec_path(me))
    draft = me.model_copy(update={"id": NEW_ID, "base": "publish_probe", "family_id": "publish_probe",
                                  "status": "draft", "is_family_default": True,
                                  "board_json_file": "publish_probe_board.json"})
    registry.add_program(draft)
    calls = []
    monkeypatch.setattr(degree, "build", lambda entry, out_dir=degree.DATA, offline=False, live=False, refresh=True:
                        calls.append(("build", entry.id, out_dir, offline, live)) or {})
    monkeypatch.setattr(degree, "collect", lambda *a, **kw: (_ for _ in ()).throw(AssertionError("fetched")))
    monkeypatch.setattr(degree, "refresh_early_index", lambda: calls.append(("index",)) or Path("index.json"))
    return {"registry": reg, "calls": calls, "tmp": tmp_path}


ME = "mechanical_engineering_2027"


def _builds(calls):
    """The build calls with a scratch out_dir shown as "tmp"."""
    return [(c[0], c[1], c[2] if c[2] == degree.DATA else "tmp", c[3], c[4]) for c in calls if c[0] == "build"]


# build --live into data/, then every other live degree (ME) rebuilt offline into a scratch dir.
EXPECTED_BUILDS = [("build", NEW_ID, degree.DATA, False, True), ("build", ME, "tmp", True, False)]


def _status(reg: Path, program_id: str) -> str:
    raw = json.loads(reg.read_text(encoding="utf-8"))
    return next(p["status"] for p in raw["programs"] if p["id"] == program_id)


def test_publish_refuses_unless_live_check_passes(sandbox, monkeypatch, capsys):
    before = sandbox["registry"].read_bytes()
    results = [*ALL_PASS[:2], CheckResult(name="plannable", passed=False, problems=["Y3/A over cap"])]
    seen = []
    monkeypatch.setattr(degree, "run_checks", lambda entry, live, offline:
                        seen.append((entry.id, live, offline)) or _run(results, skipped=["known_gaps"]))
    assert degree.main(["publish", "--program", NEW_ID]) == 1
    out = capsys.readouterr()
    text = out.out + out.err
    assert "plannable: FAIL" in text and "known_gaps: SKIPPED" in text
    assert "registry unchanged" in text and "built files" in text
    assert seen == [(NEW_ID, True, False)]  # the check runs live
    assert _builds(sandbox["calls"]) == EXPECTED_BUILDS
    assert ("index",) not in sandbox["calls"]
    assert sandbox["registry"].read_bytes() == before
    assert not spec_mod.spec_path(registry.get_program(NEW_ID)).with_name("RELEASE.md").exists()

    # A SKIPPED check alone (everything else passing) refuses too.
    monkeypatch.setattr(degree, "run_checks", lambda entry, live, offline: _run(ALL_PASS, skipped=["freshness"]))
    assert degree.main(["publish", "--program", NEW_ID]) == 1
    assert "freshness: SKIPPED" in capsys.readouterr().err
    assert sandbox["registry"].read_bytes() == before


def test_publish_flips_status_and_prints_commands(sandbox, monkeypatch, capsys):
    monkeypatch.setattr(degree, "run_checks", lambda entry, live, offline: _run(ALL_PASS))
    raw_before = json.loads(sandbox["registry"].read_text(encoding="utf-8"))
    assert degree.main(["publish", "--program", NEW_ID]) == 0
    out = capsys.readouterr().out

    raw_after = json.loads(sandbox["registry"].read_text(encoding="utf-8"))
    assert _status(sandbox["registry"], NEW_ID) == "live"
    # Only the status changed: every other entry and field (and the order) is untouched.
    for a, b in zip(raw_before["programs"], raw_after["programs"]):
        if a["id"] == NEW_ID:
            a = {**a, "status": "live"}
        assert a == b
    assert sandbox["registry"].read_text(encoding="utf-8").endswith("}\n")

    entry = registry.get_program(NEW_ID)
    release = spec_mod.spec_path(entry).with_name("RELEASE.md").read_text(encoding="utf-8")
    assert NEW_ID in release and "2026-11-04" in release
    assert "course_listing: 2" in release and "section: 1" in release and "rule_text: 1" in release
    for r in ALL_PASS:
        assert f"{r.name}: PASS" in release
    # Each source once, with its latest fetch time.
    assert "https://tau.example/program (fetched_at 2026-11-04T09:05:00+00:00)" in release
    assert "https://tau.example/course/1 (fetched_at 2026-11-04T09:00:00+00:00)" in release

    sync = f"ENV_FILE=.env.local node scripts/update-board-json.mjs publish_probe 2027 data/boards/{NEW_ID}.json"
    assert sync in out
    assert "commit, open a PR, deploy" in out
    assert "0 rows = not seeded yet" in out and "committed file after deploy" in out
    assert _builds(sandbox["calls"]) == EXPECTED_BUILDS
    assert sandbox["calls"][-1] == ("index",)  # the early-year index is rewritten after the status flip


def test_publish_writes_release_before_the_status_flip(sandbox, monkeypatch):
    monkeypatch.setattr(degree, "run_checks", lambda entry, live, offline: _run(ALL_PASS))
    seen = []
    real = registry.set_status

    def spy(program_id, status, path=None):
        entry = registry.get_program(program_id)
        seen.append(spec_mod.spec_path(entry).with_name("RELEASE.md").exists())
        real(program_id, status, path)

    monkeypatch.setattr(registry, "set_status", spy)
    assert degree.main(["publish", "--program", NEW_ID]) == 0
    assert seen == [True]


def test_publish_refuses_when_another_live_degree_would_change(sandbox, monkeypatch, capsys):
    """Course-wide facts refreshed by the live build must not silently change ME's committed boards."""
    before = sandbox["registry"].read_bytes()
    me = registry.get_program(ME)
    committed = json.loads(degree.board_paths(me)["board"].read_text(encoding="utf-8"))
    course = committed["metadata"]["program_repository_courses"][0]

    def fake_build(entry, out_dir=degree.DATA, offline=False, live=False, refresh=True):
        sandbox["calls"].append(("build", entry.id, out_dir, offline, live))
        if entry.id == ME:
            assert Path(out_dir) != degree.DATA  # never rebuilt into data/
            target = degree.board_paths(entry, Path(out_dir))["board"]
            board = json.loads(target.read_text(encoding="utf-8"))  # seeded with the committed board
            board["metadata"]["program_repository_courses"][0]["offered_semesters"] = ["Z"]
            target.write_text(json.dumps(board, ensure_ascii=False, indent=2), encoding="utf-8")
        return {}

    monkeypatch.setattr(degree, "build", fake_build)
    monkeypatch.setattr(degree, "run_checks", lambda *a, **kw: (_ for _ in ()).throw(AssertionError("checked")))
    assert degree.main(["publish", "--program", NEW_ID]) == 1
    err = capsys.readouterr().err
    assert "refused" in err and f"{ME}:" in err
    assert "data/boards/mechanical_engineering_2027.json: changed" in err
    assert course["course_id"] in err
    assert "semester_board" not in err and "years_1_2" not in err  # only the changed file is listed
    assert sandbox["registry"].read_bytes() == before
    assert ("index",) not in sandbox["calls"]
    assert not spec_mod.spec_path(registry.get_program(NEW_ID)).with_name("RELEASE.md").exists()


def test_publish_refuses_an_archived_degree(sandbox, monkeypatch, capsys):
    registry.set_status(NEW_ID, "archived")
    before = sandbox["registry"].read_bytes()
    monkeypatch.setattr(degree, "run_checks", lambda *a, **kw: (_ for _ in ()).throw(AssertionError("checked")))
    assert degree.main(["publish", "--program", NEW_ID]) == 1
    err = capsys.readouterr().err
    assert "is archived" in err and "only a draft degree can be published" in err
    assert sandbox["calls"] == []
    assert sandbox["registry"].read_bytes() == before


def test_check_without_a_board_says_build_first(sandbox, monkeypatch, capsys):
    monkeypatch.setattr(degree, "board_paths", lambda entry, data_dir=None: {"board": sandbox["tmp"] / "none.json"})
    monkeypatch.setattr(degree, "load_spec", lambda path: None)
    monkeypatch.setattr(degree, "load_program_facts", lambda *a, **kw: {})
    assert degree.main(["check", "--program", NEW_ID, "--offline"]) == 2
    err = capsys.readouterr().err
    assert "build first" in err and f"degree.py build --program {NEW_ID}" in err


def test_publish_refuses_live_degree_update_until_plan_3(sandbox, monkeypatch, capsys):
    monkeypatch.setattr(degree, "run_checks", lambda *a, **kw: (_ for _ in ()).throw(AssertionError("checked")))
    before = sandbox["registry"].read_bytes()
    assert degree.main(["publish", "--program", "mechanical_engineering_2027"]) == 1
    err = capsys.readouterr().err
    assert "already live" in err and "--update" in err
    assert degree.main(["publish", "--program", "mechanical_engineering_2027", "--update"]) == 1
    assert "impact analysis not built yet (Plan 3)" in capsys.readouterr().err
    assert sandbox["calls"] == []  # nothing was built
    assert sandbox["registry"].read_bytes() == before


def test_publish_rejects_offline(sandbox, capsys):
    assert degree.main(["publish", "--program", NEW_ID, "--offline"]) == 2
    assert sandbox["calls"] == []


def test_set_status_validates_and_keeps_layout(tmp_path):
    reg = tmp_path / "programs.json"
    shutil.copyfile(registry.DEFAULT_PATH, reg)
    before = reg.read_text(encoding="utf-8")
    registry.set_status("mechanical_engineering_2027", "live", path=reg)
    assert reg.read_text(encoding="utf-8") == before  # same status -> byte-identical rewrite
    with pytest.raises(KeyError):
        registry.set_status("no_such_2027", "live", path=reg)
    with pytest.raises(ValueError):
        registry.set_status("mechanical_engineering_2027", "published", path=reg)
    assert reg.read_text(encoding="utf-8") == before


def test_run_checks_exposes_skipped_freshness_offline(monkeypatch, tmp_path):
    monkeypatch.setattr(degree, "collect", lambda entry, live, offline: [])
    monkeypatch.setattr(degree, "REPORT_DIR", tmp_path)
    run = degree.run_checks(registry.get_program("mechanical_engineering_2027"), live=False, offline=True)
    assert run.skipped == ["freshness"] and not run.passed
    assert "freshness" not in [r.name for r in run.results]
    assert run.report.rstrip().endswith("Result: FAIL")

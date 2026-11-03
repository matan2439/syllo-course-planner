"""degree.py CLI contract: check modes, spec-generated builder inputs."""
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "scripts"))

import degree  # noqa: E402
from app.degrees.registry import get_program  # noqa: E402
from app.degrees.spec import load_spec, spec_path  # noqa: E402

ME = get_program("mechanical_engineering_2027")


def test_check_refuses_without_live_or_offline(capsys):
    assert degree.main(["check", "--program", ME.id]) != 0
    assert "--live" in capsys.readouterr().err


def test_check_offline_skips_freshness_and_never_passes(monkeypatch, tmp_path, capsys):
    monkeypatch.setattr(degree, "collect", lambda entry, live, offline: [])
    monkeypatch.setattr(degree, "REPORT_DIR", tmp_path)
    assert degree.main(["check", "--program", ME.id, "--offline"]) == 1
    report = (tmp_path / f"degree_check_{ME.id}.md").read_text(encoding="utf-8")
    assert "## freshness: SKIPPED" in report
    assert "## freshness: PASS" not in report and "## freshness: FAIL" not in report
    assert report.rstrip().endswith("Result: FAIL")
    assert "## courses_known" in report and "## plannable" in report


def test_live_and_offline_are_exclusive():
    try:
        degree.main(["build", "--program", ME.id, "--live", "--offline"])
    except SystemExit as exc:
        assert exc.code != 0
    else:
        raise AssertionError("argparse should reject --live with --offline")


def test_mandatory_input_is_generated_from_the_spec():
    spec = load_spec(spec_path(ME))
    facts = {"0542-3620": {"ims": {"name_he": "מעבר חום"}, "program": {"weekly_hours": 4}}}
    rows = {r["course_id"]: r for r in degree.mandatory_courses_file(spec, 3, facts)["courses"]}
    late = [m for m in spec.mandatory_courses if m.year >= 3]
    assert list(rows) == [m.course_id for m in late]  # spec order, Years 3-4 only
    assert rows["0542-3620"]["allowed_semesters"] == ["year_3_semester_a", "year_3_semester_b"]
    assert rows["0542-3620"]["name_he"] == "מעבר חום" and rows["0542-3620"]["weekly_hours"] == 4
    assert rows["0512-1204"]["allowed_semesters"] == ["year_3_semester_a"]
    # 0542-2500 is a recorded source conflict; the spec keeps it in Y3/A, so the main board places it.
    assert rows["0542-2500"]["allowed_semesters"] == ["year_3_semester_a"]

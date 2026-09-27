"""Integrity of the committed boards against the official current-year facts snapshot."""

import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "scripts"))

from refresh_course_data import (  # noqa: E402
    ACADEMIC_YEAR, BOARDS, board_courses, compare, resolve_offering, semesters_from_groups, timetable_semesters,
)

FACTS = json.loads((ROOT / "data" / "official" / f"tau_course_facts_{ACADEMIC_YEAR}.json").read_text(encoding="utf-8"))


def test_semester_label_mapping():
    assert semesters_from_groups(["א'", "א'"]) == ["A"]
    assert semesters_from_groups(["ב'", "א'"]) == ["A", "B"]
    assert semesters_from_groups(["שנתי"]) == ["A", "B"]
    assert semesters_from_groups([None, "קיץ"]) == []



def test_timetable_semkvutza_mapping():
    kurs = lambda *sems: {"kvutza": [{"semkvutza": s} for s in sems]}
    assert timetable_semesters(kurs("20261", "20261")) == ["A"]
    assert timetable_semesters(kurs("20262")) == ["B"]
    assert timetable_semesters(kurs("20260")) == ["A", "B"]
    assert timetable_semesters(kurs("20261", "20262")) == ["A", "B"]
    assert timetable_semesters({"kvutza": []}) == []


def test_program_timetable_beats_ims():
    ims = {"status": "offered", "offered_semesters": ["A"], "url": "ims"}
    assert resolve_offering(ims, ["A", "B"], 2026)["offered_semesters"] == ["A", "B"]
    assert resolve_offering(ims, ["A", "B"], 2026)["source"] == "program_timetable"
    assert resolve_offering(ims, None, 2026)["source"] == "ims"


def test_boards_match_official_facts():
    for path in BOARDS:
        board = json.loads(path.read_text(encoding="utf-8"))
        rows = [r for r in compare(board, FACTS, ACADEMIC_YEAR) if r["field"] != "timetable_vs_ims"]
        assert rows == [], path.name


def test_not_offered_courses_have_no_legal_semester():
    for path in BOARDS:
        board = json.loads(path.read_text(encoding="utf-8"))
        for loc, c in board_courses(board):
            if c.get("offered_in_year") is False:
                assert loc == "pool", c["course_id"]
                assert not c.get("offered_semesters"), c["course_id"]
                assert not c.get("effective_allowed_semesters"), c["course_id"]

"""Integrity of the committed boards against the official current-year facts snapshot."""

import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "scripts"))

from refresh_course_data import ACADEMIC_YEAR, BOARDS, board_courses, compare, semesters_from_groups  # noqa: E402

FACTS = json.loads((ROOT / "data" / "official" / f"tau_course_facts_{ACADEMIC_YEAR}.json").read_text(encoding="utf-8"))


def test_semester_label_mapping():
    assert semesters_from_groups(["א'", "א'"]) == ["A"]
    assert semesters_from_groups(["ב'", "א'"]) == ["A", "B"]
    assert semesters_from_groups(["שנתי"]) == ["A", "B"]
    assert semesters_from_groups([None, "קיץ"]) == []


def test_boards_match_official_facts():
    for path in BOARDS:
        board = json.loads(path.read_text(encoding="utf-8"))
        assert compare(board, FACTS, ACADEMIC_YEAR) == [], path.name


def test_not_offered_courses_have_no_legal_semester():
    for path in BOARDS:
        board = json.loads(path.read_text(encoding="utf-8"))
        for loc, c in board_courses(board):
            if c.get("offered_in_year") is False:
                assert loc == "pool", c["course_id"]
                assert not c.get("offered_semesters"), c["course_id"]
                assert not c.get("effective_allowed_semesters"), c["course_id"]

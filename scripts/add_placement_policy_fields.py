"""
One-off migration: add `is_mandatory`, `placement_policy`, and
`recommended_semester` fields to every course in a board JSON file,
derived from existing `course_type`, `placement_rule`, and
`allowed_semesters` fields. Does not touch syllabus or any other data.

Usage:
    python -m scripts.add_placement_policy_fields data/parsed_json/mechanical_semester_board_2027.json
"""

from __future__ import annotations

import json
import sys
from pathlib import Path


def _placement_policy(course: dict) -> str:
    if course.get("course_type") != "mandatory":
        return "elective"
    return "flexible" if course.get("placement_rule") == "choose_one_allowed_semester" else "fixed"


def _annotate(course: dict) -> None:
    is_mandatory = course.get("course_type") == "mandatory"
    course["is_mandatory"] = is_mandatory
    course["placement_policy"] = _placement_policy(course)
    if "recommended_semester" not in course:
        allowed = course.get("allowed_semesters") or []
        course["recommended_semester"] = allowed[0] if allowed else None


def main() -> int:
    board_path = Path(sys.argv[1])
    data = json.loads(board_path.read_text(encoding="utf-8"))

    for semester in data.get("semesters", []):
        for course in semester.get("courses", []):
            _annotate(course)
    for course in data.get("metadata", {}).get("program_repository_courses", []):
        _annotate(course)

    board_path.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"Annotated placement_policy/is_mandatory/recommended_semester in {board_path}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

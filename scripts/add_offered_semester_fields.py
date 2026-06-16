"""
One-off migration: add `program_allowed_semesters`, `offered_semesters`,
`effective_allowed_semesters`, `offering_source_url`, and
`offering_source_confidence` fields to mandatory courses in a board JSON
file, without destroying existing `allowed_semesters`/`placement_policy`
("official program flexibility") data.

Usage:
    python -m scripts.add_offered_semester_fields data/parsed_json/mechanical_semester_board_2027.json
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

OFFERED_SEMESTERS_OVERRIDES: dict[str, dict] = {
    "0542-3620": {
        "offered_semesters": ["A"],
        "offering_source_url": "https://ims.tau.ac.il/Tal/Syllabus/Syllabus_L.aspx?course=0542362001&year=2025",
        "offering_source_confidence": "high",
    },
    # 0542-3780 / 0542-3791: syllabus evidence shows these are offered in Semester
    # B only (Friday 08:00-11:00 in B). The original migration wrongly recorded
    # offered_semesters=["A"] (confused the nominal/recommended semester with the
    # actual syllabus offering). Corrected to ["B"]. See
    # scripts/fix_annual_and_offering_data.py for the targeted board fix.
    "0542-3780": {
        "offered_semesters": ["B"],
        "offering_source_url": "https://ims.tau.ac.il/Tal/Syllabus/Syllabus_L.aspx?course=0542378001&year=2025",
        "offering_source_confidence": "high",
    },
    "0542-3791": {
        "offered_semesters": ["B"],
        "offering_source_url": "https://ims.tau.ac.il/Tal/Syllabus/Syllabus_L.aspx?course=0542379101&year=2025",
        "offering_source_confidence": "high",
    },
    # 0542-3792 is offered across A+B, but it is an ANNUAL (year-long) course
    # ("החל משנת תשפ\"ו זהו קורס שנתי") — it occupies BOTH semesters together rather
    # than being a free A-or-B choice. The annual flags (is_annual / spans_semesters /
    # count_hours_once) are layered on by scripts/fix_annual_and_offering_data.py;
    # the ["A","B"] offering here remains compatible with that.
    "0542-3792": {
        "offered_semesters": ["A", "B"],
        "offering_source_url": "https://ims.tau.ac.il/Tal/Syllabus/Syllabus_L.aspx?course=0542379201&year=2025",
        "offering_source_confidence": "high",
    },
    "0542-4010": {
        "offered_semesters": ["A"],
        "offering_source_url": "https://ims.tau.ac.il/Tal/Syllabus/Syllabus_L.aspx?course=0542401001&year=2025",
        "offering_source_confidence": "high",
    },
    "0542-4020": {
        "offered_semesters": ["B"],
        "offering_source_url": "https://ims.tau.ac.il/Tal/Syllabus/Syllabus_L.aspx?course=0542402001&year=2025",
        "offering_source_confidence": "high",
    },
    "0542-4091": {
        "offered_semesters": ["B"],
        "offering_source_url": "https://ims.tau.ac.il/Tal/Syllabus/Syllabus_L.aspx?course=0542409110&year=2025",
        "offering_source_confidence": "high",
    },
    "0542-4092": {
        "offered_semesters": ["A"],
        "offering_source_url": "https://ims.tau.ac.il/Tal/Syllabus/Syllabus_L.aspx?course=0542409201&year=2025",
        "offering_source_confidence": "high",
    },
}

_PART_TO_SUFFIX = {"A": "_semester_a", "B": "_semester_b"}


def _offering_fields(course_id: str, allowed_sems: list[str]) -> dict:
    override = OFFERED_SEMESTERS_OVERRIDES.get(course_id)
    program_allowed = list(allowed_sems)
    if override:
        offered = list(override["offered_semesters"])
        offered_suffixes = [_PART_TO_SUFFIX[p] for p in offered if p in _PART_TO_SUFFIX]
        effective = [s for s in program_allowed if any(s.endswith(suf) for suf in offered_suffixes)] or program_allowed
        source_url = override["offering_source_url"]
        confidence = override["offering_source_confidence"]
    else:
        offered = None
        effective = program_allowed
        source_url = None
        confidence = "low"
    return {
        "program_allowed_semesters": program_allowed,
        "offered_semesters": offered,
        "effective_allowed_semesters": effective,
        "offering_source_url": source_url,
        "offering_source_confidence": confidence,
    }


def _annotate(course: dict) -> None:
    if not course.get("is_mandatory"):
        return
    allowed = course.get("allowed_semesters") or []
    course.update(_offering_fields(course["course_id"], allowed))


def main() -> int:
    board_path = Path(sys.argv[1])
    data = json.loads(board_path.read_text(encoding="utf-8"))

    for semester in data.get("semesters", []):
        for course in semester.get("courses", []):
            _annotate(course)
    for course in data.get("metadata", {}).get("program_repository_courses", []):
        _annotate(course)

    board_path.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"Annotated offered-semester fields in {board_path}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

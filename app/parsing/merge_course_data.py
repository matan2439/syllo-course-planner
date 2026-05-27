"""
Merges a parsed course-search JSON and a parsed syllabus JSON into one
normalised course record.

Priority rules
--------------
Course-search is primary for : name, faculty, department, year, groups,
                                syllabus_links, semester
Syllabus is primary for       : credits, lecture_hours, tutorial_hours,
                                lab_hours, prerequisites, description,
                                topics, assignments, exam_info
Missing fields are filled from whichever source has them; neither crashes.
"""

import json
import re
from pathlib import Path
from typing import Any


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------

def merge_course_and_syllabus(
    course_data: dict[str, Any],
    syllabus_data: dict[str, Any],
) -> dict[str, Any]:
    """Return a single merged course record from the two parsed dicts.

    Either argument may be empty ({}) — the function fills what it can and
    returns None-valued fields for everything that cannot be derived.
    """
    # ── identity ─────────────────────────────────────────────────────────────
    course_id = (
        course_data.get("course_id")
        or syllabus_data.get("course_id")
        or "unknown"
    )

    # ── names  (course-search primary) ───────────────────────────────────────
    name_he = (
        course_data.get("name_hebrew")
        or syllabus_data.get("name_he")
    )
    name_en = (
        course_data.get("name_english")
        or syllabus_data.get("name_en")
    )

    # ── structural fields (course-search primary) ─────────────────────────────
    faculty    = course_data.get("faculty")    or syllabus_data.get("faculty")
    department = course_data.get("department") or syllabus_data.get("department")
    year       = course_data.get("year")       or syllabus_data.get("year")
    groups     = course_data.get("groups", [])

    semesters_list: list[str] = course_data.get("semesters", [])
    semester = semesters_list[0] if semesters_list else course_data.get("semester")

    syllabus_links = _collect_syllabus_links(groups)

    # ── depth fields (syllabus primary, course-search fallback) ───────────────
    credits        = _first(syllabus_data.get("credits"),        course_data.get("credits"))
    lecture_hours  = _first(syllabus_data.get("lecture_hours"),  course_data.get("lecture_hours"))
    tutorial_hours = _first(syllabus_data.get("tutorial_hours"), course_data.get("tutorial_hours"))
    lab_hours      = _first(syllabus_data.get("lab_hours"),      course_data.get("lab_hours"))

    prerequisites_raw_text  = syllabus_data.get("prerequisites_raw_text")
    prerequisite_course_ids = syllabus_data.get("prerequisite_course_ids", [])
    course_description      = syllabus_data.get("course_description")
    topics                  = syllabus_data.get("topics", [])
    assignments             = syllabus_data.get("assignments")
    exam_info               = syllabus_data.get("exam_info")

    # ── provenance ────────────────────────────────────────────────────────────
    source_files: dict[str, str] = {}
    if course_data.get("source_file"):
        source_files["course_search"] = course_data["source_file"]
    if syllabus_data.get("source_file"):
        source_files["syllabus"] = syllabus_data["source_file"]

    return {
        "course_id":               course_id,
        "name_he":                 name_he,
        "name_en":                 name_en,
        "faculty":                 faculty,
        "department":              department,
        "year":                    year,
        "semester":                semester,
        "groups":                  groups,
        "syllabus_links":          syllabus_links,
        "credits":                 credits,
        "lecture_hours":           lecture_hours,
        "tutorial_hours":          tutorial_hours,
        "lab_hours":               lab_hours,
        "prerequisites_raw_text":  prerequisites_raw_text,
        "prerequisite_course_ids": prerequisite_course_ids,
        "course_description":      course_description,
        "topics":                  topics,
        "assignments":             assignments,
        "exam_info":               exam_info,
        "source_files":            source_files,
    }


# ---------------------------------------------------------------------------
# Internal helpers
# ---------------------------------------------------------------------------

def _collect_syllabus_links(groups: list[dict[str, Any]]) -> list[str]:
    """Return deduplicated syllabus URLs from all group entries, preserving order."""
    seen: set[str] = set()
    links: list[str] = []
    for g in groups:
        url = g.get("syllabus_url")
        if url and url not in seen:
            seen.add(url)
            links.append(url)
    return links


def _first(*values: Any) -> Any:
    """Return the first value that is not None."""
    for v in values:
        if v is not None:
            return v
    return None


def _output_filename(course_id: str, year: int | None) -> str:
    digits = re.sub(r"\D", "", course_id)
    suffix = f"_{year}" if year else ""
    return f"merged_course_{digits}{suffix}.json"


# ---------------------------------------------------------------------------
# CLI
# ---------------------------------------------------------------------------

if __name__ == "__main__":
    import argparse

    cli = argparse.ArgumentParser(
        description="Merge a parsed course-search JSON and syllabus JSON."
    )
    cli.add_argument("--course-json",   required=True, help="Path to course search JSON")
    cli.add_argument("--syllabus-json", required=True, help="Path to syllabus JSON")
    args = cli.parse_args()

    course_path   = Path(args.course_json)
    syllabus_path = Path(args.syllabus_json)

    for p in (course_path, syllabus_path):
        if not p.exists():
            print(f"File not found: {p}")
            raise SystemExit(1)

    course_data   = json.loads(course_path.read_text(encoding="utf-8"))
    syllabus_data = json.loads(syllabus_path.read_text(encoding="utf-8"))

    merged = merge_course_and_syllabus(course_data, syllabus_data)

    out_dir = Path("data/parsed_json")
    out_dir.mkdir(parents=True, exist_ok=True)
    out_name = _output_filename(merged["course_id"], merged.get("year"))
    out_path = out_dir / out_name

    out_path.write_text(
        json.dumps(merged, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )

    print(f"course_id   : {merged['course_id']}")
    print(f"name        : {merged['name_he']}")
    print(f"groups      : {len(merged['groups'])}")
    print(f"lecture_h   : {merged['lecture_hours']}")
    print(f"tutorial_h  : {merged['tutorial_hours']}")
    print(f"prereqs     : {merged['prerequisite_course_ids']}")
    print(f"saved to    : {out_path}")

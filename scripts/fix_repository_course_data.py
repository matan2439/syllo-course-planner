"""
Repository/elective course data-quality fixes for mechanical_semester_board_2027.json.

Adds name_source / name_source_confidence to every repository course, and
fills in recovered data (course name, syllabus summary) for specific courses
where the original parsed data was missing or corrupted (mojibake), based on
manually-verified TAU syllabus pages fetched on 2026-06-11.

Usage:
    python3 -m scripts.fix_repository_course_data data/parsed_json/mechanical_semester_board_2027.json
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

# Recovered/verified data, keyed by course_id. Each entry's `confidence`
# documents how the value was obtained.
RECOVERED = {
    "0512-1202": {
        "name_he": "אלקטרוניקה בסיסית",
        "name_source": "syllabus_page",
        "name_source_confidence": "high",
        "syllabus_summary_he": (
            "הקורס עוסק במגברים אופרטיביים, רכיבי מוליכים למחצה ודיודות, "
            "ניתוח ותכנון מגברי טרנזיסטור מסוג BJT ו-MOSFET, אלגברה בוליאנית "
            "ושערים לוגיים, ותכנון מעגלים קומבינטוריים כולל ייצוגים קנוניים ומפות קרנו."
        ),
        "syllabus_topics_he": [
            "מגברים אופרטיביים",
            "דיודות ורכיבי מוליכים למחצה",
            "מגברי טרנזיסטור BJT",
            "מגברי טרנזיסטור MOSFET",
            "אלגברה בוליאנית ושערים לוגיים",
            "מעגלים קומבינטוריים, ייצוגים קנוניים ומפות קרנו",
        ],
        "syllabus_assessment_he": "ייתכנו מטלות נוספות מעבר למבחן הסופי.",
        "syllabus_structure_he": "2.0 שעות סמסטריאליות, מעבדה ביום רביעי 16:00-20:00",
        "syllabus_confidence": 0.7,
    },
    "0542-4124": {
        "name_source": "not_found",
        "name_source_confidence": "none",
    },
    "0542-4191": {
        "name_source": "not_found",
        "name_source_confidence": "none",
    },
}

DEFAULT_NAME_SOURCE = {
    "name_source": "program_json",
    "name_source_confidence": "high",
}


def main() -> int:
    board_path = Path(sys.argv[1])
    board = json.loads(board_path.read_text(encoding="utf-8"))
    repo = board.get("metadata", {}).get("program_repository_courses", [])

    not_found = []
    recovered = []

    for c in repo:
        cid = c.get("course_id")
        if cid in RECOVERED:
            updates = RECOVERED[cid]
            for k, v in updates.items():
                c[k] = v
            if updates.get("name_source_confidence") == "none":
                not_found.append(cid)
            else:
                recovered.append(cid)
        elif c.get("name_he"):
            c.setdefault("name_source", DEFAULT_NAME_SOURCE["name_source"])
            c.setdefault("name_source_confidence", DEFAULT_NAME_SOURCE["name_source_confidence"])
        else:
            c.setdefault("name_source", "not_found")
            c.setdefault("name_source_confidence", "none")
            if cid not in not_found:
                not_found.append(cid)

    board_path.write_text(json.dumps(board, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"Recovered name/syllabus data for: {recovered}")
    print(f"Still missing names (reported, not guessed): {not_found}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

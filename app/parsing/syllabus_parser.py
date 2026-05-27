"""
Parses cached TAU syllabus HTML pages (Syllabus_L.aspx).
No network I/O — only parsing logic.
"""

import re
import json
from typing import Optional

from bs4 import BeautifulSoup, Tag

from app.models.syllabus import SyllabusData

# Matches TAU course IDs in any of: 03681105 / 0368-1105 / 0368.1105
_COURSE_ID_RE = re.compile(r'\b(\d{4}[-. ]?\d{4})\b')


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------

def parse_syllabus(html: str, source_file: str | None = None) -> Optional[SyllabusData]:
    """Parse a TAU Syllabus_L.aspx page into a SyllabusData model.

    Returns None if the HTML contains no recognisable TAU syllabus structure.
    Individual missing fields are returned as None / empty list rather than
    raising an exception.
    """
    soup = BeautifulSoup(html, "lxml")
    label_map = _build_label_map(soup)
    toc_div = soup.find(id="div_dataToc")

    if not label_map and not toc_div:
        return None

    # ── course ID ───────────────────────────────────────────────────────────
    raw_num = _lookup(label_map, "מספר קורס", "course number", "course no")
    if raw_num:
        m = re.search(r"(\d{4}-\d{4})", raw_num)
        course_id = m.group(1) if m else raw_num
    else:
        course_id = _course_id_from_source(source_file) or "unknown"

    # ── names ────────────────────────────────────────────────────────────────
    name_he = _lookup(label_map, "שם הקורס")
    name_en = _lookup(label_map, "course name")   # present on English pages

    # ── numeric fields ───────────────────────────────────────────────────────
    credits       = _as_float(_lookup(label_map, 'נק"ז', "נקודות זכות", "credits", "credit points"))
    lecture_hours = _as_float(_lookup(label_map, "שעות סמסטריאליות", "שעות הרצאה", "lecture hours"))
    tutorial_hours = _as_float(_lookup(label_map, "שעות תרגול", "tutorial hours"))
    lab_hours     = _as_float(_lookup(label_map, "שעות מעבדה", "lab hours"))

    # ── prerequisites ────────────────────────────────────────────────────────
    prereq_raw = _lookup(
        label_map,
        "קורסי קדם נדרשים", "דרישות קדם",
        "prerequisites", "pre-requisites",
    )
    prereq_ids = extract_prerequisite_ids(prereq_raw or "")

    # ── description and topics ───────────────────────────────────────────────
    course_description = _extract_description(soup)
    topics = _extract_topics(soup)

    # ── assignments and exam ─────────────────────────────────────────────────
    assignments = _lookup(
        label_map,
        "מטלות הקורס", "מטלות", "הרכב הציון",
        "assignments", "course requirements",
    )
    exam_info = _lookup(label_map, "בחינה", "exam", "final exam")
    # If no dedicated exam label, pull from assignments when it mentions exam
    if not exam_info and assignments and "בחינה" in assignments:
        exam_info = assignments

    raw_text_excerpt = (course_description or "")[:500] or None

    return SyllabusData(
        course_id=course_id,
        name_he=name_he,
        name_en=name_en,
        credits=credits,
        lecture_hours=lecture_hours,
        tutorial_hours=tutorial_hours,
        lab_hours=lab_hours,
        prerequisites_raw_text=prereq_raw,
        prerequisite_course_ids=prereq_ids,
        course_description=course_description,
        topics=topics,
        assignments=assignments,
        exam_info=exam_info,
        raw_text_excerpt=raw_text_excerpt,
        source_file=source_file,
    )


def extract_prerequisite_ids(text: str) -> list[str]:
    """Extract and normalise TAU course IDs from free text.

    Supports: 03681105 / 0368-1105 / 0368.1105
    Returns deduplicated list of 8-digit strings, preserving order.
    """
    seen: set[str] = set()
    result: list[str] = []
    for raw in _COURSE_ID_RE.findall(text):
        normalized = re.sub(r"\D", "", raw)
        if normalized not in seen:
            seen.add(normalized)
            result.append(normalized)
    return result


# ---------------------------------------------------------------------------
# Internal helpers
# ---------------------------------------------------------------------------

def _build_label_map(soup: BeautifulSoup) -> dict[str, str]:
    """Return a {lowercased_label: value_text} dict from all .data-table-cell divs."""
    result: dict[str, str] = {}
    for cell in soup.select(".data-table-cell"):
        label_tag = cell.find("small", class_="data-table-cell-label")
        if not label_tag:
            continue
        label_key = label_tag.get_text(strip=True).lower()
        if not label_key or label_key in result:
            continue
        full = cell.get_text(separator=" ", strip=True).replace("\xa0", " ")
        label_literal = label_tag.get_text(strip=True)
        value = full.replace(label_literal, "", 1).strip()
        result[label_key] = value
    return result


def _lookup(label_map: dict[str, str], *keys: str) -> Optional[str]:
    """Return the first non-empty value matching any of the given label keys."""
    for key in keys:
        val = label_map.get(key.lower())
        if val:
            return val
    return None


def _as_float(text: Optional[str]) -> Optional[float]:
    """Parse the first number found in text, or return None."""
    if not text:
        return None
    m = re.search(r"[\d]+(?:\.\d+)?", text)
    return float(m.group()) if m else None


def _extract_description(soup: BeautifulSoup) -> Optional[str]:
    toc = soup.find(id="div_dataToc")
    if not toc:
        return None
    parts = [
        p.get_text(separator="\n", strip=True).replace("\xa0", " ")
        for p in toc.find_all("p")
        if p.get_text(strip=True)
    ]
    return "\n\n".join(parts) or None


def _extract_topics(soup: BeautifulSoup) -> list[str]:
    toc = soup.find(id="div_dataToc")
    if not toc:
        return []
    return [
        li.get_text(strip=True).replace("\xa0", " ")
        for ul in toc.find_all(["ul", "ol"])
        for li in ul.find_all("li")
        if li.get_text(strip=True)
    ]


def _course_id_from_source(source_file: str | None) -> Optional[str]:
    """Derive a formatted course ID from a cache filename like syllabus_03682157_2025_01.html."""
    if not source_file:
        return None
    m = re.search(r"syllabus_(\d{8})_", source_file)
    if not m:
        return None
    digits = m.group(1)
    return f"{digits[:4]}-{digits[4:]}"


# ---------------------------------------------------------------------------
# CLI
# ---------------------------------------------------------------------------

if __name__ == "__main__":
    import argparse
    from pathlib import Path

    cli = argparse.ArgumentParser(
        description="Parse a cached TAU syllabus HTML file and save JSON."
    )
    cli.add_argument("html_file", help="Path to cached syllabus HTML file")
    args = cli.parse_args()

    src = Path(args.html_file)
    if not src.exists():
        print(f"File not found: {src}")
        raise SystemExit(1)

    html = src.read_text(encoding="utf-8")
    result = parse_syllabus(html, source_file=str(src))

    if result is None:
        print("No syllabus structure found in file.")
        raise SystemExit(1)

    out_dir = Path("data/parsed_json")
    out_dir.mkdir(parents=True, exist_ok=True)
    out_path = out_dir / src.with_suffix(".json").name

    out_path.write_text(
        json.dumps(result.model_dump(), ensure_ascii=False, indent=2),
        encoding="utf-8",
    )

    print(f"course_id   : {result.course_id}")
    print(f"credits     : {result.credits}")
    print(f"lecture_h   : {result.lecture_hours}")
    print(f"tutorial_h  : {result.tutorial_hours}")
    print(f"lab_h       : {result.lab_hours}")
    print(f"prereqs     : {result.prerequisite_course_ids}")
    print(f"saved to    : {out_path}")

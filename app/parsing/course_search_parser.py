"""
Parses the HTML from TAU's static course search page (search_l.aspx).
Only parsing logic lives here — no network I/O.
"""

import re
from typing import Optional

from bs4 import BeautifulSoup, Tag

from app.models.course import CourseSearchResult, GroupInfo

_SYLLABUS_BASE = "https://ims.tau.ac.il"


def parse_course_search_result(html: str, year: int) -> Optional[CourseSearchResult]:
    """Parse a TAU search_l.aspx page into a CourseSearchResult.

    Returns None if no course data rows are found (e.g. empty result or wrong URL).
    """
    soup = BeautifulSoup(html, "lxml")

    # Every group block is anchored by a <tr class='listtdbld'> row.
    anchor_rows = soup.find_all("tr", class_="listtdbld")
    if not anchor_rows:
        return None

    course_id: Optional[str] = None
    name_hebrew: Optional[str] = None
    faculty_full: Optional[str] = None
    groups: list[GroupInfo] = []

    for anchor in anchor_rows:
        tds = anchor.find_all("td", recursive=False)
        if len(tds) < 2:
            continue

        # ── course ID and group number ──────────────────────────────────────
        id_raw = tds[0].get_text(separator=" ", strip=True)
        cid_match = re.search(r"(\d{4}-\d{4})", id_raw)
        grp_match = re.search(r"קב'[:\s]*(\S+)", id_raw)
        if cid_match:
            course_id = cid_match.group(1)
        group_num = grp_match.group(1) if grp_match else ""

        name_hebrew = tds[1].get_text(strip=True)

        # ── walk sibling rows until the next group's header ─────────────────
        faculty_text: Optional[str] = None
        schedule_rows: list[Tag] = []
        links_row: Optional[Tag] = None

        sibling = anchor.next_sibling
        while sibling is not None:
            if not isinstance(sibling, Tag) or sibling.name != "tr":
                sibling = sibling.next_sibling
                continue

            classes = set(sibling.get("class", []))
            style = sibling.get("style", "")

            if "listtdbld" in classes or "listtds" in classes:
                break  # start of next group
            elif "listtd" in classes and "kotcol" not in classes:
                # Faculty / credits row
                row_tds = sibling.find_all("td", recursive=False)
                if len(row_tds) >= 2:
                    faculty_text = row_tds[1].get_text(strip=True)
                    if faculty_full is None:
                        faculty_full = faculty_text
            elif "listtd" in classes:
                pass  # schedule column headers — skip
            elif "border-bottom" in style:
                links_row = sibling
                break
            elif "text-align" in style:
                schedule_rows.append(sibling)

            sibling = sibling.next_sibling

        # ── parse schedule rows ─────────────────────────────────────────────
        teachers: list[str] = []
        teaching_method: Optional[str] = None
        building: Optional[str] = None
        room: Optional[str] = None
        day: Optional[str] = None
        time_slot: Optional[str] = None
        semester: Optional[str] = None

        for srow in schedule_rows:
            row_tds = srow.find_all("td", recursive=False)
            if not row_tds:
                continue

            teacher = _text(row_tds[0])
            if teacher:
                teachers.append(teacher)

            if len(row_tds) >= 7:
                teaching_method = teaching_method or _text(row_tds[1])
                building       = building       or _text(row_tds[2])
                room           = room           or _text(row_tds[3])
                day            = day            or _text(row_tds[4])
                time_slot      = time_slot      or _text(row_tds[5])
                semester       = semester       or _text(row_tds[6])

        # ── parse links row ─────────────────────────────────────────────────
        syllabus_url: Optional[str] = None
        moodle_url: Optional[str] = None
        if links_row:
            syl_a = links_row.find("a", title="סילבוס")
            if syl_a:
                href = syl_a.get("href", "")
                syllabus_url = href if href.startswith("http") else _SYLLABUS_BASE + href

            moodle_a = links_row.find("a", title="Moodle")
            if moodle_a:
                moodle_url = moodle_a.get("href")

        groups.append(GroupInfo(
            group_num=group_num,
            teachers=teachers,
            teaching_method=teaching_method,
            semester=semester,
            building=building,
            room=room,
            day=day,
            time_slot=time_slot,
            syllabus_url=syllabus_url,
            moodle_url=moodle_url,
        ))

    if not course_id or not name_hebrew:
        return None

    # ── deduplicate semesters (preserve order of first appearance) ──────────
    seen: set[str] = set()
    semesters: list[str] = []
    for g in groups:
        if g.semester and g.semester not in seen:
            seen.add(g.semester)
            semesters.append(g.semester)

    department: Optional[str] = None
    if faculty_full and "/" in faculty_full:
        department = faculty_full.rsplit("/", 1)[-1].strip()

    return CourseSearchResult(
        course_id=course_id,
        name_hebrew=name_hebrew,
        faculty=faculty_full,
        year=year,
        department=department,
        groups=groups,
        semesters=semesters,
    )


def _text(tag: Tag) -> Optional[str]:
    """Return stripped inner text of a tag, replacing &nbsp;, or None if blank."""
    t = tag.get_text(strip=True).replace("\xa0", " ").strip()
    return t or None


# ---------------------------------------------------------------------------
# CLI
# ---------------------------------------------------------------------------

if __name__ == "__main__":
    import argparse
    import json
    from pathlib import Path

    cli = argparse.ArgumentParser(
        description="Parse a cached TAU course search HTML file and save JSON."
    )
    cli.add_argument("html_file", help="Path to cached HTML file")
    cli.add_argument("--year", type=int, default=None,
                     help="Academic year (inferred from filename if omitted)")
    args = cli.parse_args()

    src = Path(args.html_file)
    if not src.exists():
        print(f"File not found: {src}")
        raise SystemExit(1)

    year = args.year
    if year is None:
        m = re.search(r"_(\d{4})\.html$", src.name)
        year = int(m.group(1)) if m else 0

    html = src.read_text(encoding="utf-8")
    result = parse_course_search_result(html, year)

    if result is None:
        print("No course data found in file.")
        raise SystemExit(1)

    out_dir = Path("data/parsed_json")
    out_dir.mkdir(parents=True, exist_ok=True)
    out_path = out_dir / src.with_suffix(".json").name

    out_path.write_text(
        json.dumps(result.model_dump(), ensure_ascii=False, indent=2),
        encoding="utf-8",
    )

    syllabus_count = sum(1 for g in result.groups if g.syllabus_url)
    print(f"course_id   : {result.course_id}")
    print(f"name        : {result.name_hebrew}")
    print(f"groups      : {len(result.groups)}")
    print(f"syllabus    : {syllabus_count}")
    print(f"saved to    : {out_path}")

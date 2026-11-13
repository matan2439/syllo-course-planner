"""
Build data/prerequisites/tau.json — structured prerequisites, catalog membership and offered
semesters for every course on the supported boards — from TAU's official registrar pages.

    python3 scripts/ingest_prerequisites.py --cache <dir>            # fetch missing pages, then build
    python3 scripts/ingest_prerequisites.py --cache <dir> --offline  # build from cached pages only
    python3 scripts/ingest_prerequisites.py --check                  # coverage report of the committed file

Three official pages per course (cached under <dir>/search, <dir>/drishot, <dir>/syl):
  1. the catalog listing (search_l.aspx): is the course in this year's catalog, name, semesters;
  2. the dedicated prerequisites page (Drishot_L.aspx), linked from the listing only when the
     registrar holds prerequisites or corequisites — the PRIMARY source, with explicit grouping;
  3. the syllabus page (Syllabus_L.aspx), whose prerequisite block is a second, independent copy.

Read-only and polite: one request at a time, >= 1.2 s apart; the run stops on 401/403/429.
Nothing here changes planner behaviour; the file is consumed in shadow mode.

Statuses (never collapse one into another):
  verified                 an official page lists prerequisites (structured below)
  verified_none            the course is in the official catalog and the registrar links no
                           prerequisites page for it (and the syllabus page lists none)
  none_listed              only the syllabus page was available and it lists none — absence in ONE
                           source, not a verified absence
  assumed_none_no_syllabus no official page at all — assumed none (product rule), revisit later
  not_in_catalog           the course number is not in this year's official catalog
  unknown                  a page exists but could not be read
`needs_review` marks records where two official sources disagree or the grouping is ambiguous.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import sys
import time
import urllib.error
import urllib.request
from collections import Counter
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from app.parsing.tau_prerequisites import (  # noqa: E402
    PARSER_VERSION, normalize_expression, parse_catalog_listing, parse_prerequisites_page, parse_syllabus_prerequisites,
)
import re  # noqa: E402

BOARDS = [
    "mechanical_engineering_2027", "mechanical_engineering_years_1_2_2027",
    "electrical_engineering_2027", "electrical_engineering_years_1_2_2027",
]
OUTPUT = ROOT / "data" / "prerequisites" / "tau.json"
DELAY_SECONDS = 1.2
STOP_STATUSES = {401, 403, 429}


def board_courses() -> dict[str, dict]:
    """course_id → {name_he, syllabus_url, boards} over every supported board."""
    courses: dict[str, dict] = {}
    for board_id in BOARDS:
        board = json.loads((ROOT / "data" / "boards" / f"{board_id}.json").read_text(encoding="utf-8"))
        records = list(board.get("metadata", {}).get("program_repository_courses", []))
        records += [course for semester in board.get("semesters", []) for course in semester.get("courses", [])]
        for record in records:
            course_id = record.get("course_id")
            if not isinstance(course_id, str):
                continue
            entry = courses.setdefault(course_id, {"name_he": None, "syllabus_url": None, "boards": []})
            entry["name_he"] = entry["name_he"] or record.get("name_he")
            url = record.get("syllabus_url")
            if url and not entry["syllabus_url"]:
                entry["syllabus_url"] = url.replace("http://", "https://").replace("//www.ims.", "//ims.")
            if board_id not in entry["boards"]:
                entry["boards"].append(board_id)
    return courses


CATALOG_YEAR = 2026
SEARCH_URL = "https://ims.tau.ac.il/tal/kr/search_l.aspx?course_num={digits}&year={year}"
DRISHOT_LINK = re.compile(r"Drishot_L\.aspx\?kurs=\d+&kv=\d+&sem=\d+")


def _get(url: str, target: Path) -> bool:
    request = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0 (academic-data-fetch)"})
    try:
        with urllib.request.urlopen(request, timeout=30) as response:
            target.write_bytes(response.read())
    except urllib.error.HTTPError as error:
        if error.code in STOP_STATUSES:
            raise SystemExit(f"Stopped: the source answered {error.code} for {url}.")
        print(f"skip {target.name}: HTTP {error.code}")
        return False
    except OSError as error:
        print(f"skip {target.name}: {error}")
        return False
    finally:
        time.sleep(DELAY_SECONDS)
    return True


def fetch_missing(course_ids: list[str], courses: dict[str, dict], cache: Path) -> None:
    for name in ("search", "drishot", "syl"):
        (cache / name).mkdir(parents=True, exist_ok=True)
    for course_id in course_ids:
        listing = cache / "search" / f"{course_id}.html"
        if not listing.exists() or listing.stat().st_size == 0:
            _get(SEARCH_URL.format(digits=course_id.replace("-", ""), year=CATALOG_YEAR), listing)
        page = cache / "drishot" / f"{course_id}.html"
        if listing.exists() and not page.exists():
            link = DRISHOT_LINK.search(listing.read_text(encoding="utf-8", errors="replace"))
            if link:
                _get("https://ims.tau.ac.il/tal/kr/" + link.group(0), page)
        syllabus = cache / "syl" / f"{course_id}.html"
        url = courses.get(course_id, {}).get("syllabus_url")
        if url and not syllabus.exists():
            _get(url, syllabus)


def _read(path: Path):
    return path.read_bytes() if path.exists() and path.stat().st_size > 0 else None


def course_record(course_id: str, entry: dict, cache: Path) -> dict:
    record: dict = {"name_he": entry.get("name_he"), "boards": sorted(entry.get("boards", []))}
    listing_raw = _read(cache / "search" / f"{course_id}.html")
    page_raw = _read(cache / "drishot" / f"{course_id}.html")
    syllabus_raw = _read(cache / "syl" / f"{course_id}.html")
    listing = parse_catalog_listing(listing_raw.decode("utf-8", errors="replace")) if listing_raw else None
    page = parse_prerequisites_page(page_raw.decode("utf-8", errors="replace")) if page_raw else None
    syllabus = parse_syllabus_prerequisites(syllabus_raw.decode("utf-8", errors="replace")) if syllabus_raw else None
    if syllabus and syllabus["status"] == "unknown":
        syllabus = None

    if listing:
        record["catalog"] = {"year": CATALOG_YEAR, "found": listing["found"], "name_he": listing["name_he"], "semesters": listing["semesters"]}
    sources = [name for name, value in (("prerequisites_page", page), ("syllabus_page", syllabus)) if value]
    record["sources"] = sources
    names: dict[str, str] = {}
    for source in (syllabus, page):
        names.update(source["course_names"] if source else {})

    lists = lambda source: bool(source) and (source["expression"] is not None or source["corequisites"] is not None)  # noqa: E731
    same = lambda a, b: (normalize_expression(a["expression"]) == normalize_expression(b["expression"])  # noqa: E731
                         and normalize_expression(a["corequisites"]) == normalize_expression(b["corequisites"]))
    chosen = page if lists(page) else syllabus if lists(syllabus) else None
    review = bool(chosen and chosen["needs_review"])
    if chosen:
        status = "verified"
        other = syllabus if chosen is page else page
        # A second official copy that LISTS something else is a conflict a person must settle. A copy
        # that is merely silent is not: the syllabus page often omits what the registrar page holds.
        if lists(other) and not same(chosen, other):
            review = True
            record["sources_disagree"] = True
    elif listing and listing["found"]:
        # In the catalog, and the registrar links no prerequisites page (or links an empty one).
        status = "verified_none"
    elif syllabus:
        status = "none_listed"
    elif listing and not listing["found"]:
        status = "not_in_catalog"
    elif entry.get("syllabus_url"):
        status = "unknown"
        review = True
    else:
        status = "assumed_none_no_syllabus"
    record.update({"status": status, "expression": chosen["expression"] if chosen else None,
                   "corequisites": chosen["corequisites"] if chosen else None})
    if names:
        record["course_names"] = names
    if review:
        record["needs_review"] = True
    hashed = hashlib.sha256(b"".join(raw for raw in (listing_raw, page_raw, syllabus_raw) if raw))
    if listing_raw or page_raw or syllabus_raw:
        newest = max(path.stat().st_mtime for path in (cache / "search" / f"{course_id}.html", cache / "drishot" / f"{course_id}.html", cache / "syl" / f"{course_id}.html") if path.exists())
        record["fetched_at"] = datetime.fromtimestamp(newest, timezone.utc).strftime("%Y-%m-%d")
        record["content_hash"] = hashed.hexdigest()[:16]
    return record


def build(courses: dict[str, dict], cache: Path) -> dict:
    out = {course_id: course_record(course_id, entry, cache) for course_id, entry in sorted(courses.items())}
    # Courses the boards do not carry but official prerequisites mention: needed to tell a
    # renumbered or retired course from a real outside requirement.
    referenced = sorted({ref for record in out.values()
                         for ref in referenced_ids(record.get("expression")) + referenced_ids(record.get("corequisites"))
                         if ref not in out})
    external = {course_id: course_record(course_id, {"boards": []}, cache) for course_id in referenced}
    return {
        "source": "TAU registrar pages on ims.tau.ac.il: catalog listing, prerequisites page, syllabus page",
        "catalog_year": CATALOG_YEAR,
        "parser_version": PARSER_VERSION,
        "generated_at": datetime.now(timezone.utc).strftime("%Y-%m-%d"),
        "courses": out,
        "referenced_courses": external,
    }


def referenced_ids(expression) -> list[str]:
    if not expression:
        return []
    if "course" in expression:
        return [expression["course"]]
    return [course_id for child in expression.get("all", expression.get("any", [])) for course_id in referenced_ids(child)]


def report(data: dict) -> None:
    courses = data["courses"]
    print(f"{len(courses)} courses · catalog {data.get('catalog_year')} · parser v{data['parser_version']} · generated {data['generated_at']}")
    for board_id in BOARDS:
        rows = [record for record in courses.values() if board_id in record["boards"]]
        counts = Counter(record["status"] for record in rows)
        print(f"  {board_id}: {len(rows)} courses · " + " · ".join(f"{status} {count}" for status, count in sorted(counts.items())))
    review = sorted(course_id for course_id, record in courses.items() if record.get("needs_review"))
    print(f"  needs review ({len(review)}): {', '.join(review) or '—'}")
    external = data.get("referenced_courses", {})
    missing = sorted(course_id for course_id, record in external.items() if record["status"] == "not_in_catalog")
    print(f"  prerequisite courses outside the supported boards: {len(external)} · of them not in this year's catalog ({len(missing)}): {', '.join(missing) or '—'}")


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--cache", type=Path)
    parser.add_argument("--offline", action="store_true")
    parser.add_argument("--check", action="store_true")
    args = parser.parse_args()
    if args.check:
        report(json.loads(OUTPUT.read_text(encoding="utf-8")))
        return
    if not args.cache:
        parser.error("--cache <dir> is required unless --check")
    courses = board_courses()
    if not args.offline:
        fetch_missing(sorted(courses), courses, args.cache)
        # Second pass: the courses official prerequisites mention but the boards do not carry.
        first = build(courses, args.cache)
        fetch_missing(sorted(first["referenced_courses"]), courses, args.cache)
    data = build(courses, args.cache)
    OUTPUT.parent.mkdir(parents=True, exist_ok=True)
    OUTPUT.write_text(json.dumps(data, ensure_ascii=False, indent=1) + "\n", encoding="utf-8")
    report(data)


if __name__ == "__main__":
    main()

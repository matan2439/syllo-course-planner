"""
Build data/prerequisites/tau.json — structured prerequisites for every course
on the supported boards — from TAU's official syllabus pages.

    python3 scripts/ingest_prerequisites.py --cache <dir>            # fetch missing pages, then build
    python3 scripts/ingest_prerequisites.py --cache <dir> --offline  # build from cached pages only
    python3 scripts/ingest_prerequisites.py --check                  # coverage report of the committed file

Read-only and polite: one request at a time, >= 1.2 s apart, and the whole run
stops on 401/403/429. Pages are cached by course id, so a re-run only fetches
what is missing. Nothing here changes planner behaviour; the file is consumed
in shadow mode (api/ai/prerequisites.ts).

Statuses:
  verified                 the official page lists prerequisites (structured below)
  verified_none            the official page exists and lists none
  assumed_none_no_syllabus no official syllabus page for the course — assumed none (product rule)
  unknown                  a page exists but could not be read/parsed
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

from app.parsing.tau_prerequisites import PARSER_VERSION, parse_syllabus_prerequisites  # noqa: E402

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


def fetch_missing(courses: dict[str, dict], cache: Path) -> None:
    cache.mkdir(parents=True, exist_ok=True)
    for course_id, entry in sorted(courses.items()):
        target = cache / f"{course_id}.html"
        if not entry["syllabus_url"] or target.exists():
            continue
        request = urllib.request.Request(entry["syllabus_url"], headers={"User-Agent": "Mozilla/5.0 (academic-data-fetch)"})
        try:
            with urllib.request.urlopen(request, timeout=30) as response:
                target.write_bytes(response.read())
        except urllib.error.HTTPError as error:
            if error.code in STOP_STATUSES:
                raise SystemExit(f"Stopped: the source answered {error.code} for {course_id}.")
            print(f"skip {course_id}: HTTP {error.code}")
        except OSError as error:
            print(f"skip {course_id}: {error}")
        time.sleep(DELAY_SECONDS)


def build(courses: dict[str, dict], cache: Path) -> dict:
    out: dict[str, dict] = {}
    for course_id, entry in sorted(courses.items()):
        record: dict = {"name_he": entry["name_he"], "boards": sorted(entry["boards"])}
        page = cache / f"{course_id}.html"
        if not entry["syllabus_url"]:
            record.update({"status": "assumed_none_no_syllabus", "expression": None, "corequisites": None})
        elif not page.exists():
            record.update({"status": "unknown", "expression": None, "corequisites": None,
                           "source_url": entry["syllabus_url"], "needs_review": True})
        else:
            raw = page.read_bytes()
            parsed = parse_syllabus_prerequisites(raw.decode("utf-8", errors="replace"))
            record.update({
                "status": parsed["status"], "expression": parsed["expression"], "corequisites": parsed["corequisites"],
                "source_url": entry["syllabus_url"],
                "fetched_at": datetime.fromtimestamp(page.stat().st_mtime, timezone.utc).strftime("%Y-%m-%d"),
                "content_hash": hashlib.sha256(raw).hexdigest()[:16],
            })
            if parsed["raw_text"]:
                record["raw_text"] = parsed["raw_text"]
            if parsed["course_names"]:
                record["course_names"] = parsed["course_names"]
            if parsed["needs_review"]:
                record["needs_review"] = True
        out[course_id] = record
    return {
        "source": "TAU official syllabus pages (ims.tau.ac.il/Tal/Syllabus/Syllabus_L.aspx)",
        "parser_version": PARSER_VERSION,
        "generated_at": datetime.now(timezone.utc).strftime("%Y-%m-%d"),
        "courses": out,
    }


def referenced_ids(expression) -> list[str]:
    if not expression:
        return []
    if "course" in expression:
        return [expression["course"]]
    return [course_id for child in expression.get("all", expression.get("any", [])) for course_id in referenced_ids(child)]


def report(data: dict) -> None:
    courses = data["courses"]
    print(f"{len(courses)} courses · parser v{data['parser_version']} · generated {data['generated_at']}")
    for board_id in BOARDS:
        rows = [record for record in courses.values() if board_id in record["boards"]]
        counts = Counter(record["status"] for record in rows)
        print(f"  {board_id}: {len(rows)} courses · " + " · ".join(f"{status} {count}" for status, count in sorted(counts.items())))
    review = sorted(course_id for course_id, record in courses.items() if record.get("needs_review"))
    print(f"  needs review ({len(review)}): {', '.join(review) or '—'}")
    outside = sorted({ref for record in courses.values()
                      for ref in referenced_ids(record.get("expression")) + referenced_ids(record.get("corequisites"))
                      if ref not in courses})
    print(f"  prerequisite courses outside the supported boards ({len(outside)}): {', '.join(outside) or '—'}")


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
        fetch_missing(courses, args.cache)
    data = build(courses, args.cache)
    OUTPUT.parent.mkdir(parents=True, exist_ok=True)
    OUTPUT.write_text(json.dumps(data, ensure_ascii=False, indent=1) + "\n", encoding="utf-8")
    report(data)


if __name__ == "__main__":
    main()

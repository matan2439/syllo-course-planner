"""
Offline pipeline step: fetch syllabus pages for courses with syllabus_url,
parse them, build a compact structured Hebrew summary, and merge the
resulting fields into a board JSON file.

This runs as part of import/enrichment — NOT during AI chat requests.

Usage:
    python -m app.pipeline.fetch_syllabus_summaries \
        --board data/parsed_json/mechanical_semester_board_2027.json \
        [--course 0542-3792] [--limit 5] [--force]

Cached HTML is stored under data/raw_html/syllabus/<course_id_no_dash>.html
and reused on subsequent runs unless --force is given.
"""

from __future__ import annotations

import argparse
import json
import sys
import urllib.request
import urllib.error
from datetime import datetime, timezone
from pathlib import Path

from app.parsing.syllabus_parser import parse_syllabus
from app.parsing.syllabus_summary import build_syllabus_summary

ROOT = Path(__file__).resolve().parents[2]
RAW_HTML_DIR = ROOT / "data" / "raw_html" / "syllabus"


def _cache_path(course_id: str) -> Path:
    return RAW_HTML_DIR / f"syllabus_{course_id.replace('-', '')}.html"


def _fetch_html(url: str, course_id: str, force: bool = False) -> str | None:
    cache = _cache_path(course_id)
    if cache.exists() and not force:
        return cache.read_text(encoding="utf-8")
    try:
        req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
        with urllib.request.urlopen(req, timeout=15) as resp:
            html = resp.read().decode("utf-8", errors="replace")
    except (urllib.error.URLError, TimeoutError) as e:
        print(f"  fetch failed for {course_id}: {e}", file=sys.stderr)
        return None
    RAW_HTML_DIR.mkdir(parents=True, exist_ok=True)
    cache.write_text(html, encoding="utf-8")
    return html


def enrich_course(course: dict, force: bool = False) -> bool:
    """Mutate `course` in place with syllabus summary fields. Returns True if changed."""
    syllabus_url = course.get("syllabus_url")
    course_id = course.get("course_id", "")
    if not syllabus_url:
        return False

    html = _fetch_html(syllabus_url, course_id, force=force)
    syllabus = parse_syllabus(html, source_file=_cache_path(course_id).name) if html else None

    fetched_at = datetime.now(timezone.utc).isoformat()
    summary = build_syllabus_summary(syllabus, source_url=syllabus_url, fetched_at=fetched_at)
    course.update(summary)
    if syllabus is not None:
        course["syllabus_ai_analysis_status"] = "done"
    return True


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--board", required=True, help="Path to board JSON file")
    parser.add_argument("--course", action="append", help="Limit to specific course_id(s)")
    parser.add_argument("--limit", type=int, default=None, help="Limit number of courses processed")
    parser.add_argument("--force", action="store_true", help="Re-fetch even if cached HTML exists")
    args = parser.parse_args()

    board_path = Path(args.board)
    data = json.loads(board_path.read_text(encoding="utf-8"))

    course_filter = set(args.course) if args.course else None
    processed = 0
    for semester in data.get("semesters", []):
        for course in semester.get("courses", []):
            if not course.get("syllabus_url"):
                continue
            if course_filter and course.get("course_id") not in course_filter:
                continue
            if args.limit is not None and processed >= args.limit:
                break
            print(f"Processing {course.get('course_id')} — {course.get('name_he')}")
            if enrich_course(course, force=args.force):
                processed += 1

    board_path.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"Done. Enriched {processed} course(s). Wrote {board_path}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

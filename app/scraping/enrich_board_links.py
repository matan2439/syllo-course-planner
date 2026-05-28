"""
Enrich mechanical_semester_board_2027.json with course-detail links extracted
from the TAU course search pages (search_l.aspx).

For each repository course that has course_details_url but no syllabus_url,
this script:
  1. Fetches the search_l.aspx HTML (cached in data/raw_html/course_details/).
  2. Parses it for syllabus_url, exam_url, prerequisites_url, moodle_url,
     mailing_list_url.
  3. Updates the board JSON entry with any newly found links.

Usage:
    python -m app.scraping.enrich_board_links

Flags:
    --force-refresh   Re-fetch all HTML even if cached.
    --dry-run         Print what would change without writing.
    --board-json PATH Override the board JSON path.
"""

from __future__ import annotations

import argparse
import json
from pathlib import Path

from app.scraping.tau_client import fetch_url, build_course_search_url, normalize_course_id
from app.parsing.tau_course_details_parser import parse_course_details_links

_BOARD_PATH   = Path("data/parsed_json/mechanical_semester_board_2027.json")
_CACHE_DIR    = Path("data/raw_html/course_details")
_YEAR         = 2025


def enrich_board(
    board_path: Path = _BOARD_PATH,
    cache_dir: Path  = _CACHE_DIR,
    year: int        = _YEAR,
    force_refresh: bool = False,
    dry_run: bool    = False,
) -> dict:
    """Fetch and parse course-detail links for all repo courses.

    Returns a dict: {course_id: {new_fields}} for courses that were enriched.
    """
    board = json.loads(board_path.read_text(encoding="utf-8"))
    repo  = board["metadata"]["program_repository_courses"]

    cache_dir.mkdir(parents=True, exist_ok=True)
    enriched: dict[str, dict] = {}

    for rc in repo:
        cid        = rc.get("course_id", "")
        detail_url = rc.get("course_details_url")
        if not detail_url or not cid:
            continue

        # Skip if we already have a syllabus AND all secondary links
        already_full = all([
            rc.get("syllabus_url"),
            rc.get("exam_url"),
        ])
        if already_full and not force_refresh:
            continue

        digits     = "".join(c for c in cid if c.isdigit())
        cache_path = cache_dir / f"course_{digits}_{year}.html"

        try:
            html  = fetch_url(detail_url, cache_path, force_refresh)
            links = parse_course_details_links(html)
        except Exception as exc:
            print(f"[skip] {cid}: {exc}")
            continue

        # Only store non-null values that are new
        new_fields: dict = {}
        for key, val in links.items():
            if val and not rc.get(key):
                new_fields[key] = val

        if new_fields:
            enriched[cid] = new_fields
            print(f"[enrich] {cid}: {list(new_fields)}")

    if not dry_run:
        for rc in repo:
            cid = rc.get("course_id", "")
            if cid in enriched:
                rc.update(enriched[cid])
        board_path.write_text(
            json.dumps(board, ensure_ascii=False, indent=2), encoding="utf-8"
        )
        print(f"\nBoard JSON updated: {board_path}")

    return enriched


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--force-refresh", action="store_true")
    ap.add_argument("--dry-run",        action="store_true")
    ap.add_argument("--board-json",     default=str(_BOARD_PATH))
    args = ap.parse_args()

    enriched = enrich_board(
        board_path    = Path(args.board_json),
        force_refresh = args.force_refresh,
        dry_run       = args.dry_run,
    )

    # Summary
    total = len(enriched)
    with_syllabus = sum(1 for v in enriched.values() if "syllabus_url" in v)
    print(f"\nSummary: {total} courses enriched, {with_syllabus} got syllabus_url")

    # Final board state
    board = json.loads(Path(args.board_json).read_text(encoding="utf-8"))
    repo  = board["metadata"]["program_repository_courses"]
    n_syl    = sum(1 for r in repo if r.get("syllabus_url"))
    n_detail = sum(1 for r in repo if r.get("course_details_url"))
    print(f"Board repo: {len(repo)} courses, {n_detail} with course_details_url, {n_syl} with syllabus_url")


if __name__ == "__main__":
    main()

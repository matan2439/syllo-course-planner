"""
Single-course import pipeline.

Steps
-----
1.  Fetch course search HTML   (tau_client)
2.  Parse course search HTML   (course_search_parser)
3.  Save course JSON           (data/parsed_json/)
4.  Pick best syllabus URL     (group 01 preferred)
5.  Fetch syllabus HTML        (tau_client)
6.  Parse syllabus HTML        (syllabus_parser)
7.  Save syllabus JSON         (data/parsed_json/)
8.  Merge course + syllabus    (merge_course_data)
9.  Save merged JSON           (data/parsed_json/)
10. Import into SQLite         (database/db)
"""

import json
import re
from pathlib import Path
from typing import Any

from app.scraping.tau_client import (
    fetch_course_search_page,
    fetch_syllabus_page,
)
from app.parsing.course_search_parser import parse_course_search_result
from app.parsing.syllabus_parser import parse_syllabus
from app.parsing.merge_course_data import merge_course_and_syllabus
from app.database.db import _DB_PATH, init_db, save_merged_course

_RAW_HTML_DIR  = Path("data/raw_html")
_JSON_DIR      = Path("data/parsed_json")


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------

def import_course_pipeline(
    course_id: str,
    year: int,
    force_refresh: bool = False,
    group: str | None = None,
    skip_db: bool = False,
    db_path: Path = _DB_PATH,
    json_dir: Path = _JSON_DIR,
) -> dict[str, Any]:
    """
    Run the full import pipeline for one course.

    Returns a summary dict with:
      course_id, groups_count, syllabus_url, merged_path, db_imported
    """
    digits = re.sub(r"\D", "", course_id)
    json_dir.mkdir(parents=True, exist_ok=True)

    # ── Step 1: fetch course search HTML ─────────────────────────────────────
    course_html = fetch_course_search_page(course_id, year, force_refresh)
    print(f"[pipeline] fetched course HTML ({len(course_html):,} chars)")

    # ── Step 2: parse ────────────────────────────────────────────────────────
    course_result = parse_course_search_result(course_html, year)
    if course_result is None:
        raise ValueError(f"No course data found for {course_id} year {year}")
    print(f"[pipeline] parsed {len(course_result.groups)} group(s)")

    # ── Step 3: save course JSON ─────────────────────────────────────────────
    course_json_path = json_dir / f"course_{digits}_{year}.json"
    course_dict = course_result.model_dump()
    course_dict["source_file"] = str(course_json_path)
    course_json_path.write_text(
        json.dumps(course_dict, ensure_ascii=False, indent=2), encoding="utf-8"
    )

    # ── Step 4: pick syllabus URL ─────────────────────────────────────────────
    syllabus_url, group_num = _pick_syllabus_group(course_dict["groups"], group)

    # ── Steps 5-7: fetch + parse + save syllabus ─────────────────────────────
    syllabus_dict: dict[str, Any] = {}

    if syllabus_url:
        print(f"[pipeline] selected syllabus URL: {syllabus_url} (group {group_num})")
        raw_html_path = _RAW_HTML_DIR / f"syllabus_{digits}_{year}_{group_num}.html"

        syllabus_html = fetch_syllabus_page(
            syllabus_url, course_id, year,
            group_number=group_num,
            force_refresh=force_refresh,
        )

        syl_result = parse_syllabus(syllabus_html, source_file=str(raw_html_path))
        if syl_result is None:
            print("[pipeline] warning: syllabus parse returned no data")
        else:
            syllabus_dict = syl_result.model_dump()
            syl_json_path = json_dir / f"syllabus_{digits}_{year}_{group_num}.json"
            syl_json_path.write_text(
                json.dumps(syllabus_dict, ensure_ascii=False, indent=2), encoding="utf-8"
            )
            prereqs = syllabus_dict.get("prerequisite_course_ids", [])
            print(f"[pipeline] parsed syllabus prereqs={prereqs}")
    else:
        print("[pipeline] no syllabus URL found — continuing without syllabus data")

    # ── Step 8: merge ────────────────────────────────────────────────────────
    merged = merge_course_and_syllabus(course_dict, syllabus_dict)

    # ── Step 9: save merged JSON ─────────────────────────────────────────────
    merged_path = json_dir / f"merged_course_{digits}_{year}.json"
    merged_path.write_text(
        json.dumps(merged, ensure_ascii=False, indent=2), encoding="utf-8"
    )
    print(f"[pipeline] merged saved to {merged_path}")

    # ── Step 10: DB import ───────────────────────────────────────────────────
    if skip_db:
        print("[pipeline] DB import skipped (--skip-db)")
    else:
        init_db(db_path)
        save_merged_course(merged, db_path)
        print(f"[pipeline] DB import: course_id={merged['course_id']}  "
              f"groups={len(merged.get('groups', []))}  "
              f"prereqs={merged.get('prerequisite_course_ids', [])}")

    return {
        "course_id":    merged["course_id"],
        "groups_count": len(course_dict.get("groups", [])),
        "syllabus_url": syllabus_url,
        "merged_path":  str(merged_path),
        "db_imported":  not skip_db,
    }


# ---------------------------------------------------------------------------
# Internal helpers
# ---------------------------------------------------------------------------

def _pick_syllabus_group(
    groups: list[dict[str, Any]],
    preferred_group: str | None,
) -> tuple[str | None, str | None]:
    """
    Return (syllabus_url, group_num) for the best group to fetch.

    Priority: explicit --group arg > group "01" > first group with a URL.
    Returns (None, None) if no group has a syllabus URL.
    """
    candidates = [g for g in groups if g.get("syllabus_url")]
    if not candidates:
        return None, None

    if preferred_group:
        match = next((g for g in candidates if g.get("group_num") == preferred_group), None)
        if match:
            return match["syllabus_url"], match["group_num"]

    g01 = next((g for g in candidates if g.get("group_num") == "01"), None)
    if g01:
        return g01["syllabus_url"], g01["group_num"]

    return candidates[0]["syllabus_url"], candidates[0]["group_num"]


# ---------------------------------------------------------------------------
# CLI
# ---------------------------------------------------------------------------

if __name__ == "__main__":
    import argparse

    cli = argparse.ArgumentParser(
        description="Import one TAU course through the full pipeline."
    )
    cli.add_argument("--course",           required=True,        help="Course ID, e.g. 0368-2157")
    cli.add_argument("--year",             required=True, type=int, help="Academic year, e.g. 2025")
    cli.add_argument("--force-refresh",    action="store_true",  help="Re-download even if cached")
    cli.add_argument("--group",            default=None,         help="Preferred syllabus group, e.g. 01")
    cli.add_argument("--skip-db",          action="store_true",  help="Skip SQLite import")
    cli.add_argument("--db",               default=str(_DB_PATH), help=f"DB path (default: {_DB_PATH})")
    args = cli.parse_args()

    summary = import_course_pipeline(
        course_id     = args.course,
        year          = args.year,
        force_refresh = args.force_refresh,
        group         = args.group,
        skip_db       = args.skip_db,
        db_path       = Path(args.db),
    )

    print(f"[pipeline] done  course_id={summary['course_id']}  "
          f"groups={summary['groups_count']}  "
          f"db_imported={summary['db_imported']}")

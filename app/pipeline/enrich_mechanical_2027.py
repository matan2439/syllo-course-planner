"""
Single enrichment command for the 2027 Mechanical Engineering board.

Runs the full pipeline in sequence:
  1. Load mechanical_engineering_2027_enriched.json (with mandatory courses reference).
  2. build_semester_board() — places 12 mandatory Y3/Y4 courses, builds 56-course repo.
  3. enrich_board_links — fetch/parse IMS detail pages for REPO courses (from cache).
  4. enrich_board_links — fetch/parse IMS detail pages for PLACED MANDATORY courses.
  5. Fill missing name_he / weekly_hours from TAU GraphQL cache.
  6. Write data/parsed_json/mechanical_semester_board_2027.json.

Usage:
    python -m app.pipeline.enrich_mechanical_2027 [--dry-run] [--force-refresh]
"""

from __future__ import annotations

import argparse
import json
from pathlib import Path

from app.analysis.semester_board import build_semester_board
from app.scraping.enrich_board_links import enrich_board as _enrich_links
from app.scraping.tau_program_scraper import fetch_program_data

_BOARD_PATH    = Path("data/parsed_json/mechanical_semester_board_2027.json")
_ENRICHED_PATH = Path("data/programs/mechanical_engineering_2027_enriched.json")
_GQL_CACHE     = Path("data/raw_html/tau_program_8715_2025.json")
_DB_PATH       = Path("data/database.sqlite")
_TCID          = "8715"
_SHANA         = "2025"


# ---------------------------------------------------------------------------
# GraphQL helpers (name / hours enrichment)
# ---------------------------------------------------------------------------

def _load_graphql_body() -> list[dict]:
    for enc in ("utf-8-sig", "utf-8"):
        try:
            raw = json.loads(_GQL_CACHE.read_text(encoding=enc))
            return raw["data"]["results"]["body"]
        except Exception:
            continue
    return []


def _fetch_or_load_graphql(force_refresh: bool = False) -> list[dict]:
    if _GQL_CACHE.exists() and not force_refresh:
        body = _load_graphql_body()
        if body:
            return body
    print(f"[graphql] Fetching program data for tcid={_TCID} shana={_SHANA}…")
    return fetch_program_data(
        tcid=_TCID, shana=_SHANA, safa="1",
        cache_path=_GQL_CACHE, force_refresh=force_refresh,
    )


def _extract_course_map(body: list[dict]) -> dict[str, dict]:
    """Return {course_id: {name_he, weekly_hours}} from all rama sections."""
    import re
    course_map: dict[str, dict] = {}

    def _norm(raw: str) -> str:
        digits = re.sub(r"\D", "", raw)
        return f"{digits[:4]}-{digits[4:]}" if len(digits) == 8 else raw.strip()

    def _process(kurs_list: list[dict]) -> None:
        for k in kurs_list:
            raw_id = k.get("kursshow", "")
            name   = k.get("teurkurs", "")
            hours  = k.get("shaotuni")
            mevutal = k.get("mevutal", "0")
            hidden  = k.get("hidekurs", "")
            if not raw_id or not name:
                continue
            if mevutal == "1" or (hidden and hidden not in ("0", "")):
                continue
            cid = _norm(raw_id)
            if cid not in course_map:
                wh: float | None = None
                try:
                    wh = float(hours) if hours else None
                except (TypeError, ValueError):
                    pass
                course_map[cid] = {"name_he": name, "weekly_hours": wh}

    if not body:
        return course_map
    for rama in body[0].get("rama", []):
        _process(rama.get("kurs", []))
        for sub in rama.get("rama", []):
            _process(sub.get("kurs", []))
    return course_map


def _enrich_graphql(board_path: Path, course_map: dict[str, dict]) -> dict:
    """Fill missing name_he / weekly_hours from GraphQL cache."""
    board = json.loads(board_path.read_text(encoding="utf-8"))
    repo  = board["metadata"]["program_repository_courses"]
    n_name = n_hours = 0
    still_missing_name: list[str] = []

    for rc in repo:
        cid  = rc.get("course_id", "")
        info = course_map.get(cid, {})
        if not rc.get("name_he") and info.get("name_he"):
            rc["name_he"] = info["name_he"]
            n_name += 1
        if rc.get("weekly_hours") is None and info.get("weekly_hours") is not None:
            rc["weekly_hours"] = info["weekly_hours"]
            n_hours += 1
        if not rc.get("name_he"):
            still_missing_name.append(cid)

    board_path.write_text(json.dumps(board, ensure_ascii=False, indent=2), encoding="utf-8")
    return {
        "enriched_name":      n_name,
        "enriched_hours":     n_hours,
        "still_missing_name": still_missing_name,
    }


# ---------------------------------------------------------------------------
# Main pipeline
# ---------------------------------------------------------------------------

def enrich_board(
    board_path: Path = _BOARD_PATH,
    force_refresh: bool = False,
    dry_run: bool = False,
) -> dict:
    """Run full 2027 enrichment pipeline. Returns final board stats dict."""

    # Step 1: Build board from enriched program
    print("[enrich] Loading enriched 2027 program…")
    program = json.loads(_ENRICHED_PATH.read_text(encoding="utf-8"))

    print("[enrich] Building semester board…")
    board = build_semester_board(
        plan={"selected_courses": []},
        program=program,
        db_path=_DB_PATH,
    )
    if not dry_run:
        board_path.write_text(
            json.dumps(board, ensure_ascii=False, indent=2), encoding="utf-8"
        )

    # Step 2 & 3: Enrich repo + placed courses with IMS detail links (from cache)
    print("[enrich] Running URL enrichment from cached course-detail pages…")
    url_enriched = _enrich_links(
        board_path=board_path,
        force_refresh=force_refresh,
        dry_run=dry_run,
    )
    n_got_syl = sum(1 for v in url_enriched.values() if "syllabus_url" in v)
    print(f"  enriched {len(url_enriched)} courses, {n_got_syl} got syllabus_url")

    # Step 4: Fill names / hours from GraphQL
    print("[enrich] Running name/hours enrichment from GraphQL cache…")
    body       = _fetch_or_load_graphql(force_refresh)
    course_map = _extract_course_map(body)
    print(f"  extracted {len(course_map)} courses from GraphQL")
    if not dry_run:
        gql_stats = _enrich_graphql(board_path, course_map)
    else:
        gql_stats = {"enriched_name": 0, "enriched_hours": 0, "still_missing_name": []}

    if gql_stats["enriched_name"] or gql_stats["enriched_hours"]:
        print(f"  enriched {gql_stats['enriched_name']} names, "
              f"{gql_stats['enriched_hours']} hours from GraphQL")
    if gql_stats["still_missing_name"]:
        print(f"  still missing name_he: {gql_stats['still_missing_name']}")

    # Compute final stats from board
    board_final = json.loads(board_path.read_text(encoding="utf-8")) if not dry_run else board
    repo_final  = board_final["metadata"].get("program_repository_courses", [])
    placed_all  = [c for sem in board_final["semesters"] for c in sem.get("courses", [])]
    placed_mand = [c for c in placed_all if c.get("course_type") == "mandatory"]

    from collections import Counter
    cats = Counter(r.get("category_id") for r in repo_final)

    return {
        "graphql_ok":              bool(body),
        "total_repo":              len(repo_final),
        "enriched_name":           gql_stats["enriched_name"],
        "enriched_hours":          gql_stats["enriched_hours"],
        "still_missing_name":      gql_stats["still_missing_name"],
        "still_missing_hours":     [r["course_id"] for r in repo_final if r.get("weekly_hours") is None],
        "with_course_details_url": sum(1 for r in repo_final if r.get("course_details_url")),
        "with_syllabus_url":       sum(1 for r in repo_final if r.get("syllabus_url")),
        "mandatory_placed":        len(placed_mand),
        "mandatory_with_details":  sum(1 for c in placed_mand if c.get("course_details_url")),
        "mandatory_with_syllabus": sum(1 for c in placed_mand if c.get("syllabus_url")),
        "elective_placed":         sum(1 for c in placed_all if c.get("course_type") != "mandatory"),
        "tau_factor_not_started":  sum(1 for r in repo_final if r.get("tau_factor_status") == "not_started"),
        "cat_fluids":              cats.get("fluids", 0),
        "cat_solids":              cats.get("solids", 0),
        "cat_systems":             cats.get("systems", 0),
        "cat_advanced_labs":       cats.get("advanced_labs", 0),
        "cat_other_spec":          cats.get("other_specialization", 0),
    }


# ---------------------------------------------------------------------------
# Report printer
# ---------------------------------------------------------------------------

def _print_report(stats: dict) -> None:
    print()
    print("=" * 58)
    print("Enrichment Report — mechanical_engineering_2027")
    print("=" * 58)
    print(f"  Total repository courses         : {stats['total_repo']}")
    print(f"  Planned mandatory courses         : {stats['mandatory_placed']}")
    print(f"  Planned elective/core/lab         : {stats['elective_placed']}")
    print(f"  With course_details_url (repo)    : {stats['with_course_details_url']}")
    print(f"  With syllabus_url (repo)          : {stats['with_syllabus_url']}")
    print(f"  Mandatory with course_details_url : {stats['mandatory_with_details']}")
    print(f"  Mandatory with syllabus_url       : {stats['mandatory_with_syllabus']}")
    miss_syl = stats['total_repo'] - stats['with_syllabus_url']
    print(f"  Still missing syllabus_url (repo) : {miss_syl}")
    if stats["still_missing_name"]:
        print(f"  Still missing name_he ({len(stats['still_missing_name'])}): {stats['still_missing_name']}")
    if stats["still_missing_hours"]:
        n = len(stats["still_missing_hours"])
        print(f"  Still missing weekly_hours ({n}): {stats['still_missing_hours'][:5]}{'…' if n>5 else ''}")
    print(f"  TAU Factor status=not_started     : {stats['tau_factor_not_started']}")
    print(f"  Categories: fluids={stats['cat_fluids']} solids={stats['cat_solids']} "
          f"systems={stats['cat_systems']} labs={stats['cat_advanced_labs']} "
          f"other={stats['cat_other_spec']}")
    print()
    print("TAU Factor: not available (domains unreachable). All courses 'not_started'.")
    print("Syllabus AI analysis: pending where syllabus_url exists; not_available otherwise.")


# ---------------------------------------------------------------------------
# CLI
# ---------------------------------------------------------------------------

def main() -> None:
    ap = argparse.ArgumentParser(description="Full enrichment pipeline for 2027 board")
    ap.add_argument("--dry-run",       action="store_true")
    ap.add_argument("--force-refresh", action="store_true")
    args = ap.parse_args()

    stats = enrich_board(force_refresh=args.force_refresh, dry_run=args.dry_run)
    _print_report(stats)

    if args.dry_run:
        print("[dry-run] No files written")


if __name__ == "__main__":
    main()

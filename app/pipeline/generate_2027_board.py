"""
Regenerate data/parsed_json/mechanical_semester_board_2027.json from the
enriched 2027 program JSON, then restore URL enrichments from cache.

Steps:
  1. Load mechanical_engineering_2027_enriched.json (includes mandatory courses
     reference and richer other_specialization_electives data).
  2. Call build_semester_board({}, program) — places 12 mandatory Y3/Y4 courses,
     builds 56-course repository from enriched program data.
  3. Re-run enrich_board_links to restore syllabus/exam/prereq/moodle URLs
     from data/raw_html/course_details/ cache.
  4. Re-run name/hours enrichment from TAU GraphQL cache for any still-null fields.
  5. Save result to data/parsed_json/mechanical_semester_board_2027.json.

Usage:
    python -m app.pipeline.generate_2027_board [--dry-run]
"""

from __future__ import annotations

import argparse
import json
from pathlib import Path

from app.analysis.semester_board import build_semester_board, _annotate_program_requirements
from app.scraping.enrich_board_links import enrich_board as enrich_links
from app.pipeline.enrich_mechanical_2027 import enrich_board as enrich_graphql

_ENRICHED_PROGRAM_PATH = Path("data/programs/mechanical_engineering_2027_enriched.json")
_BOARD_PATH            = Path("data/parsed_json/mechanical_semester_board_2027.json")
_DB_PATH               = Path("data/database.sqlite")


def generate(dry_run: bool = False) -> dict:
    """Generate the 2027 board JSON and return it."""
    print("[generate] Loading enriched 2027 program…")
    program = json.loads(_ENRICHED_PROGRAM_PATH.read_text(encoding="utf-8"))
    print(f"  program_id: {program.get('program_id')}")

    print("[generate] Building semester board (empty plan, mandatory auto-placed)…")
    board = build_semester_board(
        plan={"selected_courses": []},
        program=program,
        db_path=_DB_PATH,
    )

    # Count what was placed
    placed = [c for sem in board["semesters"] for c in sem.get("courses", [])]
    mandatory_placed = [c for c in placed if c.get("course_type") == "mandatory"]
    elective_placed  = [c for c in placed if c.get("course_type") != "mandatory"]
    repo = board["metadata"].get("program_repository_courses", [])
    print(f"  placed total      : {len(placed)}")
    print(f"  mandatory placed  : {len(mandatory_placed)}")
    print(f"  elective placed   : {len(elective_placed)}")
    print(f"  repository courses: {len(repo)}")

    if not dry_run:
        _BOARD_PATH.write_text(
            json.dumps(board, ensure_ascii=False, indent=2), encoding="utf-8"
        )
        print(f"[generate] Board saved: {_BOARD_PATH}")

        # Step 2: restore syllabus/exam/prereq/moodle URLs from cached HTML
        print("[generate] Running URL enrichment from cached course-detail pages…")
        enriched = enrich_links(board_path=_BOARD_PATH)
        with_syl = sum(1 for v in enriched.values() if "syllabus_url" in v)
        print(f"  enriched {len(enriched)} courses, {with_syl} got syllabus_url")

        # Step 3: fill still-missing names/hours from GraphQL cache
        print("[generate] Running name/hours enrichment from GraphQL cache…")
        stats = enrich_graphql(board_path=_BOARD_PATH)
        print(f"  enriched {stats.get('enriched_name', 0)} names, "
              f"{stats.get('enriched_hours', 0)} hours")
        if stats.get("still_missing_name"):
            print(f"  still missing name: {stats['still_missing_name']}")

    # Final state
    board_final = json.loads(_BOARD_PATH.read_text(encoding="utf-8"))
    return board_final


def _print_summary(board: dict) -> None:
    from collections import Counter
    placed = [c for sem in board["semesters"] for c in sem.get("courses", [])]
    repo = board["metadata"].get("program_repository_courses", [])
    cats = Counter(r.get("category_id") for r in repo)

    print()
    print("=" * 50)
    print("Generation summary — mechanical_engineering_2027")
    print("=" * 50)
    print(f"  placed total          : {len(placed)}")
    print(f"  mandatory placed      : {sum(1 for c in placed if c.get('course_type')=='mandatory')}")
    print(f"  elective placed       : {sum(1 for c in placed if c.get('course_type')!='mandatory')}")
    print(f"  repository courses    : {len(repo)}")
    print(f"  fluids                : {cats.get('fluids',0)}")
    print(f"  solids                : {cats.get('solids',0)}")
    print(f"  systems               : {cats.get('systems',0)}")
    print(f"  advanced_labs         : {cats.get('advanced_labs',0)}")
    print(f"  other_specialization  : {cats.get('other_specialization',0)}")
    no_name  = sum(1 for r in repo if not r.get("name_he"))
    no_hours = sum(1 for r in repo if r.get("weekly_hours") is None)
    print(f"  repo missing name_he  : {no_name}")
    print(f"  repo missing hours    : {no_hours}")
    mand_in_repo = sum(
        1 for c in placed
        if c.get("course_type") == "mandatory"
        and any(r["course_id"] == c["course_id"] for r in repo)
    )
    print(f"  mandatory in repo (bad): {mand_in_repo}")


def main() -> None:
    ap = argparse.ArgumentParser(description="Regenerate 2027 board JSON")
    ap.add_argument("--dry-run", action="store_true",
                    help="Compute but do not write files")
    args = ap.parse_args()

    board = generate(dry_run=args.dry_run)
    _print_summary(board)

    if args.dry_run:
        print("[dry-run] No files written")


if __name__ == "__main__":
    main()

"""
Verification report for data/parsed_json/mechanical_semester_board_2027.json.

Usage:
    python -m app.pipeline.verify_mechanical_2027_data
"""

from __future__ import annotations

import json
from collections import Counter
from pathlib import Path

_BOARD_PATH = Path("data/parsed_json/mechanical_semester_board_2027.json")
_MAND_PATH  = Path("data/programs/mechanical_engineering_mandatory_2027.json")


def verify() -> dict:
    board = json.loads(_BOARD_PATH.read_text(encoding="utf-8"))
    sems  = board["semesters"]
    repo  = board["metadata"].get("program_repository_courses", [])

    placed_all       = [c for sem in sems for c in sem.get("courses", [])]
    placed_mandatory = [c for c in placed_all if c.get("course_type") == "mandatory"]
    placed_elective  = [c for c in placed_all if c.get("course_type") != "mandatory"]

    repo_ids   = {r["course_id"] for r in repo}
    mand_ids   = {c["course_id"] for c in placed_mandatory}
    mand_in_repo = mand_ids & repo_ids

    cats = Counter(r.get("category_id") for r in repo)

    with_hours   = [r for r in repo if r.get("weekly_hours") is not None]
    miss_hours   = [r for r in repo if r.get("weekly_hours") is None]
    with_name    = [r for r in repo if r.get("name_he")]
    miss_name    = [r for r in repo if not r.get("name_he")]

    return {
        "placed_total":            len(placed_all),
        "placed_mandatory":        len(placed_mandatory),
        "placed_elective":         len(placed_elective),
        "repository_courses":      len(repo),
        "mandatory_in_repo":       len(mand_in_repo),
        "mandatory_in_repo_ids":   sorted(mand_in_repo),
        "cat_fluids":              cats.get("fluids", 0),
        "cat_solids":              cats.get("solids", 0),
        "cat_systems":             cats.get("systems", 0),
        "cat_advanced_labs":       cats.get("advanced_labs", 0),
        "cat_other_specialization":cats.get("other_specialization", 0),
        "repo_with_weekly_hours":  len(with_hours),
        "repo_missing_weekly_hours": len(miss_hours),
        "repo_missing_hours_ids":  [r["course_id"] for r in miss_hours],
        "repo_with_name":          len(with_name),
        "repo_missing_name":       len(miss_name),
        "repo_missing_name_ids":   [r["course_id"] for r in miss_name],
    }


def main() -> None:
    v = verify()

    print("=" * 55)
    print("Verification — mechanical_engineering_2027")
    print("=" * 55)
    print(f"  placed courses total           : {v['placed_total']}")
    print(f"  planned mandatory courses      : {v['placed_mandatory']}")
    print(f"  planned elective/core/lab      : {v['placed_elective']}")
    print(f"  repository courses             : {v['repository_courses']}")
    print(f"  mandatory mistakenly in repo   : {v['mandatory_in_repo']}")
    if v["mandatory_in_repo_ids"]:
        print(f"    ids: {v['mandatory_in_repo_ids']}")
    print(f"  category fluids                : {v['cat_fluids']}")
    print(f"  category solids                : {v['cat_solids']}")
    print(f"  category systems               : {v['cat_systems']}")
    print(f"  category advanced_labs         : {v['cat_advanced_labs']}")
    print(f"  category other_specialization  : {v['cat_other_specialization']}")
    print(f"  repo courses with weekly_hours : {v['repo_with_weekly_hours']}")
    print(f"  repo courses missing hours     : {v['repo_missing_weekly_hours']}")
    if v["repo_missing_hours_ids"]:
        print(f"    ids: {v['repo_missing_hours_ids']}")
    print(f"  repo courses with Hebrew name  : {v['repo_with_name']}")
    print(f"  repo courses missing name      : {v['repo_missing_name']}")
    if v["repo_missing_name_ids"]:
        print(f"    ids: {v['repo_missing_name_ids']}")

    # Acceptance checks
    print()
    print("--- Acceptance checks ---")
    ok = True

    def check(label: str, passed: bool, detail: str = "") -> None:
        nonlocal ok
        status = "PASS" if passed else "FAIL"
        line = f"  [{status}] {label}"
        if detail:
            line += f"  ({detail})"
        print(line)
        if not passed:
            ok = False

    check("planned mandatory > 0",     v["placed_mandatory"] > 0,   f"got {v['placed_mandatory']}")
    check("planned elective == 0",     v["placed_elective"] == 0,   f"got {v['placed_elective']}")
    check("repository == 56",          v["repository_courses"] == 56, f"got {v['repository_courses']}")
    check("no mandatory in repo",      v["mandatory_in_repo"] == 0,  f"found {v['mandatory_in_repo']}")
    check("fluids == 4",               v["cat_fluids"] == 4)
    check("solids == 4",               v["cat_solids"] == 4)
    check("systems == 4",              v["cat_systems"] == 4)
    check("advanced_labs == 5",        v["cat_advanced_labs"] == 5)
    check("other_specialization == 39",v["cat_other_specialization"] == 39)

    print()
    print("Overall:", "PASS" if ok else "FAIL - see above")


if __name__ == "__main__":
    main()

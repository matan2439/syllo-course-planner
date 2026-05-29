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

    # syllabus fields
    repo_with_syl   = [r for r in repo if r.get("syllabus_url")]
    repo_miss_syl   = [r for r in repo if not r.get("syllabus_url")]
    mand_with_syl   = [c for c in placed_mandatory if c.get("syllabus_url")]
    repo_with_det   = sum(1 for r in repo if r.get("course_details_url"))
    mand_with_det   = sum(1 for c in placed_mandatory if c.get("course_details_url"))

    # difficulty
    repo_with_diff  = sum(1 for r in repo if r.get("difficulty_score") is not None)
    repo_partial    = sum(1 for r in repo if r.get("detail_source_type") in (None, "partial"))

    # tau factor
    tf_counts = Counter(r.get("tau_factor_status") for r in repo)

    return {
        "repository_courses":       len(repo),
        "placed_mandatory":         len(placed_mandatory),
        "placed_elective":          len(placed_elective),
        "mandatory_in_repo":        len(mand_in_repo),
        "cat_fluids":               cats.get("fluids", 0),
        "cat_solids":               cats.get("solids", 0),
        "cat_systems":              cats.get("systems", 0),
        "cat_advanced_labs":        cats.get("advanced_labs", 0),
        "cat_other_specialization": cats.get("other_specialization", 0),
        "repo_with_course_details_url": repo_with_det,
        "repo_with_syllabus_url":       len(repo_with_syl),
        "repo_missing_syllabus_url":    len(repo_miss_syl),
        "repo_missing_syllabus_ids":    [r["course_id"] for r in repo_miss_syl],
        "mandatory_with_course_details_url": mand_with_det,
        "mandatory_with_syllabus_url":       len(mand_with_syl),
        "tau_factor_matched":        tf_counts.get("matched", 0),
        "tau_factor_not_started":    tf_counts.get("not_started", 0),
        "repo_with_difficulty_score":   repo_with_diff,
        "repo_partial_info":         repo_partial,
    }


def main() -> None:
    v = verify()

    print("=" * 58)
    print("Verification — mechanical_engineering_2027")
    print("=" * 58)
    print(f"  repository courses                   : {v['repository_courses']}")
    print(f"  planned mandatory courses             : {v['placed_mandatory']}")
    print(f"  planned elective/core/lab             : {v['placed_elective']}")
    print(f"  mandatory mistakenly in repo          : {v['mandatory_in_repo']}")
    print(f"  category fluids                       : {v['cat_fluids']}")
    print(f"  category solids                       : {v['cat_solids']}")
    print(f"  category systems                      : {v['cat_systems']}")
    print(f"  category advanced_labs                : {v['cat_advanced_labs']}")
    print(f"  category other_specialization         : {v['cat_other_specialization']}")
    print()
    print(f"  repo with course_details_url          : {v['repo_with_course_details_url']}")
    print(f"  repo with syllabus_url                : {v['repo_with_syllabus_url']}")
    print(f"  repo missing syllabus_url             : {v['repo_missing_syllabus_url']}")
    if v["repo_missing_syllabus_ids"]:
        print(f"    ids: {v['repo_missing_syllabus_ids']}")
    print(f"  mandatory with course_details_url     : {v['mandatory_with_course_details_url']}")
    print(f"  mandatory with syllabus_url           : {v['mandatory_with_syllabus_url']}")
    print()
    print(f"  tau_factor matched                    : {v['tau_factor_matched']}")
    print(f"  tau_factor not_started                : {v['tau_factor_not_started']}")
    print(f"  repo with difficulty_score            : {v['repo_with_difficulty_score']}")
    print(f"  repo partial_info count               : {v['repo_partial_info']}")

    print()
    print("--- Acceptance checks ---")
    ok = True

    def check(label: str, passed: bool, detail: str = "") -> None:
        nonlocal ok
        s = "PASS" if passed else "FAIL"
        line = f"  [{s}] {label}"
        if detail:
            line += f"  ({detail})"
        print(line)
        if not passed:
            ok = False

    check("mandatory placed > 0",     v["placed_mandatory"] > 0,       f"got {v['placed_mandatory']}")
    check("elective placed == 0",      v["placed_elective"] == 0,        f"got {v['placed_elective']}")
    check("repository == 56",          v["repository_courses"] == 56,    f"got {v['repository_courses']}")
    check("no mandatory in repo",      v["mandatory_in_repo"] == 0,      f"found {v['mandatory_in_repo']}")
    check("fluids == 4",               v["cat_fluids"] == 4)
    check("solids == 4",               v["cat_solids"] == 4)
    check("systems == 4",              v["cat_systems"] == 4)
    check("advanced_labs == 5",        v["cat_advanced_labs"] == 5)
    check("other_specialization == 39",v["cat_other_specialization"] == 39)
    check("repo course_details == 56", v["repo_with_course_details_url"] == 56, f"got {v['repo_with_course_details_url']}")
    check("repo syllabus_url >= 48",   v["repo_with_syllabus_url"] >= 48,       f"got {v['repo_with_syllabus_url']}")
    check("mandatory course_details > 0", v["mandatory_with_course_details_url"] > 0, f"got {v['mandatory_with_course_details_url']}")
    check("tau_factor not_started==56",v["tau_factor_not_started"] == 56)

    print()
    print("Overall:", "PASS" if ok else "FAIL — see above")


if __name__ == "__main__":
    main()

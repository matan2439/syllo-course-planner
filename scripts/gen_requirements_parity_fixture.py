"""Generate golden data proving api/ai/requirements_recompute.ts matches validate_program_plan.

Runs the REAL Python check (app/analysis/program_requirements.py) over several plans built from the
shipped 2027 program and writes tests/api/fixtures/requirements_parity.json. The TypeScript test replays
each case and must reproduce the Python output exactly. Regenerate after changing either implementation:

    python scripts/gen_requirements_parity_fixture.py
"""
from __future__ import annotations

import json
import os
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, ROOT)

from app.analysis.program_requirements import (  # noqa: E402
    get_program_categories_for_frontend,
    load_program_requirements,
    validate_program_plan,
)

PROGRAM = os.path.join(ROOT, "data", "programs", "mechanical_engineering_2027_enriched.json")
BOARD = os.path.join(ROOT, "data", "boards", "mechanical_engineering_2027.json")
OUT = os.path.join(ROOT, "tests", "api", "fixtures", "requirements_parity.json")


def _course(course_id: str, hours: float | None) -> dict:
    return {"course_id": course_id, "weekly_hours": hours}


def main() -> None:
    program = load_program_requirements(PROGRAM)
    block = get_program_categories_for_frontend(program)
    with open(BOARD, encoding="utf-8") as fh:
        real_board = json.load(fh)
    real_semesters = [
        {"semester_id": s["semester_id"], "courses": [_course(c["course_id"], c.get("weekly_hours")) for c in s["courses"]]}
        for s in real_board["semesters"]
    ]
    pools = {c["category_id"]: c["course_ids"] for c in block["categories"]}

    def semesters_with(extra: dict[str, list[dict]]) -> list[dict]:
        merged = [{"semester_id": s["semester_id"], "courses": list(s["courses"])} for s in real_semesters]
        for sid, courses in extra.items():
            next(s for s in merged if s["semester_id"] == sid)["courses"].extend(courses)
        return merged

    cases = {
        "shipped board as-is": (real_semesters, real_board["metadata"].get("completed_course_ids", [])),
        "empty plan": ([{"semester_id": "year_3_semester_a", "courses": []}], []),
        "core electives satisfy the core total": (
            semesters_with({
                "year_3_semester_a": [_course(pools["fluids"][0], 3.5), _course(pools["solids"][0], 4.0)],
                "year_3_semester_b": [_course(pools["systems"][0], 3.0), _course(pools["fluids"][1], 3.5)],
                "year_4_semester_a": [_course(pools["solids"][1], 4.5), _course(pools["systems"][1], 3.0)],
            }),
            [],
        ),
        "gateway courses, labs and an unknown-hours course": (
            semesters_with({
                "year_4_semester_a": [
                    _course(pools["shaar_ruach"][0], 2.0), _course(pools["shaar_ruach"][1], 2.0),
                    _course(pools["shaar_ruach"][2], 2.0), _course(pools["advanced_labs"][0], 4.0),
                    _course(pools["other_specialization"][0], None),
                ],
            }),
            [],
        ),
        "completed courses count toward categories": (
            real_semesters,
            [pools["fluids"][0], pools["solids"][0], pools["systems"][0], pools["fluids"][1],
             pools["solids"][1], pools["systems"][1], pools["advanced_labs"][0]],
        ),
    }

    out = {"block": block, "cases": []}
    for name, (semesters, completed) in cases.items():
        board = {"semesters": semesters}
        expected = validate_program_plan(board, program, list(completed))
        for cat in expected["category_results"]:
            cat["selected_courses"] = sorted(cat["selected_courses"])
        out["cases"].append({
            "name": name,
            "completed_course_ids": list(completed),
            "semesters": semesters,
            "expected": expected,
        })

    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    with open(OUT, "w", encoding="utf-8", newline="\n") as fh:
        fh.write(json.dumps(out, indent=2, ensure_ascii=False) + "\n")
    print(f"wrote {len(out['cases'])} case(s) -> {os.path.relpath(OUT, ROOT)}")


if __name__ == "__main__":
    main()

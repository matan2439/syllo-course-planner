"""Backfill `is_core` / `mandatory_course_ids` into shipped board files.

`get_program_categories_for_frontend` now emits two extra inputs that the TypeScript requirements
recompute (shared/planner/requirements.ts) needs. Boards that were generated before that change
carry the old block, so this patches them in place WITHOUT regenerating anything else.

A board is only touched when its stored `program_requirements_categories` is exactly what some
program file in data/programs produces today (ignoring the two new keys) - i.e. we are certain
which program it came from. Anything else is reported and left alone.

    python scripts/backfill_requirement_flags.py          # dry run
    python scripts/backfill_requirement_flags.py --write  # apply
"""
from __future__ import annotations

import glob
import json
import os
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, ROOT)

from app.analysis.program_requirements import (  # noqa: E402
    get_program_categories_for_frontend,
    load_program_requirements,
)

NEW_TOP_LEVEL = {"mandatory_course_ids"}
NEW_PER_CATEGORY = {"is_core"}


def _without_new(block: dict) -> dict:
    return {
        **{k: v for k, v in block.items() if k not in NEW_TOP_LEVEL and k != "categories"},
        "categories": [
            {k: v for k, v in c.items() if k not in NEW_PER_CATEGORY} for c in block.get("categories", [])
        ],
    }


def _program_blocks() -> list[tuple[str, dict]]:
    blocks = []
    for path in sorted(glob.glob(os.path.join(ROOT, "data", "programs", "*.json"))):
        try:
            blocks.append((os.path.basename(path), get_program_categories_for_frontend(load_program_requirements(path))))
        except Exception:  # noqa: BLE001 - not every file in data/programs is a full program
            continue
    return blocks


def main() -> int:
    write = "--write" in sys.argv
    programs = _program_blocks()
    changed = 0
    for path in sorted(glob.glob(os.path.join(ROOT, "data", "boards", "*.json"))):
        name = os.path.basename(path)
        with open(path, encoding="utf-8") as fh:
            raw = fh.read()
        board = json.loads(raw)
        stored = (board.get("metadata") or {}).get("program_requirements_categories")
        if not stored:
            print(f"skip   {name}: no requirements block")
            continue
        if "mandatory_course_ids" in stored and all("is_core" in c for c in stored.get("categories", [])):
            print(f"ok     {name}: already has the new fields")
            continue
        source = next((pname for pname, block in programs if _without_new(block) == _without_new(stored)), None)
        if source is None:
            print(f"skip   {name}: stored block matches no program file (left untouched)")
            continue
        fresh = next(block for pname, block in programs if pname == source)
        board["metadata"]["program_requirements_categories"] = fresh
        print(f"{'write ' if write else 'would '} {name}: from {source}")
        if write:
            with open(path, "w", encoding="utf-8", newline="\n") as fh:
                fh.write(json.dumps(board, indent=2, ensure_ascii=False) + "\n")
        changed += 1
    print(f"{changed} board(s) {'updated' if write else 'to update (dry run)'}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

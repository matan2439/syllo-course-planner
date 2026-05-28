"""
Resolve prerequisite name strings to course IDs in the database.

Prerequisite entries in program JSON files carry a ``name_he`` field and a
``resolution_status`` of "unresolved".  This module tries to match those names
to a real course in the DB; when a match is found it sets ``course_id`` and
``resolution_status`` to "resolved".  Entries that cannot be matched keep
their ``name_he`` so the UI can still display a human-readable label.

Usage
-----
    from app.analysis.prerequisite_resolver import resolve_prerequisites_in_program
    program = resolve_prerequisites_in_program(program_dict, db_path)

The function returns a *new* dict (the original is not mutated).
"""

from __future__ import annotations

import copy
import sqlite3
from pathlib import Path
from typing import Any

from app.database.db import _DB_PATH
from app.analysis.eligibility_engine import normalize_course_id


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------

def resolve_prerequisites_in_program(
    program: dict[str, Any],
    db_path: Path = _DB_PATH,
) -> dict[str, Any]:
    """
    Return a deep-copied program dict with prerequisite course_ids filled in
    wherever a matching course name is found in the database.
    """
    program = copy.deepcopy(program)
    name_index = _build_name_index(db_path)

    for course in program.get("elective_courses", []):
        _resolve_prereq_list(course.get("prerequisites", []), name_index)

    return program


def resolve_prereq_list(
    prereqs: list[dict[str, Any]],
    db_path: Path = _DB_PATH,
) -> list[dict[str, Any]]:
    """
    Resolve a standalone list of prerequisite dicts.
    Each dict must have at least a ``name_he`` key.
    Returns a new list (originals not mutated).
    """
    prereqs = copy.deepcopy(prereqs)
    name_index = _build_name_index(db_path)
    _resolve_prereq_list(prereqs, name_index)
    return prereqs


def format_prereq_display(prereq: dict[str, Any]) -> str:
    """
    Return the best human-readable label for a prerequisite entry.
    Prefers name_he; falls back to course_id.
    """
    name = prereq.get("name_he") or ""
    cid  = prereq.get("course_id") or ""
    if name:
        return name
    return cid


# ---------------------------------------------------------------------------
# Internal helpers
# ---------------------------------------------------------------------------

def _build_name_index(db_path: Path) -> dict[str, str]:
    """Return a map of normalised name_he → course_id from the DB."""
    if not db_path.exists():
        return {}
    index: dict[str, str] = {}
    try:
        conn = sqlite3.connect(str(db_path))
        rows = conn.execute("SELECT course_id, name_he FROM courses WHERE name_he IS NOT NULL").fetchall()
        conn.close()
        for cid, name in rows:
            if name:
                norm_name = _norm_name(name)
                index[norm_name] = normalize_course_id(cid)
    except Exception:
        pass
    return index


def _norm_name(name: str) -> str:
    """Lowercase + strip for fuzzy matching."""
    return name.strip().lower()


def _resolve_prereq_list(
    prereqs: list[dict[str, Any]],
    name_index: dict[str, str],
) -> None:
    """Mutate each prereq dict in-place to fill course_id if resolvable."""
    for prereq in prereqs:
        if prereq.get("resolution_status") == "resolved":
            continue
        name = prereq.get("name_he", "")
        if not name:
            continue
        matched_id = name_index.get(_norm_name(name))
        if matched_id:
            prereq["course_id"]        = matched_id
            prereq["resolution_status"] = "resolved"
        else:
            prereq["resolution_status"] = "unresolved"

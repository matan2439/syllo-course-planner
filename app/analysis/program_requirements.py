"""
Generic program requirements engine.

Loads and validates degree-completion requirements from a program JSON file.
Works for any program that uses the requirements.elective_categories schema —
no Mechanical Engineering–specific logic lives here.
"""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

from app.analysis.eligibility_engine import normalize_course_id
from app.pipeline.bulk_import_courses import load_course_ids


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------

def load_program_requirements(program_json_path: str | Path) -> dict[str, Any]:
    """Load and return the full program dict from *program_json_path*."""
    path = Path(program_json_path)
    return json.loads(path.read_text(encoding="utf-8"))


def build_course_category_map(
    program_requirements: dict[str, Any],
) -> dict[str, dict[str, Any]]:
    """
    Return course_id → {category_id, name_he, needs_review}.

    Reads from program_requirements["requirements"]["elective_categories"].
    When a course appears in multiple categories the last entry wins.
    Mandatory courses are also mapped to category_id="mandatory".
    """
    reqs       = program_requirements.get("requirements", {})
    categories = reqs.get("elective_categories", [])
    cat_map: dict[str, dict[str, Any]] = {}

    for cat in categories:
        cat_id    = cat.get("category_id", "")
        name_he   = cat.get("name_he", "")
        needs_rev = bool(cat.get("needs_review", False))

        for cid in cat.get("course_ids", []):
            cat_map[normalize_course_id(cid)] = {
                "category_id":   cat_id,
                "name_he":       name_he,
                "needs_review":  needs_rev,
            }

        fpath_str = cat.get("course_ids_file")
        if fpath_str:
            fpath = Path(fpath_str)
            if fpath.exists():
                for cid in load_course_ids(fpath):
                    cat_map[normalize_course_id(cid)] = {
                        "category_id":   cat_id,
                        "name_he":       name_he,
                        "needs_review":  needs_rev,
                    }

    mandatory      = reqs.get("mandatory_courses", {})
    mandatory_name = mandatory.get("name_he", "קורסי חובה")
    for cid in mandatory.get("course_ids", []):
        norm = normalize_course_id(cid)
        if norm not in cat_map:
            cat_map[norm] = {
                "category_id":  "mandatory",
                "name_he":      mandatory_name,
                "needs_review": False,
            }

    return cat_map


def resolve_category_course_ids(cat: dict[str, Any]) -> list[str]:
    """
    Return the full normalised course-ID list for one elective_category entry,
    expanding course_ids_file entries if the file exists.
    """
    ids: list[str] = [normalize_course_id(c) for c in cat.get("course_ids", [])]
    fpath_str = cat.get("course_ids_file")
    if fpath_str:
        fpath = Path(fpath_str)
        if fpath.exists():
            ids.extend(normalize_course_id(c) for c in load_course_ids(fpath))
    return ids


def get_program_categories_for_frontend(
    program_requirements: dict[str, Any],
) -> dict[str, Any]:
    """
    Return a serialisable dict that the frontend embeds in board metadata.
    Includes total_required_hours, program name, and each category with
    its resolved course_ids list (for client-side validation).
    """
    reqs = program_requirements.get("requirements", {})
    return {
        "total_required_hours": program_requirements.get("total_required_hours"),
        "program_name_he":      program_requirements.get("program_name_he"),
        "categories": [
            {
                "category_id":  cat.get("category_id", ""),
                "name_he":      cat.get("name_he", ""),
                "min_courses":  cat.get("min_courses", 1),
                "needs_review": bool(cat.get("needs_review", False)),
                "course_ids":   resolve_category_course_ids(cat),
            }
            for cat in reqs.get("elective_categories", [])
        ],
    }


def validate_program_plan(
    board: dict[str, Any],
    program_requirements: dict[str, Any],
    completed_course_ids: list[str],
) -> dict[str, Any]:
    """
    Validate a board against program requirements.

    Parameters
    ----------
    board                : semester board dict (from build_semester_board)
    program_requirements : full program dict loaded from program JSON
    completed_course_ids : courses already completed before the planning period

    Returns
    -------
    dict with keys:
        valid                       : bool
        total_required_hours        : int | None
        planned_hours               : float
        unknown_hours_courses       : int
        remaining_hours             : float | None
        category_results            : list — one dict per elective category
        missing_mandatory_courses   : list[str]
        missing_required_categories : list[str]
        warnings                    : list[str]
        explanation                 : str (Hebrew)

    Each category_result contains:
        category_id, name_he, min_courses, needs_review,
        selected_courses, selected_count, satisfied, missing_count
    """
    reqs        = program_requirements.get("requirements", {})
    total_hours = program_requirements.get("total_required_hours")

    # ── Collect planned courses from board ──────────────────────────────────
    planned_ids: set[str] = set()
    planned_hours         = 0.0
    unknown_hours_ct      = 0

    for sem in board.get("semesters", []):
        for course in sem.get("courses", []):
            cid = course.get("course_id")
            if not cid:
                continue
            norm = normalize_course_id(cid)
            planned_ids.add(norm)
            hrs = course.get("weekly_hours")
            if hrs is not None:
                planned_hours += hrs
            else:
                unknown_hours_ct += 1

    completed_set = {normalize_course_id(c) for c in completed_course_ids}
    all_course_ids = completed_set | planned_ids

    # ── Mandatory courses ───────────────────────────────────────────────────
    mandatory      = reqs.get("mandatory_courses", {})
    mandatory_ids  = [normalize_course_id(c) for c in mandatory.get("course_ids", [])]
    missing_mandatory = [cid for cid in mandatory_ids if cid not in all_course_ids]

    # ── Elective categories ─────────────────────────────────────────────────
    elective_categories = reqs.get("elective_categories", [])
    category_results: list[dict[str, Any]] = []
    missing_required_categories: list[str] = []

    for cat in elective_categories:
        cat_id    = cat.get("category_id", "")
        min_c     = cat.get("min_courses", 1)
        needs_rev = bool(cat.get("needs_review", False))
        pool      = set(resolve_category_course_ids(cat))

        selected  = [cid for cid in all_course_ids if cid in pool]
        count     = len(selected)
        satisfied = count >= min_c

        if min_c > 0 and not needs_rev and not satisfied:
            missing_required_categories.append(cat_id)

        category_results.append({
            "category_id":     cat_id,
            "name_he":         cat.get("name_he", cat_id),
            "min_courses":     min_c,
            "needs_review":    needs_rev,
            "selected_courses": selected,
            "selected_count":  count,
            "satisfied":       satisfied,
            "missing_count":   max(0, min_c - count),
        })

    # ── Warnings ────────────────────────────────────────────────────────────
    warnings: list[str] = []
    if unknown_hours_ct > 0:
        warnings.append(
            f"חלק מהשעות אינן ידועות ולכן חישוב המכסה חלקי "
            f"({unknown_hours_ct} קורסים ללא שעות)"
        )
    if missing_mandatory:
        warnings.append(f"קורסי חובה חסרים: {', '.join(missing_mandatory)}")
    for cat_id in missing_required_categories:
        cat  = next(c for c in elective_categories if c.get("category_id") == cat_id)
        name = cat.get("name_he", cat_id)
        warnings.append(f"קטגוריה לא הושלמה: {name}")

    remaining = (
        round(max(0.0, total_hours - planned_hours), 1) if total_hours is not None else None
    )
    valid = not missing_mandatory and not missing_required_categories

    if valid:
        explanation = "כל דרישות הקטגוריות מסופקות."
    else:
        parts = []
        if missing_mandatory:
            parts.append(f"{len(missing_mandatory)} קורסי חובה חסרים")
        if missing_required_categories:
            parts.append(f"{len(missing_required_categories)} קטגוריות לא הושלמו")
        explanation = "דרישות לא מסופקות: " + "; ".join(parts)

    return {
        "valid":                       valid,
        "total_required_hours":        total_hours,
        "planned_hours":               round(planned_hours, 1),
        "unknown_hours_courses":       unknown_hours_ct,
        "remaining_hours":             remaining,
        "category_results":            category_results,
        "missing_mandatory_courses":   missing_mandatory,
        "missing_required_categories": missing_required_categories,
        "warnings":                    warnings,
        "explanation":                 explanation,
    }

"""
Generic program requirements engine.

Loads and validates degree-completion requirements from a program JSON file.
Supports two requirement formats:

  Classic format  — requirements.elective_categories (list of category dicts)
  PDF format      — requirements.core_categories + requirements.advanced_labs
                    + requirements.other_specialization, course details in
                    elective_courses and other_specialization_electives arrays.

Both formats are normalised internally by _get_unified_categories(), so all
public functions work with either.
"""

from __future__ import annotations

import json
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from app.analysis.eligibility_engine import normalize_course_id
from app.parsing.tau_curriculum_document import CurriculumPlannerRequirements
from app.pipeline.bulk_import_courses import load_course_ids


@dataclass(frozen=True)
class CrossTrackRequirementStatus:
    selected_track_courses: int
    selected_core_courses: int
    distinct_core_tracks: int
    selected_advanced_labs: int
    distinct_lab_tracks: int
    valid: bool


def _maximum_distinct_track_assignment(
    selected_course_ids: set[str],
    track_pools: list[tuple[str, set[str]]],
) -> int:
    """Return the largest one-course-per-track assignment supported by facts."""
    assigned_course_by_track: dict[str, str] = {}

    def assign(course_id: str, visited_tracks: set[str]) -> bool:
        for track_name, course_ids in track_pools:
            if course_id not in course_ids or track_name in visited_tracks:
                continue
            visited_tracks.add(track_name)
            existing_course = assigned_course_by_track.get(track_name)
            if existing_course is None or assign(existing_course, visited_tracks):
                assigned_course_by_track[track_name] = course_id
                return True
        return False

    for course_id in sorted(selected_course_ids):
        assign(course_id, set())
    return len(assigned_course_by_track)


def validate_cross_track_requirements(
    selected_course_ids: tuple[str, ...] | list[str] | set[str],
    requirements: CurriculumPlannerRequirements,
) -> CrossTrackRequirementStatus:
    """Validate global course and distinct-track minima without double counting."""
    selected = {normalize_course_id(course_id) for course_id in selected_course_ids}
    track_ids = {
        normalize_course_id(course_id)
        for category in requirements.track_categories
        for course_id in category.course_ids
    }
    core_ids = {
        normalize_course_id(course_id)
        for category in requirements.track_categories
        for course_id in category.core_course_ids
    }
    lab_ids = {
        normalize_course_id(course_id)
        for category in requirements.advanced_lab_categories
        for course_id in category.course_ids
    }
    selected_track_ids = selected & track_ids
    selected_core_ids = selected & core_ids
    selected_lab_ids = selected & lab_ids
    distinct_core_tracks = _maximum_distinct_track_assignment(
        selected_core_ids,
        [
            (
                category.track_name,
                {normalize_course_id(course_id) for course_id in category.core_course_ids},
            )
            for category in requirements.track_categories
        ],
    )
    distinct_lab_tracks = _maximum_distinct_track_assignment(
        selected_lab_ids,
        [
            (
                category.track_name,
                {normalize_course_id(course_id) for course_id in category.course_ids},
            )
            for category in requirements.advanced_lab_categories
        ],
    )
    mandatory_ids = {
        normalize_course_id(course_id)
        for course_id in requirements.mandatory_course_ids
    }
    valid = (
        mandatory_ids <= selected
        and len(selected_track_ids) >= requirements.total_track_courses
        and len(selected_core_ids) >= requirements.minimum_core_courses
        and distinct_core_tracks >= requirements.minimum_distinct_core_tracks
        and len(selected_lab_ids) >= requirements.advanced_labs_required
        and distinct_lab_tracks >= requirements.minimum_distinct_lab_tracks
    )
    return CrossTrackRequirementStatus(
        selected_track_courses=len(selected_track_ids),
        selected_core_courses=len(selected_core_ids),
        distinct_core_tracks=distinct_core_tracks,
        selected_advanced_labs=len(selected_lab_ids),
        distinct_lab_tracks=distinct_lab_tracks,
        valid=valid,
    )


# ---------------------------------------------------------------------------
# Internal normalisation
# ---------------------------------------------------------------------------

def _get_unified_categories(program_requirements: dict[str, Any]) -> list[dict[str, Any]]:
    """
    Return a unified list of category dicts regardless of program format.

    Classic format: reads requirements.elective_categories directly.

    PDF format: merges requirements.core_categories, requirements.advanced_labs,
    and requirements.other_specialization.  course_ids come from the
    requirements.*[].course_ids fields (already embedded in the JSON).
    """
    reqs = program_requirements.get("requirements", {})
    if not isinstance(reqs, dict):
        return []

    # --- Classic format -------------------------------------------------------
    if "elective_categories" in reqs:
        return list(reqs["elective_categories"])

    # --- PDF format -----------------------------------------------------------
    cats: list[dict[str, Any]] = []

    for cc in reqs.get("core_categories", []):
        cats.append(dict(cc))

    adv = reqs.get("advanced_labs")
    if isinstance(adv, dict):
        cats.append(dict(adv))

    other = reqs.get("other_specialization")
    if isinstance(other, dict):
        cats.append(dict(other))

    return cats


def get_all_program_course_ids(program_requirements: dict[str, Any]) -> set[str]:
    """
    Return the set of all normalised course IDs covered by a program,
    across all categories (both formats).  Used for filtering allowed electives.
    """
    ids: set[str] = set()
    for cat in _get_unified_categories(program_requirements):
        for cid in cat.get("course_ids", []):
            ids.add(normalize_course_id(cid))
        fpath_str = cat.get("course_ids_file")
        if fpath_str:
            fpath = Path(fpath_str)
            if fpath.exists():
                for cid in load_course_ids(fpath):
                    ids.add(normalize_course_id(cid))
    return ids


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

    Works with both classic (elective_categories) and PDF (core_categories …)
    formats.  Mandatory courses are also mapped to category_id="mandatory".
    """
    cats   = _get_unified_categories(program_requirements)
    cat_map: dict[str, dict[str, Any]] = {}

    for cat in cats:
        cat_id    = cat.get("category_id", "")
        name_he   = cat.get("name_he", "")
        needs_rev = bool(cat.get("needs_review", False))

        for cid in cat.get("course_ids", []):
            cat_map[normalize_course_id(cid)] = {
                "category_id":  cat_id,
                "name_he":      name_he,
                "needs_review": needs_rev,
            }

        fpath_str = cat.get("course_ids_file")
        if fpath_str:
            fpath = Path(fpath_str)
            if fpath.exists():
                for cid in load_course_ids(fpath):
                    cat_map[normalize_course_id(cid)] = {
                        "category_id":  cat_id,
                        "name_he":      name_he,
                        "needs_review": needs_rev,
                    }

    reqs           = program_requirements.get("requirements", {}) if isinstance(program_requirements.get("requirements"), dict) else {}
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
    Return the full normalised course-ID list for one category entry,
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
    Return a serialisable dict embedded in board metadata for the frontend.

    Includes total_required_hours, program name, core_courses_total_min (if
    present), other_category_label (for uncategorised courses), and each
    category with its resolved course_ids list.
    """
    reqs = program_requirements.get("requirements", {}) if isinstance(program_requirements.get("requirements"), dict) else {}
    cats = _get_unified_categories(program_requirements)

    result: dict[str, Any] = {
        "total_required_hours":  program_requirements.get("total_required_hours"),
        "program_name_he":       program_requirements.get("program_name_he"),
        "core_courses_total_min": reqs.get("core_courses_total_min"),
        "other_category_label":  program_requirements.get("ui", {}).get(
            "other_category_label", "לא משויך לתוכנית הנבחרת"
        ),
        "categories": [
            {
                "category_id":  cat.get("category_id", ""),
                "name_he":      cat.get("name_he", ""),
                "min_courses":  cat.get("min_courses", 1),
                "needs_review": bool(cat.get("needs_review", False)),
                "course_ids":   resolve_category_course_ids(cat),
            }
            for cat in cats
        ],
    }
    return result


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
        core_courses_total_min      : int | None
        core_courses_selected       : int | None
        core_courses_satisfied      : bool | None
        category_results            : list — one dict per elective category
        missing_mandatory_courses   : list[str]
        missing_required_categories : list[str]
        warnings                    : list[str]
        explanation                 : str (Hebrew)

    Each category_result contains:
        category_id, name_he, min_courses, needs_review,
        selected_courses, selected_count, satisfied, missing_count
    """
    reqs        = program_requirements.get("requirements", {}) if isinstance(program_requirements.get("requirements"), dict) else {}
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

    completed_set  = {normalize_course_id(c) for c in completed_course_ids}
    all_course_ids = completed_set | planned_ids

    # ── Mandatory courses ───────────────────────────────────────────────────
    mandatory     = reqs.get("mandatory_courses", {})
    mandatory_ids = [normalize_course_id(c) for c in mandatory.get("course_ids", [])]
    missing_mandatory = [cid for cid in mandatory_ids if cid not in all_course_ids]

    # ── Elective categories ─────────────────────────────────────────────────
    all_cats = _get_unified_categories(program_requirements)
    category_results: list[dict[str, Any]] = []
    missing_required_categories: list[str] = []

    # IDs belonging to core categories (fluids/solids/systems) for total count
    core_cat_ids = {
        cat.get("category_id")
        for cat in reqs.get("core_categories", [])
    }

    core_selected = 0
    core_total_min = reqs.get("core_courses_total_min")

    for cat in all_cats:
        cat_id    = cat.get("category_id", "")
        min_c     = cat.get("min_courses", 1)
        needs_rev = bool(cat.get("needs_review", False))
        pool      = set(resolve_category_course_ids(cat))

        selected = [cid for cid in all_course_ids if cid in pool]
        count    = len(selected)
        satisfied = count >= min_c

        if cat_id in core_cat_ids:
            core_selected += count

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

    # Core-total validation (≥ core_courses_total_min across fluids+solids+systems)
    core_satisfied: bool | None = None
    if core_total_min is not None:
        core_satisfied = core_selected >= core_total_min
        if not core_satisfied:
            missing_required_categories.append("core_total")

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
        if cat_id == "core_total":
            warnings.append(
                f"נדרשים לפחות {core_total_min} קורסי ליבה; נבחרו {core_selected}"
            )
        else:
            cat  = next((c for c in all_cats if c.get("category_id") == cat_id), None)
            name = cat.get("name_he", cat_id) if cat else cat_id
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
        real_missing = [c for c in missing_required_categories if c != "core_total"]
        if real_missing:
            parts.append(f"{len(real_missing)} קטגוריות לא הושלמו")
        if core_satisfied is False:
            parts.append(f"קורסי ליבה: {core_selected}/{core_total_min}")
        explanation = "דרישות לא מסופקות: " + "; ".join(parts)

    return {
        "valid":                       valid,
        "total_required_hours":        total_hours,
        "planned_hours":               round(planned_hours, 1),
        "unknown_hours_courses":       unknown_hours_ct,
        "remaining_hours":             remaining,
        "core_courses_total_min":      core_total_min,
        "core_courses_selected":       core_selected if core_total_min is not None else None,
        "core_courses_satisfied":      core_satisfied,
        "category_results":            category_results,
        "missing_mandatory_courses":   missing_mandatory,
        "missing_required_categories": missing_required_categories,
        "warnings":                    warnings,
        "explanation":                 explanation,
    }

"""
Deterministic prerequisite validation for course placement.

IMPORTANT — AI integration rule
---------------------------------
The AI assistant is not allowed to bypass prerequisite validation.
Any AI-proposed plan must be passed through validate_entire_board()
before display. If the result is invalid, the AI must explain what
prerequisite chain needs to be scheduled first, rather than
silently placing the course.

Rules
-----
1. A prerequisite that appears in *completed_course_ids* is satisfied.
2. A prerequisite placed in an *earlier* semester is satisfied.
3. A prerequisite placed in the *same* semester is NOT satisfied (invalid).
4. A prerequisite placed in a *later* semester is NOT satisfied (invalid).
5. A prerequisite that is neither completed nor placed is missing (invalid).
6. A prerequisite that is unknown in the board (not placed, not completed)
   is treated as missing and raises an error — never silently allowed.
"""

from __future__ import annotations

from typing import Any


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------

def validate_course_placement(
    course_id: str,
    target_semester_id: str,
    board: dict[str, Any],
    completed_course_ids: list[str],
    prerequisites: list[str] | None = None,
) -> dict[str, Any]:
    """
    Validate whether *course_id* can be placed in *target_semester_id*.

    Parameters
    ----------
    course_id           : course to validate
    target_semester_id  : proposed (or current) semester for the course
    board               : full board dict with "semesters" list in order
    completed_course_ids: courses already completed before the plan starts
    prerequisites       : override the prerequisite list (default: read from board)

    Returns
    -------
    dict with keys:
        course_id
        target_semester_id
        valid                            : bool
        missing_prerequisites            : prereqs not placed anywhere and not completed
        prerequisites_scheduled_too_late : prereqs placed after target semester
        prerequisites_scheduled_same_semester : prereqs in the same semester
        satisfied_by_completed           : prereqs in completed_course_ids
        satisfied_by_earlier_semesters   : prereqs placed before target semester
        explanation                      : human-readable summary (Hebrew)
        severity                         : "ok" | "warning" | "error"
    """
    semesters = board.get("semesters", [])

    # Build ordered index: course_id → (semester_id, semester_index)
    # Include ALL courses except course_id itself (it's being moved to target)
    course_sem_idx: dict[str, tuple[str, int]] = {}
    for idx, sem in enumerate(semesters):
        for c in sem.get("courses", []):
            cid = c.get("course_id")
            if cid and cid != course_id:
                course_sem_idx[cid] = (sem.get("semester_id", ""), idx)

    # Find target semester index
    target_idx: int | None = None
    for idx, sem in enumerate(semesters):
        if sem.get("semester_id") == target_semester_id:
            target_idx = idx
            break

    if target_idx is None:
        return {
            "course_id":                              course_id,
            "target_semester_id":                     target_semester_id,
            "valid":                                  False,
            "missing_prerequisites":                  [],
            "prerequisites_scheduled_too_late":       [],
            "prerequisites_scheduled_same_semester":  [],
            "satisfied_by_completed":                 [],
            "satisfied_by_earlier_semesters":         [],
            "explanation":                            f"Semester '{target_semester_id}' not found in board.",
            "severity":                               "error",
        }

    # Resolve prerequisites: from parameter or from board data
    if prerequisites is not None:
        prereq_list = prerequisites
    else:
        prereq_list = _find_prerequisites(course_id, board)

    completed_set = set(completed_course_ids)

    satisfied_by_completed:      list[str] = []
    satisfied_by_earlier:        list[str] = []
    same_semester:               list[str] = []
    too_late:                    list[str] = []
    missing:                     list[str] = []

    for prereq in prereq_list:
        if prereq in completed_set:
            satisfied_by_completed.append(prereq)
        elif prereq in course_sem_idx:
            _, prereq_idx = course_sem_idx[prereq]
            if prereq_idx < target_idx:
                satisfied_by_earlier.append(prereq)
            elif prereq_idx == target_idx:
                same_semester.append(prereq)
            else:
                too_late.append(prereq)
        else:
            missing.append(prereq)

    valid = not (same_semester or too_late or missing)

    # Build explanation
    parts: list[str] = []
    if satisfied_by_completed:
        parts.append(f"הושלמו: {', '.join(satisfied_by_completed)}")
    if satisfied_by_earlier:
        parts.append(f"בסמסטרים קודמים: {', '.join(satisfied_by_earlier)}")
    if same_semester:
        parts.append(f"באותו סמסטר (לא מספיק): {', '.join(same_semester)}")
    if too_late:
        parts.append(f"בסמסטר מאוחר: {', '.join(too_late)}")
    if missing:
        parts.append(f"לא שובצו כלל: {', '.join(missing)}")

    if valid:
        explanation = "כל דרישות הקדם מסופקות." if prereq_list else "אין דרישות קדם."
        severity = "ok"
    else:
        explanation = "דרישות קדם לא מסופקות. " + " | ".join(parts)
        severity = "error"

    return {
        "course_id":                              course_id,
        "target_semester_id":                     target_semester_id,
        "valid":                                  valid,
        "missing_prerequisites":                  missing,
        "prerequisites_scheduled_too_late":       too_late,
        "prerequisites_scheduled_same_semester":  same_semester,
        "satisfied_by_completed":                 satisfied_by_completed,
        "satisfied_by_earlier_semesters":         satisfied_by_earlier,
        "explanation":                            explanation,
        "severity":                               severity,
    }


def validate_entire_board(
    board: dict[str, Any],
    completed_course_ids: list[str],
) -> dict[str, Any]:
    """
    Validate all courses currently placed on the board.

    Returns
    -------
    dict with keys:
        valid          : True only if every course placement is valid
        course_results : list of validate_course_placement results (one per course)
        board_warnings : explanations for warning-severity results
        board_errors   : explanations for error-severity results
        summary        : counts dict
    """
    course_results: list[dict[str, Any]] = []

    for sem in board.get("semesters", []):
        sem_id = sem.get("semester_id", "")
        for course in sem.get("courses", []):
            cid = course.get("course_id")
            if not cid:
                continue
            result = validate_course_placement(
                course_id            = cid,
                target_semester_id   = sem_id,
                board                = board,
                completed_course_ids = completed_course_ids,
            )
            course_results.append(result)

    errors   = [r for r in course_results if r["severity"] == "error"]
    warnings = [r for r in course_results if r["severity"] == "warning"]
    valid    = len(errors) == 0

    return {
        "valid":          valid,
        "course_results": course_results,
        "board_warnings": [r["explanation"] for r in warnings],
        "board_errors":   [r["explanation"] for r in errors],
        "summary": {
            "total_courses":      len(course_results),
            "valid_placements":   sum(1 for r in course_results if r["valid"]),
            "invalid_placements": sum(1 for r in course_results if not r["valid"]),
            "error_count":        len(errors),
            "warning_count":      len(warnings),
        },
    }


# ---------------------------------------------------------------------------
# Internal helpers
# ---------------------------------------------------------------------------

def _find_prerequisites(course_id: str, board: dict[str, Any]) -> list[str]:
    """Extract the prerequisite list for *course_id* from the board JSON."""
    for sem in board.get("semesters", []):
        for course in sem.get("courses", []):
            if course.get("course_id") == course_id:
                return course.get("prerequisites") or []
    return []

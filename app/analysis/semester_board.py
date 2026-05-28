"""
Semester board generator.

Distributes a recommended course plan across academic semesters, respecting
prerequisite ordering, season preferences, and optional per-semester hour limits.
Each course and semester carries data-quality indicators for use by a UI layer.
"""

from __future__ import annotations

import json
from collections import deque
from pathlib import Path
from typing import Any

from app.database.db import _DB_PATH, get_course_by_id, get_prerequisites, get_course_display_names, get_grade_stats
from app.analysis.difficulty_estimator import estimate_difficulty_lightweight
from app.analysis.eligibility_engine import normalize_course_id
from app.analysis.instructor_uncertainty import estimate_instructor_uncertainty
from app.analysis.plan_validator import validate_entire_board
from app.analysis.program_requirements import (
    build_course_category_map,
    get_program_categories_for_frontend,
    get_all_program_course_ids,
    validate_program_plan,
)
from app.pipeline.bulk_import_courses import load_course_ids

# Maps Hebrew semester strings stored in the DB to season codes
_HEBREW_SEASON = {"א'": "a", "ב'": "b"}


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------

def build_semester_board(
    plan: dict[str, Any],
    program: dict[str, Any] | None = None,
    max_weekly_hours_per_semester: float | None = None,
    start_year: int = 3,
    completed_course_ids: list[str] | None = None,
    db_path: Path = _DB_PATH,
) -> dict[str, Any]:
    """
    Distribute selected_courses from a plan JSON into a 4-semester board.

    If *program* is provided, mandatory courses defined per-semester in the
    program JSON are placed first (locked, source="program") before electives.

    Returns a dict with keys: semesters, warnings, metadata, summary.
    Each semester: semester_id, display_name, courses, total_weekly_hours,
                   average_difficulty, warnings.
    Each course:   course_id, name_he, weekly_hours, difficulty_score,
                   difficulty_level, course_type, prerequisites, locked_by_user,
                   source, data_quality, warnings.
    """
    courses   = plan.get("selected_courses", [])
    semesters = _make_semesters(start_year)
    global_warnings: list[str] = []

    # Build course→category map from program requirements (if present)
    cat_map: dict[str, dict] = {}
    if program and program.get("requirements"):
        cat_map = build_course_category_map(program)

    # ── Mandatory courses from program JSON ──────────────────────────────────
    mandatory_by_sem: dict[str, list[dict]] = {s["id"]: [] for s in semesters}
    mandatory_hours:  dict[str, float]      = {s["id"]: 0.0 for s in semesters}
    mandatory_ids:    set[str]              = set()

    if program:
        specs       = _parse_mandatory_specs(program)
        # Fixed first (single allowed semester), then flexible (multiple)
        fixed_specs = [sp for sp in specs if len(sp["allowed_semesters"]) <= 1]
        flex_specs  = [sp for sp in specs if len(sp["allowed_semesters"]) > 1]

        for sp in fixed_specs:
            cid    = sp["course_id"]
            sem_id = sp["allowed_semesters"][0] if sp["allowed_semesters"] else None
            if not sem_id or sem_id not in mandatory_by_sem:
                global_warnings.append(
                    f"Mandatory course {cid}: unknown or missing semester '{sem_id}'."
                )
                continue
            mc, mc_warns = _load_mandatory_course(cid, db_path, sp)
            global_warnings.extend(mc_warns)
            mandatory_by_sem[sem_id].append(mc)
            mandatory_ids.add(cid)
            if mc.get("weekly_hours") is not None:
                mandatory_hours[sem_id] += mc["weekly_hours"]

        for sp in flex_specs:
            cid     = sp["course_id"]
            allowed = [s for s in sp["allowed_semesters"] if s in mandatory_by_sem]
            if not allowed:
                global_warnings.append(
                    f"Mandatory course {cid}: no valid allowed_semesters "
                    f"in {sp['allowed_semesters']}."
                )
                continue
            # Least-loaded allowed semester (hours tiebreak: count)
            sem_id = min(allowed, key=lambda s: (mandatory_hours[s], len(mandatory_by_sem[s])))
            mc, mc_warns = _load_mandatory_course(cid, db_path, sp)
            global_warnings.extend(mc_warns)
            mandatory_by_sem[sem_id].append(mc)
            mandatory_ids.add(cid)
            if mc.get("weekly_hours") is not None:
                mandatory_hours[sem_id] += mc["weekly_hours"]

    # Filter electives to only courses allowed by program categories
    allowed_ids = _build_allowed_course_ids(program) if program else None
    if allowed_ids is not None:
        courses = [c for c in courses if c["course_id"] in allowed_ids]

    # Electives must not duplicate a mandatory course
    courses = [c for c in courses if c["course_id"] not in mandatory_ids]

    if not courses:
        board = _build_output(
            semesters, {s["id"]: [] for s in semesters}, mandatory_by_sem,
            global_warnings, start_year, {}, {}, {}, db_path,
            cat_map=cat_map,
        )
        board = _annotate_validation(board, completed_course_ids or [])
        if program and program.get("requirements"):
            _annotate_program_requirements(board, program, completed_course_ids or [], db_path=db_path)
        return board

    course_ids = [c["course_id"] for c in courses]

    # Fetch DB info (best-effort — gracefully skipped if DB absent)
    season_prefs    = _fetch_season_prefs(course_ids, db_path)
    # Supplement DB season prefs with offered_semesters from program JSON
    if program:
        for cid, code in _build_season_prefs_from_program(program).items():
            season_prefs.setdefault(cid, code)
    in_plan_prereqs = _fetch_in_plan_prereqs(course_ids, db_path)
    all_prereqs     = _fetch_all_prereqs(course_ids, db_path)

    # Topological sort so prerequisites come first
    sorted_courses, cycle_warnings = _topological_sort(courses, in_plan_prereqs)
    global_warnings.extend(cycle_warnings)

    # Greedy assignment — also returns per-course placement confidence
    assignments, assign_warnings, placement_confidence = _assign_to_semesters(
        sorted_courses, semesters, season_prefs,
        in_plan_prereqs, max_weekly_hours_per_semester,
        initial_hours=mandatory_hours,
    )
    global_warnings.extend(assign_warnings)

    board = _build_output(
        semesters, assignments, mandatory_by_sem,
        global_warnings, start_year,
        all_prereqs, season_prefs, placement_confidence, db_path,
        cat_map=cat_map,
    )
    board = _annotate_validation(board, completed_course_ids or [])
    if program and program.get("requirements"):
        _annotate_program_requirements(board, program, completed_course_ids or [], db_path=db_path)
    return board


# ---------------------------------------------------------------------------
# Mandatory course spec parsing
# ---------------------------------------------------------------------------

def _parse_mandatory_specs(program: dict[str, Any]) -> list[dict[str, Any]]:
    """
    Return an ordered list of mandatory-course placement specs from *program*.

    Reads from two sources (de-duplicated; first-seen wins):
      1. program["requirements"]["mandatory_courses"]["courses"]  — rich format (new)
      2. program["semesters"][*]["mandatory_courses"]             — plain IDs (old)

    Old-format entries are treated as fixed (one allowed semester, locked_by_default=True).

    Each returned spec:
        course_id, allowed_semesters, recommended_semester,
        locked_by_default, placement_rule, needs_verification, source_note
    """
    specs: list[dict[str, Any]] = []
    seen:  set[str]             = set()

    # New rich format: requirements.mandatory_courses.courses (inline or via courses_file)
    reqs      = program.get("requirements", {})
    mand_reqs = reqs.get("mandatory_courses", {}) if isinstance(reqs, dict) else {}
    inline_courses = list(mand_reqs.get("courses", []))
    cfile = mand_reqs.get("courses_file")
    if cfile:
        cfile_path = Path(cfile)
        if cfile_path.exists():
            with cfile_path.open(encoding="utf-8") as _fh:
                _data = json.load(_fh)
            inline_courses = _data.get("courses", inline_courses)
    for mc in inline_courses:
        raw_id = mc.get("course_id", "")
        if not raw_id:
            continue
        cid = normalize_course_id(raw_id)
        if cid in seen:
            continue
        seen.add(cid)
        allowed = [s for s in mc.get("allowed_semesters", []) if s]
        n       = len(allowed)
        specs.append({
            "course_id":           cid,
            "allowed_semesters":   allowed,
            "recommended_semester": mc.get("recommended_semester"),
            "locked_by_default":   mc.get("locked_by_default", n <= 1),
            "placement_rule":      mc.get("placement_rule",
                                          "fixed_semester" if n <= 1
                                          else "choose_one_allowed_semester"),
            "needs_verification":  bool(mc.get("needs_verification", False)),
            "source_note":         mc.get("source_note", ""),
        })

    # Old format: semesters[].mandatory_courses (plain IDs or dicts)
    for sem_entry in program.get("semesters", []):
        sem_id = sem_entry.get("semester_id", "")
        for mc_entry in sem_entry.get("mandatory_courses", []):
            raw_id = mc_entry if isinstance(mc_entry, str) else mc_entry.get("course_id", "")
            if not raw_id:
                continue
            cid = normalize_course_id(raw_id)
            if cid in seen:
                continue
            seen.add(cid)
            specs.append({
                "course_id":           cid,
                "allowed_semesters":   [sem_id] if sem_id else [],
                "recommended_semester": sem_id or None,
                "locked_by_default":   True,
                "placement_rule":      "fixed_semester",
                "needs_verification":  False,
                "source_note":         "",
            })

    return specs


# ---------------------------------------------------------------------------
# Mandatory course loading
# ---------------------------------------------------------------------------

def _load_mandatory_course(
    course_id: str,
    db_path: Path,
    placement_spec: dict[str, Any] | None = None,
) -> tuple[dict[str, Any], list[str]]:
    """
    Look up *course_id* in the DB and return a fully-formatted mandatory-course
    dict plus any global-level warnings (e.g. "not found in DB").

    *placement_spec* carries allowed_semesters, locked_by_default, placement_rule,
    needs_verification, and source_note from the program JSON.
    """
    spec             = placement_spec or {}
    allowed_sems     = spec.get("allowed_semesters", [])
    locked_by_default = spec.get("locked_by_default", True)
    placement_rule   = spec.get("placement_rule", "fixed_semester")
    needs_verif      = bool(spec.get("needs_verification", False))
    source_note      = spec.get("source_note", "")

    global_warns: list[str] = []
    record: dict | None = None

    if db_path.exists():
        try:
            record = get_course_by_id(course_id, db_path)
        except Exception:
            pass

    grade_stats = []
    if db_path.exists():
        try:
            grade_stats = get_grade_stats(course_id, db_path)
        except Exception:
            pass

    if record is None:
        global_warns.append(
            f"Mandatory course {course_id} not found in database."
        )
        return {
            "course_id":                   course_id,
            "name_he":                     None,
            "weekly_hours":                None,
            "difficulty_score":            None,
            "difficulty_level":            None,
            "workload_score":              None,
            "conceptual_complexity_score": None,
            "prerequisite_depth_score":    None,
            "assessment_intensity_score":  None,
            "difficulty_confidence":       None,
            "course_type":                 "mandatory",
            "prerequisites":               [],
            "prerequisite_details":        [],
            "instructor_uncertainty":      estimate_instructor_uncertainty(None, grade_stats),
            "locked_by_user":              locked_by_default,
            "allowed_semesters":           allowed_sems,
            "locked_by_default":           locked_by_default,
            "placement_rule":              placement_rule,
            "needs_verification":          needs_verif,
            "source_note":                 source_note,
            "source":                      "program",
            "data_quality": {
                "has_weekly_hours":     False,
                "has_semester_data":    True,
                "has_difficulty_score": False,
                "placement_confidence": "high",
            },
            "warnings":      ["Course not found in database."],
            "syllabus_url":  None,
            "syllabus_links": [],
            "source_urls":   [],
        }, global_warns

    hours   = _weekly_hours_from_record(record)
    prereqs = [
        normalize_course_id(p)
        for p in record.get("prerequisite_course_ids", [])
    ]
    course_warns: list[str] = []
    if hours is None:
        course_warns.append("Missing weekly hours.")

    # Syllabus URL from DB record
    syllabus_links: list[str] = record.get("syllabus_links") or []
    syllabus_url: str | None = None
    for g in record.get("groups") or []:
        if g.get("syllabus_url"):
            syllabus_url = g["syllabus_url"]
            break
    if not syllabus_url and syllabus_links:
        syllabus_url = syllabus_links[0]

    # Prerequisite details with display names
    prereq_name_map = get_course_display_names(prereqs, db_path) if prereqs else {}
    prerequisite_details = [
        {
            "course_id":   p,
            "name_he":     prereq_name_map.get(p),
            "known_in_db": prereq_name_map.get(p) is not None,
        }
        for p in prereqs
    ]

    return {
        "course_id":                   course_id,
        "name_he":                     record.get("name_he"),
        "weekly_hours":                hours,
        "difficulty_score":            None,
        "difficulty_level":            None,
        "workload_score":              None,
        "conceptual_complexity_score": None,
        "prerequisite_depth_score":    None,
        "assessment_intensity_score":  None,
        "difficulty_confidence":       None,
        "course_type":                 "mandatory",
        "prerequisites":               prereqs,
        "prerequisite_details":        prerequisite_details,
        "instructor_uncertainty":      estimate_instructor_uncertainty(record, grade_stats),
        "locked_by_user":              locked_by_default,
        "allowed_semesters":           allowed_sems,
        "locked_by_default":           locked_by_default,
        "placement_rule":              placement_rule,
        "needs_verification":          needs_verif,
        "source_note":                 source_note,
        "source":                      "program",
        "data_quality": {
            "has_weekly_hours":     hours is not None,
            "has_semester_data":    True,
            "has_difficulty_score": False,
            "placement_confidence": "high",
        },
        "warnings":      course_warns,
        "syllabus_url":  syllabus_url,
        "syllabus_links": syllabus_links,
        "source_urls":   [],
    }, global_warns


def _weekly_hours_from_record(record: dict) -> float | None:
    """Sum lecture + tutorial + lab hours from a DB record; None if all missing."""
    total, found = 0.0, False
    for field in ("lecture_hours", "tutorial_hours", "lab_hours"):
        val = record.get(field)
        if val is not None:
            total += float(val)
            found  = True
    return round(total, 1) if found else None


# ---------------------------------------------------------------------------
# Program filtering helpers
# ---------------------------------------------------------------------------

def _build_allowed_course_ids(program: dict) -> set[str] | None:
    """
    Return the set of normalised course IDs allowed by a program.

    Checks, in order:
      1. program["course_categories"]  — classic explicit list
      2. program["requirements"]       — both classic elective_categories and
                                        new PDF format (core_categories + …)

    Returns None when no allowlist is defined (no filtering applied).
    """
    # --- Classic course_categories key ----------------------------------------
    categories = program.get("course_categories")
    if categories is not None:
        allowed: set[str] = set()
        for cat in categories:
            for cid in cat.get("course_ids", []):
                allowed.add(normalize_course_id(cid))
            fpath_str = cat.get("course_ids_file")
            if fpath_str:
                fpath = Path(fpath_str)
                if fpath.exists():
                    for cid in load_course_ids(fpath):
                        allowed.add(normalize_course_id(cid))
        return allowed

    # --- requirements-based allowlist (classic or PDF format) -----------------
    reqs = program.get("requirements")
    if reqs:
        ids = get_all_program_course_ids(program)
        return ids if ids else None

    return None


def _build_season_prefs_from_program(program: dict) -> dict[str, str]:
    """
    Extract offered_semesters from program.elective_courses and return a
    course_id → season-code ("a"/"b") map to supplement DB-based preferences.
    Only maps courses with exactly one offered semester.
    """
    prefs: dict[str, str] = {}
    for ec in program.get("elective_courses", []):
        cid      = ec.get("course_id")
        offered  = ec.get("offered_semesters", [])
        if cid and len(offered) == 1:
            sem_code = offered[0].lower()  # "A" → "a", "B" → "b"
            if sem_code in ("a", "b"):
                prefs[normalize_course_id(cid)] = sem_code
    return prefs


# ---------------------------------------------------------------------------
# Semester definitions
# ---------------------------------------------------------------------------

def _make_semesters(start_year: int) -> list[dict[str, str]]:
    y = start_year
    return [
        {"id": f"year_{y}_semester_a",   "display_name": f"Year {y} — Semester A",   "season": "a"},
        {"id": f"year_{y}_semester_b",   "display_name": f"Year {y} — Semester B",   "season": "b"},
        {"id": f"year_{y+1}_semester_a", "display_name": f"Year {y+1} — Semester A", "season": "a"},
        {"id": f"year_{y+1}_semester_b", "display_name": f"Year {y+1} — Semester B", "season": "b"},
    ]


# ---------------------------------------------------------------------------
# DB lookups (best-effort)
# ---------------------------------------------------------------------------

def _fetch_season_prefs(course_ids: list[str], db_path: Path) -> dict[str, str | None]:
    """Return course_id → season code ("a"/"b"/None) from the courses table."""
    result: dict[str, str | None] = {cid: None for cid in course_ids}
    if not db_path.exists():
        return result
    for cid in course_ids:
        try:
            record = get_course_by_id(cid, db_path)
            if record:
                result[cid] = _HEBREW_SEASON.get(record.get("semester"))
        except Exception:
            pass
    return result


def _fetch_in_plan_prereqs(course_ids: list[str], db_path: Path) -> dict[str, list[str]]:
    """Return course_id → prerequisite course_ids that are also in the plan."""
    selected_set = set(course_ids)
    result: dict[str, list[str]] = {cid: [] for cid in course_ids}
    if not db_path.exists():
        return result
    for cid in course_ids:
        try:
            raw = get_prerequisites(cid, db_path)
            in_plan = [normalize_course_id(p) for p in raw if normalize_course_id(p) in selected_set]
            result[cid] = in_plan
        except Exception:
            pass
    return result


def _fetch_all_prereqs(course_ids: list[str], db_path: Path) -> dict[str, list[str]]:
    """Return course_id → all prerequisite course_ids (normalized)."""
    result: dict[str, list[str]] = {cid: [] for cid in course_ids}
    if not db_path.exists():
        return result
    for cid in course_ids:
        try:
            raw = get_prerequisites(cid, db_path)
            result[cid] = [normalize_course_id(p) for p in raw]
        except Exception:
            pass
    return result


# ---------------------------------------------------------------------------
# Topological sort (Kahn's algorithm)
# ---------------------------------------------------------------------------

def _topological_sort(
    courses: list[dict], prereq_map: dict[str, list[str]]
) -> tuple[list[dict], list[str]]:
    by_id  = {c["course_id"]: c for c in courses}
    id_set = set(by_id)
    in_deg = {cid: 0 for cid in id_set}
    adj: dict[str, list[str]] = {cid: [] for cid in id_set}

    for cid in id_set:
        for prereq in prereq_map.get(cid, []):
            if prereq in id_set:
                adj[prereq].append(cid)
                in_deg[cid] += 1

    queue   = deque(cid for cid in id_set if in_deg[cid] == 0)
    ordered: list[str] = []

    while queue:
        cid = queue.popleft()
        ordered.append(cid)
        for dep in adj[cid]:
            in_deg[dep] -= 1
            if in_deg[dep] == 0:
                queue.append(dep)

    warnings: list[str] = []
    remaining = [cid for cid in id_set if cid not in set(ordered)]
    if remaining:
        warnings.append(f"Cycle detected among: {remaining}. Affected course(s) placed at end.")
        ordered.extend(remaining)

    return [by_id[cid] for cid in ordered], warnings


# ---------------------------------------------------------------------------
# Greedy semester assignment
# ---------------------------------------------------------------------------

def _assign_to_semesters(
    courses: list[dict],
    semesters: list[dict],
    season_prefs: dict[str, str | None],
    prereq_map: dict[str, list[str]],
    max_hours: float | None,
    initial_hours: dict[str, float] | None = None,
) -> tuple[dict[str, list[dict]], list[str], dict[str, str]]:
    """
    Returns (assignments, warnings, placement_confidence).
    placement_confidence maps course_id → "high" | "medium" | "low".
    *initial_hours* pre-seeds per-semester hour totals (e.g. from mandatory courses).
    """
    course_to_idx: dict[str, int] = {}
    sem_hours  = {s["id"]: (initial_hours or {}).get(s["id"], 0.0) for s in semesters}
    sem_count  = {s["id"]: 0   for s in semesters}
    assignments: dict[str, list[dict]] = {s["id"]: [] for s in semesters}
    placement_confidence: dict[str, str] = {}
    warnings: list[str] = []

    for course in courses:
        cid   = course["course_id"]
        pref  = season_prefs.get(cid)
        hours = course.get("weekly_hours") or 0.0

        # Earliest valid semester index (must come after all in-plan prerequisites)
        min_idx = 0
        for prereq in prereq_map.get(cid, []):
            if prereq in course_to_idx:
                min_idx = max(min_idx, course_to_idx[prereq] + 1)

        placed_idx: int | None = None
        pass_used: int = 0

        # Pass 1: honor season preference + hours budget
        if pref:
            for i in range(min_idx, len(semesters)):
                sem = semesters[i]
                if sem["season"] != pref:
                    continue
                if max_hours is not None and sem_hours[sem["id"]] + hours > max_hours:
                    continue
                placed_idx = i
                pass_used  = 1
                break

        # Pass 2: least-loaded semester (any season) + hours budget
        if placed_idx is None:
            candidates = [
                (sem_hours[semesters[i]["id"]], sem_count[semesters[i]["id"]], i)
                for i in range(min_idx, len(semesters))
                if max_hours is None or sem_hours[semesters[i]["id"]] + hours <= max_hours
            ]
            if candidates:
                candidates.sort()
                placed_idx = candidates[0][2]
                pass_used  = 2
                if pref and semesters[placed_idx]["season"] != pref:
                    warnings.append(
                        f"{cid}: placed outside preferred semester "
                        f"('{pref}') — preferred slot was unavailable."
                    )

        # Pass 3: least-loaded semester ignoring hours limit (last resort)
        if placed_idx is None:
            candidates = [
                (sem_hours[semesters[i]["id"]], sem_count[semesters[i]["id"]], i)
                for i in range(min_idx, len(semesters))
            ]
            if candidates:
                candidates.sort()
                placed_idx = candidates[0][2]
                pass_used  = 3
                warnings.append(
                    f"{cid}: placed in '{semesters[placed_idx]['id']}' "
                    f"despite exceeding the hours budget (no valid slot available)."
                )
            else:
                placed_idx = len(semesters) - 1
                pass_used  = 3
                warnings.append(
                    f"{cid}: could not satisfy prerequisite ordering within 4 semesters; "
                    f"placed in last semester."
                )

        # Placement confidence
        placed_season = semesters[placed_idx]["season"]
        if pass_used == 3:
            confidence = "low"
        elif pref is not None and placed_season == pref:
            confidence = "high"   # had season data, honored it
        elif pref is not None:
            confidence = "medium"  # had season data, could not honor it
        else:
            confidence = "low"    # no season data, placed by least-loaded

        sem_id = semesters[placed_idx]["id"]
        course_to_idx[cid]            = placed_idx
        placement_confidence[cid]     = confidence
        sem_hours[sem_id]            += hours
        sem_count[sem_id]            += 1
        assignments[sem_id].append(course)

    return assignments, warnings, placement_confidence


# ---------------------------------------------------------------------------
# Output builders
# ---------------------------------------------------------------------------

def _build_output(
    semesters: list[dict],
    assignments: dict[str, list[dict]],
    mandatory_by_sem: dict[str, list[dict]],
    global_warnings: list[str],
    start_year: int,
    all_prereqs: dict[str, list[str]],
    season_prefs: dict[str, str | None],
    placement_confidence: dict[str, str],
    db_path: Path = _DB_PATH,
    cat_map: dict[str, dict] | None = None,
) -> dict[str, Any]:
    # Batch-resolve prerequisite display names in one DB round-trip
    all_prereq_ids: set[str] = set()
    for pid_list in all_prereqs.values():
        all_prereq_ids.update(pid_list)
    prereq_name_map: dict[str, str | None] = (
        get_course_display_names(list(all_prereq_ids), db_path)
        if all_prereq_ids else {}
    )

    courses_missing_hours     = 0
    courses_unknown_semester  = 0
    low_confidence_placements = 0

    semester_out = []
    for sem in semesters:
        mandatory = mandatory_by_sem.get(sem["id"], [])
        elective  = assignments.get(sem["id"], [])
        all_placed = mandatory + elective

        hours_list = [c["weekly_hours"] for c in all_placed if c.get("weekly_hours") is not None]
        diff_list  = [c["difficulty_score"] for c in all_placed if c.get("difficulty_score") is not None]
        has_missing_hours = any(c.get("weekly_hours") is None for c in all_placed)

        sem_warnings: list[str] = []
        if has_missing_hours:
            sem_warnings.append("Some courses have unknown weekly hours.")

        courses_out: list[dict] = []

        # Mandatory courses — already fully formatted; add category info if available
        for mc in mandatory:
            if not mc["data_quality"]["has_weekly_hours"]:
                courses_missing_hours += 1
            if cat_map:
                ci = cat_map.get(mc["course_id"])
                mc.setdefault("program_category_id",      ci["category_id"]   if ci else None)
                mc.setdefault("program_category_name_he", ci["name_he"]       if ci else None)
                mc.setdefault("needs_category_review",    ci["needs_review"]  if ci else False)
            courses_out.append(mc)

        # Elective courses — format now
        for c in elective:
            cid               = c["course_id"]
            has_hours         = c.get("weekly_hours") is not None
            has_semester_data = season_prefs.get(cid) is not None
            has_difficulty    = c.get("difficulty_score") is not None
            confidence        = placement_confidence.get(cid, "low")

            if not has_hours:
                courses_missing_hours += 1
            if not has_semester_data:
                courses_unknown_semester += 1
            if confidence == "low":
                low_confidence_placements += 1

            course_warnings: list[str] = []
            if not has_hours:
                course_warnings.append("Missing weekly hours.")
            if not has_semester_data:
                course_warnings.append("Unknown semester availability.")

            data_quality = {
                "has_weekly_hours":     has_hours,
                "has_semester_data":    has_semester_data,
                "has_difficulty_score": has_difficulty,
                "placement_confidence": confidence,
            }
            cat_info = (cat_map or {}).get(cid)
            courses_out.append(
                _format_course(
                    c, all_prereqs.get(cid, []), data_quality, course_warnings,
                    prereq_name_map, cat_info,
                )
            )

        semester_out.append({
            "semester_id":        sem["id"],
            "display_name":       sem["display_name"],
            "courses":            courses_out,
            "total_weekly_hours": round(sum(hours_list), 1) if hours_list else None,
            "average_difficulty": round(sum(diff_list) / len(diff_list), 2) if diff_list else None,
            "warnings":           sem_warnings,
        })

    total_courses = sum(len(s["courses"]) for s in semester_out)
    return {
        "semesters": semester_out,
        "warnings":  global_warnings,
        "metadata":  {"total_courses": total_courses, "start_year": start_year},
        "summary": {
            "total_courses":                total_courses,
            "courses_with_missing_hours":   courses_missing_hours,
            "courses_with_unknown_semester": courses_unknown_semester,
            "low_confidence_placements":    low_confidence_placements,
        },
    }


def _format_course(
    course: dict[str, Any],
    prereqs: list[str],
    data_quality: dict[str, Any],
    course_warnings: list[str],
    prereq_name_map: dict[str, str | None] | None = None,
    cat_info: dict[str, Any] | None = None,
) -> dict[str, Any]:
    # Syllabus URL fallback chain
    syllabus_links = course.get("syllabus_links") or []
    source_urls    = course.get("source_urls") or []
    syllabus_url   = course.get("syllabus_url")
    if not syllabus_url and syllabus_links:
        syllabus_url = syllabus_links[0]
    if not syllabus_url:
        for url in source_urls:
            if "syllabus" in url.lower():
                syllabus_url = url
                break

    _name_map = prereq_name_map or {}
    prerequisite_details = [
        {
            "course_id":   p,
            "name_he":     _name_map.get(p),
            "known_in_db": _name_map.get(p) is not None,
        }
        for p in prereqs
    ]

    return {
        "course_id":                   course["course_id"],
        "name_he":                     course.get("name_he"),
        "weekly_hours":                course.get("weekly_hours"),
        "difficulty_score":            course.get("difficulty_score"),
        "difficulty_level":            course.get("difficulty_level"),
        "workload_score":              course.get("workload_score"),
        "conceptual_complexity_score": course.get("conceptual_complexity_score"),
        "prerequisite_depth_score":    course.get("prerequisite_depth_score"),
        "assessment_intensity_score":  course.get("assessment_intensity_score"),
        "difficulty_confidence":       course.get("difficulty_confidence"),
        "course_type":                 "elective",
        "prerequisites":               prereqs,
        "prerequisite_details":        prerequisite_details,
        "instructor_uncertainty":      course.get("instructor_uncertainty"),
        "locked_by_user":              False,
        "source":                      "auto",
        "data_quality":                data_quality,
        "warnings":                    course_warnings,
        "syllabus_url":                syllabus_url,
        "syllabus_links":              syllabus_links,
        "source_urls":                 source_urls,
        "program_category_id":         cat_info["category_id"]   if cat_info else course.get("program_category_id"),
        "program_category_name_he":    cat_info["name_he"]       if cat_info else course.get("program_category_name_he"),
        "needs_category_review":       cat_info["needs_review"]  if cat_info else course.get("needs_category_review", False),
        "selection_reason":            course.get("selection_reason"),
    }


# ---------------------------------------------------------------------------
# Program requirements post-processing
# ---------------------------------------------------------------------------

def _difficulty_entry_from_estimate(est: dict) -> dict:
    """Extract frontend-relevant difficulty fields from a lightweight estimate dict."""
    return {
        "difficulty_score":              est["final_difficulty_score"],
        "difficulty_level":              est["difficulty_level"],
        "difficulty_confidence":         est["confidence"],
        "workload_score":                est["workload_score"],
        "conceptual_complexity_score":   est["conceptual_complexity_score"],
        "prerequisite_depth_score":      est["prerequisite_depth_score"],
        "assessment_intensity_score":    est["assessment_intensity_score"],
    }


def _build_category_name_map(program: dict[str, Any]) -> dict[str, str]:
    """Return {category_id: name_he} from program requirements."""
    result: dict[str, str] = {}
    reqs = program.get("requirements", {})
    if not isinstance(reqs, dict):
        return result
    for cat in reqs.get("core_categories", []):
        cid = cat.get("category_id")
        if cid:
            result[cid] = cat.get("name_he") or cid
    for key in ("advanced_labs", "other_specialization"):
        cat = reqs.get(key)
        if isinstance(cat, dict):
            cid = cat.get("category_id")
            if cid:
                result[cid] = cat.get("name_he") or cid
    for cat in reqs.get("elective_categories", []):
        cid = cat.get("category_id")
        if cid and cid not in result:
            result[cid] = cat.get("name_he") or cid
    return result


def _build_program_repository_courses(
    program: dict[str, Any],
    db_path: Path = _DB_PATH,
) -> list[dict[str, Any]]:
    """
    Return a flat list of all elective + other-specialization courses defined in
    the program JSON.  Embedded in board.metadata.program_repository_courses so
    the frontend can initialise courseMap without a separate programJson fetch.

    name_he: uses PDF name when available; falls back to DB lookup when null.
    program_category_name_he: resolved from program requirements.
    """
    cat_name_map = _build_category_name_map(program)
    courses: list[dict[str, Any]] = []
    seen: set[str] = set()

    def _resolve_name(cid: str, name_he: str | None) -> str | None:
        if name_he:
            return name_he
        if db_path.exists():
            try:
                record = get_course_by_id(cid, db_path)
                if record:
                    return record.get("name_he")
            except Exception:
                pass
        return None

    for ec in program.get("elective_courses", []):
        cid = ec.get("course_id")
        if not cid or cid in seen:
            continue
        seen.add(cid)
        cat_id = ec.get("category_id")
        hours = ec.get("hours")
        prereq_count = len(ec.get("prerequisites") or [])
        teaching_fmt = ec.get("teaching_format")  # may be set by enrichment
        name = _resolve_name(cid, ec.get("name_he"))

        # Lightweight difficulty estimate — uses hours, prereqs, category, name
        diff: dict = {}
        if hours is not None or prereq_count > 0 or name:
            try:
                est = estimate_difficulty_lightweight(
                    weekly_hours=hours,
                    prereq_count=prereq_count,
                    teaching_format=teaching_fmt,
                    category_id=cat_id,
                    name_he=name,
                )
                diff = _difficulty_entry_from_estimate(est)
            except Exception:
                pass

        courses.append({
            "course_id":                cid,
            "name_he":                  name,
            "weekly_hours":             hours,
            "offered_semesters":        ec.get("offered_semesters", []),
            "offered_in_year":          ec.get("offered_in_year", True),
            "category_id":              cat_id,
            "program_category_name_he": cat_name_map.get(cat_id) if cat_id else None,
            "source":                   "program_json",
            **diff,
        })

    for ec in program.get("other_specialization_electives", []):
        cid = ec.get("course_id")
        if not cid or cid in seen:
            continue
        seen.add(cid)
        cat_id = "other_specialization"
        name = _resolve_name(cid, ec.get("name_he"))
        courses.append({
            "course_id":                cid,
            "name_he":                  name,
            "weekly_hours":             None,
            "offered_semesters":        [],
            "offered_in_year":          ec.get("offered_in_year", True),
            "category_id":              cat_id,
            "program_category_name_he": cat_name_map.get(cat_id),
            "source":                   "program_json",
        })

    return courses


def _annotate_program_requirements(
    board: dict[str, Any],
    program: dict[str, Any],
    completed_course_ids: list[str],
    db_path: Path = _DB_PATH,
) -> None:
    """
    Validate the board against program.requirements and embed results in metadata.

    Adds to board["metadata"]:
        program_requirements_validation  : full validate_program_plan result
        program_requirements_categories  : category definitions for frontend use
        program_repository_courses       : all elective/specialisation courses
    """
    validation    = validate_program_plan(board, program, completed_course_ids)
    frontend_cats = get_program_categories_for_frontend(program)
    repo_courses  = _build_program_repository_courses(program, db_path)

    board.setdefault("metadata", {}).update({
        "program_requirements_validation": validation,
        "program_requirements_categories": frontend_cats,
        "program_repository_courses":      repo_courses,
    })


# ---------------------------------------------------------------------------
# Validation post-processing
# ---------------------------------------------------------------------------

def _annotate_validation(
    board: dict[str, Any],
    completed_course_ids: list[str],
) -> dict[str, Any]:
    """
    Run validate_entire_board() on *board* and embed results per course.

    Adds to each course:
        validation_status : "ok" | "error"
        validation_errors : list of invalid prerequisite course_ids

    Adds to board metadata:
        completed_course_ids : the list passed in (for frontend use)
        board_validation     : {valid, invalid_count}
    """
    validation = validate_entire_board(board, completed_course_ids)
    val_by_course = {r["course_id"]: r for r in validation["course_results"]}

    for sem in board.get("semesters", []):
        for course in sem.get("courses", []):
            cid = course.get("course_id", "")
            vr  = val_by_course.get(cid, {})
            valid = vr.get("valid", True)
            course["validation_status"] = "ok" if valid else "error"
            course["validation_errors"] = (
                vr.get("missing_prerequisites", [])
                + vr.get("prerequisites_scheduled_same_semester", [])
                + vr.get("prerequisites_scheduled_too_late", [])
            )
            # Attach explanation as a warning when invalid
            if not valid:
                explanation = vr.get("explanation", "")
                if explanation and explanation not in course.get("warnings", []):
                    course.setdefault("warnings", []).append(explanation)

    board.setdefault("metadata", {}).update({
        "completed_course_ids": completed_course_ids,
        "board_validation": {
            "valid":          validation["valid"],
            "invalid_count":  validation["summary"]["invalid_placements"],
            "error_count":    validation["summary"]["error_count"],
        },
    })
    return board


# ---------------------------------------------------------------------------
# CLI
# ---------------------------------------------------------------------------

if __name__ == "__main__":
    import argparse

    cli = argparse.ArgumentParser(description="TAU semester board generator")
    cli.add_argument("--plan-json",                required=True, metavar="PATH",
                     help="Path to recommended plan JSON")
    cli.add_argument("--program-json",             default=None,  metavar="PATH",
                     help="Path to program JSON with mandatory courses per semester")
    cli.add_argument("--profile",                  default=None,  metavar="PATH",
                     help="Path to user profile JSON")
    cli.add_argument("--max-weekly-hours-per-sem", type=float,    default=None, metavar="FLOAT",
                     help="Max weekly hours per semester (overrides profile)")
    cli.add_argument("--start-year",               type=int,      default=3,    metavar="N",
                     help="Starting academic year (default: 3)")
    cli.add_argument("--output-json",              default=None,  metavar="PATH",
                     help="Save board to JSON")
    cli.add_argument("--db",                       default=str(_DB_PATH), metavar="PATH",
                     help=f"Database path (default: {_DB_PATH})")
    args = cli.parse_args()

    plan_path = Path(args.plan_json)
    if not plan_path.exists():
        print(f"[error] Plan JSON not found: {plan_path}")
        raise SystemExit(1)

    plan = json.loads(plan_path.read_text(encoding="utf-8"))

    program = None
    if args.program_json:
        prog_path = Path(args.program_json)
        if prog_path.exists():
            program = json.loads(prog_path.read_text(encoding="utf-8"))
            print(f"[board] Program: {program.get('program_name_he') or program.get('program_name', prog_path.name)}")
        else:
            print(f"[warn] Program JSON not found: {prog_path}")

    profile = None
    if args.profile:
        from app.models.user_profile import load_user_profile
        profile = load_user_profile(args.profile)
        print(f"[board] Profile: {profile.profile_name}")

    max_hours_per_sem = (
        args.max_weekly_hours_per_sem if args.max_weekly_hours_per_sem is not None
        else (profile.max_weekly_hours if profile else None)
    )

    completed = list(profile.completed_course_ids) if profile else []

    board = build_semester_board(
        plan                          = plan,
        program                       = program,
        max_weekly_hours_per_semester = max_hours_per_sem,
        start_year                    = args.start_year,
        completed_course_ids          = completed,
        db_path                       = Path(args.db),
    )

    n_total = board["metadata"]["total_courses"]
    print(f"\n[board] {n_total} course(s) across {len(board['semesters'])} semesters "
          f"(start year: {board['metadata']['start_year']})")
    if max_hours_per_sem:
        print(f"        max {max_hours_per_sem}h/semester")

    s = board["summary"]
    print(f"        missing_hours={s['courses_with_missing_hours']}  "
          f"unknown_semester={s['courses_with_unknown_semester']}  "
          f"low_confidence={s['low_confidence_placements']}")
    print()

    for sem in board["semesters"]:
        n = len(sem["courses"])
        if n:
            print(f"  {sem['semester_id']:30s}  {n} course(s)"
                  f"  hours={sem['total_weekly_hours']}"
                  f"  avg_diff={sem['average_difficulty']}")
        else:
            print(f"  {sem['semester_id']:30s}  (empty)")
        for c in sem["courses"]:
            conf   = c["data_quality"]["placement_confidence"]
            name   = c.get("name_he") or ""
            source = c.get("source", "auto")
            flags  = []
            if c.get("locked_by_user"):
                flags.append("locked")
            if not c["data_quality"]["has_weekly_hours"]:
                flags.append("no-hours")
            if not c["data_quality"]["has_semester_data"]:
                flags.append("no-sem-data")
            flag_str = f"  [{', '.join(flags)}]" if flags else ""
            print(f"    - {c['course_id']}  src={source}  conf={conf}{flag_str}"
                  + (f"  {name}" if name else ""))
        for w in sem.get("warnings", []):
            print(f"    [warn] {w}")

    if board["warnings"]:
        print(f"\n  Global warnings ({len(board['warnings'])}):")
        for w in board["warnings"]:
            print(f"    [warn] {w}")

    if args.output_json:
        out = Path(args.output_json)
        out.parent.mkdir(parents=True, exist_ok=True)
        out.write_text(json.dumps(board, ensure_ascii=False, indent=2), encoding="utf-8")
        print(f"\n[board] JSON saved to {out}")

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

from app.database.db import _DB_PATH, get_course_by_id, get_prerequisites
from app.analysis.eligibility_engine import normalize_course_id

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

    # ── Mandatory courses from program JSON ──────────────────────────────────
    mandatory_by_sem: dict[str, list[dict]] = {s["id"]: [] for s in semesters}
    mandatory_hours:  dict[str, float]      = {s["id"]: 0.0 for s in semesters}
    mandatory_ids:    set[str]              = set()

    if program:
        for sem_entry in program.get("semesters", []):
            sem_id = sem_entry.get("semester_id", "")
            if sem_id not in mandatory_by_sem:
                continue
            for mc_id in sem_entry.get("mandatory_courses", []):
                mc, mc_warns = _load_mandatory_course(mc_id, db_path)
                global_warnings.extend(mc_warns)
                mandatory_by_sem[sem_id].append(mc)
                mandatory_ids.add(mc_id)
                if mc.get("weekly_hours") is not None:
                    mandatory_hours[sem_id] += mc["weekly_hours"]

    # Electives must not duplicate a mandatory course
    courses = [c for c in courses if c["course_id"] not in mandatory_ids]

    if not courses:
        return _build_output(
            semesters, {s["id"]: [] for s in semesters}, mandatory_by_sem,
            global_warnings, start_year, {}, {}, {},
        )

    course_ids = [c["course_id"] for c in courses]

    # Fetch DB info (best-effort — gracefully skipped if DB absent)
    season_prefs    = _fetch_season_prefs(course_ids, db_path)
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

    return _build_output(
        semesters, assignments, mandatory_by_sem,
        global_warnings, start_year,
        all_prereqs, season_prefs, placement_confidence,
    )


# ---------------------------------------------------------------------------
# Mandatory course loading
# ---------------------------------------------------------------------------

def _load_mandatory_course(
    course_id: str,
    db_path: Path,
) -> tuple[dict[str, Any], list[str]]:
    """
    Look up *course_id* in the DB and return a fully-formatted mandatory-course
    dict plus any global-level warnings (e.g. "not found in DB").
    """
    global_warns: list[str] = []
    record: dict | None = None

    if db_path.exists():
        try:
            record = get_course_by_id(course_id, db_path)
        except Exception:
            pass

    if record is None:
        global_warns.append(
            f"Mandatory course {course_id} not found in database."
        )
        return {
            "course_id":        course_id,
            "name_he":          None,
            "weekly_hours":     None,
            "difficulty_score": None,
            "difficulty_level": None,
            "course_type":      "mandatory",
            "prerequisites":    [],
            "locked_by_user":   True,
            "source":           "program",
            "data_quality": {
                "has_weekly_hours":     False,
                "has_semester_data":    True,
                "has_difficulty_score": False,
                "placement_confidence": "high",
            },
            "warnings": ["Course not found in database."],
        }, global_warns

    hours   = _weekly_hours_from_record(record)
    prereqs = [
        normalize_course_id(p)
        for p in record.get("prerequisite_course_ids", [])
    ]
    course_warns: list[str] = []
    if hours is None:
        course_warns.append("Missing weekly hours.")

    return {
        "course_id":        course_id,
        "name_he":          record.get("name_he"),
        "weekly_hours":     hours,
        "difficulty_score": None,
        "difficulty_level": None,
        "course_type":      "mandatory",
        "prerequisites":    prereqs,
        "locked_by_user":   True,
        "source":           "program",
        "data_quality": {
            "has_weekly_hours":     hours is not None,
            "has_semester_data":    True,
            "has_difficulty_score": False,
            "placement_confidence": "high",
        },
        "warnings": course_warns,
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
) -> dict[str, Any]:
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

        # Mandatory courses — already fully formatted by _load_mandatory_course
        for mc in mandatory:
            if not mc["data_quality"]["has_weekly_hours"]:
                courses_missing_hours += 1
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
            courses_out.append(
                _format_course(c, all_prereqs.get(cid, []), data_quality, course_warnings)
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
) -> dict[str, Any]:
    return {
        "course_id":        course["course_id"],
        "name_he":          course.get("name_he"),
        "weekly_hours":     course.get("weekly_hours"),
        "difficulty_score": course.get("difficulty_score"),
        "difficulty_level": course.get("difficulty_level"),
        "course_type":      "elective",
        "prerequisites":    prereqs,
        "locked_by_user":   False,
        "source":           "auto",
        "data_quality":     data_quality,
        "warnings":         course_warnings,
    }


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
            print(f"[board] Program: {program.get('program_name', prog_path.name)}")
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

    board = build_semester_board(
        plan                          = plan,
        program                       = program,
        max_weekly_hours_per_semester = max_hours_per_sem,
        start_year                    = args.start_year,
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

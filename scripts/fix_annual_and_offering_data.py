"""
Targeted, idempotent data fixes for mechanical_semester_board_2027.json.

Fixes three mandatory year-3 mechanical-engineering courses whose offering /
annual representation was wrong (root causes documented inline):

  0542-3780 "תהליכי עיבוד (1)"        -> Semester B only (offering parser wrongly
                                          recorded offered_semesters=['A'];
                                          syllabus runs Friday 08:00-11:00 in B).
  0542-3791 "תהליכי עיבוד - מעבדה"     -> Semester B only (same root cause).
  0542-3792 "הנדסת ניסויים ומדידות -   -> ANNUAL (year-long) spanning A+B. Syllabus
             מעבדה"                      says "החל משנת תשפ\"ו זהו קורס שנתי" and the
                                          lab meets weekly in BOTH semesters. It was
                                          modelled as a free one-semester course.

This board JSON is the LOCAL static source-of-truth (NOT Supabase board_json).
The build pipeline's --build step only refreshes metadata.board_data_version;
it does NOT regenerate semesters/placement, so these edits are not clobbered by
a rebuild. (--sync pushes this same file to Supabase; run after this fix.)

Idempotent: re-running produces no further change.

Usage:
    python3 scripts/fix_annual_and_offering_data.py data/parsed_json/mechanical_semester_board_2027.json
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

SEM_A = "year_3_semester_a"
SEM_B = "year_3_semester_b"
SEM_4A = "year_4_semester_a"


def _find_course(board: dict, cid: str):
    """Return (semester_id_or_None, course_dict) list of all records for cid."""
    found = []
    for sem in board.get("semesters", []):
        for c in sem.get("courses", []):
            if c.get("course_id") == cid:
                found.append((sem.get("semester_id"), c, sem))
    for c in board.get("metadata", {}).get("program_repository_courses", []):
        if c.get("course_id") == cid:
            found.append((None, c, None))
    return found


def _set_semester_b_only(board: dict, cid: str) -> None:
    """Fix a course to be offered/placed in Semester B only."""
    records = _find_course(board, cid)
    if not records:
        print(f"  WARN: {cid} not found")
        return
    for sem_id, c, sem in records:
        c["offered_semesters"] = ["B"]
        c["effective_allowed_semesters"] = [SEM_B]
        c["offering_source_confidence"] = "high"
        # Only one legal (effective) semester exists, so the course is effectively
        # pinned to it: mark placement_policy='fixed' so the planner/repair never
        # treats it as a freely movable flexible course.
        c["placement_policy"] = "fixed"
        # recommended_semester was stale (year_3_semester_a) and conflicted with the
        # corrected effective set. effective wins; align recommended to B as well.
        if c.get("recommended_semester") and c["recommended_semester"] not in (SEM_B,):
            c["recommended_semester"] = SEM_B
        c["offering_correction_note"] = (
            "Corrected to Semester B only: syllabus evidence (Friday class) shows "
            "this course is offered in Semester B; the parsed offered_semesters=['A'] "
            "was wrong. effective_allowed_semesters wins over recommended_semester."
        )
        # program_allowed_semesters / allowed_semesters stay as the broader nominal set.
        # recommended_semester may remain but effective wins.

    # Ensure the course is physically placed in Semester B (move from A if needed).
    _move_to_semester(board, cid, SEM_B)


def _move_to_semester(board: dict, cid: str, target_sem_id: str) -> None:
    course_obj = None
    for sem in board.get("semesters", []):
        remaining = []
        for c in sem.get("courses", []):
            if c.get("course_id") == cid and sem.get("semester_id") != target_sem_id:
                course_obj = c  # pull it out of the wrong semester
            else:
                remaining.append(c)
        sem["courses"] = remaining
    # Place it (if it was somewhere else) into the target semester, if not already there.
    target = next((s for s in board.get("semesters", []) if s.get("semester_id") == target_sem_id), None)
    if target is None:
        print(f"  WARN: target semester {target_sem_id} not found for {cid}")
        return
    already = any(c.get("course_id") == cid for c in target.get("courses", []))
    if course_obj is not None and not already:
        target.setdefault("courses", []).append(course_obj)


def _make_annual(board: dict, cid: str) -> None:
    """Mark a course as annual spanning A+B; place it in BOTH semesters
    (degree hours counted once, load counted in each)."""
    records = _find_course(board, cid)
    if not records:
        print(f"  WARN: {cid} not found")
        return
    # Canonical record (prefer a placed one).
    canonical = next((c for sem_id, c, sem in records if sem_id is not None), records[0][1])
    weekly = canonical.get("weekly_hours") or 0
    annual_fields = {
        "is_annual": True,
        "spans_semesters": [SEM_A, SEM_B],
        "count_hours_once": True,
        # Both placements share this course_id (buildCourseProfiles merges same-
        # course_id placements into one CourseProfile), so the root is the id itself.
        "root_course_id": cid,
        "semester_load_hours_by_semester": {SEM_A: weekly, SEM_B: weekly},
        "placement_policy": "annual",
        "annual_note": (
            'קורס שנתי (החל משנת תשפ"ו): המעבדה מתקיימת מדי שבוע בשני הסמסטרים '
            "(א'+ב'). שעות התואר נספרות פעם אחת; העומס השבועי נספר בכל סמסטר בנפרד."
        ),
        # effective_allowed_semesters stays [A,B] but model treats it as a span.
        "effective_allowed_semesters": [SEM_A, SEM_B],
        "offered_semesters": ["A", "B"],
        "offering_source_confidence": "high",
    }
    for sem_id, c, sem in records:
        c.update(annual_fields)

    # Ensure the annual course is physically present in BOTH semesters.
    placed = {sem_id for sem_id, c, sem in records if sem_id is not None}
    for target_sem_id in (SEM_A, SEM_B):
        if target_sem_id in placed:
            continue
        target = next((s for s in board.get("semesters", []) if s.get("semester_id") == target_sem_id), None)
        if target is None:
            continue
        clone = json.loads(json.dumps(canonical))  # deep copy
        clone.update(annual_fields)
        target.setdefault("courses", []).append(clone)


def _align_recommended_to_effective(board: dict, cid: str) -> None:
    """When a course's offering is already correct but recommended_semester is stale
    and contradicts a SINGLE-semester effective_allowed_semesters, align recommended
    to the effective semester (actual offering wins) and pin placement_policy='fixed'
    since only one legal semester exists. Idempotent; no offering data is changed."""
    records = _find_course(board, cid)
    if not records:
        print(f"  WARN: {cid} not found")
        return
    for sem_id, c, sem in records:
        eff = c.get("effective_allowed_semesters") or []
        if len(eff) != 1:
            print(f"  SKIP: {cid} effective is not single-semester ({eff})")
            continue
        only = eff[0]
        if c.get("recommended_semester") != only:
            c["recommended_semester"] = only
        c["placement_policy"] = "fixed"
        c.setdefault("offering_correction_note",
            "recommended_semester was stale and conflicted with the single "
            "effective_allowed_semesters; aligned to actual offering (effective wins).")


def _fix_4223_semester_a_only(board: dict) -> None:
    """0542-4223 'מבוא לאלמנטים סופיים' — the ONLY hard fact from the syllabus is
    that it is offered in Semester A (never Semester B). Root cause of the live
    bug: it is a repository course with offered_semesters=['A'] but
    effective_allowed_semesters=None, so legality fell back to the broader
    program set and the planner placed it in Semester B.

    Year determination (evidence-based, NOT from the 42xx number):
      - No program/enriched file carries an explicit year or allowed-semester
        restriction for it (all year/allowed fields are None).
      - Prerequisite chain (mechanical_electives_audit.json): 4223 requires
        0542-4224 'אלמנטים סופיים (2)', which in turn requires 'אלמנטים סופיים (1)'.
        So it sits LATE in the FEM chain and is prerequisite-gated.
      - NO course depends on 0542-4223 (it is a leaf — no dependents), so
        constraining it to a late year does not block any downstream FEM path.
    Conclusion: there is NO explicit evidence it is Year-4-only. The correct
    model is a Semester-A elective allowed in either year_3_semester_a or
    year_4_semester_a, with the *actual* year gated by prerequisites at planning
    time. We therefore keep it FLEXIBLE across the two Semester-A slots and only
    remove Semester B (the real, evidence-backed correction).

    Idempotent; LOCAL data only. No offering hours change."""
    records = _find_course(board, "0542-4223")
    if not records:
        print("  WARN: 0542-4223 not found")
        return
    for sem_id, c, sem in records:
        c["offered_semesters"] = ["A"]
        # Semester A only, but either academic year (prereqs gate feasibility).
        c["effective_allowed_semesters"] = [SEM_A, SEM_4A]
        # Recommended later in the path (deep in the FEM chain, no dependents),
        # but year_3_semester_a remains legal for a student who finished the
        # prerequisite chain early. recommended ∈ effective, so no audit conflict.
        c["recommended_semester"] = SEM_4A
        # More than one legal semester (A in two years) → genuinely flexible.
        c["placement_policy"] = "flexible"
        c["offering_source_confidence"] = "high"
        c.setdefault("offering_correction_note",
            "Corrected to Semester A only (either year): offered_semesters=['A'] "
            "but effective_allowed_semesters was None, so legality fell back to "
            "the broader program set and the planner could place it in Semester "
            "B. Set effective_allowed_semesters=[year_3_semester_a, "
            "year_4_semester_a] (Semester A in either year, prerequisite-gated); "
            "Semester B is now illegal. No explicit evidence justifies pinning to "
            "year 4 only, so placement_policy stays flexible.")


def _resolve_robotics_lab_prereq(board: dict) -> None:
    """0542-4624 'מעבדה ברובוטיקה ובקרה של מערכות' — Issue 4. Its prerequisite
    'מבוא לרובוטיקה' is listed in syllabus_prerequisites_he but was never resolved
    to a course_id, so prerequisites/missing_prerequisites were empty and the
    planner could propose the lab without its prerequisite.

    Resolve the intro-robotics course by NAME ('מבוא לרובוטיקה') — expected
    0542-4621 — and record it on the board record so the prerequisite-union
    validator (prerequisites ∪ missing_prerequisites) enforces it. Idempotent;
    LOCAL data only."""
    LAB_ID = "0542-4624"
    INTRO_NAME = "מבוא לרובוטיקה"

    # Resolve intro-robotics by name match across the whole board (any semester
    # or the program repository). Falls back to the known id if not found.
    intro_id = None
    for sem in board.get("semesters", []):
        for c in sem.get("courses", []):
            if (c.get("name_he") or "").strip() == INTRO_NAME:
                intro_id = c.get("course_id")
                break
        if intro_id:
            break
    if not intro_id:
        for c in board.get("metadata", {}).get("program_repository_courses", []):
            if (c.get("name_he") or "").strip() == INTRO_NAME:
                intro_id = c.get("course_id")
                break
    if not intro_id:
        intro_id = "0542-4621"
        print(f"  WARN: could not resolve '{INTRO_NAME}' by name; using known id {intro_id}")

    records = _find_course(board, LAB_ID)
    if not records:
        print(f"  WARN: {LAB_ID} not found")
        return
    for sem_id, c, sem in records:
        # Union onto BOTH fields the validator reads (prerequisites ∪
        # missing_prerequisites). Keep existing entries; add intro_id once.
        prereqs = [p for p in (c.get("prerequisites") or []) if p]
        missing = [p for p in (c.get("missing_prerequisites") or []) if p]
        if intro_id not in prereqs:
            prereqs.append(intro_id)
        if intro_id not in missing:
            missing.append(intro_id)
        c["prerequisites"] = prereqs
        c["missing_prerequisites"] = missing
        c.setdefault("prereq_resolution_note",
            f"Issue 4: resolved syllabus prerequisite '{INTRO_NAME}' to {intro_id} "
            f"(matched by name_he); recorded on prerequisites + missing_prerequisites "
            f"so the planner enforces it.")
    print(f"  resolved {LAB_ID} prerequisite -> {intro_id}")


# ──────────────────────────────────────────────────────────────────────────
# Repository-elective offering-data population (Step 2 of the mass-removal fix).
#
# 31 repository (unplaced) electives carried NO confident
# effective_allowed_semesters, so validateFinalPlan blocked any plan that placed
# them (`missing_offering_data`) and the deterministic fill collapsed into mass
# removals. We resolve their offering ONLY from concrete evidence:
#   * board.offered_semesters half-letter codes ("A"/"B")  -> 15 courses
#   * per-course parsed_json files (offered_semesters in Hebrew א'/ב')  -> 16 courses
# Each entry's `halves` is the evidence-backed set of offered halves (A and/or B).
# The academic YEAR is NOT determined by evidence for repository electives, so a
# half maps to BOTH the year-3 and year-4 slot of that half; with >=2 legal
# semesters the course stays placement_policy='flexible' (per the task spec:
# 'fixed' only when a SINGLE legal semester is known). 24 further electives had
# genuinely no offering evidence and are intentionally left UNKNOWN (untouched).
#
# LOCAL data only. Idempotent: re-running writes the same values.
_HALF_TO_SEMS = {
    "A": [SEM_A, SEM_4A],                    # year_3_semester_a, year_4_semester_a
    "B": ["year_3_semester_b", "year_4_semester_b"],
}

# course_id -> {"halves": [...], "source": "...", "confidence": "high"}
_REPOSITORY_OFFERING_RESOLUTION = {
    "0542-4120": {"halves": ["A"], "source": "board.offered_semesters", "confidence": "high"},
    "0542-4123": {"halves": ["B"], "source": "board.offered_semesters", "confidence": "high"},
    "0542-4320": {"halves": ["B"], "source": "board.offered_semesters", "confidence": "high"},
    "0542-4352": {"halves": ["A"], "source": "board.offered_semesters", "confidence": "high"},
    "0542-4220": {"halves": ["A"], "source": "board.offered_semesters", "confidence": "high"},
    "0542-4221": {"halves": ["B"], "source": "board.offered_semesters", "confidence": "high"},
    "0542-4224": {"halves": ["B"], "source": "board.offered_semesters", "confidence": "high"},
    "0542-4420": {"halves": ["A"], "source": "board.offered_semesters", "confidence": "high"},
    "0542-4422": {"halves": ["A"], "source": "board.offered_semesters", "confidence": "high"},
    "0542-4455": {"halves": ["B"], "source": "board.offered_semesters", "confidence": "high"},
    "0542-4622": {"halves": ["B"], "source": "board.offered_semesters", "confidence": "high"},
    "0542-4391": {"halves": ["A"], "source": "board.offered_semesters", "confidence": "high"},
    "0542-4624": {"halves": ["B"], "source": "board.offered_semesters", "confidence": "high"},
    "0581-4131": {"halves": ["A"], "source": "board.offered_semesters", "confidence": "high"},
    "0542-4094": {"halves": ["B"], "source": "board.offered_semesters", "confidence": "high"},
    "0542-4125": {"halves": ["A"], "source": "parsed_json/course_05424125_2025.json", "confidence": "high"},
    "0542-4425": {"halves": ["B"], "source": "parsed_json/course_05424425_2025.json", "confidence": "high"},
    "0542-4524": {"halves": ["A"], "source": "parsed_json/course_05424524_2025.json", "confidence": "high"},
    "0542-4722": {"halves": ["B"], "source": "parsed_json/course_05424722_2025.json", "confidence": "high"},
    "0509-4010": {"halves": ["B"], "source": "parsed_json/course_05094010_2025.json", "confidence": "high"},
    "0512-1203": {"halves": ["B"], "source": "parsed_json/course_05121203_2025.json", "confidence": "high"},
    "0512-2508": {"halves": ["A", "B"], "source": "parsed_json/course_05122508_2025.json", "confidence": "high"},
    "0512-4200": {"halves": ["A", "B"], "source": "parsed_json/course_05124200_2025.json", "confidence": "high"},
    "0512-4362": {"halves": ["A"], "source": "parsed_json/course_05124362_2025.json", "confidence": "high"},
    "0512-4700": {"halves": ["B"], "source": "parsed_json/course_05124700_2025.json", "confidence": "high"},
    "0512-4702": {"halves": ["A"], "source": "parsed_json/course_05124702_2025.json", "confidence": "high"},
    "0571-1818": {"halves": ["B"], "source": "parsed_json/course_05711818_2025.json", "confidence": "high"},
    "0571-3802": {"halves": ["B"], "source": "parsed_json/course_05713802_2025.json", "confidence": "high"},
    "0571-4174": {"halves": ["A"], "source": "parsed_json/course_05714174_2025.json", "confidence": "high"},
    "0542-4011": {"halves": ["A"], "source": "parsed_json/course_05424011_2025.json", "confidence": "high"},
    "0542-4012": {"halves": ["B"], "source": "parsed_json/course_05424012_2025.json", "confidence": "high"},
    # Sourced from the LIVE TAU syllabus pages (ims.tau.ac.il/Tal/Syllabus), which
    # explicitly state the offering semester ("סמסטר א'/ב' תשפ\"ו"):
    "0542-4226": {"halves": ["B"], "source": "tau_syllabus:Syllabus_L.aspx?course=0542422602&year=2025 (סמסטר ב')", "confidence": "high"},
    "0542-4621": {"halves": ["A"], "source": "tau_syllabus:Syllabus_L.aspx?course=0542462101&year=2025 (סמסטר א')", "confidence": "high"},
    "0542-4559": {"halves": ["A"], "source": "tau_syllabus:Syllabus_L.aspx?course=0542455902&year=2025 (סמסטר א')", "confidence": "high"},
}


def _populate_repository_offering_data(board: dict) -> None:
    """Populate offered_semesters / effective_allowed_semesters /
    offering_source_confidence for the 31 evidence-resolved repository electives.
    Idempotent; only the listed courses' offering fields are touched. Courses not
    in the resolution map are left UNKNOWN (untouched)."""
    resolved = 0
    for cid, info in _REPOSITORY_OFFERING_RESOLUTION.items():
        records = _find_course(board, cid)
        if not records:
            print(f"  WARN: {cid} not found")
            continue
        halves = info["halves"]
        eff = []
        for h in halves:
            eff.extend(_HALF_TO_SEMS[h])
        eff = list(dict.fromkeys(eff))  # stable de-dup
        for sem_id, c, sem in records:
            c["offered_semesters"] = list(halves)
            c["effective_allowed_semesters"] = eff
            c["offering_source_confidence"] = info["confidence"]
            c["offering_source_url"] = info["source"]
            # >=2 legal semesters (year undetermined) -> genuinely flexible.
            # placement_policy='fixed' is reserved for a SINGLE legal semester.
            if len(eff) == 1:
                c["placement_policy"] = "fixed"
                if c.get("recommended_semester") not in (None, eff[0]):
                    c["recommended_semester"] = eff[0]
            else:
                if c.get("placement_policy") in (None, "", "elective"):
                    c["placement_policy"] = "flexible"
                if c.get("recommended_semester") and c["recommended_semester"] not in eff:
                    c["recommended_semester"] = eff[0]
            c.setdefault("offering_correction_note",
                f"Step 2 (mass-removal fix): populated offering from {info['source']} "
                f"(offered halves {halves}); effective_allowed_semesters={eff}. "
                "Was previously missing, which blocked any plan placing it "
                "(missing_offering_data). program_allowed_semesters is NOT used for "
                "final legality.")
        resolved += 1
    print(f"  populated offering data for {resolved}/{len(_REPOSITORY_OFFERING_RESOLUTION)} repository electives")


def _recompute_semester_hours(board: dict) -> None:
    """Recompute total_weekly_hours per semester from the (now-correct) placement.
    Annual courses contribute their weekly load to EACH spanned semester (they are
    physically present in both), which is the desired LOAD behaviour."""
    for sem in board.get("semesters", []):
        total = sum(c.get("weekly_hours") or 0 for c in sem.get("courses", []))
        sem["total_weekly_hours"] = total


def main() -> int:
    board_path = Path(sys.argv[1])
    board = json.loads(board_path.read_text(encoding="utf-8"))

    print("Fixing 0542-3780 -> Semester B only")
    _set_semester_b_only(board, "0542-3780")
    print("Fixing 0542-3791 -> Semester B only")
    _set_semester_b_only(board, "0542-3791")
    print("Fixing 0542-3792 -> annual (A+B)")
    _make_annual(board, "0542-3792")
    print("Aligning 0542-4020 recommended_semester -> effective (year_4_semester_b)")
    _align_recommended_to_effective(board, "0542-4020")
    print("Fixing 0542-4223 -> Semester A only (year_3_a / year_4_a, flexible)")
    _fix_4223_semester_a_only(board)
    print("Resolving 0542-4624 robotics-lab prerequisite -> intro robotics")
    _resolve_robotics_lab_prereq(board)
    print("Populating offering data for evidence-resolved repository electives")
    _populate_repository_offering_data(board)

    _recompute_semester_hours(board)

    board_path.write_text(json.dumps(board, ensure_ascii=False, indent=2), encoding="utf-8")
    print("Done. Wrote", board_path)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

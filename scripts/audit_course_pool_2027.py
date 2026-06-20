#!/usr/bin/env python3
"""
Comprehensive data audit for Mechanical Engineering 2027 course pool.

Reads all available data sources and produces a per-course audit table
explaining exactly why each course is schedulable or not.

Output: data/import_reports/data_audit_mechanical_2027.{json,csv}

DO NOT modify production data — read-only audit only.
"""

import json, csv, re, os, sys
from pathlib import Path
from typing import Optional

ROOT = Path(__file__).resolve().parent.parent
BOARD_BACKUP    = ROOT / "supabase_board_backup_2027_pre_sync.json"
PARSED_DIR      = ROOT / "data" / "parsed_json"
PROGRAMS_DIR    = ROOT / "data" / "programs"
SHAAR_RUACH     = ROOT / "data" / "general_courses_shaar_ruach.json"
OUT_DIR         = ROOT / "data" / "import_reports"
OUT_DIR.mkdir(exist_ok=True)

# ── COURSE_DATA_OVERRIDES from semester_board_viewer.html ─────────────────────
# These are the client-side corrections applied at runtime.
COURSE_DATA_OVERRIDES = {
    '0542-4220': ['B'],
    '0509-4010': ['B'],
    '0512-1203': ['B'],
    '0512-2508': ['A', 'B'],
    '0512-4200': ['A', 'B'],
    '0512-4362': ['A'],
    '0512-4700': ['B'],
    '0512-4702': ['A'],
    '0542-4011': ['A'],
    '0542-4012': ['B'],
    '0542-4125': ['A'],
    '0542-4425': ['B'],
    '0542-4524': ['A'],
    '0542-4722': ['B'],
    '0571-1818': ['B'],
    '0571-3802': ['B'],
    '0571-4174': ['A'],
}

# Hebrew semester character → letter code
HE_SEM_MAP = {
    'א': 'A',   # א
    'ב': 'B',   # ב
}

def normalize_id(raw: str) -> str:
    """'05424220' → '0542-4220'"""
    raw = raw.strip()
    if '-' in raw:
        return raw
    if len(raw) == 8:
        return raw[:4] + '-' + raw[4:]
    return raw

def he_sem_to_letter(s: str) -> Optional[str]:
    """'ב'' → 'B', 'א'' → 'A', None if unknown."""
    if not s:
        return None
    # Find first Hebrew aleph/bet character
    for ch in s:
        if ch in HE_SEM_MAP:
            return HE_SEM_MAP[ch]
    return None

def semesters_from_raw_json(course_obj: dict) -> list[str]:
    """Extract semester letters from raw course JSON (semesters array or semester string)."""
    results = set()
    for field in ('semesters', 'semester'):
        val = course_obj.get(field)
        if not val:
            continue
        if isinstance(val, list):
            for v in val:
                ltr = he_sem_to_letter(str(v))
                if ltr:
                    results.add(ltr)
        elif isinstance(val, str):
            ltr = he_sem_to_letter(val)
            if ltr:
                results.add(ltr)
    return sorted(results)

def load_merged(course_id: str) -> Optional[dict]:
    safe = course_id.replace('-', '')
    p = PARSED_DIR / f"merged_course_{safe}_2025.json"
    if p.exists():
        return json.loads(p.read_text(encoding='utf-8'))
    return None

def load_raw(course_id: str) -> Optional[dict]:
    safe = course_id.replace('-', '')
    p = PARSED_DIR / f"course_{safe}_2025.json"
    if p.exists():
        return json.loads(p.read_text(encoding='utf-8'))
    return None

def load_syllabus(course_id: str) -> Optional[dict]:
    safe = course_id.replace('-', '')
    p = PARSED_DIR / f"syllabus_{safe}_2025_01.json"
    if p.exists():
        return json.loads(p.read_text(encoding='utf-8'))
    return None

def main():
    # ── Load board backup ──────────────────────────────────────────────────────
    board = json.loads(BOARD_BACKUP.read_text(encoding='utf-8'))

    # Mandatory courses already on the board (semester A/B fixed by program)
    board_courses = {}
    for sem in board.get('semesters', []):
        for c in sem.get('courses', []):
            board_courses[c['course_id']] = {
                **c,
                '_semester_id': sem['semester_id'],
            }

    # Elective pool from program_repository_courses
    repo_courses = board.get('metadata', {}).get('program_repository_courses', [])
    repo_by_id   = {c['course_id']: c for c in repo_courses}

    # All course IDs to audit = board mandatory + repo electives
    all_ids = sorted(set(list(board_courses.keys()) + list(repo_by_id.keys())))

    # courseMap IDs (what the planner can see)
    planner_course_ids = set(all_ids)

    # ── Shaar ruach (not engineering electives — listed separately) ───────────
    sr_data = json.loads(SHAAR_RUACH.read_text(encoding='utf-8'))
    shaar_ruach_ids = {c['course_id'] for c in sr_data.get('courses', [])}

    print(f"Board mandatory courses:   {len(board_courses)}")
    print(f"Repo elective courses:     {len(repo_by_id)}")
    print(f"Shaar ruach courses:       {len(shaar_ruach_ids)}")
    print(f"Total course IDs audited:  {len(all_ids)}")
    print()

    rows = []

    for cid in all_ids:
        bc  = board_courses.get(cid)   # mandatory board entry (if any)
        rc  = repo_by_id.get(cid)      # repo entry (if any)

        # ── Source presence ────────────────────────────────────────────────────
        merged   = load_merged(cid)
        raw      = load_raw(cid)
        syllabus = load_syllabus(cid)

        has_board_obj    = bc is not None
        has_repo_obj     = rc is not None
        has_merged_json  = merged is not None
        has_raw_json     = raw    is not None
        has_syllabus_json = syllabus is not None

        src = rc if rc else bc
        if not src:
            continue  # shouldn't happen

        # ── Basic metadata ─────────────────────────────────────────────────────
        name_he        = src.get('name_he') or ''
        category_id    = src.get('category_id') or (bc.get('program_category_id') if bc else '') or ''
        weekly_hours   = src.get('weekly_hours') or (bc.get('weekly_hours') if bc else None)
        syllabus_url   = src.get('syllabus_url') or (bc.get('syllabus_url') if bc else '') or ''
        has_syllabus_url = bool(syllabus_url)
        has_syllabus_text = bool(src.get('syllabus_text_available') or (bc and bc.get('syllabus_text_available')))

        # ── Semester data audit ────────────────────────────────────────────────
        # Source A: Supabase (board/repo offered_semesters)
        supabase_offered = list(src.get('offered_semesters') or [])
        supabase_effective = list(src.get('effective_allowed_semesters') or [])
        if bc:
            # Mandatory board courses have allowed_semesters (fixed)
            allowed = list(bc.get('allowed_semesters') or [])
            supabase_effective = supabase_effective or allowed

        # Source B: merged JSON semester field
        merged_semester = ''
        merged_semester_letter = ''
        if merged:
            ms = merged.get('semester') or ''
            merged_semester = ms
            merged_semester_letter = he_sem_to_letter(ms) or ''

        # Source C: raw course JSON semesters array
        raw_semesters = []
        if raw:
            raw_semesters = semesters_from_raw_json(raw)

        # Source D: COURSE_DATA_OVERRIDES (client-side patch)
        override_semesters = COURSE_DATA_OVERRIDES.get(cid, [])
        has_override = bool(override_semesters)

        # ── Determine effective semester after all sources ─────────────────────
        # Priority: override > supabase > merged > raw
        if override_semesters:
            effective_semester = override_semesters
            semester_source = 'COURSE_DATA_OVERRIDES (client-side patch)'
        elif supabase_effective:
            effective_semester = supabase_effective
            semester_source = 'supabase:effective_allowed_semesters'
        elif supabase_offered:
            effective_semester = supabase_offered
            semester_source = 'supabase:offered_semesters'
        elif merged_semester_letter:
            effective_semester = [merged_semester_letter]
            semester_source = 'merged_json:semester'
        elif raw_semesters:
            effective_semester = raw_semesters
            semester_source = 'raw_json:semesters'
        else:
            effective_semester = []
            semester_source = ''

        semester_in_any_source = bool(effective_semester)

        # Is the semester correctly reflected in the app?
        # (i.e., is there a final effective semester after overrides?)
        # For board mandatory: always yes (fixed semester)
        if has_board_obj and not has_repo_obj:
            # Mandatory course, semester is fixed by allowed_semesters
            app_offered_semesters  = list(bc.get('allowed_semesters') or [])
            app_effective_semesters = app_offered_semesters
            semester_in_app = True
        else:
            # After applying COURSE_DATA_OVERRIDES
            if override_semesters:
                app_offered_semesters   = override_semesters
                app_effective_semesters = override_semesters  # normalizeLegalSemesterIds maps these
                semester_in_app = True
            elif supabase_offered:
                app_offered_semesters   = supabase_offered
                app_effective_semesters = supabase_offered
                semester_in_app = True
            else:
                app_offered_semesters   = []
                app_effective_semesters = []
                semester_in_app = False

        # ── Semester classification ────────────────────────────────────────────
        # Does a source have semester that's NOT in app?
        semester_in_source_not_app = (
            semester_in_any_source and not semester_in_app
        )

        # ── Prerequisite audit ────────────────────────────────────────────────
        # Supabase repo doesn't have prerequisite_course_ids field; get from merged
        merged_prereq_ids = []
        prereq_raw_text   = ''
        if merged:
            raw_ids = merged.get('prerequisite_course_ids') or []
            merged_prereq_ids = [normalize_id(p) for p in raw_ids if p]
            prereq_raw_text = merged.get('prerequisites_raw_text') or ''

        supabase_prereq_text = list(src.get('syllabus_prerequisites_he') or [])

        # Split prereqs into two groups:
        # - MANDATORY board prereqs → always placed (year 3/4 mandatory) → satisfied
        # - REPO elective prereqs → need scheduling before this course → real constraint
        # - NOT in map at all → foundational year 1/2 → assumed completed
        prereqs_mandatory_board = [p for p in merged_prereq_ids if p in board_courses]
        prereqs_in_repo         = [p for p in merged_prereq_ids if p in repo_by_id]
        prereqs_not_in_map      = [p for p in merged_prereq_ids
                                   if p not in board_courses and p not in repo_by_id]

        # Legacy alias for output column
        prereqs_in_map = prereqs_mandatory_board + prereqs_in_repo

        # Prereq only as text (not parsed to IDs)
        prereq_only_as_text = bool(supabase_prereq_text) and not merged_prereq_ids

        # ── Problem classification ─────────────────────────────────────────────
        problems = []

        # Mandatory board courses are always schedulable (fixed semester)
        if has_board_obj and not has_repo_obj:
            schedulability = 'fully_schedulable'
            problem_category = 'fully_schedulable'
            problem_he = 'קורס חובה קבוע — אין בעיה'
            can_fix_auto = False
            required_fix = ''
        elif not weekly_hours:
            schedulability = 'unschedulable'
            problem_category = 'semester_not_in_current_sources'
            problem_he = 'חסרות שעות שבועיות — אין נתוני שעות'
            can_fix_auto = False
            required_fix = 'manual: add weekly_hours to Supabase'
        elif not semester_in_app and not semester_in_any_source:
            if not has_syllabus_text and not has_merged_json:
                schedulability = 'unschedulable'
                problem_category = 'syllabus_exists_but_not_parsed'
                problem_he = 'אין מידע על סמסטר, אין syllabus מפורסם, אין JSON מפוענח'
                can_fix_auto = False
                required_fix = 'upstream: scrape course page + parse syllabus'
            else:
                schedulability = 'unschedulable'
                problem_category = 'semester_not_in_current_sources'
                problem_he = 'יש syllabus אך אין מידע על סמסטר בשום מקור'
                can_fix_auto = False
                required_fix = 'upstream: run pipeline to extract semester from scrape/syllabus'
        elif semester_in_source_not_app:
            schedulability = 'unschedulable_fixable'
            problem_category = 'semester_exists_but_not_mapped'
            problem_he = f'יש סמסטר במקור ({semester_source}) אך לא מופיע ב-offered_semesters/effective בסופאבייס'
            can_fix_auto = True
            required_fix = f'add COURSE_DATA_OVERRIDES or update Supabase: offered_semesters={effective_semester}'
        elif not semester_in_app:
            # Has syllabus but no semester in any parsed source
            if has_syllabus_text or has_merged_json or has_raw_json:
                schedulability = 'unschedulable'
                problem_category = 'semester_not_in_current_sources'
                problem_he = 'יש מידע חלקי אך אין סמסטר — הצינור לא חילץ סמסטר'
                can_fix_auto = False
                required_fix = 'pipeline: re-run semester extraction; add to COURSE_DATA_OVERRIDES manually'
            else:
                schedulability = 'unschedulable'
                problem_category = 'syllabus_exists_but_not_parsed'
                problem_he = 'אין JSON מפוענח — הקורס לא עבר scraping'
                can_fix_auto = False
                required_fix = 'upstream: scrape + parse this course'
        elif prereq_only_as_text and merged_prereq_ids == []:
            # Semester is OK but prereqs are only text
            schedulability = 'schedulable_with_caveat'
            problem_category = 'prerequisites_only_in_text'
            problem_he = 'דרישות קדם קיימות רק כטקסט עברי — לא מפורסמות כ-IDs'
            can_fix_auto = False
            required_fix = 'parse syllabus_prerequisites_he to extract course IDs'
        elif prereqs_in_repo:
            # Has prereqs that are REPO ELECTIVES (must be scheduled before this course)
            schedulability = 'schedulable_with_prereq_constraint'
            problem_category = 'prerequisite_available_but_not_scheduled'
            problem_he = f'דרישות קדם הן קורסי בחירה במאגר ({", ".join(prereqs_in_repo)}) — חייבות להיות מתוזמנות לפני'
            can_fix_auto = False
            required_fix = 'planner: prereqsSatisfiedForPlacementLocal already handles this ordering'
        else:
            # Fully schedulable: has semester, has hours, prereqs either:
            # - absent from any map (year 1/2 foundational) → assumed completed
            # - on mandatory board → always placed before electives
            # - none
            schedulability = 'fully_schedulable'
            problem_category = 'fully_schedulable'
            problem_he = 'ניתן לתזמון — יש סמסטר, שעות, ודרישות קדם מטופלות'
            can_fix_auto = False
            required_fix = ''

        # ── Rows ──────────────────────────────────────────────────────────────
        row = {
            'course_id':             cid,
            'course_name':           name_he,
            'category':              category_id,
            'weekly_hours':          weekly_hours,
            'has_syllabus_url':      has_syllabus_url,
            'has_parsed_syllabus_text': has_syllabus_text,
            # Source file presence
            'source_board_json':     has_board_obj,
            'source_repo_json':      has_repo_obj,
            'source_merged_json':    has_merged_json,
            'source_raw_json':       has_raw_json,
            'source_syllabus_json':  has_syllabus_json,
            # Semester data by source
            'supabase_offered_semesters':   supabase_offered or None,
            'supabase_effective_semesters': supabase_effective or None,
            'merged_json_semester':         merged_semester_letter or None,
            'raw_json_semesters':           raw_semesters or None,
            'override_semesters':           override_semesters or None,
            'semester_in_any_source':       semester_in_any_source,
            'semester_source':              semester_source,
            'effective_semester_value':     effective_semester,
            # What the app currently sees
            'app_offered_semesters':        app_offered_semesters or None,
            'app_effective_semesters':      app_effective_semesters or None,
            'semester_in_app':              semester_in_app,
            # Prerequisites
            'merged_prereq_ids':              merged_prereq_ids or None,
            'prereq_raw_text_snippet':        (prereq_raw_text[:100] + '...') if len(prereq_raw_text) > 100 else prereq_raw_text or None,
            'supabase_prereq_text':           bool(supabase_prereq_text),
            'prereqs_on_mandatory_board':     prereqs_mandatory_board or None,
            'prereqs_in_repo_elective_pool':  prereqs_in_repo or None,
            'prereqs_NOT_in_map_foundational': prereqs_not_in_map or None,
            'prereq_only_as_text':            prereq_only_as_text,
            # Classification
            'schedulability_status':    schedulability,
            'problem_category':         problem_category,
            'problem_hebrew':           problem_he,
            'can_fix_automatically':    can_fix_auto,
            'required_fix':             required_fix,
        }
        rows.append(row)

    # ── Summary stats ──────────────────────────────────────────────────────────
    from collections import Counter
    cat_counts   = Counter(r['problem_category'] for r in rows)
    sched_counts = Counter(r['schedulability_status'] for r in rows)

    print("=" * 70)
    print("PROBLEM CATEGORY BREAKDOWN")
    print("=" * 70)
    for cat, n in sorted(cat_counts.items(), key=lambda x: -x[1]):
        print(f"  {n:3d}  {cat}")

    print()
    print("=" * 70)
    print("SCHEDULABILITY STATUS BREAKDOWN")
    print("=" * 70)
    for s, n in sorted(sched_counts.items(), key=lambda x: -x[1]):
        print(f"  {n:3d}  {s}")

    print()
    print("=" * 70)
    print("SUMMARY ANSWERS")
    print("=" * 70)
    total = len(rows)
    fully = sum(1 for r in rows if r['problem_category'] == 'fully_schedulable')
    syl_no_text = sum(1 for r in rows if r['has_syllabus_url'] and not r['has_parsed_syllabus_text'])
    parsed_no_sem = sum(1 for r in rows if r['has_parsed_syllabus_text'] and not r['semester_in_any_source'])
    sem_in_src_not_app = sum(1 for r in rows if r['problem_category'] == 'semester_exists_but_not_mapped')
    prereq_text_only = sum(1 for r in rows if r['problem_category'] == 'prerequisites_only_in_text')
    prereq_blocked = sum(1 for r in rows if r['problem_category'] in ('prerequisite_available_but_not_scheduled', 'prerequisite_missing_from_courseMap'))
    planner_bugs = sum(1 for r in rows if r['problem_category'] == 'illegal_placement_bug')
    user_excluded = sum(1 for r in rows if r['problem_category'] in ('user_excluded', 'irrelevant_to_requested_focus'))
    auto_fixable = sum(1 for r in rows if r['can_fix_automatically'])
    needs_scraping = sum(1 for r in rows if 'upstream' in r['required_fix'] or 'scrape' in r['required_fix'])
    manual_review = sum(1 for r in rows if r['required_fix'] and not r['can_fix_automatically'] and 'planner' not in r['required_fix'])

    print(f" 1. Fully schedulable:                           {fully}/{total}")
    print(f" 2. Has syllabus URL but no parsed text:         {syl_no_text}")
    print(f" 3. Has parsed text but no semester in any src:  {parsed_no_sem}")
    print(f" 4. Semester in source but not in app fields:    {sem_in_src_not_app}")
    print(f" 5. Prerequisites only as text:                  {prereq_text_only}")
    print(f" 6. Blocked by prerequisites:                    {prereq_blocked}")
    print(f" 7. Planner bugs (not data bugs):                {planner_bugs}")
    print(f" 8. Excluded by user preferences:                {user_excluded}")
    print(f" 9. Auto-fixable now:                            {auto_fixable}")
    print(f"10. Requires upstream scraping/Supabase update:  {needs_scraping}")
    print(f"11. Requires manual review:                      {manual_review}")

    # ── Write JSON ─────────────────────────────────────────────────────────────
    out_json = OUT_DIR / "data_audit_mechanical_2027.json"
    out_json.write_text(json.dumps({
        'generated_at': '2026-06-18',
        'total_courses': total,
        'summary': {
            'fully_schedulable': fully,
            'syl_url_no_parsed_text': syl_no_text,
            'parsed_text_no_semester': parsed_no_sem,
            'semester_in_src_not_app': sem_in_src_not_app,
            'prereq_only_as_text': prereq_text_only,
            'blocked_by_prereqs': prereq_blocked,
            'planner_bugs': planner_bugs,
            'user_preference_excluded': user_excluded,
            'auto_fixable': auto_fixable,
            'needs_upstream_scraping': needs_scraping,
            'manual_review': manual_review,
        },
        'category_counts': dict(cat_counts),
        'schedulability_counts': dict(sched_counts),
        'courses': rows,
    }, ensure_ascii=False, indent=2), encoding='utf-8')
    print(f"\nJSON written: {out_json}")

    # ── Write CSV ──────────────────────────────────────────────────────────────
    out_csv = OUT_DIR / "data_audit_mechanical_2027.csv"
    csv_rows = []
    for r in rows:
        flat = {k: (json.dumps(v, ensure_ascii=False) if isinstance(v, (list, dict)) else v)
                for k, v in r.items()}
        csv_rows.append(flat)

    if csv_rows:
        with open(out_csv, 'w', newline='', encoding='utf-8-sig') as f:
            writer = csv.DictWriter(f, fieldnames=list(csv_rows[0].keys()))
            writer.writeheader()
            writer.writerows(csv_rows)
        print(f"CSV written: {out_csv}")

    return rows

if __name__ == '__main__':
    main()

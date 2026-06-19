#!/usr/bin/env python3
"""
supabase_normalize_mechanical_2027.py

Safe Supabase migration — course-data normalization for Mechanical Engineering 2027.

Flow (default = dry-run):
  1. Read current board_json from Supabase (SELECT only) and save a full backup.
  2. Generate a per-course dry-run diff JSON (no write yet).
  3. Validate pre-conditions (spot-checks, consistency assertions).
  4. [--write only] Apply normalization to board_json in memory.
  5. [--write only] Write updated board_json back to Supabase (single UPDATE).
  6. [--write only] Read back and generate post-write verification report.

Fields updated per course (normalization fields only):
  - offered_semesters
  - effective_allowed_semesters
  - offering_source_confidence
  - offering_source_url
  - offering_correction_note
  - offered_in_year          (False for not-offered courses)

Fields NEVER touched:
  - name_he / course_name
  - category
  - weekly_hours / semester_hours
  - syllabus_source_url / syllabus_url
  - tau_factor_status, tau_factor_source_url
  - assessment_analysis_status, syllabus_ai_analysis_status
  - name_source, name_source_confidence
  - board placement (semesters[])

Usage:
    python3 scripts/supabase_normalize_mechanical_2027.py            # dry-run
    python3 scripts/supabase_normalize_mechanical_2027.py --write    # live write
"""

from __future__ import annotations

import argparse
import json
import os
import sys
from datetime import datetime
from pathlib import Path

try:
    import psycopg2
    from dotenv import load_dotenv
except ImportError:
    print("Missing dependencies — run: pip install psycopg2-binary python-dotenv",
          file=sys.stderr)
    sys.exit(1)

# ── Constants ────────────────────────────────────────────────────────────────

BASE = Path(__file__).parent.parent
PROGRAM_ID  = 'mechanical_engineering'
YEAR        = 2027
NOTE_PREFIX = 'Normalization pipeline 2026-06-19'

NORMALIZED_JSON = BASE / 'data/import_reports/normalized_courses_mechanical_2027.json'
DIFF_JSON       = BASE / 'data/import_reports/supabase_normalization_diff_2027.json'
AFTER_JSON      = BASE / 'data/import_reports/supabase_normalization_after_2027.json'
BACKUPS_DIR     = BASE / 'data/backups'

# Courses confirmed not offered in 2025/2026 (אין נתונים מתאימים)
NOT_OFFERED_SET = frozenset({
    '0542-4093', '0542-4124', '0542-4131', '0542-4132',
    '0542-4135', '0542-4191', '0542-4321', '0542-4322',
})

# Courses that must have both A and B after migration
MULTI_SEMESTER_SET = frozenset({
    '0512-2508', '0512-4200', '0542-2500', '0542-3620',
    '0542-3780', '0542-3791', '0542-3792', '0542-4091',
})


# ── Database helpers ─────────────────────────────────────────────────────────

def _get_conn():
    load_dotenv(BASE / '.env')
    url = os.environ.get('DATABASE_URL')
    if not url:
        print('ERROR: DATABASE_URL not set in .env', file=sys.stderr)
        sys.exit(1)
    return psycopg2.connect(url)


def _read_live_board(conn) -> dict:
    cur = conn.cursor()
    cur.execute(
        'SELECT board_json FROM program_versions '
        'WHERE program_id = %s AND academic_year = %s',
        (PROGRAM_ID, YEAR),
    )
    row = cur.fetchone()
    cur.close()
    if not row:
        print(f'ERROR: No row found for {PROGRAM_ID!r} year {YEAR}', file=sys.stderr)
        sys.exit(1)
    return row[0]


def _write_live_board(conn, board: dict) -> int:
    cur = conn.cursor()
    cur.execute(
        'UPDATE program_versions SET board_json = %s '
        'WHERE program_id = %s AND academic_year = %s',
        (json.dumps(board, ensure_ascii=False), PROGRAM_ID, YEAR),
    )
    rows = cur.rowcount
    conn.commit()
    cur.close()
    return rows


# ── Step 1: Backup ───────────────────────────────────────────────────────────

def save_backup(board: dict) -> Path:
    """Save full current Supabase board_json to a timestamped backup file."""
    BACKUPS_DIR.mkdir(parents=True, exist_ok=True)
    ts = datetime.now().strftime('%Y%m%d_%H%M%S')
    path = BACKUPS_DIR / f'supabase_mechanical_2027_before_normalization_{ts}.json'

    repo = board.get('metadata', {}).get('program_repository_courses', [])
    path.write_text(json.dumps({
        'backup_date':   datetime.now().isoformat(),
        'program_id':    PROGRAM_ID,
        'academic_year': YEAR,
        'note': 'Pre-normalization backup — restore board_json from full_board_json if rollback needed',
        'program_repository_courses_count': len(repo),
        'program_repository_courses': [
            {
                'course_id':                   c.get('course_id'),
                'course_name':                 c.get('course_name') or c.get('name_he'),
                'offered_semesters':           c.get('offered_semesters'),
                'effective_allowed_semesters': c.get('effective_allowed_semesters'),
                'offering_source_confidence':  c.get('offering_source_confidence'),
                'offering_source_url':         c.get('offering_source_url'),
                'offered_in_year':             c.get('offered_in_year'),
                'category':                    c.get('category'),
                'weekly_hours':                c.get('weekly_hours'),
                'semester_hours':              c.get('semester_hours'),
                'syllabus_url':                c.get('syllabus_source_url') or c.get('syllabus_url'),
                'prerequisite_course_ids':     c.get('prerequisite_course_ids'),
            }
            for c in repo
        ],
        'full_board_json': board,
    }, ensure_ascii=False, indent=2), encoding='utf-8')
    return path


# ── Step 2: Dry-run diff ─────────────────────────────────────────────────────

def build_diff(live_repo: list[dict], normalized: dict[str, dict]) -> list[dict]:
    """Per-course diff: current Supabase vs pipeline-normalized data."""
    live_idx = {c['course_id']: c for c in live_repo}
    diffs = []

    for cid, norm in sorted(normalized.items()):
        live = live_idx.get(cid, {})
        old_offered    = live.get('offered_semesters')    or []
        new_offered    = norm.get('offered_semesters')    or []
        old_effective  = live.get('effective_allowed_semesters') or []
        new_effective  = norm.get('effective_allowed_semesters') or []
        old_confidence = live.get('offering_source_confidence')
        new_confidence = norm.get('offering_confidence')
        not_offered    = norm.get('not_offered_this_year', False)
        old_in_year    = live.get('offered_in_year')

        # Determine if this course changes
        offered_differs   = sorted(old_offered)   != sorted(new_offered)
        effective_differs = sorted(old_effective) != sorted(new_effective)
        in_year_fix = not_offered and old_in_year is not False

        diffs.append({
            'course_id':                       cid,
            'course_name':                     (live.get('course_name') or live.get('name_he')
                                                or norm.get('course_name') or ''),
            'changed':                         offered_differs or effective_differs or in_year_fix,
            'old_offered_semesters':           old_offered or None,
            'new_offered_semesters':           new_offered or None,
            'old_effective_allowed_semesters': old_effective or None,
            'new_effective_allowed_semesters': new_effective or None,
            'old_offering_source_confidence':  old_confidence,
            'new_offering_source_confidence':  new_confidence,
            'old_offered_in_year':             old_in_year,
            'new_offered_in_year':             False if not_offered else True,
            'offering_source':                 norm.get('offering_source'),
            'offering_confidence':             norm.get('offering_confidence'),
            'not_offered_this_year':           not_offered,
            'data_status':                     norm.get('data_status'),
            'reason':                          _reason(cid, old_offered, new_offered,
                                                       not_offered, in_year_fix),
        })
    return diffs


def _reason(cid: str, old: list, new: list, not_offered: bool, in_year_fix: bool) -> str:
    if not_offered:
        return 'not_offered_in_2025_2026' + (' + fix_offered_in_year' if in_year_fix else '')
    if not old and new:
        return 'added_missing_semester_data'
    if old and not new:
        return 'cleared_no_source'
    if sorted(old) != sorted(new):
        return f'corrected_{",".join(sorted(old))}_to_{",".join(sorted(new))}'
    return 'no_change'


def save_diff(diffs: list[dict], mode: str) -> None:
    changed = [d for d in diffs if d['changed']]
    DIFF_JSON.parent.mkdir(parents=True, exist_ok=True)
    DIFF_JSON.write_text(json.dumps({
        'generated_at':  datetime.now().isoformat(),
        'program_id':    PROGRAM_ID,
        'academic_year': YEAR,
        'mode':          mode,
        'summary': {
            'total_courses':       len(diffs),
            'courses_with_changes': len(changed),
            'courses_unchanged':   len(diffs) - len(changed),
            'not_offered_this_year': sum(1 for d in diffs if d['not_offered_this_year']),
        },
        'changes': diffs,
    }, ensure_ascii=False, indent=2), encoding='utf-8')


# ── Step 3: Validate ─────────────────────────────────────────────────────────

def validate_before_write(diffs: list[dict], normalized: dict[str, dict]) -> bool:
    """Assert all required pre-conditions. Returns True if all pass."""
    errors: list[str] = []
    idx = {d['course_id']: d for d in diffs}

    # 0542-4220 must end up as ['B']
    d = idx.get('0542-4220')
    if not d or d['new_offered_semesters'] != ['B']:
        errors.append(f"0542-4220 תורת התנודות: expected ['B'], got {d and d['new_offered_semesters']}")

    # 0542-4224 must end up as ['A']
    d = idx.get('0542-4224')
    if not d or d['new_offered_semesters'] != ['A']:
        errors.append(f"0542-4224 מכניקת המוצקים (2): expected ['A'], got {d and d['new_offered_semesters']}")

    # Multi-semester courses must get ['A','B']
    for cid in sorted(MULTI_SEMESTER_SET & set(idx)):
        d = idx[cid]
        got = sorted(d.get('new_offered_semesters') or [])
        if got != ['A', 'B']:
            errors.append(f"{cid}: expected ['A','B'], got {got}")

    # Not-offered courses must NOT receive offered_semesters
    for cid in sorted(NOT_OFFERED_SET & set(idx)):
        d = idx[cid]
        if d.get('new_offered_semesters'):
            errors.append(f"{cid} is not offered this year but pipeline gives {d['new_offered_semesters']}")

    # No high-confidence course should have empty offered_semesters in pipeline
    for cid, norm in normalized.items():
        if (not norm.get('not_offered_this_year')
                and norm.get('offering_confidence') == 'high'
                and not norm.get('offered_semesters')):
            errors.append(f"{cid}: high confidence in pipeline but offered_semesters is empty")

    # No A-only course should have B effective semesters, and vice versa
    for d in diffs:
        new_off = d.get('new_offered_semesters') or []
        new_eff = d.get('new_effective_allowed_semesters') or []
        if new_off == ['A'] and any('semester_b' in e for e in new_eff):
            errors.append(f"{d['course_id']}: offered=['A'] but effective has B slots: {new_eff}")
        if new_off == ['B'] and any('semester_a' in e for e in new_eff):
            errors.append(f"{d['course_id']}: offered=['B'] but effective has A slots: {new_eff}")

    if errors:
        print('VALIDATION FAILED:')
        for e in errors:
            print(f'  ERROR: {e}')
        return False

    print('All pre-write validations passed.')
    return True


# ── Step 4: Apply in memory ───────────────────────────────────────────────────

def apply_normalization(board: dict,
                        normalized: dict[str, dict]) -> tuple[dict, int, list]:
    """Update program_repository_courses in board dict (in memory, no DB call).

    Returns: (updated_board, courses_changed, skipped_list)
    """
    repo   = board.get('metadata', {}).get('program_repository_courses', [])
    changed = 0
    skipped: list[dict] = []

    for course in repo:
        cid  = course.get('course_id')
        norm = normalized.get(cid)
        if not norm:
            skipped.append({'course_id': cid, 'reason': 'not_in_normalized_data'})
            continue

        not_offered = norm.get('not_offered_this_year', False)

        # ── Not-offered courses: only mark offered_in_year=False ─────────────
        if not_offered:
            if course.get('offered_in_year') is not False:
                course['offered_in_year'] = False
                course['offering_correction_note'] = (
                    f'{NOTE_PREFIX}: course not offered in 2025/2026 '
                    f'(אין נתונים מתאימים in course_details HTML). '
                    f'offered_in_year set to False; offered_semesters left empty.'
                )
                changed += 1
            continue

        new_offered   = norm.get('offered_semesters') or []
        new_effective = norm.get('effective_allowed_semesters') or []

        if not new_offered:
            skipped.append({'course_id': cid, 'reason': 'no_semester_data_in_pipeline'})
            continue

        old_offered   = course.get('offered_semesters')    or []
        old_effective = course.get('effective_allowed_semesters') or []

        if (sorted(old_offered) == sorted(new_offered)
                and sorted(old_effective) == sorted(new_effective)):
            continue  # Already correct

        # Update normalization fields only — never touch name/hours/category/url
        course['offered_semesters']           = new_offered
        course['effective_allowed_semesters'] = new_effective
        course['offering_source_confidence']  = norm.get('offering_confidence', 'high')
        course['offered_in_year']             = True
        src = norm.get('offering_source', 'none')
        course['offering_source_url'] = (
            'data/raw_html/course_details+syllabus'
            if src == 'both' else
            f'data/raw_html/{src}'
            if src not in ('none',) else
            course.get('offering_source_url', '')
        )
        course['offering_correction_note'] = (
            f'{NOTE_PREFIX}: extracted from TAU schedule HTML '
            f'(source={src}, confidence={norm.get("offering_confidence","high")}). '
            f'Was: offered={old_offered} effective_count={len(old_effective)}. '
            f'Now: offered={new_offered} effective_count={len(new_effective)}.'
        )
        changed += 1

    return board, changed, skipped


# ── Step 5: Write ─────────────────────────────────────────────────────────────

# Wrapped in run_safe_write() in main so it never executes in dry-run mode.


# ── Step 6: Post-write verification ──────────────────────────────────────────

def verify_post_write(conn) -> dict:
    """Read back from Supabase and return a verification report dict."""
    board = _read_live_board(conn)
    repo  = board.get('metadata', {}).get('program_repository_courses', [])
    idx   = {c['course_id']: c for c in repo}

    with_offered    = [c for c in repo if c.get('offered_semesters')]
    with_effective  = [c for c in repo if c.get('effective_allowed_semesters')]
    not_offered_now = [c for c in repo if c.get('offered_in_year') is False]
    still_missing   = [c for c in repo
                       if not c.get('offered_semesters')
                       and c.get('offered_in_year') is not False]

    def chk(cid: str, expected: list) -> dict:
        c = idx.get(cid, {})
        actual = c.get('offered_semesters')
        return {
            'offered_semesters':           actual,
            'effective_allowed_semesters': c.get('effective_allowed_semesters'),
            'expected_offered':            expected,
            'pass':                        sorted(actual or []) == sorted(expected),
        }

    return {
        'verified_at':                    datetime.now().isoformat(),
        'total_repo_courses':             len(repo),
        'with_offered_semesters':         len(with_offered),
        'with_effective_allowed_semesters': len(with_effective),
        'not_offered_this_year':          len(not_offered_now),
        'still_missing_semester_data':    len(still_missing),
        'spot_checks': {
            '0542-4220': chk('0542-4220', ['B']),
            '0542-4224': chk('0542-4224', ['A']),
            '0512-2508': chk('0512-2508', ['A', 'B']),
        },
        'missing_courses': [
            {'course_id': c.get('course_id'),
             'course_name': c.get('course_name') or c.get('name_he')}
            for c in still_missing
        ],
    }


# ── CLI entry point ───────────────────────────────────────────────────────────

def main() -> int:
    p = argparse.ArgumentParser(description=__doc__,
                                formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument('--write', action='store_true',
                   help='Apply normalization and write to Supabase (default: dry-run only)')
    args = p.parse_args()
    dry_run = not args.write

    if not NORMALIZED_JSON.exists():
        print(f'ERROR: Normalized JSON not found: {NORMALIZED_JSON}', file=sys.stderr)
        print('Run first: python3 scripts/normalize_courses_mechanical_2027.py', file=sys.stderr)
        return 1

    print('=== Supabase normalization migration — Mechanical Engineering 2027 ===')
    print(f'  mode:    {"DRY-RUN (no write)" if dry_run else "LIVE WRITE"}')
    print(f'  program: {PROGRAM_ID}  year: {YEAR}')
    print()

    # ── 1. Read + Backup ──────────────────────────────────────────────────────
    print('[1] Reading current Supabase board_json and saving backup ...')
    conn  = _get_conn()
    board = _read_live_board(conn)
    repo  = board.get('metadata', {}).get('program_repository_courses', [])

    pre_offered   = sum(1 for c in repo if c.get('offered_semesters'))
    pre_effective = sum(1 for c in repo if c.get('effective_allowed_semesters'))
    print(f'    Current: {pre_offered}/{len(repo)} with offered_semesters, '
          f'{pre_effective}/{len(repo)} with effective')

    backup_path = save_backup(board)
    print(f'    Backup:  {backup_path}')

    # ── 2. Dry-run diff ───────────────────────────────────────────────────────
    print()
    print('[2] Generating dry-run diff ...')
    normalized = {
        c['course_id']: c
        for c in json.loads(NORMALIZED_JSON.read_text(encoding='utf-8'))['courses']
    }
    diffs        = build_diff(repo, normalized)
    changed_diffs = [d for d in diffs if d['changed']]

    save_diff(diffs, 'dry_run' if dry_run else 'pre_write')
    print(f'    Courses with changes: {len(changed_diffs)}/{len(diffs)}')
    print(f'    Diff saved:           {DIFF_JSON}')
    print()
    print('  Changes:')
    for d in sorted(changed_diffs, key=lambda x: x['course_id']):
        old = d['old_offered_semesters']
        new = d['new_offered_semesters']
        reason = d['reason']
        print(f'    {d["course_id"]:12s}  {str(old):<14}-> {str(new):<14} [{reason}]')

    # ── 3. Validate ───────────────────────────────────────────────────────────
    print()
    print('[3] Validating pre-conditions ...')
    if not validate_before_write(diffs, normalized):
        conn.close()
        return 1

    if dry_run:
        print()
        print('DRY-RUN COMPLETE — no data written.')
        print(f'To apply: python3 {Path(__file__).name} --write')
        conn.close()
        return 0

    # ── 4. Apply in memory ────────────────────────────────────────────────────
    print()
    print('[4] Applying normalization to board_json in memory ...')
    updated_board, n_changed, skipped = apply_normalization(board, normalized)
    print(f'    Courses updated: {n_changed}')
    print(f'    Courses skipped: {len(skipped)}')
    for s in skipped:
        print(f'    SKIP {s["course_id"]}: {s["reason"]}')

    # ── 5. Write to Supabase ──────────────────────────────────────────────────
    print()
    print('[5] Writing updated board_json to Supabase ...')
    rows = _write_live_board(conn, updated_board)
    if rows != 1:
        print(f'ERROR: Expected 1 row updated, got {rows}', file=sys.stderr)
        print(f'Rollback using: {backup_path}', file=sys.stderr)
        conn.close()
        return 1
    print(f'    Rows updated: {rows}')

    # ── 6. Post-write verification ────────────────────────────────────────────
    print()
    print('[6] Reading back from Supabase for post-write verification ...')
    verification = verify_post_write(conn)
    conn.close()

    AFTER_JSON.write_text(
        json.dumps(verification, ensure_ascii=False, indent=2), encoding='utf-8'
    )
    print(f'    Verification saved: {AFTER_JSON}')
    print()
    print('  Post-write state:')
    print(f'    Total repo courses:               {verification["total_repo_courses"]}')
    print(f'    With offered_semesters:           {verification["with_offered_semesters"]}')
    print(f'    With effective_allowed_semesters: {verification["with_effective_allowed_semesters"]}')
    print(f'    Not offered this year:            {verification["not_offered_this_year"]}')
    print(f'    Still missing semester data:      {verification["still_missing_semester_data"]}')

    print()
    print('  Spot checks:')
    all_pass = True
    for cid, chk in verification['spot_checks'].items():
        status = 'PASS' if chk['pass'] else 'FAIL'
        if not chk['pass']:
            all_pass = False
        exp = chk['expected_offered']
        got = chk['offered_semesters']
        print(f'    {status}  {cid}: got {got}, expected {exp}')

    if verification['still_missing_semester_data'] > 0:
        print(f'\n  WARNING: {verification["still_missing_semester_data"]} courses still missing:')
        for c in verification['missing_courses']:
            print(f'    {c["course_id"]} {c["course_name"]}')

    if not all_pass:
        print('\nERROR: Spot check failed after write!', file=sys.stderr)
        print(f'Rollback backup: {backup_path}', file=sys.stderr)
        return 1

    print()
    print('=== Migration complete ===')
    print(f'  Backup:       {backup_path}')
    print(f'  Diff:         {DIFF_JSON}')
    print(f'  Verification: {AFTER_JSON}')
    print(f'  Rows updated in Supabase: {rows}')
    print(f'  Courses changed:          {n_changed}')
    return 0


if __name__ == '__main__':
    raise SystemExit(main())

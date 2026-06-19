"""
test_supabase_normalize.py

Tests for the Supabase migration script (supabase_normalize_mechanical_2027.py).

All tests that touch Supabase read the live database.  Tests that don't need
the DB (build_diff, apply_normalization, validate) use in-memory fixtures.
The `--write` path is NOT exercised here — these are dry-run / unit tests.

Test matrix:
  T01  build_diff generates a per-course diff dict with 'changed' flag
  T02  build_diff catches 0542-4220 as needing A→B correction
  T03  build_diff catches 0542-4224 as needing B→A correction
  T04  build_diff keeps not-offered courses with new_offered_semesters=None
  T05  validate_before_write passes on correctly normalized fixtures
  T06  validate_before_write fails if 0542-4220 is not set to B
  T07  apply_normalization sets 0542-4220 to ['B'] in board dict
  T08  apply_normalization sets 0542-4224 to ['A'] in board dict
  T09  apply_normalization keeps A+B for multi-semester courses
  T10  apply_normalization does not add offered_semesters to not-offered courses
  T11  save_backup creates a backup file containing full_board_json key
  T12  live dry-run: backup file exists before any diff or write touches Supabase
"""

import json
import sys
import tempfile
from datetime import datetime
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).parent.parent / 'scripts'))
from supabase_normalize_mechanical_2027 import (
    NORMALIZED_JSON,
    NOT_OFFERED_SET,
    MULTI_SEMESTER_SET,
    apply_normalization,
    build_diff,
    save_backup,
    validate_before_write,
)


# ── Fixtures ──────────────────────────────────────────────────────────────────

def _norm_data() -> dict[str, dict]:
    """Load normalized pipeline output, indexed by course_id."""
    return {
        c['course_id']: c
        for c in json.loads(NORMALIZED_JSON.read_text(encoding='utf-8'))['courses']
    }


def _minimal_live_repo() -> list[dict]:
    """A minimal 4-course 'live Supabase' repo for unit testing."""
    return [
        # wrong semester
        {'course_id': '0542-4220', 'course_name': 'תורת התנודות',
         'offered_semesters': ['A'], 'effective_allowed_semesters': ['year_3_semester_a', 'year_4_semester_a'],
         'offering_source_confidence': 'high', 'offered_in_year': True},
        # wrong semester
        {'course_id': '0542-4224', 'course_name': 'מכניקת המוצקים (2)',
         'offered_semesters': ['B'], 'effective_allowed_semesters': ['year_3_semester_b', 'year_4_semester_b'],
         'offering_source_confidence': 'high', 'offered_in_year': True},
        # not offered
        {'course_id': '0542-4093', 'course_name': 'מעבדה במערכות אנרגיה',
         'offered_semesters': [], 'effective_allowed_semesters': [],
         'offering_source_confidence': None, 'offered_in_year': True},
        # A+B
        {'course_id': '0512-2508', 'course_name': 'התקנים אלקטרוניים',
         'offered_semesters': ['A', 'B'],
         'effective_allowed_semesters': ['year_3_semester_a', 'year_4_semester_a',
                                         'year_3_semester_b', 'year_4_semester_b'],
         'offering_source_confidence': 'high', 'offered_in_year': True},
    ]


def _minimal_board(repo: list[dict]) -> dict:
    return {'metadata': {'program_repository_courses': repo}, 'semesters': []}


# ── T01 ───────────────────────────────────────────────────────────────────────

def test_T01_build_diff_returns_per_course_dict_with_changed_flag():
    """build_diff produces one entry per normalized course with a 'changed' bool."""
    normalized = _norm_data()
    diffs = build_diff(_minimal_live_repo(), normalized)
    assert len(diffs) >= 4
    for d in diffs:
        assert 'course_id' in d
        assert 'changed' in d
        assert isinstance(d['changed'], bool)


# ── T02 ───────────────────────────────────────────────────────────────────────

def test_T02_diff_detects_0542_4220_must_change_to_B():
    """build_diff flags 0542-4220 (was A) as changed with new_offered=['B']."""
    normalized = _norm_data()
    diffs      = build_diff(_minimal_live_repo(), normalized)
    idx = {d['course_id']: d for d in diffs}
    d = idx['0542-4220']
    assert d['changed'] is True
    assert d['old_offered_semesters'] == ['A']
    assert d['new_offered_semesters'] == ['B']


# ── T03 ───────────────────────────────────────────────────────────────────────

def test_T03_diff_detects_0542_4224_must_change_to_A():
    """build_diff flags 0542-4224 (was B) as changed with new_offered=['A']."""
    normalized = _norm_data()
    diffs      = build_diff(_minimal_live_repo(), normalized)
    idx = {d['course_id']: d for d in diffs}
    d = idx['0542-4224']
    assert d['changed'] is True
    assert d['old_offered_semesters'] == ['B']
    assert d['new_offered_semesters'] == ['A']


# ── T04 ───────────────────────────────────────────────────────────────────────

def test_T04_diff_does_not_assign_semesters_to_not_offered_courses():
    """Not-offered courses must have new_offered_semesters=None in the diff."""
    normalized = _norm_data()
    diffs      = build_diff(_minimal_live_repo(), normalized)
    idx = {d['course_id']: d for d in diffs}
    for cid in NOT_OFFERED_SET:
        if cid in idx:
            assert idx[cid]['new_offered_semesters'] is None, (
                f"{cid}: expected new_offered_semesters=None, "
                f"got {idx[cid]['new_offered_semesters']}"
            )
            assert idx[cid]['not_offered_this_year'] is True


# ── T05 ───────────────────────────────────────────────────────────────────────

def test_T05_validate_passes_on_correct_normalized_data():
    """validate_before_write returns True when normalized data is internally consistent."""
    normalized = _norm_data()
    diffs      = build_diff(_minimal_live_repo(), normalized)
    assert validate_before_write(diffs, normalized) is True


# ── T06 ───────────────────────────────────────────────────────────────────────

def test_T06_validate_fails_if_0542_4220_not_B():
    """validate_before_write returns False if 0542-4220 pipeline data is wrong."""
    normalized = _norm_data()
    # Tamper: pretend pipeline says A for this course
    normalized['0542-4220'] = dict(normalized['0542-4220'])
    normalized['0542-4220']['offered_semesters'] = ['A']
    normalized['0542-4220']['effective_allowed_semesters'] = ['year_3_semester_a', 'year_4_semester_a']
    diffs = build_diff(_minimal_live_repo(), normalized)
    result = validate_before_write(diffs, normalized)
    assert result is False


# ── T07 ───────────────────────────────────────────────────────────────────────

def test_T07_apply_normalization_sets_0542_4220_to_B():
    """apply_normalization corrects 0542-4220 from A to B in the board dict."""
    normalized = _norm_data()
    repo  = _minimal_live_repo()
    board = _minimal_board([c.copy() for c in repo])
    updated, n_changed, _ = apply_normalization(board, normalized)
    repo_out = {c['course_id']: c
                for c in updated['metadata']['program_repository_courses']}
    assert repo_out['0542-4220']['offered_semesters'] == ['B']
    assert 'year_3_semester_b' in repo_out['0542-4220']['effective_allowed_semesters']
    assert 'year_3_semester_a' not in repo_out['0542-4220']['effective_allowed_semesters']
    assert n_changed >= 1


# ── T08 ───────────────────────────────────────────────────────────────────────

def test_T08_apply_normalization_sets_0542_4224_to_A():
    """apply_normalization corrects 0542-4224 from B to A in the board dict."""
    normalized = _norm_data()
    repo  = _minimal_live_repo()
    board = _minimal_board([c.copy() for c in repo])
    updated, _, _ = apply_normalization(board, normalized)
    repo_out = {c['course_id']: c
                for c in updated['metadata']['program_repository_courses']}
    assert repo_out['0542-4224']['offered_semesters'] == ['A']
    assert 'year_3_semester_a' in repo_out['0542-4224']['effective_allowed_semesters']
    assert 'year_3_semester_b' not in repo_out['0542-4224']['effective_allowed_semesters']


# ── T09 ───────────────────────────────────────────────────────────────────────

def test_T09_apply_normalization_keeps_AB_for_multi_semester_courses():
    """apply_normalization keeps ['A','B'] for multi-group courses like 0512-2508."""
    normalized = _norm_data()
    repo  = _minimal_live_repo()
    board = _minimal_board([c.copy() for c in repo])
    updated, _, _ = apply_normalization(board, normalized)
    repo_out = {c['course_id']: c
                for c in updated['metadata']['program_repository_courses']}
    c = repo_out['0512-2508']
    assert sorted(c['offered_semesters']) == ['A', 'B']
    assert len(c['effective_allowed_semesters']) == 4


# ── T10 ───────────────────────────────────────────────────────────────────────

def test_T10_apply_normalization_does_not_fill_offered_for_not_offered_courses():
    """Not-offered courses must stay with empty offered_semesters after apply."""
    normalized = _norm_data()
    repo  = _minimal_live_repo()
    board = _minimal_board([c.copy() for c in repo])
    updated, _, _ = apply_normalization(board, normalized)
    repo_out = {c['course_id']: c
                for c in updated['metadata']['program_repository_courses']}
    # 0542-4093 was in minimal fixture, must stay empty and get offered_in_year=False
    c = repo_out['0542-4093']
    assert not c.get('offered_semesters'), (
        f"0542-4093 should have empty offered_semesters, got {c.get('offered_semesters')}"
    )
    assert c.get('offered_in_year') is False


# ── T11 ───────────────────────────────────────────────────────────────────────

def test_T11_save_backup_creates_file_with_full_board_json():
    """save_backup writes a JSON file that contains full_board_json for rollback."""
    fake_board = {
        'metadata': {'program_repository_courses': [
            {'course_id': '0542-4220', 'offered_semesters': ['A']},
        ]},
        'semesters': [],
    }
    with tempfile.TemporaryDirectory() as tmpdir:
        # Monkey-patch BACKUPS_DIR temporarily
        import supabase_normalize_mechanical_2027 as mod
        orig = mod.BACKUPS_DIR
        mod.BACKUPS_DIR = Path(tmpdir)
        try:
            path = save_backup(fake_board)
        finally:
            mod.BACKUPS_DIR = orig

        assert path.exists(), 'Backup file was not created'
        data = json.loads(path.read_text(encoding='utf-8'))
        assert 'full_board_json' in data, 'Backup must include full_board_json'
        assert 'program_repository_courses' in data, 'Backup must include per-course list'
        assert data['program_id'] == 'mechanical_engineering'


# ── T12 ───────────────────────────────────────────────────────────────────────

def test_T12_live_dry_run_post_migration_state():
    """
    Integration test (reads live Supabase, no write).

    Verifies the post-migration state (migration ran 2026-06-19):
      - A backup file can be created.
      - The live board has >= 48 courses with offered_semesters (full migration applied).
      - The diff shows 0 changed courses (all corrections already applied).
      - Spot-check: 0542-4220 = ['B'], 0542-4224 = ['A'], 0512-2508 = ['A','B'].
    """
    pytest.importorskip('psycopg2')
    import os
    from dotenv import load_dotenv
    load_dotenv(Path(__file__).parent.parent / '.env')
    if not os.environ.get('DATABASE_URL'):
        pytest.skip('DATABASE_URL not set — skipping live integration test')

    from supabase_normalize_mechanical_2027 import _get_conn, _read_live_board

    conn  = _get_conn()
    board = _read_live_board(conn)
    conn.close()

    repo = board.get('metadata', {}).get('program_repository_courses', [])
    assert len(repo) >= 56, f'Expected 56 live repo courses, got {len(repo)}'

    # Post-migration: 48 schedulable courses must have semester data
    with_sems = [c for c in repo if c.get('offered_semesters')]
    assert len(with_sems) >= 48, f'Expected >=48 with offered_semesters, got {len(with_sems)}'

    with tempfile.TemporaryDirectory() as tmpdir:
        import supabase_normalize_mechanical_2027 as mod
        orig = mod.BACKUPS_DIR
        mod.BACKUPS_DIR = Path(tmpdir)
        try:
            backup_path = save_backup(board)
            assert backup_path.exists(), 'Backup file must exist before diff is run'

            normalized = _norm_data()
            diffs = build_diff(repo, normalized)
        finally:
            mod.BACKUPS_DIR = orig

    # All corrections were applied — diff should show 0 changed courses
    changed = [d for d in diffs if d['changed']]
    assert len(changed) == 0, (
        f'Expected 0 changed courses post-migration, got {len(changed)}: '
        f'{[d["course_id"] for d in changed]}'
    )

    # Spot-check: key corrections are present
    by_id = {c['course_id']: c for c in repo}
    assert by_id['0542-4220']['offered_semesters'] == ['B'], '0542-4220 must be [B]'
    assert by_id['0542-4224']['offered_semesters'] == ['A'], '0542-4224 must be [A]'
    assert sorted(by_id['0512-2508']['offered_semesters']) == ['A', 'B'], '0512-2508 must be [A,B]'

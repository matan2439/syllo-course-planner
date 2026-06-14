/**
 * Tests for computeDraftDiff() in app/web/semester_board_viewer.html (PART I).
 *
 * The function is extracted from the HTML source and evaluated in a small
 * sandbox with mocked `state`, `courseMap`, and `GENERAL_ELECTIVE_CAT_ID`
 * globals, since the real function lives inline in a <script> tag.
 */

import fs from 'fs';
import path from 'path';
import vm from 'vm';

function loadComputeDraftDiff() {
  const html = fs.readFileSync(
    path.join(__dirname, '../../app/web/semester_board_viewer.html'),
    'utf-8'
  );
  const match = html.match(/function computeDraftDiff\(\)\s*\{[\s\S]*?\n\}/);
  if (!match) throw new Error('computeDraftDiff() not found in semester_board_viewer.html');
  return match[0];
}

const COMPUTE_DRAFT_DIFF_SRC = loadComputeDraftDiff();

function runComputeDraftDiff(state: any, courseMap: any) {
  const sandbox: any = {
    state,
    courseMap,
    GENERAL_ELECTIVE_CAT_ID: 'other_specialization',
  };
  vm.createContext(sandbox);
  vm.runInContext(`${COMPUTE_DRAFT_DIFF_SRC}\nresult = computeDraftDiff();`, sandbox);
  return sandbox.result;
}

const course = (id: string, category: string, type = 'elective') => ({
  course_id: id,
  name_he: id,
  program_category_id: category,
  course_type: type,
});

describe('computeDraftDiff — PART I replacement detection', () => {
  test('swap (מצא חלופה) — remove + add in same semester/category produces a single הוחלף entry', () => {
    const courseMap = {
      OLD: course('OLD', 'fluids'),
      NEW: course('NEW', 'fluids'),
    };
    const state = {
      semesters: { sem1: ['OLD'] },
      proposalDraft: { semesters: { sem1: ['NEW'] }, repo: [] },
    };

    const diff = runComputeDraftDiff(state, courseMap);

    expect(diff.added.size).toBe(0);
    expect(diff.removed.size).toBe(0);
    expect(diff.replaced.size).toBe(1);
    expect(diff.replaced.get('OLD')).toEqual({ to: 'NEW', semId: 'sem1' });
    expect(diff.replacedTo.get('NEW')).toEqual({ from: 'OLD', semId: 'sem1' });
  });

  test('unrelated add/remove pairs (different semesters) still show separately', () => {
    const courseMap = {
      OLD: course('OLD', 'fluids'),
      NEW: course('NEW', 'solids'),
    };
    const state = {
      semesters: { sem1: ['OLD'] },
      proposalDraft: { semesters: { sem2: ['NEW'] }, repo: [] },
    };

    const diff = runComputeDraftDiff(state, courseMap);

    expect([...diff.added]).toEqual(['NEW']);
    expect([...diff.removed]).toEqual(['OLD']);
    expect(diff.replaced.size).toBe(0);
    expect(diff.replacedTo.size).toBe(0);
  });

  test('unrelated add/remove pairs (same semester, different category) still show separately', () => {
    const courseMap = {
      OLD: course('OLD', 'fluids'),
      NEW: course('NEW', 'solids'),
    };
    const state = {
      semesters: { sem1: ['OLD'] },
      proposalDraft: { semesters: { sem1: ['NEW'] }, repo: [] },
    };

    const diff = runComputeDraftDiff(state, courseMap);

    expect([...diff.added]).toEqual(['NEW']);
    expect([...diff.removed]).toEqual(['OLD']);
    expect(diff.replaced.size).toBe(0);
  });

  test('plain moved course is unaffected by replacement logic', () => {
    const courseMap = {
      A: course('A', 'fluids'),
    };
    const state = {
      semesters: { sem1: ['A'] },
      proposalDraft: { semesters: { sem2: ['A'] }, repo: [] },
    };

    const diff = runComputeDraftDiff(state, courseMap);

    expect([...diff.moved]).toEqual(['A']);
    expect(diff.movedFrom.get('A')).toBe('sem1');
    expect(diff.added.size).toBe(0);
    expect(diff.removed.size).toBe(0);
    expect(diff.replaced.size).toBe(0);
  });

  test('returns null when no draft is active', () => {
    const state = { semesters: { sem1: ['A'] }, proposalDraft: null };
    expect(runComputeDraftDiff(state, {})).toBeNull();
  });
});

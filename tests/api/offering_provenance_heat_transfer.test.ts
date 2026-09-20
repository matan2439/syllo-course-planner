/**
 * Offering-provenance regression (native path) — 0542-3620 מעבר חם.
 *
 * Authoritative TAU listing (search_l.aspx?course_num=05423620, year 2025/2026)
 * lists FIVE groups: 01,02 in Semester א (A) and 05,06,07 in Semester ב (B) — the
 * course is genuinely offered in BOTH year-3 semesters. The pre-fix single-group
 * override recorded offered_semesters:["A"], narrowing effective to
 * [year_3_semester_a] and dropping Semester B. This proves the corrected data
 * reaches the planner as BOTH legal options (it does not assert placement — no
 * scoring change on the native path in this slice).
 */
import { readFileSync } from 'fs';
import { join } from 'path';
import { buildConstraintModel } from '../../api/ai/planner_model';
import { legalSemestersFor } from '../../api/ai/planner_actions';

const BOARD = JSON.parse(
  readFileSync(join(__dirname, '..', '..', 'data', 'boards', 'mechanical_engineering_2027.json'), 'utf8'),
);
function find(id: string): any {
  for (const s of BOARD.semesters) for (const c of s.courses ?? []) if (c.course_id === id) return c;
  for (const c of BOARD.metadata?.program_repository_courses ?? []) if (c.course_id === id) return c;
}

test('the board records 0542-3620 as offered in both year-3 semesters (provenance-backed)', () => {
  const c = find('0542-3620');
  expect(c.offered_semesters).toEqual(expect.arrayContaining(['A', 'B']));
  expect(c.effective_allowed_semesters).toEqual(
    expect.arrayContaining(['year_3_semester_a', 'year_3_semester_b']),
  );
  expect(typeof c.offering_source_url).toBe('string');
});

test('the planner receives both year-3 semesters as legal for 0542-3620', () => {
  const model = buildConstraintModel(BOARD, {});
  const legal = legalSemestersFor(model, '0542-3620');
  expect(legal).toContain('year_3_semester_a');
  expect(legal).toContain('year_3_semester_b'); // dropped pre-fix by the single-group override
});

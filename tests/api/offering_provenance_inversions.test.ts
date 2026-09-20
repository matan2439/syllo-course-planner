/**
 * Offering-data remediation — authoritative correction of inverted electives and
 * downgrade of self-referential "high" confidence.
 *
 * Authoritative TAU multi-group listing (year תשפ"ו 2025/2026):
 *   0542-4220 תורת התנודות  → group 01, Semester ב' → B-ONLY (board wrongly had A)
 *   0542-4224 מכניקת המוצקים → group 01, Semester א' → A-ONLY (board wrongly had B)
 * Both inversions are independently corroborated by the course's own exam/prereq
 * URL semester code (sem=2025X: 4220→B, 4224→A), which conflicts with the old
 * board.offered_semesters half-code.
 *
 * Provenance: 15 repository electives had offering_source_url "board.offered_semesters"
 * (a self-reference) at confidence "high" — a self-reference cannot justify high
 * confidence, so those must be downgraded (the offered halves are left unchanged when
 * not independently verified — no guessing).
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
const isA = (s: string) => s.endsWith('_semester_a');
const isB = (s: string) => s.endsWith('_semester_b');

test('0542-4220 תורת התנודות is corrected to B-only (authoritative)', () => {
  const c = find('0542-4220');
  expect(c.offered_semesters).toEqual(['B']);
  expect(c.effective_allowed_semesters.every(isB)).toBe(true);
  expect(c.effective_allowed_semesters.some(isA)).toBe(false);
});

test('0542-4224 is corrected to A-only (authoritative)', () => {
  const c = find('0542-4224');
  expect(c.offered_semesters).toEqual(['A']);
  expect(c.effective_allowed_semesters.every(isA)).toBe(true);
  expect(c.effective_allowed_semesters.some(isB)).toBe(false);
});

test('the planner receives ONLY B semesters for 0542-4220 and ONLY A for 0542-4224', () => {
  const model = buildConstraintModel(BOARD, {});
  const l4220 = legalSemestersFor(model, '0542-4220');
  const l4224 = legalSemestersFor(model, '0542-4224');
  expect(l4220.length).toBeGreaterThan(0);
  expect(l4220.every(isB)).toBe(true);        // never legal in Semester A
  expect(l4224.length).toBeGreaterThan(0);
  expect(l4224.every(isA)).toBe(true);        // never legal in Semester B
});

test('no offering record cites a self-referential source ("board.offered_semesters") at high confidence', () => {
  const all: any[] = [];
  for (const s of BOARD.semesters) for (const c of s.courses ?? []) all.push(c);
  for (const c of BOARD.metadata?.program_repository_courses ?? []) all.push(c);
  const offenders = all.filter(
    (c) => c.offering_source_url === 'board.offered_semesters' && c.offering_source_confidence === 'high',
  );
  expect(offenders.map((c) => c.course_id)).toEqual([]);
});

test('corrected 4220/4224 cite an authoritative TAU listing source', () => {
  for (const id of ['0542-4220', '0542-4224']) {
    const c = find(id);
    expect(c.offering_source_url).not.toBe('board.offered_semesters');
    expect(String(c.offering_source_url)).toMatch(/tau_listing|search_l\.aspx/);
    expect(c.offering_source_confidence).toBe('high'); // now justified by the listing
  }
});

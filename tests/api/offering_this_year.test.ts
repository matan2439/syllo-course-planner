/**
 * This year's offering must bind both the solver (getLegalSemesters) and the UI
 * (boardResponseToModel) the same way:
 *  - offered_in_year === false  -> excluded from the planner's universe;
 *  - a stale effective list never widens the current offered_semesters;
 *  - an empty offering list without offered_in_year === false is "unknown"
 *    (unrestricted), matching the solver's fallback.
 */

import { readFileSync } from 'fs';
import { join } from 'path';
import { getLegalSemesters } from '../../api/ai/completion_analysis';
import { boardResponseToModel } from '../../shared/planner/adapters';
import { buildConstraintModel } from '../../api/ai/planner_model';

const SEMS = ['year_3_semester_a', 'year_3_semester_b', 'year_4_semester_a', 'year_4_semester_b'];

function boardWith(course: Record<string, unknown>) {
  return {
    semesters: SEMS.map((id) => ({ semester_id: id, courses: [] })),
    warnings: [],
    metadata: { board_data_version: 'v1', program_repository_courses: [{ course_id: '0542-4999', name_he: 'x', weekly_hours: 3, ...course }] },
  };
}

describe('getLegalSemesters — current-year offering', () => {
  it('a stale effective list is narrowed to this year\'s offering', () => {
    const r = getLegalSemesters({ effective_allowed_semesters: SEMS, offered_semesters: ['A'] }, SEMS);
    expect(r.semesters).toEqual(['year_3_semester_a', 'year_4_semester_a']);
  });

  it('no offering data at all stays an unconfident any-semester fallback', () => {
    expect(getLegalSemesters({}, SEMS)).toEqual({ semesters: SEMS, confident: false });
  });
});

describe('planner universe — not offered this year', () => {
  it('a course with offered_in_year === false is excluded, with a reason', () => {
    const b = boardWith({ offered_semesters: [], offered_in_year: false });
    const p = buildConstraintModel(b as any, {}).profiles.get('0542-4999')!;
    expect(p.excluded).toBe(true);
    expect(p.exclusion_reason).toMatch(/אינו נלמד/);
  });
});

describe('boardResponseToModel — UI agrees with the solver', () => {
  it('an empty offering list is unknown (no move restriction)', () => {
    const m = boardResponseToModel(boardWith({ offered_semesters: [] }));
    expect(m.courseCatalog['0542-4999'].offeredSemesters).toBeUndefined();
  });

  it('a course verified as not offered this year has no destinations', () => {
    const m = boardResponseToModel(boardWith({ offered_semesters: [], offered_in_year: false }));
    expect(m.courseCatalog['0542-4999'].offeredSemesters).toEqual([]);
  });
});

describe('committed board — every offered course is placeable only where it is taught', () => {
  const board = JSON.parse(readFileSync(join(__dirname, '..', '..', 'data', 'boards', 'mechanical_engineering_2027.json'), 'utf8'));
  const pool: any[] = board.metadata.program_repository_courses;

  it('effective semesters never exceed offered semesters', () => {
    for (const c of pool) {
      if (!c.offered_semesters?.length || !c.effective_allowed_semesters) continue;
      const halves = new Set(c.effective_allowed_semesters.map((s: string) => (s.endsWith('_a') ? 'A' : 'B')));
      for (const h of halves) expect({ id: c.course_id, h, ok: c.offered_semesters.includes(h) }).toEqual({ id: c.course_id, h, ok: true });
    }
  });
});

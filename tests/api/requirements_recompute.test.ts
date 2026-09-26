import { normalizeCourseIdLikePython, recomputeRequirements } from '../../api/ai/requirements_recompute';
import { readFileSync } from 'fs';
import { join } from 'path';

interface Case {
  name: string;
  completed_course_ids: string[];
  semesters: Array<{ semester_id: string; courses: Array<{ course_id: string; weekly_hours: number | null }> }>;
  expected: unknown;
}
// Written by scripts/gen_requirements_parity_fixture.py from the real Python check.
const parity = JSON.parse(readFileSync(join(__dirname, 'fixtures', 'requirements_parity.json'), 'utf8')) as {
  block: any;
  cases: Case[];
};

const boardJsonFor = (c: Case, blockOverride?: unknown) => ({
  metadata: {
    program_requirements_categories: blockOverride ?? parity.block,
    program_requirements_validation: { valid: false },
    completed_course_ids: c.completed_course_ids,
  },
  // The plan itself carries each course's weekly hours, exactly like the board Python validated.
  semesters: c.semesters,
});

const planFor = (c: Case) => c.semesters.map((s) => ({
  semesterId: s.semester_id, courseIds: s.courses.map((course) => course.course_id),
}));

describe('recomputeRequirements matches validate_program_plan (Python golden output)', () => {
  test.each(parity.cases.map((c) => [c.name, c] as const))('%s', (_name, c) => {
    expect(recomputeRequirements(boardJsonFor(c), planFor(c))).toEqual(c.expected);
  });
});

describe('recomputeRequirements gating', () => {
  const base = parity.cases[0];

  test('no base snapshot on the board means nothing to refresh', () => {
    const board = boardJsonFor(base);
    delete (board.metadata as { program_requirements_validation?: unknown }).program_requirements_validation;
    expect(recomputeRequirements(board, planFor(base))).toBeNull();
  });

  test('a board generated before is_core / mandatory_course_ids existed is left alone', () => {
    const oldBlock = {
      ...parity.block,
      categories: parity.block.categories.map(({ is_core: _isCore, ...rest }: any) => rest),
    };
    expect(recomputeRequirements(boardJsonFor(base, oldBlock), planFor(base))).toBeNull();
    const { mandatory_course_ids: _mandatory, ...noMandatory } = parity.block;
    expect(recomputeRequirements(boardJsonFor(base, noMandatory), planFor(base))).toBeNull();
  });

  test('a program without a core minimum is skipped instead of guessed', () => {
    expect(recomputeRequirements(boardJsonFor(base, { ...parity.block, core_courses_total_min: null }), planFor(base))).toBeNull();
  });
});

describe('recomputeRequirements inputs', () => {
  const base = parity.cases[0];

  test('hours for a course moved in from the elective universe come from the repository list', () => {
    const board = boardJsonFor(base) as any;
    board.metadata.program_repository_courses = [{ course_id: 'ELEC-1', weekly_hours: 3 }];
    const plan = [...planFor(base), { semesterId: 'year_4_semester_b', courseIds: ['ELEC-1'] }];
    const withElective = recomputeRequirements(board, plan)!;
    const without = recomputeRequirements(board, planFor(base))!;
    expect(withElective.planned_hours - without.planned_hours).toBe(3);
    expect(withElective.unknown_hours_courses).toBe(0);
  });

  test('a course with no hours anywhere is counted as unknown, not as zero', () => {
    const plan = [...planFor(base), { semesterId: 'year_4_semester_b', courseIds: ['NOWHERE-1'] }];
    const result = recomputeRequirements(boardJsonFor(base), plan)!;
    expect(result.unknown_hours_courses).toBe(1);
    expect(result.warnings.some((w) => w.includes('1 קורסים ללא שעות'))).toBe(true);
  });

  test('ids are normalized the way Python does (8 digits become xxxx-xxxx)', () => {
    expect(normalizeCourseIdLikePython('05422400')).toBe('0542-2400');
    expect(normalizeCourseIdLikePython('0542.2400')).toBe('0542-2400');
    expect(normalizeCourseIdLikePython('0542-2400')).toBe('0542-2400');
    expect(normalizeCourseIdLikePython('ELEC-1')).toBe('ELEC-1');
  });
});

describe('unnamed completed courses', () => {
  test('count toward a category without being listed as selected courses', () => {
    const base = parity.cases[0];
    const cat = (parity.block.categories as Array<{ category_id: string; min_courses?: number }>)
      .find((c) => (c.min_courses ?? 1) > 0)!;
    const min = cat.min_courses ?? 1;
    const before = recomputeRequirements(boardJsonFor(base), planFor(base))!
      .category_results.find((c) => c.category_id === cat.category_id)!;
    const after = recomputeRequirements(boardJsonFor(base), planFor(base), { [cat.category_id]: min })!
      .category_results.find((c) => c.category_id === cat.category_id)!;
    expect(after.selected_count).toBe(before.selected_count + min);
    expect(after.selected_courses).toEqual(before.selected_courses);
    expect(after).toMatchObject({ satisfied: true, missing_count: 0 });
  });
});

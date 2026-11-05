import { buildConstraintModel } from '../../api/ai/planner_model';
import { validateCandidate } from '../../api/ai/planner_validate';
import { boardRequirementsValidationSchema } from '../../shared/planner/wire';
import { requirementsToModel } from '../../shared/planner/adapters';
import { identifiedCourseIdsFromContext, normalizeCourseIdLikePython, recomputeRequirements } from '../../api/ai/requirements_recompute';
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

describe('unnamed completed category courses count toward total credits (שער רוח rule)', () => {
  const block = {
    total_required_hours: 20, core_courses_total_min: 0, mandatory_course_ids: [],
    categories: [
      { category_id: 'shaar_ruach', name_he: 'קורסי שער רוח', min_courses: 3, is_core: false, course_ids: ['SR1', 'SR2', 'SR3'] },
      { category_id: 'mixed', name_he: 'מעורב', min_courses: 1, is_core: false, course_ids: ['M1', 'M2'] },
    ],
  };
  const board = {
    metadata: {
      program_requirements_categories: block, program_requirements_validation: { valid: false }, completed_course_ids: [],
      program_repository_courses: [
        { course_id: 'SR1', weekly_hours: 2 }, { course_id: 'SR2', weekly_hours: 2 }, { course_id: 'SR3', weekly_hours: 2 },
        { course_id: 'M1', weekly_hours: 3 }, { course_id: 'M2', weekly_hours: 4 },
      ],
    },
    semesters: [],
  };
  const plan = [{ semesterId: 'year_3_semester_a', courseIds: ['SR1'] }];

  test('placed + counted שער רוח courses both add their 2 credits to the degree total', () => {
    const r = recomputeRequirements(board, plan, { shaar_ruach: 2 })!;
    expect(r.planned_hours).toBe(6); // 1 placed + 2 counted, 2 each
    expect(r.remaining_hours).toBe(14);
    expect(r.category_results.find((c) => c.category_id === 'shaar_ruach')).toMatchObject({ selected_count: 3, satisfied: true });
  });

  test('without the counter the total is unchanged (regression guard)', () => {
    expect(recomputeRequirements(board, plan)!.planned_hours).toBe(2);
  });

  test('a mixed-hours category is not guessed: flagged as unknown hours instead', () => {
    const r = recomputeRequirements(board, plan, { mixed: 1 })!;
    expect(r.planned_hours).toBe(2);
    expect(r.unknown_hours_courses).toBe(1);
  });
});


describe('generic group minimums end to end in TS', () => {
  const ids = Array.from({ length: 12 }, (_, i) => `0599-${1001 + i}`);
  const boardFor = (count: number) => ({
    semesters: [{ semester_id: 'year_3_semester_a', courses: [...ids.slice(0, count), 'LAB'].map(course_id => ({
      course_id, name_he: course_id, weekly_hours: 1, prerequisites: [],
    })) }],
    metadata: {
      completed_course_ids: [ids[0]], program_requirements_validation: { valid: false },
      program_repository_courses: ids.map(course_id => ({ course_id, weekly_hours: 1 })),
      program_requirements_categories: {
        total_required_hours: 1, core_courses_total_min: null, mandatory_course_ids: [],
        group_minimums: { track: 12 },
        categories: [
          { category_id: 'a', group: 'track', min_courses: 0, is_core: false, course_ids: ids.slice(0, 8) },
          { category_id: 'b', group: 'track', min_courses: 0, is_core: false, course_ids: ids.slice(4) },
          { category_id: 'labs', group: 'lab', min_courses: 0, is_core: false, course_ids: ['LAB'] },
        ],
      },
    },
  });

  test.each([11, 12])('%i unique track courses: overlap and labs cannot fill the minimum', count => {
    const board = boardFor(count);
    const result = recomputeRequirements(board, planFor(board as any), { a: 20, b: 20 })!;
    expect(result).not.toBeNull();
    expect(result.valid).toBe(count === 12);
    expect(result).toMatchObject({ group_results: [{ group: 'track', min_courses: 12,
      selected_courses: ids.slice(0, count), selected_count: count, satisfied: count === 12, missing_count: 12 - count }] });
    expect(result.missing_required_categories).toEqual(count === 12 ? [] : ['group:track']);
    expect(boardRequirementsValidationSchema.safeParse(result).success).toBe(true);
    expect(requirementsToModel(boardRequirementsValidationSchema.parse(result)).categories)
      .toEqual(expect.arrayContaining([expect.objectContaining({ categoryId: 'group:track',
        nameHe: 'קורסי מסלול', selectedCount: count, minCourses: 12, satisfied: count === 12 })]));
  });

  test.each([11, 12])('planner candidate gate enforces the same union at %i', count => {
    const board = boardFor(count);
    const model = buildConstraintModel(board, { completedCountByCategory: { a: 20, b: 20 } });
    const state = { semesters: { year_3_semester_a: [...ids.slice(1, count), 'LAB'] } };
    const result = validateCandidate(state, model);
    expect(result.valid).toBe(count === 12);
    expect(result.unsatisfiedCategories).toEqual(count === 12 ? [] : ['group:track']);
  });

  test.each(['completed', 'currently_taking'])('identified %s progress counts once in the display', key => {
    const board = boardFor(12);
    board.metadata.completed_course_ids = [];
    const context = { personal_status: { [key]: [{ course_id: ids[0] }, { course_id: ids[0] }, { course_id: 'unknown' }] } };
    const result = recomputeRequirements(board,
      [{ semesterId: 'year_3_semester_a', courseIds: ids.slice(1) }], {}, identifiedCourseIdsFromContext(context))!;
    expect(result.group_results?.[0]).toMatchObject({ selected_count: 12, satisfied: true });
  });

  test('in-progress courses count toward the group and cannot be demanded again', () => {
    const board = boardFor(12);
    board.metadata.completed_course_ids = [];
    const model = buildConstraintModel(board, { currentlyPlannedCourseIds: [ids[0], 'unknown'] });
    expect(model.categories.find(c => c.id === 'group:track')?.required).toBe(11);
    expect(validateCandidate({ semesters: { year_3_semester_a: ids.slice(1) } }, model).unsatisfiedCategories).toEqual([]);
  });
});

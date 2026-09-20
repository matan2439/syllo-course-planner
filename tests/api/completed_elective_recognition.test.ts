/**
 * A1 — RED: an authoritatively completed elective does not reduce its category.
 *
 * E0 traced the real path and found one precise asymmetry in the SHARED
 * requirement accounting (`assessCompleteness`, planner_goals.ts):
 *
 *     missingMandatory      … filters on `model.completedCourseIds`  ✔
 *     unsatisfiedCategories … does NOT                               ✘
 *
 * `buildConstraintModel` sets `CategoryReq.required` to the program's FULL
 * `min_courses` and never reduces it, and `categoriesSatisfied` counts only
 * courses PLACED in the plan state — which `planContextToState` has already
 * stripped completed courses from. So a student who has genuinely completed
 * the one course their category requires is still told to take another.
 *
 * Degree HOURS are already handled (`priorHours`), and mandatory courses are
 * already handled — this is specifically about elective CATEGORIES.
 *
 * The proof runs through the real `generate-plan` handler, not the accounting
 * in isolation, because the defect only matters if it reaches a plan.
 */
jest.mock('../../api/ai/board_loader', () => ({ loadLocalBoardJson: jest.fn(() => BOARD) }));
jest.mock('../../api/ai/evidence_loader', () => ({ loadPreparedEvidenceDocuments: jest.fn(() => []) }));

import handler from '../../api/ai/generate-plan';
import { randomUUID } from 'crypto';
import { buildConstraintModel } from '../../api/ai/planner_model';
import { assessCompleteness } from '../../api/ai/planner_goals';
import { emptyState } from '../../api/ai/planner_types';

const SEM_A = 'year_3_semester_a';
const SEM_B = 'year_3_semester_b';

/**
 * A deliberately small, EXPLICIT program: two disjoint categories, each needing
 * exactly one course, mirroring the real TAU shape (`min_courses` is a COUNT,
 * and the real pools are pairwise disjoint — verified against
 * data/boards/mechanical_engineering_2027.json).
 */
/**
 * `fluids` has a pool of exactly ONE course. That makes the end-to-end test a
 * real discriminator rather than a matter of taste: once the student has
 * completed FLU1, an engine that still believes `fluids` is outstanding has NO
 * candidate left to satisfy it with, so it cannot produce a complete plan at
 * all. An engine that recognizes the completion simply plans the solids course.
 */
const CAT_A_POOL = ['FLU1'];
const CAT_B_POOL = ['SOL1', 'SOL2'];
const ALL_ELECTIVES = [...CAT_A_POOL, ...CAT_B_POOL];

const course = (id: string) => ({
  course_id: id, name_he: `קורס ${id}`, weekly_hours: 4, is_mandatory: false,
  course_type: 'elective', placement_policy: 'elective',
  offered_semesters: [SEM_A, SEM_B], prerequisites: [],
});

const BOARD = {
  semesters: [SEM_A, SEM_B].map((id) => ({ semester_id: id, courses: [] })),
  metadata: {
    board_data_version: 'completed-elective-1',
    completed_course_ids: [],
    program_requirements_categories: {
      // 8 ש"ש = exactly two 4-hour courses, so the degree-hours goal alone
      // cannot be what forces or prevents a second course.
      total_required_hours: 8,
      categories: [
        { category_id: 'fluids', name_he: 'זרימה', min_courses: 1, course_ids: CAT_A_POOL },
        { category_id: 'solids', name_he: 'מוצקים', min_courses: 1, course_ids: CAT_B_POOL },
      ],
    },
    program_repository_courses: ALL_ELECTIVES.map(course),
  },
};

function makeRes() {
  const res: any = {
    statusCode: 0, _headers: {} as Record<string, unknown>,
    setHeader: jest.fn(function (this: any, k: string, v: unknown) { this._headers[k] = v; return this; }),
    getHeader: jest.fn(function (this: any, k: string) { return this._headers[k]; }),
    status: jest.fn(function (this: any, c: number) { this.statusCode = c; return this; }),
    json: jest.fn(function (this: any, b: any) { this._body = b; return this; }),
    write: jest.fn(), end: jest.fn(),
  };
  return res;
}

const completedEntry = (id: string) => ({ course_id: id });

async function generate(completedIds: string[], over: Record<string, unknown> = {}) {
  const res = makeRes();
  await handler({
    method: 'POST', headers: {},
    body: {
      program_id: 'test_program_completed_elective_2027',
      plan_context: {
        personal_status: {
          completed: completedIds.map(completedEntry),
          currently_taking: [],
          completed_knowledge: { status: 'known', provenance: 'explicit_user' },
        },
      },
      preferences: { disallowed_course_ids: [] },
      session_token: randomUUID(),
      use_academic_decision_agent: true,
      preference_profile: { version: 1, preferences: [] },
      ...over,
    },
  } as any, res);
  return res;
}

const plannedCourses = (body: any): string[] =>
  [...new Set(((body?.semesters ?? []) as any[]).flatMap((s) => s.course_ids as string[]))].sort();

beforeAll(() => { process.env.AI_DEV_MODE = 'true'; process.env.AI_DEV_BYPASS_QUOTA = 'true'; });
afterAll(() => { delete process.env.AI_DEV_MODE; delete process.env.AI_DEV_BYPASS_QUOTA; });

// ── the accounting, at its source ───────────────────────────────────────────

describe('A1 — the shared requirement accounting must honour completion', () => {
  const model = (completed: string[]) =>
    buildConstraintModel(BOARD as never, { completedCourseIds: completed });

  test('MANDATORY already honours completion — the reference behaviour', () => {
    // Nothing is mandatory in this fixture, but the asymmetry is visible in the
    // model itself: mandatory requirements are filtered by completion.
    const m = model(['FLU1']);
    expect(m.completedCourseIds.has('FLU1')).toBe(true);
    expect(m.requiredMandatoryCourseIds).not.toContain('FLU1');
    // …and the hours are credited.
    expect(m.priorHours).toBe(4);
  });

  test('a completed elective SATISFIES its category', () => {
    const m = model(['FLU1']);
    // An empty plan: the student has placed nothing yet. The `fluids`
    // requirement is already met by what they completed, so only `solids`
    // should remain outstanding.
    const assessed = assessCompleteness(emptyState(m.knownSemesterIds), m);
    expect(assessed.unsatisfiedCategories).toEqual(['solids']);
  });

  test('an UNKNOWN completed id satisfies nothing and credits nothing', () => {
    const m = model(['NOT_IN_CATALOG']);
    const assessed = assessCompleteness(emptyState(m.knownSemesterIds), m);
    expect(assessed.unsatisfiedCategories.sort()).toEqual(['fluids', 'solids']);
    expect(m.priorHours).toBe(0); // no guessed credits
  });

  test('a DUPLICATE completed id is counted once', () => {
    const m = model(['FLU1', 'FLU1', 'FLU1']);
    expect(m.priorHours).toBe(4);
    const assessed = assessCompleteness(emptyState(m.knownSemesterIds), m);
    expect(assessed.unsatisfiedCategories).toEqual(['solids']);
  });

  test('completion recognition does not depend on input order', () => {
    const forward = assessCompleteness(emptyState(model(['FLU1', 'SOL1']).knownSemesterIds), model(['FLU1', 'SOL1']));
    const reversed = assessCompleteness(emptyState(model(['SOL1', 'FLU1']).knownSemesterIds), model(['SOL1', 'FLU1']));
    expect(forward.unsatisfiedCategories).toEqual([]);
    expect(reversed.unsatisfiedCategories).toEqual(forward.unsatisfiedCategories);
  });
});

// ── and it must reach a real plan ───────────────────────────────────────────

describe('A1 — the defect as the student experiences it', () => {
  test('with NOTHING completed, the plan takes one course from each category', async () => {
    const body = (await generate([]))._body;
    const planned = plannedCourses(body);
    expect(planned).toContain('FLU1');
    expect(planned.some((id) => CAT_B_POOL.includes(id))).toBe(true);
    expect(body.blocked).toBe(false);
  });

  test('a completed elective is never scheduled again', async () => {
    const body = (await generate(['FLU1']))._body;
    expect(plannedCourses(body)).not.toContain('FLU1');
  });

  /**
   * THE RED. Having completed FLU1 — the only course in the `fluids` pool — the
   * requirement is met and nothing more is owed to it. An engine that still
   * counts `fluids` as outstanding has nothing left to satisfy it with, so it
   * cannot produce a complete, unblocked plan.
   */
  test('a completed elective satisfies its category END TO END', async () => {
    const body = (await generate(['FLU1']))._body;

    expect(body.blocked).toBe(false);
    expect(body.errors).toEqual([]);
    // The genuinely outstanding category is still covered…
    expect(plannedCourses(body).some((id) => CAT_B_POOL.includes(id))).toBe(true);
    // …and the completed course is not scheduled again.
    expect(plannedCourses(body)).not.toContain('FLU1');
  });

  test('the same completion reported TWICE behaves identically', async () => {
    const once = (await generate(['FLU1']))._body;
    const twice = (await generate(['FLU1', 'FLU1']))._body;
    expect(plannedCourses(twice)).toEqual(plannedCourses(once));
    expect(twice.blocked).toBe(false);
  });

  test('an unrecognized completed id does NOT reduce any requirement', async () => {
    const body = (await generate(['NOT_IN_CATALOG']))._body;
    const planned = plannedCourses(body);
    // Both categories still have to be covered by the plan itself.
    expect(planned).toContain('FLU1');
    expect(planned.some((id) => CAT_B_POOL.includes(id))).toBe(true);
  });

  test('an aggregate hours figure never satisfies a category', async () => {
    // A big `known_completed_hours` with no course ids must change nothing:
    // hours are not an identity, and an identity is what a category needs.
    const body = (await generate([], {
      plan_context: {
        personal_status: {
          completed: [], currently_taking: [],
          completed_knowledge: { status: 'known', provenance: 'explicit_user' },
        },
        total_hours_progress: { known_completed_hours: 400 },
      },
    }))._body;
    const planned = plannedCourses(body);
    expect(planned).toContain('FLU1');
    expect(planned.some((id) => CAT_B_POOL.includes(id))).toBe(true);
  });
});

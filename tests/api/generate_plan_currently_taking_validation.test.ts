/**
 * Current/In-Progress Courses Validation Propagation — tests for wiring
 * plan_context.personal_status.currently_taking into ConstraintModel's
 * currentlyPlannedCourseIds (via buildValidationContext, planner_validate.ts),
 * so a currently-taking course is never re-proposed by the planner.
 *
 * Originally flag-gated (AI_USE_ACADEMIC_CLARIFICATION_PREFLIGHT) only; since
 * the "honor currently_taking on the default path" epic this is an explicitly
 * approved default-behavior change: personal_status.currently_taking is
 * already sent by the live frontend (app/web/semester_board_viewer.html) on
 * every request, and ignoring it caused incorrect prerequisite/eligibility
 * behavior. generate-plan.ts's handler now computes currentlyPlannedCourseIds
 * unconditionally (from effectivePlanContext, so clarification_answers still
 * layer on top when the flag is enabled) — tests 1/1b prove the default path,
 * tests 2-5 the flagged paths.
 *
 * Reuses the MAND (mandatory, completed) + FLU (sole "fluids" category
 * candidate) fixture from generate_plan_clarification_propagation.test.ts —
 * the greedy planner deterministically places FLU whenever it isn't excluded.
 *
 * This file only imports the existing, unmodified default export — it does
 * not touch any other generate-plan test file.
 */

import handler from '../../api/ai/generate-plan';
import { randomUUID } from 'crypto';

const PLAN_CONTEXT_WITH_COMPLETED = {
  program_name: 'בדיקה',
  semesters: [
    { id: 'year_3_semester_a', label: "שנה ג׳ א׳", total_hours: 4, courses: [
      { course_id: 'MAND', name_he: 'חובה', hours: 4, course_type: 'mandatory', placement_policy: 'fixed', effective_allowed_semesters: ['year_3_semester_a'] },
    ] },
    { id: 'year_3_semester_b', label: "שנה ג׳ ב׳", total_hours: 0, courses: [] },
    { id: 'year_4_semester_a', label: "שנה ד׳ א׳", total_hours: 0, courses: [] },
    { id: 'year_4_semester_b', label: "שנה ד׳ ב׳", total_hours: 0, courses: [] },
  ],
  category_requirements: [
    { name: 'זורמים', category_id: 'fluids', required: 1, placed: 0, candidates: [
      { course_id: 'FLU', name_he: 'זורם', hours: 4, effective_allowed_semesters: ['year_4_semester_a', 'year_4_semester_b'] },
    ] },
  ],
  total_hours_progress: { known_completed_hours: 177, degree_required_hours: 185 },
  personal_status: { completed: [{ course_id: 'MAND' }] },
  mandatory_unplaced: [],
};

function withCurrentlyTaking(courseIds: string[]) {
  return {
    ...PLAN_CONTEXT_WITH_COMPLETED,
    personal_status: {
      ...PLAN_CONTEXT_WITH_COMPLETED.personal_status,
      currently_taking: courseIds.map((course_id) => ({ course_id })),
    },
  };
}

function makeReq(body: any, method = 'POST') {
  return { method, body } as any;
}
function makeRes() {
  const res: any = {
    statusCode: 0,
    setHeader: jest.fn().mockReturnThis(),
    status: jest.fn(function (this: any, c: number) { this.statusCode = c; return this; }),
    json: jest.fn(function (this: any, b: any) { this._body = b; return this; }),
    write: jest.fn(),
    end: jest.fn(),
  };
  return res;
}

function baseReqBody(overrides: any = {}) {
  return {
    program_id: 'test_program_2027',
    plan_context: PLAN_CONTEXT_WITH_COMPLETED,
    // disallowed_course_ids: [] (not undefined) so excluded_courses isn't a
    // critical clarification gap unrelated to what this file is testing.
    preferences: { disallowed_course_ids: [] },
    session_token: randomUUID(),
    ...overrides,
  };
}

describe('generate-plan — currently_taking courses excluded from validation/re-proposal (AI_USE_ACADEMIC_CLARIFICATION_PREFLIGHT opt-in)', () => {
  beforeEach(() => {
    process.env.AI_DEV_MODE = 'true';
    process.env.AI_DEV_BYPASS_QUOTA = 'true';
  });
  afterEach(() => {
    delete process.env.AI_DEV_MODE;
    delete process.env.AI_DEV_BYPASS_QUOTA;
    delete process.env.AI_USE_ACADEMIC_CLARIFICATION_PREFLIGHT;
    delete process.env.AI_USE_AGENTIC_PLANNER;
  });

  test('1. flag disabled (default production path): personal_status.currently_taking excludes FLU from the proposal', async () => {
    const res = makeRes();
    await handler(
      makeReq(baseReqBody({ plan_context: withCurrentlyTaking(['FLU']) })),
      res,
    );
    const b = res._body;
    expect(res.statusCode).toBe(200);
    const placedIds = b.semesters.flatMap((s: any) => s.course_ids);
    expect(placedIds).not.toContain('FLU');
  });

  test('1b. flag disabled, no currently_taking: FLU is still placed (no false-positive exclusion on the default path)', async () => {
    const res = makeRes();
    await handler(makeReq(baseReqBody()), res);
    const b = res._body;
    expect(res.statusCode).toBe(200);
    const placedIds = b.semesters.flatMap((s: any) => s.course_ids);
    expect(placedIds).toContain('FLU');
  });

  test('2. flag enabled, currently_taking sent directly on plan_context: FLU is excluded from the proposal', async () => {
    process.env.AI_USE_ACADEMIC_CLARIFICATION_PREFLIGHT = 'true';
    const res = makeRes();
    await handler(
      makeReq(baseReqBody({ plan_context: withCurrentlyTaking(['FLU']) })),
      res,
    );
    const b = res._body;
    expect(b.needsClarification).toBeUndefined();
    const placedIds = b.semesters.flatMap((s: any) => s.course_ids);
    expect(placedIds).not.toContain('FLU');
    const fluidsRow = b.requirements_status.find((r: any) => r.name === 'זורמים');
    expect(fluidsRow.satisfied).toBe(false);
  });

  test('3. flag enabled, current_courses via clarification_answers: FLU is excluded from the proposal', async () => {
    process.env.AI_USE_ACADEMIC_CLARIFICATION_PREFLIGHT = 'true';
    const res = makeRes();
    await handler(
      makeReq(baseReqBody({
        clarification_answers: [{ questionId: 'current_courses', value: ['FLU'] }],
      })),
      res,
    );
    const b = res._body;
    expect(b.needsClarification).toBeUndefined();
    const placedIds = b.semesters.flatMap((s: any) => s.course_ids);
    expect(placedIds).not.toContain('FLU');
  });

  test('4. flag enabled + AI_USE_AGENTIC_PLANNER enabled: FLU is excluded on the agentic path too', async () => {
    process.env.AI_USE_ACADEMIC_CLARIFICATION_PREFLIGHT = 'true';
    process.env.AI_USE_AGENTIC_PLANNER = 'true';
    const res = makeRes();
    await handler(
      makeReq(baseReqBody({ plan_context: withCurrentlyTaking(['FLU']) })),
      res,
    );
    const b = res._body;
    expect(b.needsClarification).toBeUndefined();
    expect(Array.isArray(b.semesters)).toBe(true);
    const placedIds = b.semesters.flatMap((s: any) => s.course_ids);
    expect(placedIds).not.toContain('FLU');
  });

  test('5. flag enabled, no currently_taking anywhere: FLU is still placed (no false-positive exclusion)', async () => {
    process.env.AI_USE_ACADEMIC_CLARIFICATION_PREFLIGHT = 'true';
    const res = makeRes();
    await handler(
      makeReq(baseReqBody()),
      res,
    );
    const b = res._body;
    expect(b.needsClarification).toBeUndefined();
    const placedIds = b.semesters.flatMap((s: any) => s.course_ids);
    expect(placedIds).toContain('FLU');
  });
});

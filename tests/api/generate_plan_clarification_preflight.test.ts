/**
 * Feature-flagged Clarification Preflight Integration — tests for the
 * AI_USE_ACADEMIC_CLARIFICATION_PREFLIGHT-gated block in api/ai/generate-plan.ts.
 *
 * Proves: (1) default (flag unset/false) behavior is byte-for-byte the same
 * response contract as before this epic; (2) when enabled and a critical
 * clarification input is missing, the handler returns a structured
 * clarification response instead of delegating to either planner path;
 * (3) when enabled and all critical inputs are present, the handler falls
 * through to the existing planning behavior unchanged; (4) the pre-existing
 * AI_USE_AGENTIC_PLANNER flag is unaffected by this new flag's presence.
 *
 * This file only imports the existing, unmodified default export — it does
 * not touch tests/api/generate-plan.test.ts, so those tests remain untouched
 * and unaffected by this epic.
 */

import handler from '../../api/ai/generate-plan';
import { randomUUID } from 'crypto';

const PLAN_CONTEXT = {
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
  personal_status: { completed: [] },
  mandatory_unplaced: [],
};

const PLAN_CONTEXT_WITH_COMPLETED = {
  ...PLAN_CONTEXT,
  personal_status: { completed: [{ course_id: 'MAND' }] },
};

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
    plan_context: PLAN_CONTEXT,
    preferences: {},
    session_token: randomUUID(),
    ...overrides,
  };
}

describe('generate-plan — AI_USE_ACADEMIC_CLARIFICATION_PREFLIGHT (opt-in)', () => {
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

  test('flag disabled (unset): existing generate-plan response contract is unchanged', async () => {
    const res = makeRes();
    await handler(makeReq(baseReqBody()), res);

    expect(res.statusCode).toBe(200);
    const b = res._body;
    expect(Array.isArray(b.semesters)).toBe(true);
    expect(Array.isArray(b.moves)).toBe(true);
    expect(Array.isArray(b.warnings_he)).toBe(true);
    expect(typeof b.rationale_he).toBe('string');
    expect(Array.isArray(b.requirements_status)).toBe(true);
    expect(Array.isArray(b.errors)).toBe(true);
    expect(typeof b.blocked).toBe('boolean');
  });

  test('flag disabled: no clarification or view model is returned', async () => {
    const res = makeRes();
    await handler(makeReq(baseReqBody()), res);

    const b = res._body;
    expect(b.needsClarification).toBeUndefined();
    expect(b.clarification).toBeUndefined();
    expect(b.viewModel).toBeUndefined();
  });

  test('flag enabled, critical inputs missing: planning is not delegated (no proposal shape in response)', async () => {
    process.env.AI_USE_ACADEMIC_CLARIFICATION_PREFLIGHT = 'true';
    const res = makeRes();
    await handler(makeReq(baseReqBody({ plan_context: PLAN_CONTEXT })), res);

    const b = res._body;
    expect(b.semesters).toBeUndefined();
    expect(b.moves).toBeUndefined();
    expect(b.rationale_he).toBeUndefined();
  });

  test('flag enabled, critical inputs missing: response includes structured clarification questions', async () => {
    process.env.AI_USE_ACADEMIC_CLARIFICATION_PREFLIGHT = 'true';
    const res = makeRes();
    await handler(makeReq(baseReqBody({ plan_context: PLAN_CONTEXT })), res);

    const b = res._body;
    expect(b.needsClarification).toBe(true);
    expect(b.clarification.questions.map((q: any) => q.id)).toEqual(
      expect.arrayContaining(['completed_courses', 'current_courses', 'excluded_courses', 'max_weekly_hours', 'track_or_focus']),
    );
  });

  test('flag enabled, critical inputs missing: response includes the clarification view model', async () => {
    process.env.AI_USE_ACADEMIC_CLARIFICATION_PREFLIGHT = 'true';
    const res = makeRes();
    await handler(makeReq(baseReqBody({ plan_context: PLAN_CONTEXT })), res);

    const b = res._body;
    expect(b.viewModel.needsUserInput).toBe(true);
    expect(b.viewModel.blocking).toBe(true);
    expect(Array.isArray(b.viewModel.items)).toBe(true);
    expect(b.viewModel.items[0].id).toBe('completed_courses');
  });

  test('flag enabled, required (critical) context present: planning delegates normally', async () => {
    process.env.AI_USE_ACADEMIC_CLARIFICATION_PREFLIGHT = 'true';
    const res = makeRes();
    await handler(
      makeReq(baseReqBody({
        plan_context: PLAN_CONTEXT_WITH_COMPLETED,
        preferences: { disallowed_course_ids: [] },
      })),
      res,
    );

    const b = res._body;
    expect(b.needsClarification).toBeUndefined();
    expect(b.clarification).toBeUndefined();
    expect(Array.isArray(b.semesters)).toBe(true);
    expect(typeof b.rationale_he).toBe('string');
  });

  test('AI_USE_AGENTIC_PLANNER behavior is unaffected when the preflight flag is unset', async () => {
    process.env.AI_USE_AGENTIC_PLANNER = 'true';
    const res = makeRes();
    await handler(makeReq(baseReqBody()), res);

    expect(res.statusCode).toBe(200);
    const b = res._body;
    expect(Array.isArray(b.semesters)).toBe(true);
    expect(Array.isArray(b.trace)).toBe(true);
    expect(b.needsClarification).toBeUndefined();
  });
});

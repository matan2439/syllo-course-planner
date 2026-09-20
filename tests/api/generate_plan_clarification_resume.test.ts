/**
 * Feature-flagged Clarification Answer Resume — tests for the
 * `clarification_answers` intake added to the AI_USE_ACADEMIC_CLARIFICATION_PREFLIGHT
 * block in api/ai/generate-plan.ts.
 *
 * Proves: (1) flag disabled — clarification_answers are ignored, existing
 * response contract is unchanged; (2) flag enabled + no answers — current
 * clarification-blocking behavior is unchanged; (3) flag enabled + valid
 * answers for all critical fields — planning delegates normally; (4) flag
 * enabled + partial answers — planning is still not delegated while a
 * critical input remains missing; (5) flag enabled + invalid answers — the
 * response's view model surfaces validation messages, and the request is not
 * silently treated as complete; (6) AI_USE_AGENTIC_PLANNER is unaffected.
 *
 * This file only imports the existing, unmodified default export — it does
 * not touch tests/api/generate-plan.test.ts or
 * tests/api/generate_plan_clarification_preflight.test.ts.
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

describe('generate-plan — clarification_answers resume (AI_USE_ACADEMIC_CLARIFICATION_PREFLIGHT opt-in)', () => {
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

  const VALID_ANSWERS_ALL_CRITICAL = [
    { questionId: 'completed_courses', value: ['MAND'] },
    { questionId: 'excluded_courses', value: [] },
  ];

  test('8. flag disabled: existing response contract is unchanged even with clarification_answers present', async () => {
    const res = makeRes();
    await handler(makeReq(baseReqBody({ clarification_answers: VALID_ANSWERS_ALL_CRITICAL })), res);

    expect(res.statusCode).toBe(200);
    const b = res._body;
    expect(Array.isArray(b.semesters)).toBe(true);
    expect(b.needsClarification).toBeUndefined();
    expect(b.clarification).toBeUndefined();
    expect(b.viewModel).toBeUndefined();
  });

  test('9. flag enabled, no answers: current clarification-blocking behavior is unchanged', async () => {
    process.env.AI_USE_ACADEMIC_CLARIFICATION_PREFLIGHT = 'true';
    const res = makeRes();
    await handler(makeReq(baseReqBody()), res);

    const b = res._body;
    expect(b.needsClarification).toBe(true);
    expect(b.semesters).toBeUndefined();
    expect(b.clarification.questions.map((q: any) => q.id)).toEqual(
      expect.arrayContaining(['completed_courses', 'excluded_courses']),
    );
  });

  test('10. flag enabled, valid answers for all critical fields: planning delegates normally', async () => {
    process.env.AI_USE_ACADEMIC_CLARIFICATION_PREFLIGHT = 'true';
    const res = makeRes();
    await handler(
      makeReq(baseReqBody({ clarification_answers: VALID_ANSWERS_ALL_CRITICAL })),
      res,
    );

    const b = res._body;
    expect(b.needsClarification).toBeUndefined();
    expect(b.clarification).toBeUndefined();
    expect(Array.isArray(b.semesters)).toBe(true);
    expect(typeof b.rationale_he).toBe('string');
  });

  test('11. flag enabled, partial answers: planning is still not delegated while a critical input remains missing', async () => {
    process.env.AI_USE_ACADEMIC_CLARIFICATION_PREFLIGHT = 'true';
    const res = makeRes();
    await handler(
      makeReq(baseReqBody({
        clarification_answers: [{ questionId: 'completed_courses', value: ['MAND'] }],
      })),
      res,
    );

    const b = res._body;
    expect(b.needsClarification).toBe(true);
    expect(b.semesters).toBeUndefined();
    expect(b.clarification.questions.map((q: any) => q.id)).toContain('excluded_courses');
    expect(b.clarification.questions.map((q: any) => q.id)).not.toContain('completed_courses');
  });

  test('12. flag enabled, invalid answers: response view model includes validation messages', async () => {
    process.env.AI_USE_ACADEMIC_CLARIFICATION_PREFLIGHT = 'true';
    const res = makeRes();
    await handler(
      makeReq(baseReqBody({
        clarification_answers: [{ questionId: 'max_weekly_hours', value: 'not-a-number' }],
      })),
      res,
    );

    const b = res._body;
    expect(b.needsClarification).toBe(true);
    expect(b.semesters).toBeUndefined();
    const maxHoursItem = b.viewModel.items.find((i: any) => i.id === 'max_weekly_hours');
    expect(maxHoursItem.validationMessage).toBeDefined();
  });

  test('13. AI_USE_AGENTIC_PLANNER behavior is unaffected by clarification_answers', async () => {
    process.env.AI_USE_AGENTIC_PLANNER = 'true';
    const res = makeRes();
    await handler(makeReq(baseReqBody({ clarification_answers: VALID_ANSWERS_ALL_CRITICAL })), res);

    expect(res.statusCode).toBe(200);
    const b = res._body;
    expect(Array.isArray(b.semesters)).toBe(true);
    expect(Array.isArray(b.trace)).toBe(true);
    expect(b.needsClarification).toBeUndefined();
  });
});

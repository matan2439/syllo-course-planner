/**
 * Product regression — currently-taking prerequisite unlocks a future eligible
 * course, end-to-end through the default generate-plan path.
 *
 * Scenario: the user is currently taking PRE (personal_status.currently_taking,
 * NOT completed). ADV requires PRE and is the sole candidate of a required
 * category, so the greedy planner deterministically places it whenever it is
 * legal. The planner must not treat "currently taking PRE" as "PRE does not
 * exist": ADV must be placeable in a future semester.
 *
 * Uses its own board fixture (data/boards/test_program_prereq_2027.json —
 * MAND completed + PRE elective + ADV requiring PRE); does not modify
 * test_program_2027.json or any prior generate-plan test file.
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
    { name: 'מתקדמים', category_id: 'advanced', required: 1, placed: 0, candidates: [
      { course_id: 'ADV', name_he: 'מתקדם', hours: 4, effective_allowed_semesters: ['year_4_semester_a', 'year_4_semester_b'] },
    ] },
  ],
  total_hours_progress: { known_completed_hours: 177, degree_required_hours: 185 },
  personal_status: { completed: [{ course_id: 'MAND' }] },
  mandatory_unplaced: [],
};

function withPersonalStatus(personalStatus: any) {
  return { ...PLAN_CONTEXT, personal_status: personalStatus };
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
    program_id: 'test_program_prereq_2027',
    plan_context: PLAN_CONTEXT,
    preferences: { disallowed_course_ids: [] },
    session_token: randomUUID(),
    ...overrides,
  };
}

function placedIdsOf(body: any): string[] {
  return body.semesters.flatMap((s: any) => s.course_ids);
}

describe('generate-plan — currently-taking prerequisite unlocks a future eligible course (default path)', () => {
  beforeEach(() => {
    process.env.AI_DEV_MODE = 'true';
    process.env.AI_DEV_BYPASS_QUOTA = 'true';
  });
  afterEach(() => {
    delete process.env.AI_DEV_MODE;
    delete process.env.AI_DEV_BYPASS_QUOTA;
    delete process.env.AI_USE_AGENTIC_PLANNER;
  });

  test('1. product scenario: PRE currently taking (not completed) → ADV is placed in a future semester', async () => {
    const res = makeRes();
    await handler(
      makeReq(baseReqBody({
        plan_context: withPersonalStatus({
          completed: [{ course_id: 'MAND' }],
          currently_taking: [{ course_id: 'PRE' }],
        }),
      })),
      res,
    );
    const b = res._body;
    expect(res.statusCode).toBe(200);
    const placed = placedIdsOf(b);
    expect(placed).toContain('ADV');
    // The currently-taking course itself must never be re-proposed (rule 2a).
    expect(placed).not.toContain('PRE');
  });

  test('2. negative: PRE neither completed, currently taking, nor placeable (excluded) → ADV stays blocked', async () => {
    const res = makeRes();
    await handler(
      makeReq(baseReqBody({
        preferences: { disallowed_course_ids: ['PRE'] },
      })),
      res,
    );
    const b = res._body;
    expect(res.statusCode).toBe(200);
    const placed = placedIdsOf(b);
    expect(placed).not.toContain('ADV');
    expect(placed).not.toContain('PRE');
  });

  test('3. completed-course behavior unchanged: PRE completed → ADV is placed', async () => {
    const res = makeRes();
    await handler(
      makeReq(baseReqBody({
        plan_context: withPersonalStatus({
          completed: [{ course_id: 'MAND' }, { course_id: 'PRE' }],
        }),
      })),
      res,
    );
    const b = res._body;
    expect(res.statusCode).toBe(200);
    expect(placedIdsOf(b)).toContain('ADV');
  });

  test('4. agentic path: PRE currently taking → ADV is placed there too (shared buildValidationContext mechanism)', async () => {
    process.env.AI_USE_AGENTIC_PLANNER = 'true';
    const res = makeRes();
    await handler(
      makeReq(baseReqBody({
        plan_context: withPersonalStatus({
          completed: [{ course_id: 'MAND' }],
          currently_taking: [{ course_id: 'PRE' }],
        }),
      })),
      res,
    );
    const b = res._body;
    expect(res.statusCode).toBe(200);
    expect(Array.isArray(b.semesters)).toBe(true);
    const placed = placedIdsOf(b);
    expect(placed).toContain('ADV');
    expect(placed).not.toContain('PRE');
  });
});

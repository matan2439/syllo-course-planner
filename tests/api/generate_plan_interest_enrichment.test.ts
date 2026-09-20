/**
 * Opt-in generate-plan interest-evaluation enrichment — tests for the additive
 * `interestEvaluation` attachment in api/ai/generate-plan.ts.
 *
 * Proves: (1) default (flag absent/false) response is unchanged and carries no
 * interestEvaluation key; (2) opt-in attaches an additive interestEvaluation
 * object without changing the generated plan / course ids / ranking; (3) edge
 * cases (missing/empty profile) are deterministic and non-fatal.
 *
 * Does not modify tests/api/generate-plan.test.ts.
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

describe('generate-plan interest-evaluation enrichment', () => {
  beforeEach(() => {
    process.env.AI_DEV_MODE = 'true';
    process.env.AI_DEV_BYPASS_QUOTA = 'true';
  });
  afterEach(() => {
    delete process.env.AI_DEV_MODE;
    delete process.env.AI_DEV_BYPASS_QUOTA;
  });

  test('default (flag absent): response carries no interestEvaluation key', async () => {
    const res = makeRes();
    await handler(makeReq(baseReqBody()), res);
    expect(res.statusCode).toBe(200);
    expect('interestEvaluation' in res._body).toBe(false);
  });

  test('include_interest_evaluation=false: response carries no interestEvaluation key', async () => {
    const res = makeRes();
    await handler(makeReq(baseReqBody({ include_interest_evaluation: false })), res);
    expect(res.statusCode).toBe(200);
    expect('interestEvaluation' in res._body).toBe(false);
  });

  test('opt-in does not change the generated plan (same semesters/course ids as default)', async () => {
    const resDefault = makeRes();
    await handler(makeReq(baseReqBody()), resDefault);
    const resOptIn = makeRes();
    await handler(makeReq(baseReqBody({
      include_interest_evaluation: true,
      academic_interest_profile: { focusAreas: [{ area: 'fluids', weight: 1 }] },
    })), resOptIn);

    expect(resOptIn._body.semesters).toEqual(resDefault._body.semesters);
    expect(resOptIn._body.moves).toEqual(resDefault._body.moves);
    expect(resOptIn._body.requirements_status).toEqual(resDefault._body.requirements_status);
  });

  test('opt-in with a meaningful profile attaches an additive interestEvaluation with alignment + scorecard', async () => {
    const res = makeRes();
    await handler(makeReq(baseReqBody({
      include_interest_evaluation: true,
      academic_interest_profile: { focusAreas: [{ area: 'fluids', weight: 1 }] },
    })), res);
    expect(res.statusCode).toBe(200);
    const ie = res._body.interestEvaluation;
    expect(ie).toBeDefined();
    expect(ie.alignment).toBeDefined();
    expect(ie.scorecard).toBeDefined();
    expect(Array.isArray(ie.evaluatedCourseIds)).toBe(true);
    expect(Array.isArray(ie.unmatchedCourseIds)).toBe(true);
    expect(ie.hasMeaningfulAcademicInterests).toBe(true);
  });

  test('opt-in reports non-catalog planned courses as unmatched (test board ids are not in the mechanical catalog)', async () => {
    const res = makeRes();
    await handler(makeReq(baseReqBody({
      include_interest_evaluation: true,
      academic_interest_profile: { focusAreas: [{ area: 'fluids', weight: 1 }] },
    })), res);
    const ie = res._body.interestEvaluation;
    // The test board's placed course ids ('MAND') are not in the real mechanical catalog.
    expect(ie.unmatchedCourseIds).toContain('MAND');
    expect(ie.evaluatedCourseIds).toEqual([]);
  });

  test('opt-in without academic_interest_profile is non-fatal and non-meaningful', async () => {
    const res = makeRes();
    await handler(makeReq(baseReqBody({ include_interest_evaluation: true })), res);
    expect(res.statusCode).toBe(200);
    expect(res._body.interestEvaluation.hasMeaningfulAcademicInterests).toBe(false);
  });

  test('opt-in with an empty profile yields hasMeaningfulAcademicInterests=false', async () => {
    const res = makeRes();
    await handler(makeReq(baseReqBody({
      include_interest_evaluation: true,
      academic_interest_profile: {},
    })), res);
    expect(res._body.interestEvaluation.hasMeaningfulAcademicInterests).toBe(false);
  });
});

/**
 * Clarification Answer Propagation to Planning Inputs — tests for the
 * mergeClarificationAnswersIntoGeneratePlanInputs wiring added to the
 * AI_USE_ACADEMIC_CLARIFICATION_PREFLIGHT block in api/ai/generate-plan.ts.
 *
 * Proves clarification_answers don't just unblock the preflight gate — once
 * unblocked, they actually reach the ConstraintModel generate-plan.ts builds:
 * an excluded_courses answer keeps that course out of the proposal, and a
 * completed_courses answer changes how mandatory-course completion is
 * counted, even when the original plan_context/preferences never carried that
 * information.
 *
 * The PLAN_CONTEXT fixture below reuses the same minimal board
 * (MAND mandatory + FLU as the sole "fluids" category candidate) from
 * tests/api/generate-plan.test.ts and tests/api/generate_plan_clarification_preflight.test.ts.
 * Empirically verified (via a throwaway probe, not assumed): with this
 * fixture the greedy planner deterministically places FLU whenever it isn't
 * excluded, since it's the only course available to progress the degree-hour
 * gap and the sole category candidate.
 *
 * This file only imports the existing, unmodified default export — it does
 * not touch generate-plan.test.ts, generate_plan_clarification_preflight.test.ts,
 * or generate_plan_clarification_resume.test.ts.
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
    plan_context: PLAN_CONTEXT_WITH_COMPLETED,
    preferences: {},
    session_token: randomUUID(),
    ...overrides,
  };
}

function requiredMandatoryCount(requirementsStatus: any[]): number {
  return requirementsStatus.find((r: any) => r.name === 'קורסי חובה').required;
}

describe('generate-plan — clarification_answers propagate to planning inputs (AI_USE_ACADEMIC_CLARIFICATION_PREFLIGHT opt-in)', () => {
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

  test('11. flag disabled: clarification_answers remain inert, existing behavior unchanged', async () => {
    const res = makeRes();
    await handler(
      makeReq(baseReqBody({
        plan_context: PLAN_CONTEXT, // completed: [] — would exclude MAND from required-mandatory count if propagated
        clarification_answers: [
          { questionId: 'completed_courses', value: ['MAND'] },
          { questionId: 'excluded_courses', value: ['FLU'] },
        ],
      })),
      res,
    );

    const b = res._body;
    expect(res.statusCode).toBe(200);
    expect(b.needsClarification).toBeUndefined();
    // FLU is still placed — the exclusion answer never reached the model because the flag is off.
    const placedIds = b.semesters.flatMap((s: any) => s.course_ids);
    expect(placedIds).toContain('FLU');
  });

  test('12. flag enabled, valid critical answers: planning delegates normally', async () => {
    process.env.AI_USE_ACADEMIC_CLARIFICATION_PREFLIGHT = 'true';
    const res = makeRes();
    await handler(
      makeReq(baseReqBody({
        clarification_answers: [
          { questionId: 'completed_courses', value: ['MAND'] },
          { questionId: 'excluded_courses', value: [] },
        ],
      })),
      res,
    );

    const b = res._body;
    expect(b.needsClarification).toBeUndefined();
    expect(Array.isArray(b.semesters)).toBe(true);
    expect(typeof b.rationale_he).toBe('string');
  });

  test('13. flag enabled, valid excluded_courses answer: downstream planning path receives the exclusion', async () => {
    process.env.AI_USE_ACADEMIC_CLARIFICATION_PREFLIGHT = 'true';
    const res = makeRes();
    await handler(
      makeReq(baseReqBody({
        // plan_context already has completed: [{course_id: 'MAND'}], so only excluded_courses is answered here.
        clarification_answers: [
          { questionId: 'excluded_courses', value: ['FLU'] },
        ],
      })),
      res,
    );

    const b = res._body;
    expect(b.needsClarification).toBeUndefined();
    const placedIds = b.semesters.flatMap((s: any) => s.course_ids);
    expect(placedIds).not.toContain('FLU');
    const fluidsRow = b.requirements_status.find((r: any) => r.name === 'זורמים');
    expect(fluidsRow.satisfied).toBe(false);
  });

  test('14. flag enabled, valid completed_courses answer: downstream planning path receives the completed-course context', async () => {
    process.env.AI_USE_ACADEMIC_CLARIFICATION_PREFLIGHT = 'true';
    const res = makeRes();
    await handler(
      makeReq(baseReqBody({
        plan_context: PLAN_CONTEXT, // completed: [] originally — MAND's completion comes only from the answer
        clarification_answers: [
          { questionId: 'completed_courses', value: ['MAND'] },
          { questionId: 'excluded_courses', value: [] },
        ],
      })),
      res,
    );

    const b = res._body;
    expect(b.needsClarification).toBeUndefined();
    // MAND is mandatory and already placed either way, so `satisfied` stays true regardless —
    // but `required` only drops to 0 once the model actually treats MAND as completed.
    expect(requiredMandatoryCount(b.requirements_status)).toBe(0);
  });

  test('15. flag enabled, partial/invalid answers: planning still blocked while critical context remains missing', async () => {
    process.env.AI_USE_ACADEMIC_CLARIFICATION_PREFLIGHT = 'true';
    const res = makeRes();
    await handler(
      makeReq(baseReqBody({
        plan_context: PLAN_CONTEXT, // completed: [] — completed_courses still missing/critical
        clarification_answers: [
          { questionId: 'excluded_courses', value: ['FLU'] },
        ],
      })),
      res,
    );

    const b = res._body;
    expect(b.needsClarification).toBe(true);
    expect(b.semesters).toBeUndefined();
    expect(b.clarification.questions.map((q: any) => q.id)).toContain('completed_courses');
  });

  test('16. AI_USE_AGENTIC_PLANNER behavior is unaffected by clarification_answers propagation', async () => {
    process.env.AI_USE_AGENTIC_PLANNER = 'true';
    const res = makeRes();
    await handler(
      makeReq(baseReqBody({
        clarification_answers: [
          { questionId: 'completed_courses', value: ['MAND'] },
          { questionId: 'excluded_courses', value: ['FLU'] },
        ],
      })),
      res,
    );

    expect(res.statusCode).toBe(200);
    const b = res._body;
    expect(Array.isArray(b.semesters)).toBe(true);
    expect(Array.isArray(b.trace)).toBe(true);
    expect(b.needsClarification).toBeUndefined();
    // AI_USE_ACADEMIC_CLARIFICATION_PREFLIGHT is unset here, so the exclusion answer is inert.
    const placedIds = b.semesters.flatMap((s: any) => s.course_ids);
    expect(placedIds).toContain('FLU');
  });
});

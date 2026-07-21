/**
 * generate-plan — Academic Decision Agent clarification ANSWER LOOP.
 *
 * The opt-in agent path (use_academic_decision_agent) surfaces clarification
 * questions for missing inputs alongside a real plan (it no longer withholds
 * the plan for a critical-missing input — see issue #25 Finding #2 / the
 * generate-plan.ts comment above this block's call site). Until this file's
 * tests were added it also ignored any clarification_answers supplied on the
 * follow-up request unless the separate AI_USE_ACADEMIC_CLARIFICATION_PREFLIGHT
 * env flag was on. These tests pin the resume behavior: answers submitted
 * through the agent path are merged (via the existing
 * mergeClarificationAnswersIntoGeneratePlanInputs / applyClarificationLoopAnswers
 * modules) into the actual planning inputs, so they both remove the field from
 * clarification.questions AND reach the planner — while invalid/partial
 * answers keep the field honestly still-asked (plan generation itself is
 * never gated on this) and the default (no-flag) response stays byte-identical.
 *
 * Same real-handler harness as generate_plan_academic_decision_agent.test.ts
 * (dev-bypass, no DB).
 */

import handler from '../../api/ai/generate-plan';
import { randomUUID } from 'crypto';

// MAND is a 10-hour fixed mandatory course (used to observe max_weekly_hours
// propagation via a workload note); FLU is the single fluids-category candidate
// (used to observe excluded/current propagation).
const PLAN_CONTEXT = {
  program_name: 'בדיקה',
  semesters: [
    { id: 'year_3_semester_a', label: 'שנה ג׳ א׳', total_hours: 10, courses: [
      { course_id: 'MAND', name_he: 'חובה', hours: 10, course_type: 'mandatory', placement_policy: 'fixed', effective_allowed_semesters: ['year_3_semester_a'] },
    ] },
    { id: 'year_3_semester_b', label: 'שנה ג׳ ב׳', total_hours: 0, courses: [] },
    { id: 'year_4_semester_a', label: 'שנה ד׳ א׳', total_hours: 0, courses: [] },
    { id: 'year_4_semester_b', label: 'שנה ד׳ ב׳', total_hours: 0, courses: [] },
  ],
  category_requirements: [
    { name: 'זורמים', category_id: 'fluids', required: 1, placed: 0, candidates: [
      { course_id: 'FLU', name_he: 'זורם', hours: 4, effective_allowed_semesters: ['year_4_semester_a', 'year_4_semester_b'] },
    ] },
  ],
  total_hours_progress: { known_completed_hours: 177, degree_required_hours: 185 },
  personal_status: { completed: [], currently_taking: [] },
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

function agentBody(over: any = {}) {
  return {
    program_id: 'test_program_2027',
    plan_context: PLAN_CONTEXT,
    preferences: {},
    session_token: randomUUID(),
    use_academic_decision_agent: true,
    ...over,
  };
}

async function run(body: any) {
  const res = makeRes();
  await handler(makeReq(body), res);
  return res;
}

function placedIds(body: any): string[] {
  return (body.semesters ?? []).flatMap((s: any) => s.course_ids);
}
function questionIds(body: any): string[] {
  return (body.academicDecision?.clarification?.questions ?? []).map((q: any) => q.id);
}

// Sufficient answers to satisfy both critical inputs (completed + excluded).
const COMPLETED = { questionId: 'completed_courses', value: ['PRIOR'] };
const NO_EXCLUSIONS = { questionId: 'excluded_courses', value: [] as string[] };

describe('generate-plan agent path — clarification answer loop', () => {
  beforeEach(() => {
    process.env.AI_DEV_MODE = 'true';
    process.env.AI_DEV_BYPASS_QUOTA = 'true';
  });
  afterEach(() => {
    delete process.env.AI_DEV_MODE;
    delete process.env.AI_DEV_BYPASS_QUOTA;
    delete process.env.AI_USE_ACADEMIC_CLARIFICATION_PREFLIGHT;
  });

  test('1. missing critical context → still a real plan, clarification attached and asked', async () => {
    // completedCourses/excludedCourses safely default to empty (issue #25
    // Finding #2) — the agent path must not withhold a plan a first-time user
    // would otherwise get from the default path for the same input. It must
    // still surface the clarification questions so the user can answer them.
    const res = await run(agentBody());
    expect(res._body.needsClarification).toBeFalsy();
    expect(Array.isArray(res._body.semesters)).toBe(true);
    expect(res._body.academicDecision.clarification.needsClarification).toBe(true);
    expect(questionIds(res._body)).toEqual(expect.arrayContaining(['completed_courses', 'excluded_courses']));
  });

  test('2. valid clarification_answers unblock the agent path → plan + academicDecision', async () => {
    const res = await run(agentBody({ clarification_answers: [COMPLETED, NO_EXCLUSIONS] }));
    expect(res._body.needsClarification).toBeFalsy();
    expect(Array.isArray(res._body.semesters)).toBe(true);
    expect(res._body.academicDecision.decision).toBeDefined();
    expect(res._body.academicDecision.explanation).toBeDefined();
  });

  test('3. partial answers still return a plan, and still ask the remaining question', async () => {
    // Only completed answered → excluded_courses (critical) still missing, but
    // a critical-missing input no longer withholds the plan (Finding #2) — it
    // only keeps the question in clarification.questions until answered.
    const res = await run(agentBody({ clarification_answers: [COMPLETED] }));
    expect(res._body.needsClarification).toBeFalsy();
    expect(Array.isArray(res._body.semesters)).toBe(true);
    const ids = questionIds(res._body);
    expect(ids).toContain('excluded_courses');
    expect(ids).not.toContain('completed_courses');
  });

  test('4. invalid answers do not silently satisfy the gate (still asked, still planned)', async () => {
    // completed_courses given a number (wrong shape) → dropped by validation.
    // excluded_courses validly answered → applied. So completed stays missing
    // from the clarification's perspective, but the plan is still generated.
    const res = await run(agentBody({
      clarification_answers: [{ questionId: 'completed_courses', value: 42 }, NO_EXCLUSIONS],
    }));
    expect(res._body.needsClarification).toBeFalsy();
    expect(Array.isArray(res._body.semesters)).toBe(true);
    const ids = questionIds(res._body);
    expect(ids).toContain('completed_courses');
    expect(ids).not.toContain('excluded_courses');
  });

  test('5. completed_courses answers propagate into planning inputs', async () => {
    const res = await run(agentBody({ clarification_answers: [COMPLETED, NO_EXCLUSIONS] }));
    expect(res._body.needsClarification).toBeFalsy();
    // Once completed is present, the runtime no longer prompts for it.
    const actions: string[] = res._body.academicDecision.explanation.suggestedNextActions;
    expect(actions.some((a) => a.includes('שכבר השלמת'))).toBe(false);
    expect(res._body.academicDecision.explanation.missingData).not.toContain('חסר מידע: קורסים שהושלמו.');
  });

  test('6. current_courses answers propagate — a currently-taken course is not re-proposed', async () => {
    const res = await run(agentBody({
      clarification_answers: [COMPLETED, NO_EXCLUSIONS, { questionId: 'current_courses', value: ['FLU'] }],
    }));
    expect(res._body.needsClarification).toBeFalsy();
    expect(placedIds(res._body)).not.toContain('FLU');
  });

  test('7. excluded_courses answers propagate — a disallowed course never appears', async () => {
    const res = await run(agentBody({
      clarification_answers: [COMPLETED, { questionId: 'excluded_courses', value: ['FLU'] }],
    }));
    expect(res._body.needsClarification).toBeFalsy();
    expect(placedIds(res._body)).not.toContain('FLU');
  });

  test('8. max_weekly_hours answers propagate into planning inputs', async () => {
    const MAX_HE = 'חסר מידע: מגבלת שעות שבועית.';
    // Control: without the answer, the (soft) max-hours gap is reported.
    const without = await run(agentBody({ clarification_answers: [COMPLETED, NO_EXCLUSIONS] }));
    expect(without._body.academicDecision.explanation.missingData).toContain(MAX_HE);
    // With the answer, max_weekly_hours reaches the shared planning inputs
    // (effectivePreferences → buildModel + clarification context), so the gap
    // is gone.
    const withMax = await run(agentBody({
      clarification_answers: [COMPLETED, NO_EXCLUSIONS, { questionId: 'max_weekly_hours', value: 8 }],
    }));
    expect(withMax._body.needsClarification).toBeFalsy();
    expect(withMax._body.academicDecision.explanation.missingData).not.toContain(MAX_HE);
  });

  test('9. default behavior unchanged when use_academic_decision_agent is absent (answers ignored)', async () => {
    const res = await run({
      program_id: 'test_program_2027',
      plan_context: PLAN_CONTEXT,
      preferences: {},
      session_token: randomUUID(),
      clarification_answers: [COMPLETED, NO_EXCLUSIONS],
    });
    expect(res.statusCode).toBe(200);
    expect('academicDecision' in res._body).toBe(false);
    expect(res._body.needsClarification).toBeUndefined();
    expect(Array.isArray(res._body.semesters)).toBe(true);
  });

  test('composes with the clarification-preflight resume flow when that flag is also on', async () => {
    process.env.AI_USE_ACADEMIC_CLARIFICATION_PREFLIGHT = 'true';
    const res = await run(agentBody({ clarification_answers: [COMPLETED, NO_EXCLUSIONS] }));
    expect(res._body.needsClarification).toBeFalsy();
    expect(Array.isArray(res._body.semesters)).toBe(true);
    expect(res._body.academicDecision).toBeDefined();
  });
});

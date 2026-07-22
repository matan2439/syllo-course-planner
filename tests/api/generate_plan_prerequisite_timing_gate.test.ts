/**
 * Regression test for an Agent Diagnosis Loop finding (2026-07-22): a course
 * already sitting on the board whose prerequisite was never completed or
 * scheduled anywhere in the plan must never silently survive with
 * blocked:false, errors:[] — the same "computed-but-discarded validation
 * signal" bug class as issue #25 Finding #1 (disallowed-placed course, PR
 * #27) and the is_annual completeness gap (PR #37), just for
 * prerequisite/duplicate/pinned/illegal-semester legality instead.
 *
 * validatePlanState (planner_validate.ts) already enforces prerequisite
 * strict-timing against the FINAL state — but generate-plan.ts's toProposal()
 * only ever read that same validateCandidate() call's `report.warnings`, never
 * `report.errors`/`report.legal`, so this could report success while
 * `academicDecision.validation.valid` rendered a green "passed legality"
 * checkmark next to explanation text (whyThisPlan) admitting the same
 * violation — a reproduced, rendered, in-product self-contradiction.
 * generate-plan.ts's new legalityGate closes this gap.
 *
 * Uses the existing test_program_prereq_2027 fixture (MAND mandatory / PRE
 * elective / ADV requiring PRE, sole "advanced" category candidate — see
 * generate_plan_currently_taking_prereq.test.ts for the same board), with ADV
 * pre-placed on the board (simulating a client-supplied plan_context where
 * ADV already sits there — e.g. from the board's own "move course" menu,
 * which only checks offering-semester legality, never prerequisite timing)
 * while PRE is neither completed nor scheduled anywhere.
 */

import handler from '../../api/ai/generate-plan';
import { randomUUID } from 'crypto';

function planContextWithAdvPlaced(personalStatus: any) {
  return {
    program_name: 'בדיקה',
    semesters: [
      { id: 'year_3_semester_a', label: "שנה ג׳ א׳", total_hours: 4, courses: [
        { course_id: 'MAND', name_he: 'חובה', hours: 4, course_type: 'mandatory', placement_policy: 'fixed', effective_allowed_semesters: ['year_3_semester_a'] },
      ] },
      { id: 'year_3_semester_b', label: "שנה ג׳ ב׳", total_hours: 0, courses: [] },
      // ADV already sits on the board here — the exact "pre-existing/fixed
      // placement from client-supplied plan_context" shape the search itself
      // can never introduce (it validates every mutation before accepting
      // it), but a client can send as-is.
      { id: 'year_4_semester_a', label: "שנה ד׳ א׳", total_hours: 4, courses: [
        { course_id: 'ADV', name_he: 'מתקדם', hours: 4, course_type: 'elective', placement_policy: 'flexible', effective_allowed_semesters: ['year_4_semester_a', 'year_4_semester_b'] },
      ] },
      { id: 'year_4_semester_b', label: "שנה ד׳ ב׳", total_hours: 0, courses: [] },
    ],
    category_requirements: [
      { name: 'מתקדמים', category_id: 'advanced', required: 1, placed: 1, candidates: [
        { course_id: 'ADV', name_he: 'מתקדם', hours: 4, effective_allowed_semesters: ['year_4_semester_a', 'year_4_semester_b'] },
      ] },
    ],
    // Set so ADV's 4h alone already reaches the 185h target — the search has
    // no remaining degree-hour gap to fill, so it cannot incidentally place
    // PRE itself (which would cure the very violation this file reproduces).
    total_hours_progress: { known_completed_hours: 181, degree_required_hours: 185 },
    personal_status: personalStatus,
    mandatory_unplaced: [],
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
    program_id: 'test_program_prereq_2027',
    plan_context: planContextWithAdvPlaced({ completed: [{ course_id: 'MAND' }] }),
    preferences: { disallowed_course_ids: [] },
    session_token: randomUUID(),
    ...overrides,
  };
}

function placedIdsOf(body: any): string[] {
  return body.semesters.flatMap((s: any) => s.course_ids);
}

describe('generate-plan — a pre-placed course whose prerequisite was never completed/scheduled is surfaced as a blocking error (Agent Diagnosis Loop finding)', () => {
  beforeEach(() => {
    process.env.AI_DEV_MODE = 'true';
    process.env.AI_DEV_BYPASS_QUOTA = 'true';
  });
  afterEach(() => {
    delete process.env.AI_DEV_MODE;
    delete process.env.AI_DEV_BYPASS_QUOTA;
    delete process.env.AI_USE_AGENTIC_PLANNER;
  });

  test('1. sanity: PRE completed → ADV pre-placed is legal, plan is not blocked', async () => {
    const res = makeRes();
    await handler(
      makeReq(baseReqBody({
        plan_context: planContextWithAdvPlaced({ completed: [{ course_id: 'MAND' }, { course_id: 'PRE' }] }),
      })),
      res,
    );
    const b = res._body;
    expect(res.statusCode).toBe(200);
    expect(placedIdsOf(b)).toContain('ADV');
    expect(b.blocked).toBe(false);
    expect(b.errors).toEqual([]);
  });

  test('2. PRE neither completed nor scheduled anywhere: response is blocked with a Hebrew error naming the prerequisite violation', async () => {
    const res = makeRes();
    await handler(makeReq(baseReqBody()), res);
    const b = res._body;
    expect(res.statusCode).toBe(200);
    // The planner never generates a removal action for a pre-existing
    // placement — this test is about the response being honest about the
    // violation, not about the planner fixing it.
    expect(placedIdsOf(b)).toContain('ADV');
    expect(b.blocked).toBe(true);
    expect(b.errors.length).toBe(1);
    expect(b.errors[0]).toContain('הפרת חוקיות בתוכנית:');
    expect(b.errors[0]).toContain('דרישת הקדם');
    // blocked/errors invariant from generate-plan.test.ts must still hold.
    expect(b.blocked).toBe(b.errors.length > 0);
  });

  test('3. same gate holds on the AI_USE_AGENTIC_PLANNER path', async () => {
    process.env.AI_USE_AGENTIC_PLANNER = 'true';
    const res = makeRes();
    await handler(makeReq(baseReqBody()), res);
    const b = res._body;
    expect(b.blocked).toBe(true);
    expect(b.errors.some((e: string) => e.includes('הפרת חוקיות בתוכנית:') && e.includes('דרישת הקדם'))).toBe(true);
  });

  test('4. use_academic_decision_agent: validation.valid is honestly false, and suggested actions name the legality-violation cause, not overload-only guidance', async () => {
    const res = makeRes();
    await handler(makeReq(baseReqBody({ use_academic_decision_agent: true })), res);
    const b = res._body;
    expect(b.blocked).toBe(true);
    expect(b.academicDecision).toBeDefined();
    // The concrete bug this test locks in: before the fix, this rendered
    // `valid: true` (a green "passed legality" checkmark) alongside
    // whyThisPlan text admitting the plan can't legally place ADV.
    expect(b.academicDecision.validation.valid).toBe(false);
    const actions: string[] = b.academicDecision.explanation.suggestedNextActions;
    expect(actions.some((a) => a.includes('הפרת חוקיות') || a.includes('תנאי הקדם'))).toBe(true);
    expect(actions.some((a) => a.includes('עומס'))).toBe(false);
    expect(b.academicDecision.explanation.mainRecommendation).toContain('הפרת חוקיות');
  });
});

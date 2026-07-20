/**
 * Regression test for issue #25, Finding #1 (P0): a course the user has
 * hard-excluded (disallowed_course_ids / strongly_avoided_course_ids) but
 * that was already placed on the board before the exclusion was added must
 * never silently survive a "rebuild" with blocked:false, errors:[]. The
 * planner only ever adds/moves/replaces courses — it never generates a
 * removal action for a previously-placed, newly-disallowed course — so the
 * final plan can legitimately still contain it. planner_validate.ts's
 * validateCandidate already detected this internally (disallowedPlaced,
 * valid:false), but generate-plan.ts's toProposal()/blockingErrors never read
 * that signal, so the response reported success anyway. This file proves the
 * gate that closes that gap: generate-plan.ts now surfaces it as a real
 * blocking error instead of hiding it.
 *
 * Uses the same MAND (mandatory)/FLU (sole "fluids" category candidate)
 * fixture as the other generate-plan test files, with FLU pre-placed on the
 * board (simulating "already in the plan") instead of left for the planner
 * to place.
 */

import handler from '../../api/ai/generate-plan';
import { randomUUID } from 'crypto';

const PLAN_CONTEXT_WITH_FLU_PLACED = {
  program_name: 'בדיקה',
  semesters: [
    { id: 'year_3_semester_a', label: "שנה ג׳ א׳", total_hours: 4, courses: [
      { course_id: 'MAND', name_he: 'חובה', hours: 4, course_type: 'mandatory', placement_policy: 'fixed', effective_allowed_semesters: ['year_3_semester_a'] },
    ] },
    { id: 'year_3_semester_b', label: "שנה ג׳ ב׳", total_hours: 0, courses: [] },
    // FLU already sits on the board here — this is the state a real user's
    // in-progress plan would be in before they decide to exclude it.
    { id: 'year_4_semester_a', label: "שנה ד׳ א׳", total_hours: 4, courses: [
      { course_id: 'FLU', name_he: 'זורם', hours: 4, course_type: 'elective', placement_policy: 'flexible', effective_allowed_semesters: ['year_4_semester_a', 'year_4_semester_b'] },
    ] },
    { id: 'year_4_semester_b', label: "שנה ד׳ ב׳", total_hours: 0, courses: [] },
  ],
  category_requirements: [
    { name: 'זורמים', category_id: 'fluids', required: 1, placed: 1, candidates: [
      { course_id: 'FLU', name_he: 'זורם', hours: 4, effective_allowed_semesters: ['year_4_semester_a', 'year_4_semester_b'] },
    ] },
  ],
  total_hours_progress: { known_completed_hours: 177, degree_required_hours: 185 },
  personal_status: { completed: [{ course_id: 'MAND' }] },
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
    plan_context: PLAN_CONTEXT_WITH_FLU_PLACED,
    preferences: { disallowed_course_ids: [] },
    session_token: randomUUID(),
    ...overrides,
  };
}

describe('generate-plan — a hard-excluded, already-placed course is surfaced as a blocking error (issue #25, Finding #1)', () => {
  beforeEach(() => {
    process.env.AI_DEV_MODE = 'true';
    process.env.AI_DEV_BYPASS_QUOTA = 'true';
  });
  afterEach(() => {
    delete process.env.AI_DEV_MODE;
    delete process.env.AI_DEV_BYPASS_QUOTA;
    delete process.env.AI_USE_AGENTIC_PLANNER;
  });

  test('1. sanity: with no exclusion, FLU stays placed and the plan is not blocked', async () => {
    const res = makeRes();
    await handler(makeReq(baseReqBody()), res);
    const b = res._body;
    expect(res.statusCode).toBe(200);
    const placedIds = b.semesters.flatMap((s: any) => s.course_ids);
    expect(placedIds).toContain('FLU');
    expect(b.blocked).toBe(false);
    expect(b.errors).toEqual([]);
  });

  test('2. disallowed_course_ids includes the already-placed FLU: response is blocked with a Hebrew error naming it', async () => {
    const res = makeRes();
    await handler(
      makeReq(baseReqBody({ preferences: { disallowed_course_ids: ['FLU'] } })),
      res,
    );
    const b = res._body;
    expect(res.statusCode).toBe(200);
    // The planner cannot remove the pre-placed course on its own today — this
    // test is about the response being honest about that, not fixing removal.
    const placedIds = b.semesters.flatMap((s: any) => s.course_ids);
    expect(placedIds).toContain('FLU');
    expect(b.blocked).toBe(true);
    expect(b.errors.some((e: string) => e.includes('FLU') || e.includes('זורם'))).toBe(true);
    // blocked/errors invariant from generate-plan.test.ts must still hold.
    expect(b.blocked).toBe(b.errors.length > 0);
  });

  test('3. strongly_avoided_course_ids (the alternate field name) triggers the same gate', async () => {
    const res = makeRes();
    await handler(
      makeReq(baseReqBody({ preferences: { strongly_avoided_course_ids: ['FLU'] } })),
      res,
    );
    const b = res._body;
    expect(b.blocked).toBe(true);
    expect(b.errors.some((e: string) => e.includes('FLU') || e.includes('זורם'))).toBe(true);
  });

  test('4. same gate holds on the AI_USE_AGENTIC_PLANNER path', async () => {
    process.env.AI_USE_AGENTIC_PLANNER = 'true';
    const res = makeRes();
    await handler(
      makeReq(baseReqBody({ preferences: { disallowed_course_ids: ['FLU'] } })),
      res,
    );
    const b = res._body;
    expect(b.blocked).toBe(true);
    expect(b.errors.some((e: string) => e.includes('FLU') || e.includes('זורם'))).toBe(true);
  });

  test('5. an unrelated overload block is not affected by (does not suppress) the disallowed-placed block, and vice versa', async () => {
    const res = makeRes();
    await handler(
      makeReq(baseReqBody({ preferences: { disallowed_course_ids: ['FLU'], max_weekly_hours: 1000 } })),
      res,
    );
    const b = res._body;
    expect(b.blocked).toBe(true);
    expect(b.errors.length).toBeGreaterThan(0);
  });
});

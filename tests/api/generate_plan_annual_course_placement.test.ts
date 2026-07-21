/**
 * Product regression — annual (year-long) course placement, end-to-end
 * through the generate-plan handler (both the default worker path and the
 * agentic beam path).
 *
 * Board fixture (data/boards/test_program_annual_course_2027.json): ANNUAL is
 * a 4h mandatory course with is_annual/spans_semesters
 * (["year_3_semester_a","year_3_semester_b"]) and count_hours_once. It must
 * be reported in BOTH spanned semesters' course_ids whenever the planner adds
 * it — never split into just one, which would silently under-report the true
 * weekly load of whichever semester it was left out of. See issue #25's
 * "not fully verified" semester-balance follow-up and
 * tests/api/planner_actions_annual_course.test.ts for the underlying
 * mechanism this locks in.
 *
 * Does not modify any prior generate-plan test file.
 */

import handler from '../../api/ai/generate-plan';
import { randomUUID } from 'crypto';

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
function baseReqBody(planContext: any, overrides: any = {}) {
  return {
    program_id: 'test_program_annual_course_2027',
    plan_context: planContext,
    preferences: { disallowed_course_ids: [] },
    session_token: randomUUID(),
    ...overrides,
  };
}
function courseIdsOf(body: any, semesterId: string): string[] {
  const sem = (body.semesters ?? []).find((s: any) => s.semester_id === semesterId);
  return sem ? [...sem.course_ids] : [];
}

const EMPTY_PLAN_CONTEXT = {
  program_name: 'בדיקה',
  semesters: [
    { id: 'year_3_semester_a', label: "שנה ג׳ א׳", total_hours: 0, courses: [] },
    { id: 'year_3_semester_b', label: "שנה ג׳ ב׳", total_hours: 0, courses: [] },
  ],
  total_hours_progress: { known_completed_hours: 0, degree_required_hours: 4 },
  personal_status: { completed: [] },
  mandatory_unplaced: [],
};

const ALREADY_PLACED_PLAN_CONTEXT = {
  ...EMPTY_PLAN_CONTEXT,
  semesters: [
    { id: 'year_3_semester_a', label: "שנה ג׳ א׳", total_hours: 4, courses: [{ course_id: 'ANNUAL' }] },
    { id: 'year_3_semester_b', label: "שנה ג׳ ב׳", total_hours: 4, courses: [{ course_id: 'ANNUAL' }] },
  ],
};

// Codex round-4 repro: a plan saved before this fix (or any other partial
// split) has ANNUAL in only ONE of its two spanned semesters already.
const PARTIALLY_PLACED_PLAN_CONTEXT = {
  ...EMPTY_PLAN_CONTEXT,
  semesters: [
    { id: 'year_3_semester_a', label: "שנה ג׳ א׳", total_hours: 4, courses: [{ course_id: 'ANNUAL' }] },
    { id: 'year_3_semester_b', label: "שנה ג׳ ב׳", total_hours: 0, courses: [] },
  ],
};

describe('generate-plan — annual (year-long) course is placed in every spanned semester', () => {
  beforeEach(() => {
    process.env.AI_DEV_MODE = 'true';
    process.env.AI_DEV_BYPASS_QUOTA = 'true';
  });
  afterEach(() => {
    delete process.env.AI_DEV_MODE;
    delete process.env.AI_DEV_BYPASS_QUOTA;
    delete process.env.AI_USE_AGENTIC_PLANNER;
  });

  test('default path: freshly-added ANNUAL lands in BOTH year_3_semester_a and year_3_semester_b', async () => {
    const res = makeRes();
    await handler(makeReq(baseReqBody(EMPTY_PLAN_CONTEXT)), res);
    expect(res.statusCode).toBe(200);
    expect(courseIdsOf(res._body, 'year_3_semester_a')).toContain('ANNUAL');
    expect(courseIdsOf(res._body, 'year_3_semester_b')).toContain('ANNUAL');
    expect(res._body.blocked).toBe(false);
  });

  test('agentic path: freshly-added ANNUAL also lands in BOTH semesters (shared action space)', async () => {
    process.env.AI_USE_AGENTIC_PLANNER = 'true';
    const res = makeRes();
    await handler(makeReq(baseReqBody(EMPTY_PLAN_CONTEXT)), res);
    expect(res.statusCode).toBe(200);
    expect(courseIdsOf(res._body, 'year_3_semester_a')).toContain('ANNUAL');
    expect(courseIdsOf(res._body, 'year_3_semester_b')).toContain('ANNUAL');
  });

  test('an ANNUAL course already placed in both semesters is left untouched, with no spurious "move" reported', async () => {
    const res = makeRes();
    await handler(makeReq(baseReqBody(ALREADY_PLACED_PLAN_CONTEXT)), res);
    expect(res.statusCode).toBe(200);
    expect(courseIdsOf(res._body, 'year_3_semester_a')).toContain('ANNUAL');
    expect(courseIdsOf(res._body, 'year_3_semester_b')).toContain('ANNUAL');
    const annualMoves = (res._body.moves ?? []).filter((m: any) => m.course_id === 'ANNUAL');
    expect(annualMoves).toEqual([]);
  });

  test('Codex round 4: a plan with ANNUAL already placed in only ONE of its two semesters gets repaired, not silently accepted', async () => {
    const res = makeRes();
    await handler(makeReq(baseReqBody(PARTIALLY_PLACED_PLAN_CONTEXT)), res);
    expect(res.statusCode).toBe(200);
    expect(courseIdsOf(res._body, 'year_3_semester_a')).toContain('ANNUAL');
    expect(courseIdsOf(res._body, 'year_3_semester_b')).toContain('ANNUAL');
    expect(res._body.blocked).toBe(false);
  });

  // Codex round 11: the repaired missing span must be reported as an
  // ADDITION (from: null), never as a "move" out of year_3_semester_a — the
  // course still occupies year_3_semester_a in the final plan, so a
  // consumer that applies `moves` literally must not be told to remove it
  // from there.
  test('Codex round 11: repairing a partial annual placement reports the added span with from:null, never a move out of the still-occupied semester', async () => {
    const res = makeRes();
    await handler(makeReq(baseReqBody(PARTIALLY_PLACED_PLAN_CONTEXT)), res);
    expect(res.statusCode).toBe(200);
    const annualMoves = (res._body.moves ?? []).filter((m: any) => m.course_id === 'ANNUAL');
    expect(annualMoves).toEqual([{ course_id: 'ANNUAL', from: null, to: 'year_3_semester_b' }]);
  });

  test('Codex round 4 (agentic path): same partial-placement repair', async () => {
    process.env.AI_USE_AGENTIC_PLANNER = 'true';
    const res = makeRes();
    await handler(makeReq(baseReqBody(PARTIALLY_PLACED_PLAN_CONTEXT)), res);
    expect(res.statusCode).toBe(200);
    expect(courseIdsOf(res._body, 'year_3_semester_a')).toContain('ANNUAL');
    expect(courseIdsOf(res._body, 'year_3_semester_b')).toContain('ANNUAL');
  });
});

/**
 * Codex round-10 finding on PR #37: when the missing span of a partially-
 * placed annual course cannot legally accept it (here: year_3_semester_b is
 * pinned to a fixed 23h mandatory course, so adding ANNUAL's 4h would exceed
 * HARD_LOAD_CAP=26), step()'s repair branch rejects and falls through to the
 * normal search/STOP path with the annual course still split. Before this
 * fix, the response only turned overload/disallowed/maxSteps into `blocked`,
 * so this returned blocked:false, errors:[] even though validateCandidate
 * rejects the final state for the unrepaired annual split.
 */
describe('generate-plan — an unrepairable annual split is a blocking error, not a silent blocked:false', () => {
  beforeEach(() => {
    process.env.AI_DEV_MODE = 'true';
    process.env.AI_DEV_BYPASS_QUOTA = 'true';
  });
  afterEach(() => {
    delete process.env.AI_DEV_MODE;
    delete process.env.AI_DEV_BYPASS_QUOTA;
    delete process.env.AI_USE_AGENTIC_PLANNER;
  });

  const BLOCKED_PLAN_CONTEXT = {
    program_name: 'בדיקה',
    semesters: [
      { id: 'year_3_semester_a', label: "שנה ג׳ א׳", total_hours: 4, courses: [{ course_id: 'ANNUAL' }] },
      { id: 'year_3_semester_b', label: "שנה ג׳ ב׳", total_hours: 23, courses: [{ course_id: 'FILLER_B' }] },
    ],
    total_hours_progress: { known_completed_hours: 0, degree_required_hours: 27 },
    personal_status: { completed: [] },
    mandatory_unplaced: [],
  };

  function blockedReqBody(overrides: any = {}) {
    return {
      program_id: 'test_program_annual_course_blocked_2027',
      plan_context: BLOCKED_PLAN_CONTEXT,
      preferences: { disallowed_course_ids: [] },
      session_token: randomUUID(),
      ...overrides,
    };
  }

  test('default path: reports blocked:true with an annual-completeness error instead of silently leaving ANNUAL split', async () => {
    const res = makeRes();
    await handler(makeReq(blockedReqBody()), res);
    expect(res.statusCode).toBe(200);
    // The unrepairable split must still be visible in the response...
    expect(courseIdsOf(res._body, 'year_3_semester_a')).toContain('ANNUAL');
    expect(courseIdsOf(res._body, 'year_3_semester_b')).not.toContain('ANNUAL');
    // ...but must never be reported as a clean, successful plan.
    expect(res._body.blocked).toBe(true);
    expect(res._body.errors.length).toBeGreaterThan(0);
  });

  test('agentic path: same blocking behavior', async () => {
    process.env.AI_USE_AGENTIC_PLANNER = 'true';
    const res = makeRes();
    await handler(makeReq(blockedReqBody()), res);
    expect(res.statusCode).toBe(200);
    expect(res._body.blocked).toBe(true);
    expect(res._body.errors.length).toBeGreaterThan(0);
  });
});

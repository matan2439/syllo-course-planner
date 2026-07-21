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
});

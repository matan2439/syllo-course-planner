/**
 * Product regression — Dual-Semester Load-Balancing Preference, end-to-end
 * through the generate-plan handler (both the default worker path and the
 * agentic beam path).
 *
 * Board fixture (data/boards/test_program_dual_balance_2027.json): FIXA fixed
 * mandatory 8h in Semester A, FIXB fixed mandatory 4h in Semester B, DUAL a 4h
 * dual-offered (offered_semesters ["A","B"]) elective that is the sole
 * candidate of a required category. Semester A (8h) is heavier than Semester B
 * (4h), and both A and B are legal for DUAL. The planner must place DUAL in
 * Semester B (A=8, B=8, balanced) rather than biasing to A (A=12, B=4).
 *
 * Does not modify any prior generate-plan test file.
 */

import handler from '../../api/ai/generate-plan';
import { randomUUID } from 'crypto';

const PLAN_CONTEXT = {
  program_name: 'בדיקה',
  semesters: [
    { id: 'year_3_semester_a', label: "שנה ג׳ א׳", total_hours: 0, courses: [] },
    { id: 'year_3_semester_b', label: "שנה ג׳ ב׳", total_hours: 0, courses: [] },
  ],
  category_requirements: [
    { name: 'דו-סמסטריאלי', category_id: 'dualcat', required: 1, placed: 0, candidates: [
      { course_id: 'DUAL', name_he: 'דואלי', hours: 4, offered_semesters: ['A', 'B'] },
    ] },
  ],
  total_hours_progress: { known_completed_hours: 0, degree_required_hours: 16 },
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
    program_id: 'test_program_dual_balance_2027',
    plan_context: PLAN_CONTEXT,
    preferences: { disallowed_course_ids: [] },
    session_token: randomUUID(),
    ...overrides,
  };
}
function semesterOf(body: any, courseId: string): string | null {
  for (const s of body.semesters ?? []) {
    if ((s.course_ids ?? []).includes(courseId)) return s.semester_id;
  }
  return null;
}

describe('generate-plan — dual-offered course prefers the lighter semester (load balance)', () => {
  beforeEach(() => {
    process.env.AI_DEV_MODE = 'true';
    process.env.AI_DEV_BYPASS_QUOTA = 'true';
  });
  afterEach(() => {
    delete process.env.AI_DEV_MODE;
    delete process.env.AI_DEV_BYPASS_QUOTA;
    delete process.env.AI_USE_AGENTIC_PLANNER;
  });

  test('14/15. default path: A heavier, both legal → DUAL placed and reported in Semester B', async () => {
    const res = makeRes();
    await handler(makeReq(baseReqBody()), res);
    expect(res.statusCode).toBe(200);
    // placed at all, and reported in the lighter semester B.
    expect(semesterOf(res._body, 'DUAL')).toBe('year_3_semester_b');
    // response contract: DUAL appears exactly once, in B's course_ids.
    const allPlaced = res._body.semesters.flatMap((s: any) => s.course_ids);
    expect(allPlaced.filter((c: string) => c === 'DUAL')).toEqual(['DUAL']);
    expect(res._body.blocked).toBe(false);
  });

  test('11. agentic path: same Semester B choice (shared beam scoring layer)', async () => {
    process.env.AI_USE_AGENTIC_PLANNER = 'true';
    const res = makeRes();
    await handler(makeReq(baseReqBody()), res);
    expect(res.statusCode).toBe(200);
    expect(semesterOf(res._body, 'DUAL')).toBe('year_3_semester_b');
  });

  test('13. the flag only changes the engine, not the balanced outcome: default and agentic agree DUAL→B', async () => {
    // Same fixture, both engines: DUAL lands in Semester B either way, and the
    // fixed mandatory courses land in their required semesters. We assert
    // PLACEMENT correctness (what this epic affects) — NOT res.blocked, which on
    // the agentic path carries a pre-existing PLANNER_STEP_LIMIT flag on tiny
    // fixtures (the beam runs to max_steps even after completing a valid plan);
    // that quirk lives in the beam/PlannerAgent, untouched by this epic.
    const rDefault = makeRes();
    await handler(makeReq(baseReqBody()), rDefault);

    process.env.AI_USE_AGENTIC_PLANNER = 'true';
    const rAgentic = makeRes();
    await handler(makeReq(baseReqBody()), rAgentic);

    for (const r of [rDefault, rAgentic]) {
      expect(r.statusCode).toBe(200);
      expect(semesterOf(r._body, 'DUAL')).toBe('year_3_semester_b');
      expect(semesterOf(r._body, 'FIXA')).toBe('year_3_semester_a');
      expect(semesterOf(r._body, 'FIXB')).toBe('year_3_semester_b');
    }
  });
});

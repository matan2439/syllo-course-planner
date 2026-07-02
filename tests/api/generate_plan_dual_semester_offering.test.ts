/**
 * Product regression — Dual-Semester Course Placement Flexibility, end-to-end
 * through the generate-plan handler.
 *
 * DUAL's only availability data is offered_semesters: ["A", "B"] (term
 * letters, the vocabulary real board data uses), while the board's semester
 * ids are year_3_semester_a/b. The planner must be able to place DUAL in
 * either semester and choose dynamically: with a user cap that Semester A
 * placement would violate, DUAL must land in Semester B.
 *
 * Uses its own board fixture (data/boards/test_program_dual_2027.json — MAND
 * fixed in Semester A + DUAL dual-offered, sole candidate of a required
 * category); does not modify any prior generate-plan test file.
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
  ],
  category_requirements: [
    { name: 'דו-סמסטריאלי', category_id: 'dualcat', required: 1, placed: 0, candidates: [
      { course_id: 'DUAL', name_he: 'דואלי', hours: 4, offered_semesters: ['A', 'B'] },
    ] },
  ],
  total_hours_progress: { known_completed_hours: 0, degree_required_hours: 8 },
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
    program_id: 'test_program_dual_2027',
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

describe('generate-plan — dual-offered course (offered_semesters ["A","B"]) is placed flexibly', () => {
  beforeEach(() => {
    process.env.AI_DEV_MODE = 'true';
    process.env.AI_DEV_BYPASS_QUOTA = 'true';
  });
  afterEach(() => {
    delete process.env.AI_DEV_MODE;
    delete process.env.AI_DEV_BYPASS_QUOTA;
    delete process.env.AI_USE_AGENTIC_PLANNER;
  });

  test('1. product: DUAL is placed at all (was unplaceable — term letters matched no board semester)', async () => {
    const res = makeRes();
    await handler(makeReq(baseReqBody()), res);
    expect(res.statusCode).toBe(200);
    const sem = semesterOf(res._body, 'DUAL');
    expect(sem).not.toBeNull();
    expect(['year_3_semester_a', 'year_3_semester_b']).toContain(sem);
  });

  test('2. dynamic choice: with a user cap that A-placement would break, DUAL lands in Semester B', async () => {
    const res = makeRes();
    await handler(
      makeReq(baseReqBody({ preferences: { disallowed_course_ids: [], max_weekly_hours: 6 } })),
      res,
    );
    expect(res.statusCode).toBe(200);
    expect(semesterOf(res._body, 'DUAL')).toBe('year_3_semester_b');
  });

  test('3. agentic path: same dynamic Semester B choice (shared model/validation mechanism)', async () => {
    process.env.AI_USE_AGENTIC_PLANNER = 'true';
    const res = makeRes();
    await handler(
      makeReq(baseReqBody({ preferences: { disallowed_course_ids: [], max_weekly_hours: 6 } })),
      res,
    );
    expect(res.statusCode).toBe(200);
    expect(semesterOf(res._body, 'DUAL')).toBe('year_3_semester_b');
  });
});

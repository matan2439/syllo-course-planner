/**
 * Currently-Taking Mandatory Requirement Accounting — end-to-end through the
 * default generate-plan path.
 *
 * Scenario: the user is currently taking MAND (personal_status.currently_taking,
 * NOT completed), so MAND is not on the future board. Rule 2a forbids the
 * planner from placing MAND again, so requirement accounting must not keep
 * demanding it: the "קורסי חובה" requirements row must not count it as
 * still-required, and no "חסר קורס חובה" warning may be emitted merely because
 * it is absent from the proposal.
 *
 * Reuses the MAND (mandatory) + FLU (sole "fluids" category candidate) board
 * fixture data/boards/test_program_2027.json; does not modify any prior
 * generate-plan test file.
 */

import handler from '../../api/ai/generate-plan';
import { randomUUID } from 'crypto';

// MAND is NOT placed on the board: in the product scenario it is being taken
// right now (currently_taking), and in the negative scenario the planner is
// expected to place it itself.
const PLAN_CONTEXT_EMPTY_BOARD = {
  program_name: 'בדיקה',
  semesters: [
    { id: 'year_3_semester_a', label: "שנה ג׳ א׳", total_hours: 0, courses: [] },
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

function withPersonalStatus(personalStatus: any) {
  return { ...PLAN_CONTEXT_EMPTY_BOARD, personal_status: personalStatus };
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
    program_id: 'test_program_2027',
    plan_context: PLAN_CONTEXT_EMPTY_BOARD,
    preferences: { disallowed_course_ids: [] },
    session_token: randomUUID(),
    ...overrides,
  };
}

function placedIdsOf(body: any): string[] {
  return body.semesters.flatMap((s: any) => s.course_ids);
}
function mandatoryRowOf(body: any) {
  return body.requirements_status.find((r: any) => r.name === 'קורסי חובה');
}

describe('generate-plan — currently-taking mandatory is accounted for, not re-required (default path)', () => {
  beforeEach(() => {
    process.env.AI_DEV_MODE = 'true';
    process.env.AI_DEV_BYPASS_QUOTA = 'true';
  });
  afterEach(() => {
    delete process.env.AI_DEV_MODE;
    delete process.env.AI_DEV_BYPASS_QUOTA;
  });

  test('1. product scenario: MAND currently taking (not completed) → not required again, not "missing", not re-proposed', async () => {
    const res = makeRes();
    await handler(
      makeReq(baseReqBody({
        plan_context: withPersonalStatus({
          completed: [],
          currently_taking: [{ course_id: 'MAND' }],
        }),
      })),
      res,
    );
    const b = res._body;
    expect(res.statusCode).toBe(200);
    const placed = placedIdsOf(b);
    // rule 2a still holds — the currently-taking course is never re-proposed.
    expect(placed).not.toContain('MAND');
    // requirement accounting no longer demands it.
    const mandRow = mandatoryRowOf(b);
    expect(mandRow.required).toBe(0);
    expect(mandRow.satisfied).toBe(true);
    expect(b.warnings_he.filter((w: string) => w.includes('חסר קורס חובה'))).toEqual([]);
  });

  test('2. negative: MAND neither completed nor currently taking → still required, and the planner places it', async () => {
    const res = makeRes();
    await handler(makeReq(baseReqBody()), res);
    const b = res._body;
    expect(res.statusCode).toBe(200);
    const mandRow = mandatoryRowOf(b);
    expect(mandRow.required).toBe(1);
    expect(placedIdsOf(b)).toContain('MAND');
  });

  test('3. completed-course behavior unchanged: MAND completed → not required, not re-proposed', async () => {
    const res = makeRes();
    await handler(
      makeReq(baseReqBody({
        plan_context: withPersonalStatus({ completed: [{ course_id: 'MAND' }] }),
      })),
      res,
    );
    const b = res._body;
    expect(res.statusCode).toBe(200);
    expect(placedIdsOf(b)).not.toContain('MAND');
    const mandRow = mandatoryRowOf(b);
    expect(mandRow.required).toBe(0);
    expect(mandRow.satisfied).toBe(true);
  });
});

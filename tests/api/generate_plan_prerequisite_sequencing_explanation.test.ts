/**
 * Regression test for an Agent Diagnosis Loop finding (2026-07-22, "in-plan
 * prerequisite sequencing" area): when a course's own prerequisite forces it
 * to be placed later than its earliest nominally-legal semester, nothing in
 * the response ever explained why. PlannerWorker's trace-reason buckets
 * (mandatory / category / wanted / filler-hours) never reference sequencing,
 * and academicDecision.explanation.whyThisPlan is plan-aggregate-only — a
 * user who expected a course "as soon as possible" got zero signal that
 * prerequisite ordering, not preference or capacity, pushed it a full
 * semester (or year) later.
 *
 * Uses a dedicated board fixture, data/boards/test_program_prereq_sequencing_2027.json
 * (MAND mandatory / PRE elective-only-in-year_3_semester_b / ADV requiring
 * PRE, sole "advanced" category candidate, nominally legal starting
 * year_3_semester_b) — deliberately NOT the shared test_program_prereq_2027.json
 * fixture other tests already depend on, since ADV there is only nominally
 * legal starting year_4_semester_a (no gap exists to explain).
 *
 * generate-plan.ts's new prerequisiteSequencingNotes (in toProposal) closes
 * this gap: a pure function of (finalState, model) that re-derives the same
 * strict-timing fact plan_validation.ts's own gate already enforces, and
 * discloses it as a Hebrew warnings_he entry reaching both the default and
 * use_academic_decision_agent:true paths.
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
    { name: 'מתקדמים', category_id: 'advanced', required: 1, placed: 0, candidates: [
      { course_id: 'ADV', name_he: 'מתקדם', hours: 4, effective_allowed_semesters: ['year_3_semester_b', 'year_4_semester_a', 'year_4_semester_b'] },
    ] },
  ],
  total_hours_progress: { known_completed_hours: 177, degree_required_hours: 185 },
  personal_status: { completed: [{ course_id: 'MAND' }] },
  mandatory_unplaced: [],
};

function withPersonalStatus(personalStatus: any) {
  return { ...PLAN_CONTEXT, personal_status: personalStatus };
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
    program_id: 'test_program_prereq_sequencing_2027',
    plan_context: PLAN_CONTEXT,
    preferences: { disallowed_course_ids: [] },
    session_token: randomUUID(),
    ...overrides,
  };
}

function placedIdsOf(body: any): string[] {
  return body.semesters.flatMap((s: any) => s.course_ids);
}
function semesterOfPlaced(body: any, courseId: string): string | undefined {
  return body.semesters.find((s: any) => s.course_ids.includes(courseId))?.semester_id;
}

describe('generate-plan — prerequisite-driven placement delay is disclosed (Agent Diagnosis Loop finding)', () => {
  beforeEach(() => {
    process.env.AI_DEV_MODE = 'true';
    process.env.AI_DEV_BYPASS_QUOTA = 'true';
  });
  afterEach(() => {
    delete process.env.AI_DEV_MODE;
    delete process.env.AI_DEV_BYPASS_QUOTA;
    delete process.env.AI_USE_AGENTIC_PLANNER;
  });

  test('1. PRE not yet completed: ADV is pushed to year_4_semester_a (not its nominally-legal year_3_semester_b), and warnings_he explains why', async () => {
    const res = makeRes();
    await handler(makeReq(baseReqBody()), res);
    const b = res._body;
    expect(res.statusCode).toBe(200);
    expect(placedIdsOf(b)).toEqual(expect.arrayContaining(['PRE', 'ADV']));
    expect(semesterOfPlaced(b, 'PRE')).toBe('year_3_semester_b');
    expect(semesterOfPlaced(b, 'ADV')).toBe('year_4_semester_a');

    const note = b.warnings_he.find((w: string) => w.includes('מתקדם') && w.includes('קדם'));
    expect(note).toBeDefined();
    expect(note).toContain('year_4_semester_a');
    expect(note).toContain('year_3_semester_b');
  });

  test('2. sanity/no-false-positive: PRE already completed → ADV lands at its actual earliest nominal semester, no sequencing note fires', async () => {
    const res = makeRes();
    await handler(
      makeReq(baseReqBody({
        plan_context: withPersonalStatus({ completed: [{ course_id: 'MAND' }, { course_id: 'PRE' }] }),
      })),
      res,
    );
    const b = res._body;
    expect(res.statusCode).toBe(200);
    expect(semesterOfPlaced(b, 'ADV')).toBe('year_3_semester_b');
    const note = b.warnings_he.find((w: string) => w.includes('מתקדם') && w.includes('קדם'));
    expect(note).toBeUndefined();
  });

  test('3. same disclosure reaches use_academic_decision_agent:true (academicDecision.explanation.risksAndTradeoffs)', async () => {
    const res = makeRes();
    await handler(makeReq(baseReqBody({ use_academic_decision_agent: true })), res);
    const b = res._body;
    expect(res.statusCode).toBe(200);
    expect(b.academicDecision).toBeDefined();
    const note = b.academicDecision.explanation.risksAndTradeoffs.find(
      (w: string) => w.includes('מתקדם') && w.includes('קדם'),
    );
    expect(note).toBeDefined();
    expect(note).toContain('year_4_semester_a');
    expect(note).toContain('year_3_semester_b');
  });

  test('4. same disclosure holds on the AI_USE_AGENTIC_PLANNER path', async () => {
    process.env.AI_USE_AGENTIC_PLANNER = 'true';
    const res = makeRes();
    await handler(makeReq(baseReqBody()), res);
    const b = res._body;
    expect(res.statusCode).toBe(200);
    expect(semesterOfPlaced(b, 'ADV')).toBe('year_4_semester_a');
    const note = b.warnings_he.find((w: string) => w.includes('מתקדם') && w.includes('קדם'));
    expect(note).toBeDefined();
  });

  // Guards the confident-vs-unconfident distinction the fix relies on: FILL
  // (the board's 4th course) has no offering-legality data at all — an
  // ordinary elective with no known restriction. It also requires PRE, and
  // sits on the incoming board already placed at year_4_semester_a (a
  // semester strictly after PRE's own year_3_semester_b placement) — the
  // same shape ADV's real, legitimate note is built from. Without the
  // getLegalSemesters().confident guard, legalSemestersFor's unconfident
  // fallback (every known semester) would make FILL's "earliest legal
  // semester" look like year_3_semester_a, and this fix would falsely claim
  // FILL's placement was pushed out by PRE — when in fact FILL simply has no
  // known restriction at all, and the real reason it wasn't placed earlier is
  // legitimately unknowable from offering data alone. Pre-placing (rather
  // than relying on the search to discover FILL as a filler action) isolates
  // exactly the confidence guard, independent of whether the search itself
  // would ever choose to place an unrestricted filler course.
  test('5. no false positive for a pre-placed course with NO confident legal-semester data, even though it also requires PRE', async () => {
    const planContext = {
      ...PLAN_CONTEXT,
      semesters: PLAN_CONTEXT.semesters.map((s) => {
        if (s.id === 'year_3_semester_b') {
          return { ...s, total_hours: 4, courses: [{ course_id: 'PRE', name_he: 'קדם', hours: 4, course_type: 'elective', placement_policy: 'elective', effective_allowed_semesters: ['year_3_semester_b'] }] };
        }
        if (s.id === 'year_4_semester_a') {
          return { ...s, total_hours: 4, courses: [{ course_id: 'FILL', name_he: 'מילוי', hours: 4, course_type: 'elective', placement_policy: 'elective' }] };
        }
        return s;
      }),
    };
    const res = makeRes();
    await handler(makeReq(baseReqBody({ plan_context: planContext })), res);
    const b = res._body;
    expect(res.statusCode).toBe(200);
    expect(placedIdsOf(b)).toEqual(expect.arrayContaining(['PRE', 'FILL', 'ADV']));
    // The real, legitimate ADV note must still fire...
    const advNote = b.warnings_he.find((w: string) => w.includes('מתקדם') && w.includes('קדם'));
    expect(advNote).toBeDefined();
    // ...but FILL must never get one, confident data or not.
    const fillNote = b.warnings_he.find((w: string) => w.includes('מילוי'));
    expect(fillNote).toBeUndefined();
  });
});

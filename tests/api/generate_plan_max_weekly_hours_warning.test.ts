/**
 * generate-plan — issue #25 Finding #3: preferences.max_weekly_hours is a real
 * user-stated soft cap (planner_goals.ts uses it only as a search tiebreaker),
 * but exceeding it was never disclosed in the default (no-flag) path's
 * warnings_he — only inside the opt-in use_academic_decision_agent path's
 * academicDecision.evaluation.workloadNotes, which was unreachable for anyone
 * still gated by Finding #2 (now fixed). generate-plan.ts's new
 * maxWeeklyHoursWarnings() is the single source of truth: it feeds
 * proposal.warnings_he directly, so both paths report it, without showing the
 * same message twice in the agent path's explanation.risksAndTradeoffs
 * (academic_decision_runtime.ts dedupes against the (byte-identical)
 * computeWorkloadNotes entry).
 */

import handler from '../../api/ai/generate-plan';
import { randomUUID } from 'crypto';

// MAND is a single 10-hour fixed mandatory course placed alone in one
// semester — simple, deterministic total hours for that semester.
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
  personal_status: { completed: [{ course_id: 'PRIOR' }], currently_taking: [] },
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
async function run(body: any) {
  const res = makeRes();
  await handler(makeReq(body), res);
  return res;
}

const CAP_MESSAGE_FRAGMENT = 'מעל המגבלה שביקשת';

describe('generate-plan — max_weekly_hours exceeded warning (issue #25 Finding #3)', () => {
  beforeEach(() => {
    process.env.AI_DEV_MODE = 'true';
    process.env.AI_DEV_BYPASS_QUOTA = 'true';
  });
  afterEach(() => {
    delete process.env.AI_DEV_MODE;
    delete process.env.AI_DEV_BYPASS_QUOTA;
  });

  test('1. default path: exceeding the stated cap is disclosed in warnings_he', async () => {
    const res = await run({
      program_id: 'test_program_2027',
      plan_context: PLAN_CONTEXT,
      preferences: { max_weekly_hours: 2 },
      session_token: randomUUID(),
    });
    expect(res.statusCode).toBe(200);
    expect(res._body.warnings_he.some((w: string) => w.includes(CAP_MESSAGE_FRAGMENT) && w.includes('2'))).toBe(true);
  });

  test('2. default path: no cap stated → no cap-exceeded warning (never invents a cap)', async () => {
    const res = await run({
      program_id: 'test_program_2027',
      plan_context: PLAN_CONTEXT,
      preferences: {},
      session_token: randomUUID(),
    });
    expect(res._body.warnings_he.some((w: string) => w.includes(CAP_MESSAGE_FRAGMENT))).toBe(false);
  });

  test('3. default path: cap stated but not exceeded → no warning', async () => {
    const res = await run({
      program_id: 'test_program_2027',
      plan_context: PLAN_CONTEXT,
      preferences: { max_weekly_hours: 20 },
      session_token: randomUUID(),
    });
    expect(res._body.warnings_he.some((w: string) => w.includes(CAP_MESSAGE_FRAGMENT))).toBe(false);
  });

  test('4. agent path: warnings_he cap-exceeded entries reach explanation.risksAndTradeoffs without being duplicated', async () => {
    // With max_weekly_hours:2, this fixture's planner legitimately places two
    // *different* over-cap semesters (MAND in year_3_semester_a, FLU once
    // placed in year_4_semester_a) — two distinct, both-real messages, not a
    // duplication bug. The actual duplication risk this test guards is the
    // SAME message appearing twice (once from proposal.warnings_he, once
    // from computeWorkloadNotes) — verified by asserting no exact-string
    // repeats anywhere in risksAndTradeoffs.
    const res = await run({
      program_id: 'test_program_2027',
      plan_context: PLAN_CONTEXT,
      preferences: { max_weekly_hours: 2 },
      session_token: randomUUID(),
      use_academic_decision_agent: true,
    });
    expect(res.statusCode).toBe(200);
    const risks: string[] = res._body.academicDecision.explanation.risksAndTradeoffs;
    const capMessages = risks.filter((w) => w.includes(CAP_MESSAGE_FRAGMENT));
    expect(capMessages.length).toBeGreaterThan(0);
    expect(new Set(risks).size).toBe(risks.length); // no exact-string duplicate anywhere
    // Also present in the shared warnings_he (same source both paths read).
    expect(res._body.warnings_he.some((w: string) => w.includes(CAP_MESSAGE_FRAGMENT))).toBe(true);
  });

  test('5. agent path: evaluation.workloadNotes still reports the peak-load summary', async () => {
    const res = await run({
      program_id: 'test_program_2027',
      plan_context: PLAN_CONTEXT,
      preferences: { max_weekly_hours: 2 },
      session_token: randomUUID(),
      use_academic_decision_agent: true,
    });
    expect(res._body.academicDecision.evaluation.workloadNotes.some((n: string) => n.includes('עומס שיא'))).toBe(true);
  });
});

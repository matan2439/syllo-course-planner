/**
 * generate-plan — real-Agent diagnosis finding: when the planner has placed
 * every mandatory course and satisfied every elective category but the
 * catalog visible in plan_context simply doesn't contain enough hours to
 * reach model.degreeRequiredHours, the search terminates having exhausted
 * every legal action (planner_lookahead.ts's projectFeasibility already
 * detects this internally — see planner_worker.ts's use of it as a ranking
 * signal). Previously the ONLY disclosure was the generic
 * "התוכנית משלימה X/Y ש"ש" line — identical wording to an ordinary,
 * still-fixable shortfall. A real user (and the live frontend's decision
 * text, semester_board_viewer.html's postPlanChangeSummary) can't tell
 * "more course selection would help" apart from "the visible planning
 * window is structurally too small; nothing left to add". This is
 * misleading, not just incomplete: the frontend currently suggests
 * "approve a risky elective from the list" even when no such elective
 * exists.
 *
 * Fix: toProposal() now also runs projectFeasibility(finalState, model) and,
 * when degree hours are unmet AND every mandatory/category requirement is
 * already satisfied AND the ONLY remaining feasibility blocker is the
 * aggregate 'degree_hours' gap (i.e. no further legal action could close it
 * from this final state), pushes a distinct, unambiguous warning.
 *
 * Uses the dedicated data/boards/test_program_gap_2027.json fixture: a tiny,
 * fully-legal catalog (one 4h mandatory course + one 4h candidate in each of
 * two categories, 8h reachable ceiling) against a real 185h degree target —
 * category/hours data here comes from the STATIC board file (loaded by
 * program_id), not from plan_context, matching how buildModel/
 * buildConstraintModel actually source category_requirements_categories.
 */

import handler from '../../api/ai/generate-plan';
import { randomUUID } from 'crypto';

const PROGRAM_ID = 'test_program_gap_2027';

function planContext(knownCompletedHours = 0) {
  return {
    program_name: 'בדיקה',
    semesters: [
      { id: 'year_3_semester_a', label: 'שנה ג׳ א׳', total_hours: 4, courses: [
        { course_id: 'MAND', name_he: 'חובה', hours: 4, course_type: 'mandatory', placement_policy: 'fixed', effective_allowed_semesters: ['year_3_semester_a'] },
      ] },
      { id: 'year_3_semester_b', label: 'שנה ג׳ ב׳', total_hours: 0, courses: [] },
      { id: 'year_4_semester_a', label: 'שנה ד׳ א׳', total_hours: 0, courses: [] },
      { id: 'year_4_semester_b', label: 'שנה ד׳ ב׳', total_hours: 0, courses: [] },
    ],
    total_hours_progress: { known_completed_hours: knownCompletedHours },
    personal_status: { completed: [], currently_taking: [] },
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
async function run(body: any) {
  const res = makeRes();
  await handler(makeReq(body), res);
  return res;
}

const STRUCTURAL_GAP_FRAGMENT = 'מיצית את כל הקורסים הזמינים בחלון התכנון';

describe('generate-plan — structural degree-hours gap warning (Agent Diagnosis Loop finding)', () => {
  beforeEach(() => {
    process.env.AI_DEV_MODE = 'true';
    process.env.AI_DEV_BYPASS_QUOTA = 'true';
  });
  afterEach(() => {
    delete process.env.AI_DEV_MODE;
    delete process.env.AI_DEV_BYPASS_QUOTA;
  });

  test('1. default path: every requirement satisfied but the catalog is exhausted well short of the degree target → distinct structural warning', async () => {
    const res = await run({
      program_id: PROGRAM_ID,
      plan_context: planContext(0),
      preferences: {},
      session_token: randomUUID(),
    });
    expect(res.statusCode).toBe(200);
    expect(res._body.requirements_status.every((r: any) => r.satisfied)).toBe(true);
    expect(res._body.warnings_he.some((w: string) => w.includes(STRUCTURAL_GAP_FRAGMENT))).toBe(true);
    // The generic hours line still appears too — additive, not a replacement.
    expect(res._body.warnings_he.some((w: string) => w.includes('התוכנית משלימה'))).toBe(true);
  });

  test('2. default path: prior hours bring the same tiny catalog up to the real 185h target → no structural warning', async () => {
    // MAND(4) + FLU(4) + SOL(4) = 12 placed; 173 prior hours closes exactly to 185.
    const res = await run({
      program_id: PROGRAM_ID,
      plan_context: planContext(173),
      preferences: {},
      session_token: randomUUID(),
    });
    expect(res.statusCode).toBe(200);
    expect(res._body.requirements_status.every((r: any) => r.satisfied)).toBe(true);
    expect(res._body.warnings_he.some((w: string) => w.includes(STRUCTURAL_GAP_FRAGMENT))).toBe(false);
  });

  test('3. default path: a category genuinely cannot be satisfied (its one candidate is hard-excluded) → unsatisfiedCategories warning fires, NOT the structural gap warning', async () => {
    const res = await run({
      program_id: PROGRAM_ID,
      plan_context: planContext(0),
      preferences: { strongly_avoided_course_ids: ['SOL'] },
      session_token: randomUUID(),
    });
    expect(res.statusCode).toBe(200);
    expect(res._body.requirements_status.some((r: any) => !r.satisfied)).toBe(true);
    expect(res._body.warnings_he.some((w: string) => w.includes('דרישת קטגוריה לא מולאה'))).toBe(true);
    expect(res._body.warnings_he.some((w: string) => w.includes(STRUCTURAL_GAP_FRAGMENT))).toBe(false);
  });

  test('4. agent path (use_academic_decision_agent:true): same structural warning reaches warnings_he', async () => {
    const res = await run({
      program_id: PROGRAM_ID,
      plan_context: planContext(0),
      preferences: {},
      session_token: randomUUID(),
      use_academic_decision_agent: true,
    });
    expect(res.statusCode).toBe(200);
    expect(res._body.warnings_he.some((w: string) => w.includes(STRUCTURAL_GAP_FRAGMENT))).toBe(true);
  });
});

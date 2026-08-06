/**
 * PRODUCT acceptance — the real Hebrew free-text exclusion "אל תשבץ תרמודינמיקה 2"
 * reliably controls the ACTUAL native plan on the REAL Mechanical-Engineering board.
 *
 * The mechanism (planning_intent.ts → mergeIntentIntoPreferences → buildModel's
 * disallowedCourseIds → planner + disallowedGate) already exists and is exercised
 * on a synthetic fixture by generate_plan_free_text_intent.test.ts. This locks the
 * REAL product outcome end-to-end through the exact browser-shaped request
 * (NativePlannerJourney.buildRequest): the real sentence resolves the real course
 * name "תרמודינמיקה 2" (no parens) to the real catalog id 0542-4120 ("תרמודינמיקה (2)")
 * and enforces it in the returned proposal — not by post-hoc display filtering.
 *
 * No production logic is special-cased for this sentence or id; the id is a fixture.
 */
import handler from '../../api/ai/generate-plan';
import { randomUUID } from 'crypto';
import { readFileSync } from 'fs';
import { join } from 'path';

const BOARD = JSON.parse(
  readFileSync(join(__dirname, '..', '..', 'data', 'boards', 'mechanical_engineering_2027.json'), 'utf8'),
);
const THERMO2 = '0542-4120'; // תרמודינמיקה (2)
const EXCLUDE_SENTENCE = 'אל תשבץ תרמודינמיקה 2';

/** Browser-shaped plan_context (NativePlannerJourney): semesters with course_ids + prior hours. */
function planContext(extraPlaced: string[] = []) {
  const semesters = BOARD.semesters.map((s: any) => ({
    id: s.semester_id,
    courses: (s.courses || []).map((c: any) => ({ course_id: c.course_id })),
  }));
  if (extraPlaced.length) {
    semesters[semesters.length - 1].courses.push(...extraPlaced.map((id) => ({ course_id: id })));
  }
  return {
    semesters,
    personal_status: { completed: [], currently_taking: [], planned: [] },
    total_hours_progress: { known_completed_hours: 90 },
  };
}
const makeRes = () => {
  const res: any = {
    statusCode: 0,
    setHeader: jest.fn().mockReturnThis(),
    status: jest.fn(function (this: any, c: number) { this.statusCode = c; return this; }),
    json: jest.fn(function (this: any, b: any) { this._body = b; return this; }),
    write: jest.fn(), end: jest.fn(),
  };
  return res;
};
async function run(body: any) {
  const res = makeRes();
  await handler({ method: 'POST', body: { program_id: 'mechanical_engineering_2027', session_token: randomUUID(), ...body } } as any, res);
  return res;
}
const placed = (body: any): string[] => [...new Set((body.semesters as any[]).flatMap((s) => s.course_ids))];

beforeEach(() => { process.env.AI_DEV_MODE = 'true'; process.env.AI_DEV_BYPASS_QUOTA = 'true'; });
afterEach(() => { delete process.env.AI_DEV_MODE; delete process.env.AI_DEV_BYPASS_QUOTA; });

// Control — the exclusion is non-vacuous: 0542-4120 IS a course the planner will place
// (here, when the user wants it) absent any exclusion.
test('CONTROL: without exclusion, 0542-4120 can be placed (proves the exclusion is meaningful)', async () => {
  const res = await run({ plan_context: planContext(), preferences: { wanted_course_ids: [THERMO2] } });
  expect(res.statusCode).toBe(200);
  expect(placed(res._body)).toContain(THERMO2);
}, 60000);

test('the real sentence excludes 0542-4120 from the proposal, honored truthfully, plan still legal', async () => {
  const res = await run({
    plan_context: planContext(),
    preferences: { extra_request_he: EXCLUDE_SENTENCE },
    interpret_free_text: true,
  });
  expect(res.statusCode).toBe(200);
  expect(res._body.blocked).toBe(false);
  expect(placed(res._body)).not.toContain(THERMO2);                 // absent from the ACTUAL proposal
  // rationale derived from the final proposal (honored, not falsely claimed)
  expect(res._body.intentOutcome.honored.join(' ')).toContain('תרמודינמיקה');
  expect(res._body.intentOutcome.unmet).toEqual([]);
}, 60000);

test('structured exclusion and free-text exclusion converge on the same policy (both absent)', async () => {
  const structured = await run({ plan_context: planContext(), preferences: { disallowed_course_ids: [THERMO2] } });
  const freeText = await run({ plan_context: planContext(), preferences: { extra_request_he: EXCLUDE_SENTENCE }, interpret_free_text: true });
  expect(placed(structured._body)).not.toContain(THERMO2);
  expect(placed(freeText._body)).not.toContain(THERMO2);
}, 90000);

test('a positive preference cannot re-add an excluded course', async () => {
  const res = await run({
    plan_context: planContext(),
    preferences: { wanted_course_ids: [THERMO2], extra_request_he: EXCLUDE_SENTENCE },
    interpret_free_text: true,
  });
  expect(res.statusCode).toBe(200);
  expect(placed(res._body)).not.toContain(THERMO2); // exclusion beats the want
}, 60000);

test('exclusion is ENFORCED, never silently kept: a pre-placed excluded course blocks the plan', async () => {
  const res = await run({
    plan_context: planContext([THERMO2]), // 4120 already on the submitted board
    preferences: { extra_request_he: EXCLUDE_SENTENCE },
    interpret_free_text: true,
  });
  expect(res.statusCode).toBe(200);
  // The planner only adds/moves — it cannot remove a board course — so an honest
  // BLOCK is returned rather than silently keeping the excluded course as applicable.
  expect(res._body.blocked).toBe(true);
  expect(res._body.errors.join(' ')).toContain('תרמודינמיקה');
}, 60000);

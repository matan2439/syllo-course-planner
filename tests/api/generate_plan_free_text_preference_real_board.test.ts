/**
 * PRODUCT acceptance — the real Hebrew free-text POSITIVE preference
 * "שבץ לי את תורת התנודות" reliably makes the ACTUAL native plan PREFER and
 * INCLUDE course 0542-4220 ("תורת התנודות"), and — because its authoritative
 * offering is Semester-B only — places it ONLY in a Semester-B slot.
 *
 * The planner mechanism already exists (planner honors wanted_course_ids via
 * enumerateActions group 3 + scorePlan g5, restricted to legal offering
 * semesters). The intent boundary (planning_intent.ts PREFER_MARKERS) is the
 * only connection this slice adds: the imperative "schedule for me" verb, the
 * positive symmetry of the already-accepted "אל תשבץ" exclusion marker.
 *
 * No production logic is special-cased for this sentence or id; the id is a fixture.
 *
 * Non-vacuous by construction: the CONTROL (no preference) proposal does NOT
 * place 0542-4220, so any placement below is caused by the request, not by the
 * planner placing it anyway.
 */
import handler from '../../api/ai/generate-plan';
import { randomUUID } from 'crypto';
import { readFileSync } from 'fs';
import { join } from 'path';

const BOARD = JSON.parse(
  readFileSync(join(__dirname, '..', '..', 'data', 'boards', 'mechanical_engineering_2027.json'), 'utf8'),
);
const OSC = '0542-4220';    // תורת התנודות — authoritative offering: Semester B only
const PREFER_SENTENCE = 'שבץ לי את תורת התנודות';
const EXCLUDE_SENTENCE = 'אל תשבץ תורת התנודות';
const B_SEMESTER = /_semester_b$/i;

/** Browser-shaped plan_context (NativePlannerJourney): semesters with course_ids + prior hours. */
function planContext() {
  return {
    semesters: BOARD.semesters.map((s: any) => ({
      id: s.semester_id,
      courses: (s.courses || []).map((c: any) => ({ course_id: c.course_id })),
    })),
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
const semesterOf = (body: any, id: string): string | null => {
  for (const s of body.semesters as any[]) if (s.course_ids.includes(id)) return s.semester_id;
  return null;
};

beforeEach(() => { process.env.AI_DEV_MODE = 'true'; process.env.AI_DEV_BYPASS_QUOTA = 'true'; });
afterEach(() => { delete process.env.AI_DEV_MODE; delete process.env.AI_DEV_BYPASS_QUOTA; });

// (10) CONTROL — without the preference the planner does NOT place 0542-4220,
// and never falsely claims it was honored (proves the request below is non-vacuous).
test('CONTROL: without the request, 0542-4220 is NOT placed and nothing is claimed honored', async () => {
  const res = await run({ plan_context: planContext(), preferences: {} });
  expect(res.statusCode).toBe(200);
  expect(placed(res._body)).not.toContain(OSC);
  expect(res._body.intentOutcome).toBeUndefined();
}, 60000);

// (3) placed when legally feasible, (4)+(5) only in Semester B, (8)+(9) outcome/validation agree.
test('the real sentence PREFERS and PLACES 0542-4220 — only in a Semester-B slot — and says so truthfully', async () => {
  const res = await run({
    plan_context: planContext(),
    preferences: { extra_request_he: PREFER_SENTENCE },
    interpret_free_text: true,
  });
  expect(res.statusCode).toBe(200);
  expect(res._body.blocked).toBe(false);
  expect(res._body.errors).toEqual([]);
  // (3) actually placed in the returned proposal
  const sem = semesterOf(res._body, OSC);
  expect(sem).not.toBeNull();
  // (4)+(5) placed ONLY in a Semester-B slot — authoritative B-only offering respected
  expect(sem).toMatch(B_SEMESTER);
  // (8) outcome derived from the ACTUAL proposal, (9) it agrees with the placement
  expect(res._body.intentOutcome.honored.join(' ')).toContain('תורת התנודות');
  expect(res._body.intentOutcome.unmet).toEqual([]);
}, 60000);

// (2) free text reaches the canonical structured preference — converges with the
// structured wanted_course_ids path on the same placement + same B semester.
test('free-text preference and structured wanted_course_ids converge on the same B-slot placement', async () => {
  const structured = await run({ plan_context: planContext(), preferences: { wanted_course_ids: [OSC] } });
  const freeText = await run({ plan_context: planContext(), preferences: { extra_request_he: PREFER_SENTENCE }, interpret_free_text: true });
  const s1 = semesterOf(structured._body, OSC);
  const s2 = semesterOf(freeText._body, OSC);
  expect(s1).toMatch(B_SEMESTER);
  expect(s2).toMatch(B_SEMESTER);
  expect(s2).toBe(s1);
}, 90000);

// (7) fill/repair/workload balancing must not silently discard the preference
// when an equally valid preferred plan exists.
test('workload balancing does not discard the preference — 0542-4220 still placed in Semester B', async () => {
  const res = await run({
    plan_context: planContext(),
    preferences: { extra_request_he: PREFER_SENTENCE, balance_load: true },
    interpret_free_text: true,
  });
  expect(res.statusCode).toBe(200);
  expect(res._body.blocked).toBe(false);
  expect(semesterOf(res._body, OSC)).toMatch(B_SEMESTER);
  expect(res._body.intentOutcome.honored.join(' ')).toContain('תורת התנודות');
}, 60000);

// (6) explicit exclusion wins over a positive preference for the same course.
test('explicit exclusion wins: preferring AND disallowing 0542-4220 leaves it absent', async () => {
  const res = await run({
    plan_context: planContext(),
    preferences: { extra_request_he: PREFER_SENTENCE, disallowed_course_ids: [OSC] },
    interpret_free_text: true,
  });
  expect(res.statusCode).toBe(200);
  expect(placed(res._body)).not.toContain(OSC);
}, 60000);

// (6) same, expressed purely in free text: a negated schedule ("אל תשבץ") is an
// exclusion and beats any positive reading of the same verb.
test('free-text negated schedule "אל תשבץ תורת התנודות" excludes it, not places it', async () => {
  const res = await run({
    plan_context: planContext(),
    preferences: { extra_request_he: EXCLUDE_SENTENCE },
    interpret_free_text: true,
  });
  expect(res.statusCode).toBe(200);
  expect(placed(res._body)).not.toContain(OSC);
}, 60000);

// (1)+(5) authoritative availability is never overridden by the preference:
// 0542-4220 is B-only, so it can never appear in a Semester-A slot.
test('positive preference never forces 0542-4220 into a Semester-A slot', async () => {
  const res = await run({
    plan_context: planContext(),
    preferences: { extra_request_he: PREFER_SENTENCE },
    interpret_free_text: true,
  });
  const sem = semesterOf(res._body, OSC);
  expect(sem).not.toBeNull();
  expect(sem).not.toMatch(/_semester_a$/i);
}, 60000);

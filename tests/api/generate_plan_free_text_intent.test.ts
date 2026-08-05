/**
 * generate-plan — free-text Hebrew intent MEASURABLY changes the deterministic
 * plan (opt-in interpret_free_text), through the planning-intent boundary
 * (planning_intent.ts) into the SAME structured planner fields the greedy
 * planner already honors. Uses a generic fixture (test_program_intent_2027):
 * a mandatory "מבוא" plus two interchangeable, dual-semester "core" electives
 * "אלפא"/"בטא" (difficulty asymmetric, so the baseline prefers the easier אלפא).
 *
 * These are acceptance FIXTURES — no production course id/name is in the
 * interpreter's or planner's logic.
 */
import handler from '../../api/ai/generate-plan';
import { randomUUID } from 'crypto';

const PROGRAM_ID = 'test_program_intent_2027';

// prior hours so exactly one core elective (4h) closes the 185h degree.
function planContext(knownCompletedHours = 177) {
  return {
    semesters: [],
    total_hours_progress: { known_completed_hours: knownCompletedHours },
    personal_status: { completed: [], currently_taking: [], planned: [] },
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
  await handler({ method: 'POST', body } as any, res);
  return res;
}
const placedIds = (body: any): string[] => body.semesters.flatMap((s: any) => s.course_ids);

beforeEach(() => { process.env.AI_DEV_MODE = 'true'; process.env.AI_DEV_BYPASS_QUOTA = 'true'; });
afterEach(() => { delete process.env.AI_DEV_MODE; delete process.env.AI_DEV_BYPASS_QUOTA; });

test('baseline (no free text) places the easier elective אלפא, not בטא', async () => {
  const res = await run({ program_id: PROGRAM_ID, plan_context: planContext(), preferences: {}, session_token: randomUUID() });
  expect(res.statusCode).toBe(200);
  expect(res._body.blocked).toBe(false);
  expect(placedIds(res._body)).toContain('ALPHA');
  expect(placedIds(res._body)).not.toContain('BETA');
  expect(res._body.intentOutcome).toBeUndefined(); // opt-in only
});

test('B — positive preference measurably flips the plan: "אני מעדיף בטא" → בטא placed, אלפא not', async () => {
  const res = await run({
    program_id: PROGRAM_ID, plan_context: planContext(),
    preferences: { extra_request_he: 'אני מעדיף בטא.' },
    interpret_free_text: true, session_token: randomUUID(),
  });
  expect(res.statusCode).toBe(200);
  expect(res._body.blocked).toBe(false);
  expect(placedIds(res._body)).toContain('BETA');   // preference honored (overrides difficulty tiebreak)
  expect(placedIds(res._body)).not.toContain('ALPHA');
  expect(res._body.intentOutcome.honored.join(' ')).toContain('בטא');
});

test('A — free-text hard exclusion: "אל תשבץ אלפא" → אלפא absent, valid plan via בטא', async () => {
  const res = await run({
    program_id: PROGRAM_ID, plan_context: planContext(),
    preferences: { extra_request_he: 'אל תשבץ אלפא.' },
    interpret_free_text: true, session_token: randomUUID(),
  });
  expect(res.statusCode).toBe(200);
  expect(placedIds(res._body)).not.toContain('ALPHA'); // excluded — never appears
  expect(placedIds(res._body)).toContain('BETA');
  expect(res._body.blocked).toBe(false);
  expect(res._body.intentOutcome.honored.join(' ')).toContain('אלפא'); // "…לא שובץ, לפי בקשתך"
});

test('E — excluding a MANDATORY course blocks the plan and is explained truthfully (never silently ignored)', async () => {
  const res = await run({
    program_id: PROGRAM_ID, plan_context: planContext(),
    preferences: { extra_request_he: 'אל תשבץ מבוא.' },
    interpret_free_text: true, session_token: randomUUID(),
  });
  expect(res.statusCode).toBe(200);
  expect(placedIds(res._body)).not.toContain('MAND'); // exclusion held
  expect(res._body.blocked).toBe(true);               // …but the plan is now illegal
  expect(res._body.errors.length).toBeGreaterThan(0);
  expect(res._body.intentOutcome.unmet.join(' ')).toMatch(/חובה|מתנגש/);
});

test('precedence — free-text exclusion overrides a conflicting structured "want"', async () => {
  const res = await run({
    program_id: PROGRAM_ID, plan_context: planContext(),
    preferences: { wanted_course_ids: ['ALPHA'], extra_request_he: 'אל תשבץ אלפא.' },
    interpret_free_text: true, session_token: randomUUID(),
  });
  expect(res.statusCode).toBe(200);
  expect(placedIds(res._body)).not.toContain('ALPHA'); // exclusion wins over the want
});

test('unrecognized free text is a safe no-op with a truthful "not recognized" note', async () => {
  const res = await run({
    program_id: PROGRAM_ID, plan_context: planContext(),
    preferences: { extra_request_he: 'אל תשבץ מכניקת הקוונטים.' }, // not in this catalog
    interpret_free_text: true, session_token: randomUUID(),
  });
  expect(res.statusCode).toBe(200);
  expect(res._body.blocked).toBe(false); // nothing wrongly excluded
  expect(res._body.intentOutcome.unmet.join(' ')).toContain('קוונטים');
});

test('opt-out: same free text without interpret_free_text does NOT change the plan or attach an outcome', async () => {
  const res = await run({
    program_id: PROGRAM_ID, plan_context: planContext(),
    preferences: { extra_request_he: 'אל תשבץ אלפא.' }, // no interpret flag
    session_token: randomUUID(),
  });
  expect(res.statusCode).toBe(200);
  expect(placedIds(res._body)).toContain('ALPHA'); // free text ignored by the greedy planner (unchanged behavior)
  expect(res._body.intentOutcome).toBeUndefined();
});

/**
 * generate-plan — CATALOG INTEGRITY acceptance (E / F).
 *
 * A course with no authoritative Hebrew name has no catalog record to display or
 * validate against. It must NEVER be silently placed into an applicable proposal
 * (which the UI would render as a "פרטי הקורס אינם זמינים" card the student could
 * then Apply). Two generic fixtures — no production course id/name is in the
 * planner's logic:
 *
 *  - test_program_catalog_integrity_2027: a name-less filler NONAME (difficulty
 *    1) that the greedy planner would PREFER over the equally-sized named filler
 *    GOOD (difficulty 5) if it were addable at all — so placing GOOD instead
 *    proves the catalog gate, not merely a difficulty tiebreak.
 *  - test_program_catalog_integrity_blocked_2027: NONAME is the ONLY remaining
 *    filler, so the degree cannot be legally completed — the plan BLOCKS with a
 *    degree-hours shortfall rather than placing a name-less card.
 */
import handler from '../../api/ai/generate-plan';
import { randomUUID } from 'crypto';

// prior 173 + MAND(4) + CORE(4) + one 4h filler = 185.
function planContext(knownCompletedHours = 173) {
  return {
    semesters: [{ id: 'year_3_semester_a', courses: [{ course_id: 'MAND' }] }],
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
async function run(program_id: string) {
  const res = makeRes();
  await handler({ method: 'POST', body: { program_id, plan_context: planContext(), preferences: {}, session_token: randomUUID() } } as any, res);
  return res;
}
const placedIds = (body: any): string[] => body.semesters.flatMap((s: any) => s.course_ids);

beforeEach(() => { process.env.AI_DEV_MODE = 'true'; process.env.AI_DEV_BYPASS_QUOTA = 'true'; });
afterEach(() => { delete process.env.AI_DEV_MODE; delete process.env.AI_DEV_BYPASS_QUOTA; });

test('E/F — the name-less filler is never placed; the named equivalent is chosen instead', async () => {
  const res = await run('test_program_catalog_integrity_2027');
  expect(res.statusCode).toBe(200);
  const ids = placedIds(res._body);
  expect(ids).not.toContain('NONAME');   // catalog gate: never placed…
  expect(ids).toContain('GOOD');         // …the named equivalent wins despite worse difficulty
  expect(res._body.blocked).toBe(false); // and the plan is still applicable (185/185)
});

test('E — when only the name-less course remains, the plan BLOCKS rather than placing a name-less card', async () => {
  const res = await run('test_program_catalog_integrity_blocked_2027');
  expect(res.statusCode).toBe(200);
  expect(placedIds(res._body)).not.toContain('NONAME'); // never rendered as a card
  expect(res._body.blocked).toBe(true);                 // honestly blocked, not silently short
  expect(res._body.errors.join(' ')).toMatch(/ש"ש|תואר/); // degree-hours shortfall surfaced
});

// Field-level integrity: authoritative credit/workload value. A course with no
// authoritative weekly_hours has no valid credit contribution — placing it (even
// when the user explicitly WANTS it) breaks per-semester/degree accounting and
// renders a hours-less card. It must be kept out of an applicable proposal, the
// same way a name-less course is.
async function runWanted(program_id: string, wanted: string[]) {
  const res = makeRes();
  await handler({ method: 'POST', body: {
    program_id,
    plan_context: { semesters: [{ id: 'year_3_semester_a', courses: [{ course_id: 'MAND' }] }],
      total_hours_progress: { known_completed_hours: 177 },
      personal_status: { completed: [], currently_taking: [], planned: [] } },
    preferences: { wanted_course_ids: wanted },
    session_token: randomUUID(),
  } } as any, res);
  return res;
}

// Slice 18A changes the SECOND half of this expectation, not the first. The
// hours-less course is still never placed (catalog integrity is untouched), but
// the wanted picker is now a HARD `must_include` constraint, so a request the
// planner cannot honor may no longer come back as a clean, applyable plan with
// the requested course quietly absent. It blocks, and says exactly why.
test('a WANTED course with no authoritative hours is never placed, and its absence is disclosed', async () => {
  const res = await runWanted('test_program_hours_integrity_2027', ['NOHOURS']);
  expect(res.statusCode).toBe(200);
  expect(placedIds(res._body)).not.toContain('NOHOURS'); // no hours-less card, even though wanted
  expect(res._body.blocked).toBe(true);                  // never a silent drop of a hard request
  expect(res._body.errors.some((e: string) => e.includes('קורס שביקשת במפורש לא שובץ בתוכנית'))).toBe(true);
  // every placed course carries an authoritative (non-partial) semester total
  for (const s of res._body.semesters) {
    for (const id of s.course_ids) expect(id).not.toBe('NOHOURS');
  }
});

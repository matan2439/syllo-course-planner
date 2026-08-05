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

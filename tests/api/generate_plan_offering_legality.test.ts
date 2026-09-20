/**
 * A user PREFERENCE must never override authoritative offering availability.
 *
 * 0542-4220 תורת התנודות is authoritatively B-only. Even when the user explicitly
 * wants it, the native planner must place it in a Semester-B slot — never Semester A.
 * This exercises the real handler on the real ME-2027 board.
 */
import handler from '../../api/ai/generate-plan';
import { randomUUID } from 'crypto';
import { readFileSync } from 'fs';
import { join } from 'path';

const BOARD = JSON.parse(
  readFileSync(join(__dirname, '..', '..', 'data', 'boards', 'mechanical_engineering_2027.json'), 'utf8'),
);
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
beforeEach(() => { process.env.AI_DEV_MODE = 'true'; process.env.AI_DEV_BYPASS_QUOTA = 'true'; });
afterEach(() => { delete process.env.AI_DEV_MODE; delete process.env.AI_DEV_BYPASS_QUOTA; });

test('preference for a B-only course (0542-4220) never places it in Semester A', async () => {
  const planContext = {
    semesters: BOARD.semesters.map((s: any) => ({
      id: s.semester_id, courses: (s.courses || []).map((c: any) => ({ course_id: c.course_id })),
    })),
    personal_status: { completed: [], currently_taking: [], planned: [] },
    total_hours_progress: { known_completed_hours: 90 },
  };
  const res = await run({
    program_id: 'mechanical_engineering_2027',
    plan_context: planContext,
    preferences: { wanted_course_ids: ['0542-4220'] },
    session_token: randomUUID(),
  });
  expect(res.statusCode).toBe(200);
  const semOf = (res._body.semesters as any[])
    .filter((s) => s.course_ids.includes('0542-4220'))
    .map((s) => s.semester_id);
  // If placed at all, it must be a Semester-B slot — authoritative availability wins.
  for (const sem of semOf) expect(sem.endsWith('_semester_a')).toBe(false);
}, 60000);

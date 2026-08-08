/**
 * Preview Supabase 503 policy lock. When the quota-check DB is unreachable (e.g. the
 * free-tier Supabase project is auto-paused), generate-plan must FAIL CLOSED with a
 * classified 503 DB_ERROR at phase quota_check — it must NOT silently bypass the quota/
 * authorization policy and generate a plan. This is the exact behavior behind the
 * preview 503; the fix is owner-side (keep the DB reachable / upgrade off free tier),
 * never a code bypass.
 */
import handler from '../../api/ai/generate-plan';
import { randomUUID } from 'crypto';
import { readFileSync } from 'fs';
import { join } from 'path';

const BOARD = JSON.parse(readFileSync(join(__dirname, '..', '..', 'data', 'boards', 'mechanical_engineering_2027.json'), 'utf8'));
function planContext() {
  return { semesters: BOARD.semesters.map((s: any) => ({ id: s.semester_id, courses: [] })), personal_status: { completed: [], currently_taking: [], planned: [] }, total_hours_progress: { known_completed_hours: 90 } };
}
const makeRes = () => ({ statusCode: 0, setHeader: jest.fn().mockReturnThis(), status: jest.fn(function (this: any, c: number) { this.statusCode = c; return this; }), json: jest.fn(function (this: any, b: any) { this._body = b; return this; }), write: jest.fn(), end: jest.fn() } as any);
async function run() {
  const res = makeRes();
  await handler({ method: 'POST', body: { program_id: 'mechanical_engineering_2027', session_token: randomUUID(), plan_context: planContext(), preferences: {} } } as any, res);
  return res;
}

let saved: Record<string, string | undefined>;
beforeEach(() => {
  saved = { dev: process.env.AI_DEV_MODE, bypass: process.env.AI_DEV_BYPASS_QUOTA, test: process.env.AI_TEST_MODE, db: process.env.DATABASE_URL };
  // Quota ENFORCED (no dev bypass); DB points at an unreachable host (paused-project proxy).
  delete process.env.AI_DEV_MODE; delete process.env.AI_DEV_BYPASS_QUOTA;
  process.env.DATABASE_URL = 'postgresql://u:p@db.nonexistent-xyz-syllo.invalid:5432/postgres';
});
afterEach(() => {
  for (const [k, envk] of [['dev', 'AI_DEV_MODE'], ['bypass', 'AI_DEV_BYPASS_QUOTA'], ['test', 'AI_TEST_MODE'], ['db', 'DATABASE_URL']] as const) {
    if (saved[k] === undefined) delete process.env[envk]; else process.env[envk] = saved[k]!;
  }
});

test('DB-unreachable quota check → 503 DB_ERROR at quota_check, no plan generated (fail-closed)', async () => {
  const res = await run();
  expect(res.statusCode).toBe(503);
  expect(res._body.code).toBe('DB_ERROR');
  expect(res._body.details).toMatchObject({ phase: 'quota_check' });
  expect(res._body.semesters).toBeUndefined(); // never generated a plan
}, 30000);

test('AI_TEST_MODE does not rescue a DB-down quota check (no silent bypass of the policy)', async () => {
  process.env.AI_TEST_MODE = 'true';
  const res = await run();
  expect(res.statusCode).toBe(503);
  expect(res._body.code).toBe('DB_ERROR');
}, 30000);

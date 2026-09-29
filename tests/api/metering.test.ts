/**
 * The AI metering gate: free quota first (unchanged), then Syllo Credits for
 * signed-in users; reserve → deliver | release.
 */
import { applyCreditTransaction, getCreditBalance } from '../../api/ai/credits';
import { openMeteredOperation } from '../../api/ai/metering';
import { createBillingDb, type BillingDb } from './helpers/billing_db';

let db: BillingDb;
beforeAll(async () => {
  db = await createBillingDb(['billing/001_credits.sql', 'billing/002_credit_lots.sql']);
}, 60_000);
afterAll(async () => { await db?.pg.close(); });

const req = { headers: {} };
const res = { setHeader: () => {}, getHeader: () => undefined };
const open = (userId: string | null, freeQuotaAllowed: boolean) =>
  openMeteredOperation(req, res as never, { endpoint: 'conversation', model: 'gpt-test', freeQuotaAllowed }, {
    sql: () => db.sql, verifyUser: async () => userId,
  });

test('anonymous visitors keep the old quota-only behaviour', async () => {
  expect((await open(null, true))?.funding).toBe('anonymous');
  expect(await open(null, false)).toBeNull();
});

test('free quota left: nothing is charged, the operation is still recorded', async () => {
  const user = await db.newUser();
  await applyCreditTransaction(db.sql, { userId: user, delta: 5, kind: 'purchase', reference: 'm_free' });
  const op = await open(user, true);
  expect(op?.funding).toBe('free_quota');
  await op!.deliver({ input_tokens: 12, output_tokens: 3 });
  expect(await getCreditBalance(db.sql, user)).toBe(5);
  expect(await db.one('SELECT funding, state, input_tokens FROM ai_operations WHERE user_id = $1', [user]))
    .toEqual({ funding: 'free_quota', state: 'delivered', input_tokens: 12 });
});

test('quota exhausted: one credit per delivered operation, none for a released one', async () => {
  const user = await db.newUser();
  await applyCreditTransaction(db.sql, { userId: user, delta: 2, kind: 'purchase', reference: 'm_paid' });
  const delivered = await open(user, false);
  expect(delivered?.funding).toBe('credits');
  await delivered!.deliver({ input_tokens: 100, output_tokens: 40, cached_tokens: 10 });
  await delivered!.deliver(); // idempotent
  const failed = await open(user, false);
  await failed!.release();
  await failed!.deliver(); // no effect after release
  expect(await getCreditBalance(db.sql, user)).toBe(1);
  const ops = await db.rows<any>('SELECT funding, credits, state, model, output_tokens FROM ai_operations WHERE user_id = $1 ORDER BY reserved_at', [user]);
  expect(ops.map((o) => o.state).sort()).toEqual(['delivered', 'released']);
  expect(ops.find((o) => o.state === 'delivered')).toMatchObject({ credits: 1, model: 'gpt-test', output_tokens: 40 });
});

test('quota exhausted and no credits: refused (caller answers 429)', async () => {
  const user = await db.newUser();
  expect(await open(user, false)).toBeNull();
});

test('billing-exempt developers are admitted without spending', async () => {
  const dev = await db.newUser();
  await db.pg.query('UPDATE profiles SET billing_exempt = true WHERE id = $1', [dev]);
  const op = await open(dev, false);
  expect(op?.funding).toBe('exempt');
  await op!.deliver();
  expect(await getCreditBalance(db.sql, dev)).toBe(0);
});

test('billing tables unavailable: exactly the pre-credits behaviour', async () => {
  const broken = { unsafe: async () => { throw new Error('relation does not exist'); } };
  const call = (allowed: boolean) => openMeteredOperation(req, res as never,
    { endpoint: 'conversation', model: 'm', freeQuotaAllowed: allowed },
    { sql: () => broken, verifyUser: async () => '00000000-0000-4000-8000-000000000000' });
  jest.spyOn(console, 'error').mockImplementation(() => {});
  expect((await call(true))?.funding).toBe('anonymous');
  expect(await call(false)).toBeNull();
});

/**
 * AI metering (api/ai/metering.ts): sign-in required, 1 purchased credit per
 * delivered reply, no free quota, fail closed — against real Postgres (PGlite).
 */
import { applyCreditTransaction, getCreditBalance } from '../../api/ai/credits';
import { METERING_VERSION, openMeteredOperation, sendMeterRefusal, type MeteredOperation } from '../../api/ai/metering';
import { ALL_BILLING, createBillingDb, type BillingDb } from './helpers/billing_db';

let db: BillingDb;
beforeAll(async () => {
  db = await createBillingDb(ALL_BILLING);
}, 60_000);
afterAll(async () => { await db?.pg.close(); });

const req = { headers: {} };
const res = { setHeader: () => {}, getHeader: () => undefined };
const open = (userId: string | null) =>
  openMeteredOperation(req, res as never, { endpoint: 'conversation', model: 'gpt-test' }, {
    sql: () => db.sql, verifyUser: async () => userId, deployed: () => true,
  });
const admitted = async (userId: string | null): Promise<MeteredOperation> => {
  const op = await open(userId);
  if ('refused' in op) throw new Error(`refused: ${op.refused}`);
  return op;
};

test('anonymous callers are refused: sign-in is required for paid AI', async () => {
  expect(await open(null)).toEqual({ refused: 'auth_required' });
});

test('a signed-in customer with no purchased credits is refused (no free quota)', async () => {
  const user = await db.newUser();
  expect(await open(user)).toEqual({ refused: 'insufficient' });
  expect(await db.rows('SELECT 1 FROM ai_operations WHERE user_id = $1', [user])).toEqual([]);
});

test('one credit per delivered reply; a released reply costs nothing', async () => {
  const user = await db.newUser();
  await applyCreditTransaction(db.sql, { userId: user, delta: 2, kind: 'purchase', reference: 'm_paid' });
  const delivered = await admitted(user);
  expect(delivered.funding).toBe('credits');
  await delivered.deliver({ input_tokens: 100, output_tokens: 40, cached_tokens: 10 });
  await delivered.deliver(); // idempotent
  const failed = await admitted(user);
  await failed.release('no_reply');
  await failed.deliver(); // no effect after release
  expect(await getCreditBalance(db.sql, user)).toBe(1);
  const ops = await db.rows<any>(
    'SELECT funding, credits, state, model, provider, output_tokens, cached_tokens, pricing_version, release_reason FROM ai_operations WHERE user_id = $1 ORDER BY reserved_at',
    [user]);
  expect(ops.find((o) => o.state === 'delivered')).toMatchObject({
    funding: 'credits', credits: 1, model: 'gpt-test', provider: 'openai', output_tokens: 40, cached_tokens: 10,
    pricing_version: METERING_VERSION, release_reason: null,
  });
  expect(ops.find((o) => o.state === 'released')).toMatchObject({ release_reason: 'no_reply', pricing_version: METERING_VERSION });
});

test('delivery links the operation to the purchased lot it consumed', async () => {
  const user = await db.newUser();
  await applyCreditTransaction(db.sql, { userId: user, delta: 1, kind: 'purchase', reference: 'm_link' });
  const op = await admitted(user);
  await op.deliver({ input_tokens: 5, output_tokens: 5 });
  const [link] = await db.rows<any>(
    `SELECT l.source_class, ol.amount FROM ai_operation_lots ol JOIN ai_operations o USING (operation_id)
       JOIN credit_lots l ON l.id = ol.lot_id WHERE o.user_id = $1`, [user]);
  expect(link).toEqual({ source_class: 'purchased', amount: 1 });
});

test("a customer's internal (dev) credits never fund AI", async () => {
  const user = await db.newUser();
  await applyCreditTransaction(db.sql, { userId: user, delta: 20, kind: 'admin_adjustment', reference: 'm_internal' });
  expect(await open(user)).toEqual({ refused: 'insufficient' });
});

test('billing-exempt developers are admitted without spending', async () => {
  const dev = await db.newUser();
  await db.pg.query('UPDATE profiles SET billing_exempt = true WHERE id = $1', [dev]);
  const op = await admitted(dev);
  expect(op.funding).toBe('exempt');
  await op.deliver();
  expect(await getCreditBalance(db.sql, dev)).toBe(0);
});

test('billing failures fail closed when deployed; local dev without a DB is unmetered', async () => {
  jest.spyOn(console, 'error').mockImplementation(() => {});
  const broken = { unsafe: async () => { throw new Error('relation does not exist'); } };
  const user = '00000000-0000-4000-8000-000000000000';
  expect(await openMeteredOperation(req, res as never, { endpoint: 'c', model: 'm' },
    { sql: () => broken, verifyUser: async () => user, deployed: () => true })).toEqual({ refused: 'unavailable' });
  expect(await openMeteredOperation(req, res as never, { endpoint: 'c', model: 'm' },
    { sql: () => null, verifyUser: async () => user, deployed: () => true })).toEqual({ refused: 'unavailable' });
  const local = await openMeteredOperation(req, res as never, { endpoint: 'c', model: 'm' },
    { sql: () => null, verifyUser: async () => null, deployed: () => false });
  expect('refused' in local ? local : local.funding).toBe('unmetered_dev');
});

test('refusals map to 401 / 402 / 503 with a Hebrew message', () => {
  const sent: Array<[number, any]> = [];
  const fake = { status: (code: number) => ({ json: (body: unknown) => sent.push([code, body]) }) };
  sendMeterRefusal(fake, 'auth_required');
  sendMeterRefusal(fake, 'insufficient');
  sendMeterRefusal(fake, 'unavailable');
  expect(sent.map(([code, body]) => [code, body.code, body.ok])).toEqual([
    [401, 'AUTH_REQUIRED', false], [402, 'INSUFFICIENT_CREDITS', false], [503, 'BILLING_UNAVAILABLE', false],
  ]);
  expect(sent.every(([, body]) => typeof body.message_he === 'string' && body.message_he.length > 0)).toBe(true);
});

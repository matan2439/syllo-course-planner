/**
 * Customer refund request: POST /api/billing/refund-request opens ONE admin case
 * per payment (billing_alerts, severity 'review', code 'refund_request'). It never
 * touches Paddle, the ledger or the payment — staff refund in Paddle.
 */
import { createBillingHandler } from '../../api/billing';
import { signPaddleBody, type PaddleApi, type PaddleConfig } from '../../api/billing/paddle';
import { LEGAL_VERSIONS } from '../../shared/billing/legal_versions';
import { ALL_BILLING, createBillingDb, type BillingDb } from './helpers/billing_db';

const SECRET = 'pdl_ntfset_refund_req';
const PRICE = 'pri_sandboxsmall0001';
const ENV = { PADDLE_PRICE_CREDITS_SMALL: PRICE } as NodeJS.ProcessEnv;
const CONFIG: PaddleConfig = { environment: 'sandbox', apiKey: 'pdl_sdbx_apikey_rr', webhookSecret: SECRET, apiBase: 'http://paddle.invalid' };

let db: BillingDb;
let currentUser: string | null = null;
let n = 0;
const paddleCalls: string[] = [];
const api: PaddleApi = {
  createTransaction: async () => { paddleCalls.push('createTransaction'); return { id: `txn_rr${String(++n).padStart(6, '0')}`, status: 'ready' }; },
  getTransaction: async () => { paddleCalls.push('getTransaction'); throw new Error('unexpected'); },
  listAdjustments: async () => { paddleCalls.push('listAdjustments'); return []; },
};
const handler = createBillingHandler({ sql: () => db.sql, verifyUser: async () => currentUser, config: () => CONFIG, api: () => api, env: ENV });

async function call(route: string, init: { method?: string; body?: unknown; headers?: Record<string, string>; raw?: string } = {}) {
  const res: any = { statusCode: 200, headersSent: false, setHeader() {} };
  res.status = (c: number) => { res.statusCode = c; return res; };
  res.json = (b: unknown) => { res.body = b; res.headersSent = true; return res; };
  await handler({ method: init.method ?? 'GET', url: `/api/billing/${route}`, query: { route },
    headers: { 'content-type': 'application/json', ...(init.headers ?? {}) }, body: init.body, rawBody: init.raw } as any, res);
  return res;
}
const as = async <T>(userId: string | null, fn: () => Promise<T>) => { currentUser = userId; try { return await fn(); } finally { currentUser = null; } };
const request = (userId: string | null, body: unknown) => as(userId, () => call('refund-request', { method: 'POST', body }));

async function purchased(userId: string) {
  const c = await as(userId, () => call('checkout', { method: 'POST', body: { package_id: 'credits_small', disclosure_version: LEGAL_VERSIONS.purchaseDisclosure, accepted: true } }));
  const txn = c.body.transaction_id as string;
  const paymentId = c.body.payment_id as string;
  const raw = JSON.stringify({ event_id: `evt_rr_${++n}`, event_type: 'transaction.completed', occurred_at: new Date().toISOString(),
    data: { id: txn, status: 'completed', customer_id: 'ctm_rr', custom_data: { syllo_user_id: userId, syllo_payment_id: paymentId },
      items: [{ price: { id: PRICE }, quantity: 1 }], details: { totals: { grand_total: '500', currency_code: 'USD' } } } });
  await call('webhook', { method: 'POST', raw, headers: { 'paddle-signature': signPaddleBody(raw, SECRET) } });
  return paymentId;
}
const cases = (paymentId: string) => db.rows<any>("SELECT * FROM billing_alerts WHERE code = 'refund_request' AND payment_id = $1", [paymentId]);

beforeAll(async () => { db = await createBillingDb(ALL_BILLING); }, 60_000);

test('opens one review case for MY completed payment; never refunds, never touches credits', async () => {
  const user = await db.newUser();
  const paymentId = await purchased(user);
  const before = await db.one<any>('SELECT status, refunded_amount, lot_id FROM payments WHERE id = $1', [paymentId]);
  const balance = await db.one<any>('SELECT balance FROM credit_accounts WHERE user_id = $1', [user]);
  paddleCalls.length = 0;

  const res = await request(user, { payment_id: paymentId, reason: '  לא השתמשתי בקרדיטים  ' });
  expect(res.statusCode).toBe(200);
  expect(res.body).toMatchObject({ ok: true, case_status: 'open' });

  const [c] = await cases(paymentId);
  expect(c).toMatchObject({ severity: 'review', code: 'refund_request', status: 'open', case_status: 'open', user_id: user,
    dedupe_key: `refund_request:${paymentId}`, reason: 'לא השתמשתי בקרדיטים', customer_email: `${user}@test` });
  expect(c.details).toMatchObject({ source: 'customer', request_count: 1, credits_at_request: { consumed: 0, unused: 50 } });
  expect(c.notes).toEqual([expect.objectContaining({ by: 'customer', text: 'לא השתמשתי בקרדיטים' })]);

  expect(paddleCalls).toEqual([]); // no Paddle call at all
  expect(await db.one('SELECT status, refunded_amount, lot_id FROM payments WHERE id = $1', [paymentId])).toEqual(before);
  expect(await db.one('SELECT balance FROM credit_accounts WHERE user_id = $1', [user])).toEqual(balance);

  // Visible to the customer on /me and to staff in the admin queue.
  const me = await as(user, () => call('me'));
  expect(me.body.purchases[0]).toMatchObject({ payment_id: paymentId, refund_request: { case_status: 'open' } });
  const admin = await db.newUser();
  await db.pg.query("UPDATE profiles SET role = 'developer' WHERE id = $1", [admin]);
  const queue = await as(admin, () => call('admin/alerts'));
  expect(queue.body.alerts.map((a: any) => a.code)).toContain('refund_request');
});

test('repeat requests update the same case, re-open a resolved one, and are capped', async () => {
  const user = await db.newUser();
  const paymentId = await purchased(user);
  expect((await request(user, { payment_id: paymentId, reason: 'first' })).statusCode).toBe(200);
  await db.pg.query("UPDATE billing_alerts SET status = 'resolved', case_status = 'resolved', resolution_note = 'declined', resolved_at = now() WHERE dedupe_key = $1", [`refund_request:${paymentId}`]);

  const again = await request(user, { payment_id: paymentId, reason: 'second' });
  expect(again.statusCode).toBe(200);
  const [c] = await cases(paymentId);
  expect(c).toMatchObject({ status: 'open', case_status: 'open', reason: 'second', resolution_note: null });
  expect(c.details.request_count).toBe(2);
  expect(c.notes.map((x: any) => x.text)).toEqual(['first', 'resolved: declined', 'second']);

  for (let i = 3; i <= 5; i++) expect((await request(user, { payment_id: paymentId, reason: `again ${i}` })).statusCode).toBe(200);
  const capped = await request(user, { payment_id: paymentId, reason: 'again 6' });
  expect(capped.statusCode).toBe(429);
  expect(await cases(paymentId)).toHaveLength(1);
});

test('only my own completed payment, a real reason, JSON, signed in', async () => {
  const owner = await db.newUser();
  const other = await db.newUser();
  const paymentId = await purchased(owner);

  expect((await request(null, { payment_id: paymentId, reason: 'x x x' })).statusCode).toBe(401);
  expect((await request(other, { payment_id: paymentId, reason: 'not mine' })).body.code).toBe('NOT_FOUND');
  expect((await request(owner, { payment_id: '999999', reason: 'missing' })).statusCode).toBe(404);
  expect((await request(owner, { payment_id: 'abc', reason: 'bad id' })).body.code).toBe('INVALID_PAYMENT');
  expect((await request(owner, { payment_id: paymentId, reason: ' a ' })).body.code).toBe('REASON_REQUIRED');
  expect((await request(owner, { payment_id: paymentId, reason: 'x'.repeat(2001) })).body.code).toBe('REASON_REQUIRED');
  const form = await as(owner, () => call('refund-request', { method: 'POST', body: {}, headers: { 'content-type': 'text/plain' } }));
  expect(form.statusCode).toBe(415);
  expect((await as(owner, () => call('refund-request'))).statusCode).toBe(404); // GET

  // An unfinished checkout is not refundable.
  const pending = await as(owner, () => call('checkout', { method: 'POST', body: { package_id: 'credits_small', disclosure_version: LEGAL_VERSIONS.purchaseDisclosure, accepted: true } }));
  expect((await request(owner, { payment_id: pending.body.payment_id, reason: 'pending' })).statusCode).toBe(404);

  await db.pg.query("UPDATE payments SET refunded_amount = amount_total WHERE id = $1", [paymentId]);
  expect((await request(owner, { payment_id: paymentId, reason: 'again' })).body.code).toBe('ALREADY_REFUNDED');
  expect(await cases(paymentId)).toHaveLength(0);
});

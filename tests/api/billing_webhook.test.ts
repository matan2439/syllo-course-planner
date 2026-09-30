/**
 * Paddle purchase → credits, refunds, chargebacks, idempotency, ordering and
 * authorization — end to end through the real HTTP handler and real Postgres
 * (PGlite), with signed fixture webhooks. No Paddle credentials involved.
 */
import { createBillingHandler } from '../../api/billing';
import { finalizeCredits, getCreditBalance, lotSummary, releaseCredits, reserveCredits, applyCreditTransaction } from '../../api/ai/credits';
import { signPaddleBody, type PaddleConfig } from '../../api/billing/paddle';
import { processPaddleEvent } from '../../api/billing/process_event';
import { LEGAL_VERSIONS } from '../../shared/billing/legal_versions';
import { ALL_BILLING, createBillingDb, type BillingDb } from './helpers/billing_db';

const SECRET = 'pdl_ntfset_test_secret';
const PRICE_SMALL = 'pri_sandboxsmall0001';
const PRICE_MEDIUM = 'pri_sandboxmedium001';
const ENV = { PADDLE_PRICE_CREDITS_SMALL: PRICE_SMALL, PADDLE_PRICE_CREDITS_MEDIUM: PRICE_MEDIUM } as NodeJS.ProcessEnv;
const CONFIG: PaddleConfig = { environment: 'sandbox', apiKey: 'pdl_sdbx_apikey_test', webhookSecret: SECRET, apiBase: 'http://paddle.invalid' };

let db: BillingDb;
let txnCounter = 0;
let currentUser: string | null = null;
const createTransaction = jest.fn(async () => ({ id: `txn_test${String(++txnCounter).padStart(6, '0')}`, status: 'ready' }));

const handler = (overrides: Partial<Parameters<typeof createBillingHandler>[0]> = {}) => createBillingHandler({
  sql: () => db.sql,
  verifyUser: async () => currentUser,
  config: () => CONFIG,
  api: () => ({ createTransaction, getTransaction: jest.fn(), listAdjustments: jest.fn() }),
  env: ENV,
  ...overrides,
});

function response() {
  const res: any = { statusCode: 200, headers: {}, body: undefined, headersSent: false };
  res.setHeader = (k: string, v: unknown) => { res.headers[k] = v; };
  res.status = (c: number) => { res.statusCode = c; return res; };
  res.json = (b: unknown) => { res.body = b; res.headersSent = true; return res; };
  return res;
}

async function call(route: string, init: { method?: string; body?: unknown; raw?: string; headers?: Record<string, string>; query?: Record<string, string> } = {}, h = handler()) {
  const res = response();
  await h({
    method: init.method ?? 'GET', url: `/api/billing/${route}`, query: { route, ...(init.query ?? {}) },
    headers: { 'content-type': 'application/json', ...(init.headers ?? {}) }, body: init.body, rawBody: init.raw,
  } as any, res);
  return res;
}

/** POST a Paddle event exactly as Paddle would (signed raw body). */
async function deliver(event: object, h = handler()) {
  const raw = JSON.stringify(event);
  return call('webhook', { method: 'POST', raw, headers: { 'paddle-signature': signPaddleBody(raw, SECRET) } }, h);
}

let evt = 0;
const nextEvt = () => `evt_${String(++evt).padStart(8, '0')}`;

function txnEvent(o: { txn: string; userId: string; paymentId: string; status?: string; type?: string; price?: string; amount?: string; eventId?: string; at?: string; customData?: object }) {
  return {
    event_id: o.eventId ?? nextEvt(), event_type: o.type ?? 'transaction.completed', occurred_at: o.at ?? new Date().toISOString(),
    notification_id: 'ntf_x',
    data: {
      id: o.txn, status: o.status ?? 'completed', customer_id: 'ctm_test1', currency_code: 'ILS',
      custom_data: o.customData ?? { syllo_user_id: o.userId, syllo_payment_id: o.paymentId },
      items: [{ price: { id: o.price ?? PRICE_SMALL }, quantity: 1 }],
      details: { totals: { grand_total: o.amount ?? '5000', total: o.amount ?? '5000', currency_code: 'ILS' } },
      payments: [{ method_details: { card: { last4: '4242', cardholder_name: 'Test Buyer' } } }],
    },
  };
}

function adjEvent(o: { txn: string; adj: string; action?: string; type?: string; status?: string; amount?: string; eventId?: string; at?: string; eventType?: string }) {
  return {
    event_id: o.eventId ?? nextEvt(), event_type: o.eventType ?? 'adjustment.created', occurred_at: o.at ?? new Date().toISOString(),
    data: {
      id: o.adj, action: o.action ?? 'refund', type: o.type ?? 'full', status: o.status ?? 'approved', transaction_id: o.txn,
      currency_code: 'ILS', totals: { total: o.amount ?? '5000', currency_code: 'ILS' },
    },
  };
}

/** A signed-in user opens a checkout (server creates the Paddle transaction). */
async function checkout(userId: string, packageId = 'credits_small') {
  currentUser = userId;
  const res = await call('checkout', { method: 'POST', body: { package_id: packageId, disclosure_version: LEGAL_VERSIONS.purchaseDisclosure, accepted: true } });
  currentUser = null;
  expect(res.statusCode).toBe(200);
  return { txn: res.body.transaction_id as string, paymentId: res.body.payment_id as string };
}

async function purchase(userId: string, packageId = 'credits_small', amount = '5000') {
  const c = await checkout(userId, packageId);
  const res = await deliver(txnEvent({ ...c, userId, price: packageId === 'credits_small' ? PRICE_SMALL : PRICE_MEDIUM, amount }));
  expect(res.body).toEqual({ ok: true, status: 'processed' });
  return c;
}

async function spend(userId: string, credits: number, op = `op_${Math.random()}`) {
  expect((await reserveCredits(db.sql, { userId, operationId: op, credits, endpoint: 'conversation' })).status).toBe('applied');
  await finalizeCredits(db.sql, op, { input_tokens: 1000, output_tokens: 200 });
}

const payment = (id: string) => db.one<any>('SELECT * FROM payments WHERE id = $1', [id]);
const lotOf = async (paymentId: string) => {
  const p = await payment(paymentId);
  return (await lotSummary(db.sql, p.user_id)).find((l) => l.lotId === String(p.lot_id))!;
};
const openAlerts = (code: string) => db.rows<any>("SELECT * FROM billing_alerts WHERE code = $1 AND status = 'open'", [code]);

beforeAll(async () => {
  db = await createBillingDb(ALL_BILLING);
}, 60_000);
afterAll(async () => { await db?.pg.close(); });
beforeEach(() => { jest.spyOn(console, 'error').mockImplementation(() => {}); jest.spyOn(console, 'warn').mockImplementation(() => {}); });
afterEach(() => jest.restoreAllMocks());

async function expectHealthy() {
  expect(await db.rows('SELECT * FROM credit_lot_drift')).toEqual([]);
  expect(await db.rows('SELECT * FROM credit_account_lot_drift')).toEqual([]);
  expect(await db.rows('SELECT * FROM credit_balance_drift')).toEqual([]);
}

describe('purchase', () => {
  test('completed purchase grants the package credits immediately, once, linked end to end', async () => {
    const user = await db.newUser();
    const { txn, paymentId } = await purchase(user);
    expect(await getCreditBalance(db.sql, user)).toBe(50);
    const p = await payment(paymentId);
    expect(p).toMatchObject({ status: 'completed', environment: 'sandbox', paddle_transaction_id: txn, amount_total: 5000, currency: 'ILS', paddle_customer_id: 'ctm_test1' });
    expect(p.terms).toMatchObject({ purchase_disclosure: LEGAL_VERSIONS.purchaseDisclosure, refund_policy: LEGAL_VERSIONS.refundPolicy, accepted_at: expect.any(String) });
    expect(await lotOf(paymentId)).toMatchObject({ sourceClass: 'purchased', granted: 50, unused: 50, paymentId });
    // Credits are usable right away — no waiting period.
    await spend(user, 50);
    expect(await getCreditBalance(db.sql, user)).toBe(0);
    // Card data never reaches storage.
    const stored = JSON.stringify(await db.rows('SELECT payload FROM paddle_events WHERE transaction_id = $1', [txn]));
    expect(stored).not.toMatch(/4242|cardholder|Test Buyer/);
    await expectHealthy();
  });

  test('checkout: the server decides package and credits; the browser cannot', async () => {
    const user = await db.newUser();
    currentUser = user;
    const forged = await call('checkout', { method: 'POST', body: { package_id: 'credits_small', credits: 100000, price_id: 'pri_cheap', user_id: 'someone', disclosure_version: LEGAL_VERSIONS.purchaseDisclosure, accepted: true } });
    expect(forged.statusCode).toBe(200);
    expect(await db.one('SELECT user_id, credits_purchased, paddle_price_id FROM payments WHERE id = $1', [forged.body.payment_id]))
      .toEqual({ user_id: user, credits_purchased: 50, paddle_price_id: PRICE_SMALL });
    expect(createTransaction).toHaveBeenLastCalledWith({ priceId: PRICE_SMALL, customData: { syllo_user_id: user, syllo_payment_id: forged.body.payment_id } });
    expect((await call('checkout', { method: 'POST', body: { package_id: 'credits_mega', disclosure_version: LEGAL_VERSIONS.purchaseDisclosure, accepted: true } })).body.code).toBe('UNKNOWN_PACKAGE');
    expect((await call('checkout', { method: 'POST', body: { package_id: 'credits_small' } })).body.code).toBe('DISCLOSURE_REQUIRED');
    currentUser = null;
    expect((await call('checkout', { method: 'POST', body: { package_id: 'credits_small', disclosure_version: LEGAL_VERSIONS.purchaseDisclosure, accepted: true } })).statusCode).toBe(401);
  });

  test('failed payment grants nothing; a later completion of the same checkout grants once', async () => {
    const user = await db.newUser();
    const c = await checkout(user);
    await deliver(txnEvent({ ...c, userId: user, type: 'transaction.payment_failed', status: 'ready' }));
    expect((await payment(c.paymentId)).status).toBe('failed');
    expect(await getCreditBalance(db.sql, user)).toBe(0);
    await deliver(txnEvent({ ...c, userId: user }));
    // A late failure/cancel after completion never regresses it.
    await deliver(txnEvent({ ...c, userId: user, type: 'transaction.payment_failed', status: 'ready' }));
    await deliver(txnEvent({ ...c, userId: user, type: 'transaction.canceled', status: 'canceled' }));
    expect((await payment(c.paymentId)).status).toBe('completed');
    expect(await getCreditBalance(db.sql, user)).toBe(50);
  });

  test('unknown or mismatched price: no grant, critical alert', async () => {
    const user = await db.newUser();
    const c = await checkout(user);
    expect((await deliver(txnEvent({ ...c, userId: user, price: 'pri_notinthecatalog1' }))).body.status).toBe('manual_review');
    const c2 = await checkout(user);
    // A real catalog price, but not the package chosen at checkout.
    expect((await deliver(txnEvent({ ...c2, userId: user, price: PRICE_MEDIUM }))).body.status).toBe('manual_review');
    expect(await getCreditBalance(db.sql, user)).toBe(0);
    expect((await openAlerts('unknown_price')).length).toBeGreaterThanOrEqual(2);
  });

  test('manipulated user mapping: credits never go to another account', async () => {
    const victim = await db.newUser();
    const attacker = await db.newUser();
    const c = await checkout(victim);
    const r = await deliver(txnEvent({ ...c, userId: victim, customData: { syllo_user_id: attacker, syllo_payment_id: c.paymentId } }));
    expect(r.body.status).toBe('manual_review');
    expect(await getCreditBalance(db.sql, attacker)).toBe(0);
    expect(await getCreditBalance(db.sql, victim)).toBe(0);
    expect(await openAlerts('user_mapping_failed')).toEqual(expect.arrayContaining([expect.objectContaining({ severity: 'critical' })]));
  });

  test('wrong environment: a production checkout is never granted by a sandbox deployment', async () => {
    const user = await db.newUser();
    const c = await checkout(user);
    await db.pg.query("UPDATE payments SET environment = 'production' WHERE id = $1", [c.paymentId]);
    expect((await deliver(txnEvent({ ...c, userId: user }))).body.status).toBe('manual_review');
    expect(await getCreditBalance(db.sql, user)).toBe(0);
  });

  test('invalid signature: rejected before anything is stored', async () => {
    const user = await db.newUser();
    const c = await checkout(user);
    const raw = JSON.stringify(txnEvent({ ...c, userId: user, eventId: 'evt_forged_1' }));
    const bad = await call('webhook', { method: 'POST', raw, headers: { 'paddle-signature': signPaddleBody(raw, 'wrong-secret') } });
    expect(bad.statusCode).toBe(401);
    const tampered = await call('webhook', { method: 'POST', raw: raw.replace('5000', '1'), headers: { 'paddle-signature': signPaddleBody(raw, SECRET) } });
    expect(tampered.statusCode).toBe(401);
    expect(await db.rows("SELECT 1 FROM paddle_events WHERE event_id = 'evt_forged_1'")).toEqual([]);
    expect(await getCreditBalance(db.sql, user)).toBe(0);
  });
});

describe('idempotency and ordering', () => {
  test('duplicate event, duplicate transaction, and webhook + reconciliation race: exactly one grant', async () => {
    const user = await db.newUser();
    const c = await checkout(user);
    const event = txnEvent({ ...c, userId: user });
    await deliver(event);
    expect((await deliver(event)).body.status).toBe('duplicate');
    await deliver(txnEvent({ ...c, userId: user })); // same transaction, new event id
    const ctx = (source: 'webhook' | 'reconciliation') => ({ sql: db.sql, environment: 'sandbox' as const, source, env: ENV });
    await Promise.all([
      processPaddleEvent(ctx('webhook'), txnEvent({ ...c, userId: user })),
      processPaddleEvent(ctx('reconciliation'), txnEvent({ ...c, userId: user, eventId: `recon:${c.txn}` })),
    ]);
    expect(await getCreditBalance(db.sql, user)).toBe(50);
    expect(await db.rows("SELECT 1 FROM credit_transactions WHERE kind = 'purchase' AND user_id = $1", [user])).toHaveLength(1);
    await expectHealthy();
  });

  test('database failure: not acknowledged (500), recorded as failed, retried successfully', async () => {
    const user = await db.newUser();
    const c = await checkout(user);
    const event = txnEvent({ ...c, userId: user });
    const flaky = { ...db.sql, begin: async () => { throw new Error('connection reset'); } };
    const res = await deliver(event, handler({ sql: () => flaky }));
    expect(res.statusCode).toBe(500);
    expect(await db.one('SELECT processing_status, attempts FROM paddle_events WHERE event_id = $1', [event.event_id]))
      .toEqual({ processing_status: 'failed', attempts: 1 });
    expect((await deliver(event)).body.status).toBe('processed');
    expect(await getCreditBalance(db.sql, user)).toBe(50);
  });
});

describe('refunds', () => {
  test('fully unused package, full refund: all 50 revoked, lot closed, never granted again', async () => {
    const user = await db.newUser();
    const c = await purchase(user);
    await deliver(adjEvent({ txn: c.txn, adj: 'adj_unused1', status: 'pending_approval' }));
    // A refund REQUEST changes nothing.
    expect(await getCreditBalance(db.sql, user)).toBe(50);
    await deliver(adjEvent({ txn: c.txn, adj: 'adj_unused1', eventType: 'adjustment.updated' }));
    expect(await payment(c.paymentId)).toMatchObject({ status: 'refunded', refunded_amount: 5000, consumed_before_refund: false });
    expect(await lotOf(c.paymentId)).toMatchObject({ granted: 50, consumed: 0, revoked: 50, unused: 0, state: 'revoked' });
    expect(await getCreditBalance(db.sql, user)).toBe(0);
    // Replaying the purchase never re-grants.
    await deliver(txnEvent({ ...c, userId: user }));
    expect(await getCreditBalance(db.sql, user)).toBe(0);
    expect((await db.one<any>('SELECT payment_risk_state FROM profiles WHERE id = $1', [user])).payment_risk_state).toBe('normal');
    await expectHealthy();
  });

  test('partially consumed, full refund: unused revoked, consumed history kept, flagged for review', async () => {
    const user = await db.newUser();
    const c = await purchase(user, 'credits_medium', '15000'); // 150 credits
    await spend(user, 36);
    await deliver(adjEvent({ txn: c.txn, adj: 'adj_partialuse', amount: '15000' }));
    expect(await lotOf(c.paymentId)).toMatchObject({ granted: 150, consumed: 36, revoked: 114, unused: 0 });
    expect(await payment(c.paymentId)).toMatchObject({ status: 'refunded', consumed_before_refund: true });
    const usage = await db.rows<any>("SELECT delta FROM credit_transactions WHERE user_id = $1 AND kind = 'ai_usage'", [user]);
    expect(usage).toEqual([{ delta: -36 }]);
    expect(await openAlerts('refund_after_consumption')).toEqual(expect.arrayContaining([expect.objectContaining({ payment_id: Number(c.paymentId) })]));
    const decision = await db.one<any>("SELECT * FROM billing_policy_decisions WHERE adjustment_id = 'adj_partialuse'");
    expect(decision).toMatchObject({ decision: 'FULL_REFUND_ACCOUNTING', policy_version: expect.stringMatching(/^syllo-technical-/) });
    expect(decision.actions.analysis).toMatchObject({ label: 'analysis_only', consumption_ratio: 0.24, candidate_consumed_value: 3600, candidate_unused_value: 11400 });
    // One refund is not a verdict: the account is not flagged.
    expect((await db.one<any>('SELECT payment_risk_state FROM profiles WHERE id = $1', [user])).payment_risk_state).toBe('normal');
    await expectHealthy();
  });

  test('partial refund of the unused share: proportional revocation, remainder stays usable', async () => {
    const user = await db.newUser();
    const c = await purchase(user, 'credits_medium', '15000'); // 150 credits
    await spend(user, 30);
    await deliver(adjEvent({ txn: c.txn, adj: 'adj_prop1', type: 'partial', amount: '6000' })); // 40% → 60 credits
    expect(await lotOf(c.paymentId)).toMatchObject({ consumed: 30, revoked: 60, unused: 60, state: 'active' });
    expect(await payment(c.paymentId)).toMatchObject({ status: 'partially_refunded', refunded_amount: 6000, consumed_before_refund: false });
    await deliver(adjEvent({ txn: c.txn, adj: 'adj_prop2', type: 'partial', amount: '3000' })); // cumulative 60% → 90 total
    expect(await lotOf(c.paymentId)).toMatchObject({ revoked: 90, unused: 30 });
    await spend(user, 30);
    await expectHealthy();
  });

  test('fully consumed package refunded: financial refund recorded, zero credits, no debt, review', async () => {
    const user = await db.newUser();
    const c = await purchase(user);
    await spend(user, 50);
    await deliver(adjEvent({ txn: c.txn, adj: 'adj_allused' }));
    expect(await payment(c.paymentId)).toMatchObject({ status: 'refunded', refunded_amount: 5000, consumed_before_refund: true });
    expect(await lotOf(c.paymentId)).toMatchObject({ consumed: 50, revoked: 0, unused: 0 });
    expect(await getCreditBalance(db.sql, user)).toBe(0);
    const decision = await db.one<any>("SELECT result FROM billing_policy_decisions WHERE adjustment_id = 'adj_allused'");
    expect(decision.result).toMatchObject({ revoked_now: 0, unrevocable: 50 });
  });

  test('unrelated purchases and promotional credits are untouched', async () => {
    const user = await db.newUser();
    const a = await purchase(user);
    const b = await purchase(user);
    await applyCreditTransaction(db.sql, { userId: user, delta: 20, kind: 'promo_grant' });
    await spend(user, 30); // promo first (20), then purchase A (10)
    await deliver(adjEvent({ txn: a.txn, adj: 'adj_onlyA' }));
    expect(await lotOf(a.paymentId)).toMatchObject({ consumed: 10, revoked: 40 });
    expect(await lotOf(b.paymentId)).toMatchObject({ consumed: 0, revoked: 0, unused: 50 });
    expect(await getCreditBalance(db.sql, user)).toBe(50);
    await expectHealthy();
  });

  test('refund event replay and stale events never double-revoke or regress', async () => {
    const user = await db.newUser();
    const c = await purchase(user, 'credits_medium', '15000');
    const approved = adjEvent({ txn: c.txn, adj: 'adj_replay', type: 'partial', amount: '3000' });
    await deliver(approved);
    await deliver(approved);
    await deliver(adjEvent({ txn: c.txn, adj: 'adj_replay', type: 'partial', amount: '3000', eventType: 'adjustment.updated' }));
    // An older pending_approval arriving late is ignored.
    expect((await deliver(adjEvent({ txn: c.txn, adj: 'adj_replay', type: 'partial', status: 'pending_approval', amount: '3000' }))).body.status).toBe('ignored');
    expect(await lotOf(c.paymentId)).toMatchObject({ revoked: 30, unused: 120 });
  });

  test('refund arrives before the purchase event: deferred, then applied atomically with the grant', async () => {
    const user = await db.newUser();
    const c = await checkout(user);
    expect((await deliver(adjEvent({ txn: c.txn, adj: 'adj_early' }))).body.status).toBe('deferred');
    expect(await getCreditBalance(db.sql, user)).toBe(0);
    await deliver(txnEvent({ ...c, userId: user }));
    expect(await payment(c.paymentId)).toMatchObject({ status: 'refunded' });
    expect(await lotOf(c.paymentId)).toMatchObject({ granted: 50, revoked: 50, unused: 0 });
    expect(await getCreditBalance(db.sql, user)).toBe(0);
    await expectHealthy();
  });

  test('refund while credits are reserved by an in-flight AI call', async () => {
    const user = await db.newUser();
    const c = await purchase(user);
    await reserveCredits(db.sql, { userId: user, operationId: 'op_inflight_ok', credits: 1, endpoint: 'conversation' });
    await reserveCredits(db.sql, { userId: user, operationId: 'op_inflight_fail', credits: 1, endpoint: 'conversation' });
    await deliver(adjEvent({ txn: c.txn, adj: 'adj_inflight' }));
    expect(await getCreditBalance(db.sql, user)).toBe(2); // the two held credits
    await finalizeCredits(db.sql, 'op_inflight_ok'); // delivered → consumed
    await releaseCredits(db.sql, 'op_inflight_fail'); // not delivered → revoked
    expect(await lotOf(c.paymentId)).toMatchObject({ consumed: 1, revoked: 49, reserved: 0, unused: 0 });
    expect(await getCreditBalance(db.sql, user)).toBe(0);
    await expectHealthy();
  });
});

describe('disputes and abuse signals', () => {
  test('chargeback during a reservation: unused revoked, dispute recorded, critical alert, account review', async () => {
    const user = await db.newUser();
    const c = await purchase(user);
    await spend(user, 5);
    await reserveCredits(db.sql, { userId: user, operationId: 'op_cb', credits: 2, endpoint: 'conversation' });
    await deliver(adjEvent({ txn: c.txn, adj: 'adj_cb1', action: 'chargeback' }));
    expect(await payment(c.paymentId)).toMatchObject({ status: 'chargeback', dispute_state: 'chargeback' });
    expect(await lotOf(c.paymentId)).toMatchObject({ consumed: 5, revoked: 43, reserved: 2, state: 'revoked' });
    await releaseCredits(db.sql, 'op_cb');
    expect(await getCreditBalance(db.sql, user)).toBe(0);
    expect(await openAlerts('chargeback')).toEqual(expect.arrayContaining([expect.objectContaining({ severity: 'critical' })]));
    expect((await db.one<any>('SELECT payment_risk_state FROM profiles WHERE id = $1', [user])).payment_risk_state).toBe('review_required');
    await expectHealthy();
  });

  test('chargeback reversal is never guessed: manual review', async () => {
    const user = await db.newUser();
    const c = await purchase(user);
    await deliver(adjEvent({ txn: c.txn, adj: 'adj_cbr', action: 'chargeback_reverse' }));
    expect(await db.one<any>("SELECT accounting_state FROM payment_adjustments WHERE paddle_adjustment_id = 'adj_cbr'")).toEqual({ accounting_state: 'manual_review' });
    expect(await getCreditBalance(db.sql, user)).toBe(50);
  });

  test('repeated refund-after-consumption is recorded and flags the account for review (not restriction)', async () => {
    const user = await db.newUser();
    for (const adj of ['adj_abuse1', 'adj_abuse2']) {
      const c = await purchase(user);
      await spend(user, 45);
      await deliver(adjEvent({ txn: c.txn, adj }));
    }
    expect(await db.one<any>('SELECT refunded_purchase_count, refund_after_consumption_count, consumed_before_refund_credits FROM account_risk_indicators WHERE user_id = $1', [user]))
      .toEqual({ refunded_purchase_count: 2, refund_after_consumption_count: 2, consumed_before_refund_credits: 90 });
    expect((await db.one<any>('SELECT payment_risk_state FROM profiles WHERE id = $1', [user])).payment_risk_state).toBe('review_required');
    // Review never blocks a normal purchase; only an admin-set restriction does.
    await checkout(user);
    await db.pg.query("UPDATE profiles SET payment_risk_state = 'payment_risk_restricted' WHERE id = $1", [user]);
    currentUser = user;
    expect((await call('checkout', { method: 'POST', body: { package_id: 'credits_small', disclosure_version: LEGAL_VERSIONS.purchaseDisclosure, accepted: true } })).body.code).toBe('PURCHASE_RESTRICTED');
    currentUser = null;
  });
});

describe('customer views and authorization', () => {
  test('status and me show only my own purchases, with purchased / consumed / unused', async () => {
    const me = await db.newUser();
    const other = await db.newUser();
    const mine = await purchase(me);
    const theirs = await purchase(other);
    await spend(me, 12);
    currentUser = me;
    expect((await call('status', { query: { transaction_id: mine.txn } })).body).toMatchObject({ status: 'completed', credited: true, balance: 38 });
    expect((await call('status', { query: { transaction_id: theirs.txn } })).statusCode).toBe(404);
    const summary = (await call('me')).body;
    expect(summary.purchases).toEqual([expect.objectContaining({ payment_id: mine.paymentId, credits: expect.objectContaining({ purchased: 50, consumed: 12, unused: 38 }) })]);
    currentUser = null;
    expect((await call('me')).statusCode).toBe(401);
  });

  test('clients cannot read others\' payments, mint credits, edit lots, payments, mappings or risk state', async () => {
    const me = await db.newUser();
    const other = await db.newUser();
    await purchase(me);
    await purchase(other);
    await db.asClient(me, async () => {
      const visible = await db.rows<any>('SELECT id, status, credits_purchased FROM payments');
      expect(visible).toHaveLength(1);
      await expect(db.pg.query('SELECT paddle_customer_id FROM payments')).rejects.toThrow(/permission denied/);
      await expect(db.pg.query("UPDATE payments SET user_id = $1", [me])).rejects.toThrow(/permission denied/);
      await expect(db.pg.query("INSERT INTO payments (environment, package_id, package_version, credits_purchased, paddle_price_id, terms) VALUES ('sandbox','x',1,999,'p','{}')"))
        .rejects.toThrow(/permission denied/);
      for (const table of ['paddle_events', 'payment_adjustments', 'billing_policy_decisions', 'billing_alerts', 'account_risk_indicators']) {
        await expect(db.pg.query(`SELECT * FROM ${table}`)).rejects.toThrow(/permission denied/);
      }
      await expect(db.pg.query("UPDATE profiles SET payment_risk_state = 'normal' WHERE id = $1", [me])).rejects.toThrow(/permission denied/);
      await expect(db.pg.query("SELECT * FROM revoke_lot_credits(1, 1, 'refund', 'x', true)")).rejects.toThrow(/permission denied/);
      await expect(db.pg.query("SELECT * FROM apply_credit_transaction($1, 1000, 'purchase', 'fake', '{}')", [me])).rejects.toThrow(/permission denied/);
    });
    // There is no public route that refunds, grants or adjusts.
    for (const route of ['refund', 'grant', 'adjust', 'admin/adjust']) {
      currentUser = me;
      expect([403, 404]).toContain((await call(route, { method: 'POST', body: { credits: 100 } })).statusCode);
    }
    currentUser = null;
  });
});

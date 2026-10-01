/**
 * Operations: scheduled reconciliation (self-repair + escalation), the admin
 * console API (authorization, audit, evidence), and alerting.
 */
import { createBillingHandler } from '../../api/billing';
import { finalizeCredits, getCreditBalance, reserveCredits } from '../../api/ai/credits';
import { PaddleApiError, signPaddleBody, type PaddleApi, type PaddleConfig } from '../../api/billing/paddle';
import { LEGAL_VERSIONS } from '../../shared/billing/legal_versions';
import { handleAdmin } from '../../api/billing/admin';
import { adminRefundAllowed, LEGAL_POLICY, proportionalRefund } from '../../api/billing/refund_policy';
import { ALL_BILLING, createBillingDb, type BillingDb } from './helpers/billing_db';

const SECRET = 'pdl_ntfset_ops_secret';
const PRICE = 'pri_sandboxsmall0001';
const ENV = { PADDLE_PRICE_CREDITS_SMALL: PRICE, CRON_SECRET: 'cron-secret-123' } as NodeJS.ProcessEnv;
const CONFIG: PaddleConfig = { environment: 'sandbox', apiKey: 'pdl_sdbx_apikey_ops', webhookSecret: SECRET, apiBase: 'http://paddle.invalid' };

let db: BillingDb;
let currentUser: string | null = null;
let n = 0;
/** What "Paddle" currently says, per transaction. */
const paddle = new Map<string, { txn: Record<string, any>; adjustments: Array<Record<string, any>> }>();
let paddleDown = false;
const api: PaddleApi = {
  createTransaction: async () => {
    const id = `txn_ops${String(++n).padStart(6, '0')}`;
    paddle.set(id, { txn: { id, status: 'ready', updated_at: new Date().toISOString() }, adjustments: [] });
    return { id, status: 'ready' };
  },
  getTransaction: async (id) => { if (paddleDown) throw new Error('paddle 503'); return paddle.get(id)!.txn; },
  listAdjustments: async (id) => paddle.get(id)?.adjustments ?? [],
  createPartialRefund: async (input) => {
    refundCalls.push(input);
    if (refundRejects) throw new PaddleApiError('paddle /adjustments: 400 transaction_adjustment_pending', 400);
    // Like Paddle: a live refund starts pending_approval.
    const adj = { id: `adj_admin_${++n}`, action: 'refund', type: 'partial', status: 'pending_approval', transaction_id: input.transactionId,
      currency_code: 'ILS', totals: { total: String(input.amount) }, updated_at: new Date().toISOString() };
    paddle.get(input.transactionId)!.adjustments.push(adj);
    return adj;
  },
};
const refundCalls: Array<Parameters<PaddleApi['createPartialRefund']>[0]> = [];
let refundRejects = false;

const handler = createBillingHandler({ sql: () => db.sql, verifyUser: async () => currentUser, config: () => CONFIG, api: () => api, env: ENV });

function response() {
  const res: any = { statusCode: 200, headers: {}, headersSent: false };
  res.setHeader = (k: string, v: unknown) => { res.headers[k.toLowerCase()] = v; };
  res.status = (c: number) => { res.statusCode = c; return res; };
  res.json = (b: unknown) => { res.body = b; res.headersSent = true; return res; };
  res.send = (b: unknown) => { res.body = b; res.headersSent = true; return res; };
  return res;
}
async function call(route: string, init: { method?: string; body?: unknown; query?: Record<string, string>; headers?: Record<string, string>; raw?: string } = {}) {
  const res = response();
  await handler({ method: init.method ?? 'GET', url: `/api/billing/${route}`, query: { route, ...(init.query ?? {}) },
    headers: { 'content-type': 'application/json', ...(init.headers ?? {}) }, body: init.body, rawBody: init.raw } as any, res);
  return res;
}
const as = async <T>(userId: string | null, fn: () => Promise<T>) => { currentUser = userId; try { return await fn(); } finally { currentUser = null; } };

async function checkout(userId: string) {
  const res = await as(userId, () => call('checkout', { method: 'POST', body: { package_id: 'credits_small', disclosure_version: LEGAL_VERSIONS.purchaseDisclosure, accepted: true } }));
  return { txn: res.body.transaction_id as string, paymentId: res.body.payment_id as string };
}
/** Paddle completes the transaction (as its API would report it). */
function paddleCompletes(txn: string, userId: string, paymentId: string) {
  paddle.get(txn)!.txn = {
    id: txn, status: 'completed', customer_id: 'ctm_ops', custom_data: { syllo_user_id: userId, syllo_payment_id: paymentId },
    items: [{ price: { id: PRICE }, quantity: 1 }], details: { totals: { grand_total: '5000', currency_code: 'ILS' }, line_items: [{ id: `txnitm_${txn}`, totals: { total: '5000' } }] },
    updated_at: new Date().toISOString(),
  };
}
async function webhook(event: object) {
  const raw = JSON.stringify(event);
  return call('webhook', { method: 'POST', raw, headers: { 'paddle-signature': signPaddleBody(raw, SECRET) } });
}
async function purchased(userId: string) {
  const c = await checkout(userId);
  paddleCompletes(c.txn, userId, c.paymentId);
  await webhook({ event_id: `evt_ops_${++n}`, event_type: 'transaction.completed', occurred_at: new Date().toISOString(), data: paddle.get(c.txn)!.txn });
  return c;
}
const runCron = () => call('reconcile', { headers: { authorization: `Bearer ${ENV.CRON_SECRET}` } });
const openAlerts = (code: string) => db.rows<any>("SELECT * FROM billing_alerts WHERE code = $1 AND status = 'open'", [code]);

let admin: string;
beforeAll(async () => {
  db = await createBillingDb(ALL_BILLING);
  admin = await db.newUser();
  await db.pg.query("UPDATE profiles SET role = 'developer' WHERE id = $1", [admin]);
}, 60_000);
afterAll(async () => { await db?.pg.close(); });
beforeEach(() => { paddleDown = false; refundRejects = false; refundCalls.length = 0; jest.spyOn(console, 'error').mockImplementation(() => {}); jest.spyOn(console, 'warn').mockImplementation(() => {}); });
afterEach(() => jest.restoreAllMocks());

describe('scheduled reconciliation', () => {
  test('cron trigger requires the secret', async () => {
    expect((await call('reconcile')).statusCode).toBe(401);
    expect((await call('reconcile', { headers: { authorization: 'Bearer nope' } })).statusCode).toBe(401);
    expect((await runCron()).statusCode).toBe(200);
  });

  test('missed purchase webhook: the grant is repaired from Paddle state, exactly once', async () => {
    const user = await db.newUser();
    const c = await checkout(user);
    paddleCompletes(c.txn, user, c.paymentId);
    const first = await runCron();
    expect(first.body).toMatchObject({ ok: true });
    await runCron();
    expect(await getCreditBalance(db.sql, user)).toBe(50);
    const run = await db.one<any>('SELECT * FROM billing_reconciliation_runs WHERE id = $1', [first.body.run_id]);
    expect(run.findings).toEqual(expect.arrayContaining([{ code: 'completed_payment_without_grant', subject: `payment:${c.paymentId}`, outcome: 'repaired' }]));
    expect(await db.one<any>("SELECT source FROM paddle_events WHERE transaction_id = $1 AND event_type = 'transaction.completed'", [c.txn]))
      .toEqual({ source: 'reconciliation' });
  });

  test('missed refund and missed chargeback are applied through the normal policy path', async () => {
    const user = await db.newUser();
    const a = await purchased(user);
    const b = await purchased(user);
    paddle.get(a.txn)!.adjustments = [{ id: 'adj_recon_rf', action: 'refund', type: 'full', status: 'approved', transaction_id: a.txn, currency_code: 'ILS', totals: { total: '5000' }, updated_at: new Date().toISOString() }];
    paddle.get(b.txn)!.adjustments = [{ id: 'adj_recon_cb', action: 'chargeback', type: 'full', status: 'approved', transaction_id: b.txn, currency_code: 'ILS', totals: { total: '5000' }, updated_at: new Date().toISOString() }];
    await runCron();
    expect(await getCreditBalance(db.sql, user)).toBe(0);
    expect((await db.one<any>('SELECT status FROM payments WHERE id = $1', [a.paymentId])).status).toBe('refunded');
    expect((await db.one<any>('SELECT status FROM payments WHERE id = $1', [b.paymentId])).status).toBe('chargeback');
    expect(await openAlerts('chargeback')).toEqual(expect.arrayContaining([expect.objectContaining({ payment_id: Number(b.paymentId) })]));
  });

  test('a refund the webhook already applied is not reported as repaired (pending and approved)', async () => {
    const user = await db.newUser();
    const a = await purchased(user);
    const adj = (status: string) => ({ id: 'adj_seen_rf', action: 'refund', type: 'full', status, transaction_id: a.txn, currency_code: 'ILS', totals: { total: '5000' }, updated_at: new Date().toISOString() });
    for (const status of ['pending_approval', 'approved']) {
      await webhook({ event_id: `evt_seen_${status}`, event_type: status === 'approved' ? 'adjustment.updated' : 'adjustment.created', occurred_at: new Date().toISOString(), data: adj(status) });
      paddle.get(a.txn)!.adjustments = [adj(status)];
      const res = await runCron();
      const run = await db.one<any>('SELECT findings FROM billing_reconciliation_runs WHERE id = $1', [res.body.run_id]);
      expect(run.findings.filter((f: any) => f.subject === 'adjustment:adj_seen_rf')).toEqual([]);
    }
    expect(await getCreditBalance(db.sql, user)).toBe(0);
    expect(await db.one<any>("SELECT COUNT(*)::int AS n FROM credit_transactions WHERE kind = 'refund' AND user_id = $1", [user])).toEqual({ n: 1 });
  });

  test('stale pending checkout expires; stale AI reservation is released', async () => {
    const user = await db.newUser();
    const c = await checkout(user);
    await db.pg.query("UPDATE payments SET created_at = now() - interval '8 days' WHERE id = $1", [c.paymentId]);
    const p = await purchased(user);
    await reserveCredits(db.sql, { userId: user, operationId: 'op_zombie', credits: 1, endpoint: 'conversation' });
    await db.pg.query("UPDATE ai_operations SET reserved_at = now() - interval '2 hours' WHERE operation_id = 'op_zombie'");
    await runCron();
    expect((await db.one<any>('SELECT status FROM payments WHERE id = $1', [c.paymentId])).status).toBe('expired');
    expect((await db.one<any>("SELECT state FROM ai_operations WHERE operation_id = 'op_zombie'")).state).toBe('released');
    expect(await getCreditBalance(db.sql, user)).toBe(50);
    expect(p).toBeTruthy();
  });

  test('ledger invariant failures and Paddle outages are escalated, never silently edited', async () => {
    const user = await db.newUser();
    await purchased(user);
    await db.pg.query('UPDATE credit_accounts SET balance = 999 WHERE user_id = $1', [user]);
    paddleDown = true;
    await runCron();
    expect(await openAlerts('ledger_invariant')).toEqual(expect.arrayContaining([expect.objectContaining({ severity: 'critical', user_id: user })]));
    expect((await openAlerts('reconciliation_failed')).length).toBeGreaterThan(0);
    // The tampered cache is reported, not "fixed": a human decides.
    expect(await getCreditBalance(db.sql, user)).toBe(999);
    await db.pg.query('UPDATE credit_accounts SET balance = 50 WHERE user_id = $1', [user]);
    await db.pg.query("UPDATE billing_alerts SET status = 'resolved' WHERE code IN ('ledger_invariant', 'reconciliation_failed')");
  });

  test('a forged webhook raises a visible integration alert', async () => {
    const res = await call('webhook', { method: 'POST', raw: '{"event_id":"x"}', headers: { 'paddle-signature': 'ts=1;h1=00' } });
    expect(res.statusCode).toBe(401);
    expect((await openAlerts('webhook_failing')).length).toBeGreaterThan(0);
    await db.pg.query("UPDATE billing_alerts SET status = 'resolved' WHERE code = 'webhook_failing'");
  });
});

describe('admin console', () => {
  test('only developers: anonymous 401, regular user 403', async () => {
    const user = await db.newUser();
    expect((await call('admin/overview')).statusCode).toBe(401);
    expect((await as(user, () => call('admin/overview'))).statusCode).toBe(403);
    expect((await as(user, () => call('admin/adjust', { method: 'POST', body: { user_id: user, delta: 1000, reason: 'please' } }))).statusCode).toBe(403);
    expect((await as(user, () => call('admin/evidence', { query: { id: '1' } }))).statusCode).toBe(403);
  });

  test('overview, payment timeline and evidence package (no conversation content)', async () => {
    const user = await db.newUser();
    const c = await purchased(user);
    for (const op of ['op_ev_1', 'op_ev_2']) {
      await reserveCredits(db.sql, { userId: user, operationId: op, credits: 1, endpoint: 'conversation', model: 'gpt-x' });
      await finalizeCredits(db.sql, op, { input_tokens: 900, output_tokens: 120 });
    }
    await webhook({ event_id: `evt_ops_${++n}`, event_type: 'adjustment.created', occurred_at: new Date().toISOString(),
      data: { id: 'adj_ev', action: 'refund', type: 'full', status: 'approved', transaction_id: c.txn, currency_code: 'ILS', totals: { total: '5000' } } });

    const overview = (await as(admin, () => call('admin/overview'))).body;
    expect(overview).toMatchObject({ ok: true, health: expect.stringMatching(/normal|review|critical/), payments: expect.objectContaining({ purchases: expect.any(Number) }) });
    expect(overview.money_by_currency).toEqual(expect.arrayContaining([expect.objectContaining({ currency: 'ILS' })]));

    const detail = (await as(admin, () => call('admin/payment', { query: { id: c.paymentId } }))).body;
    expect(detail.timeline.map((t: any) => t.kind)).toEqual(expect.arrayContaining(['checkout', 'paddle_event', 'grant', 'usage', 'adjustment', 'decision', 'state']));
    expect(detail.evidence.credits).toMatchObject({ purchased: 50, consumed: 2, revoked: 48, unused: 0 });
    expect(detail.evidence.service_delivery.operations).toHaveLength(2);
    expect(detail.evidence.service_delivery.operations[0]).toMatchObject({ endpoint: 'conversation', model: 'gpt-x', credits_from_this_purchase: 1, input_tokens: 900 });
    expect(detail.alerts).toEqual(expect.arrayContaining([expect.objectContaining({ code: 'refund_after_consumption' })]));

    const json = await as(admin, () => call('admin/evidence', { query: { id: c.paymentId } }));
    expect(json.headers['content-disposition']).toMatch(/syllo-evidence-\d+\.json/);
    expect(json.body.statement).toMatch(/purchased 50 Syllo Credits .* consumed 2 credits through 2 delivered AI operations/);
    expect(JSON.stringify(json.body)).not.toMatch(/prompt|message_he|text_he|content/i);
    const text = await as(admin, () => call('admin/evidence', { query: { id: c.paymentId, format: 'text' } }));
    expect(text.body).toMatch(/SERVICE DELIVERY EVIDENCE[\s\S]*op_ev_1[\s\S]*FULL_REFUND_ACCOUNTING/);
  });

  test('mutations need a reason, go through the ledger, and are audited', async () => {
    const user = await db.newUser();
    expect((await as(admin, () => call('admin/adjust', { method: 'POST', body: { user_id: user, delta: 25 } }))).body.code).toBe('REASON_REQUIRED');
    // Positive adjustments create internal (dev/testing) lots: never for a customer.
    const customer = await as(admin, () => call('admin/adjust', { method: 'POST', body: { user_id: user, delta: 25, reason: 'support goodwill' } }));
    expect(customer.body.code).toBe('INTERNAL_CREDITS_STAFF_ONLY');
    await db.pg.query("UPDATE profiles SET role = 'developer' WHERE id = $1", [user]);
    const ok = await as(admin, () => call('admin/adjust', { method: 'POST', body: { user_id: user, delta: 25, reason: 'support goodwill' } }));
    expect(ok.body).toEqual({ ok: true, balance: 25 });
    expect(await db.one<any>("SELECT kind, delta, metadata FROM credit_transactions WHERE user_id = $1", [user]))
      .toEqual({ kind: 'admin_adjustment', delta: 25, metadata: { reason: 'support goodwill', actor_id: admin } });
    expect((await db.one<any>("SELECT source_class FROM credit_lots WHERE user_id = $1", [user])).source_class).toBe('internal');

    await as(admin, () => call('admin/risk-state', { method: 'POST', body: { user_id: user, state: 'payment_risk_restricted', reason: 'confirmed chargeback fraud' } }));
    await as(admin, () => call('admin/risk-state', { method: 'POST', body: { user_id: user, state: 'normal', reason: 'resolved with Paddle' } }));
    const [alert] = await db.rows<any>("INSERT INTO billing_alerts (severity, code, dedupe_key) VALUES ('review', 'manual_review', 'test:resolve') RETURNING id");
    expect((await as(admin, () => call('admin/alerts/resolve', { method: 'POST', body: { id: String(alert.id) } }))).body.code).toBe('REASON_REQUIRED');
    await as(admin, () => call('admin/alerts/resolve', { method: 'POST', body: { id: String(alert.id), reason: 'checked in Paddle' } }));
    expect(await db.one<any>('SELECT status, resolved_by FROM billing_alerts WHERE id = $1', [alert.id])).toEqual({ status: 'resolved', resolved_by: admin });

    const actions = await db.rows<any>('SELECT action, actor_id, reason FROM billing_admin_actions WHERE actor_id = $1 ORDER BY id', [admin]);
    expect(actions.map((a) => a.action)).toEqual(expect.arrayContaining(['credit_adjustment', 'set_risk_state', 'set_risk_state', 'resolve_alert']));
    await expect(db.pg.query("UPDATE billing_admin_actions SET reason = 'x'")).rejects.toThrow(/append-only/);
  });

  test('a case: auto-drafted reply, notes, status, history — nothing is sent', async () => {
    const [alert] = await db.rows<any>(
      "INSERT INTO billing_alerts (severity, code, dedupe_key) VALUES ('review', 'refund_after_consumption', 'test:case') RETURNING id");
    const id = String(alert.id);
    const detail = (await as(admin, () => call('admin/case', { query: { id } }))).body;
    expect(detail.case).toMatchObject({ id: alert.id, case_status: 'open', notes: [] });
    expect(detail.draft).toMatch(/REQUIRES LEGAL REVIEW/);
    expect(detail.draft).toMatch(/Syllo case #/);
    expect(detail.draft_saved).toBe(false);

    await as(admin, () => call('admin/cases/note', { method: 'POST', body: { id, reason: 'customer emailed support' } }));
    await as(admin, () => call('admin/cases/status', { method: 'POST', body: { id, case_status: 'awaiting_customer', reason: 'asked for details' } }));
    const saved = await as(admin, () => call('admin/cases/draft', { method: 'POST', body: { id, reason: 'regenerate' } }));
    expect(saved.body.draft).toMatch(/REQUIRES LEGAL REVIEW/);
    expect((await as(admin, () => call('admin/cases/status', { method: 'POST', body: { id, case_status: 'bogus', reason: 'x y z' } }))).body.code)
      .toBe('INVALID_REQUEST');

    const after = (await as(admin, () => call('admin/case', { query: { id } }))).body;
    expect(after.case).toMatchObject({ case_status: 'awaiting_customer', status: 'open', draft_template_version: 'draft-v1-unreviewed' });
    expect(after.case.notes).toEqual([expect.objectContaining({ text: 'customer emailed support', by: admin })]);
    expect(after.draft_saved).toBe(true);
    expect(after.actions.map((a: any) => a.action)).toEqual(['add_case_note', 'set_case_status', 'save_case_draft']);

    await as(admin, () => call('admin/cases/status', { method: 'POST', body: { id, case_status: 'resolved', reason: 'refund confirmed' } }));
    expect(await db.one<any>('SELECT status, case_status, resolved_by FROM billing_alerts WHERE id = $1', [alert.id]))
      .toEqual({ status: 'resolved', case_status: 'resolved', resolved_by: admin });
    const history = (await as(admin, () => call('admin/actions'))).body.actions;
    expect(history[0]).toMatchObject({ action: 'set_case_status', target: `alert:${id}` });
    expect((await as(admin, () => call('admin/case', { query: { id: 'nope' } }))).statusCode).toBe(404);
  });

  test('manual reconciliation from the console is audited', async () => {
    const res = await as(admin, () => call('admin/reconcile', { method: 'POST', body: { reason: 'after incident' } }));
    expect(res.body).toMatchObject({ ok: true, status: expect.any(String) });
    expect(await db.one<any>("SELECT trigger, actor_id FROM billing_reconciliation_runs ORDER BY id DESC LIMIT 1")).toEqual({ trigger: 'admin', actor_id: admin });
  });
});

describe('admin partial refund (proportional suggestion → Paddle POST /adjustments)', () => {
  const refund = (id: string, body: Record<string, unknown>) => as(admin, () => call('admin/refunds/partial', { method: 'POST', body: { id, ...body } }));
  const suggestion = async (id: string) => (await as(admin, () => call('admin/payment', { query: { id } }))).body.refund_suggestion;
  async function consumedTwo(user: string, tag: string) {
    for (const op of [`op_${tag}_1`, `op_${tag}_2`]) {
      await reserveCredits(db.sql, { userId: user, operationId: op, credits: 1, endpoint: 'conversation' });
      await finalizeCredits(db.sql, op, {});
    }
  }

  test('proportionalRefund: minor units, floored, capped by what is unrefunded', () => {
    expect(proportionalRefund({ amountTotal: 500, refundedAmount: 0, granted: 50, unused: 48 })).toBe(480);      // $5 × 48/50 = $4.80
    expect(proportionalRefund({ amountTotal: 1000, refundedAmount: 0, granted: 3, unused: 1 })).toBe(333);       // never rounds up
    expect(proportionalRefund({ amountTotal: 700, refundedAmount: 0, granted: 50, unused: 25 })).toBe(350);      // JPY: ¥700 is already the lowest unit
    expect(proportionalRefund({ amountTotal: 5000, refundedAmount: 4900, granted: 50, unused: 48 })).toBe(100);
    expect(proportionalRefund({ amountTotal: null, refundedAmount: 0, granted: 50, unused: 48 })).toBe(0);
    expect(adminRefundAllowed('sandbox', { status: 'unreviewed' })).toBe(true);
    expect(adminRefundAllowed('production', { status: 'unreviewed' })).toBe(false);
    expect(adminRefundAllowed('production', { status: 'approved' })).toBe(true);
    expect(adminRefundAllowed(null, { status: 'approved' })).toBe(false);
  });

  test('sandbox: suggests amount × unused / granted, issues it, and leaves the ledger to the webhook', async () => {
    const user = await db.newUser();
    const c = await purchased(user);
    await consumedTwo(user, 'pr');
    expect(await suggestion(c.paymentId)).toMatchObject({ amount: 4800, currency: 'ILS', granted: 50, unused: 48, blocked: null });

    expect((await refund(c.paymentId, { amount: 4800 })).body.code).toBe('REASON_REQUIRED');
    expect((await refund(c.paymentId, { amount: 5000, reason: 'customer asked' })).body.code).toBe('SUGGESTION_CHANGED');
    expect(refundCalls).toEqual([]);

    const ok = await refund(c.paymentId, { amount: 4800, reason: 'customer asked, 2 credits used' });
    expect(ok.body).toMatchObject({ ok: true, status: 'pending_approval', amount: 4800, currency: 'ILS' });
    expect(refundCalls).toEqual([{ transactionId: c.txn, itemId: `txnitm_${c.txn}`, amount: 4800, reason: 'customer asked, 2 credits used' }]);
    expect(await db.one<any>("SELECT actor_id, target, details FROM billing_admin_actions WHERE action = 'issue_partial_refund' AND target = $1", [`payment:${c.paymentId}`]))
      .toMatchObject({ actor_id: admin, details: { transaction_id: c.txn, amount: 4800, adjustment_id: ok.body.adjustment_id, adjustment_status: 'pending_approval' } });
    // No ledger write from the admin action.
    expect(await getCreditBalance(db.sql, user)).toBe(48);
    expect(await db.one<any>("SELECT COUNT(*)::int AS n FROM credit_transactions WHERE kind = 'refund' AND user_id = $1", [user])).toEqual({ n: 0 });

    // Paddle holds one pending refund: a second click is refused before calling Paddle.
    expect((await refund(c.paymentId, { amount: 4800, reason: 'double click' })).body.code).toBe('REFUND_PENDING');
    // Approved in Paddle but not yet delivered to us: still refused (would double-count).
    const adj = paddle.get(c.txn)!.adjustments[0];
    adj.status = 'approved';
    expect((await refund(c.paymentId, { amount: 4800, reason: 'double click' })).body.code).toBe('REFUND_NOT_YET_RECORDED');
    expect(refundCalls).toHaveLength(1);

    // The webhook is what revokes the unused credits.
    await webhook({ event_id: `evt_ops_${++n}`, event_type: 'adjustment.updated', occurred_at: new Date().toISOString(), data: adj });
    expect(await getCreditBalance(db.sql, user)).toBe(0);
    expect(await db.one<any>('SELECT status, refunded_amount FROM payments WHERE id = $1', [c.paymentId])).toEqual({ status: 'partially_refunded', refunded_amount: 4800 });
    expect(await suggestion(c.paymentId)).toMatchObject({ amount: 0, blocked: 'NOTHING_TO_REFUND' });
    expect((await refund(c.paymentId, { amount: 0, reason: 'again' })).body.code).toBe('NOTHING_TO_REFUND');
  });

  test('a Paddle refusal is audited and nothing else changes', async () => {
    const user = await db.newUser();
    const c = await purchased(user);
    refundRejects = true;
    const res = await refund(c.paymentId, { amount: 5000, reason: 'nothing used' });
    expect([res.statusCode, res.body.code]).toEqual([502, 'PADDLE_REJECTED']);
    expect(await db.one<any>("SELECT details FROM billing_admin_actions WHERE action = 'issue_partial_refund_failed' AND target = $1", [`payment:${c.paymentId}`]))
      .toMatchObject({ details: { amount: 5000, error: expect.stringContaining('400') } });
    expect(await getCreditBalance(db.sql, user)).toBe(50);
  });

  test('production fails closed unless LEGAL_POLICY is approved', async () => {
    const user = await db.newUser();
    const c = await purchased(user);
    const prodApi = { ...api, createPartialRefund: jest.fn() };
    const run = async (ctx: Partial<Parameters<typeof handleAdmin>[3]>) => {
      const res = response();
      await handleAdmin('refunds/partial', { method: 'POST', query: {}, body: { id: c.paymentId, amount: 5000, reason: 'prod attempt' } } as any, res,
        { sql: db.sql, actorId: admin, environment: 'production', api: () => prodApi, ...ctx });
      return res;
    };
    expect(LEGAL_POLICY.status).toBe('unreviewed');
    const denied = await run({});
    expect([denied.statusCode, denied.body.code]).toEqual([403, 'REFUND_POLICY_NOT_APPROVED']);
    // An approved policy passes the gate; this sandbox payment is then refused for the environment mismatch.
    expect((await run({ legal: { status: 'approved' } })).body.code).toBe('WRONG_ENVIRONMENT');
    expect(prodApi.createPartialRefund).not.toHaveBeenCalled();
    expect((await run({ environment: null, api: null })).body.code).toBe('BILLING_NOT_CONFIGURED');
  });
});

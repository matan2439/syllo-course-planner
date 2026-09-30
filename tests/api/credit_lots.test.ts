/**
 * Credit provenance (lots), deterministic allocation, and the AI metering
 * lifecycle (reserve → finalize | release), against real Postgres (PGlite).
 */
import {
  applyCreditTransaction, finalizeCredits, getCreditBalance, lotSummary, releaseCredits, reserveCredits,
} from '../../api/ai/credits';
import { ALL_BILLING, createBillingDb, type BillingDb } from './helpers/billing_db';

let db: BillingDb;
beforeAll(async () => {
  db = await createBillingDb(ALL_BILLING);
}, 60_000);
afterAll(async () => { await db?.pg.close(); });

const grant = (userId: string, delta: number, kind: 'purchase' | 'promo_grant' | 'admin_adjustment', reference: string | null = null) =>
  applyCreditTransaction(db.sql, { userId, delta, kind, reference });

/** Reserve + finalize one AI operation (a delivered service). */
async function spend(userId: string, credits: number, op: string) {
  const r = await reserveCredits(db.sql, { userId, operationId: op, credits, endpoint: 'conversation', model: 'm' });
  if (r.status !== 'applied') return r.status;
  return (await finalizeCredits(db.sql, op, { input_tokens: 100, output_tokens: 20 })).status;
}

const lotsOf = (userId: string) => lotSummary(db.sql, userId);

async function expectHealthy() {
  expect(await db.rows('SELECT * FROM credit_lot_drift')).toEqual([]);
  expect(await db.rows('SELECT * FROM credit_account_lot_drift')).toEqual([]);
  expect(await db.rows('SELECT * FROM credit_balance_drift')).toEqual([]);
}

test('every grant creates a traceable lot with its class', async () => {
  const user = await db.newUser();
  await grant(user, 500, 'purchase', 'pur_a');
  await grant(user, 100, 'promo_grant');
  await grant(user, 7, 'admin_adjustment');
  const lots = await lotsOf(user);
  expect(lots.map((l) => [l.sourceClass, l.granted, l.unused])).toEqual([
    ['purchased', 500, 500], ['promotional', 100, 100], ['internal', 7, 7],
  ]);
  await expectHealthy();
});

test('allocation order: internal → promotional → purchased, FIFO inside a class', async () => {
  const user = await db.newUser();
  await grant(user, 500, 'purchase', 'pur_fifo_a');
  await grant(user, 300, 'purchase', 'pur_fifo_b');
  await grant(user, 100, 'promo_grant');
  expect(await spend(user, 200, 'op_fifo_1')).toBe('applied');
  let [a, b, promo] = await lotsOf(user);
  // Promo (100) first, then the OLDEST purchase.
  expect([promo.consumed, a.consumed, b.consumed]).toEqual([100, 100, 0]);
  expect(await spend(user, 450, 'op_fifo_2')).toBe('applied');
  [a, b, promo] = await lotsOf(user);
  expect([promo.unused, a.unused, b.unused]).toEqual([0, 0, 250]);
  // Allocations tell which lot every usage row came from.
  const alloc = await db.rows<{ lot_id: string; amount: number }>(
    `SELECT al.lot_id, al.amount FROM credit_allocations al JOIN credit_transactions t ON t.id = al.transaction_id
      WHERE t.reference = 'op_fifo_2' ORDER BY al.lot_id`);
  expect(alloc.map((r) => r.amount)).toEqual([-400, -50]);
  await expectHealthy();
});

test('partial and full usage of a purchase: original / consumed / unused', async () => {
  const user = await db.newUser();
  await grant(user, 500, 'purchase', 'pur_partial');
  expect(await spend(user, 120, 'op_partial')).toBe('applied');
  expect(await lotsOf(user)).toEqual([expect.objectContaining({ granted: 500, consumed: 120, unused: 380 })]);
  expect(await spend(user, 380, 'op_full')).toBe('applied');
  expect(await lotsOf(user)).toEqual([expect.objectContaining({ granted: 500, consumed: 500, unused: 0 })]);
  expect(await spend(user, 1, 'op_empty')).toBe('insufficient');
  await expectHealthy();
});

test('zero-credit (free) operations are staff-only; exempt ones are evidence without charging', async () => {
  const user = await db.newUser();
  await expect(reserveCredits(db.sql, { userId: user, operationId: 'op_free_customer', credits: 0, endpoint: 'conversation' }))
    .rejects.toThrow(/not available to customers/);
  const staff = await db.newUser();
  await db.pg.query("UPDATE profiles SET role = 'developer' WHERE id = $1", [staff]);
  expect((await reserveCredits(db.sql, { userId: staff, operationId: 'op_free', credits: 0, endpoint: 'conversation' })).status).toBe('applied');
  await finalizeCredits(db.sql, 'op_free', { model: 'gpt-x', input_tokens: 10 });
  const dev = await db.newUser();
  await db.pg.query('UPDATE profiles SET billing_exempt = true WHERE id = $1', [dev]);
  expect((await reserveCredits(db.sql, { userId: dev, operationId: 'op_dev', credits: 1, endpoint: 'conversation' })).status).toBe('exempt');
  await finalizeCredits(db.sql, 'op_dev');
  const ops = await db.rows<any>("SELECT operation_id, funding, credits, state, model FROM ai_operations WHERE operation_id IN ('op_free','op_dev') ORDER BY 1");
  expect(ops).toEqual([
    { operation_id: 'op_dev', funding: 'exempt', credits: 0, state: 'delivered', model: null },
    { operation_id: 'op_free', funding: 'free_quota', credits: 0, state: 'delivered', model: 'gpt-x' },
  ]);
  expect(await getCreditBalance(db.sql, user)).toBe(0);
});

describe('customer credit policy: internal/dev credits are staff-only (billing/005)', () => {
  test('a normal user with internal + purchased lots consumes only purchased credits', async () => {
    const user = await db.newUser();
    await grant(user, 10, 'admin_adjustment');         // internal lot (e.g. legacy/dev grant)
    await grant(user, 3, 'purchase', 'pur_policy_a');
    expect(await spend(user, 3, 'op_policy_1')).toBe('applied');
    const [internal, purchased] = await lotsOf(user);
    expect([internal.sourceClass, internal.consumed, internal.unused]).toEqual(['internal', 0, 10]);
    expect([purchased.consumed, purchased.unused]).toEqual([3, 0]);
    // The 10 internal credits are not spendable: no hidden quota.
    expect(await spend(user, 1, 'op_policy_2')).toBe('insufficient');
    expect((await applyCreditTransaction(db.sql, { userId: user, delta: -1, kind: 'ai_usage', reference: 'op_policy_direct' })).status)
      .toBe('insufficient');
    await expectHealthy();
  });

  test('purchased credits are spent FIFO across purchases', async () => {
    const user = await db.newUser();
    await grant(user, 2, 'purchase', 'pur_policy_old');
    await grant(user, 5, 'purchase', 'pur_policy_new');
    expect(await spend(user, 3, 'op_policy_fifo')).toBe('applied');
    const [older, newer] = await lotsOf(user);
    expect([older.consumed, newer.consumed]).toEqual([2, 1]);
    await expectHealthy();
  });

  test('a normal user holding only internal credits is refused', async () => {
    const user = await db.newUser();
    await grant(user, 50, 'admin_adjustment');
    expect(await spend(user, 1, 'op_policy_internal_only')).toBe('insufficient');
  });

  test('a developer keeps dev access: internal credits are spendable', async () => {
    const dev = await db.newUser();
    await db.pg.query("UPDATE profiles SET role = 'developer' WHERE id = $1", [dev]);
    await grant(dev, 5, 'admin_adjustment');
    await grant(dev, 5, 'purchase', 'pur_policy_dev');
    expect(await spend(dev, 6, 'op_policy_dev')).toBe('applied');
    const [internal, purchased] = await lotsOf(dev);
    expect([internal.consumed, purchased.consumed]).toEqual([5, 1]);   // dev lots first for staff
    await expectHealthy();
  });

  test("one user's internal credits never affect another user", async () => {
    const dev = await db.newUser();
    await db.pg.query("UPDATE profiles SET role = 'developer' WHERE id = $1", [dev]);
    await grant(dev, 100, 'admin_adjustment');
    const customer = await db.newUser();
    expect(await spend(customer, 1, 'op_policy_cross')).toBe('insufficient');
    const [devLot] = await lotsOf(dev);
    expect(devLot.unused).toBe(100);
  });

  test('refunds may still revoke from any lot (revocation is not spending)', async () => {
    const user = await db.newUser();
    await grant(user, 4, 'admin_adjustment');
    expect((await applyCreditTransaction(db.sql, { userId: user, delta: -4, kind: 'admin_adjustment', reference: 'rev_policy' })).status)
      .toBe('applied');
    await expectHealthy();
  });
});

test('reservation holds credits: two simultaneous calls cannot spend the last credit', async () => {
  const user = await db.newUser();
  await grant(user, 1, 'purchase', 'pur_last');
  const results = await Promise.all([0, 1, 2].map((i) =>
    reserveCredits(db.sql, { userId: user, operationId: `op_last_${i}`, credits: 1, endpoint: 'conversation' })));
  expect(results.map((r) => r.status).sort()).toEqual(['applied', 'insufficient', 'insufficient']);
  // Direct ledger spending also respects the hold.
  expect((await applyCreditTransaction(db.sql, { userId: user, delta: -1, kind: 'ai_usage', reference: 'op_direct' })).status).toBe('insufficient');
  await expectHealthy();
});

test('release returns credits; finalize and release are idempotent and exclusive', async () => {
  const user = await db.newUser();
  await grant(user, 10, 'purchase', 'pur_rel');
  await reserveCredits(db.sql, { userId: user, operationId: 'op_rel', credits: 3, endpoint: 'conversation' });
  expect((await lotsOf(user))[0]).toMatchObject({ reserved: 3, unused: 7 });
  await releaseCredits(db.sql, 'op_rel');
  await releaseCredits(db.sql, 'op_rel');
  expect((await finalizeCredits(db.sql, 'op_rel')).status).toBe('released'); // too late: nothing charged
  expect((await lotsOf(user))[0]).toMatchObject({ reserved: 0, consumed: 0, unused: 10 });

  await reserveCredits(db.sql, { userId: user, operationId: 'op_fin', credits: 2, endpoint: 'conversation' });
  const [x, y] = await Promise.all([finalizeCredits(db.sql, 'op_fin'), finalizeCredits(db.sql, 'op_fin')]);
  expect([x.status, y.status].sort()).toEqual(['applied', 'replayed']);
  await releaseCredits(db.sql, 'op_fin'); // no effect after delivery
  expect((await reserveCredits(db.sql, { userId: user, operationId: 'op_fin', credits: 2, endpoint: 'conversation' })).status).toBe('replayed');
  expect(await getCreditBalance(db.sql, user)).toBe(8);
  const other = await db.newUser();
  await expect(reserveCredits(db.sql, { userId: other, operationId: 'op_fin', credits: 1, endpoint: 'conversation' }))
    .rejects.toThrow(/another user/);
  await expectHealthy();
});

describe('lot revocation (the primitive refunds and chargebacks use)', () => {
  const revoke = (lotId: string, credits: number | null, reference: string, close = true) =>
    db.one<any>('SELECT * FROM revoke_lot_credits($1, $2, $3, $4, $5)', [lotId, credits, 'refund', reference, close]);

  test('unused package: everything revoked, nothing else touched, replay-safe', async () => {
    const user = await db.newUser();
    await grant(user, 500, 'purchase', 'pur_unused');
    await grant(user, 100, 'promo_grant');
    const [paid] = await lotsOf(user);
    expect(await revoke(paid.lotId, null, 'rf_unused')).toMatchObject({ status: 'applied', revoked_now: 500, unrevocable: 0 });
    expect(await revoke(paid.lotId, null, 'rf_unused')).toMatchObject({ status: 'replayed', revoked_now: 500 });
    const [p, promo] = await lotsOf(user);
    expect(p).toMatchObject({ granted: 500, revoked: 500, unused: 0, state: 'revoked' });
    expect(promo).toMatchObject({ unused: 100 });
    expect(await getCreditBalance(db.sql, user)).toBe(100);
    // A revoked lot is never allocated again.
    expect(await spend(user, 101, 'op_after_revoke')).toBe('insufficient');
    await expectHealthy();
  });

  test('partially consumed: the 380 unused are revoked, the 120 consumed stay consumed', async () => {
    const user = await db.newUser();
    await grant(user, 500, 'purchase', 'pur_120');
    await spend(user, 120, 'op_120');
    const [lot] = await lotsOf(user);
    expect(await revoke(lot.lotId, null, 'rf_120')).toMatchObject({ revoked_now: 380, unrevocable: 120 });
    expect((await lotsOf(user))[0]).toMatchObject({ granted: 500, consumed: 120, revoked: 380, unused: 0 });
    const history = await db.rows<any>('SELECT kind, delta FROM credit_transactions WHERE user_id = $1 ORDER BY id', [user]);
    expect(history).toEqual([{ kind: 'purchase', delta: 500 }, { kind: 'ai_usage', delta: -120 }, { kind: 'refund', delta: -380 }]);
    await expectHealthy();
  });

  test('fully consumed: nothing to revoke, no negative balance, consumption reported as unrevocable', async () => {
    const user = await db.newUser();
    await grant(user, 500, 'purchase', 'pur_all');
    await spend(user, 500, 'op_all');
    const [lot] = await lotsOf(user);
    expect(await revoke(lot.lotId, 500, 'rf_all')).toMatchObject({ revoked_now: 0, pending_added: 0, unrevocable: 500 });
    expect(await getCreditBalance(db.sql, user)).toBe(0);
    await expectHealthy();
  });

  test('refund during an in-flight call: finalize → consumed; release → revoked', async () => {
    const user = await db.newUser();
    await grant(user, 10, 'purchase', 'pur_race');
    await reserveCredits(db.sql, { userId: user, operationId: 'op_race_done', credits: 2, endpoint: 'conversation' });
    await reserveCredits(db.sql, { userId: user, operationId: 'op_race_fail', credits: 3, endpoint: 'conversation' });
    const [lot] = await lotsOf(user);
    expect(await revoke(lot.lotId, null, 'rf_race')).toMatchObject({ revoked_now: 5, pending_added: 5 });
    expect(await getCreditBalance(db.sql, user)).toBe(5);
    // The delivered call was service already provided: it is consumed, not revoked.
    expect((await finalizeCredits(db.sql, 'op_race_done')).status).toBe('applied');
    await releaseCredits(db.sql, 'op_race_fail');
    expect((await lotsOf(user))[0]).toMatchObject({ granted: 10, consumed: 2, revoked: 8, reserved: 0, unused: 0 });
    expect(await getCreditBalance(db.sql, user)).toBe(0);
    await expectHealthy();
  });

  test('partial revocation keeps the lot usable for the remainder', async () => {
    const user = await db.newUser();
    await grant(user, 500, 'purchase', 'pur_part');
    const [lot] = await lotsOf(user);
    expect(await revoke(lot.lotId, 200, 'rf_part', false)).toMatchObject({ revoked_now: 200 });
    expect(await spend(user, 300, 'op_part_rest')).toBe('applied');
    await expectHealthy();
  });
});

describe('clients cannot touch lots or metering', () => {
  test('no read or write access, no function access', async () => {
    const me = await db.newUser();
    await grant(me, 10, 'purchase', 'pur_client');
    await db.asClient(me, async () => {
      for (const table of ['credit_lots', 'credit_allocations', 'ai_operations', 'ai_operation_lots', 'credit_lot_revocations']) {
        await expect(db.pg.query(`SELECT * FROM ${table}`)).rejects.toThrow(/permission denied/);
      }
      await expect(db.pg.query("SELECT * FROM reserve_ai_credits($1, 'x', 0, 'e', NULL, NULL)", [me])).rejects.toThrow(/permission denied/);
      await expect(db.pg.query("SELECT * FROM finalize_ai_credits('x')")).rejects.toThrow(/permission denied/);
      await expect(db.pg.query("SELECT * FROM release_ai_credits('x')")).rejects.toThrow(/permission denied/);
      await expect(db.pg.query("SELECT * FROM revoke_lot_credits(1, 1, 'refund', 'x', true)")).rejects.toThrow(/permission denied/);
      await expect(db.pg.query('UPDATE credit_lots SET credits_granted = 99999')).rejects.toThrow(/permission denied/);
    });
  });
});

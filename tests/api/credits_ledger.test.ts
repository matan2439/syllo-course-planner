/**
 * Syllo Credits ledger — run against a real Postgres engine (PGlite, in-process)
 * with the actual migrations: auth/001_profiles.sql + billing/001_credits.sql.
 *
 * PGlite is a single connection, so the concurrency test proves the no-overdraft
 * logic under interleaved calls; cross-connection safety rests on the per-user
 * `FOR UPDATE` lock, which is asserted on the SQL below.
 */
import fs from 'fs';
import path from 'path';
import { randomUUID } from 'crypto';
import { PGlite } from '@electric-sql/pglite';
import {
  applyCreditTransaction, chargeCredits, getCreditBalance, type CreditsSql,
} from '../../api/ai/credits';

const migration = (rel: string) => fs.readFileSync(path.resolve(__dirname, '../../scripts/migrations', rel), 'utf8');
const creditsSql = migration('billing/001_credits.sql');

// The slice of Supabase the migrations rely on.
const SUPABASE_STUB = `
  CREATE ROLE anon NOLOGIN;
  CREATE ROLE authenticated NOLOGIN;
  CREATE SCHEMA auth;
  CREATE TABLE auth.users (id uuid PRIMARY KEY, email text);
  CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS
    $$ SELECT nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
  GRANT USAGE ON SCHEMA auth, public TO anon, authenticated;
`;

let pg: PGlite;
let sql: CreditsSql;

async function newUser(): Promise<string> {
  const id = randomUUID();
  await pg.query('INSERT INTO auth.users (id, email) VALUES ($1, $2)', [id, `${id}@test`]);
  return id;
}

const ledgerSum = async (userId: string) =>
  Number((await pg.query<{ s: string }>('SELECT COALESCE(SUM(delta), 0) AS s FROM credit_transactions WHERE user_id = $1', [userId])).rows[0].s);

/** Run `fn` as a signed-in browser client (Data API role + JWT subject). */
async function asClient<T>(userId: string, fn: () => Promise<T>): Promise<T> {
  await pg.exec(`SET ROLE authenticated; SET request.jwt.claim.sub = '${userId}';`);
  try {
    return await fn();
  } finally {
    await pg.exec('RESET ROLE; RESET request.jwt.claim.sub;');
  }
}

beforeAll(async () => {
  pg = new PGlite();
  await pg.exec(SUPABASE_STUB);
  await pg.exec(migration('auth/001_profiles.sql'));
  await pg.exec(creditsSql);
  await pg.exec(creditsSql); // idempotent re-apply
  // The lot-aware ledger (002) must keep every behaviour asserted here.
  await pg.exec(migration('billing/002_credit_lots.sql'));
  await pg.exec(migration('billing/002_credit_lots.sql'));
  sql = { unsafe: async (q, p) => (await pg.query<Record<string, unknown>>(q, p as unknown[])).rows };
}, 60_000);

afterAll(async () => { await pg?.close(); });

test('grant credits', async () => {
  const user = await newUser();
  const r = await applyCreditTransaction(sql, {
    userId: user, delta: 500, kind: 'purchase', reference: 'evt_grant_1', metadata: { package: 'medium' },
  });
  expect(r).toEqual({ status: 'applied', balance: 500, transactionId: expect.any(String) });
  expect(await getCreditBalance(sql, user)).toBe(500);
  const row = (await pg.query<any>('SELECT * FROM credit_transactions WHERE id = $1', [r.transactionId])).rows[0];
  expect(row).toEqual(expect.objectContaining({
    user_id: user, delta: 500, kind: 'purchase', reference: 'evt_grant_1',
    metadata: { package: 'medium' }, balance_after: 500,
  }));
});

test('deduct credits', async () => {
  const user = await newUser();
  await applyCreditTransaction(sql, { userId: user, delta: 50, kind: 'promo_grant' });
  const r = await chargeCredits(sql, { userId: user, credits: 8, operationId: 'op_1', metadata: { feature: 'copilot' } });
  expect(r).toMatchObject({ status: 'applied', balance: 42 });
  expect(await getCreditBalance(sql, user)).toBe(42);
});

test('insufficient credits writes nothing', async () => {
  const user = await newUser();
  await applyCreditTransaction(sql, { userId: user, delta: 5, kind: 'promo_grant' });
  const r = await chargeCredits(sql, { userId: user, credits: 8, operationId: 'op_poor' });
  expect(r).toEqual({ status: 'insufficient', balance: 5, transactionId: null });
  expect(await getCreditBalance(sql, user)).toBe(5);
  expect(await ledgerSum(user)).toBe(5);
  // A user with no account at all also cannot spend.
  expect((await chargeCredits(sql, { userId: await newUser(), credits: 1, operationId: 'op_empty' })).status).toBe('insufficient');
});

test('concurrent deductions never overdraw', async () => {
  const user = await newUser();
  await applyCreditTransaction(sql, { userId: user, delta: 100, kind: 'admin_adjustment' });
  const results = await Promise.all(Array.from({ length: 10 }, (_, i) =>
    chargeCredits(sql, { userId: user, credits: 30, operationId: `op_race_${i}` })));
  expect(results.filter((r) => r.status === 'applied')).toHaveLength(3);
  expect(results.filter((r) => r.status === 'insufficient')).toHaveLength(7);
  expect(await getCreditBalance(sql, user)).toBe(10);
  expect(await ledgerSum(user)).toBe(10);
  // Cross-connection safety: the balance is read under a per-user row lock.
  expect(creditsSql).toMatch(/FROM public\.credit_accounts a WHERE a\.user_id = p_user FOR UPDATE;/);
});

test('idempotent transaction: same reference applies once, concurrent retries too', async () => {
  const user = await newUser();
  await applyCreditTransaction(sql, { userId: user, delta: 100, kind: 'purchase', reference: 'evt_idem' });
  const [a, b] = await Promise.all([
    chargeCredits(sql, { userId: user, credits: 8, operationId: 'op_idem' }),
    chargeCredits(sql, { userId: user, credits: 8, operationId: 'op_idem' }),
  ]);
  expect([a.status, b.status].sort()).toEqual(['applied', 'replayed']);
  expect(a.transactionId).toBe(b.transactionId);
  const replay = await applyCreditTransaction(sql, { userId: user, delta: 100, kind: 'purchase', reference: 'evt_idem' });
  expect(replay.status).toBe('replayed');
  expect(await getCreditBalance(sql, user)).toBe(92);
  // Reusing an event id with different parameters (or for another user) is rejected.
  await expect(applyCreditTransaction(sql, { userId: user, delta: 999, kind: 'purchase', reference: 'evt_idem' }))
    .rejects.toThrow(/reused with different parameters/);
  await expect(applyCreditTransaction(sql, { userId: await newUser(), delta: 100, kind: 'purchase', reference: 'evt_idem' }))
    .rejects.toThrow(/reused with different parameters/);
});

test('billing-exempt accounts are never charged for AI usage', async () => {
  const dev = await newUser();
  await pg.query("UPDATE profiles SET role = 'developer', billing_exempt = true WHERE id = $1", [dev]);
  const r = await chargeCredits(sql, { userId: dev, credits: 8, operationId: 'op_dev' });
  expect(r).toEqual({ status: 'exempt', balance: 0, transactionId: null });
  expect(await ledgerSum(dev)).toBe(0);
  // Grants still land; only AI usage is waived.
  await applyCreditTransaction(sql, { userId: dev, delta: 20, kind: 'promo_grant' });
  expect((await chargeCredits(sql, { userId: dev, credits: 8, operationId: 'op_dev_2' })).status).toBe('exempt');
  expect(await getCreditBalance(sql, dev)).toBe(20);
});

test('ledger sign rules are enforced by the database', async () => {
  const user = await newUser();
  await expect(pg.query("SELECT * FROM apply_credit_transaction($1, 5, 'ai_usage', 'op_neg', '{}')", [user]))
    .rejects.toThrow(/credit_transactions_sign/);
  await applyCreditTransaction(sql, { userId: user, delta: 50, kind: 'promo_grant' });
  await expect(pg.query("SELECT * FROM apply_credit_transaction($1, -5, 'purchase', NULL, '{}')", [user]))
    .rejects.toThrow(/credit_transactions_sign/);
  await expect(pg.query("SELECT * FROM apply_credit_transaction($1, 5, 'free_money', NULL, '{}')", [user]))
    .rejects.toThrow(/check constraint/);
  await expect(applyCreditTransaction(sql, { userId: user, delta: 0, kind: 'refund' })).rejects.toThrow(TypeError);
  await expect(applyCreditTransaction(sql, { userId: 'not-a-uuid', delta: 5, kind: 'refund' })).rejects.toThrow(TypeError);
});

describe('clients cannot modify credits', () => {
  test("a signed-in user can read only their own balance and cannot mint or edit anyone's credits", async () => {
    const me = await newUser();
    const other = await newUser();
    await applyCreditTransaction(sql, { userId: me, delta: 10, kind: 'promo_grant' });
    await applyCreditTransaction(sql, { userId: other, delta: 70, kind: 'promo_grant' });

    await asClient(me, async () => {
      const visible = (await pg.query<any>('SELECT user_id, balance FROM credit_accounts')).rows;
      expect(visible).toEqual([{ user_id: me, balance: 10 }]);
      await expect(pg.query("SELECT * FROM apply_credit_transaction($1, 1000, 'admin_adjustment', NULL, '{}')", [me]))
        .rejects.toThrow(/permission denied/);
      await expect(pg.query("SELECT * FROM apply_credit_transaction($1, -70, 'admin_adjustment', NULL, '{}')", [other]))
        .rejects.toThrow(/permission denied/);
      await expect(pg.query('UPDATE credit_accounts SET balance = 1000000 WHERE user_id = $1', [me]))
        .rejects.toThrow(/permission denied/);
      await expect(pg.query("INSERT INTO credit_transactions (user_id, delta, kind, balance_after) VALUES ($1, 1000, 'purchase', 1000)", [me]))
        .rejects.toThrow(/permission denied/);
      await expect(pg.query('SELECT * FROM credit_transactions')).rejects.toThrow(/permission denied/);
      await expect(pg.query('UPDATE profiles SET billing_exempt = true WHERE id = $1', [me]))
        .rejects.toThrow(/permission denied/);
    });
    expect(await getCreditBalance(sql, me)).toBe(10);
    expect(await getCreditBalance(sql, other)).toBe(70);
  });

  test('anonymous visitors see nothing and can call nothing', async () => {
    await pg.exec('SET ROLE anon;');
    try {
      await expect(pg.query('SELECT * FROM credit_accounts')).rejects.toThrow(/permission denied/);
      await expect(pg.query("SELECT * FROM apply_credit_transaction(gen_random_uuid(), 1, 'promo_grant', NULL, '{}')"))
        .rejects.toThrow(/permission denied/);
    } finally {
      await pg.exec('RESET ROLE;');
    }
  });
});

test('balance reconciles from the ledger; drift is detected; history is append-only', async () => {
  const user = await newUser();
  await applyCreditTransaction(sql, { userId: user, delta: 500, kind: 'purchase', reference: 'evt_rec' });
  await chargeCredits(sql, { userId: user, credits: 8, operationId: 'op_rec' });
  await applyCreditTransaction(sql, { userId: user, delta: 50, kind: 'promo_grant' });
  await applyCreditTransaction(sql, { userId: user, delta: 100, kind: 'admin_adjustment' });
  await applyCreditTransaction(sql, { userId: user, delta: -20, kind: 'refund', reference: 'rf_1' });

  expect(await getCreditBalance(sql, user)).toBe(622);
  expect(await ledgerSum(user)).toBe(622);
  const chain = (await pg.query<any>('SELECT delta, balance_after FROM credit_transactions WHERE user_id = $1 ORDER BY id', [user])).rows;
  expect(chain.map((r) => Number(r.balance_after))).toEqual([500, 492, 542, 642, 622]);
  expect((await pg.query('SELECT * FROM credit_balance_drift WHERE user_id = $1', [user])).rows).toEqual([]);

  // Tamper with the cache → the drift view flags it, the ledger is the truth.
  await pg.query('UPDATE credit_accounts SET balance = 9999 WHERE user_id = $1', [user]);
  expect((await pg.query<any>('SELECT cached_balance, ledger_balance FROM credit_balance_drift WHERE user_id = $1', [user])).rows)
    .toEqual([{ cached_balance: 9999, ledger_balance: 622 }]);

  await expect(pg.query('UPDATE credit_transactions SET delta = 1000000 WHERE user_id = $1', [user]))
    .rejects.toThrow(/append-only/);
});

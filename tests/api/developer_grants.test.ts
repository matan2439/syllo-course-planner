/**
 * auth/005_developer_grants.sql against a real Postgres engine (PGlite, in-process) with the actual
 * migrations. A broken trigger on auth.users would break every sign-up, so the behaviour is proven
 * here rather than read off the SQL.
 */
import fs from 'fs';
import path from 'path';
import { randomUUID } from 'crypto';
import { PGlite } from '@electric-sql/pglite';
import { chargeCredits, type CreditsSql } from '../../api/ai/credits';

const migration = (rel: string) => fs.readFileSync(path.resolve(__dirname, '../../scripts/migrations', rel), 'utf8');
const grantsSql = migration('auth/005_developer_grants.sql');
const GRANTED = 'gefen.orenstein@gmail.com';
const OWNER = 'owner@example.com';

// The slice of Supabase the migrations rely on.
const SUPABASE_STUB = `
  CREATE ROLE anon NOLOGIN;
  CREATE ROLE authenticated NOLOGIN;
  CREATE SCHEMA auth;
  CREATE TABLE auth.users (id uuid PRIMARY KEY, email text, email_confirmed_at timestamptz);
  CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS
    $$ SELECT nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
  GRANT USAGE ON SCHEMA auth, public TO anon, authenticated;
`;

let pg: PGlite;
let ownerId: string;
let earlyBirdId: string;

const signUp = async (email: string, confirmed: boolean) => {
  const id = randomUUID();
  await pg.query('INSERT INTO auth.users (id, email, email_confirmed_at) VALUES ($1, $2, $3)', [id, email, confirmed ? new Date() : null]);
  return id;
};
const profile = async (id: string) =>
  (await pg.query<{ role: string; billing_exempt: boolean }>('SELECT role, billing_exempt FROM public.profiles WHERE id = $1', [id])).rows[0];

beforeAll(async () => {
  pg = new PGlite();
  await pg.exec(SUPABASE_STUB);
  await pg.exec(migration('auth/001_profiles.sql'));
  await pg.exec(migration('billing/001_credits.sql'));
  await pg.exec(migration('billing/002_credit_lots.sql'));
  // Before the migration: the site owner (a developer) and an ordinary student already exist.
  ownerId = await signUp(OWNER, true);
  await pg.query("UPDATE public.profiles SET role = 'developer', billing_exempt = true WHERE id = $1", [ownerId]);
  earlyBirdId = await signUp('student@example.com', true);
  await pg.exec(grantsSql);
  await pg.exec(grantsSql); // idempotent re-apply
}, 60_000);

afterAll(async () => { await pg?.close(); });

test('the grant is seeded once and no existing account is touched', async () => {
  expect((await pg.query<{ email: string }>('SELECT email FROM public.developer_grants')).rows).toEqual([{ email: GRANTED }]);
  expect(await profile(ownerId)).toEqual({ role: 'developer', billing_exempt: true });
  expect(await profile(earlyBirdId)).toEqual({ role: 'user', billing_exempt: false });
});

test('first sign-in with the granted address (already verified, e.g. Google) is a developer at once', async () => {
  const id = await signUp(GRANTED, true);
  // Exactly the site owner's configuration.
  expect(await profile(id)).toEqual(await profile(ownerId));
  await pg.query('DELETE FROM auth.users WHERE id = $1', [id]);
});

test('an unverified sign-up with the granted address gets nothing until the inbox confirms it', async () => {
  const id = await signUp(GRANTED.toUpperCase(), false); // address matching ignores case
  expect(await profile(id)).toEqual({ role: 'user', billing_exempt: false });
  await pg.query('UPDATE auth.users SET email_confirmed_at = now() WHERE id = $1', [id]);
  expect(await profile(id)).toEqual({ role: 'developer', billing_exempt: true });

  // Unlimited AI use: a charge with no balance is recorded as exempt, never refused.
  const sql: CreditsSql = { unsafe: async (q, p) => (await pg.query<Record<string, unknown>>(q, p as unknown[])).rows };
  expect(await chargeCredits(sql, { userId: id, credits: 5, operationId: 'dev_use_1' }))
    .toEqual(expect.objectContaining({ status: 'exempt' }));
  await pg.query('DELETE FROM auth.users WHERE id = $1', [id]);
});

test('other addresses are ordinary users, verified or not', async () => {
  for (const [email, confirmed] of [['someone@example.com', true], ['gefen.orenstein@gmail.com.evil.example', true], ['x' + GRANTED, false]] as const) {
    expect(await profile(await signUp(email, confirmed))).toEqual({ role: 'user', billing_exempt: false });
  }
});

test('an existing verified account is upgraded when the migration runs', async () => {
  await pg.query('DELETE FROM public.developer_grants');
  const id = await signUp(GRANTED, true);
  expect(await profile(id)).toEqual({ role: 'user', billing_exempt: false }); // signed up before the grant existed
  await pg.exec(grantsSql);
  expect(await profile(id)).toEqual({ role: 'developer', billing_exempt: true });
  expect(await profile(earlyBirdId)).toEqual({ role: 'user', billing_exempt: false });
});

test('the grant list is server-only and clients still cannot change role or exemption', async () => {
  const sqlText = grantsSql.replace(/--.*$/gm, '');
  expect(sqlText).toMatch(/ALTER TABLE public\.developer_grants ENABLE ROW LEVEL SECURITY/);
  expect(sqlText).toMatch(/REVOKE ALL ON public\.developer_grants FROM PUBLIC, anon, authenticated/);
  expect(sqlText).not.toMatch(/GRANT [^;]*TO (anon|authenticated)/);
  expect(sqlText).not.toMatch(/service_role|password|secret/i);
  await pg.exec(`SET ROLE authenticated; SET request.jwt.claim.sub = '${earlyBirdId}';`);
  try {
    await expect(pg.query('SELECT * FROM public.developer_grants')).rejects.toThrow();
    await expect(pg.query("INSERT INTO public.developer_grants (email) VALUES ('student@example.com')")).rejects.toThrow();
    await expect(pg.query("UPDATE public.profiles SET role = 'developer' WHERE id = $1", [earlyBirdId])).rejects.toThrow();
  } finally {
    await pg.exec('RESET ROLE; RESET request.jwt.claim.sub;');
  }
});

test('a failing grant never blocks a sign-up', async () => {
  // Simulate a broken profiles write inside the trigger.
  await pg.exec("ALTER TABLE public.profiles ADD CONSTRAINT temp_block CHECK (role <> 'developer') NOT VALID");
  await pg.query('DELETE FROM auth.users WHERE lower(email) = $1', [GRANTED]);
  const id = await signUp(GRANTED, true);
  expect((await pg.query('SELECT 1 FROM auth.users WHERE id = $1', [id])).rows).toHaveLength(1);
  expect(await profile(id)).toEqual({ role: 'user', billing_exempt: false });
  await pg.exec('ALTER TABLE public.profiles DROP CONSTRAINT temp_block');
});

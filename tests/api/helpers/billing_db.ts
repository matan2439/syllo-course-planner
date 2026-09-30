/**
 * A real Postgres (PGlite, in-process) with the Supabase slice the billing
 * migrations rely on, plus every billing migration applied (twice: idempotency).
 * PGlite is ONE connection: concurrency tests prove the logic under interleaved
 * calls; cross-connection safety rests on the per-user `FOR UPDATE` lock.
 */
import fs from 'fs';
import path from 'path';
import { randomUUID } from 'crypto';
import { PGlite } from '@electric-sql/pglite';
import type { BillingSql } from '../../../api/ai/credits';

export const migration = (rel: string) =>
  fs.readFileSync(path.resolve(__dirname, '../../../scripts/migrations', rel), 'utf8');

const SUPABASE_STUB = `
  CREATE ROLE anon NOLOGIN;
  CREATE ROLE authenticated NOLOGIN;
  CREATE SCHEMA auth;
  CREATE TABLE auth.users (id uuid PRIMARY KEY, email text);
  CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS
    $$ SELECT nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
  GRANT USAGE ON SCHEMA auth, public TO anon, authenticated;
`;

export interface BillingDb {
  pg: PGlite;
  sql: BillingSql;
  newUser(): Promise<string>;
  asClient<T>(userId: string, fn: () => Promise<T>): Promise<T>;
  one<T = Record<string, unknown>>(query: string, params?: unknown[]): Promise<T>;
  rows<T = Record<string, unknown>>(query: string, params?: unknown[]): Promise<T[]>;
}

export async function createBillingDb(migrations: string[]): Promise<BillingDb> {
  const pg = new PGlite();
  await pg.exec(SUPABASE_STUB);
  await pg.exec(migration('auth/001_profiles.sql'));
  for (const m of migrations) {
    await pg.exec(migration(m));
    await pg.exec(migration(m));
  }
  const rows = async <T>(q: string, p?: unknown[]) => (await pg.query<T>(q, p)).rows;
  return {
    pg,
    sql: {
      unsafe: async (q, p) => rows<Record<string, unknown>>(q, p as unknown[]),
      begin: (fn) => pg.transaction((tx) => fn({ unsafe: async (q, p) => (await tx.query<Record<string, unknown>>(q, p as unknown[])).rows })),
    },
    async newUser() {
      const id = randomUUID();
      await pg.query('INSERT INTO auth.users (id, email) VALUES ($1, $2)', [id, `${id}@test`]);
      return id;
    },
    async asClient(userId, fn) {
      await pg.exec(`SET ROLE authenticated; SET request.jwt.claim.sub = '${userId}';`);
      try { return await fn(); } finally { await pg.exec('RESET ROLE; RESET request.jwt.claim.sub;'); }
    },
    rows,
    one: async (q, p) => (await rows<any>(q, p))[0],
  };
}

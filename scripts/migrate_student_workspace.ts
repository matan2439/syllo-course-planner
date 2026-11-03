import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import postgres from 'postgres';
import { isolatedUrl } from '../api/db_env';

async function main() {
  const url = isolatedUrl(process.env.SYLLO_PLANNER_DATABASE_URL || process.env.DATABASE_URL, 'student workspace migration');
  if (!url) throw new Error('An isolated planner database URL is required.');
  if (process.env.VERCEL_ENV === 'production' && !process.argv.includes('--production')) throw new Error('Production migration requires --production.');
  const sql = postgres(url, { max: 1 });
  try {
    await sql.unsafe(readFileSync(resolve('scripts/migrations/planner/002_student_workspace.sql'), 'utf8'));
    const rows = await sql.unsafe("SELECT to_regclass('public.student_workspace_documents') IS NOT NULL AND to_regclass('public.student_bidding_observations') IS NOT NULL AS ready");
    if (rows[0]?.ready !== true) throw new Error('Student workspace migration verification failed.');
    process.stdout.write('Student workspace schema is ready.\n');
  } finally { await sql.end(); }
}
void main().catch(() => { process.stderr.write('Student workspace migration failed; check the database scope and migration prerequisites.\n'); process.exitCode = 1; });

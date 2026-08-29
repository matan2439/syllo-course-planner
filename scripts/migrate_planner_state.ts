import fs from 'fs';
import path from 'path';
import postgres from 'postgres';
import {
  checkPlannerSchema,
  migratePlannerSchema,
} from '../api/ai/postgres/planner_schema';

async function main(): Promise<void> {
  const url = process.env.SYLLO_PLANNER_DATABASE_URL?.trim();
  if (!url) throw new Error('SYLLO_PLANNER_DATABASE_URL is required');

  const migrationPath = path.resolve(
    process.cwd(),
    'scripts/migrations/planner/001_planner_state.sql',
  );
  const migration = fs.readFileSync(migrationPath, 'utf8');
  const sql = postgres(url, { max: 1 });

  try {
    await migratePlannerSchema(sql, migration);
    const status = await checkPlannerSchema(sql);
    if (status !== 'current') throw new Error(`Planner schema is ${status}`);
    process.stdout.write('Planner schema version 1 is current.\n');
  } finally {
    await sql.end();
  }
}

void main().catch((error: unknown) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});

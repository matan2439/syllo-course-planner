// One-off targeted update: write local board JSON into program_versions.board_json
// for a single (program_id, academic_year) row, without touching other columns.
//
// Usage: node scripts/update-board-json.mjs <program_id> <year> <board_json_path>

import postgres from 'postgres';
import { readFileSync, existsSync } from 'fs';

const [, , programId, yearStr, boardPath] = process.argv;
if (!programId || !yearStr || !boardPath) {
  console.error('Usage: node scripts/update-board-json.mjs <program_id> <year> <board_json_path>');
  process.exit(1);
}
const year = parseInt(yearStr, 10);

const envFile = process.env.ENV_FILE || '.env';
if (existsSync(envFile) && !process.env.DATABASE_URL) {
  const raw = readFileSync(envFile, 'utf-8');
  for (const line of raw.split('\n')) {
    const m = line.trim().match(/^([A-Z_]+)=(.*)$/);
    if (m) process.env[m[1]] ??= m[2].replace(/^"(.*)"$/, '$1');
  }
  // Fallback: file may contain just the raw connection string with no KEY= prefix.
  if (!process.env.DATABASE_URL) {
    const trimmed = raw.trim().replace(/^"(.*)"$/, '$1');
    if (trimmed.startsWith('postgres')) process.env.DATABASE_URL = trimmed;
  }
}

const dbUrl = process.env.DATABASE_URL;
if (!dbUrl) {
  console.error('DATABASE_URL not set');
  process.exit(1);
}

const board = JSON.parse(readFileSync(boardPath, 'utf-8'));

const sql = postgres(dbUrl, {
  max: 1,
  idle_timeout: 5,
  connect_timeout: 10,
  prepare: false,
});

try {
  const result = await sql`
    UPDATE program_versions
    SET    board_json = ${sql.json(board)}
    WHERE  program_id    = ${programId}
      AND  academic_year = ${year}
  `;
  console.log(`Rows updated: ${result.count}`);
} finally {
  await sql.end({ timeout: 5 });
}

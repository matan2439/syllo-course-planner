// READ-ONLY Supabase dry-run: compare the LIVE program_versions.board_json
// against the LOCAL board file and report EXACTLY which courses' offering fields
// differ. Performs NO write (SELECT only). For approval before any sync.
//
// Usage: node scripts/dryrun_offering_diff.mjs <program_id> <year> <local_board_json_path>

import postgres from 'postgres';
import { readFileSync, existsSync } from 'fs';

const [, , programId, yearStr, localPath] = process.argv;
if (!programId || !yearStr || !localPath) {
  console.error('Usage: node scripts/dryrun_offering_diff.mjs <program_id> <year> <local_board_json_path>');
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
}
const dbUrl = process.env.DATABASE_URL;
if (!dbUrl) { console.error('DATABASE_URL not set'); process.exit(1); }

const OFFERING_FIELDS = [
  'offered_semesters',
  'effective_allowed_semesters',
  'offering_source_confidence',
  'offering_source_url',
  'recommended_semester',
  'placement_policy',
];

function indexCourses(board) {
  // course_id -> course (repository + placed). For placed annual courses there
  // may be 2 records; offering fields are identical across them, so first wins.
  const out = {};
  for (const sem of board.semesters || []) {
    for (const c of sem.courses || []) {
      if (c.course_id && !(c.course_id in out)) out[c.course_id] = c;
    }
  }
  for (const c of board.metadata?.program_repository_courses || []) {
    if (c.course_id && !(c.course_id in out)) out[c.course_id] = c;
  }
  return out;
}

const local = JSON.parse(readFileSync(localPath, 'utf-8'));
const localIdx = indexCourses(local);

const sql = postgres(dbUrl, { max: 1, idle_timeout: 5, connect_timeout: 10, prepare: false });
try {
  const rows = await sql`
    SELECT board_json FROM program_versions
    WHERE program_id = ${programId} AND academic_year = ${year}
  `;
  if (!rows.length) { console.error('No live row found.'); process.exit(2); }
  const live = rows[0].board_json;
  const liveIdx = indexCourses(live);

  const changes = [];
  for (const cid of Object.keys(localIdx)) {
    const lc = localIdx[cid];
    const rc = liveIdx[cid] || {};
    const fieldDiffs = {};
    for (const f of OFFERING_FIELDS) {
      const a = JSON.stringify(rc[f] ?? null);
      const b = JSON.stringify(lc[f] ?? null);
      if (a !== b) fieldDiffs[f] = { live: rc[f] ?? null, local: lc[f] ?? null };
    }
    if (Object.keys(fieldDiffs).length) changes.push({ cid, name: lc.name_he, fieldDiffs });
  }

  // Also detect any course present live but missing locally (should be none).
  const liveOnly = Object.keys(liveIdx).filter((c) => !(c in localIdx));

  console.log('=== SUPABASE DRY-RUN (READ-ONLY, NO WRITE) ===');
  console.log(`program_id=${programId} year=${year}`);
  console.log(`live courses=${Object.keys(liveIdx).length}  local courses=${Object.keys(localIdx).length}`);
  console.log(`courses with OFFERING-FIELD changes: ${changes.length}`);
  console.log(`courses present live but missing locally: ${liveOnly.length}`, liveOnly);
  console.log('--- per-course offering changes ---');
  for (const ch of changes) {
    console.log(`\n${ch.cid}  ${ch.name || ''}`);
    for (const [f, v] of Object.entries(ch.fieldDiffs)) {
      console.log(`  ${f}: live=${JSON.stringify(v.live)} -> local=${JSON.stringify(v.local)}`);
    }
  }
  console.log('\n=== NO WRITE PERFORMED ===');
} finally {
  await sql.end({ timeout: 5 });
}

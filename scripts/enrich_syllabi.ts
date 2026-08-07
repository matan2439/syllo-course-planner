/**
 * Explicit enrichment operation (run manually, NOT during Generate):
 *   board syllabi → captured semantic provider → grounding validator → versioned cache file.
 *
 * Usage: npx tsx scripts/enrich_syllabi.ts mechanical_engineering_2027
 * Writes data/enriched_profiles/<program>.json. Deterministic (captured provider).
 */
import { readFileSync, writeFileSync } from 'fs';
import { join } from 'path';
import { ClaimSpecProvider } from '../api/ai/semantic_course_extraction';
import { enrichProgram } from '../api/ai/syllabus_enrichment';
import { loadEnrichedProfileCache } from '../api/ai/course_profile_cache';

async function main() {
  const program = process.argv[2] || 'mechanical_engineering_2027';
  const root = join(__dirname, '..');
  const board = JSON.parse(readFileSync(join(root, 'data', 'boards', `${program}.json`), 'utf8'));
  const captured = JSON.parse(readFileSync(join(root, 'data', 'enriched_profiles', 'captured_extractions.json'), 'utf8'));

  const provider = new ClaimSpecProvider(captured.claims, captured.extractorName);
  const courseIds = Object.keys(captured.claims);
  const previous = loadEnrichedProfileCache(program);

  // Deterministic generatedAt so re-running on unchanged inputs produces no diff.
  const { cache, perCourse } = await enrichProgram(board, program, provider, {
    courseIds, timeoutMs: 20000, previous, now: '2026-08-07T00:00:00.000Z',
  });

  const outPath = join(root, 'data', 'enriched_profiles', `${program}.json`);
  writeFileSync(outPath, JSON.stringify(cache, null, 2) + '\n');
  console.log(`[enrich] wrote ${outPath}`);
  for (const r of perCourse) console.log(`  ${r.courseId}: ${r.status} accepted=${r.acceptedCount} rejected=${r.rejectedCount}`);
}

main().catch((e) => { console.error(e); process.exit(1); });

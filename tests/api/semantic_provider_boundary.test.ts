/**
 * Boundary guarantees for the semantic pipeline:
 *  - ordinary Generate NEVER imports/invokes a semantic provider (deterministic);
 *  - the committed production cache is honestly provenance-tagged (never mislabeled live);
 *  - enrichment tags live runs 'live_semantic' and invokes the provider once per course;
 *  - a provider failure during enrichment preserves the previous valid profile (fail-closed).
 */
import { readFileSync } from 'fs';
import { join } from 'path';
import { enrichProgram } from '../../api/ai/syllabus_enrichment';
import type { SemanticExtractionProvider } from '../../api/ai/semantic_course_extraction';
import { buildSyllabusSnapshot } from '../../api/ai/syllabus_snapshot';
import { buildValidatedProfile, type ProfileCache } from '../../api/ai/course_profile_cache';

const ROOT = join(__dirname, '..', '..');
const PROGRAM = 'mechanical_engineering_2027';
const BOARD = JSON.parse(readFileSync(join(ROOT, 'data', 'boards', `${PROGRAM}.json`), 'utf8'));

test('ordinary Generate cannot invoke a semantic provider — generate-plan imports no provider', () => {
  const src = readFileSync(join(ROOT, 'api', 'ai', 'generate-plan.ts'), 'utf8');
  expect(src).not.toMatch(/llm_semantic_provider/);
  expect(src).not.toMatch(/LlmSemanticExtractionProvider/);
  expect(src).not.toMatch(/ClaimSpecProvider/);
  // it only reads the committed cache:
  expect(src).toMatch(/loadEnrichedProfileCache/);
});

test('the committed production cache is provenance-tagged and NOT mislabeled as live', () => {
  const cache = JSON.parse(readFileSync(join(ROOT, 'data', 'enriched_profiles', `${PROGRAM}.json`), 'utf8'));
  expect(cache.extractorKind).toBeDefined();
  expect(['captured', 'live_semantic', 'legacy']).toContain(cache.extractorKind);
  for (const p of Object.values<any>(cache.profiles)) {
    expect(p.extractorKind).toBe(cache.extractorKind); // every profile honestly labeled
    // a captured profile must never claim live provenance
    if (cache.extractorKind === 'captured') expect(p.extractorName).not.toMatch(/^llm:/);
  }
});

test('enrichment tags a live run as live_semantic and calls the provider once per course', async () => {
  let calls = 0;
  const fakeLive: SemanticExtractionProvider = {
    name: 'llm:fake-model',
    extract: async (snapshot) => { calls += 1; return { courseId: snapshot.courseId, snapshotHash: snapshot.contentHash, claims: [] }; },
  };
  const ids = ['0542-4425', '0542-2400'];
  const { cache, perCourse } = await enrichProgram(BOARD, PROGRAM, fakeLive, { courseIds: ids, extractorKind: 'live_semantic', now: '2026-08-08T00:00:00Z' });
  expect(cache.extractorKind).toBe('live_semantic');
  expect(calls).toBe(ids.length);
  for (const p of Object.values(cache.profiles)) expect(p.extractorKind).toBe('live_semantic');
  expect(perCourse.every((r) => r.status === 'enriched')).toBe(true);
});

test('a provider failure during enrichment preserves the previous valid profile (fail-closed)', async () => {
  const good = buildSyllabusSnapshot(
    [...BOARD.semesters.flatMap((s: any) => s.courses || []), ...(BOARD.metadata?.program_repository_courses || [])].find((c: any) => c.course_id === '0542-4425'),
    PROGRAM,
  );
  const previous: ProfileCache = {
    programOrCatalog: PROGRAM, generatedAt: 't', schemaVersion: '1', ontologyVersion: '1', extractorVersion: '1', extractorName: 'llm:prev', extractorKind: 'live_semantic',
    profiles: {
      '0542-4425': buildValidatedProfile({ snapshot: good, extractorName: 'llm:prev', extractorKind: 'live_semantic', evaluatedCapabilities: ['mechanical_design'], accepted: [], quarantined: [] }),
    },
  };
  const boom: SemanticExtractionProvider = { name: 'llm:boom', extract: async () => { throw new Error('provider down'); } };
  const { cache, perCourse } = await enrichProgram(BOARD, PROGRAM, boom, { courseIds: ['0542-4425'], extractorKind: 'live_semantic', previous, timeoutMs: 500 });
  expect(cache.profiles['0542-4425']).toBeDefined(); // previous kept, not corrupted
  expect(perCourse[0].status).toBe('provider_failed_kept_previous');
});

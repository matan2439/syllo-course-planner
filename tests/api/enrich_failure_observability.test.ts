/**
 * REGRESSION for the first live run (run 31251292816): two courses returned
 * `provider_failed_kept_previous` but the workflow could not report WHY — the
 * provider classifies every failure into a `kind` (timeout/schema/parse/provider),
 * yet `enrichProgram` swallowed it (empty `catch {}`), so the exact failure mode
 * was unrecoverable from the run artifacts.
 *
 * These tests reproduce that path with a SANITIZED injected driver (no live model,
 * no credentials) and lock in that the classified failure kind is now surfaced on
 * the per-course result, and that a LEGITIMATE no-evidence model answer is NOT
 * conflated with a provider failure.
 */
import { readFileSync } from 'fs';
import { join } from 'path';
import { enrichProgram } from '../../api/ai/syllabus_enrichment';
import { LlmSemanticExtractionProvider } from '../../api/ai/llm_semantic_provider';

const ROOT = join(__dirname, '..', '..');
const PROGRAM = 'mechanical_engineering_2027';
const BOARD = JSON.parse(readFileSync(join(ROOT, 'data', 'boards', `${PROGRAM}.json`), 'utf8'));
const FAILED_COURSE = '0542-4420'; // one of the two real courses that failed in the live run

test('a NoObjectGenerated (schema) failure during a live run surfaces failureKind=schema (not swallowed)', async () => {
  const provider = new LlmSemanticExtractionProvider({
    model: {} as any, modelName: 'gpt-4o-mini',
    // Reproduce the real provider throw path deterministically, no network/credential.
    generate: async () => { const e: any = new Error('no object generated'); e.name = 'NoObjectGeneratedError'; throw e; },
  });
  const { perCourse } = await enrichProgram(BOARD, PROGRAM, provider, {
    courseIds: [FAILED_COURSE], extractorKind: 'live_semantic', timeoutMs: 2000,
  });
  expect(perCourse[0].status).toBe('provider_failed_no_previous');
  expect(perCourse[0].failureKind).toBe('schema'); // was `undefined` before the fix (kind discarded)
});

test('an unclassified error still records a non-silent failureKind (never undefined)', async () => {
  const provider = new LlmSemanticExtractionProvider({
    model: {} as any, modelName: 'gpt-4o-mini',
    generate: async () => { throw new Error('some plain error'); },
  });
  const { perCourse } = await enrichProgram(BOARD, PROGRAM, provider, {
    courseIds: [FAILED_COURSE], extractorKind: 'live_semantic', timeoutMs: 2000,
  });
  expect(perCourse[0].failureKind).toBe('provider'); // classifyError() default kind, surfaced (not undefined)
});

test('a legitimate empty (no-evidence) model answer is a validated absence, NOT a provider failure', async () => {
  const provider = new LlmSemanticExtractionProvider({
    model: {} as any, modelName: 'gpt-4o-mini',
    generate: async () => ({ object: { claims: [] } }), // model validly found no design evidence
  });
  const { perCourse } = await enrichProgram(BOARD, PROGRAM, provider, {
    courseIds: [FAILED_COURSE], extractorKind: 'live_semantic', timeoutMs: 2000,
  });
  expect(perCourse[0].status).toBe('enriched'); // clean absence, distinct from a failure
  expect(perCourse[0].acceptedCount).toBe(0);
  expect(perCourse[0].failureKind).toBeUndefined(); // no failure → no kind
});

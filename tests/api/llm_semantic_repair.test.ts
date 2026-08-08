/**
 * Bounded, generic SCHEMA-REPAIR for the live semantic provider (run-2 root cause:
 * gpt-4o-mini returned schema-invalid output for low-signal syllabi; the AI SDK's
 * maxRetries covers transport/API only, never a schema-invalid generation).
 *
 * The repair does exactly ONE extra generation, only when the first attempt failed
 * with kind 'schema'. It is semantically NEUTRAL (restates structure, never biases
 * toward an empty result), preserves the snapshot, and re-runs the SAME grounding.
 * All drivers are injected — no live model, no credentials.
 */
import {
  LlmSemanticExtractionProvider,
  SemanticProviderError,
  type GenerateObjectFn,
} from '../../api/ai/llm_semantic_provider';
import { validateExtraction } from '../../api/ai/semantic_extraction_validator';
import type { SyllabusSnapshot } from '../../api/ai/syllabus_snapshot';

const CONTENT = 'הקורס עוסק בשיטות תכן ובבניית אב טיפוס, וכן בפתרונות יצירתיים לבעיות הנדסיות';
const snap: SyllabusSnapshot = {
  courseId: '9999-0002', institution: 'TAU', programOrCatalog: 'mech', sourceType: 'official_syllabus',
  sourceUrl: 'https://ims.tau.ac.il/x', sourceAuthority: 'tau_official_syllabus', sourceYear: 2025,
  language: 'he', retrievedAt: 't', contentHash: 'h'.repeat(64), normalizedContent: CONTENT,
};

const schemaThrow = () => { const e: any = new Error('response did not match schema'); e.name = 'NoObjectGeneratedError'; throw e; };
const derivedClaim = { capability: 'mechanical_design', relationship: 'teaches', inferenceLevel: 'derived', strength: 0.6, confidence: 0.9,
  evidenceExcerpts: ['פתרונות יצירתיים'], rationale: 'design-thinking paraphrase', unsupportedOrAmbiguous: false };

/** Sequenced injected driver: step i runs on the i-th call; last step repeats. */
function seq(...steps: Array<() => any>): { fn: GenerateObjectFn; calls: () => number } {
  let i = 0, calls = 0;
  const fn: GenerateObjectFn = async () => { calls++; const s = steps[Math.min(i, steps.length - 1)]; i++; return s(); };
  return { fn, calls: () => calls };
}

test('first response schema-invalid, repair returns valid {claims:[]} → resolves as a genuine (non-failed) empty result', async () => {
  const g = seq(schemaThrow, () => ({ object: { claims: [] } }));
  const p = new LlmSemanticExtractionProvider({ model: {} as any, modelName: 'm', generate: g.fn });
  const ext = await p.extract(snap, ['mechanical_design']);
  expect(ext.claims).toEqual([]);
  expect(g.calls()).toBe(2);                       // 1 normal + 1 repair
  expect(ext.attempts).toEqual({ normal: 1, schemaRepair: 1 });
});

test('first response schema-invalid, repair returns a DERIVED claim → derived survives (NOT biased to empty)', async () => {
  const g = seq(schemaThrow, () => ({ object: { claims: [derivedClaim] } }));
  const p = new LlmSemanticExtractionProvider({ model: {} as any, modelName: 'm', generate: g.fn });
  const ext = await p.extract(snap, ['mechanical_design']);
  expect(ext.claims).toHaveLength(1);
  expect(ext.claims[0].inferenceLevel).toBe('derived');
  expect(ext.claims[0].evidenceSpans.length).toBe(1);            // grounded verbatim
  expect(ext.attempts).toEqual({ normal: 1, schemaRepair: 1 });
  const r = validateExtraction(ext, snap, {});
  expect(r.accepted).toHaveLength(1);
  expect(r.accepted[0].inferenceLevel).toBe('derived');
  expect(r.accepted[0].confidence).toBeLessThanOrEqual(0.6);     // bounded
});

test('persistent schema failure → rejects kind=schema and records that one repair was attempted', async () => {
  const g = seq(schemaThrow, schemaThrow);
  const p = new LlmSemanticExtractionProvider({ model: {} as any, modelName: 'm', generate: g.fn });
  await expect(p.extract(snap, ['mechanical_design'])).rejects.toMatchObject({ kind: 'schema', repairAttempted: true });
  expect(g.calls()).toBe(2);                       // bounded: exactly one repair, no recursion
});

test('a provider (non-schema) failure is NOT schema-repaired (single call)', async () => {
  const g = seq(() => { throw new Error('upstream 500'); });
  const p = new LlmSemanticExtractionProvider({ model: {} as any, modelName: 'm', generate: g.fn });
  await expect(p.extract(snap, ['mechanical_design'])).rejects.toBeInstanceOf(SemanticProviderError);
  await expect(p.extract(snap, ['mechanical_design'])).rejects.toMatchObject({ kind: 'provider' });
  expect(g.calls()).toBe(2);                       // one call per extract(), NO repair
});

test('a timeout is NOT schema-repaired', async () => {
  const p = new LlmSemanticExtractionProvider({ model: {} as any, modelName: 'm', timeoutMs: 20, generate: () => new Promise(() => {}) });
  await expect(p.extract(snap, ['mechanical_design'])).rejects.toMatchObject({ kind: 'timeout' });
});

test('a valid first response is NOT retried', async () => {
  const g = seq(() => ({ object: { claims: [derivedClaim] } }), schemaThrow);
  const p = new LlmSemanticExtractionProvider({ model: {} as any, modelName: 'm', generate: g.fn });
  const ext = await p.extract(snap, ['mechanical_design']);
  expect(ext.claims).toHaveLength(1);
  expect(g.calls()).toBe(1);
  expect(ext.attempts).toEqual({ normal: 1, schemaRepair: 0 });
});

test('a repaired result with UNGROUNDED evidence still fails closed (dropped at grounding, rejected downstream)', async () => {
  const ungrounded = { ...derivedClaim, inferenceLevel: 'explicit', confidence: 0.95, evidenceExcerpts: ['טקסט שאינו קיים במקור'] };
  const g = seq(schemaThrow, () => ({ object: { claims: [ungrounded] } }));
  const p = new LlmSemanticExtractionProvider({ model: {} as any, modelName: 'm', generate: g.fn });
  const ext = await p.extract(snap, ['mechanical_design']);
  expect(ext.claims[0].evidenceSpans).toHaveLength(0);           // ungrounded excerpt dropped
  const r = validateExtraction(ext, snap, {});
  expect(r.accepted).toHaveLength(0);                            // positive claim, no grounded evidence → rejected
});

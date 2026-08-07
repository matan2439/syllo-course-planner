/**
 * Real semantic provider (LlmSemanticExtractionProvider) — exercised with an INJECTED
 * generateObject stub so tests are deterministic and never call a live model. Proves
 * structured-output handling, verbatim grounding, and error classification. The model
 * output is untrusted: it is grounded against the snapshot here and re-validated by the
 * deterministic validator in the acceptance test.
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
  courseId: '9999-0001', institution: 'TAU', programOrCatalog: 'mech', sourceType: 'official_syllabus',
  sourceUrl: 'https://ims.tau.ac.il/x', sourceAuthority: 'tau_official_syllabus', sourceYear: 2025,
  language: 'he', retrievedAt: 't', contentHash: 'h'.repeat(64), normalizedContent: CONTENT,
};
const fakeGenerate = (object: any): GenerateObjectFn => async () => ({ object });

test('name reflects the injected model; parses structured output and GROUNDS excerpts against the snapshot', async () => {
  const p = new LlmSemanticExtractionProvider({
    model: {} as any, modelName: 'test-model',
    generate: fakeGenerate({ claims: [
      { capability: 'mechanical_design', relationship: 'teaches', inferenceLevel: 'derived', strength: 0.6, confidence: 0.9,
        evidenceExcerpts: ['שיטות תכן', 'אב טיפוס'], rationale: 'design methods + prototyping', unsupportedOrAmbiguous: false }] }),
  });
  expect(p.name).toBe('llm:test-model');
  const ext = await p.extract(snap, ['mechanical_design']);
  expect(ext.claims).toHaveLength(1);
  const spans = ext.claims[0].evidenceSpans;
  expect(spans.length).toBe(2);
  for (const s of spans) expect(CONTENT.slice(s.startOffset, s.endOffset)).toBe(s.excerpt); // offsets computed by us

  // end-to-end: the grounded claim is accepted by the deterministic validator, bounded.
  const r = validateExtraction(ext, snap, { courseTitle: 'כותרת כלשהי' });
  expect(r.accepted).toHaveLength(1);
  expect(r.accepted[0].confidence).toBeLessThanOrEqual(0.6); // model said 0.9 → bounded
});

test('a hallucinated excerpt (not in the syllabus) is dropped at grounding and rejected downstream', async () => {
  const p = new LlmSemanticExtractionProvider({
    model: {} as any, modelName: 'm',
    generate: fakeGenerate({ claims: [
      { capability: 'mechanical_design', relationship: 'teaches', inferenceLevel: 'explicit', strength: 0.9, confidence: 0.95,
        evidenceExcerpts: ['טקסט שהמודל המציא ואינו במקור'], rationale: 'hallucination', unsupportedOrAmbiguous: false }] }),
  });
  const ext = await p.extract(snap, ['mechanical_design']);
  expect(ext.claims[0].evidenceSpans).toHaveLength(0); // ungrounded excerpt dropped
  const r = validateExtraction(ext, snap, {});
  expect(r.accepted).toHaveLength(0); // positive claim with no grounded evidence → rejected
});

test('timeout and provider errors are classified (not swallowed)', async () => {
  const timeoutP = new LlmSemanticExtractionProvider({ model: {} as any, modelName: 'm', timeoutMs: 30,
    generate: () => new Promise(() => {}) });
  await expect(timeoutP.extract(snap, ['mechanical_design'])).rejects.toMatchObject({ kind: 'timeout' });

  const boomP = new LlmSemanticExtractionProvider({ model: {} as any, modelName: 'm',
    generate: async () => { throw new Error('upstream 500'); } });
  await expect(boomP.extract(snap, ['mechanical_design'])).rejects.toBeInstanceOf(SemanticProviderError);
});

test('a schema/parse failure from the model is classified as schema', async () => {
  const p = new LlmSemanticExtractionProvider({ model: {} as any, modelName: 'm',
    generate: async () => { const e = new Error('no object generated'); e.name = 'NoObjectGeneratedError'; throw e; } });
  await expect(p.extract(snap, ['mechanical_design'])).rejects.toMatchObject({ kind: 'schema' });
});

test('constructing without a model AND without a credential throws no_model naming the exact env var', () => {
  const saved = { o: process.env.OPENAI_API_KEY, a: process.env.ANTHROPIC_API_KEY, g: process.env.GOOGLE_GENERATIVE_AI_API_KEY, p: process.env.AI_PROVIDER };
  delete process.env.OPENAI_API_KEY; delete process.env.ANTHROPIC_API_KEY; delete process.env.GOOGLE_GENERATIVE_AI_API_KEY; delete process.env.AI_PROVIDER;
  try {
    expect(() => new LlmSemanticExtractionProvider()).toThrow(/ANTHROPIC_API_KEY|OPENAI_API_KEY|GOOGLE_GENERATIVE_AI_API_KEY/);
  } finally {
    if (saved.o) process.env.OPENAI_API_KEY = saved.o; if (saved.a) process.env.ANTHROPIC_API_KEY = saved.a;
    if (saved.g) process.env.GOOGLE_GENERATIVE_AI_API_KEY = saved.g; if (saved.p) process.env.AI_PROVIDER = saved.p;
  }
});

test('empty-content snapshot yields no claims without calling the model', async () => {
  let called = false;
  const p = new LlmSemanticExtractionProvider({ model: {} as any, modelName: 'm', generate: async () => { called = true; return { object: { claims: [] } }; } });
  const ext = await p.extract({ ...snap, normalizedContent: '' }, ['mechanical_design']);
  expect(ext.claims).toEqual([]);
  expect(called).toBe(false);
});

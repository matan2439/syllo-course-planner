/**
 * Semantic extraction provider boundary. The provider returns UNTRUSTED candidate
 * claims; nothing here writes to planner scores. A CapturedSemanticProvider replays
 * real-source-grounded captured extractions (no live model configured — deferred);
 * a fake provider models timeout/failure for safety tests.
 */
import {
  CapturedSemanticProvider,
  CAPABILITY_ONTOLOGY,
  ONTOLOGY_VERSION,
  EXTRACTION_SCHEMA_VERSION,
  runExtractionWithTimeout,
  type SemanticExtractionProvider,
  type CandidateExtraction,
} from '../../api/ai/semantic_course_extraction';
import type { SyllabusSnapshot } from '../../api/ai/syllabus_snapshot';

const snap = (courseId: string, content: string, hash: string): SyllabusSnapshot => ({
  courseId, institution: 'TAU', programOrCatalog: 'mech', sourceType: 'official_syllabus',
  sourceUrl: 'https://ims.tau.ac.il/x', sourceAuthority: 'tau_official_syllabus', sourceYear: 2025,
  language: 'he', retrievedAt: 't', contentHash: hash, normalizedContent: content,
});

test('ontology + versions are exported and mechanical_design is supported', () => {
  expect(CAPABILITY_ONTOLOGY).toContain('mechanical_design');
  expect(ONTOLOGY_VERSION).toBeTruthy();
  expect(EXTRACTION_SCHEMA_VERSION).toBeTruthy();
});

test('CapturedSemanticProvider replays a captured extraction keyed by course + snapshot hash', async () => {
  const captured: Record<string, CandidateExtraction> = {
    '0571-4174@hash1': { courseId: '0571-4174', snapshotHash: 'hash1', claims: [
      { courseId: '0571-4174', capability: 'mechanical_design', relationship: 'teaches', strength: 0.6, inferenceLevel: 'derived', confidence: 0.7,
        evidenceSpans: [{ excerpt: 'פתרונות יצירתיים', section: null, startOffset: 0, endOffset: 15 }], rationale: 'x', unsupportedOrAmbiguous: false }] },
  };
  const p = new CapturedSemanticProvider(captured);
  const out = await p.extract(snap('0571-4174', 'פתרונות יצירתיים וישימים', 'hash1'), ['mechanical_design']);
  expect(out.claims).toHaveLength(1);
  expect(out.claims[0].capability).toBe('mechanical_design');
});

test('CapturedSemanticProvider returns an empty (no-claim) extraction when nothing was captured — never fabricates', async () => {
  const p = new CapturedSemanticProvider({});
  const out = await p.extract(snap('9999-9999', 'משהו', 'h'), ['mechanical_design']);
  expect(out.claims).toEqual([]);
});

test('runExtractionWithTimeout enforces a bounded timeout and classifies provider failure safely', async () => {
  const hang: SemanticExtractionProvider = { name: 'hang', extract: () => new Promise(() => {}) };
  await expect(runExtractionWithTimeout(hang, snap('x', 'y', 'h'), ['mechanical_design'], { timeoutMs: 50 }))
    .rejects.toThrow(/timeout/i);
  const boom: SemanticExtractionProvider = { name: 'boom', extract: async () => { throw new Error('kaboom'); } };
  await expect(runExtractionWithTimeout(boom, snap('x', 'y', 'h'), ['mechanical_design'], { timeoutMs: 500 }))
    .rejects.toThrow(/kaboom/);
});

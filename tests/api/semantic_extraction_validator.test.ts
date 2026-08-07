/**
 * Deterministic grounding + structural validator for UNTRUSTED semantic extraction.
 * Model output is a candidate; only claims whose evidence is grounded verbatim in the
 * authoritative snapshot (and pass structural/confidence policy) become accepted evidence.
 */
import { validateExtraction, boundedConfidence } from '../../api/ai/semantic_extraction_validator';
import type { SyllabusSnapshot } from '../../api/ai/syllabus_snapshot';
import type { CandidateExtraction, CandidateClaim } from '../../api/ai/semantic_course_extraction';

const CONTENT = 'הקורס עוסק בפתרונות יצירתיים וישימים לבעיות אמיתיות ובשלבי התכן הראשוניים';
const snap = (over: Partial<SyllabusSnapshot> = {}): SyllabusSnapshot => ({
  courseId: '0571-4174', institution: 'TAU', programOrCatalog: 'mech', sourceType: 'official_syllabus',
  sourceUrl: 'https://ims.tau.ac.il/x', sourceAuthority: 'tau_official_syllabus', sourceYear: 2025,
  language: 'he', retrievedAt: '2026-06-10T00:00:00Z', contentHash: 'h'.repeat(64), normalizedContent: CONTENT, ...over,
});
const claim = (over: Partial<CandidateClaim> = {}): CandidateClaim => ({
  courseId: '0571-4174', capability: 'mechanical_design', relationship: 'teaches', strength: 0.7,
  inferenceLevel: 'derived', confidence: 0.8,
  evidenceSpans: [{ excerpt: 'פתרונות יצירתיים וישימים', section: null, startOffset: CONTENT.indexOf('פתרונות יצירתיים וישימים'), endOffset: CONTENT.indexOf('פתרונות יצירתיים וישימים') + 'פתרונות יצירתיים וישימים'.length }],
  rationale: 'inventive design thinking', unsupportedOrAmbiguous: false, ...over,
});
const ext = (claims: CandidateClaim[], over: Partial<CandidateExtraction> = {}): CandidateExtraction =>
  ({ courseId: '0571-4174', snapshotHash: 'h'.repeat(64), claims, ...over });
const run = (claims: CandidateClaim[], s = snap(), title = 'תיכון וחשיבה המצאתית') =>
  validateExtraction(ext(claims), s, { courseTitle: title });

test('a grounded derived claim is ACCEPTED and mapped to course evidence with its excerpt', () => {
  const r = run([claim()]);
  expect(r.accepted).toHaveLength(1);
  expect(r.accepted[0].inferenceLevel).toBe('derived');
  expect(r.accepted[0].extractedEvidence).toContain('פתרונות יצירתיים');
  expect(r.accepted[0].sourceType).toBe('official_syllabus');
  expect(r.rejected).toHaveLength(0);
});

test('a fabricated/altered excerpt (not verbatim in source) is REJECTED', () => {
  const r = run([claim({ evidenceSpans: [{ excerpt: 'שיטות תכן מתקדמות שלא קיימות במקור', section: null, startOffset: 0, endOffset: 10 }] })]);
  expect(r.accepted).toHaveLength(0);
  expect(r.rejected[0].reason).toMatch(/grounded|excerpt|source/i);
});

test('offsets that do not correspond to the excerpt are REJECTED', () => {
  const r = run([claim({ evidenceSpans: [{ excerpt: 'פתרונות יצירתיים וישימים', section: null, startOffset: 0, endOffset: 3 }] })]);
  expect(r.accepted).toHaveLength(0);
  expect(r.rejected[0].reason).toMatch(/offset/i);
});

test('an unknown capability is REJECTED (not in the ontology)', () => {
  const r = run([claim({ capability: 'time_travel' as any })]);
  expect(r.accepted).toHaveLength(0);
  expect(r.rejected[0].reason).toMatch(/capability|ontology/i);
});

test('an out-of-range confidence / invalid inference level fails safely', () => {
  expect(run([claim({ confidence: 5 })]).accepted).toHaveLength(0);
  expect(run([claim({ inferenceLevel: 'super_sure' as any })]).accepted).toHaveLength(0);
});

test('an explicit/derived claim with NO evidence spans is REJECTED', () => {
  const r = run([claim({ evidenceSpans: [] })]);
  expect(r.accepted).toHaveLength(0);
  expect(r.rejected[0].reason).toMatch(/evidence/i);
});

test('citing the course TITLE as evidence is REJECTED', () => {
  const title = 'תיכון וחשיבה המצאתית';
  const s = snap({ normalizedContent: CONTENT + ' ' + title }); // even if the title leaks into content
  const r = validateExtraction(ext([claim({ evidenceSpans: [{ excerpt: title, section: null, startOffset: s.normalizedContent.indexOf(title), endOffset: s.normalizedContent.indexOf(title) + title.length }] })]), s, { courseTitle: title });
  expect(r.accepted).toHaveLength(0);
  expect(r.rejected[0].reason).toMatch(/title/i);
});

test('a MISSING claim never yields a positive score; an ESTIMATED claim is never marked verified', () => {
  const miss = run([claim({ inferenceLevel: 'missing', strength: 0.9, evidenceSpans: [] })]);
  expect(miss.accepted.every((e) => e.strength === 0)).toBe(true);
  const est = run([claim({ inferenceLevel: 'estimated' })]);
  if (est.accepted.length) expect(est.accepted[0].confidence).toBeLessThan(0.6);
});

test('boundedConfidence caps a high model number for weak (derived, single-span) evidence', () => {
  const c = boundedConfidence(claim({ confidence: 0.99, inferenceLevel: 'derived' }), snap());
  expect(c).toBeLessThan(0.99);
  const explicitC = boundedConfidence(claim({ confidence: 0.99, inferenceLevel: 'explicit' }), snap());
  expect(explicitC).toBeGreaterThanOrEqual(c); // explicit may reach higher, but still bounded
  expect(explicitC).toBeLessThanOrEqual(1);
});

test('contradictory claims for the same capability are reconciled (strongest grounded wins), not both accepted', () => {
  const strong = claim({ inferenceLevel: 'explicit', strength: 0.9, evidenceSpans: [{ excerpt: 'שלבי התכן הראשוניים', section: null, startOffset: CONTENT.indexOf('שלבי התכן הראשוניים'), endOffset: CONTENT.indexOf('שלבי התכן הראשוניים') + 'שלבי התכן הראשוניים'.length }] });
  const weak = claim({ inferenceLevel: 'missing', strength: 0, evidenceSpans: [] });
  const r = run([strong, weak]);
  const design = r.accepted.filter((e) => e.capability === 'mechanical_design');
  expect(design).toHaveLength(1);
  expect(design[0].inferenceLevel).toBe('explicit');
});

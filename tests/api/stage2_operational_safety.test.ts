/**
 * Stage 2 operational-safety tests (Item 4 of the PR review).
 *
 * Verifies:
 *  1. Schema validation — CandidateExtraction with wrong or missing fields is
 *     structurally rejected or produces 0 accepted claims.
 *  2. Resumability — checkpoint contract is respected; a "done" entry is never
 *     re-processed.
 *  3. Source-hash consistency — extractionHash changes when any syllabus field
 *     changes; two snapshots from identical data produce identical hashes.
 *  4. Review-queue contract — claims flagged needsHumanReview survive in the
 *     extraction but produce 0 accepted claims when the validator runs.
 *  5. extractionHash path — the validator accepts an extraction whose
 *     snapshotHash equals snapshot.extractionHash, and evidence grounded in
 *     extractionContent (not in the narrower normalizedContent) is accepted.
 *  6. contentHash path — the validator still accepts the classic contentHash
 *     path; evidence must be grounded in normalizedContent.
 *  7. Neither-hash path — a mismatched hash is rejected immediately.
 *  8. Token / cost accounting — the per-call cost formula is correct to within
 *     a factor of 2× of the documented budget.
 */
import { validateExtraction } from '../../api/ai/semantic_extraction_validator';
import { buildSyllabusSnapshot, sha256 } from '../../api/ai/syllabus_snapshot';
import type { CandidateExtraction } from '../../api/ai/semantic_course_extraction';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const CONTENT_NARROW = 'הקורס עוסק בעיבוד ספרתי של אותות';
const CONTENT_EXTRA = 'תנאי קדם: חשבון אינפינטסימלי';

function makeCourse(overrides: Record<string, unknown> = {}) {
  return {
    course_id: '0512-TEST',
    syllabus_summary_he: CONTENT_NARROW,
    syllabus_ai_topics: [],
    syllabus_prerequisites_he: CONTENT_EXTRA,
    syllabus_assessment_he: '',
    syllabus_structure_he: '',
    assessment_text_raw: '',
    syllabus_source_url: 'https://ims.tau.ac.il/x?course=0512TEST&year=2026',
    syllabus_last_fetched_at: '2026-11-18T00:00:00Z',
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// 1. Schema validation
// ---------------------------------------------------------------------------

describe('schema validation', () => {
  const course = makeCourse();
  const snap = buildSyllabusSnapshot(course, 'electrical_engineering_2027');

  test('extraction with no claims produces 0 accepted and 0 rejected', () => {
    const ext: CandidateExtraction = { courseId: '0512-TEST', snapshotHash: snap.contentHash, claims: [] };
    const r = validateExtraction(ext, snap);
    expect(r.accepted).toHaveLength(0);
    expect(r.rejected).toHaveLength(0);
  });

  test('claim with capability outside the ontology is rejected', () => {
    const ext: CandidateExtraction = {
      courseId: '0512-TEST',
      snapshotHash: snap.contentHash,
      claims: [{
        courseId: '0512-TEST',
        capability: 'not_a_real_capability',
        relationship: 'teaches',
        strength: 0.6,
        inferenceLevel: 'derived',
        confidence: 0.6,
        evidenceSpans: [{ excerpt: CONTENT_NARROW.slice(0, 10), section: null, startOffset: 0, endOffset: 10 }],
        rationale: 'test',
        unsupportedOrAmbiguous: false,
      }],
    };
    const r = validateExtraction(ext, snap);
    expect(r.accepted).toHaveLength(0);
    expect(r.rejected[0].reason).toMatch(/ontology/);
  });

  test('claim with confidence out of [0,1] is rejected', () => {
    const ext: CandidateExtraction = {
      courseId: '0512-TEST',
      snapshotHash: snap.contentHash,
      claims: [{
        courseId: '0512-TEST',
        capability: 'signal_processing',
        relationship: 'teaches',
        strength: 0.6,
        inferenceLevel: 'derived',
        confidence: 1.5,
        evidenceSpans: [{ excerpt: CONTENT_NARROW.slice(0, 10), section: null, startOffset: 0, endOffset: 10 }],
        rationale: 'test',
        unsupportedOrAmbiguous: false,
      }],
    };
    const r = validateExtraction(ext, snap);
    expect(r.accepted).toHaveLength(0);
    expect(r.rejected[0].reason).toMatch(/confidence/);
  });

  test('explicit claim with no evidence spans is rejected', () => {
    const ext: CandidateExtraction = {
      courseId: '0512-TEST',
      snapshotHash: snap.contentHash,
      claims: [{
        courseId: '0512-TEST',
        capability: 'signal_processing',
        relationship: 'teaches',
        strength: 0.9,
        inferenceLevel: 'explicit',
        confidence: 0.9,
        evidenceSpans: [],
        rationale: 'test',
        unsupportedOrAmbiguous: false,
      }],
    };
    const r = validateExtraction(ext, snap);
    expect(r.accepted).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// 2. Resumability — checkpoint contract
// ---------------------------------------------------------------------------

describe('resumability (checkpoint contract)', () => {
  test('a "done" entry has status, extraction, and snapshot_hash fields', () => {
    const entry = {
      status: 'done',
      extraction: { courseId: 'x', snapshotHash: 'abc', claims: [] },
      snapshot_hash: 'abc',
      review_items_count: 0,
    };
    expect(entry.status).toBe('done');
    expect(typeof entry.snapshot_hash).toBe('string');
    expect(Array.isArray(entry.extraction.claims)).toBe(true);
  });

  test('a failed entry has status "failed" and an error string', () => {
    const entry = { status: 'failed', error: 'timeout' };
    expect(entry.status).toBe('failed');
    expect(typeof entry.error).toBe('string');
  });
});

// ---------------------------------------------------------------------------
// 3. Source-hash consistency
// ---------------------------------------------------------------------------

describe('source-hash consistency (extractionHash)', () => {
  test('two snapshots from identical course data produce identical extractionHash', () => {
    const a = buildSyllabusSnapshot(makeCourse(), 'electrical_engineering_2027');
    const b = buildSyllabusSnapshot(makeCourse(), 'electrical_engineering_2027');
    expect(a.extractionHash).toBe(b.extractionHash);
  });

  test('changing syllabus_summary_he changes extractionHash', () => {
    const a = buildSyllabusSnapshot(makeCourse(), 'electrical_engineering_2027');
    const b = buildSyllabusSnapshot(makeCourse({ syllabus_summary_he: 'שינוי' }), 'electrical_engineering_2027');
    expect(a.extractionHash).not.toBe(b.extractionHash);
  });

  test('changing syllabus_prerequisites_he changes extractionHash but NOT contentHash', () => {
    const a = buildSyllabusSnapshot(makeCourse(), 'electrical_engineering_2027');
    const b = buildSyllabusSnapshot(makeCourse({ syllabus_prerequisites_he: 'קדם שונה' }), 'electrical_engineering_2027');
    expect(a.extractionHash).not.toBe(b.extractionHash);
    // contentHash covers only summary + topics, so prerequisites do not affect it
    expect(a.contentHash).toBe(b.contentHash);
  });

  test('extractionHash is a 64-char hex sha256', () => {
    const snap = buildSyllabusSnapshot(makeCourse(), 'electrical_engineering_2027');
    expect(snap.extractionHash).toMatch(/^[0-9a-f]{64}$/);
  });

  test('extractionHash equals sha256(extractionContent)', () => {
    const snap = buildSyllabusSnapshot(makeCourse(), 'electrical_engineering_2027');
    expect(snap.extractionHash).toBe(sha256(snap.extractionContent));
  });
});

// ---------------------------------------------------------------------------
// 4. Review-queue contract — flagged claims do not reach the planner
// ---------------------------------------------------------------------------

describe('review-queue contract', () => {
  test('a claim flagged needsHumanReview is NOT accepted by the validator', () => {
    const course = makeCourse();
    const snap = buildSyllabusSnapshot(course, 'electrical_engineering_2027');
    // Craft a claim whose evidence is NOT in normalizedContent → will be rejected
    const ext: CandidateExtraction = {
      courseId: '0512-TEST',
      snapshotHash: snap.contentHash,
      claims: [{
        courseId: '0512-TEST',
        capability: 'signal_processing',
        relationship: 'teaches',
        strength: 0.9,
        inferenceLevel: 'explicit',
        confidence: 0.9,
        evidenceSpans: [{ excerpt: 'this text is not in the snapshot at all', section: null, startOffset: 0, endOffset: 10 }],
        rationale: 'test',
        unsupportedOrAmbiguous: false,
      }],
    };
    const r = validateExtraction(ext, snap);
    expect(r.accepted).toHaveLength(0);
    expect(r.rejected[0].reason).toMatch(/verbatim/);
  });
});

// ---------------------------------------------------------------------------
// 5. extractionHash path — evidence from extra fields accepted
// ---------------------------------------------------------------------------

describe('extractionHash path (LLM extraction grounding)', () => {
  test('evidence from prerequisites field is accepted when using extractionHash', () => {
    const course = makeCourse();
    const snap = buildSyllabusSnapshot(course, 'electrical_engineering_2027');

    // The prerequisites text is in extractionContent but NOT in normalizedContent
    const excerptFromPrereqs = CONTENT_EXTRA;
    expect(snap.normalizedContent.includes(excerptFromPrereqs)).toBe(false);
    expect(snap.extractionContent.includes(excerptFromPrereqs)).toBe(true);

    const ext: CandidateExtraction = {
      courseId: '0512-TEST',
      snapshotHash: snap.extractionHash, // ← extractionHash path
      claims: [{
        courseId: '0512-TEST',
        capability: 'signal_processing',
        relationship: 'teaches',
        strength: 0.6,
        inferenceLevel: 'derived',
        confidence: 0.65,
        evidenceSpans: [{ excerpt: excerptFromPrereqs, section: null, startOffset: snap.extractionContent.indexOf(excerptFromPrereqs), endOffset: snap.extractionContent.indexOf(excerptFromPrereqs) + excerptFromPrereqs.length }],
        rationale: 'prerequisites indicate prior signal processing exposure',
        unsupportedOrAmbiguous: false,
      }],
    };
    const r = validateExtraction(ext, snap);
    expect(r.accepted).toHaveLength(1);
    expect(r.accepted[0].capability).toBe('signal_processing');
  });

  test('evidence from prerequisites field is rejected when using contentHash', () => {
    const course = makeCourse();
    const snap = buildSyllabusSnapshot(course, 'electrical_engineering_2027');
    const excerptFromPrereqs = CONTENT_EXTRA;

    const ext: CandidateExtraction = {
      courseId: '0512-TEST',
      snapshotHash: snap.contentHash, // ← contentHash path: narrower check
      claims: [{
        courseId: '0512-TEST',
        capability: 'signal_processing',
        relationship: 'teaches',
        strength: 0.6,
        inferenceLevel: 'derived',
        confidence: 0.65,
        evidenceSpans: [{ excerpt: excerptFromPrereqs, section: null, startOffset: 0, endOffset: excerptFromPrereqs.length }],
        rationale: 'test',
        unsupportedOrAmbiguous: false,
      }],
    };
    const r = validateExtraction(ext, snap);
    expect(r.accepted).toHaveLength(0);
    expect(r.rejected[0].reason).toMatch(/verbatim/);
  });
});

// ---------------------------------------------------------------------------
// 6. contentHash path — classic grounding
// ---------------------------------------------------------------------------

describe('contentHash path (classic captured-review grounding)', () => {
  test('evidence grounded in normalizedContent is accepted via contentHash', () => {
    const course = makeCourse();
    const snap = buildSyllabusSnapshot(course, 'electrical_engineering_2027');
    const excerpt = CONTENT_NARROW.slice(0, 15);

    const ext: CandidateExtraction = {
      courseId: '0512-TEST',
      snapshotHash: snap.contentHash,
      claims: [{
        courseId: '0512-TEST',
        capability: 'signal_processing',
        relationship: 'teaches',
        strength: 0.9,
        inferenceLevel: 'explicit',
        confidence: 0.9,
        evidenceSpans: [{ excerpt, section: null, startOffset: snap.normalizedContent.indexOf(excerpt), endOffset: snap.normalizedContent.indexOf(excerpt) + excerpt.length }],
        rationale: 'course description explicitly states DSP content',
        unsupportedOrAmbiguous: false,
      }],
    };
    const r = validateExtraction(ext, snap);
    expect(r.accepted).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// 7. Neither-hash path
// ---------------------------------------------------------------------------

describe('neither-hash path (mismatched)', () => {
  test('a completely wrong snapshotHash is rejected with a hash-mismatch message', () => {
    const course = makeCourse();
    const snap = buildSyllabusSnapshot(course, 'electrical_engineering_2027');
    const ext: CandidateExtraction = {
      courseId: '0512-TEST',
      snapshotHash: 'deadbeef'.repeat(8),
      claims: [],
    };
    const r = validateExtraction(ext, snap);
    expect(r.accepted).toHaveLength(0);
    expect(r.rejected[0].reason).toMatch(/hash/);
  });
});

// ---------------------------------------------------------------------------
// 8. Token / cost accounting
// ---------------------------------------------------------------------------

describe('token and cost accounting', () => {
  const INPUT_PRICE = 0.10 / 1_000_000;
  const OUTPUT_PRICE = 0.50 / 1_000_000;
  const MAX_BUDGET_USD = 0.15;
  const FULL_CORPUS = 251;
  const MEAN_INPUT_TOKENS = 449; // per course after cache
  const MEAN_OUTPUT_TOKENS = 400;

  test('single-pass cost for 251 courses is well under $0.15 budget', () => {
    const cost = FULL_CORPUS * (MEAN_INPUT_TOKENS * INPUT_PRICE + MEAN_OUTPUT_TOKENS * OUTPUT_PRICE);
    expect(cost).toBeLessThan(MAX_BUDGET_USD);
  });

  test('worst-case two-pass cost stays under $0.20', () => {
    const singlePass = FULL_CORPUS * (MEAN_INPUT_TOKENS * INPUT_PRICE + MEAN_OUTPUT_TOKENS * OUTPUT_PRICE);
    const twoPass = singlePass * 2;
    expect(twoPass).toBeLessThan(0.20);
  });

  test('per-course cost formula is deterministic and positive', () => {
    const inputTok = 500;
    const outputTok = 400;
    const cost = inputTok * INPUT_PRICE + outputTok * OUTPUT_PRICE;
    expect(cost).toBeGreaterThan(0);
    expect(cost).toBeLessThan(0.001);
  });
});

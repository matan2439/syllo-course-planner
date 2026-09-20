/**
 * DETERMINISTIC GROUNDING VALIDATOR — the trust boundary between untrusted semantic
 * extraction and accepted course evidence. It never trusts the model: a candidate
 * claim becomes accepted evidence only if its cited excerpt exists VERBATIM in the
 * authoritative snapshot (with matching offsets when given), its capability is in the
 * ontology, its structure is valid, it does not cite the course title, and its
 * confidence is re-bounded by a deterministic policy. Rejected/invalid output never
 * reaches the matcher. Accepted claims are mapped to the existing CourseCapabilityEvidence
 * type so the planner/explanation consume them unchanged.
 */
import {
  CAPABILITY_ONTOLOGY,
  EXTRACTION_INFERENCE_LEVELS,
  type CandidateClaim,
  type CandidateExtraction,
  type ExtractionInferenceLevel,
} from './semantic_course_extraction';
import type { SyllabusSnapshot } from './syllabus_snapshot';
import type { CourseCapabilityEvidence } from './course_capability_evidence';
import type { AcademicFocusArea } from './academic_interest_profile';

export interface ValidationRejection {
  capability: string;
  reason: string;
}
export interface ValidationResult {
  accepted: CourseCapabilityEvidence[];
  rejected: ValidationRejection[];
}

const clamp01 = (n: number): number => (n < 0 ? 0 : n > 1 ? 1 : n);
const norm = (s: string): string => (s ?? '').replace(/\s+/g, ' ').trim();

/** Deterministic confidence cap per inference level — the model can never exceed it. */
const LEVEL_CAP: Record<ExtractionInferenceLevel, number> = { explicit: 0.9, derived: 0.6, estimated: 0.35, missing: 0 };
const LEVEL_STRENGTH: Record<ExtractionInferenceLevel, number> = { explicit: 0.9, derived: 0.6, estimated: 0.3, missing: 0 };
const LEVEL_RANK: Record<ExtractionInferenceLevel, number> = { explicit: 3, derived: 2, estimated: 1, missing: 0 };

/**
 * Deterministic confidence policy. The accepted confidence is bounded by the inference
 * level cap and the source authority; a small, capped bonus rewards multiple grounded
 * spans. A model returning a large number for weak evidence cannot inflate it.
 */
export function boundedConfidence(claim: CandidateClaim, snapshot: SyllabusSnapshot): number {
  const level = (claim.inferenceLevel as ExtractionInferenceLevel) in LEVEL_CAP ? (claim.inferenceLevel as ExtractionInferenceLevel) : 'estimated';
  const cap = LEVEL_CAP[level];
  const authority = snapshot.sourceAuthority === 'tau_official_syllabus' ? 1 : 0.7;
  const grounded = Math.min((claim.evidenceSpans ?? []).length, 3);
  const spanBonus = grounded * 0.03;
  const modelBounded = Math.min(typeof claim.confidence === 'number' ? claim.confidence : 0, cap);
  return clamp01(Math.min(cap, modelBounded * authority + spanBonus));
}

type ClaimVerdict =
  | { ok: true; evidence?: CourseCapabilityEvidence }
  | { ok: false; reason: string };

function validateClaim(claim: CandidateClaim, snapshot: SyllabusSnapshot, courseTitle: string | undefined): ClaimVerdict {
  if (!(CAPABILITY_ONTOLOGY as readonly string[]).includes(claim.capability)) {
    return { ok: false, reason: `capability "${claim.capability}" is not in the supported ontology` };
  }
  if (!(EXTRACTION_INFERENCE_LEVELS as readonly string[]).includes(claim.inferenceLevel)) {
    return { ok: false, reason: `invalid inference level "${claim.inferenceLevel}"` };
  }
  const level = claim.inferenceLevel as ExtractionInferenceLevel;
  if (typeof claim.confidence !== 'number' || claim.confidence < 0 || claim.confidence > 1) {
    return { ok: false, reason: 'confidence out of range [0,1]' };
  }
  if (typeof claim.strength !== 'number' || claim.strength < 0 || claim.strength > 1) {
    return { ok: false, reason: 'strength out of range [0,1]' };
  }
  // A validated ABSENCE — no score, no evidence, but not an error.
  if (level === 'missing') return { ok: true };

  const spans = claim.evidenceSpans ?? [];
  if (spans.length === 0) return { ok: false, reason: 'explicit/derived claim has no evidence spans' };

  const title = courseTitle ? norm(courseTitle) : '';
  for (const span of spans) {
    const excerpt = typeof span?.excerpt === 'string' ? span.excerpt : '';
    if (!excerpt.trim()) return { ok: false, reason: 'empty evidence excerpt' };
    if (title && norm(excerpt) === title) return { ok: false, reason: 'evidence cites the course title, not syllabus content' };
    if (!snapshot.normalizedContent.includes(excerpt)) {
      return { ok: false, reason: 'evidence excerpt is not grounded verbatim in the authoritative source' };
    }
    if (typeof span.startOffset === 'number' && typeof span.endOffset === 'number') {
      if (snapshot.normalizedContent.slice(span.startOffset, span.endOffset) !== excerpt) {
        return { ok: false, reason: 'evidence offset does not correspond to the excerpt' };
      }
    }
  }

  const evidence: CourseCapabilityEvidence = {
    courseId: snapshot.courseId,
    capability: claim.capability as AcademicFocusArea,
    claim: claim.rationale || '',
    strength: LEVEL_STRENGTH[level],
    sourceType: 'official_syllabus',
    sourceUrl: snapshot.sourceUrl,
    sourceAuthority: snapshot.sourceAuthority,
    sourceYear: snapshot.sourceYear,
    extractedEvidence: spans.map((s) => s.excerpt).join(' … '),
    inferenceLevel: level,
    confidence: boundedConfidence(claim, snapshot),
    retrievedAt: snapshot.retrievedAt,
  };
  return { ok: true, evidence };
}

export function validateExtraction(
  extraction: CandidateExtraction,
  snapshot: SyllabusSnapshot,
  opts: { courseTitle?: string } = {},
): ValidationResult {
  const rejected: ValidationRejection[] = [];
  // The extraction must be for THIS exact snapshot version.
  if (extraction.snapshotHash !== snapshot.contentHash) {
    return { accepted: [], rejected: [{ capability: '*', reason: 'extraction snapshot hash does not match the authoritative snapshot' }] };
  }
  // Reconcile contradictory/duplicate claims per capability: strongest grounded wins.
  const byCapability = new Map<string, { level: ExtractionInferenceLevel; evidence: CourseCapabilityEvidence }>();
  for (const claim of extraction.claims ?? []) {
    const v = validateClaim(claim, snapshot, opts.courseTitle);
    if (!v.ok) {
      rejected.push({ capability: String(claim?.capability ?? '?'), reason: v.reason });
      continue;
    }
    if (!v.evidence) continue; // validated absence (missing)
    const level = v.evidence.inferenceLevel as ExtractionInferenceLevel;
    const prev = byCapability.get(v.evidence.capability);
    if (!prev || LEVEL_RANK[level] > LEVEL_RANK[prev.level] || (LEVEL_RANK[level] === LEVEL_RANK[prev.level] && v.evidence.strength > prev.evidence.strength)) {
      byCapability.set(v.evidence.capability, { level, evidence: v.evidence });
    }
  }
  return { accepted: [...byCapability.values()].map((x) => x.evidence), rejected };
}

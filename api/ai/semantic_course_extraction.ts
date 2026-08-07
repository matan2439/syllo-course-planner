/**
 * SEMANTIC EXTRACTION CONTRACT — the boundary that turns an authoritative syllabus
 * snapshot into UNTRUSTED candidate capability claims. The model may recognize
 * meaning expressed through paraphrase/context, but every explicit/derived claim must
 * carry evidence spans grounded in the supplied snapshot. Nothing here is trusted:
 * output is validated deterministically downstream (semantic_extraction_validator.ts)
 * before it can ever reach planner scoring or explanations.
 *
 * Providers:
 *  - CapturedSemanticProvider: replays real-source-grounded captured extractions
 *    (used because no runtime model provider is configured in this repo — the LLM
 *    provider path is a documented deferred boundary, see llm-notes below).
 *  - (a future) LlmSemanticProvider would call the existing model abstraction
 *    (resolveModel + AI SDK generateObject with the schema) — NOT implemented live here.
 */
import type { SyllabusSnapshot } from './syllabus_snapshot';

/** Supported capability ontology for this slice (extensible; only mechanical_design has data). */
export const CAPABILITY_ONTOLOGY = ['mechanical_design'] as const;
export type OntologyCapability = (typeof CAPABILITY_ONTOLOGY)[number];
export const ONTOLOGY_VERSION = '1';
export const EXTRACTION_SCHEMA_VERSION = '1';

export const EXTRACTION_INFERENCE_LEVELS = ['explicit', 'derived', 'estimated', 'missing'] as const;
export type ExtractionInferenceLevel = (typeof EXTRACTION_INFERENCE_LEVELS)[number];

export interface EvidenceSpan {
  excerpt: string;
  section: string | null;
  startOffset: number;
  endOffset: number;
}

export interface CandidateClaim {
  courseId: string;
  capability: string; // untrusted: may be outside the ontology → rejected by the validator
  relationship: string;
  strength: number;
  inferenceLevel: ExtractionInferenceLevel | string;
  confidence: number;
  evidenceSpans: EvidenceSpan[];
  rationale: string;
  unsupportedOrAmbiguous: boolean;
}

export interface CandidateExtraction {
  courseId: string;
  snapshotHash: string;
  claims: CandidateClaim[];
}

export interface SemanticExtractionProvider {
  name: string;
  extract(snapshot: SyllabusSnapshot, capabilities: readonly string[]): Promise<CandidateExtraction>;
}

/**
 * Replays captured extractions keyed by `${courseId}@${contentHash}`. If nothing was
 * captured for the exact snapshot, returns an empty (no-claim) extraction — it never
 * fabricates. Captured entries are real-source-grounded and reviewed (see the data
 * file's header); the validator still checks every span, so even captured output is
 * treated as untrusted.
 */
export class CapturedSemanticProvider implements SemanticExtractionProvider {
  public readonly name = 'captured';
  constructor(private readonly captured: Record<string, CandidateExtraction>) {}
  async extract(snapshot: SyllabusSnapshot, _capabilities: readonly string[]): Promise<CandidateExtraction> {
    const key = `${snapshot.courseId}@${snapshot.contentHash}`;
    const hit = this.captured[key];
    if (hit) return hit;
    return { courseId: snapshot.courseId, snapshotHash: snapshot.contentHash, claims: [] };
  }
}

/**
 * A reviewed, human-authored captured claim (per course): the capability, its inference
 * level, and the verbatim excerpt(s) from the official syllabus that support it. Offsets
 * are NOT stored — they are computed against the live snapshot at extraction time, so the
 * captured data cannot drift from the real source (an excerpt no longer present is simply
 * dropped, and the validator would reject an ungrounded positive claim anyway).
 */
export interface CapturedClaimSpec {
  capability: string;
  relationship?: string;
  inferenceLevel: ExtractionInferenceLevel;
  strength: number;
  confidence: number;
  rationale: string;
  excerpts: string[];
  unsupportedOrAmbiguous?: boolean;
}

/** Build a CandidateExtraction from reviewed claim specs, grounding each excerpt in the snapshot. */
export function buildCapturedExtraction(snapshot: SyllabusSnapshot, specs: CapturedClaimSpec[]): CandidateExtraction {
  const claims: CandidateClaim[] = (specs ?? []).map((spec) => {
    const spans: EvidenceSpan[] = [];
    for (const ex of spec.excerpts ?? []) {
      const i = snapshot.normalizedContent.indexOf(ex);
      if (i >= 0) spans.push({ excerpt: ex, section: null, startOffset: i, endOffset: i + ex.length });
    }
    return {
      courseId: snapshot.courseId,
      capability: spec.capability,
      relationship: spec.relationship ?? 'teaches',
      strength: spec.strength,
      inferenceLevel: spec.inferenceLevel,
      confidence: spec.confidence,
      evidenceSpans: spans,
      rationale: spec.rationale,
      unsupportedOrAmbiguous: spec.unsupportedOrAmbiguous ?? false,
    };
  });
  return { courseId: snapshot.courseId, snapshotHash: snapshot.contentHash, claims };
}

/**
 * Provider backed by reviewed captured claim specs keyed by courseId. Deterministic; no
 * live model. This is the transitional provider used while no runtime model provider is
 * configured — the LLM provider (resolveModel + AI SDK generateObject) is a deferred boundary.
 */
export class ClaimSpecProvider implements SemanticExtractionProvider {
  public readonly name: string;
  constructor(private readonly specsByCourse: Record<string, CapturedClaimSpec[]>, name = 'captured-review-v1') {
    this.name = name;
  }
  async extract(snapshot: SyllabusSnapshot, _capabilities: readonly string[]): Promise<CandidateExtraction> {
    return buildCapturedExtraction(snapshot, this.specsByCourse[snapshot.courseId] ?? []);
  }
}

/** Bounded-timeout wrapper: rejects on timeout, propagates provider errors classified. */
export async function runExtractionWithTimeout(
  provider: SemanticExtractionProvider,
  snapshot: SyllabusSnapshot,
  capabilities: readonly string[],
  opts: { timeoutMs?: number } = {},
): Promise<CandidateExtraction> {
  const timeoutMs = opts.timeoutMs ?? 20000;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`semantic extraction timeout after ${timeoutMs}ms`)), timeoutMs);
  });
  try {
    return await Promise.race([provider.extract(snapshot, capabilities), timeout]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/**
 * EXTERNAL-CONTEXT LAYER — WHY a capability is relevant to a goal, sourced from an
 * authoritative external body with provenance and freshness. It represents
 * `capability X is relevant to goal Y` and must NEVER represent `course C teaches X`
 * (that is the course-knowledge layer, course_capability_evidence.ts). The two are
 * kept strictly separate: nothing here carries a courseId.
 *
 * HYBRID MODEL: stable, verified goal→capability relationships are CACHED here with
 * provenance. Fresh runtime research (for new/ambiguous/temporal goals) would come
 * through `ExternalContextProvider` — the boundary is defined but is NOT connected to
 * a runtime provider in this slice (structurally prepared; see getExternalContextEvidence).
 * Planner scoring never consumes raw external text — this layer feeds explanation/
 * provenance only for the design academic-domain journey, and does not inflate the
 * course-fit score (the course-knowledge layer carries that match).
 */

export const EXTERNAL_SOURCE_TYPES = [
  'accreditation_body',
  'standards_body',
  'academic',
  'industry_body',
  'job_postings',
  'general_web',
] as const;
export type ExternalSourceType = (typeof EXTERNAL_SOURCE_TYPES)[number];

export interface ExternalContextEvidence {
  goalOrContext: string;
  capability: string;
  /** e.g. 'relevant_to'. */
  relationship: string;
  /** 0..1 relevance strength. */
  strength: number;
  sourceType: ExternalSourceType;
  sourceUrl: string;
  publisher: string;
  publishedOrUpdatedAt: string;
  retrievedAt: string;
  confidence: number;
  corroborationCount: number;
  /** Verbatim short quote from the authoritative source. */
  extractedEvidence: string;
}

/**
 * Cached, authoritative relationship for the engineering-design goal. Source: ABET
 * (the US accreditation body for engineering programs), Criteria for Accrediting
 * Engineering Programs, 2026–2027 — Criterion 3 Student Outcome (2) and Criterion 5
 * (curriculum). Retrieved 2026-08-07. This links the DESIGN GOAL to design-capability;
 * it says nothing about any Syllo course.
 */
export const EXTERNAL_CONTEXT_CACHE: ExternalContextEvidence[] = [
  {
    goalOrContext: 'engineering_design',
    capability: 'mechanical_design',
    relationship: 'relevant_to',
    strength: 0.9,
    sourceType: 'accreditation_body',
    sourceUrl:
      'https://www.abet.org/accreditation/accreditation-criteria/criteria-for-accrediting-engineering-programs-2026-2027/',
    publisher: 'ABET (Engineering Accreditation Commission)',
    publishedOrUpdatedAt: '2026-2027',
    retrievedAt: '2026-08-07',
    confidence: 0.9,
    corroborationCount: 2, // Criterion 3 outcome (2) + Criterion 5 curriculum
    extractedEvidence:
      'ABET Criterion 3(2): "an ability to apply engineering design to produce solutions that meet specified needs"; Criterion 5 requires "a culminating major engineering design experience that … incorporates appropriate engineering standards and multiple constraints".',
  },
];

/**
 * The runtime research boundary. A future provider (web-search/AI research with
 * provenance) would implement this; none is connected in this slice, so
 * getExternalContextEvidence serves only the cached, verified relationships above.
 */
export interface ExternalContextProvider {
  research(goalOrContext: string): Promise<ExternalContextEvidence[]>;
}

/** Cached goal→capability relationships for a goal (empty for unknown goals — never fabricated). */
export function getExternalContextEvidence(goalOrContext: string): ExternalContextEvidence[] {
  return EXTERNAL_CONTEXT_CACHE.filter((r) => r.goalOrContext === goalOrContext);
}

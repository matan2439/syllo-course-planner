/**
 * Runtime KnowledgeCapability — generic contracts (Slice 1).
 *
 * The Academic Decision Agent grounds an ARBITRARY professional concept (design, RF,
 * robotics, research, clinical hardware, …) from authoritative sources and maps course
 * evidence to it. NOTHING here is domain-specific: no `mechanical_design`, no design-only
 * fields. Model-assisted providers PROPOSE; deterministic validators (knowledge_validation.ts)
 * DISPOSE. Reusable professional knowledge (`KnowledgeArtifact`) is course-independent; a
 * `CourseMappingArtifact` is course-and-version specific and request-scoped in this slice.
 */

// ── source-level provenance ─────────────────────────────────────────────────────
export type SourceAuthority =
  | 'accreditation_body' | 'standards_body' | 'peer_reviewed' | 'academic' | 'textbook'
  | 'professional_body' | 'industry_body' | 'employer' | 'general_web' | 'informal';

export interface SourceRecord {
  sourceId: string; url: string; title: string; publisher: string;
  authority: SourceAuthority; publishedOrUpdatedAt?: string; retrievedAt: string;
  lang: string; scope?: string; limitations?: string;
}
export interface SourceClaim {
  claimId: string; sourceId: string; verbatimQuote: string; normalizedClaim: string;
  startOffset?: number; endOffset?: number;
}

// ── capability profile (course-independent) ─────────────────────────────────────
export type Necessity = 'necessary' | 'common' | 'supporting' | 'optional' | 'disputed';
export interface CapabilityElement {
  elementId: string; kind: string; text: string; necessity: Necessity;
  /** claimIds from the artifact's claims that ground this element (empty ⇒ unsupported). */
  supportedByClaimIds: string[];
  origin: 'sourced' | 'model_synthesis';
  /** set by validateProfile; true ⇒ grounded & eligible to be direct/planning. */
  supported?: boolean;
}
export interface KnowledgeConflict { elementId?: string; positions: Array<{ claimIds: string[]; stance: string }>; resolution: 'unresolved' | 'majority' | 'authority_wins'; }
export interface CapabilityProfile {
  conceptId: string; profileVersion: string; elements: CapabilityElement[]; conflicts: KnowledgeConflict[];
}

// ── course-activity evidence (generic dimensions — no design-specific fields) ────
export type EvidenceMode = 'taught' | 'practised' | 'assessed' | 'mentioned' | 'assumed' | 'contextual';
export type Agency = 'none' | 'apply_given' | 'select_among' | 'modify' | 'create' | 'unspecified';
export interface CourseActivity {
  activityId: string; action: string; object?: string; purpose?: string; method?: string;
  producedArtifact?: string; outcome?: string;
  agency: Agency; alternativesConsidered?: boolean; constraintsPresent?: boolean;
  iteration?: boolean; responsibilityScope?: 'component' | 'subsystem' | 'system' | 'unspecified';
  mode: EvidenceMode; excerpt: string; startOffset: number; endOffset: number;
}
export interface CourseEvidence { courseId: string; courseEvidenceHash: string; lang: string; activities: CourseActivity[]; }

// ── proposed vs validated course↔capability relationship ────────────────────────
export type RelationshipKind = 'direct' | 'supporting' | 'inferred' | 'contextual' | 'contradictory' | 'insufficient';
/** What a (model-assisted) SemanticMappingProvider proposes. Untrusted. */
export interface ProposedRelationship {
  conceptId: string; elementId: string; courseId: string; relationship: RelationshipKind;
  evidenceActivityIds: string[]; rationale: string; modelSelfReported?: number;
}
/** What deterministic validation produces. `strength`/`planningEligible` are computed, not model-declared. */
export interface CourseCapabilityRelationship {
  conceptId: string; elementId: string; courseId: string; relationship: RelationshipKind;
  strength: number; uncertainty: number; evidenceRefs: CourseActivity[]; rationale: string;
  planningEligible: boolean; modelSelfReported?: number;
}

// ── concept, trust, quality, freshness, artifacts ───────────────────────────────
export interface ResolvedProfessionalConcept {
  conceptId: string; label: string; requiresClarification: boolean;
  candidateMeanings?: Array<{ conceptId: string; gloss: string }>;
}
export type TrustTier = 'request_scoped' | 'reusable_unreviewed' | 'corroborated' | 'human_reviewed' | 'rejected';
export interface EvidenceQuality {
  authorityRank: number; independentSources: number; corroborationCount: number;
  sourcedFraction: number; unresolvedConflicts: number;
}
export interface KnowledgeFreshness { knowledgeKind: 'foundational' | 'evolving' | 'temporal'; builtAt: string; ttlDays: number; }
export interface KnowledgeArtifact {
  knowledgeId: string; concept: ResolvedProfessionalConcept;
  sources: SourceRecord[]; claims: SourceClaim[]; profile: CapabilityProfile;
  evidenceQuality: EvidenceQuality; tier: TrustTier; freshness: KnowledgeFreshness;
  reviewStatus: 'human_reviewed' | 'machine_generated' | 'stale' | 'rejected';
}
export interface CourseMappingArtifact {
  mappingId: string; knowledgeRef: { knowledgeId: string; profileVersion: string };
  courseId: string; courseEvidenceHash: string; relationships: CourseCapabilityRelationship[];
}
export interface PlanningRelevanceSignal {
  courseId: string; conceptId: string; elementId: string; relevance: number;
  relationship: RelationshipKind; provenance: 'human_reviewed' | 'machine_generated';
  uncertainty: number; explanation: string;
}

// ── request ─────────────────────────────────────────────────────────────────────
export interface KnowledgeRequest {
  concept: ResolvedProfessionalConcept; institutionScope?: string; lang?: string; courseEvidence: CourseEvidence;
}

// ── injected ports (fakes in tests; real web/DB adapters are later slices) ───────
export interface ResearchProvider { research(concept: ResolvedProfessionalConcept): Promise<{ sources: SourceRecord[]; claims: SourceClaim[] }>; }
export interface ProfileSynthesisProvider { synthesize(input: { concept: ResolvedProfessionalConcept; sources: SourceRecord[]; claims: SourceClaim[] }): Promise<CapabilityProfile>; }
export interface SemanticMappingProvider { map(profile: CapabilityProfile, activities: CourseActivity[], evidence: CourseEvidence): Promise<ProposedRelationship[]>; }
export interface KnowledgeStore { findByConcept(knowledgeId: string, nowMs: number): KnowledgeArtifact | null; put(artifact: KnowledgeArtifact): void; size(): number; }

/**
 * RUNTIME KNOWLEDGE ORCHESTRATION (Slice 1) — the request-path flow that grounds a
 * professional concept and maps course evidence, wiring the injected ports through the
 * deterministic validators. Plan-inert: it returns an auditable result and never touches
 * generate-plan or the deterministic planner. Research runs ONLY on a knowledge cache miss;
 * a knowledge hit skips research+synthesis but STILL maps the current course.
 *
 * Boundaries kept logically separate: ResearchProvider (evidence, not a profile) →
 * ProfileSynthesisProvider (proposes profile) → validateProfile (deterministic) → store →
 * SemanticMappingProvider (proposes relationships) → validateRelationships (deterministic).
 */
import {
  knowledgeIdentity, mappingIdentity, validateProfile, validateRelationships,
  ONTOLOGY_VERSION, PROFILE_SCHEMA_VERSION, ACTIVITY_EXTRACTION_SCHEMA_VERSION,
  RELATIONSHIP_SCHEMA_VERSION, MAPPING_CRITERIA_VERSION,
} from './knowledge_validation';
import type {
  KnowledgeRequest, KnowledgeArtifact, KnowledgeStore, ResearchProvider, ProfileSynthesisProvider,
  SemanticMappingProvider, CourseMappingArtifact, PlanningRelevanceSignal,
} from './knowledge_types';

const SEMANTIC_MAPPER_VERSION = 'slice1-fake';
const DAY_MS = 86_400_000;

/** In-memory knowledge store (Slice 1). A durable Supabase/Postgres adapter is a later slice. */
export class InMemoryKnowledgeStore implements KnowledgeStore {
  private readonly m = new Map<string, KnowledgeArtifact>();
  findByConcept(knowledgeId: string, nowMs: number): KnowledgeArtifact | null {
    const a = this.m.get(knowledgeId);
    if (!a) return null;
    const expiry = Date.parse(a.freshness.builtAt) + a.freshness.ttlDays * DAY_MS;
    if (Number.isFinite(expiry) && nowMs > expiry) return null; // stale
    if (a.reviewStatus === 'stale' || a.reviewStatus === 'rejected') return null;
    return a;
  }
  put(a: KnowledgeArtifact): void { this.m.set(a.knowledgeId, a); }
  size(): number { return this.m.size; }
}

export interface OrchestratorDeps {
  research: ResearchProvider;
  synthesis: ProfileSynthesisProvider;
  mapping: SemanticMappingProvider;
  store: KnowledgeStore;
  clock?: () => number;
}

export type KnowledgeResult =
  | { status: 'needs_clarification'; candidateMeanings: Array<{ conceptId: string; gloss: string }> }
  | { status: 'grounded'; knowledgeArtifact: KnowledgeArtifact; mapping: CourseMappingArtifact; planningSignals: PlanningRelevanceSignal[] }
  | { status: 'insufficient'; reason: string; quarantined?: boolean };

export async function orchestrateKnowledge(request: KnowledgeRequest, deps: OrchestratorDeps): Promise<KnowledgeResult> {
  // 1. Clarify materially-ambiguous intent BEFORE spending any research budget.
  if (request.concept.requiresClarification) {
    return { status: 'needs_clarification', candidateMeanings: request.concept.candidateMeanings ?? [] };
  }

  const nowMs = deps.clock ? deps.clock() : Date.now();
  const knowledgeId = knowledgeIdentity({
    conceptKey: request.concept.conceptId, institutionScope: request.institutionScope,
    ontologyVersion: ONTOLOGY_VERSION, profileSchemaVersion: PROFILE_SCHEMA_VERSION,
  });

  // 2. Knowledge sufficiency — reuse a fresh valid artifact (skip research + synthesis).
  let artifact = deps.store.findByConcept(knowledgeId, nowMs);
  if (!artifact) {
    let sources, claims;
    try { ({ sources, claims } = await deps.research.research(request.concept)); }
    catch { return { status: 'insufficient', reason: 'research_failed' }; }         // safe fallback

    let proposed;
    try { proposed = await deps.synthesis.synthesize({ concept: request.concept, sources, claims }); }
    catch { return { status: 'insufficient', reason: 'synthesis_failed' }; }

    const pv = validateProfile(proposed, claims, sources);
    if (!pv.ok) return { status: 'insufficient', reason: pv.reason ?? 'profile_invalid', quarantined: true }; // quarantine, not stored

    artifact = {
      knowledgeId, concept: request.concept, sources, claims, profile: pv.profile,
      evidenceQuality: pv.evidenceQuality, tier: pv.tier,
      freshness: { knowledgeKind: 'foundational', builtAt: new Date(nowMs).toISOString(), ttlDays: 3650 },
      reviewStatus: 'machine_generated',
    };
    deps.store.put(artifact); // valid knowledge is stored even at a low tier (may support later review/refresh)
  }

  // 3. Map the CURRENT course evidence every request (no durable mapping cache in this slice).
  const proposals = await deps.mapping.map(artifact.profile, request.courseEvidence.activities, request.courseEvidence);
  const rv = validateRelationships(proposals, artifact, request.courseEvidence);

  const mapping: CourseMappingArtifact = {
    mappingId: mappingIdentity({
      knowledgeId: artifact.knowledgeId, profileVersion: artifact.profile.profileVersion,
      courseId: request.courseEvidence.courseId, courseEvidenceHash: request.courseEvidence.courseEvidenceHash,
      activityExtractionSchemaVersion: ACTIVITY_EXTRACTION_SCHEMA_VERSION,
      relationshipSchemaVersion: RELATIONSHIP_SCHEMA_VERSION, mappingCriteriaVersion: MAPPING_CRITERIA_VERSION,
      semanticMapperVersion: SEMANTIC_MAPPER_VERSION,
    }),
    knowledgeRef: { knowledgeId: artifact.knowledgeId, profileVersion: artifact.profile.profileVersion },
    courseId: request.courseEvidence.courseId, courseEvidenceHash: request.courseEvidence.courseEvidenceHash,
    relationships: rv.relationships,
  };

  // 4. Only planning-eligible relationships (≥ corroborated tier, supported element) become signals.
  const planningSignals: PlanningRelevanceSignal[] = rv.relationships
    .filter((r) => r.planningEligible)
    .map((r) => ({
      courseId: r.courseId, conceptId: r.conceptId, elementId: r.elementId, relevance: r.strength,
      relationship: r.relationship, provenance: artifact!.reviewStatus === 'human_reviewed' ? 'human_reviewed' : 'machine_generated',
      uncertainty: r.uncertainty, explanation: r.rationale,
    }));

  return { status: 'grounded', knowledgeArtifact: artifact, mapping, planningSignals };
}

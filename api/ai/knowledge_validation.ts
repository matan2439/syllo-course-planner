/**
 * DETERMINISTIC KNOWLEDGE VALIDATION — the trust boundary between untrusted, model-assisted
 * proposals and anything that may be stored, reused, or reach planning. It never SOLVES
 * semantic relevance (that is the SemanticMappingProvider's job); it only DISPOSES:
 * enforces provenance, computes evidence-quality/trust deterministically, and gates planning
 * eligibility per capability element. A model's self-reported confidence can only LOWER the
 * result, never raise it.
 */
import { createHash } from 'crypto';
import type {
  SourceRecord, SourceClaim, CapabilityProfile, CapabilityElement, TrustTier, EvidenceQuality,
  CourseEvidence, ProposedRelationship, CourseCapabilityRelationship, KnowledgeArtifact,
} from './knowledge_types';

export const ONTOLOGY_VERSION = '1';
export const PROFILE_SCHEMA_VERSION = '1';
export const ACTIVITY_EXTRACTION_SCHEMA_VERSION = '1';
export const RELATIONSHIP_SCHEMA_VERSION = '1';
export const MAPPING_CRITERIA_VERSION = '1';

const AUTHORITY_RANK: Record<string, number> = {
  accreditation_body: 5, standards_body: 5, peer_reviewed: 4, academic: 4, textbook: 4,
  professional_body: 3, industry_body: 3, employer: 2, general_web: 1, informal: 0,
};
const TOP_PRIMARY = 5;
const STRENGTH: Record<string, number> = { direct: 0.9, supporting: 0.6, inferred: 0.4, contextual: 0.2, insufficient: 0, contradictory: 0 };
const PLANNING_TIERS = new Set<TrustTier>(['corroborated', 'human_reviewed']);

// Hash the JSON encoding of an ordered field list: unambiguous (different groupings encode
// differently) and printable-ASCII, so no delimiter char is needed.
const shaFields = (fields: Array<string>): string => createHash('sha256').update(JSON.stringify(fields), 'utf8').digest('hex');

// ── identities (course-independent knowledge vs course-specific mapping) ─────────
export function knowledgeIdentity(i: { conceptKey: string; institutionScope?: string; ontologyVersion: string; profileSchemaVersion: string }): string {
  return shaFields(['k', i.conceptKey, i.institutionScope ?? '', i.ontologyVersion, i.profileSchemaVersion]);
}
export function mappingIdentity(i: {
  knowledgeId: string; profileVersion: string; courseId: string; courseEvidenceHash: string;
  activityExtractionSchemaVersion: string; relationshipSchemaVersion: string; mappingCriteriaVersion: string; semanticMapperVersion: string;
}): string {
  return shaFields(['m', i.knowledgeId, i.profileVersion, i.courseId, i.courseEvidenceHash,
    i.activityExtractionSchemaVersion, i.relationshipSchemaVersion, i.mappingCriteriaVersion, i.semanticMapperVersion]);
}

// ── profile validation → provenance + evidence quality + trust tier ─────────────
export interface ProfileValidation {
  ok: boolean; quarantine?: boolean; reason?: string;
  profile: CapabilityProfile; tier: TrustTier; evidenceQuality: EvidenceQuality;
}
const ZERO_QUALITY: EvidenceQuality = { authorityRank: 0, independentSources: 0, corroborationCount: 0, sourcedFraction: 0, unresolvedConflicts: 0 };

export function validateProfile(profile: CapabilityProfile, claims: SourceClaim[], sources: SourceRecord[]): ProfileValidation {
  const claimById = new Map(claims.map((c) => [c.claimId, c]));
  const sourceById = new Map(sources.map((s) => [s.sourceId, s]));

  // Provenance: an element citing a claim that does not exist is FABRICATED linkage → quarantine.
  for (const el of profile.elements) {
    for (const cid of el.supportedByClaimIds) {
      if (!claimById.has(cid)) {
        return { ok: false, quarantine: true, reason: `element "${el.elementId}" cites unknown claim "${cid}"`, profile: { ...profile, elements: profile.elements.map((e) => ({ ...e, supported: false })) }, tier: 'rejected', evidenceQuality: ZERO_QUALITY };
      }
    }
  }

  const elements: CapabilityElement[] = profile.elements.map((el) => ({
    ...el,
    supported: el.origin === 'sourced' && el.supportedByClaimIds.length > 0,
  }));

  const supported = elements.filter((e) => e.supported);
  const usedSourceIds = new Set<string>();
  for (const el of supported) for (const cid of el.supportedByClaimIds) { const c = claimById.get(cid); if (c) usedSourceIds.add(c.sourceId); }
  const usedSources = [...usedSourceIds].map((id) => sourceById.get(id)).filter((s): s is SourceRecord => !!s);

  const authorityRank = usedSources.reduce((m, s) => Math.max(m, AUTHORITY_RANK[s.authority] ?? 0), 0);
  const independentSources = new Set(usedSources.map((s) => s.publisher)).size;
  const unresolvedConflicts = (profile.conflicts ?? []).filter((c) => c.resolution === 'unresolved').length;
  const evidenceQuality: EvidenceQuality = {
    authorityRank, independentSources, corroborationCount: usedSources.length,
    sourcedFraction: elements.length ? supported.length / elements.length : 0, unresolvedConflicts,
  };

  // Trust tier: single top-authority primary qualifies; otherwise >=2 independent high-authority.
  let tier: TrustTier = 'request_scoped';
  if (supported.length > 0) {
    const corroborated = unresolvedConflicts === 0 && (authorityRank >= TOP_PRIMARY || (authorityRank >= 4 && independentSources >= 2));
    tier = corroborated ? 'corroborated' : 'reusable_unreviewed';
  }
  return { ok: true, profile: { ...profile, elements }, tier, evidenceQuality };
}

// ── relationship validation → invariants + per-element planning eligibility ──────
export interface RelationshipValidation { relationships: CourseCapabilityRelationship[]; rejected: Array<{ elementId: string; reason: string }>; }

function isSupported(el: CapabilityElement): boolean {
  return el.supported !== undefined ? el.supported : el.origin === 'sourced' && el.supportedByClaimIds.length > 0;
}
function uncertaintyOf(rel: string, act: { object?: string; purpose?: string; mode: string } | undefined): number {
  let u = 0.1;
  if (!act) return 1;
  if (!act.object) u += 0.2;
  if (!act.purpose) u += 0.2;
  if (act.mode === 'mentioned' || act.mode === 'assumed' || act.mode === 'contextual') u += 0.3;
  if (rel === 'inferred' || rel === 'contextual') u += 0.1;
  return Math.min(u, 1);
}

export function validateRelationships(proposed: ProposedRelationship[], artifact: KnowledgeArtifact, evidence: CourseEvidence): RelationshipValidation {
  const elementById = new Map(artifact.profile.elements.map((e) => [e.elementId, e]));
  const activityById = new Map(evidence.activities.map((a) => [a.activityId, a]));
  const planningTierOk = PLANNING_TIERS.has(artifact.tier);
  const relationships: CourseCapabilityRelationship[] = [];
  const rejected: Array<{ elementId: string; reason: string }> = [];

  for (const p of proposed) {
    const element = elementById.get(p.elementId);
    if (!element) { rejected.push({ elementId: p.elementId, reason: `capability element "${p.elementId}" is absent from the profile` }); continue; }

    const evidenceRefs = p.evidenceActivityIds.map((id) => activityById.get(id)).filter((a): a is NonNullable<typeof a> => !!a);
    const grounded = evidenceRefs.length > 0;

    // No unsupported `direct`: a direct claim needs grounded evidence AND a rationale explaining instantiation.
    let relationship = p.relationship;
    if (relationship === 'direct' && (!grounded || !p.rationale?.trim())) relationship = 'insufficient';

    // Deterministic strength; a model self-report can only lower it, never raise it.
    let strength = STRENGTH[relationship] ?? 0;
    if (typeof p.modelSelfReported === 'number') strength = Math.min(strength, Math.max(0, p.modelSelfReported));

    const planningEligible = planningTierOk && isSupported(element) && (relationship === 'direct' || relationship === 'supporting');

    relationships.push({
      conceptId: p.conceptId, elementId: p.elementId, courseId: p.courseId, relationship, strength,
      uncertainty: uncertaintyOf(relationship, evidenceRefs[0]), evidenceRefs, rationale: p.rationale,
      planningEligible, modelSelfReported: p.modelSelfReported,
    });
  }
  return { relationships, rejected };
}

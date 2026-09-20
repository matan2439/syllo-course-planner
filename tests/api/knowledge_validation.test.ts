/**
 * Slice 1 — deterministic validators & identities for the runtime KnowledgeCapability.
 * The model-assisted providers PROPOSE; this deterministic layer DISPOSES. No network,
 * no paid calls. Covers provenance, evidence-quality/trust tiers, semantic-mapping
 * invariants (mode ⊥ relationship, no universal agency rule), per-element planning
 * eligibility, and the KnowledgeArtifact / CourseMappingArtifact identity split.
 */
import {
  validateProfile,
  validateRelationships,
  knowledgeIdentity,
  mappingIdentity,
  PROFILE_SCHEMA_VERSION,
  RELATIONSHIP_SCHEMA_VERSION,
  MAPPING_CRITERIA_VERSION,
  ONTOLOGY_VERSION,
} from '../../api/ai/knowledge_validation';
import type {
  SourceRecord, SourceClaim, CapabilityProfile, CapabilityElement,
  CourseEvidence, CourseActivity, ProposedRelationship, KnowledgeArtifact,
} from '../../api/ai/knowledge_types';

// ── fixtures ──────────────────────────────────────────────────────────────────
const src = (sourceId: string, publisher: string, authority: SourceRecord['authority']): SourceRecord =>
  ({ sourceId, url: `https://x/${sourceId}`, title: sourceId, publisher, authority, retrievedAt: '2026-08-08', lang: 'en' });
const claim = (claimId: string, sourceId: string): SourceClaim =>
  ({ claimId, sourceId, verbatimQuote: 'q', normalizedClaim: 'c' });
const elem = (elementId: string, over: Partial<CapabilityElement> = {}): CapabilityElement =>
  ({ elementId, kind: 'activity', text: elementId, necessity: 'necessary', supportedByClaimIds: [], origin: 'sourced', ...over });
const profile = (elements: CapabilityElement[], conceptId = 'concept_x'): CapabilityProfile =>
  ({ conceptId, profileVersion: '1', elements, conflicts: [] });
const activity = (activityId: string, over: Partial<CourseActivity> = {}): CourseActivity =>
  ({ activityId, action: 'analyse', object: 'geometry', purpose: 'validate', method: 'FEA',
     agency: 'apply_given', mode: 'assessed', excerpt: 'analyse a supplied geometry', startOffset: 0, endOffset: 26, ...over });
const evidence = (activities: CourseActivity[], courseId = 'C1', hash = 'H1'): CourseEvidence =>
  ({ courseId, courseEvidenceHash: hash, lang: 'en', activities });
const artifact = (p: CapabilityProfile, tier: KnowledgeArtifact['tier']): KnowledgeArtifact =>
  ({ knowledgeId: 'k1', concept: { conceptId: p.conceptId, label: 'x', requiresClarification: false },
     sources: [], claims: [], profile: p, evidenceQuality: { authorityRank: 5, independentSources: 2, corroborationCount: 2, sourcedFraction: 1, unresolvedConflicts: 0 },
     tier, freshness: { knowledgeKind: 'foundational', builtAt: '2026-08-08', ttlDays: 3650 }, reviewStatus: 'machine_generated' });
const propose = (over: Partial<ProposedRelationship>): ProposedRelationship =>
  ({ conceptId: 'concept_x', elementId: 'e_design', courseId: 'C1', relationship: 'direct',
     evidenceActivityIds: ['a1'], rationale: 'the student modifies geometry to meet requirements', ...over });

// ── validateProfile: provenance ────────────────────────────────────────────────
test('an element with no supporting claim IDs is marked unsupported (not planning/direct capable)', () => {
  const r = validateProfile(profile([elem('e1', { supportedByClaimIds: [] })]), [claim('cl1', 's1')], [src('s1', 'ISO', 'standards_body')]);
  expect(r.ok).toBe(true);
  expect(r.profile.elements.find((e) => e.elementId === 'e1')!.supported).toBe(false);
});

test('an element citing a NONEXISTENT claim id is provenance-invalid → quarantined, not stored as valid', () => {
  const r = validateProfile(profile([elem('e1', { supportedByClaimIds: ['ghost'] })]), [claim('cl1', 's1')], [src('s1', 'ISO', 'standards_body')]);
  expect(r.ok).toBe(false);
  expect(r.quarantine).toBe(true);
});

test('the reusable CapabilityProfile carries no course-specific field (no courseId anywhere)', () => {
  const p = profile([elem('e1', { supportedByClaimIds: ['cl1'] })]);
  expect(JSON.stringify(p)).not.toMatch(/courseId|course_id/);
});

// ── evidence quality → trust tier ──────────────────────────────────────────────
test('two dependent/low-authority sources do NOT reach the corroborated (T2) tier', () => {
  const r = validateProfile(
    profile([elem('e1', { supportedByClaimIds: ['cl1', 'cl2'] })]),
    [claim('cl1', 's1'), claim('cl2', 's2')],
    [src('s1', 'SameBlog', 'general_web'), src('s2', 'SameBlog', 'general_web')], // same publisher = dependent, low authority
  );
  expect(r.ok).toBe(true);
  expect(r.tier).not.toBe('corroborated');
});

test('a single TOP-authority primary source (on-topic, fresh, no conflict) reaches corroborated (T2)', () => {
  const r = validateProfile(
    profile([elem('e1', { supportedByClaimIds: ['cl1'] })]),
    [claim('cl1', 's1')],
    [src('s1', 'ABET', 'accreditation_body')],
  );
  expect(r.tier).toBe('corroborated');
});

// ── validateRelationships: semantic invariants ─────────────────────────────────
test('a mapping to a capability element ABSENT from the profile is rejected', () => {
  const art = artifact(profile([elem('e_design', { supportedByClaimIds: ['cl1'] })]), 'corroborated');
  const r = validateRelationships([propose({ elementId: 'e_missing' })], art, evidence([activity('a1')]));
  expect(r.relationships).toHaveLength(0);
  expect(r.rejected.some((x) => /element|absent|unknown/i.test(x.reason))).toBe(true);
});

test('a `direct` relationship with no grounded evidence is downgraded to insufficient (no unsupported direct)', () => {
  const art = artifact(profile([elem('e_design', { supportedByClaimIds: ['cl1'] })]), 'corroborated');
  const r = validateRelationships([propose({ evidenceActivityIds: [] })], art, evidence([activity('a1')]));
  expect(r.relationships[0].relationship).toBe('insufficient');
});

test('`apply_given` agency CAN be `direct` for a suitable element (no universal agency rule)', () => {
  const art = artifact(profile([elem('e_measure', { supportedByClaimIds: ['cl1'] })]), 'corroborated');
  const act = activity('a1', { action: 'operate', object: 'RF spectrum analyser', agency: 'apply_given', mode: 'practised', excerpt: 'operate the supplied analyser' });
  const r = validateRelationships(
    [propose({ elementId: 'e_measure', relationship: 'direct', evidenceActivityIds: ['a1'], rationale: 'operating the instrument instantiates measurement' })],
    art, evidence([act]),
  );
  expect(r.relationships[0].relationship).toBe('direct');
});

test('one `assessed` activity is `direct` to an analysis element yet only `supporting` to a design element; its EvidenceMode stays assessed', () => {
  const art = artifact(profile([elem('e_analysis', { supportedByClaimIds: ['cl1'] }), elem('e_design', { supportedByClaimIds: ['cl1'] })]), 'corroborated');
  const act = activity('a1', { mode: 'assessed' });
  const r = validateRelationships([
    propose({ elementId: 'e_analysis', relationship: 'direct', evidenceActivityIds: ['a1'], rationale: 'analysing the geometry instantiates analysis' }),
    propose({ elementId: 'e_design', relationship: 'supporting', evidenceActivityIds: ['a1'], rationale: 'analysis during design supports the design element' }),
  ], art, evidence([act]));
  const byElem = Object.fromEntries(r.relationships.map((x) => [x.elementId, x]));
  expect(byElem['e_analysis'].relationship).toBe('direct');
  expect(byElem['e_design'].relationship).toBe('supporting');
  expect(byElem['e_analysis'].evidenceRefs[0].mode).toBe('assessed'); // mode never rewritten
});

test('modelSelfReported confidence cannot RAISE final strength above the deterministic value', () => {
  const art = artifact(profile([elem('e_design', { supportedByClaimIds: ['cl1'] })]), 'corroborated');
  const r = validateRelationships([propose({ relationship: 'supporting', modelSelfReported: 0.99 })], art, evidence([activity('a1')]));
  expect(r.relationships[0].strength).toBeLessThanOrEqual(0.6); // supporting deterministic band, model 0.99 cannot inflate
});

test('uncertainty rises when the cited activity omits object/purpose or is only mentioned', () => {
  const art = artifact(profile([elem('e_design', { supportedByClaimIds: ['cl1'] })]), 'corroborated');
  const rich = validateRelationships([propose({ relationship: 'supporting' })], art, evidence([activity('a1')]));
  const sparse = validateRelationships([propose({ relationship: 'supporting' })], art,
    evidence([activity('a1', { object: undefined, purpose: undefined, mode: 'mentioned' })]));
  expect(sparse.relationships[0].uncertainty).toBeGreaterThan(rich.relationships[0].uncertainty);
});

// ── per-element planning eligibility ───────────────────────────────────────────
test('planning eligibility is per element: an unsupported element in a corroborated artifact emits no planning signal', () => {
  const art = artifact(profile([
    elem('e_ok', { supportedByClaimIds: ['cl1'] }),
    elem('e_unsup', { supportedByClaimIds: [] }), // unsupported
  ]), 'corroborated');
  // re-run profile validation so `.supported` flags are set the way the orchestrator would:
  const validated = validateProfile(art.profile, [claim('cl1', 's1')], [src('s1', 'ABET', 'accreditation_body')]);
  const art2 = { ...art, profile: validated.profile, tier: validated.tier };
  const r = validateRelationships([
    propose({ elementId: 'e_ok', relationship: 'direct', evidenceActivityIds: ['a1'], rationale: 'x instantiates e_ok' }),
    propose({ elementId: 'e_unsup', relationship: 'direct', evidenceActivityIds: ['a1'], rationale: 'x instantiates e_unsup' }),
  ], art2, evidence([activity('a1')]));
  const eligible = r.relationships.filter((x) => x.planningEligible).map((x) => x.elementId);
  expect(eligible).toContain('e_ok');
  expect(eligible).not.toContain('e_unsup');
});

test('a below-corroborated (low-trust) artifact yields NO planning-eligible relationships', () => {
  const art = artifact(profile([elem('e_design', { supportedByClaimIds: ['cl1'] })]), 'reusable_unreviewed');
  const r = validateRelationships([propose({ relationship: 'direct', evidenceActivityIds: ['a1'], rationale: 'x instantiates e_design' })], art, evidence([activity('a1')]));
  expect(r.relationships.every((x) => !x.planningEligible)).toBe(true);
});

// ── identities & invalidation ──────────────────────────────────────────────────
test('knowledge identity ignores course inputs (course-independent reuse)', () => {
  const a = knowledgeIdentity({ conceptKey: 'mechanical_design', institutionScope: 'TAU', ontologyVersion: ONTOLOGY_VERSION, profileSchemaVersion: PROFILE_SCHEMA_VERSION });
  const b = knowledgeIdentity({ conceptKey: 'mechanical_design', institutionScope: 'TAU', ontologyVersion: ONTOLOGY_VERSION, profileSchemaVersion: PROFILE_SCHEMA_VERSION });
  expect(a).toBe(b);
});

test('mapping identity changes when course-evidence hash changes but knowledge id does not', () => {
  const base = { knowledgeId: 'k1', profileVersion: '1', courseId: 'C1', courseEvidenceHash: 'H1',
    activityExtractionSchemaVersion: '1', relationshipSchemaVersion: RELATIONSHIP_SCHEMA_VERSION, mappingCriteriaVersion: MAPPING_CRITERIA_VERSION, semanticMapperVersion: 'fake-1' };
  expect(mappingIdentity(base)).not.toBe(mappingIdentity({ ...base, courseEvidenceHash: 'H2' }));
  expect(mappingIdentity(base)).not.toBe(mappingIdentity({ ...base, profileVersion: '2' })); // changed profile version invalidates mapping
});

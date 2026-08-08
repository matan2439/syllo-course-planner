/**
 * Slice 1 — runtime KnowledgeCapability orchestration (plan-inert, injected fakes only,
 * no network/paid calls). Proves the hit/miss lifecycle, that a knowledge cache hit skips
 * research+synthesis but STILL maps the current course, invocation counts, ambiguity pause,
 * safe-fail vs quarantine, low-trust persistence without planning signals, and that Generate
 * is untouched (feature default-off).
 */
import { readFileSync } from 'fs';
import { join } from 'path';
import { orchestrateKnowledge, InMemoryKnowledgeStore } from '../../api/ai/knowledge_orchestrator';
import type {
  ResearchProvider, ProfileSynthesisProvider, SemanticMappingProvider,
  KnowledgeRequest, CapabilityProfile, SourceRecord, SourceClaim, CourseEvidence,
} from '../../api/ai/knowledge_types';

const ROOT = join(__dirname, '..', '..');

// ── counting fakes ─────────────────────────────────────────────────────────────
function fakes(opts: { authority?: SourceRecord['authority']; elements?: CapabilityProfile['elements']; badClaimId?: string } = {}) {
  const calls = { research: 0, synthesis: 0, mapping: 0 };
  const source: SourceRecord = { sourceId: 's1', url: 'https://abet.org', title: 'crit', publisher: 'ABET', authority: opts.authority ?? 'accreditation_body', retrievedAt: '2026-08-08', lang: 'en' };
  const sourceClaim: SourceClaim = { claimId: 'cl1', sourceId: 's1', verbatimQuote: 'q', normalizedClaim: 'design produces solutions to needs' };
  const research: ResearchProvider = { research: async () => { calls.research++; return { sources: [source], claims: [sourceClaim] }; } };
  const synthesis: ProfileSynthesisProvider = { synthesize: async ({ concept }) => { calls.synthesis++;
    return { conceptId: concept.conceptId, profileVersion: '1',
      elements: opts.elements ?? [{ elementId: 'e_design', kind: 'activity', text: 'modify geometry to meet requirements', necessity: 'necessary', supportedByClaimIds: [opts.badClaimId ?? 'cl1'], origin: 'sourced' }],
      conflicts: [] }; } };
  const mapping: SemanticMappingProvider = { map: async (_profile, activities) => { calls.mapping++;
    return activities.map((a) => ({ conceptId: 'concept_x', elementId: 'e_design', courseId: 'C1', relationship: 'direct' as const,
      evidenceActivityIds: [a.activityId], rationale: 'the student modifies geometry to satisfy requirements' })); } };
  return { calls, research, synthesis, mapping };
}

const evidence = (courseId = 'C1', hash = 'H1'): CourseEvidence => ({ courseId, courseEvidenceHash: hash, lang: 'en',
  activities: [{ activityId: 'a1', action: 'modify', object: 'geometry', purpose: 'meet requirements', method: 'CAD',
    agency: 'modify', mode: 'assessed', excerpt: 'modify the geometry', startOffset: 0, endOffset: 17 }] });
const req = (over: Partial<KnowledgeRequest> = {}): KnowledgeRequest => ({
  concept: { conceptId: 'concept_x', label: 'mechanical design', requiresClarification: false },
  institutionScope: 'TAU', lang: 'en', courseEvidence: evidence(), ...over });

// ── isolation / feature-off ────────────────────────────────────────────────────
test('Generate does not import the knowledge orchestrator (feature default-off, planner untouched)', () => {
  const src = readFileSync(join(ROOT, 'api', 'ai', 'generate-plan.ts'), 'utf8');
  expect(src).not.toMatch(/knowledge_orchestrator/);
  expect(src).not.toMatch(/orchestrateKnowledge/);
});

// ── ambiguity pause ────────────────────────────────────────────────────────────
test('a materially ambiguous concept pauses for clarification BEFORE any research/synthesis spend', async () => {
  const f = fakes();
  const res = await orchestrateKnowledge(
    req({ concept: { conceptId: 'design', label: 'design', requiresClarification: true, candidateMeanings: [
      { conceptId: 'mech_design', gloss: 'mechanical design' }, { conceptId: 'ux_design', gloss: 'UX design' }] } }),
    { ...f, store: new InMemoryKnowledgeStore() });
  expect(res.status).toBe('needs_clarification');
  expect(f.calls).toEqual({ research: 0, synthesis: 0, mapping: 0 });
});

// ── miss path ──────────────────────────────────────────────────────────────────
test('a cache MISS researches, synthesizes, validates, stores a KnowledgeArtifact, and maps the course', async () => {
  const f = fakes();
  const store = new InMemoryKnowledgeStore();
  const res = await orchestrateKnowledge(req(), { ...f, store });
  expect(res.status).toBe('grounded');
  expect(f.calls).toEqual({ research: 1, synthesis: 1, mapping: 1 });
  expect(res.status === 'grounded' && res.knowledgeArtifact.tier).toBe('corroborated');
});

// ── knowledge HIT still maps ───────────────────────────────────────────────────
test('a second request (same concept, valid fresh knowledge) skips research+synthesis but STILL maps the course', async () => {
  const f = fakes();
  const store = new InMemoryKnowledgeStore();
  await orchestrateKnowledge(req(), { ...f, store });
  await orchestrateKnowledge(req(), { ...f, store });
  expect(f.calls).toEqual({ research: 1, synthesis: 1, mapping: 2 }); // research/synthesis once; mapping every request
});

test('the same concept against a DIFFERENT course reuses knowledge but performs a fresh mapping', async () => {
  const f = fakes();
  const store = new InMemoryKnowledgeStore();
  await orchestrateKnowledge(req(), { ...f, store });
  await orchestrateKnowledge(req({ courseEvidence: evidence('C2', 'H2') }), { ...f, store });
  expect(f.calls).toEqual({ research: 1, synthesis: 1, mapping: 2 });
});

test('a changed course-evidence hash re-maps (knowledge reused), never re-researching', async () => {
  const f = fakes();
  const store = new InMemoryKnowledgeStore();
  await orchestrateKnowledge(req(), { ...f, store });
  await orchestrateKnowledge(req({ courseEvidence: evidence('C1', 'H_CHANGED') }), { ...f, store });
  expect(f.calls.research).toBe(1);
  expect(f.calls.mapping).toBe(2);
});

// ── low-trust persistence, no planning ─────────────────────────────────────────
test('a structurally valid but low-authority artifact is stored at a low tier and emits NO planning signals', async () => {
  const f = fakes({ authority: 'general_web' }); // valid + grounded, but low authority
  const store = new InMemoryKnowledgeStore();
  const res = await orchestrateKnowledge(req(), { ...f, store });
  expect(res.status).toBe('grounded');
  if (res.status === 'grounded') {
    expect(res.knowledgeArtifact.tier).not.toBe('corroborated');
    expect(res.planningSignals).toHaveLength(0);       // no planning influence from low-trust knowledge
  }
});

// ── quarantine vs safe-fail ────────────────────────────────────────────────────
test('provenance-invalid synthesis (element cites a nonexistent claim) is quarantined, not stored as valid', async () => {
  const f = fakes({ badClaimId: 'ghost' });
  const store = new InMemoryKnowledgeStore();
  const res = await orchestrateKnowledge(req(), { ...f, store });
  expect(res.status).toBe('insufficient');
  if (res.status === 'insufficient') expect(res.quarantined).toBe(true);
  expect(store.size()).toBe(0);                        // never persisted as valid knowledge
});

test('a failing research provider fails safe (no artifact, no planning), never throws', async () => {
  const f = fakes();
  const boom: ResearchProvider = { research: async () => { throw new Error('provider down'); } };
  const store = new InMemoryKnowledgeStore();
  const res = await orchestrateKnowledge(req(), { ...f, research: boom, store });
  expect(res.status).toBe('insufficient');
  expect(f.calls.synthesis).toBe(0);
  expect(store.size()).toBe(0);
});

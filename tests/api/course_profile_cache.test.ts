/**
 * Versioned validated-profile cache. Cache identity = courseId + source content hash
 * + schema/ontology/extractor versions. A cached profile is reused only when the
 * snapshot still matches and versions are compatible; otherwise refresh is required.
 */
import {
  lookupProfile,
  buildValidatedProfile,
  SCHEMA_VERSION,
  ONTOLOGY_VERSION,
  EXTRACTOR_VERSION,
  type ProfileCache,
  type ValidatedProfile,
} from '../../api/ai/course_profile_cache';
import type { SyllabusSnapshot } from '../../api/ai/syllabus_snapshot';

const snap = (hash: string): SyllabusSnapshot => ({
  courseId: '0542-4425', institution: 'TAU', programOrCatalog: 'mech', sourceType: 'official_syllabus',
  sourceUrl: 'https://ims.tau.ac.il/x', sourceAuthority: 'tau_official_syllabus', sourceYear: 2025,
  language: 'he', retrievedAt: '2026-06-10T00:00:00Z', contentHash: hash, normalizedContent: 'שיטות התכן',
});

const profile = (over: Partial<ValidatedProfile> = {}): ValidatedProfile => ({
  courseId: '0542-4425', snapshotHash: 'abc', schemaVersion: SCHEMA_VERSION, ontologyVersion: ONTOLOGY_VERSION,
  extractorVersion: EXTRACTOR_VERSION, extractorName: 'captured', extractorKind: 'captured', evaluatedCapabilities: ['mechanical_design'],
  evidence: [{ courseId: '0542-4425', capability: 'mechanical_design', claim: 'x', strength: 0.9, sourceType: 'official_syllabus', sourceUrl: 'u', sourceAuthority: 'tau_official_syllabus', sourceYear: 2025, extractedEvidence: 'שיטות התכן', inferenceLevel: 'explicit', confidence: 0.8, retrievedAt: 't' }],
  quarantined: [], createdAt: '2026-08-07', ...over,
});
const cache = (p: ValidatedProfile): ProfileCache => ({ programOrCatalog: 'mech', generatedAt: 't', schemaVersion: SCHEMA_VERSION, ontologyVersion: ONTOLOGY_VERSION, extractorVersion: EXTRACTOR_VERSION, extractorName: 'captured', extractorKind: 'captured', profiles: { [p.courseId]: p } });

test('valid matching profile → cache HIT with the requested capability evidence', () => {
  const r = lookupProfile(cache(profile()), snap('abc'), 'mechanical_design');
  expect(r.status).toBe('hit');
  expect(r.evidence?.strength).toBe(0.9);
});

test('no profile for the course → REFRESH REQUIRED', () => {
  const empty: ProfileCache = { programOrCatalog: 'mech', generatedAt: 't', schemaVersion: SCHEMA_VERSION, ontologyVersion: ONTOLOGY_VERSION, extractorVersion: EXTRACTOR_VERSION, extractorName: 'captured', extractorKind: 'captured', profiles: {} };
  expect(lookupProfile(empty, snap('abc'), 'mechanical_design').status).toBe('refresh_required');
});

test('changed source content hash → STALE (previous derived profile invalid for the new snapshot)', () => {
  const r = lookupProfile(cache(profile({ snapshotHash: 'abc' })), snap('DIFFERENT'), 'mechanical_design');
  expect(r.status).toBe('stale');
});

test('changed schema / ontology / extractor version → REFRESH REQUIRED', () => {
  expect(lookupProfile(cache(profile({ schemaVersion: 'OLD' })), snap('abc'), 'mechanical_design').status).toBe('refresh_required');
  expect(lookupProfile(cache(profile({ ontologyVersion: 'OLD' })), snap('abc'), 'mechanical_design').status).toBe('refresh_required');
  expect(lookupProfile(cache(profile({ extractorVersion: 'OLD' })), snap('abc'), 'mechanical_design').status).toBe('refresh_required');
});

test('a capability that was NEVER evaluated → REFRESH REQUIRED (not a silent miss)', () => {
  const r = lookupProfile(cache(profile({ evaluatedCapabilities: ['mechanical_design'] })), snap('abc'), 'robotics' as any);
  expect(r.status).toBe('refresh_required');
});

test('an evaluated capability with no positive evidence → HIT with insufficient/zero evidence (validated absence, not refresh)', () => {
  const p = profile({ evaluatedCapabilities: ['mechanical_design'], evidence: [] });
  const r = lookupProfile(cache(p), snap('abc'), 'mechanical_design');
  expect(r.status).toBe('insufficient_evidence');
  expect(r.evidence).toBeUndefined();
});

test('buildValidatedProfile stamps all versions + snapshot hash so identity is content-tied', () => {
  const p = buildValidatedProfile({
    snapshot: snap('HASH123'), extractorName: 'captured', extractorKind: 'captured', evaluatedCapabilities: ['mechanical_design'],
    accepted: profile().evidence, quarantined: [],
  });
  expect(p.snapshotHash).toBe('HASH123');
  expect(p.schemaVersion).toBe(SCHEMA_VERSION);
  expect(p.ontologyVersion).toBe(ONTOLOGY_VERSION);
  expect(p.extractorVersion).toBe(EXTRACTOR_VERSION);
});

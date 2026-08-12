/**
 * Slice 15 — authoritative academic-conflict resolution contract.
 *
 * Fact resolution is SEPARATE from the student preference conversation: an
 * ordinary student is never asked which prerequisite/availability/requirement is
 * correct. This is the narrow, auditable domain contract an AUTHORIZED academic
 * actor would use; it is rejected without adequate authority + provenance. No UI,
 * no persistence, no Supabase.
 */
import { validateAuthoritativeResolution, AUTHORITY_TYPES } from '../../api/ai/authoritative_resolution';

const VALID = {
  conflictId: 'GROUNDING_AVAILABILITY_CONFLICT:CORE',
  correctedFact: { kind: 'availability', courseId: 'CORE', value: ['year_4_semester_b'] },
  source: 'tochnit.tau.ac.il',
  provenance: { url: 'https://tochnit.tau.ac.il/CORE', note: 'official catalog' },
  authorityType: 'catalog_admin' as const,
  authorizedActorId: 'advisor-42',
  timestamp: '2026-08-12T00:00:00Z',
  originalConflictingFacts: { catalog: ['year_4_semester_a'], normalized: ['year_4_semester_b'] },
};

describe('validateAuthoritativeResolution', () => {
  test('AUTHORITY_TYPES is a fixed, non-empty allowlist', () => {
    expect(AUTHORITY_TYPES.length).toBeGreaterThan(0);
  });

  test('a fully-authorized, provenance-backed resolution is accepted and preserves the original facts', () => {
    const r = validateAuthoritativeResolution(VALID);
    expect(r.accepted).toBe(true);
    if (r.accepted) {
      expect(r.resolution.conflictId).toBe(VALID.conflictId);
      expect(r.resolution.originalConflictingFacts).toEqual(VALID.originalConflictingFacts);
    }
  });

  test('rejects when the authority type is missing or not allowed', () => {
    const r1 = validateAuthoritativeResolution({ ...VALID, authorityType: undefined as any });
    const r2 = validateAuthoritativeResolution({ ...VALID, authorityType: 'random_student' as any });
    expect(r1.accepted).toBe(false);
    expect(r2.accepted).toBe(false);
    if (!r2.accepted) expect(r2.reasons.join(' ')).toMatch(/authority/i);
  });

  test('rejects when provenance/source is missing (no unsourced fact overrides)', () => {
    const r1 = validateAuthoritativeResolution({ ...VALID, source: '' });
    const r2 = validateAuthoritativeResolution({ ...VALID, provenance: {} as any });
    expect(r1.accepted).toBe(false);
    expect(r2.accepted).toBe(false);
  });

  test('rejects when the authorized actor or timestamp is missing (auditability)', () => {
    expect(validateAuthoritativeResolution({ ...VALID, authorizedActorId: '' }).accepted).toBe(false);
    expect(validateAuthoritativeResolution({ ...VALID, timestamp: '' }).accepted).toBe(false);
  });

  test('rejects when the corrected fact is missing', () => {
    expect(validateAuthoritativeResolution({ ...VALID, correctedFact: undefined as any }).accepted).toBe(false);
  });
});

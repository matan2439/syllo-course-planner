/**
 * PROMOTION POLICY — kept strictly separate from extraction. A live profile is
 * PRESERVED verbatim (never clamped); promotion eligibility is a separate judgement:
 * a returned inference level that exceeds an EXTERNALLY-SUPPLIED reviewed ceiling makes
 * the course promotion-ineligible (disagreement recorded), and a mixed captured/live
 * cache is never eligible. The reviewed benchmark is an input, never mutated here.
 */
import { assessCachePromotion, exceedsCeiling } from '../../api/ai/semantic_promotion_policy';
import type { ProfileCache, ValidatedProfile } from '../../api/ai/course_profile_cache';

function prof(courseId: string, kind: 'live_semantic' | 'captured', level: string | null): ValidatedProfile {
  const evidence = level
    ? [{ courseId, capability: 'mechanical_design' as any, claim: 'c', strength: level === 'explicit' ? 0.9 : 0.6,
        sourceType: 'official_syllabus' as const, sourceUrl: 'u', sourceAuthority: 'tau_official_syllabus', sourceYear: 2025,
        extractedEvidence: 'e', inferenceLevel: level as any, confidence: level === 'explicit' ? 0.9 : 0.6, retrievedAt: 't' }]
    : [];
  return {
    courseId, snapshotHash: 'h', schemaVersion: '1', ontologyVersion: '1', extractorVersion: '1',
    extractorName: kind === 'live_semantic' ? 'llm:gpt-4o-mini' : 'captured-review-v1', extractorKind: kind,
    evaluatedCapabilities: ['mechanical_design'], evidence, quarantined: [], createdAt: '2026-08-08',
  };
}
function cache(profiles: ValidatedProfile[], kind: 'live_semantic' | 'captured' = 'live_semantic'): ProfileCache {
  return { programOrCatalog: 'p', generatedAt: 't', schemaVersion: '1', ontologyVersion: '1', extractorVersion: '1',
    extractorName: 'x', extractorKind: kind, profiles: Object.fromEntries(profiles.map((p) => [p.courseId, p])) };
}

test('exceedsCeiling ranks inference levels (explicit > derived > estimated > missing)', () => {
  expect(exceedsCeiling('explicit', 'derived')).toBe(true);
  expect(exceedsCeiling('derived', 'derived')).toBe(false);
  expect(exceedsCeiling('derived', 'explicit')).toBe(false);
  expect(exceedsCeiling('missing', 'missing')).toBe(false);
});

test('a live profile within its reviewed ceiling is promotion-eligible', () => {
  const c = cache([prof('A', 'live_semantic', 'derived')]);
  const r = assessCachePromotion(c, { A: 'derived' });
  expect(r.perCourse[0]).toMatchObject({ courseId: 'A', eligible: true });
});

test('0542-4226 case: live explicit vs reviewed derived → promotion-ineligible, disagreement recorded, profile NOT mutated', () => {
  const p = prof('0542-4226', 'live_semantic', 'explicit');
  const c = cache([p]);
  const r = assessCachePromotion(c, { '0542-4226': 'derived' });
  expect(r.eligible).toBe(false);
  const row = r.perCourse.find((x) => x.courseId === '0542-4226')!;
  expect(row.eligible).toBe(false);
  expect(row.reason).toMatch(/exceeds|ceiling|derived|explicit/i);
  // extraction preserved verbatim — policy never clamps the raw result:
  expect(p.evidence[0].inferenceLevel).toBe('explicit');
  expect(p.evidence[0].confidence).toBe(0.9);
});

test('a reviewed no_design course with a live empty result is eligible (ceiling missing, level none)', () => {
  const c = cache([prof('B', 'live_semantic', null)]);
  const r = assessCachePromotion(c, { B: 'missing' });
  expect(r.perCourse[0].eligible).toBe(true);
});

test('a mixed captured/live cache is NEVER cache-eligible (homogeneity required)', () => {
  const c = cache([prof('A', 'live_semantic', 'derived'), prof('B', 'captured', 'derived')]);
  const r = assessCachePromotion(c, { A: 'derived', B: 'derived' });
  expect(r.homogeneousLive).toBe(false);
  expect(r.eligible).toBe(false);
});

test('a fully homogeneous live set within all ceilings is cache-eligible', () => {
  const c = cache([prof('A', 'live_semantic', 'derived'), prof('B', 'live_semantic', 'explicit')]);
  const r = assessCachePromotion(c, { A: 'derived', B: 'explicit' });
  expect(r.homogeneousLive).toBe(true);
  expect(r.eligible).toBe(true);
});

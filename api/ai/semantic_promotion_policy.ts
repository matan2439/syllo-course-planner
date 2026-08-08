/**
 * PROMOTION POLICY — deliberately separate from extraction. Extraction preserves whatever
 * the model returned (never clamped); this module is a pure, read-only judgement over a
 * candidate cache: is it eligible to replace the committed one?
 *
 * Two independent gates, both required:
 *  1. HOMOGENEITY — every profile must be `live_semantic` (the committed cache invariant
 *     forbids a mixed captured/live cache; a partial live set is never eligible).
 *  2. REVIEWED CEILING — a returned inference level must not EXCEED the externally-supplied
 *     human-reviewed ceiling for that course. A disagreement (e.g. live `explicit` vs
 *     reviewed `derived`) marks the course ineligible WITHOUT altering the raw extraction
 *     or the reviewed benchmark (ceilings are an input here, never written).
 */
import type { ProfileCache } from './course_profile_cache';

const RANK: Record<string, number> = { missing: 0, none: 0, estimated: 1, derived: 2, explicit: 3 };
const rank = (level: string | undefined): number => RANK[level ?? 'missing'] ?? 0;

/** True when `level` is a strictly stronger inference level than the reviewed `ceiling`. */
export function exceedsCeiling(level: string, ceiling: string): boolean {
  return rank(level) > rank(ceiling);
}

export interface CoursePromotionAssessment {
  courseId: string;
  eligible: boolean;
  returnedLevel: string;
  ceiling?: string;
  reason?: string;
}
export interface CachePromotionAssessment {
  eligible: boolean;
  homogeneousLive: boolean;
  perCourse: CoursePromotionAssessment[];
}

/**
 * Assess whether `cache` is eligible for promotion given `ceilings` (courseId → reviewed
 * inference level). Pure and read-only: neither the cache/profiles nor `ceilings` are mutated.
 */
export function assessCachePromotion(cache: ProfileCache, ceilings: Record<string, string>): CachePromotionAssessment {
  const profiles = Object.values(cache.profiles ?? {});
  const homogeneousLive = profiles.length > 0 && profiles.every((p) => p.extractorKind === 'live_semantic');

  const perCourse: CoursePromotionAssessment[] = profiles.map((p) => {
    // strongest inference level the model returned for this course (missing when no evidence).
    const returnedLevel = (p.evidence ?? []).reduce<string>((acc, e) => (rank(e.inferenceLevel) > rank(acc) ? e.inferenceLevel : acc), 'missing');
    const ceiling = ceilings[p.courseId];
    if (ceiling && exceedsCeiling(returnedLevel, ceiling)) {
      return { courseId: p.courseId, eligible: false, returnedLevel, ceiling, reason: `returned ${returnedLevel} exceeds reviewed ceiling ${ceiling}` };
    }
    return { courseId: p.courseId, eligible: true, returnedLevel, ceiling };
  });

  return { eligible: homogeneousLive && perCourse.every((c) => c.eligible), homogeneousLive, perCourse };
}

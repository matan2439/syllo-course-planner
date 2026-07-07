/**
 * Course Topic Profile resolver — a thin, deterministic lookup over a static
 * courseId->CourseTopicProfile map. It never fabricates a profile at
 * resolution time: an unknown course id resolves to null (single) or is
 * reported in missingCourseIds (batch). Missing data stays explicit — this is
 * the boundary that keeps "we have no topic data for course X" honest rather
 * than silently invented.
 *
 * createStaticCourseTopicProfileResolver takes a defensive shallow copy of the
 * map, so a caller mutating their map afterwards cannot change resolution, and
 * the resolver never writes back to the caller's map.
 *
 * Pure/read-only: no DB, no LLM, no generate-plan/PlannerWorker/UI coupling.
 */

import type { CourseTopicProfile } from './course_topic_profile';

export interface CourseTopicProfileResolution {
  /** Only the requested ids that resolved, keyed by course id. */
  profilesByCourseId: Record<string, CourseTopicProfile>;
  /** Requested ids that resolved, first-seen order, deduped. */
  matchedCourseIds: string[];
  /** Requested ids with no profile, first-seen order, deduped. */
  missingCourseIds: string[];
  notes: string[];
}

export interface CourseTopicProfileResolver {
  resolveCourseTopicProfile(courseId: string): CourseTopicProfile | null;
  resolveCourseTopicProfiles(courseIds: string[]): CourseTopicProfileResolution;
}

export function createStaticCourseTopicProfileResolver(
  profilesByCourseId: Record<string, CourseTopicProfile>,
): CourseTopicProfileResolver {
  // Defensive shallow copy: later mutation of the caller's map must not leak in,
  // and we must never write back to it.
  const store: Record<string, CourseTopicProfile> = { ...profilesByCourseId };

  function resolveCourseTopicProfile(courseId: string): CourseTopicProfile | null {
    return Object.prototype.hasOwnProperty.call(store, courseId) ? store[courseId] : null;
  }

  function resolveCourseTopicProfiles(courseIds: string[]): CourseTopicProfileResolution {
    const profilesByCourseId: Record<string, CourseTopicProfile> = {};
    const matchedCourseIds: string[] = [];
    const missingCourseIds: string[] = [];
    const seen = new Set<string>();

    for (const id of courseIds) {
      if (seen.has(id)) continue;
      seen.add(id);
      const profile = resolveCourseTopicProfile(id);
      if (profile) {
        matchedCourseIds.push(id);
        profilesByCourseId[id] = profile;
      } else {
        missingCourseIds.push(id);
      }
    }

    const notes: string[] = [];
    if (missingCourseIds.length > 0) {
      notes.push(`${missingCourseIds.length} requested course id(s) have no topic profile (missing, not fabricated).`);
    }

    return { profilesByCourseId, matchedCourseIds, missingCourseIds, notes };
  }

  return { resolveCourseTopicProfile, resolveCourseTopicProfiles };
}

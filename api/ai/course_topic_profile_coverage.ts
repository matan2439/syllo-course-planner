/**
 * Course Topic Profile coverage audit — measures, deterministically, how much
 * of a course-id universe a resolver can supply a topic profile for.
 *
 * The whole point is HONESTY: missing profiles are enumerated explicitly in
 * missingCourseIds (and surfaced in a note), never rounded away. coverageRatio
 * is exact (covered / unique-total). An empty universe is treated as fully
 * covered (ratio 1) — there is nothing left uncovered — with an explanatory
 * note so the 1 is not mistaken for "audited real courses".
 *
 * Read-only: reuses the resolver's own resolveCourseTopicProfiles; no DB, no
 * generate-plan/PlannerWorker/UI coupling.
 */

import type { CourseTopicProfileResolver } from './course_topic_profile_resolver';

export interface CourseTopicProfileCoverageAudit {
  totalCourseIds: number;
  coveredCourseIds: string[];
  missingCourseIds: string[];
  /** covered / unique-total, exact; 1 for an empty universe. */
  coverageRatio: number;
  notes: string[];
}

export function auditCourseTopicProfileCoverage(
  allCourseIds: string[],
  resolver: CourseTopicProfileResolver,
): CourseTopicProfileCoverageAudit {
  const resolution = resolver.resolveCourseTopicProfiles(allCourseIds);
  const coveredCourseIds = resolution.matchedCourseIds;
  const missingCourseIds = resolution.missingCourseIds;
  const totalCourseIds = coveredCourseIds.length + missingCourseIds.length;

  const coverageRatio = totalCourseIds === 0 ? 1 : coveredCourseIds.length / totalCourseIds;

  const notes: string[] = [];
  if (totalCourseIds === 0) {
    notes.push('No course ids to audit — treated as fully covered (ratio 1).');
  } else if (missingCourseIds.length > 0) {
    notes.push(
      `${missingCourseIds.length} of ${totalCourseIds} course id(s) are missing a topic profile (explicitly uncovered).`,
    );
  } else {
    notes.push(`All ${totalCourseIds} course id(s) have a topic profile.`);
  }

  return { totalCourseIds, coveredCourseIds, missingCourseIds, coverageRatio, notes };
}

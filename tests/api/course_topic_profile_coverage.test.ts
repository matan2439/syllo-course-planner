/**
 * Course Topic Profile coverage audit — tests for api/ai/course_topic_profile_coverage.ts.
 *
 * auditCourseTopicProfileCoverage(allCourseIds, resolver) reports, deterministically,
 * how much of a course-id universe the resolver can supply a topic profile for.
 * Missing profiles are explicit (never hidden); the ratio is exact.
 */

import { auditCourseTopicProfileCoverage } from '../../api/ai/course_topic_profile_coverage';
import { createStaticCourseTopicProfileResolver } from '../../api/ai/course_topic_profile_resolver';
import { normalizeCourseTopicProfile } from '../../api/ai/course_topic_profile';
import type { CourseTopicProfile } from '../../api/ai/course_topic_profile';

function resolverFor(...ids: string[]) {
  const map: Record<string, CourseTopicProfile> = {};
  for (const id of ids) map[id] = normalizeCourseTopicProfile({ courseId: id, topics: [{ area: 'fluids', weight: 0.5 }] });
  return createStaticCourseTopicProfileResolver(map);
}

describe('auditCourseTopicProfileCoverage', () => {
  test('reports totalCourseIds (unique)', () => {
    const audit = auditCourseTopicProfileCoverage(['C1', 'C2', 'C2'], resolverFor('C1', 'C2'));
    expect(audit.totalCourseIds).toBe(2);
  });

  test('reports coveredCourseIds in deterministic first-seen order', () => {
    const audit = auditCourseTopicProfileCoverage(['C2', 'C1', 'X'], resolverFor('C1', 'C2'));
    expect(audit.coveredCourseIds).toEqual(['C2', 'C1']);
  });

  test('reports missingCourseIds explicitly in deterministic first-seen order', () => {
    const audit = auditCourseTopicProfileCoverage(['C1', 'Z', 'Y'], resolverFor('C1'));
    expect(audit.missingCourseIds).toEqual(['Z', 'Y']);
  });

  test('computes an exact coverageRatio', () => {
    const audit = auditCourseTopicProfileCoverage(['C1', 'C2', 'C3', 'C4'], resolverFor('C1', 'C2', 'C3'));
    expect(audit.coverageRatio).toBe(0.75);
  });

  test('full coverage yields coverageRatio 1', () => {
    const audit = auditCourseTopicProfileCoverage(['C1', 'C2'], resolverFor('C1', 'C2'));
    expect(audit.coverageRatio).toBe(1);
  });

  test('zero coverage yields coverageRatio 0 and lists all as missing', () => {
    const audit = auditCourseTopicProfileCoverage(['C1', 'C2'], resolverFor());
    expect(audit.coverageRatio).toBe(0);
    expect(audit.missingCourseIds).toEqual(['C1', 'C2']);
  });

  test('an empty universe is treated as fully covered (ratio 1) with a note', () => {
    const audit = auditCourseTopicProfileCoverage([], resolverFor('C1'));
    expect(audit.totalCourseIds).toBe(0);
    expect(audit.coverageRatio).toBe(1);
    expect(audit.notes.length).toBeGreaterThan(0);
  });

  test('missing profiles surface in a note (not silently hidden)', () => {
    const audit = auditCourseTopicProfileCoverage(['C1', 'X'], resolverFor('C1'));
    expect(audit.notes.some((n) => n.toLowerCase().includes('missing') || n.includes('1'))).toBe(true);
  });

  test('deduplicates the universe before auditing', () => {
    const audit = auditCourseTopicProfileCoverage(['C1', 'C1', 'X', 'X'], resolverFor('C1'));
    expect(audit.totalCourseIds).toBe(2);
    expect(audit.coveredCourseIds).toEqual(['C1']);
    expect(audit.missingCourseIds).toEqual(['X']);
  });

  test('does not mutate the input course-id list', () => {
    const ids = ['C1', 'C1', 'X'];
    const snapshot = [...ids];
    auditCourseTopicProfileCoverage(ids, resolverFor('C1'));
    expect(ids).toEqual(snapshot);
  });
});

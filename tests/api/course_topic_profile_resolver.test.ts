/**
 * Course Topic Profile resolver — tests for api/ai/course_topic_profile_resolver.ts.
 *
 * createStaticCourseTopicProfileResolver wraps a courseId->CourseTopicProfile
 * map into a resolver that looks up (never fabricates) profiles. Resolution is
 * deterministic: matchedCourseIds / missingCourseIds preserve first-seen input
 * order after de-duplication; missing ids are explicit; nothing is mutated.
 */

import {
  createStaticCourseTopicProfileResolver,
} from '../../api/ai/course_topic_profile_resolver';
import { normalizeCourseTopicProfile } from '../../api/ai/course_topic_profile';
import type { CourseTopicProfile } from '../../api/ai/course_topic_profile';

function makeMap(...ids: string[]): Record<string, CourseTopicProfile> {
  const map: Record<string, CourseTopicProfile> = {};
  for (const id of ids) {
    map[id] = normalizeCourseTopicProfile({ courseId: id, topics: [{ area: 'fluids', weight: 0.5 }] });
  }
  return map;
}

describe('createStaticCourseTopicProfileResolver', () => {
  test('resolveCourseTopicProfile returns the stored profile for a known id', () => {
    const resolver = createStaticCourseTopicProfileResolver(makeMap('C1'));
    expect(resolver.resolveCourseTopicProfile('C1')?.courseId).toBe('C1');
  });

  test('resolveCourseTopicProfile returns null for an unknown id (no fabrication)', () => {
    const resolver = createStaticCourseTopicProfileResolver(makeMap('C1'));
    expect(resolver.resolveCourseTopicProfile('NOPE')).toBeNull();
  });

  test('resolveCourseTopicProfiles matches known ids and reports missing ones', () => {
    const resolver = createStaticCourseTopicProfileResolver(makeMap('C1', 'C2'));
    const res = resolver.resolveCourseTopicProfiles(['C1', 'X', 'C2', 'Y']);
    expect(res.matchedCourseIds).toEqual(['C1', 'C2']);
    expect(res.missingCourseIds).toEqual(['X', 'Y']);
  });

  test('resolveCourseTopicProfiles returns a profilesByCourseId containing only matched ids', () => {
    const resolver = createStaticCourseTopicProfileResolver(makeMap('C1', 'C2', 'C3'));
    const res = resolver.resolveCourseTopicProfiles(['C1', 'X']);
    expect(Object.keys(res.profilesByCourseId).sort()).toEqual(['C1']);
    expect(res.profilesByCourseId.C1.courseId).toBe('C1');
  });

  test('deduplicates requested ids (first-seen order) across matched and missing', () => {
    const resolver = createStaticCourseTopicProfileResolver(makeMap('C1'));
    const res = resolver.resolveCourseTopicProfiles(['C1', 'C1', 'X', 'X', 'C1']);
    expect(res.matchedCourseIds).toEqual(['C1']);
    expect(res.missingCourseIds).toEqual(['X']);
  });

  test('does not return profiles for ids that were not requested', () => {
    const resolver = createStaticCourseTopicProfileResolver(makeMap('C1', 'C2'));
    const res = resolver.resolveCourseTopicProfiles(['C1']);
    expect(res.profilesByCourseId.C2).toBeUndefined();
  });

  test('emits a deterministic note when some requested ids are missing', () => {
    const resolver = createStaticCourseTopicProfileResolver(makeMap('C1'));
    const res = resolver.resolveCourseTopicProfiles(['C1', 'X', 'Y']);
    expect(res.notes.some((n) => n.includes('2'))).toBe(true);
  });

  test('emits no missing-id note when everything resolves', () => {
    const resolver = createStaticCourseTopicProfileResolver(makeMap('C1'));
    const res = resolver.resolveCourseTopicProfiles(['C1']);
    expect(res.missingCourseIds).toEqual([]);
    expect(res.notes.every((n) => !n.toLowerCase().includes('missing'))).toBe(true);
  });

  test('an empty requested list resolves to empty matched/missing deterministically', () => {
    const resolver = createStaticCourseTopicProfileResolver(makeMap('C1'));
    const res = resolver.resolveCourseTopicProfiles([]);
    expect(res.matchedCourseIds).toEqual([]);
    expect(res.missingCourseIds).toEqual([]);
    expect(res.profilesByCourseId).toEqual({});
  });

  test('an empty static map reports every requested id as missing', () => {
    const resolver = createStaticCourseTopicProfileResolver({});
    const res = resolver.resolveCourseTopicProfiles(['C1', 'C2']);
    expect(res.matchedCourseIds).toEqual([]);
    expect(res.missingCourseIds).toEqual(['C1', 'C2']);
  });

  test('does not mutate the input profile map', () => {
    const map = makeMap('C1');
    const snapshot = JSON.parse(JSON.stringify(map));
    const resolver = createStaticCourseTopicProfileResolver(map);
    resolver.resolveCourseTopicProfiles(['C1', 'X']);
    expect(map).toEqual(snapshot);
  });

  test('does not mutate the requested course-id list', () => {
    const resolver = createStaticCourseTopicProfileResolver(makeMap('C1'));
    const ids = ['C1', 'C1', 'X'];
    const snapshot = [...ids];
    resolver.resolveCourseTopicProfiles(ids);
    expect(ids).toEqual(snapshot);
  });

  test('mutating the caller map after construction does not change resolution (defensive copy)', () => {
    const map = makeMap('C1');
    const resolver = createStaticCourseTopicProfileResolver(map);
    delete map.C1;
    expect(resolver.resolveCourseTopicProfile('C1')?.courseId).toBe('C1');
  });
});

/**
 * Interest-to-Course Matching Helper — tests for api/ai/interest_course_match.ts.
 *
 * matchCourseToAcademicInterests is the deterministic, pure bridge between
 * user-side intent (AcademicInterestProfile) and course-side content
 * (CourseTopicProfile). NOT Interest Alignment Scoring inside the planner:
 * scorePlan/planner_goals.ts, generated plans, generate-plan.ts, and all
 * runtime behavior are untouched by this epic.
 */

import {
  emptyAcademicInterestProfile,
  normalizeAcademicInterestProfile,
} from '../../api/ai/academic_interest_profile';
import type { AcademicInterestProfile } from '../../api/ai/academic_interest_profile';
import { emptyCourseTopicProfile, normalizeCourseTopicProfile } from '../../api/ai/course_topic_profile';
import type { CourseTopicProfile } from '../../api/ai/course_topic_profile';
import { applyInterestClarificationAnswers } from '../../api/ai/academic_interest_answers';
import { matchCourseToAcademicInterests } from '../../api/ai/interest_course_match';

describe('matchCourseToAcademicInterests', () => {
  test('an empty user profile gives a deterministic zero fit', () => {
    const course = normalizeCourseTopicProfile({
      courseId: 'ME101',
      topics: [{ area: 'fluids', weight: 0.9 }],
      styles: [{ style: 'project_based', weight: 0.8 }],
    });
    const result = matchCourseToAcademicInterests(emptyAcademicInterestProfile(), course);
    expect(result.interestFitScore).toBe(0);
    expect(result.focusMatchScore).toBe(0);
    expect(result.styleMatchScore).toBe(0);
    expect(result.avoidPenalty).toBe(0);
    expect(result.matchedFocusAreas).toEqual([]);
    expect(result.matchedStyles).toEqual([]);
    expect(result.avoidedAreas).toEqual([]);
  });

  test('an empty course topic profile gives a deterministic zero fit, regardless of a rich user profile', () => {
    const profile = normalizeAcademicInterestProfile({
      focusAreas: [{ area: 'fluids', weight: 1 }],
      avoidAreas: [{ area: 'materials', weight: 1 }],
      courseStylePreferences: [{ style: 'project_based', weight: 1 }],
    });
    const result = matchCourseToAcademicInterests(profile, emptyCourseTopicProfile('ME101'));
    expect(result.interestFitScore).toBe(0);
    expect(result.focusMatchScore).toBe(0);
    expect(result.styleMatchScore).toBe(0);
    expect(result.avoidPenalty).toBe(0);
    expect(result.matchedFocusAreas).toEqual([]);
    expect(result.avoidedAreas).toEqual([]);
  });

  test('a matching focus area increases focusMatchScore', () => {
    const profile = normalizeAcademicInterestProfile({ focusAreas: [{ area: 'fluids', weight: 1 }] });
    const course = normalizeCourseTopicProfile({ courseId: 'ME101', topics: [{ area: 'fluids', weight: 0.8 }] });
    const result = matchCourseToAcademicInterests(profile, course);
    expect(result.focusMatchScore).toBeCloseTo(0.8);
    expect(result.matchedFocusAreas).toEqual([
      { area: 'fluids', userWeight: 1, courseWeight: 0.8, contribution: 0.8 },
    ]);
  });

  test('a higher course topic weight produces a higher contribution (monotonic)', () => {
    const profile = normalizeAcademicInterestProfile({ focusAreas: [{ area: 'fluids', weight: 1 }] });
    const weakCourse = normalizeCourseTopicProfile({ courseId: 'ME101', topics: [{ area: 'fluids', weight: 0.3 }] });
    const strongCourse = normalizeCourseTopicProfile({ courseId: 'ME102', topics: [{ area: 'fluids', weight: 0.9 }] });
    const weak = matchCourseToAcademicInterests(profile, weakCourse);
    const strong = matchCourseToAcademicInterests(profile, strongCourse);
    expect(strong.focusMatchScore).toBeGreaterThan(weak.focusMatchScore);
    expect(strong.matchedFocusAreas[0].contribution).toBeGreaterThan(weak.matchedFocusAreas[0].contribution);
  });

  test('multiple focus areas combine deterministically (weighted average across the user\'s own areas)', () => {
    const profile = normalizeAcademicInterestProfile({
      focusAreas: [
        { area: 'materials', weight: 1 },
        { area: 'strength_analysis', weight: 0.5 },
      ],
    });
    const course = normalizeCourseTopicProfile({
      courseId: 'ME101',
      topics: [
        { area: 'materials', weight: 0.6 },
        { area: 'strength_analysis', weight: 0.4 },
      ],
    });
    const result = matchCourseToAcademicInterests(profile, course);
    // strength_analysis sorts before materials canonically — matches profile.focusAreas order.
    expect(result.matchedFocusAreas.map((m) => m.area)).toEqual(['strength_analysis', 'materials']);
    // (0.5*0.4 + 1*0.6) / 2 = (0.2 + 0.6) / 2 = 0.4
    expect(result.focusMatchScore).toBeCloseTo(0.4);
  });

  test('matching course styles increase styleMatchScore', () => {
    const profile = normalizeAcademicInterestProfile({
      courseStylePreferences: [{ style: 'project_based', weight: 1 }],
    });
    const course = normalizeCourseTopicProfile({
      courseId: 'ME101',
      styles: [{ style: 'project_based', weight: 0.7 }],
    });
    const result = matchCourseToAcademicInterests(profile, course);
    expect(result.styleMatchScore).toBeCloseTo(0.7);
    expect(result.matchedStyles).toEqual([
      { style: 'project_based', userWeight: 1, courseWeight: 0.7, contribution: 0.7 },
    ]);
  });

  test('avoid areas produce a positive avoidPenalty when the course covers them', () => {
    const profile = normalizeAcademicInterestProfile({ avoidAreas: [{ area: 'materials', weight: 1 }] });
    const course = normalizeCourseTopicProfile({ courseId: 'ME101', topics: [{ area: 'materials', weight: 0.9 }] });
    const result = matchCourseToAcademicInterests(profile, course);
    expect(result.avoidPenalty).toBeCloseTo(0.9);
    expect(result.avoidedAreas).toEqual([
      { area: 'materials', userWeight: 1, courseWeight: 0.9, penalty: 0.9 },
    ]);
  });

  test('avoid penalty reduces the final interestFitScore compared to an otherwise-identical course with no avoided overlap', () => {
    const profile = normalizeAcademicInterestProfile({
      focusAreas: [{ area: 'fluids', weight: 1 }],
      avoidAreas: [{ area: 'materials', weight: 1 }],
    });
    const withoutAvoidOverlap = normalizeCourseTopicProfile({
      courseId: 'ME101',
      topics: [{ area: 'fluids', weight: 0.8 }],
    });
    const withAvoidOverlap = normalizeCourseTopicProfile({
      courseId: 'ME102',
      topics: [
        { area: 'fluids', weight: 0.8 },
        { area: 'materials', weight: 0.6 },
      ],
    });
    const clean = matchCourseToAcademicInterests(profile, withoutAvoidOverlap);
    const penalized = matchCourseToAcademicInterests(profile, withAvoidOverlap);
    expect(penalized.interestFitScore).toBeLessThan(clean.interestFitScore);
  });

  test('final interestFitScore is clamped to 0 when avoidPenalty exceeds the base score', () => {
    const profile = normalizeAcademicInterestProfile({
      focusAreas: [{ area: 'fluids', weight: 0.3 }],
      avoidAreas: [{ area: 'materials', weight: 1 }],
    });
    const course = normalizeCourseTopicProfile({
      courseId: 'ME101',
      topics: [
        { area: 'fluids', weight: 0.3 },
        { area: 'materials', weight: 1 },
      ],
    });
    const result = matchCourseToAcademicInterests(profile, course);
    expect(result.interestFitScore).toBe(0);
    expect(result.interestFitScore).toBeGreaterThanOrEqual(0);
    expect(result.interestFitScore).toBeLessThanOrEqual(1);
  });

  test('a focus/avoid conflict on the same area is represented explicitly in both arrays, not hidden', () => {
    const profile = normalizeAcademicInterestProfile({
      focusAreas: [{ area: 'fluids', weight: 1 }],
      avoidAreas: [{ area: 'fluids', weight: 1 }],
    });
    const course = normalizeCourseTopicProfile({ courseId: 'ME101', topics: [{ area: 'fluids', weight: 1 }] });
    const result = matchCourseToAcademicInterests(profile, course);
    expect(result.matchedFocusAreas).toEqual([{ area: 'fluids', userWeight: 1, courseWeight: 1, contribution: 1 }]);
    expect(result.avoidedAreas).toEqual([{ area: 'fluids', userWeight: 1, courseWeight: 1, penalty: 1 }]);
    // base (focusMatchScore=1) fully cancelled by avoidPenalty (1) -> clamped to 0, but both sub-scores stay visible.
    expect(result.focusMatchScore).toBe(1);
    expect(result.avoidPenalty).toBe(1);
    expect(result.interestFitScore).toBe(0);
  });

  test('stable ordering: identical interests supplied in a different input order produce identical matchedFocusAreas', () => {
    const profileA = normalizeAcademicInterestProfile({
      focusAreas: [
        { area: 'materials', weight: 0.5 },
        { area: 'strength_analysis', weight: 0.5 },
      ],
    });
    const profileB = normalizeAcademicInterestProfile({
      focusAreas: [
        { area: 'strength_analysis', weight: 0.5 },
        { area: 'materials', weight: 0.5 },
      ],
    });
    const course = normalizeCourseTopicProfile({
      courseId: 'ME101',
      topics: [
        { area: 'materials', weight: 0.5 },
        { area: 'strength_analysis', weight: 0.5 },
      ],
    });
    const resultA = matchCourseToAcademicInterests(profileA, course);
    const resultB = matchCourseToAcademicInterests(profileB, course);
    expect(resultA.matchedFocusAreas).toEqual(resultB.matchedFocusAreas);
    expect(resultA.matchedFocusAreas.map((m) => m.area)).toEqual(['strength_analysis', 'materials']);
  });

  test('does not mutate the AcademicInterestProfile input', () => {
    const profile = normalizeAcademicInterestProfile({ focusAreas: [{ area: 'fluids', weight: 1 }] });
    const snapshot = JSON.parse(JSON.stringify(profile));
    matchCourseToAcademicInterests(profile, normalizeCourseTopicProfile({ courseId: 'ME101' }));
    expect(profile).toEqual(snapshot);
  });

  test('does not mutate the CourseTopicProfile input', () => {
    const course = normalizeCourseTopicProfile({ courseId: 'ME101', topics: [{ area: 'fluids', weight: 0.5 }] });
    const snapshot = JSON.parse(JSON.stringify(course));
    matchCourseToAcademicInterests(emptyAcademicInterestProfile(), course);
    expect(course).toEqual(snapshot);
  });

  test('the courseId in the result matches the input CourseTopicProfile', () => {
    const course = normalizeCourseTopicProfile({ courseId: 'ME999' });
    const result = matchCourseToAcademicInterests(emptyAcademicInterestProfile(), course);
    expect(result.courseId).toBe('ME999');
  });

  test('an unexpressed dimension (no style preferences at all) does not drag down the fit as if it were a mismatch', () => {
    // User only expressed a focus-area interest, fully matched; no style opinion at all.
    const profileFocusOnly = normalizeAcademicInterestProfile({ focusAreas: [{ area: 'fluids', weight: 1 }] });
    const course = normalizeCourseTopicProfile({ courseId: 'ME101', topics: [{ area: 'fluids', weight: 1 }] });
    const result = matchCourseToAcademicInterests(profileFocusOnly, course);
    // If the unexpressed style dimension were counted as 0, base would be (1+0)/2=0.5. It must not be.
    expect(result.interestFitScore).toBe(1);
  });
});

describe('integration: interest answers -> AcademicInterestProfile -> course match', () => {
  test('answers applied into a profile, matched against an aligned course, produce a positive fit', () => {
    const { profile } = applyInterestClarificationAnswers(emptyAcademicInterestProfile(), [
      { questionId: 'academic_focus_areas', value: ['fluids'] },
    ]);
    const course = normalizeCourseTopicProfile({ courseId: 'ME301', topics: [{ area: 'fluids', weight: 0.9 }] });
    const result = matchCourseToAcademicInterests(profile, course);
    expect(result.interestFitScore).toBeGreaterThan(0);
  });

  test('an avoid-area answer, matched against a course dominated by that avoided topic, reports a penalty', () => {
    const { profile } = applyInterestClarificationAnswers(emptyAcademicInterestProfile(), [
      { questionId: 'academic_avoid_areas', value: ['materials'] },
    ]);
    const course = normalizeCourseTopicProfile({ courseId: 'ME201', topics: [{ area: 'materials', weight: 1 }] });
    const result = matchCourseToAcademicInterests(profile, course);
    expect(result.avoidPenalty).toBeGreaterThan(0);
    expect(result.avoidedAreas).toContainEqual(expect.objectContaining({ area: 'materials' }));
  });

  test('a project_based style answer, matched against a project_based course, contributes positively to styleMatchScore', () => {
    const { profile } = applyInterestClarificationAnswers(emptyAcademicInterestProfile(), [
      { questionId: 'course_style_preferences', value: ['project_based'] },
    ]);
    const course = normalizeCourseTopicProfile({ courseId: 'ME401', styles: [{ style: 'project_based', weight: 0.8 }] });
    const result = matchCourseToAcademicInterests(profile, course);
    expect(result.styleMatchScore).toBeGreaterThan(0);
    expect(result.matchedStyles).toContainEqual(expect.objectContaining({ style: 'project_based' }));
  });
});

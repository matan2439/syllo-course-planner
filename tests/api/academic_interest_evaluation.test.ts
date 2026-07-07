/**
 * Academic Interest Evaluation Facade — tests for api/ai/academic_interest_evaluation.ts.
 *
 * evaluateAcademicInterestFit is a pure, deterministic composition helper: given
 * an AcademicInterestProfile, a courseId->CourseTopicProfile map, and a flat list
 * of planned course ids, it composes scorePlanInterestAlignment and
 * buildInterestPlanScorecard (both unmodified) into one evidence package. It
 * does not recompute matching, does not re-normalize already-normalized inputs,
 * and is not wired into any production path.
 */

import {
  emptyAcademicInterestProfile,
  normalizeAcademicInterestProfile,
} from '../../api/ai/academic_interest_profile';
import { normalizeCourseTopicProfile } from '../../api/ai/course_topic_profile';
import type { CourseTopicProfile } from '../../api/ai/course_topic_profile';
import { scorePlanInterestAlignment } from '../../api/ai/interest_plan_alignment';
import { buildInterestPlanScorecard } from '../../api/ai/interest_plan_scorecard';
import { evaluateAcademicInterestFit } from '../../api/ai/academic_interest_evaluation';

describe('evaluateAcademicInterestFit', () => {
  test('an empty AcademicInterestProfile yields hasMeaningfulAcademicInterests=false, deterministically', () => {
    const result = evaluateAcademicInterestFit({
      academicInterestProfile: emptyAcademicInterestProfile(),
      courseTopicProfilesByCourseId: {
        C1: normalizeCourseTopicProfile({ courseId: 'C1', topics: [{ area: 'fluids', weight: 0.9 }] }),
      },
      plannedCourseIds: ['C1'],
    });
    expect(result.hasMeaningfulAcademicInterests).toBe(false);
    expect(result.alignment.interestAlignmentScore).toBe(0);
    expect(result.scorecard.summaryLevel).toBe('none');
  });

  test('a meaningful AcademicInterestProfile yields hasMeaningfulAcademicInterests=true', () => {
    const profile = normalizeAcademicInterestProfile({ focusAreas: [{ area: 'fluids', weight: 1 }] });
    const result = evaluateAcademicInterestFit({
      academicInterestProfile: profile,
      courseTopicProfilesByCourseId: {
        C1: normalizeCourseTopicProfile({ courseId: 'C1', topics: [{ area: 'fluids', weight: 0.9 }] }),
      },
      plannedCourseIds: ['C1'],
    });
    expect(result.hasMeaningfulAcademicInterests).toBe(true);
  });

  test('composes alignment and scorecard exactly as their own direct calls would produce', () => {
    const profile = normalizeAcademicInterestProfile({
      focusAreas: [{ area: 'fluids', weight: 1 }],
      avoidAreas: [{ area: 'materials', weight: 1 }],
      courseStylePreferences: [{ style: 'project_based', weight: 1 }],
    });
    const courseTopicProfilesByCourseId: Record<string, CourseTopicProfile> = {
      C1: normalizeCourseTopicProfile({
        courseId: 'C1',
        topics: [{ area: 'fluids', weight: 1 }],
        styles: [{ style: 'project_based', weight: 0.8 }],
      }),
      C2: normalizeCourseTopicProfile({
        courseId: 'C2',
        topics: [
          { area: 'fluids', weight: 0.3 },
          { area: 'materials', weight: 0.9 },
        ],
      }),
    };
    const plannedCourseIds = ['C1', 'C2', 'C3'];

    const expectedAlignment = scorePlanInterestAlignment({
      academicInterestProfile: profile,
      courseTopicProfilesByCourseId,
      plannedCourseIds,
    });
    const expectedScorecard = buildInterestPlanScorecard(expectedAlignment);

    const result = evaluateAcademicInterestFit({
      academicInterestProfile: profile,
      courseTopicProfilesByCourseId,
      plannedCourseIds,
    });

    expect(result.alignment).toEqual(expectedAlignment);
    expect(result.scorecard).toEqual(expectedScorecard);
  });

  test('a matched planned course appears in evaluatedCourseIds', () => {
    const profile = normalizeAcademicInterestProfile({ focusAreas: [{ area: 'fluids', weight: 1 }] });
    const result = evaluateAcademicInterestFit({
      academicInterestProfile: profile,
      courseTopicProfilesByCourseId: {
        C1: normalizeCourseTopicProfile({ courseId: 'C1', topics: [{ area: 'fluids', weight: 1 }] }),
      },
      plannedCourseIds: ['C1'],
    });
    expect(result.evaluatedCourseIds).toEqual(['C1']);
  });

  test('a planned course missing a CourseTopicProfile appears in unmatchedCourseIds', () => {
    const profile = normalizeAcademicInterestProfile({ focusAreas: [{ area: 'fluids', weight: 1 }] });
    const result = evaluateAcademicInterestFit({
      academicInterestProfile: profile,
      courseTopicProfilesByCourseId: {
        C1: normalizeCourseTopicProfile({ courseId: 'C1', topics: [{ area: 'fluids', weight: 1 }] }),
      },
      plannedCourseIds: ['C1', 'C2'],
    });
    expect(result.evaluatedCourseIds).toEqual(['C1']);
    expect(result.unmatchedCourseIds).toEqual(['C2']);
  });

  test('scorecard.matchedFocusAreas reflects the preserved per-course breakdown', () => {
    const profile = normalizeAcademicInterestProfile({ focusAreas: [{ area: 'fluids', weight: 1 }] });
    const result = evaluateAcademicInterestFit({
      academicInterestProfile: profile,
      courseTopicProfilesByCourseId: {
        C1: normalizeCourseTopicProfile({ courseId: 'C1', topics: [{ area: 'fluids', weight: 1 }] }),
      },
      plannedCourseIds: ['C1'],
    });
    expect(result.scorecard.matchedFocusAreas).toEqual([
      { area: 'fluids', contribution: 1, courseIds: ['C1'] },
    ]);
  });

  test('scorecard.matchedStyles reflects the preserved per-course breakdown', () => {
    const profile = normalizeAcademicInterestProfile({
      courseStylePreferences: [{ style: 'project_based', weight: 1 }],
    });
    const result = evaluateAcademicInterestFit({
      academicInterestProfile: profile,
      courseTopicProfilesByCourseId: {
        C1: normalizeCourseTopicProfile({ courseId: 'C1', styles: [{ style: 'project_based', weight: 0.5 }] }),
      },
      plannedCourseIds: ['C1'],
    });
    expect(result.scorecard.matchedStyles).toEqual([
      { style: 'project_based', contribution: 0.5, courseIds: ['C1'] },
    ]);
  });

  test('avoid penalties are visible through scorecard.avoidRiskCourses and notes', () => {
    const profile = normalizeAcademicInterestProfile({
      focusAreas: [{ area: 'fluids', weight: 1 }],
      avoidAreas: [{ area: 'materials', weight: 1 }],
    });
    const result = evaluateAcademicInterestFit({
      academicInterestProfile: profile,
      courseTopicProfilesByCourseId: {
        C1: normalizeCourseTopicProfile({
          courseId: 'C1',
          topics: [
            { area: 'fluids', weight: 0.8 },
            { area: 'materials', weight: 0.6 },
          ],
        }),
      },
      plannedCourseIds: ['C1'],
    });
    expect(result.scorecard.avoidRiskCourses.map((c) => c.courseId)).toEqual(['C1']);
    expect(result.notes.some((n) => n.toLowerCase().includes('avoid'))).toBe(true);
  });

  test('evaluatedCourseIds/unmatchedCourseIds are stable regardless of the courseTopicProfilesByCourseId key insertion order', () => {
    const profile = normalizeAcademicInterestProfile({ focusAreas: [{ area: 'fluids', weight: 1 }] });
    const mapA: Record<string, CourseTopicProfile> = {
      C2: normalizeCourseTopicProfile({ courseId: 'C2', topics: [{ area: 'fluids', weight: 0.5 }] }),
      C4: normalizeCourseTopicProfile({ courseId: 'C4', topics: [{ area: 'fluids', weight: 0.9 }] }),
    };
    const mapB: Record<string, CourseTopicProfile> = {
      C4: normalizeCourseTopicProfile({ courseId: 'C4', topics: [{ area: 'fluids', weight: 0.9 }] }),
      C2: normalizeCourseTopicProfile({ courseId: 'C2', topics: [{ area: 'fluids', weight: 0.5 }] }),
    };
    const plannedCourseIds = ['C4', 'C3', 'C2', 'C1'];
    const resultA = evaluateAcademicInterestFit({
      academicInterestProfile: profile,
      courseTopicProfilesByCourseId: mapA,
      plannedCourseIds,
    });
    const resultB = evaluateAcademicInterestFit({
      academicInterestProfile: profile,
      courseTopicProfilesByCourseId: mapB,
      plannedCourseIds,
    });
    expect(resultA.evaluatedCourseIds).toEqual(['C4', 'C2']);
    expect(resultA.unmatchedCourseIds).toEqual(['C3', 'C1']);
    expect(resultB.evaluatedCourseIds).toEqual(resultA.evaluatedCourseIds);
    expect(resultB.unmatchedCourseIds).toEqual(resultA.unmatchedCourseIds);
  });

  test('does not mutate the AcademicInterestProfile input', () => {
    const profile = normalizeAcademicInterestProfile({ focusAreas: [{ area: 'fluids', weight: 1 }] });
    const snapshot = JSON.parse(JSON.stringify(profile));
    evaluateAcademicInterestFit({
      academicInterestProfile: profile,
      courseTopicProfilesByCourseId: {
        C1: normalizeCourseTopicProfile({ courseId: 'C1', topics: [{ area: 'fluids', weight: 1 }] }),
      },
      plannedCourseIds: ['C1'],
    });
    expect(profile).toEqual(snapshot);
  });

  test('does not mutate the CourseTopicProfile map input', () => {
    const map: Record<string, CourseTopicProfile> = {
      C1: normalizeCourseTopicProfile({ courseId: 'C1', topics: [{ area: 'fluids', weight: 1 }] }),
    };
    const snapshot = JSON.parse(JSON.stringify(map));
    evaluateAcademicInterestFit({
      academicInterestProfile: normalizeAcademicInterestProfile({ focusAreas: [{ area: 'fluids', weight: 1 }] }),
      courseTopicProfilesByCourseId: map,
      plannedCourseIds: ['C1'],
    });
    expect(map).toEqual(snapshot);
  });

  test('handles empty plannedCourseIds gracefully', () => {
    const profile = normalizeAcademicInterestProfile({ focusAreas: [{ area: 'fluids', weight: 1 }] });
    expect(() =>
      evaluateAcademicInterestFit({
        academicInterestProfile: profile,
        courseTopicProfilesByCourseId: {},
        plannedCourseIds: [],
      }),
    ).not.toThrow();
    const result = evaluateAcademicInterestFit({
      academicInterestProfile: profile,
      courseTopicProfilesByCourseId: {},
      plannedCourseIds: [],
    });
    expect(result.evaluatedCourseIds).toEqual([]);
    expect(result.unmatchedCourseIds).toEqual([]);
    expect(result.alignment.interestAlignmentScore).toBe(0);
  });

  test('handles an empty CourseTopicProfile map gracefully', () => {
    const profile = normalizeAcademicInterestProfile({ focusAreas: [{ area: 'fluids', weight: 1 }] });
    expect(() =>
      evaluateAcademicInterestFit({
        academicInterestProfile: profile,
        courseTopicProfilesByCourseId: {},
        plannedCourseIds: ['C1', 'C2'],
      }),
    ).not.toThrow();
    const result = evaluateAcademicInterestFit({
      academicInterestProfile: profile,
      courseTopicProfilesByCourseId: {},
      plannedCourseIds: ['C1', 'C2'],
    });
    expect(result.unmatchedCourseIds).toEqual(['C1', 'C2']);
    expect(result.evaluatedCourseIds).toEqual([]);
  });

  test('does not re-declare the AcademicFocusArea/CourseStyle canonical enum lists (imports only, no duplication)', () => {
    const fs = require('fs') as typeof import('fs');
    const path = require('path') as typeof import('path');
    const source = fs.readFileSync(
      path.join(__dirname, '../../api/ai/academic_interest_evaluation.ts'),
      'utf8',
    );
    expect(source).not.toMatch(/export const ACADEMIC_FOCUS_AREAS/);
    expect(source).not.toMatch(/export const COURSE_STYLES/);
  });
});

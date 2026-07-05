/**
 * Plan Interest Scorecard (opt-in) — tests for api/ai/interest_plan_scorecard.ts.
 *
 * buildInterestPlanScorecard is a pure, deterministic explanation-layer helper:
 * given an InterestPlanAlignmentResult (from interest_plan_alignment.ts), it
 * produces a user-facing (but non-LLM) scorecard summarizing why a plan does
 * or does not align with an AcademicInterestProfile. It performs NO matching
 * recomputation — everything it reports is derived from fields already present
 * on the alignment result.
 */

import { buildInterestPlanScorecard } from '../../api/ai/interest_plan_scorecard';
import type { InterestPlanAlignmentResult, InterestPlanCourseMatch } from '../../api/ai/interest_plan_alignment';
import {
  emptyAcademicInterestProfile,
  normalizeAcademicInterestProfile,
} from '../../api/ai/academic_interest_profile';
import { normalizeCourseTopicProfile } from '../../api/ai/course_topic_profile';
import type { CourseTopicProfile } from '../../api/ai/course_topic_profile';
import { scorePlanInterestAlignment } from '../../api/ai/interest_plan_alignment';

function match(overrides: Partial<InterestPlanCourseMatch> & { courseId: string }): InterestPlanCourseMatch {
  return {
    interestFitScore: 0,
    focusMatchScore: 0,
    styleMatchScore: 0,
    avoidPenalty: 0,
    ...overrides,
  };
}

function alignment(overrides: Partial<InterestPlanAlignmentResult> = {}): InterestPlanAlignmentResult {
  return {
    interestAlignmentScore: 0,
    matchedCourseIds: [],
    unmatchedCourseIds: [],
    courseMatches: [],
    notes: [],
    ...overrides,
  };
}

describe('buildInterestPlanScorecard', () => {
  test('empty/zero alignment produces summaryLevel none', () => {
    const scorecard = buildInterestPlanScorecard(alignment());
    expect(scorecard.summaryLevel).toBe('none');
    expect(scorecard.interestAlignmentScore).toBe(0);
  });

  test('summaryLevel thresholds are deterministic: low, medium, high', () => {
    expect(buildInterestPlanScorecard(alignment({ interestAlignmentScore: 0.1 })).summaryLevel).toBe('low');
    expect(buildInterestPlanScorecard(alignment({ interestAlignmentScore: 0.39 })).summaryLevel).toBe('low');
    expect(buildInterestPlanScorecard(alignment({ interestAlignmentScore: 0.4 })).summaryLevel).toBe('medium');
    expect(buildInterestPlanScorecard(alignment({ interestAlignmentScore: 0.69 })).summaryLevel).toBe('medium');
    expect(buildInterestPlanScorecard(alignment({ interestAlignmentScore: 0.7 })).summaryLevel).toBe('high');
    expect(buildInterestPlanScorecard(alignment({ interestAlignmentScore: 1 })).summaryLevel).toBe('high');
  });

  test('topAlignedCourses sorted by interestFitScore desc, then courseId asc', () => {
    const courseMatches = [
      match({ courseId: 'C3', interestFitScore: 0.5 }),
      match({ courseId: 'C1', interestFitScore: 0.8 }),
      match({ courseId: 'C2', interestFitScore: 0.8 }),
      match({ courseId: 'C4', interestFitScore: 0.2 }),
    ];
    const scorecard = buildInterestPlanScorecard(
      alignment({ interestAlignmentScore: 0.6, matchedCourseIds: ['C3', 'C1', 'C2', 'C4'], courseMatches }),
    );
    expect(scorecard.topAlignedCourses.map((c) => c.courseId)).toEqual(['C1', 'C2', 'C3', 'C4']);
  });

  test('avoidRiskCourses sorted by avoidPenalty desc, then courseId asc; zero-penalty courses excluded', () => {
    const courseMatches = [
      match({ courseId: 'C1', avoidPenalty: 0 }),
      match({ courseId: 'C3', avoidPenalty: 0.4 }),
      match({ courseId: 'C2', avoidPenalty: 0.4 }),
      match({ courseId: 'C4', avoidPenalty: 0.9 }),
    ];
    const scorecard = buildInterestPlanScorecard(
      alignment({ matchedCourseIds: ['C1', 'C3', 'C2', 'C4'], courseMatches }),
    );
    expect(scorecard.avoidRiskCourses.map((c) => c.courseId)).toEqual(['C4', 'C2', 'C3']);
  });

  test('unmatchedCourseIds are preserved deterministically from the alignment result', () => {
    const scorecard = buildInterestPlanScorecard(
      alignment({ unmatchedCourseIds: ['C9', 'C2', 'C7'] }),
    );
    expect(scorecard.unmatchedCourseIds).toEqual(['C9', 'C2', 'C7']);
  });

  test('notes include an unmatched-course warning when unmatchedCourseIds exist', () => {
    const scorecard = buildInterestPlanScorecard(
      alignment({
        matchedCourseIds: ['C1'],
        unmatchedCourseIds: ['C2', 'C3'],
        courseMatches: [match({ courseId: 'C1', interestFitScore: 0.5 })],
        interestAlignmentScore: 0.5,
      }),
    );
    expect(scorecard.notes.some((n) => n.includes('2') && n.toLowerCase().includes('no topic profile'))).toBe(true);
  });

  test('notes include an avoid-penalty warning when avoid penalties exist', () => {
    const scorecard = buildInterestPlanScorecard(
      alignment({
        matchedCourseIds: ['C1'],
        courseMatches: [match({ courseId: 'C1', interestFitScore: 0.3, avoidPenalty: 0.5 })],
        interestAlignmentScore: 0.3,
      }),
    );
    expect(scorecard.notes.some((n) => n.toLowerCase().includes('avoid'))).toBe(true);
  });

  test('notes include a strong-alignment note when summaryLevel is high', () => {
    const scorecard = buildInterestPlanScorecard(
      alignment({
        matchedCourseIds: ['C1'],
        courseMatches: [match({ courseId: 'C1', interestFitScore: 0.9 })],
        interestAlignmentScore: 0.9,
      }),
    );
    expect(scorecard.notes.some((n) => n.toLowerCase().includes('strong'))).toBe(true);
  });

  test('notes do NOT include a strong-alignment note when summaryLevel is not high', () => {
    const scorecard = buildInterestPlanScorecard(
      alignment({
        matchedCourseIds: ['C1'],
        courseMatches: [match({ courseId: 'C1', interestFitScore: 0.5 })],
        interestAlignmentScore: 0.5,
      }),
    );
    expect(scorecard.notes.some((n) => n.toLowerCase().includes('strong'))).toBe(false);
  });

  test('notes include a no-academic-interests note when alignmentResult.notes flags it', () => {
    const scorecard = buildInterestPlanScorecard(
      alignment({
        matchedCourseIds: ['C1'],
        courseMatches: [match({ courseId: 'C1' })],
        notes: ['No user academic interests expressed — neutral alignment.'],
      }),
    );
    expect(scorecard.notes.some((n) => n.toLowerCase().includes('academic interests expressed'))).toBe(true);
  });

  test('notes include a no-matched-profiles note when there are planned courses but none matched', () => {
    const scorecard = buildInterestPlanScorecard(
      alignment({ matchedCourseIds: [], unmatchedCourseIds: ['C1', 'C2'], courseMatches: [] }),
    );
    expect(
      scorecard.notes.some((n) => n.toLowerCase().includes('no planned course has a matched topic profile')),
    ).toBe(true);
  });

  test('does not mutate the input alignmentResult', () => {
    const input = alignment({
      matchedCourseIds: ['C1', 'C2'],
      unmatchedCourseIds: ['C3'],
      courseMatches: [
        match({ courseId: 'C1', interestFitScore: 0.7, avoidPenalty: 0.2 }),
        match({ courseId: 'C2', interestFitScore: 0.3 }),
      ],
      interestAlignmentScore: 0.5,
      notes: ['some note'],
    });
    const snapshot = JSON.parse(JSON.stringify(input));
    buildInterestPlanScorecard(input);
    expect(input).toEqual(snapshot);
  });

  test('uses alignmentResult details instead of recomputing from profiles (pure pass-through of fabricated data)', () => {
    // These numbers could never arise from a real matchCourseToAcademicInterests call
    // (interestFitScore > 1 is out of the normal 0..1 range); if the scorecard were
    // recomputing anything from profiles rather than trusting alignmentResult verbatim,
    // this fabricated value could not surface unchanged in the output.
    const courseMatches = [match({ courseId: 'C1', interestFitScore: 1.5 })];
    const scorecard = buildInterestPlanScorecard(
      alignment({ matchedCourseIds: ['C1'], courseMatches, interestAlignmentScore: 1.5 }),
    );
    expect(scorecard.topAlignedCourses[0].interestFitScore).toBe(1.5);
  });

  test('handles empty courseMatches gracefully', () => {
    expect(() => buildInterestPlanScorecard(alignment())).not.toThrow();
    const scorecard = buildInterestPlanScorecard(alignment());
    expect(scorecard.topAlignedCourses).toEqual([]);
    expect(scorecard.avoidRiskCourses).toEqual([]);
  });

  describe('integration with scorePlanInterestAlignment', () => {
    test('builds a scorecard from a real AcademicInterestProfile + CourseTopicProfile map', () => {
      const profile = normalizeAcademicInterestProfile({
        focusAreas: [{ area: 'fluids', weight: 1 }],
        avoidAreas: [{ area: 'materials', weight: 1 }],
      });
      const courseTopicProfilesByCourseId: Record<string, CourseTopicProfile> = {
        C1: normalizeCourseTopicProfile({ courseId: 'C1', topics: [{ area: 'fluids', weight: 1 }] }),
        C2: normalizeCourseTopicProfile({
          courseId: 'C2',
          topics: [
            { area: 'fluids', weight: 0.4 },
            { area: 'materials', weight: 0.9 },
          ],
        }),
      };
      const result = scorePlanInterestAlignment({
        academicInterestProfile: profile,
        courseTopicProfilesByCourseId,
        plannedCourseIds: ['C1', 'C2', 'C3'],
      });
      const scorecard = buildInterestPlanScorecard(result);

      expect(scorecard.interestAlignmentScore).toBe(result.interestAlignmentScore);
      expect(scorecard.topAlignedCourses.map((c) => c.courseId)).toEqual(['C1', 'C2']);
      expect(scorecard.unmatchedCourseIds).toEqual(['C3']);
      expect(scorecard.avoidRiskCourses.map((c) => c.courseId)).toEqual(['C2']);
      expect(scorecard.notes.some((n) => n.toLowerCase().includes('no topic profile'))).toBe(true);
      expect(scorecard.notes.some((n) => n.toLowerCase().includes('avoid'))).toBe(true);
    });

    test('an empty profile against real courses yields a neutral scorecard with the no-interests note', () => {
      const courseTopicProfilesByCourseId: Record<string, CourseTopicProfile> = {
        C1: normalizeCourseTopicProfile({ courseId: 'C1', topics: [{ area: 'fluids', weight: 0.9 }] }),
      };
      const result = scorePlanInterestAlignment({
        academicInterestProfile: emptyAcademicInterestProfile(),
        courseTopicProfilesByCourseId,
        plannedCourseIds: ['C1'],
      });
      const scorecard = buildInterestPlanScorecard(result);
      expect(scorecard.summaryLevel).toBe('none');
      expect(scorecard.notes.some((n) => n.toLowerCase().includes('academic interests expressed'))).toBe(true);
    });
  });
});

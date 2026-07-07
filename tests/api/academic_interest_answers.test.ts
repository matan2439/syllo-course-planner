/**
 * Interest Answer Application — tests for api/ai/academic_interest_answers.ts.
 *
 * applyInterestClarificationAnswers converts structured answers to the 5
 * opt-in Interest Clarification Questions (academic_clarification.ts:
 * academic_focus_areas / academic_avoid_areas / course_style_preferences /
 * optimization_priorities / career_goals) into an AcademicInterestProfile,
 * reusing normalizeAcademicInterestProfile (clamp/dedupe/sort) and
 * mergeAcademicInterestProfiles (override-wins precedence) verbatim.
 *
 * Foundation epic only: no Interest Alignment Scoring, no CourseTopicProfile
 * mapping, no generate-plan/planner-scoring/UI/LLM/Supabase change.
 */

import {
  emptyAcademicInterestProfile,
  normalizeAcademicInterestProfile,
} from '../../api/ai/academic_interest_profile';
import { applyInterestClarificationAnswers } from '../../api/ai/academic_interest_answers';
import type { InterestClarificationAnswer } from '../../api/ai/academic_interest_answers';
import { DeterministicClarificationCapability } from '../../api/ai/academic_clarification';
import type { ClarificationPlanningContext } from '../../api/ai/academic_decision_types';

describe('applyInterestClarificationAnswers', () => {
  test('applies academic_focus_areas into profile.focusAreas (canonically ordered, default weight 1)', () => {
    const result = applyInterestClarificationAnswers(emptyAcademicInterestProfile(), [
      { questionId: 'academic_focus_areas', value: ['robotics', 'fluids'] },
    ]);
    expect(result.profile.focusAreas).toEqual([
      { area: 'fluids', weight: 1 },
      { area: 'robotics', weight: 1 },
    ]);
    expect(result.appliedQuestionIds).toEqual(['academic_focus_areas']);
    expect(result.invalidAnswers).toEqual([]);
  });

  test('applies academic_avoid_areas into profile.avoidAreas, independent of focusAreas', () => {
    const result = applyInterestClarificationAnswers(emptyAcademicInterestProfile(), [
      { questionId: 'academic_avoid_areas', value: ['materials'] },
    ]);
    expect(result.profile.avoidAreas).toEqual([{ area: 'materials', weight: 1 }]);
    expect(result.profile.focusAreas).toEqual([]);
  });

  test('applies course_style_preferences into profile.courseStylePreferences', () => {
    const result = applyInterestClarificationAnswers(emptyAcademicInterestProfile(), [
      { questionId: 'course_style_preferences', value: ['industry_relevant', 'project_based'] },
    ]);
    expect(result.profile.courseStylePreferences).toEqual([
      { style: 'project_based', weight: 1 },
      { style: 'industry_relevant', weight: 1 },
    ]);
  });

  test('applies optimization_priorities into profile.optimizationPriorities', () => {
    const result = applyInterestClarificationAnswers(emptyAcademicInterestProfile(), [
      { questionId: 'optimization_priorities', value: ['low_peak_load', 'degree_completion'] },
    ]);
    expect(result.profile.optimizationPriorities).toEqual([
      { priority: 'degree_completion', weight: 1 },
      { priority: 'low_peak_load', weight: 1 },
    ]);
  });

  test('applies career_goals into profile.careerGoals (single string value, trimmed)', () => {
    const result = applyInterestClarificationAnswers(emptyAcademicInterestProfile(), [
      { questionId: 'career_goals', value: '  automotive design  ' },
    ]);
    expect(result.profile.careerGoals).toEqual(['automotive design']);
    expect(result.appliedQuestionIds).toEqual(['career_goals']);
  });

  test('applies career_goals into profile.careerGoals (string list value)', () => {
    const result = applyInterestClarificationAnswers(emptyAcademicInterestProfile(), [
      { questionId: 'career_goals', value: ['automotive design', '  robotics research  '] },
    ]);
    expect(result.profile.careerGoals).toEqual(['automotive design', 'robotics research']);
  });

  test('supports partial answer sets — only touches the fields actually answered', () => {
    const result = applyInterestClarificationAnswers(emptyAcademicInterestProfile(), [
      { questionId: 'academic_focus_areas', value: ['fluids'] },
    ]);
    expect(result.profile.avoidAreas).toEqual([]);
    expect(result.profile.courseStylePreferences).toEqual([]);
    expect(result.profile.optimizationPriorities).toEqual([]);
    expect(result.profile.careerGoals).toBeUndefined();
    expect(result.appliedQuestionIds).toEqual(['academic_focus_areas']);
  });

  test('does not mutate the base profile', () => {
    const base = normalizeAcademicInterestProfile({ focusAreas: [{ area: 'materials', weight: 0.5 }] });
    const snapshot = JSON.parse(JSON.stringify(base));
    applyInterestClarificationAnswers(base, [{ questionId: 'academic_focus_areas', value: ['fluids'] }]);
    expect(base).toEqual(snapshot);
  });

  test('reports unknown question IDs and does not apply them', () => {
    const result = applyInterestClarificationAnswers(emptyAcademicInterestProfile(), [
      { questionId: 'not_a_real_question', value: ['fluids'] },
    ]);
    expect(result.invalidAnswers).toEqual([
      { questionId: 'not_a_real_question', reason: expect.stringContaining('not_a_real_question') },
    ]);
    expect(result.appliedQuestionIds).toEqual([]);
    expect(result.profile).toEqual(emptyAcademicInterestProfile());
  });

  test('reports invalid AcademicFocusArea values but still applies the valid ones in the same answer', () => {
    const result = applyInterestClarificationAnswers(emptyAcademicInterestProfile(), [
      { questionId: 'academic_focus_areas', value: ['fluids', 'made_up_area'] },
    ]);
    expect(result.invalidAnswers).toEqual([
      { questionId: 'academic_focus_areas', reason: expect.stringContaining('made_up_area') },
    ]);
    expect(result.profile.focusAreas).toEqual([{ area: 'fluids', weight: 1 }]);
    expect(result.appliedQuestionIds).toEqual(['academic_focus_areas']);
  });

  test('reports invalid CourseStyle values', () => {
    const result = applyInterestClarificationAnswers(emptyAcademicInterestProfile(), [
      { questionId: 'course_style_preferences', value: ['bogus_style'] },
    ]);
    expect(result.invalidAnswers).toEqual([
      { questionId: 'course_style_preferences', reason: expect.stringContaining('bogus_style') },
    ]);
    expect(result.profile.courseStylePreferences).toEqual([]);
    expect(result.appliedQuestionIds).toEqual([]);
  });

  test('reports invalid OptimizationPriority values', () => {
    const result = applyInterestClarificationAnswers(emptyAcademicInterestProfile(), [
      { questionId: 'optimization_priorities', value: ['bogus_priority'] },
    ]);
    expect(result.invalidAnswers).toEqual([
      { questionId: 'optimization_priorities', reason: expect.stringContaining('bogus_priority') },
    ]);
    expect(result.profile.optimizationPriorities).toEqual([]);
  });

  test('applies valid answers even when another answer is invalid or unknown', () => {
    const result = applyInterestClarificationAnswers(emptyAcademicInterestProfile(), [
      { questionId: 'academic_focus_areas', value: ['fluids'] },
      { questionId: 'not_a_real_question', value: ['x'] },
      { questionId: 'course_style_preferences', value: ['bogus_style'] },
    ]);
    expect(result.profile.focusAreas).toEqual([{ area: 'fluids', weight: 1 }]);
    expect(result.invalidAnswers.map((a) => a.questionId)).toEqual(['not_a_real_question', 'course_style_preferences']);
    expect(result.appliedQuestionIds).toEqual(['academic_focus_areas']);
  });

  test('appliedQuestionIds ordering is deterministic (canonical order, independent of input order)', () => {
    const result = applyInterestClarificationAnswers(emptyAcademicInterestProfile(), [
      { questionId: 'career_goals', value: 'automotive' },
      { questionId: 'academic_focus_areas', value: ['fluids'] },
      { questionId: 'optimization_priorities', value: ['low_peak_load'] },
    ]);
    expect(result.appliedQuestionIds).toEqual(['academic_focus_areas', 'optimization_priorities', 'career_goals']);
  });

  test('duplicate answers for the same question merge deterministically', () => {
    const result = applyInterestClarificationAnswers(emptyAcademicInterestProfile(), [
      { questionId: 'academic_focus_areas', value: ['fluids'] },
      { questionId: 'academic_focus_areas', value: ['robotics', 'fluids'] },
    ]);
    expect(result.profile.focusAreas).toEqual([
      { area: 'fluids', weight: 1 },
      { area: 'robotics', weight: 1 },
    ]);
    expect(result.appliedQuestionIds).toEqual(['academic_focus_areas']);
  });

  test('an empty multi_choice answer is a no-op — not applied, not reported invalid (a legitimate "chose nothing")', () => {
    const result = applyInterestClarificationAnswers(emptyAcademicInterestProfile(), [
      { questionId: 'academic_focus_areas', value: [] },
    ]);
    expect(result.profile.focusAreas).toEqual([]);
    expect(result.appliedQuestionIds).toEqual([]);
    expect(result.invalidAnswers).toEqual([]);
  });

  test('a malformed (non-array) multi_choice value is reported invalid', () => {
    const result = applyInterestClarificationAnswers(emptyAcademicInterestProfile(), [
      { questionId: 'academic_focus_areas', value: 42 },
    ] as unknown as InterestClarificationAnswer[]);
    expect(result.invalidAnswers).toEqual([
      { questionId: 'academic_focus_areas', reason: expect.any(String) },
    ]);
    expect(result.profile.focusAreas).toEqual([]);
  });

  test('a blank-only career_goals answer is a no-op', () => {
    const result = applyInterestClarificationAnswers(emptyAcademicInterestProfile(), [
      { questionId: 'career_goals', value: '   ' },
    ]);
    expect(result.profile.careerGoals).toBeUndefined();
    expect(result.appliedQuestionIds).toEqual([]);
    expect(result.invalidAnswers).toEqual([]);
  });

  test('merging into a non-empty base profile: the answer (override) wins on a duplicate area', () => {
    const base = normalizeAcademicInterestProfile({
      focusAreas: [{ area: 'materials', weight: 0.3, source: 'user' }],
    });
    const result = applyInterestClarificationAnswers(base, [
      { questionId: 'academic_focus_areas', value: ['materials'] },
    ]);
    expect(result.profile.focusAreas).toEqual([{ area: 'materials', weight: 1 }]);
  });
});

describe('integration: clarification -> interest answers -> clarification', () => {
  const cap = new DeterministicClarificationCapability();
  const ALL_INTEREST_IDS = [
    'academic_focus_areas',
    'academic_avoid_areas',
    'course_style_preferences',
    'optimization_priorities',
    'career_goals',
  ];

  const OTHER_FIELDS_ANSWERED: ClarificationPlanningContext = {
    completedCourseIds: ['c1'],
    currentCourseIds: ['c2'],
    excludedCourseIds: [],
    maxWeeklyHours: 20,
    track: 'systems',
  };

  test('an explicit empty academicInterestProfile makes clarification produce all 5 interest questions', async () => {
    const result = await cap.clarify({
      gaps: [],
      context: { ...OTHER_FIELDS_ANSWERED, academicInterestProfile: emptyAcademicInterestProfile() },
    });
    const interestIds = result.questions.map((q) => q.id).filter((id) => ALL_INTEREST_IDS.includes(id));
    expect(interestIds).toEqual(ALL_INTEREST_IDS);
  });

  test(
    'applying even one valid interest answer suppresses ALL interest questions on re-run ' +
      '(documented limitation: opt-in profile bootstrap, not a per-field completeness checklist)',
    async () => {
      const { profile } = applyInterestClarificationAnswers(emptyAcademicInterestProfile(), [
        { questionId: 'academic_focus_areas', value: ['fluids'] },
      ]);
      const result = await cap.clarify({
        gaps: [],
        context: { ...OTHER_FIELDS_ANSWERED, academicInterestProfile: profile },
      });
      const interestIds = result.questions.map((q) => q.id).filter((id) => ALL_INTEREST_IDS.includes(id));
      // hasMeaningfulAcademicInterests (academic_interest_profile.ts) treats ANY structured
      // preference as sufficient — the existing, deliberately-unchanged gate from the
      // Interest Clarification Questions epic. This is a known, documented limitation:
      // interest questions are an opt-in profile BOOTSTRAP ("has the user told us anything
      // at all?"), not a per-field completeness checklist ("did the user specifically answer
      // avoid_areas?"). Not changed in this epic per its own explicit instruction.
      expect(interestIds).toEqual([]);
    },
  );

  test('existing critical clarification questions remain unaffected before and after applying interest answers', async () => {
    const before = await cap.clarify({ gaps: [], context: { academicInterestProfile: emptyAcademicInterestProfile() } });
    expect(before.questions).toContainEqual(expect.objectContaining({ id: 'completed_courses', critical: true }));
    expect(before.questions).toContainEqual(expect.objectContaining({ id: 'excluded_courses', critical: true }));

    const { profile } = applyInterestClarificationAnswers(emptyAcademicInterestProfile(), [
      { questionId: 'academic_focus_areas', value: ['fluids'] },
    ]);
    const after = await cap.clarify({ gaps: [], context: { academicInterestProfile: profile } });
    expect(after.questions).toContainEqual(expect.objectContaining({ id: 'completed_courses', critical: true }));
    expect(after.questions).toContainEqual(expect.objectContaining({ id: 'excluded_courses', critical: true }));
  });
});

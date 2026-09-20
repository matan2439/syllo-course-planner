/**
 * mergeClarificationAnswersIntoGeneratePlanInputs — tests for
 * api/ai/academic_clarification_plan_inputs.ts.
 *
 * Proves the pure helper that closes the "answers only unblock the preflight
 * gate, they never reach the real planner inputs" seam: it takes generate-plan's
 * own plan_context/preferences shapes plus a batch of clarification_answers and
 * returns updated copies with valid, recognized answers propagated into the
 * canonical existing fields those answers correspond to.
 *
 * Reuses applyClarificationLoopAnswers (academic_clarification_loop.ts) as the
 * sole source of truth for answer validation/shape-checking and the 5 stable
 * question ids — no duplicated validation or id list here.
 */

import {
  mergeClarificationAnswersIntoGeneratePlanInputs,
  type GeneratePlanPreferencesInput,
} from '../../api/ai/academic_clarification_plan_inputs';
import { applyClarificationLoopAnswers } from '../../api/ai/academic_clarification_loop';
import type { ClarificationLoopAnswer } from '../../api/ai/academic_clarification_loop';

describe('mergeClarificationAnswersIntoGeneratePlanInputs', () => {
  test('1. propagates completed_courses into plan_context.personal_status.completed', () => {
    const planContext = { personal_status: { completed: [] } };
    const preferences: GeneratePlanPreferencesInput = {};
    const answers: ClarificationLoopAnswer[] = [
      { questionId: 'completed_courses', value: ['0366_1234'] },
    ];

    const result = mergeClarificationAnswersIntoGeneratePlanInputs(planContext, preferences, answers);

    expect(result.planContext.personal_status.completed).toEqual([{ course_id: '0366_1234' }]);
  });

  test('2. propagates current_courses into plan_context.personal_status.currently_taking', () => {
    const planContext = { personal_status: {} };
    const preferences: GeneratePlanPreferencesInput = {};
    const answers: ClarificationLoopAnswer[] = [
      { questionId: 'current_courses', value: ['0366_5678'] },
    ];

    const result = mergeClarificationAnswersIntoGeneratePlanInputs(planContext, preferences, answers);

    expect(result.planContext.personal_status.currently_taking).toEqual([{ course_id: '0366_5678' }]);
  });

  test('3. propagates excluded_courses into preferences.disallowed_course_ids', () => {
    const planContext = {};
    const preferences: GeneratePlanPreferencesInput = {};
    const answers: ClarificationLoopAnswer[] = [
      { questionId: 'excluded_courses', value: ['FLU'] },
    ];

    const result = mergeClarificationAnswersIntoGeneratePlanInputs(planContext, preferences, answers);

    expect(result.preferences.disallowed_course_ids).toEqual(['FLU']);
  });

  test('4. propagates max_weekly_hours into preferences.max_weekly_hours', () => {
    const planContext = {};
    const preferences: GeneratePlanPreferencesInput = {};
    const answers: ClarificationLoopAnswer[] = [
      { questionId: 'max_weekly_hours', value: 18 },
    ];

    const result = mergeClarificationAnswersIntoGeneratePlanInputs(planContext, preferences, answers);

    expect(result.preferences.max_weekly_hours).toBe(18);
  });

  test('5. track_or_focus has no canonical target field: does not throw, does not add an ad hoc field', () => {
    const planContext = { personal_status: { completed: [{ course_id: 'X' }] } };
    const preferences: GeneratePlanPreferencesInput = { max_weekly_hours: 10 };
    const answers: ClarificationLoopAnswer[] = [
      { questionId: 'track_or_focus', value: 'systems' },
    ];

    const result = mergeClarificationAnswersIntoGeneratePlanInputs(planContext, preferences, answers);

    expect(result.planContext).toEqual(planContext);
    expect(result.preferences).toEqual(preferences);
    expect((result.preferences as any).track).toBeUndefined();
    expect((result.preferences as any).track_or_focus).toBeUndefined();
  });

  test('6. partial answers do not overwrite unrelated existing fields', () => {
    const planContext = { personal_status: { completed: [{ course_id: 'MAND' }] } };
    const preferences: GeneratePlanPreferencesInput & { wanted_course_ids?: string[] } = { max_weekly_hours: 22, wanted_course_ids: ['ELEC'] };
    const answers: ClarificationLoopAnswer[] = [
      { questionId: 'excluded_courses', value: ['FLU'] },
    ];

    const result = mergeClarificationAnswersIntoGeneratePlanInputs(planContext, preferences, answers);

    expect(result.planContext.personal_status.completed).toEqual([{ course_id: 'MAND' }]);
    expect(result.preferences.max_weekly_hours).toBe(22);
    expect((result.preferences as any).wanted_course_ids).toEqual(['ELEC']);
    expect(result.preferences.disallowed_course_ids).toEqual(['FLU']);
  });

  test('7. does not mutate the original planContext/preferences', () => {
    const planContext = { personal_status: { completed: [{ course_id: 'MAND' }] } };
    const preferences: GeneratePlanPreferencesInput = { max_weekly_hours: 22 };
    const planContextBefore = JSON.parse(JSON.stringify(planContext));
    const preferencesBefore = JSON.parse(JSON.stringify(preferences));
    const answers: ClarificationLoopAnswer[] = [
      { questionId: 'completed_courses', value: ['OTHER'] },
      { questionId: 'max_weekly_hours', value: 10 },
    ];

    mergeClarificationAnswersIntoGeneratePlanInputs(planContext, preferences, answers);

    expect(planContext).toEqual(planContextBefore);
    expect(preferences).toEqual(preferencesBefore);
  });

  test('8. invalid answers do not propagate into planning inputs', () => {
    const planContext = {};
    const preferences: GeneratePlanPreferencesInput = { max_weekly_hours: 22 };
    const answers: ClarificationLoopAnswer[] = [
      { questionId: 'max_weekly_hours', value: 'not-a-number' as unknown as number },
    ];

    const result = mergeClarificationAnswersIntoGeneratePlanInputs(planContext, preferences, answers);

    expect(result.preferences.max_weekly_hours).toBe(22);
  });

  test('9. unknown question ids do not propagate into planning inputs', () => {
    const planContext = { personal_status: { completed: [] } };
    const preferences: GeneratePlanPreferencesInput = {};
    const answers: ClarificationLoopAnswer[] = [
      { questionId: 'some_unknown_field', value: ['x'] },
    ];

    const result = mergeClarificationAnswersIntoGeneratePlanInputs(planContext, preferences, answers);

    expect(result.planContext).toEqual(planContext);
    expect(result.preferences).toEqual(preferences);
  });

  test('10. does not duplicate or redefine the stable question ids — matches applyClarificationLoopAnswers directly', () => {
    const answers: ClarificationLoopAnswer[] = [
      { questionId: 'completed_courses', value: ['A'] },
      { questionId: 'excluded_courses', value: ['B'] },
      { questionId: 'max_weekly_hours', value: 12 },
      { questionId: 'current_courses', value: ['C'] },
      { questionId: 'bogus', value: 'x' },
      { questionId: 'max_weekly_hours', value: 'invalid' as unknown as number },
    ];

    const expected = applyClarificationLoopAnswers({ programId: '' }, answers);
    const preferences: GeneratePlanPreferencesInput = {};
    const result = mergeClarificationAnswersIntoGeneratePlanInputs({}, preferences, answers);

    expect(result.planContext.personal_status?.completed).toEqual(
      expected.request.buildModelOptions?.completedCourseIds?.map((course_id) => ({ course_id })),
    );
    expect(result.planContext.personal_status?.currently_taking).toEqual(
      expected.request.currentCourseIds?.map((course_id) => ({ course_id })),
    );
    expect(result.preferences.disallowed_course_ids).toEqual(expected.request.buildModelOptions?.disallowedCourseIds);
  });
});

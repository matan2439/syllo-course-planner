import { applyConversationClarificationAnswers } from '../../api/ai/conversation_clarification';
import { academicStatusDigest } from '../../api/ai/apply_runtime';
import { extractClarificationContext } from '../../api/ai/academic_decision_runtime';
import { clarifyRequest } from '../../api/ai/academic_clarification_loop';

test('answering exclusions preserves recorded courses, their metadata and completion knowledge', () => {
  const personalStatus = {
    completed: [{ course_id: '0542-2400', grade: 91 }],
    currently_taking: [{ course_id: '0542-2500', semester_id: 'semester_5' }],
    completed_knowledge: { status: 'known', provenance: 'explicit_user' },
  };
  const result = applyConversationClarificationAnswers({
    programId: 'mechanical_engineering_2027',
    personalStatus,
    planContext: { personal_status: personalStatus, track: 'mechanical_design' },
    preferences: { max_weekly_hours: 22 },
    answers: [{ questionId: 'excluded_courses', value: [] }],
  });

  expect(result.personalStatus).toEqual({
    completed: [{ course_id: '0542-2400', grade: 91 }],
    currently_taking: [{ course_id: '0542-2500', semester_id: 'semester_5' }],
    completed_knowledge: { status: 'known', provenance: 'explicit_user' },
  });
  expect(result.academicStatusDigest).toBe(academicStatusDigest(personalStatus));
  expect(result.planContext).toEqual({ personal_status: personalStatus, track: 'mechanical_design' });
  expect(result.preferences).toEqual({ max_weekly_hours: 22, disallowed_course_ids: [] });
});

test('a workload answer does not resolve unknown completed courses', async () => {
  const result = applyConversationClarificationAnswers({
    programId: 'mechanical_engineering_2027',
    personalStatus: { completed: [] },
    planContext: {},
    preferences: {},
    answers: [{ questionId: 'max_weekly_hours', value: 22 }],
  });

  expect(result.personalStatus).toEqual({ completed: [] });
  const context = extractClarificationContext(result.planContext, result.preferences, undefined);
  const clarification = await clarifyRequest({
    programId: 'mechanical_engineering_2027',
    buildModelOptions: { completedCourseIds: context.completedCourseIds, maxHoursPerSemester: context.maxWeeklyHours },
  });
  expect(clarification.questions).toEqual(expect.arrayContaining([
    expect.objectContaining({ id: 'completed_courses' }),
  ]));
});

test('successive answers retain earlier course answers for the next planning turn without mutating their source', () => {
  const completed = applyConversationClarificationAnswers({
    programId: 'mechanical_engineering_2027',
    personalStatus: {}, planContext: {}, preferences: { avoid_days: ['friday'] },
    answers: [{ questionId: 'completed_courses', value: ['0542-2400'] }],
  });
  const current = applyConversationClarificationAnswers({
    ...completed, programId: 'mechanical_engineering_2027',
    answers: [{ questionId: 'current_courses', value: ['0542-2500'] }],
  });
  const focus = applyConversationClarificationAnswers({
    ...current, programId: 'mechanical_engineering_2027',
    answers: [{ questionId: 'track_or_focus', value: 'תכן מכני' }],
  });
  const exclusions = applyConversationClarificationAnswers({
    ...focus, programId: 'mechanical_engineering_2027',
    answers: [{ questionId: 'excluded_courses', value: [] }],
  });

  expect(extractClarificationContext(exclusions.planContext, exclusions.preferences, undefined)).toEqual(
    expect.objectContaining({
      completedCourseIds: ['0542-2400'], currentCourseIds: ['0542-2500'],
      excludedCourseIds: [], track: 'תכן מכני',
    }),
  );
  expect(exclusions.preferences).toEqual({ avoid_days: ['friday'], disallowed_course_ids: [] });
  expect(completed.personalStatus).toEqual({
    completed: [{ course_id: '0542-2400' }],
    completed_knowledge: { status: 'known', provenance: 'explicit_user' },
  });
  expect(current.planContext).not.toHaveProperty('track');
  expect(focus.preferences).not.toHaveProperty('disallowed_course_ids');
});

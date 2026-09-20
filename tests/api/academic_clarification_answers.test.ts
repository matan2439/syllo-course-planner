/**
 * applyClarificationAnswers — tests for api/ai/academic_clarification_answers.ts.
 *
 * A pure, no-I/O function that merges answers to ClarificationQuestions back
 * into a fresh AcademicDecisionRequest, ready for a follow-up
 * AcademicDecisionAgent.run() call. It is the inverse of the mapping
 * AcademicDecisionAgent.run() already uses to build a ClarificationPlanningContext
 * from a request (see academic_decision_agent.ts).
 */

import { applyClarificationAnswers } from '../../api/ai/academic_clarification_answers';
import type { AcademicDecisionRequest } from '../../api/ai/academic_decision_agent';

function makeRequest(overrides: Partial<AcademicDecisionRequest> = {}): AcademicDecisionRequest {
  return { programId: 'prog-1', ...overrides };
}

describe('applyClarificationAnswers', () => {
  test('applies a completed_courses answer into buildModelOptions.completedCourseIds', () => {
    const req = makeRequest();
    const updated = applyClarificationAnswers(req, [
      { questionId: 'completed_courses', value: ['0512.1234', '0512.5678'] },
    ]);
    expect(updated.buildModelOptions?.completedCourseIds).toEqual(['0512.1234', '0512.5678']);
  });

  test('applies a current_courses answer into currentCourseIds', () => {
    const req = makeRequest();
    const updated = applyClarificationAnswers(req, [
      { questionId: 'current_courses', value: ['0512.9999'] },
    ]);
    expect(updated.currentCourseIds).toEqual(['0512.9999']);
  });

  test('applies an excluded_courses answer into buildModelOptions.disallowedCourseIds', () => {
    const req = makeRequest();
    const updated = applyClarificationAnswers(req, [
      { questionId: 'excluded_courses', value: ['0512.1111'] },
    ]);
    expect(updated.buildModelOptions?.disallowedCourseIds).toEqual(['0512.1111']);
  });

  test('applies a max_weekly_hours answer into buildModelOptions.maxHoursPerSemester', () => {
    const req = makeRequest();
    const updated = applyClarificationAnswers(req, [
      { questionId: 'max_weekly_hours', value: 15 },
    ]);
    expect(updated.buildModelOptions?.maxHoursPerSemester).toBe(15);
  });

  test('applies a track_or_focus answer into track', () => {
    const req = makeRequest();
    const updated = applyClarificationAnswers(req, [
      { questionId: 'track_or_focus', value: 'systems' },
    ]);
    expect(updated.track).toBe('systems');
  });

  test('does not mutate the input request', () => {
    const req = makeRequest({ buildModelOptions: { completedCourseIds: ['c0'] } });
    const snapshot = JSON.parse(JSON.stringify(req));
    applyClarificationAnswers(req, [{ questionId: 'completed_courses', value: ['c1'] }]);
    expect(req).toEqual(snapshot);
  });

  test('preserves unrelated request fields and existing buildModelOptions values', () => {
    const req = makeRequest({
      dbUrl: 'postgres://x',
      blockOnMissingCriticalInputs: true,
      buildModelOptions: { maxHoursPerSemester: 25 },
    });
    const updated = applyClarificationAnswers(req, [
      { questionId: 'completed_courses', value: ['c1'] },
    ]);
    expect(updated.programId).toBe('prog-1');
    expect(updated.dbUrl).toBe('postgres://x');
    expect(updated.blockOnMissingCriticalInputs).toBe(true);
    expect(updated.buildModelOptions?.maxHoursPerSemester).toBe(25);
  });

  test('ignores answers with an unrecognized questionId', () => {
    const req = makeRequest();
    const updated = applyClarificationAnswers(req, [
      { questionId: 'not_a_real_question', value: ['x'] },
    ]);
    expect(updated).toEqual(req);
  });

  test('applies multiple answers from a single batch together', () => {
    const req = makeRequest();
    const updated = applyClarificationAnswers(req, [
      { questionId: 'completed_courses', value: ['c1'] },
      { questionId: 'track_or_focus', value: 'design' },
    ]);
    expect(updated.buildModelOptions?.completedCourseIds).toEqual(['c1']);
    expect(updated.track).toBe('design');
  });

  test('later answers for the same question win over earlier ones in the same batch', () => {
    const req = makeRequest();
    const updated = applyClarificationAnswers(req, [
      { questionId: 'track_or_focus', value: 'design' },
      { questionId: 'track_or_focus', value: 'systems' },
    ]);
    expect(updated.track).toBe('systems');
  });
});

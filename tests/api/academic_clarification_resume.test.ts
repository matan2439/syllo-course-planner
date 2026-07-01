/**
 * resumeClarificationPreflight — tests for the answers-aware wrapper added to
 * api/ai/academic_clarification_preflight.ts.
 *
 * Proves the pure helper: (1) behaves exactly like runClarificationPreflight
 * when no answers are supplied; (2) applies valid answers (via
 * applyClarificationLoopAnswers, academic_clarification_loop.ts) and re-runs
 * the clarification check against the updated request; (3) never silently
 * treats an invalid answer as applied — invalid answers surface both in
 * `invalidAnswers` and as a `validationMessage` on the matching view-model
 * item; (4) never mutates its input request.
 */

import { resumeClarificationPreflight } from '../../api/ai/academic_clarification_preflight';
import type { AcademicDecisionRequest } from '../../api/ai/academic_decision_agent';
import type { ClarificationLoopAnswer } from '../../api/ai/academic_clarification_loop';

const BASE_REQUEST: AcademicDecisionRequest = { programId: 'test_program_2027' };

describe('resumeClarificationPreflight', () => {
  test('1. missing critical context and no answers: returns needsClarification and blocked', async () => {
    const result = await resumeClarificationPreflight(BASE_REQUEST);

    expect(result.needsClarification).toBe(true);
    expect(result.blocked).toBe(true);
  });

  test('2. valid completed_courses and excluded_courses answers remove those critical missing inputs', async () => {
    const answers: ClarificationLoopAnswer[] = [
      { questionId: 'completed_courses', value: ['0366_1234'] },
      { questionId: 'excluded_courses', value: [] },
    ];

    const result = await resumeClarificationPreflight(BASE_REQUEST, answers);

    const missingFields = result.clarification.missingInputs.map((m) => m.field);
    expect(missingFields).not.toContain('completedCourses');
    expect(missingFields).not.toContain('excludedCourses');
    expect(result.blocked).toBe(false);
  });

  test('3. all required answers supplied: returns no blocking clarification', async () => {
    const answers: ClarificationLoopAnswer[] = [
      { questionId: 'completed_courses', value: ['0366_1234'] },
      { questionId: 'current_courses', value: ['0366_5678'] },
      { questionId: 'excluded_courses', value: [] },
      { questionId: 'max_weekly_hours', value: 20 },
      { questionId: 'track_or_focus', value: 'systems' },
    ];

    const result = await resumeClarificationPreflight(BASE_REQUEST, answers);

    expect(result.blocked).toBe(false);
    expect(result.needsClarification).toBe(false);
  });

  test('4. partial answers: preserves remaining unanswered questions and stays blocked', async () => {
    const answers: ClarificationLoopAnswer[] = [
      { questionId: 'completed_courses', value: ['0366_1234'] },
    ];

    const result = await resumeClarificationPreflight(BASE_REQUEST, answers);

    const remainingIds = result.clarification.questions.map((q) => q.id);
    expect(remainingIds).toEqual(
      expect.arrayContaining(['current_courses', 'excluded_courses', 'max_weekly_hours', 'track_or_focus']),
    );
    expect(remainingIds).not.toContain('completed_courses');
    expect(result.blocked).toBe(true); // excluded_courses is still critical-missing
  });

  test('5. invalid answers: returns validation messages and does not silently complete the request', async () => {
    const answers: ClarificationLoopAnswer[] = [
      { questionId: 'max_weekly_hours', value: 'not-a-number' as unknown as number },
    ];

    const result = await resumeClarificationPreflight(BASE_REQUEST, answers);

    expect(result.invalidAnswers).toEqual([
      { questionId: 'max_weekly_hours', reason: expect.any(String) },
    ]);
    const maxHoursItem = result.viewModel.items.find((i) => i.id === 'max_weekly_hours');
    expect(maxHoursItem?.validationMessage).toBeDefined();
    expect(result.clarification.missingInputs.map((m) => m.field)).toContain('maxWeeklyHours');
  });

  test('6. stable question ids are preserved in order', async () => {
    const result = await resumeClarificationPreflight(BASE_REQUEST);

    expect(result.clarification.questions.map((q) => q.id)).toEqual([
      'completed_courses',
      'current_courses',
      'excluded_courses',
      'max_weekly_hours',
      'track_or_focus',
    ]);
  });

  test('7. does not mutate the original request', async () => {
    const req: AcademicDecisionRequest = { ...BASE_REQUEST };
    const before = JSON.parse(JSON.stringify(req));

    await resumeClarificationPreflight(req, [{ questionId: 'completed_courses', value: ['x'] }]);

    expect(req).toEqual(before);
  });
});

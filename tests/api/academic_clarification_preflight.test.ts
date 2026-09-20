/**
 * runClarificationPreflight — tests for api/ai/academic_clarification_preflight.ts.
 *
 * Proves the preflight helper is a thin, non-duplicating delegation to the
 * existing clarification contract: clarifyRequest (academic_clarification_loop.ts,
 * itself wrapping DeterministicClarificationCapability) + buildClarificationViewModel
 * (academic_clarification_view_model.ts). Pure, no-I/O, no board/PlanningCapability
 * needed. Not wired into any production path here — only exercises the helper
 * directly.
 */

import { clarifyRequest } from '../../api/ai/academic_clarification_loop';
import type { AcademicDecisionRequest } from '../../api/ai/academic_decision_agent';
import { runClarificationPreflight } from '../../api/ai/academic_clarification_preflight';

const FULLY_ANSWERED_REQUEST: AcademicDecisionRequest = {
  programId: 'test_program_2027',
  buildModelOptions: {
    completedCourseIds: ['0366_1234'],
    disallowedCourseIds: [],
    maxHoursPerSemester: 20,
  },
  currentCourseIds: ['0366_5678'],
  track: 'systems',
};

describe('runClarificationPreflight', () => {
  test('needsClarification and blocked are both false when everything is answered', async () => {
    const result = await runClarificationPreflight(FULLY_ANSWERED_REQUEST);

    expect(result.needsClarification).toBe(false);
    expect(result.blocked).toBe(false);
  });

  test('blocked is true when completed courses are missing (critical)', async () => {
    const req: AcademicDecisionRequest = {
      ...FULLY_ANSWERED_REQUEST,
      buildModelOptions: { ...FULLY_ANSWERED_REQUEST.buildModelOptions, completedCourseIds: [] },
    };

    const result = await runClarificationPreflight(req);

    expect(result.blocked).toBe(true);
  });

  test('blocked is true when excluded courses are undefined (critical)', async () => {
    const req: AcademicDecisionRequest = {
      ...FULLY_ANSWERED_REQUEST,
      buildModelOptions: { ...FULLY_ANSWERED_REQUEST.buildModelOptions, disallowedCourseIds: undefined },
    };

    const result = await runClarificationPreflight(req);

    expect(result.blocked).toBe(true);
  });

  test('blocked is false but needsClarification is true when only non-critical fields are missing', async () => {
    const req: AcademicDecisionRequest = {
      programId: 'test_program_2027',
      buildModelOptions: {
        completedCourseIds: ['0366_1234'],
        disallowedCourseIds: [],
      },
      // currentCourseIds, track, maxHoursPerSemester all omitted — soft/non-critical only.
    };

    const result = await runClarificationPreflight(req);

    expect(result.blocked).toBe(false);
    expect(result.needsClarification).toBe(true);
  });

  test('viewModel.blocking mirrors result.blocked in both directions', async () => {
    const blockedReq: AcademicDecisionRequest = {
      ...FULLY_ANSWERED_REQUEST,
      buildModelOptions: { ...FULLY_ANSWERED_REQUEST.buildModelOptions, completedCourseIds: [] },
    };
    const blockedResult = await runClarificationPreflight(blockedReq);
    expect(blockedResult.viewModel.blocking).toBe(true);

    const okResult = await runClarificationPreflight(FULLY_ANSWERED_REQUEST);
    expect(okResult.viewModel.blocking).toBe(false);
  });

  test('stable question ids are preserved exactly, in order, when everything is missing', async () => {
    const result = await runClarificationPreflight({ programId: 'test_program_2027' });

    expect(result.clarification.questions.map((q) => q.id)).toEqual([
      'completed_courses',
      'current_courses',
      'excluded_courses',
      'max_weekly_hours',
      'track_or_focus',
    ]);
    expect(result.viewModel.items.map((i) => i.id)).toEqual([
      'completed_courses',
      'current_courses',
      'excluded_courses',
      'max_weekly_hours',
      'track_or_focus',
    ]);
  });

  test('does not duplicate clarification logic — clarification matches clarifyRequest directly', async () => {
    const req: AcademicDecisionRequest = { programId: 'test_program_2027' };

    const expected = await clarifyRequest(req);
    const result = await runClarificationPreflight(req);

    expect(result.clarification).toEqual(expected);
  });

  test('does not mutate the input request', async () => {
    const req: AcademicDecisionRequest = { ...FULLY_ANSWERED_REQUEST };
    const before = JSON.parse(JSON.stringify(req));

    await runClarificationPreflight(req);

    expect(req).toEqual(before);
  });
});

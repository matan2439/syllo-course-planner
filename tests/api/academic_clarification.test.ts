/**
 * DeterministicClarificationCapability — tests for api/ai/academic_clarification.ts.
 *
 * A deterministic (no LLM, no I/O) ClarificationCapability that inspects the
 * planning context carried in a ClarificationRequest and reports which inputs
 * are missing before Plan runs. Purely observational in this epic: it never
 * blocks planning itself — see AcademicDecisionAgent's
 * `blockOnMissingCriticalInputs` option (academic_decision_agent.ts) for that.
 */

import { DeterministicClarificationCapability } from '../../api/ai/academic_clarification';
import type { ClarificationRequest, ClarificationPlanningContext } from '../../api/ai/academic_decision_types';

function makeRequest(context: Partial<ClarificationPlanningContext> = {}): ClarificationRequest {
  return { gaps: [], context: { ...context } };
}

const FULLY_ANSWERED: ClarificationPlanningContext = {
  completedCourseIds: ['c1'],
  currentCourseIds: ['c2'],
  excludedCourseIds: [],
  maxWeeklyHours: 20,
  track: 'systems',
};

describe('DeterministicClarificationCapability', () => {
  const cap = new DeterministicClarificationCapability();

  test('reports missing completed courses when absent', async () => {
    const result = await cap.clarify(makeRequest({ ...FULLY_ANSWERED, completedCourseIds: undefined }));
    expect(result.needsClarification).toBe(true);
    expect(result.missingInputs).toContainEqual(
      expect.objectContaining({ field: 'completedCourses', critical: true }),
    );
  });

  test('reports missing completed courses when the list is empty', async () => {
    const result = await cap.clarify(makeRequest({ ...FULLY_ANSWERED, completedCourseIds: [] }));
    expect(result.missingInputs).toContainEqual(
      expect.objectContaining({ field: 'completedCourses', critical: true }),
    );
  });

  test('reports missing current/in-progress courses when absent', async () => {
    const result = await cap.clarify(makeRequest({ ...FULLY_ANSWERED, currentCourseIds: undefined }));
    expect(result.missingInputs).toContainEqual(
      expect.objectContaining({ field: 'currentCourses', critical: false }),
    );
  });

  test('reports missing excluded/forbidden courses preference when absent', async () => {
    const result = await cap.clarify(makeRequest({ ...FULLY_ANSWERED, excludedCourseIds: undefined }));
    expect(result.missingInputs).toContainEqual(
      expect.objectContaining({ field: 'excludedCourses', critical: true }),
    );
  });

  test('does not flag excluded courses missing when the user explicitly gave an empty list', async () => {
    const result = await cap.clarify(makeRequest({ ...FULLY_ANSWERED, excludedCourseIds: [] }));
    expect(result.missingInputs.some((m) => m.field === 'excludedCourses')).toBe(false);
  });

  test('reports missing max weekly hours when absent', async () => {
    const result = await cap.clarify(makeRequest({ ...FULLY_ANSWERED, maxWeeklyHours: undefined }));
    expect(result.missingInputs).toContainEqual(
      expect.objectContaining({ field: 'maxWeeklyHours', critical: false }),
    );
  });

  test('reports missing track/focus preference when absent', async () => {
    const result = await cap.clarify(makeRequest({ ...FULLY_ANSWERED, track: undefined }));
    expect(result.missingInputs).toContainEqual(
      expect.objectContaining({ field: 'track', critical: false }),
    );
  });

  test('returns needsClarification: false when all required planning context fields are present', async () => {
    const result = await cap.clarify(makeRequest(FULLY_ANSWERED));
    expect(result.needsClarification).toBe(false);
    expect(result.missingInputs).toEqual([]);
  });

  test('does not mutate the request', async () => {
    const req = makeRequest({ completedCourseIds: ['c1'] });
    const snapshot = JSON.parse(JSON.stringify(req));
    await cap.clarify(req);
    expect(req).toEqual(snapshot);
  });
});

describe('DeterministicClarificationCapability — structured ClarificationQuestion contract', () => {
  const cap = new DeterministicClarificationCapability();
  const ALL_ORDERED_IDS = [
    'completed_courses',
    'current_courses',
    'excluded_courses',
    'max_weekly_hours',
    'track_or_focus',
  ];

  test('missing completed courses produces a completed_courses question', async () => {
    const result = await cap.clarify(makeRequest({ ...FULLY_ANSWERED, completedCourseIds: undefined }));
    expect(result.questions).toContainEqual(
      expect.objectContaining({
        id: 'completed_courses',
        inputKey: 'completedCourseIds',
        answerType: 'course_id_list',
        critical: true,
        required: true,
      }),
    );
  });

  test('missing current/in-progress courses produces a current_courses question', async () => {
    const result = await cap.clarify(makeRequest({ ...FULLY_ANSWERED, currentCourseIds: undefined }));
    expect(result.questions).toContainEqual(
      expect.objectContaining({
        id: 'current_courses',
        inputKey: 'currentCourseIds',
        answerType: 'course_id_list',
        critical: false,
      }),
    );
  });

  test('missing excluded courses produces an excluded_courses question', async () => {
    const result = await cap.clarify(makeRequest({ ...FULLY_ANSWERED, excludedCourseIds: undefined }));
    expect(result.questions).toContainEqual(
      expect.objectContaining({
        id: 'excluded_courses',
        inputKey: 'excludedCourseIds',
        answerType: 'course_id_list',
        critical: true,
        required: true,
      }),
    );
  });

  test('missing max weekly hours produces a max_weekly_hours question with numeric answer type', async () => {
    const result = await cap.clarify(makeRequest({ ...FULLY_ANSWERED, maxWeeklyHours: undefined }));
    expect(result.questions).toContainEqual(
      expect.objectContaining({
        id: 'max_weekly_hours',
        inputKey: 'maxWeeklyHours',
        answerType: 'number',
        critical: false,
      }),
    );
  });

  test('missing track/focus produces a track_or_focus question', async () => {
    const result = await cap.clarify(makeRequest({ ...FULLY_ANSWERED, track: undefined }));
    expect(result.questions).toContainEqual(
      expect.objectContaining({ id: 'track_or_focus', inputKey: 'track', critical: false }),
    );
  });

  test('question order is deterministic: completed, current, excluded, maxWeeklyHours, track', async () => {
    const result = await cap.clarify(makeRequest({}));
    expect(result.questions.map((q) => q.id)).toEqual(ALL_ORDERED_IDS);
  });

  test('questions are derived from missingInputs — same count and same critical flags, in the same order', async () => {
    const result = await cap.clarify(makeRequest({ completedCourseIds: ['c1'], excludedCourseIds: [] }));
    expect(result.questions.length).toBe(result.missingInputs.length);
    expect(result.questions.map((q) => q.critical)).toEqual(result.missingInputs.map((m) => m.critical));
  });

  test('no questions are produced when no clarification is needed', async () => {
    const result = await cap.clarify(makeRequest(FULLY_ANSWERED));
    expect(result.questions).toEqual([]);
  });

  test('question IDs are stable and unique', async () => {
    const result = await cap.clarify(makeRequest({}));
    const ids = result.questions.map((q) => q.id);
    expect(ids).toEqual(ALL_ORDERED_IDS);
    expect(new Set(ids).size).toBe(ids.length);
  });

  test('does not mutate the request when generating questions', async () => {
    const req = makeRequest({});
    const snapshot = JSON.parse(JSON.stringify(req));
    await cap.clarify(req);
    expect(req).toEqual(snapshot);
  });
});

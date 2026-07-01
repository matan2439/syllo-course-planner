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

jest.mock('../../api/ai/board_loader', () => ({
  loadLocalBoardJson: jest.fn(),
}));

jest.mock('../../api/ai/apply_runtime', () => ({
  getAcademicContextStore: jest.fn(),
}));

jest.mock('../../api/ai/generate-plan', () => ({
  buildModel: jest.fn(),
}));

jest.mock('../../api/ai/planner_validate', () => ({
  validatePlanState: jest.fn(),
}));

jest.mock('../../api/ai/plan_alternatives', () => ({
  constraintFingerprint: jest.fn(),
}));

import { loadLocalBoardJson } from '../../api/ai/board_loader';
import { getAcademicContextStore } from '../../api/ai/apply_runtime';
import { buildModel } from '../../api/ai/generate-plan';
import { constraintFingerprint } from '../../api/ai/plan_alternatives';
import { validatePlanState } from '../../api/ai/planner_validate';
import { validateAuthoritativeCandidate } from '../../api/ai/authoritative_candidate_validation';
import { preferencesWithPlannerPolicy } from '../../api/ai/planner_policy_context';

const mocked = <T extends (...args: any[]) => any>(fn: T) => fn as jest.MockedFunction<T>;

describe('authoritative stored-candidate revalidation', () => {
  beforeEach(() => jest.clearAllMocks());

  test('rebuilds legality and the fingerprint from server-owned context', async () => {
    const preferences = preferencesWithPlannerPolicy({ disallowed_course_ids: ['X'] }, 'compact');
    mocked(getAcademicContextStore).mockReturnValue({
      load: jest.fn().mockResolvedValue({
        ownerId: 'owner', programId: 'program', digest: 'as_1', personalStatus: {},
        planContext: { personal_status: { completed: [] } }, preferences, updatedAt: 1,
      }),
      put: jest.fn(),
    });
    mocked(loadLocalBoardJson).mockReturnValue({ metadata: { version: 1 } });
    const model = {
      knownSemesterIds: ['s1', 's2'],
      completedCourseIds: new Set(['done']),
    } as any;
    mocked(buildModel).mockReturnValue(model);
    mocked(validatePlanState).mockReturnValue({ valid: true, errors: [] } as any);
    mocked(constraintFingerprint).mockReturnValue('cf_current');

    const result = await validateAuthoritativeCandidate({
      ownerId: 'owner', programId: 'program', profileVersion: 7,
      semesters: [{ semesterId: 's1', courseIds: ['A'] }],
    });

    expect(buildModel).toHaveBeenCalledWith(
      expect.anything(), expect.anything(), preferences, 'program', undefined, undefined, 'compact',
    );
    expect(validatePlanState).toHaveBeenCalledWith({
      semesters: { s1: ['A'], s2: [] },
    }, model);
    expect(constraintFingerprint).toHaveBeenCalledWith({
      model,
      completedCourseIds: ['done'],
      distributionPolicy: 'compact',
      profileVersion: 7,
    });
    expect(result).toEqual({ valid: true, constraintFingerprint: 'cf_current' });
  });

  test.each([
    ['missing context', null, {}],
    ['missing program data', { ownerId: 'owner' }, null],
  ])('fails closed for %s', async (_label, context, board) => {
    mocked(getAcademicContextStore).mockReturnValue({
      load: jest.fn().mockResolvedValue(context), put: jest.fn(),
    } as any);
    mocked(loadLocalBoardJson).mockReturnValue(board);

    await expect(validateAuthoritativeCandidate({
      ownerId: 'owner', programId: 'program', profileVersion: 0, semesters: [],
    })).resolves.toEqual({ valid: false, constraintFingerprint: 'cf_unavailable' });
    expect(validatePlanState).not.toHaveBeenCalled();
  });
});

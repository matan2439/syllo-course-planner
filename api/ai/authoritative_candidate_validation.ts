import type { CommittedBoard } from './board_repository';
import { buildModel } from './generate-plan';
import { constraintFingerprint } from './plan_alternatives';
import { validatePlanState } from './planner_validate';
import { getAcademicContextStore } from './apply_runtime';
import { storedDistributionPolicy } from './planner_policy_context';
import { TauProgramProvider } from './program_provider';

export async function validateAuthoritativeCandidate(input: {
  ownerId: string;
  programId: string;
  profileVersion: number;
  semesters: CommittedBoard['semesters'];
}): Promise<{ valid: boolean; constraintFingerprint: string }> {
  const context = await getAcademicContextStore().load(input.ownerId, input.programId);
  const boardJson = await new TauProgramProvider().loadBoard(
    input.programId,
    (process.env.DATABASE_URL ?? '').trim() || undefined,
  );
  if (!context || !boardJson) {
    return { valid: false, constraintFingerprint: 'cf_unavailable' };
  }

  const distributionPolicy = storedDistributionPolicy(context.preferences);
  const model = buildModel(
    boardJson,
    context.planContext,
    context.preferences as any,
    input.programId,
    undefined,
    undefined,
    distributionPolicy,
  );
  const state = {
    semesters: Object.fromEntries(model.knownSemesterIds.map((semesterId) => [
      semesterId,
      [...(input.semesters.find((semester) => semester.semesterId === semesterId)?.courseIds ?? [])],
    ])),
  };
  const validation = validatePlanState(state, model);
  return {
    valid: validation.valid,
    constraintFingerprint: constraintFingerprint({
      model,
      completedCourseIds: [...model.completedCourseIds],
      ...(distributionPolicy ? { distributionPolicy } : {}),
      profileVersion: input.profileVersion,
    }),
  };
}

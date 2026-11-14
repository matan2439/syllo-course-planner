import type { CommittedBoard } from './board_repository';
import { buildModel } from './generate-plan';
import { constraintFingerprint } from './plan_alternatives';
import { validatePlanState } from './planner_validate';
import { getAcademicContextStore, getBoardRepository } from './apply_runtime';
import { storedDistributionPolicy } from './planner_policy_context';
import { programProviderFor } from './program_provider';
import { databaseUrl } from '../db_env';

export async function validateAuthoritativeCandidate(input: {
  ownerId: string;
  programId: string;
  profileVersion: number;
  semesters: CommittedBoard['semesters'];
}): Promise<{ valid: boolean; constraintFingerprint: string }> {
  const context = await getAcademicContextStore().load(input.ownerId, input.programId);
  const boardJson = await programProviderFor(input.programId).loadBoard(
    input.programId,
    databaseUrl() || undefined,
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
  let valid = validation.valid;
  if (!valid) {
    // A problem that is already on the student's committed board (a course in a semester it is not
    // given in, say) must not block applying additions planned around it. Only NEW errors refuse.
    const current = await getBoardRepository().load(input.ownerId, input.programId);
    if (current) {
      const before = { semesters: Object.fromEntries(model.knownSemesterIds.map((semesterId) => [
        semesterId, [...(current.semesters.find((semester) => semester.semesterId === semesterId)?.courseIds ?? [])],
      ])) };
      const existing = new Map<string, number>();
      for (const error of validatePlanState(before, model).errors) existing.set(error, (existing.get(error) ?? 0) + 1);
      valid = validation.errors.every((error) => {
        const count = existing.get(error) ?? 0;
        if (!count) return false;
        existing.set(error, count - 1);
        return true;
      });
    }
  }
  return {
    valid,
    constraintFingerprint: constraintFingerprint({
      model,
      completedCourseIds: [...model.completedCourseIds],
      ...(distributionPolicy ? { distributionPolicy } : {}),
      profileVersion: input.profileVersion,
    }),
  };
}

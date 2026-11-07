import { buildValidationContext, validatePlanState } from './planner_validate';
import type { ConstraintModel, PlanState } from './planner_types';

/** Load targets guide generated plans. Manual placement retains load warnings
 * without treating a student's chosen workload as an enrollment prohibition. */
export function manualBoardValidationContext(model: ConstraintModel, before?: PlanState) {
  const pinnedHome: Record<string, string> = {};
  for (const [semester, ids] of Object.entries(before?.semesters ?? {})) {
    for (const id of ids) pinnedHome[id] ??= semester;
  }
  return {
    ...buildValidationContext(model, pinnedHome),
    allowInProgressPlacement: true,
    allowUnknownRequirementEvidence: true,
    hardCap: Number.POSITIVE_INFINITY,
    absoluteMaxReasonable: Number.POSITIVE_INFINITY,
    courseNames: Object.fromEntries([...model.profiles].map(([id, p]) => [id, p.name_he || id])),
    semesterLabels: Object.fromEntries(model.knownSemesterIds.map(id => {
      const match = /^year_(\d+)_semester_([ab])$/.exec(id);
      return [id, match ? `שנה ${match[1]}, סמסטר ${match[2] === 'a' ? 'א׳' : 'ב׳'}` : id];
    })),
  };
}

/** An incremental edit must not introduce new academic errors. Existing,
 * unrelated draft issues must not lock all edits (including their repair).
 * For a move, exclude the moved course from the comparison baseline so its
 * own offering/prerequisites are always rechecked at the new destination. */
export function validateManualBoardChange(
  state: PlanState, before: PlanState, model: ConstraintModel, movedCourseId?: string,
) {
  const ctx = manualBoardValidationContext(model, before);
  const baseline = movedCourseId ? { semesters: Object.fromEntries(
    Object.entries(before.semesters).map(([id, ids]) => [id, ids.filter(c => c !== movedCourseId)]),
  ) } : before;
  const existing = new Map<string, number>();
  for (const error of validatePlanState(baseline, model, {}, ctx).errors) {
    existing.set(error, (existing.get(error) ?? 0) + 1);
  }
  const result = validatePlanState(state, model, {}, ctx);
  const errors = result.errors.filter(error => {
    const count = existing.get(error) ?? 0;
    if (!count) return true;
    existing.set(error, count - 1);
    return false;
  });
  return { ...result, valid: errors.length === 0, errors };
}

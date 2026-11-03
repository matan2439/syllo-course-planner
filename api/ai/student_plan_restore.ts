import type { SavedPlan } from '../../shared/planner/student-workspace';
import type { AcademicContextRecord } from './academic_context_store';
import type { CommittedBoard } from './board_repository';
import { buildModel } from './generate-plan';
import { validatePlanState } from './planner_validate';
import { manualBoardValidationContext } from './manual_board_validation';

/** A saved draft is input, never authority. Reuse today's context and legality gate. */
export function validateSavedPlan(plan: SavedPlan, boardJson: any, context: AcademicContextRecord, programId: string, current: CommittedBoard | null) {
  const { gateway_assessment_types: _planningOnly, ...preferences } = (context.preferences ?? {}) as Record<string, unknown>;
  const model = buildModel(boardJson, context.planContext, preferences, programId);
  const known = new Set(model.knownSemesterIds);
  const errors: string[] = [];
  const state = { semesters: Object.fromEntries(model.knownSemesterIds.map((id) => [id, [] as string[]])) };
  for (const semester of plan.semesters) {
    if (!known.has(semester.semesterId)) { errors.push(`Unknown semester: ${semester.semesterId}`); continue; }
    state.semesters[semester.semesterId] = [...semester.courseIds];
    for (const id of semester.courseIds) {
      const profile = model.profiles.get(id);
      if (!profile?.name_he?.trim()) errors.push(`Unknown course: ${id}`);
      if (profile?.excluded || model.disallowedCourseIds.has(id)) errors.push(`Excluded course: ${id}`);
    }
  }
  const placed = new Set(Object.values(state.semesters).flat());
  for (const id of model.requiredMandatoryCourseIds) if (!placed.has(id)) errors.push(`Missing mandatory: ${id}`);
  const before = current ? { semesters: Object.fromEntries(current.semesters.map(s => [s.semesterId, s.courseIds])) } : undefined;
  const validation = validatePlanState(state, model, {}, manualBoardValidationContext(model, before));
  errors.push(...validation.errors);
  return { valid: errors.length === 0, errors, warnings: validation.warnings,
    semesters: model.knownSemesterIds.map((semesterId) => ({ semesterId, courseIds: state.semesters[semesterId] })) };
}

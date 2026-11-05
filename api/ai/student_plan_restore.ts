import type { SavedPlan } from '../../shared/planner/student-workspace';
import type { AcademicContextRecord } from './academic_context_store';
import type { CommittedBoard } from './board_repository';
import { buildModel } from './generate-plan';
import { validatePlanState } from './planner_validate';
import { manualBoardValidationContext } from './manual_board_validation';
import { withCommittedColumns } from './planner_model';

/** Restoring a saved draft is navigation, not academic approval. Keep structural
 * checks blocking, but preserve drafts with academic issues and report warnings. */
export function validateSavedPlan(plan: SavedPlan, boardJson: any, context: AcademicContextRecord, programId: string, current: CommittedBoard | null) {
  const { gateway_assessment_types: _planningOnly, ...preferences } = (context.preferences ?? {}) as Record<string, unknown>;
  // The saved plan's own columns (including any semesters it added) are the ones it restores.
  const model = buildModel(boardJson, withCommittedColumns(boardJson, context.planContext, plan.semesters.map((s) => s.semesterId)), preferences, programId);
  const known = new Set(model.knownSemesterIds);
  const errors: string[] = [];
  const academicWarnings: string[] = [];
  const seen = new Set<string>();
  const courseHomes = new Map<string, string[]>();
  const state = { semesters: Object.fromEntries(model.knownSemesterIds.map((id) => [id, [] as string[]])) };
  for (const semester of plan.semesters) {
    if (!known.has(semester.semesterId)) { errors.push(`Unknown semester: ${semester.semesterId}`); continue; }
    if (seen.has(semester.semesterId)) errors.push(`Duplicate semester: ${semester.semesterId}`);
    seen.add(semester.semesterId);
    if (new Set(semester.courseIds).size !== semester.courseIds.length) errors.push(`Duplicate course in semester: ${semester.semesterId}`);
    state.semesters[semester.semesterId] = [...semester.courseIds];
    for (const id of semester.courseIds) {
      const profile = model.profiles.get(id);
      const homes = courseHomes.get(id) ?? [];
      homes.push(semester.semesterId);
      courseHomes.set(id, homes);
      if (!profile?.name_he?.trim()) errors.push(`Unknown course: ${id}`);
      if (profile?.excluded || model.disallowedCourseIds.has(id)) academicWarnings.push(`Excluded course: ${id}`);
    }
  }
  for (const [id, homes] of courseHomes) {
    if (homes.length > 1 && !model.profiles.get(id)?.is_annual) errors.push(`Duplicate course across semesters: ${id}`);
  }
  const placed = new Set(Object.values(state.semesters).flat());
  for (const id of model.requiredMandatoryCourseIds) if (!placed.has(id)) academicWarnings.push(`Missing mandatory: ${id}`);
  const before = current ? { semesters: Object.fromEntries(current.semesters.map(s => [s.semesterId, s.courseIds])) } : undefined;
  const validation = validatePlanState(state, model, {}, manualBoardValidationContext(model, before));
  return { valid: errors.length === 0, errors, warnings: [...academicWarnings, ...validation.errors, ...validation.warnings],
    semesters: model.knownSemesterIds.map((semesterId) => ({ semesterId, courseIds: state.semesters[semesterId] })) };
}

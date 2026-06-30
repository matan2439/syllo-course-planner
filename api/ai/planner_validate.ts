/**
 * Pure deterministic validation of a plan state against the constraint model —
 * the single source of truth for hard legality (duplicates, completed-course
 * reuse, offering legality, prerequisite strict-timing, per-semester overload,
 * pinned courses). Wraps the reused `validatePlanProposal`. Shared by the worker
 * (validate-after-mutation) and the lookahead rollout so both judge legality the
 * same way.
 */

import { validatePlanProposal, type PlanValidationContext, type PlanProposal } from './plan_validation';
import { getLegalSemesters, type CourseLegalityInfo } from './completion_analysis';
import type { ConstraintModel, PlanState } from './planner_types';

export function buildValidationContext(
  model: ConstraintModel,
  pinnedHome: Record<string, string> = {},
): PlanValidationContext {
  const courses: PlanValidationContext['courses'] = {};
  for (const [id, p] of model.profiles) {
    const legal = getLegalSemesters(p as CourseLegalityInfo, model.knownSemesterIds);
    courses[id] = {
      hours: p.hours,
      // Only restrict to legal semesters when the offering is high-confidence;
      // otherwise leave unrestricted (a warning, not a hard block).
      effective_allowed_semesters: legal.confident ? legal.semesters : undefined,
      prerequisites: p.prerequisites,
      missing_prerequisites: [],
      is_mandatory: p.is_mandatory,
    };
  }
  return {
    completedCourseIds: model.completedCourseIds,
    courses,
    maxHoursPerSemester: model.maxHoursPerSemester,
    pinnedCourseIds: model.pinnedCourseIds,
    currentSemesterByCourseId: pinnedHome,
  };
}

export interface StateValidation {
  valid: boolean;
  errors: string[];
  warnings: string[];
}

export function validatePlanState(
  state: PlanState,
  model: ConstraintModel,
  pinnedHome: Record<string, string> = {},
): StateValidation {
  const proposal: PlanProposal = {
    semesters: model.knownSemesterIds
      .filter(id => (state.semesters[id] ?? []).length > 0)
      .map(id => ({ semester_id: id, course_ids: state.semesters[id] })),
    moves: [],
    warnings_he: [],
    rationale_he: '',
    requirements_status: [],
  };
  const res = validatePlanProposal(proposal, buildValidationContext(model, pinnedHome));
  return { valid: res.errors.length === 0, errors: res.errors, warnings: res.warnings };
}

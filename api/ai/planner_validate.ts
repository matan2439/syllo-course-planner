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
import { type ConstraintModel, type PlanState, placedCourseIds } from './planner_types';
import { degreeHours as computeDegreeHours } from './planner_goals';

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

/**
 * The full candidate gate every plan must pass before it can be shown as final.
 * Combines hard legality (validatePlanState) with degree-requirement
 * completeness (185-hours / mandatory / categories) and the disallowed-course
 * rule. `valid` requires BOTH legality and completeness — no invalid or
 * incomplete plan is ever valid (so the planner never stops at 183/185).
 */
export interface CandidateReport {
  valid: boolean;
  /** Hard legality: no validator errors (offering, prereqs, overload, duplicates, pinned). */
  legal: boolean;
  /** Degree requirements met: hours target + all mandatory placed + all categories satisfied. */
  complete: boolean;
  errors: string[];
  warnings: string[];
  constraintsChecked: string[];
  degreeHours: number;
  degreeMet: boolean;
  missingMandatory: string[];
  unsatisfiedCategories: string[];
  disallowedPlaced: string[];
  overCapSemesters: string[];
}

export function validateCandidate(
  state: PlanState,
  model: ConstraintModel,
  pinnedHome: Record<string, string> = {},
): CandidateReport {
  const legality = validatePlanState(state, model, pinnedHome);
  const placed = new Set(placedCourseIds(state));

  const degreeHours = computeDegreeHours(state, model);
  const degreeMet = degreeHours >= model.degreeRequiredHours;

  const missingMandatory = model.requiredMandatoryCourseIds.filter(
    id => !placed.has(id) && !model.completedCourseIds.has(id),
  );
  const unsatisfiedCategories = model.categories
    .filter(cat => cat.candidateIds.filter(id => placed.has(id)).length < cat.required)
    .map(cat => cat.id);
  const disallowedPlaced = [...placed].filter(
    id => model.disallowedCourseIds.has(id) || model.profiles.get(id)?.excluded === true,
  );
  const overCapSemesters = model.knownSemesterIds.filter(
    sem => (state.semesters[sem] ?? []).reduce((s, c) => s + (model.profiles.get(c)?.hours ?? 0), 0) > model.hardCap,
  );

  const errors = [...legality.errors];
  if (!degreeMet) {
    errors.push(`התוכנית אינה משלימה את שעות התואר: ${degreeHours}/${model.degreeRequiredHours} ש"ש.`);
  }
  for (const id of missingMandatory) errors.push(`קורס חובה חסר: ${model.profiles.get(id)?.name_he ?? id}.`);
  for (const cid of unsatisfiedCategories) {
    const cat = model.categories.find(c => c.id === cid);
    errors.push(`דרישת קטגוריה לא מולאה: ${cat?.name ?? cid}.`);
  }
  for (const id of disallowedPlaced) errors.push(`קורס לא-זמין שובץ בתוכנית: ${model.profiles.get(id)?.name_he ?? id}.`);

  const legal = legality.valid;
  const complete = degreeMet && missingMandatory.length === 0 && unsatisfiedCategories.length === 0;
  const valid = legal && complete && disallowedPlaced.length === 0;

  return {
    valid, legal, complete,
    errors, warnings: legality.warnings,
    constraintsChecked: ['degree_hours', 'mandatory', 'category', 'prerequisites', 'semester_load', 'offering', 'disallowed', 'duplicates'],
    degreeHours, degreeMet, missingMandatory, unsatisfiedCategories, disallowedPlaced, overCapSemesters,
  };
}

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
import { assessCompleteness } from './planner_goals';
// Type-only — erased at compile time, so this does NOT create a runtime
// circular import back from planner_policy.ts (which imports validatePlanState
// and buildValidationContext from this file for TauPolicyProvider.validate).
import type { PolicyProvider } from './planner_policy';

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
    currentlyPlannedCourseIds: model.currentlyPlannedCourseIds,
    courses,
    maxHoursPerSemester: model.maxHoursPerSemester,
    pinnedCourseIds: model.pinnedCourseIds,
    currentSemesterByCourseId: pinnedHome,
    // Same source of truth as assessCompleteness's overload override, so
    // validate() and isGoal/assessCompleteness never disagree.
    overloadAccepted: model.overloadAccepted,
    overloadConfirmedAt: model.overloadConfirmedAt,
    // Phase 1b — same source of truth as assessCompleteness's load-cap
    // thresholds, so validate() and isGoal/assessCompleteness never disagree.
    hardCap: model.hardCap,
    softLoadMax: model.softLoadMax,
    absoluteMaxReasonable: model.absoluteMaxReasonable,
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
  ctx?: PlanValidationContext,
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
  const res = validatePlanProposal(proposal, ctx ?? buildValidationContext(model, pinnedHome));
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

/**
 * Stable prefix of the disallowed-placed error message, shared by every
 * producer (below, and generate-plan.ts's disallowedGate) and consumer
 * (academic_decision_runtime.ts's buildAcademicDecision, which needs to tell
 * this cause apart from an overload block to explain/suggest the right fix)
 * so detection never drifts from the message text that's actually emitted.
 */
export const DISALLOWED_PLACED_ERROR_PREFIX = 'קורס לא-זמין שובץ בתוכנית:';

/**
 * Which of the given placed course ids are hard-excluded by the model (either
 * an explicit disallowed/strongly-avoided id, or a catalog-level exclusion).
 * Shared by validateCandidate below and by generate-plan.ts's post-planning
 * hard-avoid gate, so both agree on exactly what counts as "disallowed".
 */
export function disallowedPlacedCourseIds(placedIds: Iterable<string>, model: ConstraintModel): string[] {
  return [...placedIds].filter(
    id => model.disallowedCourseIds.has(id) || model.profiles.get(id)?.excluded === true,
  );
}

export function validateCandidate(
  state: PlanState,
  model: ConstraintModel,
  pinnedHome: Record<string, string> = {},
  /**
   * Only the assessCompleteness method is needed here, so the parameter is
   * duck-typed against that one capability rather than the full PolicyProvider —
   * a real PolicyProvider instance (e.g. TauPolicyProvider) satisfies this too.
   * Defaults to the standalone assessCompleteness function directly, matching
   * TauPolicyProvider's own delegation — not a `new TauPolicyProvider()` default,
   * which would require a value import from planner_policy.ts and reintroduce
   * the cycle the type-only import above avoids.
   */
  policy: Pick<PolicyProvider, 'assessCompleteness'> = { assessCompleteness },
): CandidateReport {
  const legality = validatePlanState(state, model, pinnedHome);
  const placed = new Set(placedCourseIds(state));

  const { degreeHours, degreeMet, missingMandatory, unsatisfiedCategories, overCapSemesters } =
    policy.assessCompleteness(state, model);

  const disallowedPlaced = disallowedPlacedCourseIds(placed, model);

  const errors = [...legality.errors];
  if (!degreeMet) {
    errors.push(`התוכנית אינה משלימה את שעות התואר: ${degreeHours}/${model.degreeRequiredHours} ש"ש.`);
  }
  for (const id of missingMandatory) errors.push(`קורס חובה חסר: ${model.profiles.get(id)?.name_he ?? id}.`);
  for (const cid of unsatisfiedCategories) {
    const cat = model.categories.find(c => c.id === cid);
    errors.push(`דרישת קטגוריה לא מולאה: ${cat?.name ?? cid}.`);
  }
  for (const id of disallowedPlaced) errors.push(`${DISALLOWED_PLACED_ERROR_PREFIX} ${model.profiles.get(id)?.name_he ?? id}.`);

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

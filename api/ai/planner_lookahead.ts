/**
 * Downstream-impact reasoning for the Planner Worker.
 *
 * A legal action is not necessarily a good action. Before committing an action
 * the worker estimates its effect on the remaining planning space:
 *
 *  - projectFeasibility — forward-checking: does every still-required item
 *    (unplaced mandatory, unmet category, the remaining degree-hours gap) still
 *    have at least one legal assignment? An action that drives a required item's
 *    options to zero blocks better future plans and must be ranked down.
 *
 *  - estimateFinalScore — a bounded greedy rollout completes the plan from the
 *    post-action state and scores the result, so an action that temporarily
 *    looks worse but leads to a better final schedule can be preferred over a
 *    myopic one.
 */

import { scorePlan, compareScore, applyMutation, degreeHours as computeDegreeHours } from './planner_goals';
import { enumerateActions, legalSemestersFor, isExcluded } from './planner_actions';
import { validatePlanState } from './planner_validate';
import type { PlanValidationContext } from './plan_validation';
import {
  type ConstraintModel,
  type PlanState,
  cloneState,
  placedCourseIds,
} from './planner_types';

export interface FeasibilityReport {
  feasible: boolean;
  /** ids / category ids whose remaining legal options dropped to zero. */
  blocked: string[];
}

function loadOf(state: PlanState, model: ConstraintModel, sem: string): number {
  return (state.semesters[sem] ?? []).reduce((s, c) => s + (model.profiles.get(c)?.hours ?? 0), 0);
}

/** Can `courseId` (hours h) still be placed in some legal semester under the hard cap? */
function hasFittingLegalSemester(state: PlanState, model: ConstraintModel, courseId: string): boolean {
  const hours = model.profiles.get(courseId)?.hours ?? 0;
  return legalSemestersFor(model, courseId).some(sem => loadOf(state, model, sem) + hours <= model.hardCap);
}

/**
 * Forward-check that the plan can still be completed from `state`: every
 * unplaced mandatory still fits somewhere legal, every unmet category still has
 * a placeable candidate, and the remaining degree-hours gap can still be closed
 * within the remaining headroom.
 */
export function projectFeasibility(state: PlanState, model: ConstraintModel): FeasibilityReport {
  const placed = new Set(placedCourseIds(state));
  const blocked: string[] = [];

  // mandatory: each unplaced required mandatory must still fit in a legal semester.
  for (const id of model.requiredMandatoryCourseIds) {
    if (placed.has(id)) continue;
    if (!hasFittingLegalSemester(state, model, id)) blocked.push(id);
  }

  // categories: each unmet category must retain ≥1 placeable, eligible candidate.
  for (const cat of model.categories) {
    const got = cat.candidateIds.filter(id => placed.has(id)).length;
    if (got >= cat.required) continue;
    const placeable = cat.candidateIds.some(
      id => !placed.has(id) && !model.completedCourseIds.has(id) && !isExcluded(model, id) &&
        hasFittingLegalSemester(state, model, id),
    );
    if (!placeable) blocked.push(cat.id);
  }

  // degree hours: the remaining gap must be closable within the total headroom.
  const gap = model.degreeRequiredHours - computeDegreeHours(state, model);
  if (gap > 0) {
    const headroom = model.knownSemesterIds.reduce(
      (sum, sem) => sum + Math.max(0, model.hardCap - loadOf(state, model, sem)),
      0,
    );
    if (headroom < gap) blocked.push('degree_hours');
  }

  return { feasible: blocked.length === 0, blocked };
}

/**
 * Bounded, deterministic greedy completion of `state`: repeatedly apply the
 * legal action that most advances the goal stack, until none improves. Pure (no
 * trace, no lookahead) — this is the rollout used to estimate a reachable final
 * plan. Does NOT itself recurse into lookahead, so it is cheap and terminating.
 */
export function greedyComplete(
  state: PlanState,
  model: ConstraintModel,
  maxSteps = 200,
  validationContext?: PlanValidationContext,
): PlanState {
  let cur = cloneState(state);
  for (let i = 0; i < maxSteps; i++) {
    const current = scorePlan(cur, model);
    let best: PlanState | null = null;
    let bestVec = current;
    for (const mut of enumerateActions(cur, model)) {
      const next = applyMutation(cur, mut);
      if (!next) continue;
      if (!validatePlanState(next, model, {}, validationContext).valid) continue; // legal results only
      const vec = scorePlan(next, model);
      if (compareScore(vec, bestVec) > 0) {
        best = next;
        bestVec = vec;
      }
    }
    if (!best) break;
    cur = best;
  }
  return cur;
}

/** The lexicographic score of the best plan reachable from `state` via greedy rollout. */
export function estimateFinalScore(
  state: PlanState,
  model: ConstraintModel,
  maxSteps = 200,
  validationContext?: PlanValidationContext,
): number[] {
  return scorePlan(greedyComplete(state, model, maxSteps, validationContext), model);
}

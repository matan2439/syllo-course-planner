/**
 * PolicyProvider — owns goal/scoring/validation judgment for the PlannerAgent.
 *
 * Pulled out of planner_agent.ts so the agent's orchestration logic (search
 * dispatch, gap detection, capability wiring) is free of institution-specific
 * degree-rule arithmetic. TauPolicyProvider is TAU's current behavior,
 * relocated verbatim (isGoal) or delegated (score/compareScore/validate) —
 * no behavior change from what planner_agent.ts did inline before.
 */

import { scorePlan, compareScore as compareScoreFn, degreeHours } from './planner_goals';
import { validatePlanState, buildValidationContext } from './planner_validate';
import type { PlanValidationContext } from './plan_validation';
import { type ConstraintModel, type PlanState, placedCourseIds } from './planner_types';

export interface PolicyProvider {
  isGoal(state: PlanState, model: ConstraintModel): boolean;
  score(state: PlanState, model: ConstraintModel): number[];
  compareScore(a: number[], b: number[]): number;
  validate(
    state: PlanState,
    model: ConstraintModel,
    pinnedHome: Record<string, string>,
    ctx?: PlanValidationContext,
  ): { valid: boolean; reason?: string };
}

/** TAU's current goal/scoring/validation rules — moved from planner_agent.ts unchanged. */
export class TauPolicyProvider implements PolicyProvider {
  isGoal(state: PlanState, model: ConstraintModel): boolean {
    const placed = new Set(placedCourseIds(state));
    const loads = Object.values(state.semesters).map(
      list => list.reduce((s, id) => s + (model.profiles.get(id)?.hours ?? 0), 0),
    );
    if (loads.some(h => h > model.hardCap)) return false;
    if (degreeHours(state, model) < model.degreeRequiredHours) return false;
    if (!model.requiredMandatoryCourseIds.every(id => placed.has(id))) return false;
    return model.categories.every(
      cat => cat.candidateIds.filter(id => placed.has(id)).length >= cat.required,
    );
  }

  score(state: PlanState, model: ConstraintModel): number[] {
    return scorePlan(state, model);
  }

  compareScore(a: number[], b: number[]): number {
    return compareScoreFn(a, b);
  }

  validate(
    state: PlanState,
    model: ConstraintModel,
    pinnedHome: Record<string, string>,
    ctx?: PlanValidationContext,
  ): { valid: boolean; reason?: string } {
    const r = validatePlanState(state, model, pinnedHome, ctx ?? buildValidationContext(model, pinnedHome));
    return { valid: r.valid, reason: r.errors[0] };
  }
}

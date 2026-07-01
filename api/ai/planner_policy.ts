/**
 * PolicyProvider — owns goal/scoring/validation judgment for the PlannerAgent.
 *
 * Pulled out of planner_agent.ts so the agent's orchestration logic (search
 * dispatch, gap detection, capability wiring) is free of institution-specific
 * degree-rule arithmetic. TauPolicyProvider is TAU's current behavior,
 * relocated verbatim (isGoal) or delegated (score/compareScore/validate) —
 * no behavior change from what planner_agent.ts did inline before.
 */

import {
  scorePlan,
  compareScore as compareScoreFn,
  assessCompleteness,
  type CompletenessAssessment,
} from './planner_goals';
import { validatePlanState, buildValidationContext } from './planner_validate';
import type { PlanValidationContext } from './plan_validation';
import { type ConstraintModel, type PlanState } from './planner_types';

export interface PolicyProvider {
  isGoal(state: PlanState, model: ConstraintModel): boolean;
  score(state: PlanState, model: ConstraintModel): number[];
  compareScore(a: number[], b: number[]): number;
  /** Degree-completion gaps (mandatory/category/hours/over-cap) — shared by isGoal and validateCandidate. */
  assessCompleteness(state: PlanState, model: ConstraintModel): CompletenessAssessment;
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
    const c = this.assessCompleteness(state, model);
    return (
      c.overCapSemesters.length === 0 &&
      c.degreeMet &&
      c.missingMandatory.length === 0 &&
      c.unsatisfiedCategories.length === 0
    );
  }

  assessCompleteness(state: PlanState, model: ConstraintModel): CompletenessAssessment {
    return assessCompleteness(state, model);
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

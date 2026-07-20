/**
 * A real, model-aware Simulation capability — the first non-no-op
 * implementation toward the AcademicDecisionAgent's "Simulate" pipeline slot
 * (see .remember/current.md's "Next step" candidates).
 *
 * Deliberately NOT an implementation of academic_decision_types.ts's
 * SimulationCapability. That interface's only call site
 * (AcademicDecisionAgent.run(), academic_decision_agent.ts) invokes it with
 * the Observe-stage ConstraintModel — a DIFFERENT model instance than the one
 * Plan actually built and searched over internally (Plan is a black box via
 * PlanningCapability; see academic_decision_factory.ts's documented reasoning
 * for why the top-level ValidationCapability is deliberately left unwired for
 * the exact same reason). Rescoring/revalidating a finalState against the
 * wrong model instance would silently reintroduce the same class of drift bug
 * a previous epic (7fdfc1c) closed for the Plan stage's own programId.
 *
 * Instead, this is wired into runPlanningOrchestration (planner_orchestration.ts),
 * where the model Plan used is already in scope right after PlannerAgent.run()
 * resolves — the literal same instance, zero drift risk, no second board load.
 *
 * Algorithm: a bounded, deterministic single-best-neighbor local search. Tries
 * every candidate next action from the finalState (the SAME action space
 * PlannerAgent's own search already explores, via PolicyProvider.generateActions),
 * applies + validates + scores each with the existing, unmodified
 * applyMutation/scorePlan/compareScore/validate — no reimplemented planner
 * logic. Keeps the strictly-best still-valid neighbor found; returns the
 * original AgentResult unchanged (same reference) when nothing improves.
 *
 * Deliberately narrow (single step, not a full hill-climb to convergence):
 * BeamSearchStrategy already explores widely (default width 6, up to 150
 * steps) with its own validation, so this is a bounded sanity/refinement pass
 * over a bounded candidate slice, not a second full search. A multi-step
 * variant is a natural, separately-scoped future epic if this proves useful.
 */

import { applyMutation } from './planner_goals';
import { TauPolicyProvider, type PolicyProvider } from './planner_policy';
import { buildValidationContext } from './planner_validate';
import type { AgentResult } from './planner_agent';
import type { ConstraintModel, PlannerMutation } from './planner_types';

export interface PlanSimulationRequest {
  result: AgentResult;
  /** MUST be the same ConstraintModel instance (or an equivalent build) Plan used to produce `result`. */
  model: ConstraintModel;
  /** Defaults to {} — matches PlannerAgent's own default when a caller has no pinned-home info at this layer. */
  pinnedHome?: Record<string, string>;
  /** Defaults to a fresh TauPolicyProvider — pass the same policy Plan used for consistent scoring/validation. */
  policy?: PolicyProvider;
}

export interface PlanSimulationCapability {
  simulate(request: PlanSimulationRequest): Promise<AgentResult>;
}

export interface LocalSearchSimulationOptions {
  /** Max candidate actions evaluated, in PolicyProvider.generateActions' own deterministic order. Defaults to 40. */
  maxCandidates?: number;
}

export class LocalSearchSimulationCapability implements PlanSimulationCapability {
  constructor(private opts: LocalSearchSimulationOptions = {}) {}

  async simulate(request: PlanSimulationRequest): Promise<AgentResult> {
    const { result, model, pinnedHome = {} } = request;
    const policy = request.policy ?? new TauPolicyProvider();
    const maxCandidates = this.opts.maxCandidates ?? 40;

    const baseState = result.finalState;
    const baseScore = policy.score(baseState, model);
    const validationCtx = buildValidationContext(model, pinnedHome);

    let bestState = baseState;
    let bestScore = baseScore;
    let bestAction: PlannerMutation | null = null;

    const candidates = policy.generateActions(baseState, model).slice(0, maxCandidates);
    for (const action of candidates) {
      const nextState = applyMutation(baseState, action);
      if (!nextState) continue;
      if (!policy.validate(nextState, model, pinnedHome, validationCtx).valid) continue;
      const nextScore = policy.score(nextState, model);
      if (policy.compareScore(nextScore, bestScore) > 0) {
        bestState = nextState;
        bestScore = nextScore;
        bestAction = action;
      }
    }

    if (!bestAction) return result;
    return { ...result, finalState: bestState, trace: [...result.trace, bestAction] };
  }
}

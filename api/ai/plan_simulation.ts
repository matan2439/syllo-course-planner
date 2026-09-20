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
 *
 * Validation semantics: PlannerAgent prefers an injected ValidationCapability
 * over policy.validate whenever the caller supplied one (see its `deps.validate`
 * closure in planner_agent.ts). A candidate a custom validator would reject
 * must never be accepted here just because raw policy.validate allows it — so
 * `request.validation`, when present, is consulted instead of policy.validate,
 * mirroring PlannerAgent's own precedence exactly.
 *
 * Result-consistency: an improving candidate changes finalState/trace, which
 * makes `meta.chosenPath` (if present) and `rationale_he` — both produced by
 * the Plan stage, before this candidate existed — potentially stale.
 * `meta.chosenPath` is extended with the simulation's own step, keeping it in
 * lockstep with the returned `trace`/`finalState`. `rationale_he` has no cheap
 * way to be regenerated here (that requires an ExplanationCapability, out of
 * scope for this capability) and is explicitly invalidated (`undefined`)
 * rather than left describing a plan that no longer matches — callers already
 * handle an absent rationale_he (e.g. generate-plan.ts's deterministic
 * fallback).
 */

import { applyMutation } from './planner_goals';
import { TauPolicyProvider, type PolicyProvider } from './planner_policy';
import { buildValidationContext } from './planner_validate';
import type { ValidationCapability } from './planner_capabilities';
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
  /**
   * The same ValidationCapability (if any) Plan's PlannerAgent was given.
   * When present, candidates are validated through it instead of
   * policy.validate — matching PlannerAgent's own precedence, so a candidate
   * the real injected validator would reject can never be accepted here.
   */
  validation?: ValidationCapability;
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
    const { result, model, pinnedHome = {}, validation } = request;
    const policy = request.policy ?? new TauPolicyProvider();
    const maxCandidates = this.opts.maxCandidates ?? 40;

    const baseState = result.finalState;
    const baseScore = policy.score(baseState, model);
    const validationCtx = buildValidationContext(model, pinnedHome);
    // Mirrors PlannerAgent's own `deps.validate` precedence exactly: prefer
    // an injected ValidationCapability over raw policy.validate.
    const isValid = (state: typeof baseState) =>
      validation
        ? validation.validateState(state).valid
        : policy.validate(state, model, pinnedHome, validationCtx).valid;

    let bestState = baseState;
    let bestScore = baseScore;
    let bestAction: PlannerMutation | null = null;

    const candidates = policy.generateActions(baseState, model).slice(0, maxCandidates);
    for (const action of candidates) {
      const nextState = applyMutation(baseState, action);
      if (!nextState) continue;
      if (!isValid(nextState)) continue;
      const nextScore = policy.score(nextState, model);
      if (policy.compareScore(nextScore, bestScore) > 0) {
        bestState = nextState;
        bestScore = nextScore;
        bestAction = action;
      }
    }

    if (!bestAction) return result;

    const meta = result.meta
      ? { ...result.meta, chosenPath: [...result.meta.chosenPath, { action: bestAction, resultState: bestState }] }
      : result.meta;

    return {
      ...result,
      finalState: bestState,
      trace: [...result.trace, bestAction],
      meta,
      // Stale: describes a plan produced before this candidate was applied.
      // No ExplanationCapability is available here to regenerate it, so it's
      // explicitly invalidated rather than left misleading.
      rationale_he: undefined,
    };
  }
}

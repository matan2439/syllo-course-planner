/**
 * api/ai/plan_decision.ts — the first real (non-pass-through) Decision
 * capability for the AcademicDecisionAgent track: given multiple candidate
 * AgentResults, picks the best-scoring still-valid one instead of always
 * returning candidates[0] (PassThroughDecisionCapability's behavior,
 * academic_decision_types.ts).
 *
 * Deliberately NOT an implementation of academic_decision_types.ts's
 * DecisionCapability. That interface's only call site
 * (AcademicDecisionAgent.run(), academic_decision_agent.ts) invokes decide()
 * with a single-element array built from the Observe-stage ConstraintModel —
 * a DIFFERENT model instance than the one Plan (a black box via
 * PlanningCapability) actually searched over internally. Scoring/validating
 * candidates against the wrong model instance would reintroduce the same
 * model-drift bug class 7fdfc1c already closed for programId — the same
 * reason plan_simulation.ts's PlanSimulationCapability is a separate,
 * explicitly-model-scoped interface rather than a SimulationCapability
 * implementation, and the same reason academic_decision_factory.ts documents
 * for deliberately leaving the top-level ValidationCapability unwired.
 *
 * Not wired into any call site yet. runPlanningOrchestration (where
 * plan_simulation.ts's LocalSearchSimulationCapability is wired, since that's
 * the one place Plan's real model and resulting AgentResult are already
 * co-located) currently only ever produces ONE AgentResult per run,
 * optionally refined once by simulation — there is no multi-candidate
 * producer today. This capability is built standalone, ready for a future
 * epic that produces multiple candidates to choose between (e.g. parallel
 * plan attempts, competing search strategies), per the exact "narrowest safe
 * increment" discipline plan_simulation.ts / plan_persistence.ts already
 * established. `.remember/current.md`'s "Next step" pointer has repeatedly
 * flagged a real DecisionCapability as the last remaining no-op slot.
 *
 * Result consistency: decide() only SELECTS one of the given AgentResult
 * objects, unchanged — it never mutates a candidate's finalState/trace/meta/
 * rationale_he. So there is no staleness risk of the kind Codex's
 * plan_simulation.ts review caught (a mutated finalState leaving meta/
 * rationale_he describing a different plan): the returned object was already
 * internally consistent when it arrived here.
 */

import type { AgentResult } from './planner_agent';
import { TauPolicyProvider, type PolicyProvider } from './planner_policy';
import { buildValidationContext } from './planner_validate';
import type { ValidationCapability } from './planner_capabilities';
import type { ConstraintModel } from './planner_types';

export interface PlanDecisionRequest {
  /** Must be non-empty — see decide()'s documented behavior for an empty array. */
  candidates: AgentResult[];
  /** MUST be the same ConstraintModel instance (or an equivalent build) every candidate's finalState was produced/validated against. */
  model: ConstraintModel;
  /** Defaults to {} — matches PlannerAgent's/plan_simulation.ts's own default when a caller has no pinned-home info at this layer. */
  pinnedHome?: Record<string, string>;
  /** Defaults to a fresh TauPolicyProvider — pass the same policy the candidates were produced/scored with for consistent comparison. */
  policy?: PolicyProvider;
  /**
   * The same ValidationCapability (if any) Plan's PlannerAgent was given for
   * these candidates. When present, each candidate is validated through it
   * instead of policy.validate — matching PlannerAgent's/plan_simulation.ts's
   * own precedence, so a candidate the real injected validator would reject
   * can never be chosen here just because raw policy.validate allows it.
   */
  validation?: ValidationCapability;
}

export interface PlanDecisionCapability {
  decide(request: PlanDecisionRequest): Promise<AgentResult>;
}

/**
 * Picks the candidate with the best policy.score, among those policy.validate
 * (or the injected ValidationCapability) accepts, using policy.compareScore
 * for comparison — the exact same scoring/validation stack Plan and
 * plan_simulation.ts already use, no reimplemented logic. Ties keep the
 * earliest still-valid candidate (compareScore must return strictly > 0 to
 * replace the current best). When NO candidate is valid, falls back to
 * candidates[0] — matching PassThroughDecisionCapability's unconditional
 * behavior, so a decision is always returned rather than silently dropping
 * every candidate.
 */
export class ScoreBasedDecisionCapability implements PlanDecisionCapability {
  async decide(request: PlanDecisionRequest): Promise<AgentResult> {
    const { candidates, model, pinnedHome = {}, validation } = request;
    if (candidates.length === 0) {
      throw new Error('ScoreBasedDecisionCapability.decide: candidates must not be empty');
    }

    const policy = request.policy ?? new TauPolicyProvider();
    const validationCtx = buildValidationContext(model, pinnedHome);
    const isValid = (candidate: AgentResult) =>
      validation
        ? validation.validateState(candidate.finalState).valid
        : policy.validate(candidate.finalState, model, pinnedHome, validationCtx).valid;

    let best: AgentResult | null = null;
    let bestScore: number[] | null = null;
    for (const candidate of candidates) {
      if (!isValid(candidate)) continue;
      const score = policy.score(candidate.finalState, model);
      if (!best || policy.compareScore(score, bestScore!) > 0) {
        best = candidate;
        bestScore = score;
      }
    }

    return best ?? candidates[0];
  }
}

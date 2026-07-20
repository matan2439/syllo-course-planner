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
import { validateCandidate } from './planner_validate';
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
   * An additional, caller-supplied validator — e.g. the same ValidationCapability
   * Plan's PlannerAgent search used. When present, a candidate must pass BOTH
   * this validator AND the default validateCandidate gate below; it is an
   * extra reject condition, never a replacement for the full gate. (Unlike
   * PlannerAgent's/plan_simulation.ts's own precedence, where an injected
   * validator fully REPLACES the default check: those consult it mid-search,
   * where a "search-time" validator commonly only enforces hard legality
   * because it must still accept incomplete intermediate states, and
   * completeness is guaranteed separately by the search only terminating once
   * its own isGoal check passes. decide() has no such external completeness
   * guarantee — it trusts whatever finished AgentResults it's handed — so
   * reusing that same search-time validator here as a full replacement could
   * let an incomplete or disallowed-course candidate through.)
   */
  validation?: ValidationCapability;
}

export interface PlanDecisionCapability {
  decide(request: PlanDecisionRequest): Promise<AgentResult>;
}

/**
 * Picks the candidate with the best policy.score, among those that pass
 * validateCandidate (planner_validate.ts) — AND the injected
 * ValidationCapability, when supplied — using policy.compareScore for
 * comparison. No reimplemented scoring/validation logic.
 *
 * Deliberately validateCandidate, NOT policy.validate: policy.validate only
 * wraps validatePlanState — hard legality (offering/prereqs/overload/
 * duplicates/pinned). It does NOT check degree-requirement completeness or
 * the disallowed-course rule; that's validateCandidate's job (documented in
 * planner_validate.ts as "the full candidate gate every plan must pass
 * before it can be shown as final"). Using the narrower policy.validate here
 * would let a candidate containing a user-disallowed/excluded course, or one
 * short of the degree-hours target, be scored and potentially selected over
 * a fully valid lower-scoring alternative — decide() is choosing a FINAL
 * result, so it must apply the same final gate a candidate would need to
 * pass to be shown to a user at all. This full gate always applies, even when
 * a caller supplies its own ValidationCapability — see that field's doc
 * comment for why decide() can't safely treat an injected validator as a
 * full replacement the way PlannerAgent/plan_simulation.ts do.
 *
 * Ties keep the earliest still-valid candidate (compareScore must return
 * strictly > 0 to replace the current best). When NO candidate is valid,
 * falls back to candidates[0] — matching PassThroughDecisionCapability's
 * unconditional behavior, so a decision is always returned rather than
 * silently dropping every candidate.
 */
export class ScoreBasedDecisionCapability implements PlanDecisionCapability {
  async decide(request: PlanDecisionRequest): Promise<AgentResult> {
    const { candidates, model, pinnedHome = {}, validation } = request;
    if (candidates.length === 0) {
      throw new Error('ScoreBasedDecisionCapability.decide: candidates must not be empty');
    }

    const policy = request.policy ?? new TauPolicyProvider();
    const isValid = (candidate: AgentResult) => {
      if (!validateCandidate(candidate.finalState, model, pinnedHome, policy).valid) return false;
      if (validation && !validation.validateState(candidate.finalState).valid) return false;
      return true;
    };

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

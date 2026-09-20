/**
 * academic_decision_integration.ts — the seam that makes the REAL
 * AcademicDecisionAgent class (academic_decision_agent.ts), built by
 * createDefaultAcademicDecisionAgent (academic_decision_factory.ts), execute
 * from the native Generate route (generate-plan.ts) behind the default-off
 * `use_academic_decision_agent` flag.
 *
 * Owner-authorised architectural direction: the agent orchestrates AROUND the
 * existing stable planner — it must NOT re-plan from emptyState (which would
 * build a different ConstraintModel and change the proposal). So the stable
 * planner is injected as the agent's PlanningCapability: a thin closure that
 * returns the ALREADY-generated proposal's final PlanState as an AgentResult.
 * Observe reuses the ALREADY-loaded board + ALREADY-built model (no second
 * board load, and the Observe model is the exact one the plan was built from).
 * Clarify reuses the ALREADY-computed ClarificationResult, so the agent's
 * clarification output is identical to the runtime adapter's — the class
 * genuinely runs its Observe→detectGaps→Clarify→Plan→Validate→Decide→Persist
 * pipeline, while the generated plan stays byte-identical to the default path.
 *
 * No HTTP, no DB, no LLM, no paid provider, no plan mutation. Pure orchestration
 * over inputs generate-plan.ts already has in hand.
 */

import { createDefaultAcademicDecisionAgent } from './academic_decision_factory';
import type { AcademicDecisionResult } from './academic_decision_agent';
import type { AgentResult } from './planner_agent';
import type { ClarificationResult } from './academic_decision_types';
import type { ConstraintModel, PlanState } from './planner_types';
import type { BuildModelOptions } from './planner_model';
import type { ProgramProvider } from './program_provider';
import { EMPTY_GROUNDING, type PlanGrounding } from './plan_grounding';
import type { AgentValidation } from './grounding_validation';
import { buildStructuredClarification, type StructuredClarification } from './structured_clarification';
import { parseProgramVersionId } from '../board';

export interface RunAcademicDecisionAgentInput {
  programId: string;
  dbUrl?: string;
  /** The board already loaded by generate-plan.ts — reused, never re-loaded. */
  board: Record<string, unknown>;
  /** The ConstraintModel already built by generate-plan.ts — reused, never rebuilt. */
  model: ConstraintModel;
  /** The final PlanState of the stable planner's generated proposal. */
  finalState: PlanState;
  /** The stable proposal's Hebrew rationale (surfaced as AgentResult.rationale_he). */
  rationaleHe?: string;
  /** The ClarificationResult generate-plan.ts already computed for this request. */
  clarification: ClarificationResult;
  buildModelOptions?: BuildModelOptions;
  currentCourseIds?: string[];
}

/**
 * The structured, mutually-exclusive outcome of a flagged Generate run — the
 * single discriminator a client switches on. Precedence (highest first):
 *   error                  — the agent engine failed (safe fallback taken);
 *   blocked                — the plan has a blocking gate error (not applyable);
 *   clarification_required — a critical planning input is missing (a draft still
 *                            exists, but Apply must wait for the answer);
 *   validation_failed      — the plan is placed and fully specified, but the
 *                            grounding layer surfaced an unresolved fact conflict
 *                            (e.g. catalog vs normalized availability) that must
 *                            be reviewed before Apply — the plan is NOT changed
 *                            to hide it, and neither conflicting source is
 *                            silently chosen;
 *   proposal               — a valid, complete, conflict-free, applyable draft.
 */
export type AcademicDecisionOutcome =
  | 'proposal'
  | 'clarification_required'
  | 'validation_failed'
  | 'infeasible'
  | 'blocked'
  | 'error';

export function classifyAgentOutcome(a: {
  engineFailed: boolean;
  blocked: boolean;
  hasCriticalMissingInput: boolean;
  hasUnresolvedConflicts: boolean;
  /**
   * Slice 18A — a HARD user constraint cannot be satisfied at all (a
   * contradiction between two selections, or a structural impossibility against
   * an authoritative catalog fact). Ranked ABOVE 'blocked': 'blocked' says the
   * produced plan failed a gate, while 'infeasible' says no legal plan satisfying
   * the request exists, which is the more specific and more actionable truth.
   * Either way no degraded best-effort plan is ever presented as applyable.
   */
  hardConstraintsInfeasible?: boolean;
}): AcademicDecisionOutcome {
  if (a.engineFailed) return 'error';
  if (a.hardConstraintsInfeasible) return 'infeasible';
  if (a.blocked) return 'blocked';
  if (a.hasCriticalMissingInput) return 'clarification_required';
  if (a.hasUnresolvedConflicts) return 'validation_failed';
  return 'proposal';
}

/**
 * Apply is eligible only for a clean 'proposal'. Blocked/errored/clarification
 * drafts must not be applyable; draft staleness is a separate, client-side gate
 * (this is a server-side eligibility floor, not the whole rule).
 */
export function isApplyEligible(outcome: AcademicDecisionOutcome): boolean {
  return outcome === 'proposal';
}

/** Safe, structured metadata proving which orchestration path executed. No secrets, no internal state. */
export interface AcademicDecisionOrchestration {
  /** 'AcademicDecisionAgent' when the real class ran; 'runtime-adapter-fallback' when it threw and the adapter-only view was kept. */
  engine: 'AcademicDecisionAgent' | 'runtime-adapter-fallback';
  /** The stable planner supplied the plan — the agent never re-planned. */
  planningSource: 'stable-planner';
  /** True when the agent produced a plan result (not blocked on a critical missing input). */
  planned: boolean;
  /** Count of top-level Observe-stage gaps the agent detected over the real model. */
  gapsDetected: number;
}

export interface AcademicDecisionAgentRun {
  result?: AcademicDecisionResult;
  orchestration: AcademicDecisionOrchestration;
  /** The clarification the agent's Clarify stage produced (identical to the injected one on success). */
  clarification: ClarificationResult;
  /**
   * Plan-inert Knowledge Grounding over the generated plan (known / unknown /
   * inferred / conflicting course facts, with provenance and structured
   * conflicts). Reasoning/validation/clarification/explanation input only —
   * never mutates the plan. Always computed on the flagged path (success or
   * controlled failure) since it reads the stable model + plan directly.
   */
  grounding: PlanGrounding;
  /**
   * Class-native grounding-validation result — typed conflict findings +
   * whether an unresolved authoritative conflict blocks Apply. Undefined on the
   * controlled-failure path (the class threw before validating).
   */
  validation?: AgentValidation;
  /**
   * Unified structured clarification contract (answerable preference gaps +
   * non-answerable authoritative conflicts). A pure projection over
   * clarification + validation — see structured_clarification.ts.
   */
  structuredClarification: StructuredClarification;
}

/**
 * Run the real AcademicDecisionAgent around generate-plan's stable proposal.
 * Never throws: a controlled agent failure returns the injected clarification
 * with an adapter-fallback orchestration marker, so the caller keeps its
 * existing (adapter-built) academicDecision view unchanged. Committed state is
 * never touched (this whole path is read-only).
 */
export async function runAcademicDecisionAgent(
  input: RunAcademicDecisionAgentInput,
): Promise<AcademicDecisionAgentRun> {
  const stableProvider: ProgramProvider = {
    parseProgramId: (id: string) => parseProgramVersionId(id),
    loadBoard: async () => input.board,
    buildModel: () => input.model,
  };

  const stableAgentResult: AgentResult = {
    finalState: input.finalState,
    trace: [],
    gaps: [],
    rationale_he: input.rationaleHe,
  };

  try {
    const agent = createDefaultAcademicDecisionAgent({
      overrides: {
        programProvider: stableProvider,
        // Inject the stable planner as the PlanningCapability — no emptyState
        // re-planning; the agent orchestrates around the existing proposal.
        planning: () => ({ run: async () => stableAgentResult }),
        // Reuse the already-computed clarification so the agent's Clarify stage
        // yields the exact same result generate-plan.ts already surfaces.
        clarification: { clarify: async () => input.clarification },
      },
    });

    const result = await agent.run({
      programId: input.programId,
      dbUrl: input.dbUrl,
      buildModelOptions: input.buildModelOptions,
      currentCourseIds: input.currentCourseIds,
    });

    return {
      result,
      orchestration: {
        engine: 'AcademicDecisionAgent',
        planningSource: 'stable-planner',
        planned: result.agentResult != null && !result.blocked,
        gapsDetected: result.gaps.length,
      },
      clarification: result.clarification,
      // Class-native grounding — the AcademicDecisionAgent Ground stage is now
      // the single owner. EMPTY_GROUNDING only if the class ran with no plan.
      grounding: result.grounding ?? EMPTY_GROUNDING,
      validation: result.validation,
      structuredClarification: buildStructuredClarification({
        clarification: result.clarification,
        validation: result.validation,
      }),
    };
  } catch {
    // Controlled failure: the class threw before producing grounding, so there
    // is none to surface. Outcome is 'error' (applyEligible false) anyway.
    return {
      orchestration: {
        engine: 'runtime-adapter-fallback',
        planningSource: 'stable-planner',
        planned: false,
        gapsDetected: 0,
      },
      clarification: input.clarification,
      grounding: EMPTY_GROUNDING,
      structuredClarification: buildStructuredClarification({ clarification: input.clarification }),
    };
  }
}

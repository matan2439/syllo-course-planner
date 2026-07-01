/**
 * createDefaultAcademicDecisionAgent — composition root proving
 * AcademicDecisionAgent (academic_decision_agent.ts) is constructible from
 * real project building blocks, without changing that class at all.
 *
 * AcademicDecisionAgent stays a clean top-level pipeline class that only
 * *receives* dependencies — it never calls runPlanningOrchestration and never
 * builds its own deps. This factory is where that composition happens: the
 * Plan-stage `PlanningCapability` handed to AcademicDecisionAgent is a thin
 * closure over the existing, unmodified `runPlanningOrchestration`
 * (Phase 2b), which in turn composes TauProgramProvider + PlannerAgent +
 * BeamSearchStrategy + PassThroughKnowledgeCapability (+ LlmExplainer, when a
 * languageModel is supplied) — exactly as generate-plan.ts's agentic path
 * already does.
 *
 * Not wired into generate-plan.ts / planner-run.ts / PlannerWorker /
 * planner_orchestration.ts — those files are untouched and unaware this
 * factory exists.
 *
 * Known seam (documented, not fixed here): `orchestrationRequest.programId`
 * (used to build the Plan-stage closure) and the `programId` later passed to
 * `agent.run(...)` (used for AcademicDecisionAgent's own top-level Observe /
 * gap-detection stage) are independent — callers must pass matching values
 * themselves. Unifying them would require either exposing
 * AcademicDecisionAgent's internal Observe-stage model (a refactor of that
 * class) or making the class call runPlanningOrchestration itself — both
 * explicitly out of scope for this epic.
 *
 * Also documented: the top-level `ValidationCapability` slot is left unwired
 * by default. A real implementation would need the same
 * ConstraintModel + pinnedHome + PlanValidationContext that only exists
 * inside the Plan stage's own `runPlanningOrchestration` call — building a
 * second model here just to re-validate the final state would mean a third
 * independent board load, for a check that's already happening (for real,
 * unchanged) per-candidate-state inside PlannerAgent's search via
 * TauPolicyProvider.validate. Nothing about plan correctness is weakened by
 * leaving this slot unwired.
 */

import type { LanguageModel } from 'ai';
import { AcademicDecisionAgent, type AcademicDecisionDeps } from './academic_decision_agent';
import {
  NoOpClarificationCapability,
  NoOpSimulationCapability,
  PassThroughDecisionCapability,
  NoOpPersistenceCapability,
  type ClarificationCapability,
  type SimulationCapability,
  type DecisionCapability,
  type PersistenceCapability,
} from './academic_decision_types';
import { runPlanningOrchestration, type OrchestrationRequest } from './planner_orchestration';
import { ProgramProvider, TauProgramProvider } from './program_provider';
import { PassThroughKnowledgeCapability, type KnowledgeCapability, type ExplanationCapability, type ValidationCapability, type SearchCapability } from './planner_capabilities';
import { BeamSearchStrategy } from './planner_search_beam';
import { LlmExplainer } from './llm_explainer';
import type { PolicyProvider } from './planner_policy';
import type { PlanningCapability } from './planner_agent';
import type { PlanState, PlannerMutation } from './planner_types';

export interface DefaultAcademicDecisionAgentOptions {
  /** Forwarded to the Plan stage's runPlanningOrchestration call unless overrides.planning replaces it entirely. */
  orchestrationRequest: OrchestrationRequest;
  /** Enables the real LlmExplainer as the default ExplanationCapability. Omit to leave explanation unset (matches PlannerAgent's own optional-explanation behavior). */
  languageModel?: LanguageModel;
  overrides?: {
    programProvider?: ProgramProvider;
    search?: SearchCapability<PlanState, PlannerMutation>;
    knowledge?: KnowledgeCapability;
    explanation?: ExplanationCapability;
    policy?: PolicyProvider;
    maxSteps?: number;
    beamWidth?: number;
    /** Full override of the Plan stage — bypasses runPlanningOrchestration entirely. */
    planning?: PlanningCapability;
    clarification?: ClarificationCapability;
    validation?: ValidationCapability;
    simulation?: SimulationCapability;
    decision?: DecisionCapability;
    persistence?: PersistenceCapability;
  };
}

export function createDefaultAcademicDecisionAgent(
  opts: DefaultAcademicDecisionAgentOptions,
): AcademicDecisionAgent {
  const overrides = opts.overrides ?? {};

  const programProvider = overrides.programProvider ?? new TauProgramProvider();
  const search: SearchCapability<PlanState, PlannerMutation> = overrides.search ?? {
    search: (s, deps, searchOpts) => new BeamSearchStrategy<PlanState, PlannerMutation>().explore(s, deps, searchOpts),
  };
  const knowledge = overrides.knowledge ?? new PassThroughKnowledgeCapability();
  const explanation = overrides.explanation ?? (opts.languageModel ? new LlmExplainer(opts.languageModel) : undefined);

  const planning: PlanningCapability = overrides.planning ?? {
    run: () => runPlanningOrchestration(opts.orchestrationRequest, {
      programProvider,
      search,
      knowledge,
      explanation,
      policy: overrides.policy,
      maxSteps: overrides.maxSteps,
      beamWidth: overrides.beamWidth,
    }),
  };

  const deps: AcademicDecisionDeps = {
    programProvider,
    planning,
    clarification: overrides.clarification ?? new NoOpClarificationCapability(),
    validation: overrides.validation,
    simulation: overrides.simulation ?? new NoOpSimulationCapability(),
    decision: overrides.decision ?? new PassThroughDecisionCapability(),
    persistence: overrides.persistence ?? new NoOpPersistenceCapability(),
  };

  return new AcademicDecisionAgent(deps);
}

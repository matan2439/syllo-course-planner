/**
 * runPlanningOrchestration — transport-agnostic entry point tying
 * ProgramProvider (Phase 2) to the existing PlannerAgent/PolicyProvider/
 * capability stack (Phase 3/4): program id + user context in, AgentResult
 * out. No HTTP/Vercel/UI knowledge, no env reads — the caller supplies dbUrl
 * explicitly. Pure composition of existing pieces; not wired into
 * generate-plan.ts or planner-run.ts.
 */

import { PlannerAgent, type AgentResult } from './planner_agent';
import type {
  SearchCapability,
  KnowledgeCapability,
  ValidationCapability,
  ExplanationCapability,
} from './planner_capabilities';
import type { PolicyProvider } from './planner_policy';
import { ProgramProvider, TauProgramProvider } from './program_provider';
import { emptyState, type PlanState, type PlannerMutation } from './planner_types';
import type { PlanSimulationCapability } from './plan_simulation';

export interface OrchestrationRequest {
  programId: string;
  dbUrl?: string;
  completedCourseIds?: string[];
  wantedCourseIds?: string[];
  unwantedCourseIds?: string[];
  disallowedCourseIds?: string[];
  pinnedCourseIds?: string[];
  maxHoursPerSemester?: number;
  priorHours?: number;
  overloadAccepted?: boolean;
  overloadConfirmedAt?: number | null;
}

export interface OrchestrationDeps {
  /** Defaults to TauProgramProvider. */
  programProvider?: ProgramProvider;
  /** Passed through to PlannerAgent — its own default (TauPolicyProvider) applies when omitted. */
  policy?: PolicyProvider;
  /** Required — PlannerAgent has no default search strategy either. */
  search: SearchCapability<PlanState, PlannerMutation>;
  knowledge?: KnowledgeCapability;
  validation?: ValidationCapability;
  explanation?: ExplanationCapability;
  maxSteps?: number;
  beamWidth?: number;
  /**
   * Optional post-Plan refinement pass. Omitted by default — every existing
   * caller sees byte-identical behavior. Wired here (not in
   * AcademicDecisionAgent) because `model` below is the SAME instance Plan
   * searched over; see plan_simulation.ts's header for why that matters.
   */
  simulation?: PlanSimulationCapability;
}

export async function runPlanningOrchestration(
  req: OrchestrationRequest,
  deps: OrchestrationDeps,
): Promise<AgentResult> {
  const provider = deps.programProvider ?? new TauProgramProvider();

  const board = await provider.loadBoard(req.programId, req.dbUrl);
  if (!board) {
    throw new Error(`Program not found: ${req.programId}`);
  }

  const model = provider.buildModel(board, {
    completedCourseIds: req.completedCourseIds,
    wantedCourseIds: req.wantedCourseIds,
    unwantedCourseIds: req.unwantedCourseIds,
    disallowedCourseIds: req.disallowedCourseIds,
    pinnedCourseIds: req.pinnedCourseIds,
    maxHoursPerSemester: req.maxHoursPerSemester,
    priorHours: req.priorHours,
    overloadAccepted: req.overloadAccepted,
    overloadConfirmedAt: req.overloadConfirmedAt,
  });

  const initialState = emptyState(model.knownSemesterIds);

  const agent = new PlannerAgent({
    model,
    initialState,
    search: deps.search,
    knowledge: deps.knowledge,
    validation: deps.validation,
    explanation: deps.explanation,
    policy: deps.policy,
    maxSteps: deps.maxSteps,
    beamWidth: deps.beamWidth,
  });

  const result = await agent.run();
  if (!deps.simulation) return result;
  return deps.simulation.simulate({ result, model, policy: deps.policy });
}

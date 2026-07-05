/**
 * AcademicDecisionAgent — top-level pipeline shell for the future
 * AcademicDecisionAgent architecture. Composes:
 *
 *   Observe (ProgramProvider)
 *   -> Detect Gaps (pure detectGaps, over the Observe-stage model)
 *   -> Clarify (always runs; observational only — reports missing planning
 *      inputs via ClarificationResult, never blocks Plan unless the caller
 *      opts in with `blockOnMissingCriticalInputs: true` and a critical
 *      input is missing, in which case Plan is skipped and the result comes
 *      back with `blocked: true` instead of an AgentResult)
 *   -> Plan (delegates entirely to a PlanningCapability built from the SAME
 *      AcademicDecisionRequest passed to run() — a black box; PlannerAgent's
 *      own internal detect-gaps/enrich/search/explain flow is untouched and
 *      unaware of this pipeline)
 *   -> Validate if wired
 *   -> Simulate if needed
 *   -> Decide if needed
 *   -> Persist
 *
 * No HTTP/env knowledge. Not wired into generate-plan.ts, planner-run.ts, or
 * PlannerWorker. planner_agent.ts / planner_capabilities.ts /
 * planner_orchestration.ts / program_provider.ts are untouched — this file
 * only imports their existing exported types/classes.
 */

import { detectGaps, type GapRecord, type ValidationCapability } from './planner_capabilities';
import type { PlanningCapability, AgentResult } from './planner_agent';
import { ProgramProvider, TauProgramProvider } from './program_provider';
import type { BuildModelOptions } from './planner_model';
import {
  NoOpClarificationCapability,
  NoOpSimulationCapability,
  PassThroughDecisionCapability,
  NoOpPersistenceCapability,
  type ClarificationCapability,
  type ClarificationResult,
  type SimulationCapability,
  type DecisionCapability,
  type PersistenceCapability,
} from './academic_decision_types';

export interface AcademicDecisionRequest {
  programId: string;
  dbUrl?: string;
  buildModelOptions?: BuildModelOptions;
  /** In-progress courses — not yet in buildModelOptions.completedCourseIds. Clarification-only for now; not consumed by Plan. */
  currentCourseIds?: string[];
  /** Track/focus preference (e.g. design, fluids, systems). Clarification-only for now; not consumed by Plan. */
  track?: string;
  /** When true, a critical missing clarification input blocks Plan entirely (see AcademicDecisionResult.blocked). Defaults to false — observational only. */
  blockOnMissingCriticalInputs?: boolean;
}

export interface AcademicDecisionDeps {
  /** Defaults to TauProgramProvider. */
  programProvider?: ProgramProvider;
  /**
   * Required — builds the Plan stage from the SAME AcademicDecisionRequest
   * passed to run(). This is the single source of truth for programId/dbUrl:
   * Observe (above) and Plan (the PlanningCapability this returns) can never
   * see different program ids, because both are derived from one `req`.
   */
  planning: (req: AcademicDecisionRequest) => PlanningCapability;
  clarification?: ClarificationCapability;
  validation?: ValidationCapability;
  simulation?: SimulationCapability;
  decision?: DecisionCapability;
  persistence?: PersistenceCapability;
}

export interface AcademicDecisionResult {
  /** Absent only when `blocked` is true — Plan never ran. */
  agentResult?: AgentResult;
  /** Top-level pre-Plan gap scan (Observe-stage model) — separate from AgentResult.gaps, which is PlanningCapability's own internal scan over whatever model it was built from. */
  gaps: GapRecord[];
  /** Result of the Clarify stage, which now always runs before Plan. */
  clarification: ClarificationResult;
  /** True when a critical missing input, combined with `blockOnMissingCriticalInputs: true`, stopped Plan from running. */
  blocked: boolean;
}

export class AcademicDecisionAgent {
  constructor(private deps: AcademicDecisionDeps) {}

  async run(req: AcademicDecisionRequest): Promise<AcademicDecisionResult> {
    const provider = this.deps.programProvider ?? new TauProgramProvider();

    // Observe
    const board = await provider.loadBoard(req.programId, req.dbUrl);
    if (!board) {
      throw new Error(`Program not found: ${req.programId}`);
    }
    const model = provider.buildModel(board, req.buildModelOptions);

    // Detect gaps
    const gaps = detectGaps(model);

    // Clarify — always runs before Plan, regardless of top-level gaps
    const clarification = this.deps.clarification ?? new NoOpClarificationCapability();
    const clarificationResult = await clarification.clarify({
      gaps,
      context: {
        completedCourseIds: req.buildModelOptions?.completedCourseIds,
        currentCourseIds: req.currentCourseIds,
        excludedCourseIds: req.buildModelOptions?.disallowedCourseIds,
        maxWeeklyHours: req.buildModelOptions?.maxHoursPerSemester,
        track: req.track,
      },
    });

    const hasCriticalMissingInput = clarificationResult.missingInputs.some((m) => m.critical);
    if (req.blockOnMissingCriticalInputs && hasCriticalMissingInput) {
      return { gaps, clarification: clarificationResult, blocked: true };
    }

    // Plan — built from the same `req` as Observe, then treated as a black box
    const planned = await this.deps.planning(req).run();

    // Validate if wired
    if (this.deps.validation) {
      const { valid, reason } = this.deps.validation.validateState(planned.finalState);
      if (!valid) {
        throw new Error(
          `AcademicDecisionAgent: plan failed top-level validation${reason ? `: ${reason}` : ''}`,
        );
      }
    }

    // Simulate if needed
    const simulation = this.deps.simulation ?? new NoOpSimulationCapability();
    const simulated = await simulation.simulate(planned);

    // Decide if needed
    const decision = this.deps.decision ?? new PassThroughDecisionCapability();
    const decided = await decision.decide([simulated]);

    // Persist
    const persistence = this.deps.persistence ?? new NoOpPersistenceCapability();
    await persistence.persist(decided);

    return { agentResult: decided, gaps, clarification: clarificationResult, blocked: false };
  }
}

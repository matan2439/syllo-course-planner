/**
 * AcademicDecisionAgent — top-level pipeline shell for the future
 * AcademicDecisionAgent architecture. Composes:
 *
 *   Observe (ProgramProvider)
 *   -> Detect Gaps (pure detectGaps, over the Observe-stage model)
 *   -> Clarify if needed
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
  type SimulationCapability,
  type DecisionCapability,
  type PersistenceCapability,
} from './academic_decision_types';

export interface AcademicDecisionRequest {
  programId: string;
  dbUrl?: string;
  buildModelOptions?: BuildModelOptions;
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
  agentResult: AgentResult;
  /** Top-level pre-Plan gap scan (Observe-stage model) — separate from AgentResult.gaps, which is PlanningCapability's own internal scan over whatever model it was built from. */
  gaps: GapRecord[];
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

    // Clarify if needed
    if (gaps.length > 0) {
      const clarification = this.deps.clarification ?? new NoOpClarificationCapability();
      await clarification.clarify({ gaps });
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

    return { agentResult: decided, gaps };
  }
}

/**
 * AcademicDecisionAgent epic — the four north-star capability slots not yet
 * covered by planner_capabilities.ts: Clarification, Simulation, Decision,
 * Persistence. Purely additive shell types + no-op default implementations,
 * mirroring PassThroughKnowledgeCapability's pattern (planner_capabilities.ts).
 *
 * Nothing here is wired into PlannerAgent, runPlanningOrchestration, or any
 * production path. AcademicDecisionAgent (academic_decision_agent.ts) is the
 * only consumer.
 */

import type { AgentResult } from './planner_agent';
import type { GapRecord } from './planner_capabilities';

// ── ClarificationCapability ───────────────────────────────────────────────────

/** User-supplied planning inputs relevant to clarification, sourced from AcademicDecisionRequest. */
export interface ClarificationPlanningContext {
  completedCourseIds?: string[];
  currentCourseIds?: string[];
  excludedCourseIds?: string[];
  maxWeeklyHours?: number;
  track?: string;
}

export interface ClarificationRequest {
  gaps: GapRecord[];
  context: ClarificationPlanningContext;
}

export type MissingInputField =
  | 'completedCourses'
  | 'currentCourses'
  | 'excludedCourses'
  | 'maxWeeklyHours'
  | 'track';

export interface MissingInput {
  field: MissingInputField;
  /** True when planning correctness depends on this input (see academic_clarification.ts for rationale per field). */
  critical: boolean;
  message: string;
}

export interface ClarificationResult {
  needsClarification: boolean;
  missingInputs: MissingInput[];
  questions?: string[];
  warnings?: string[];
}

/**
 * Invoked by AcademicDecisionAgent before Plan, on every run. Observational by
 * default: reporting missing inputs never blocks planning unless the caller
 * opts in via AcademicDecisionRequest.blockOnMissingCriticalInputs.
 */
export interface ClarificationCapability {
  clarify(request: ClarificationRequest): Promise<ClarificationResult>;
}

/** ponytail: reports nothing missing until a real clarification flow (user Q&A) ships */
export class NoOpClarificationCapability implements ClarificationCapability {
  async clarify(_request: ClarificationRequest): Promise<ClarificationResult> {
    return { needsClarification: false, missingInputs: [] };
  }
}

// ── SimulationCapability ──────────────────────────────────────────────────────

/**
 * Invoked by AcademicDecisionAgent after Plan, only when explicitly wired.
 * Pass-through identity by default (NoOpSimulationCapability) — no what-if
 * scenario exploration exists yet.
 */
export interface SimulationCapability {
  simulate(result: AgentResult): Promise<AgentResult>;
}

/** ponytail: identity pass-through until scenario simulation ships */
export class NoOpSimulationCapability implements SimulationCapability {
  async simulate(result: AgentResult): Promise<AgentResult> {
    return result;
  }
}

// ── DecisionCapability ────────────────────────────────────────────────────────

/**
 * Invoked by AcademicDecisionAgent after Simulate to choose among candidate
 * results. Pass-through of the first (only) candidate by default
 * (PassThroughDecisionCapability) — there is no multi-candidate comparison
 * yet since Simulate does not produce variants.
 */
export interface DecisionCapability {
  decide(candidates: AgentResult[]): Promise<AgentResult>;
}

/** ponytail: pass-through until multi-candidate comparison ships */
export class PassThroughDecisionCapability implements DecisionCapability {
  async decide(candidates: AgentResult[]): Promise<AgentResult> {
    return candidates[0];
  }
}

// ── PersistenceCapability ─────────────────────────────────────────────────────

/**
 * Invoked by AcademicDecisionAgent last. No-op by default
 * (NoOpPersistenceCapability) — no DB/Supabase interaction in this epic.
 */
export interface PersistenceCapability {
  persist(result: AgentResult): Promise<void>;
}

/** ponytail: no-op until a real persistence/learning store ships */
export class NoOpPersistenceCapability implements PersistenceCapability {
  async persist(_result: AgentResult): Promise<void> {
    // intentional no-op
  }
}

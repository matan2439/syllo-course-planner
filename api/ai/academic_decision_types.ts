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

export interface ClarificationRequest {
  gaps: GapRecord[];
}

/**
 * Invoked by AcademicDecisionAgent before Plan, only when the top-level
 * detectGaps scan finds gaps. No-op by default (NoOpClarificationCapability).
 */
export interface ClarificationCapability {
  clarify(request: ClarificationRequest): Promise<void>;
}

/** ponytail: no-op until a real clarification flow (user Q&A) ships */
export class NoOpClarificationCapability implements ClarificationCapability {
  async clarify(_request: ClarificationRequest): Promise<void> {
    // intentional no-op
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

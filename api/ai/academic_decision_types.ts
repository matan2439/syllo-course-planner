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
import type { AcademicInterestProfile } from './academic_interest_profile';

// ── ClarificationCapability ───────────────────────────────────────────────────

/** User-supplied planning inputs relevant to clarification, sourced from AcademicDecisionRequest. */
export interface ClarificationPlanningContext {
  completedCourseIds?: string[];
  /**
   * True when the completed-course set is ESTABLISHED — including an explicit
   * "I have completed none" (an empty `completedCourseIds` that is a real
   * answer). Absent/false means UNKNOWN, so the critical clarification is
   * retained: an empty list alone never counts as an answer
   * (academic_status_knowledge.ts). Every pre-existing caller omits this and is
   * therefore unaffected.
   */
  completedCoursesKnown?: boolean;
  currentCourseIds?: string[];
  excludedCourseIds?: string[];
  maxWeeklyHours?: number;
  track?: string;
  /**
   * Opt-in: interest clarification questions (academic_focus_areas etc., see
   * academic_clarification.ts) only fire when this field is explicitly present
   * (even an empty profile) and not yet "meaningful"
   * (hasMeaningfulAcademicInterests, academic_interest_profile.ts). Left
   * entirely absent, behavior is byte-identical to before this field existed —
   * required so every pre-existing caller (none of which set it) is unaffected.
   */
  academicInterestProfile?: AcademicInterestProfile;
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
  | 'track'
  | 'academicFocusAreas'
  | 'academicAvoidAreas'
  | 'courseStylePreferences'
  | 'optimizationPriorities'
  | 'careerGoals';

export interface MissingInput {
  field: MissingInputField;
  /** True when planning correctness depends on this input (see academic_clarification.ts for rationale per field). */
  critical: boolean;
  message: string;
}

export type ClarificationAnswerType =
  | 'course_ids'
  | 'course_id_list'
  | 'number'
  | 'text'
  | 'single_choice'
  | 'multi_choice'
  | 'boolean';

/**
 * A stable, machine-readable question derived from a MissingInput — the
 * contract a future UI or LLM layer can act on directly (render a form field,
 * or feed to a prompt) without re-deriving meaning from free-form strings.
 */
export interface ClarificationQuestion {
  /** Stable, unique, snake_case identifier — e.g. 'completed_courses'. */
  id: string;
  /** The ClarificationPlanningContext field this question fills in. */
  inputKey: string;
  required: boolean;
  critical: boolean;
  answerType: ClarificationAnswerType;
  question: string;
  rationale?: string;
  examples?: string[];
  options?: Array<{ value: string; label: string }>;
}

export interface ClarificationResult {
  needsClarification: boolean;
  missingInputs: MissingInput[];
  /** Always present — one ClarificationQuestion per MissingInput, in the same order. Empty when nothing is missing. */
  questions: ClarificationQuestion[];
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
    return { needsClarification: false, missingInputs: [], questions: [] };
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

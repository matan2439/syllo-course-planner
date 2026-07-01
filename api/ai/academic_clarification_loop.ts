/**
 * ClarificationLoopHarness — deterministic, pure, no-I/O composition proving
 * the two existing clarification-contract pieces work together across
 * repeated AcademicDecisionAgent runs:
 *
 *   DeterministicClarificationCapability (academic_clarification.ts)
 *   produces structured ClarificationQuestion[] from an
 *   AcademicDecisionRequest; applyClarificationAnswers
 *   (academic_clarification_answers.ts) merges answers back into a fresh
 *   AcademicDecisionRequest.
 *
 * This file adds the missing middle piece: answer-shape validation (so an
 * invalid answer never silently makes a request look "complete") and a thin
 * step function for running the loop against a real or fake
 * AcademicDecisionAgent.
 *
 * Not wired into AcademicDecisionAgent, the factory, generate-plan.ts,
 * planner-run.ts, PlannerWorker, PlannerAgent, or planner_orchestration.ts.
 * No UI, no LLM, no Supabase — application-layer utility only.
 */

import { DeterministicClarificationCapability } from './academic_clarification';
import { applyClarificationAnswers, type ClarificationAnswer } from './academic_clarification_answers';
import type { AcademicDecisionRequest, AcademicDecisionResult } from './academic_decision_agent';
import type {
  ClarificationPlanningContext,
  ClarificationQuestion,
  ClarificationResult,
} from './academic_decision_types';

/** Mirrors AcademicDecisionAgent.run()'s own request -> ClarificationPlanningContext mapping (academic_decision_agent.ts). */
function contextFromRequest(req: AcademicDecisionRequest): ClarificationPlanningContext {
  return {
    completedCourseIds: req.buildModelOptions?.completedCourseIds,
    currentCourseIds: req.currentCourseIds,
    excludedCourseIds: req.buildModelOptions?.disallowedCourseIds,
    maxWeeklyHours: req.buildModelOptions?.maxHoursPerSemester,
    track: req.track,
  };
}

/**
 * First-request step of the loop: derives a ClarificationPlanningContext from
 * an AcademicDecisionRequest and runs it through
 * DeterministicClarificationCapability directly — no ProgramProvider, board,
 * or PlanningCapability needed. Pure and deterministic.
 */
export async function clarifyRequest(req: AcademicDecisionRequest): Promise<ClarificationResult> {
  const capability = new DeterministicClarificationCapability();
  return capability.clarify({ gaps: [], context: contextFromRequest(req) });
}

export interface ClarificationLoopAnswer {
  questionId: string;
  value: string[] | string | number;
}

export interface InvalidClarificationAnswer {
  questionId: string;
  reason: string;
}

export interface ApplyClarificationLoopAnswersResult {
  request: AcademicDecisionRequest;
  invalidAnswers: InvalidClarificationAnswer[];
}

type ExpectedAnswerKind = 'string_list' | 'string' | 'number';

/** Expected value shape per stable question id (see academic_clarification.ts's QUESTION_SPECS answerType). */
const EXPECTED_ANSWER_KIND: Record<string, ExpectedAnswerKind> = {
  completed_courses: 'string_list',
  current_courses: 'string_list',
  excluded_courses: 'string_list',
  max_weekly_hours: 'number',
  track_or_focus: 'string',
};

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((entry) => typeof entry === 'string');
}

function validateAnswerValue(questionId: string, value: unknown): string | null {
  const kind = EXPECTED_ANSWER_KIND[questionId];
  if (!kind) return null; // unrecognized ids: applyClarificationAnswers itself ignores them
  if (kind === 'string_list' && !isStringArray(value)) {
    return `'${questionId}' expects a list of strings`;
  }
  if (kind === 'number' && !(typeof value === 'number' && Number.isFinite(value))) {
    return `'${questionId}' expects a number`;
  }
  if (kind === 'string' && !(typeof value === 'string' && value.trim().length > 0)) {
    return `'${questionId}' expects non-empty text`;
  }
  return null;
}

/**
 * Answer-application step of the loop: validates each answer's value shape
 * against its stable question id before delegating to
 * applyClarificationAnswers (academic_clarification_answers.ts). Invalid
 * answers are dropped from the merge and surfaced in `invalidAnswers` — they
 * never silently make the request look complete.
 */
export function applyClarificationLoopAnswers(
  req: AcademicDecisionRequest,
  answers: ClarificationLoopAnswer[],
): ApplyClarificationLoopAnswersResult {
  const invalidAnswers: InvalidClarificationAnswer[] = [];
  const validAnswers: ClarificationAnswer[] = [];

  for (const answer of answers) {
    const reason = validateAnswerValue(answer.questionId, answer.value);
    if (reason) {
      invalidAnswers.push({ questionId: answer.questionId, reason });
    } else {
      validAnswers.push(answer);
    }
  }

  return { request: applyClarificationAnswers(req, validAnswers), invalidAnswers };
}

/** Duck-typed AcademicDecisionAgent surface — a fake or factory-created agent works too, no concrete-class dependency needed. */
export interface ClarificationLoopAgent {
  run(req: AcademicDecisionRequest): Promise<AcademicDecisionResult>;
}

export interface ClarificationLoopStepResult {
  needsClarification: boolean;
  questions: ClarificationQuestion[];
  blocked: boolean;
  clarification: ClarificationResult;
  agentResult: AcademicDecisionResult['agentResult'];
  gaps: AcademicDecisionResult['gaps'];
}

/**
 * Runs one AcademicDecisionAgent pass and extracts the loop-relevant fields.
 * Works with a fake agent, a factory-created agent, or the real class — any
 * object shaped like ClarificationLoopAgent.
 */
export async function runClarificationLoopStep(
  agent: ClarificationLoopAgent,
  req: AcademicDecisionRequest,
): Promise<ClarificationLoopStepResult> {
  const result = await agent.run(req);
  return {
    needsClarification: result.clarification.needsClarification,
    questions: result.clarification.questions,
    blocked: result.blocked,
    clarification: result.clarification,
    agentResult: result.agentResult,
    gaps: result.gaps,
  };
}

/**
 * runClarificationPreflight — pure, no-I/O helper that runs the existing
 * deterministic clarification check (clarifyRequest,
 * academic_clarification_loop.ts, itself wrapping
 * DeterministicClarificationCapability, academic_clarification.ts) against an
 * AcademicDecisionRequest and packages the result together with a UI-ready
 * view model (buildClarificationViewModel, academic_clarification_view_model.ts).
 *
 * Does not decide what's missing itself — delegates entirely to the existing
 * clarification contract. `blocked` mirrors the exact same "any critical
 * missing input" rule AcademicDecisionAgent.run() already uses
 * (academic_decision_agent.ts), so a caller can gate planning consistently
 * without reimplementing that rule.
 *
 * No React/DOM/Supabase/LLM imports. Not wired into AcademicDecisionAgent, the
 * factory, PlannerAgent, planner_orchestration.ts, planner-run.ts, or
 * PlannerWorker. The only intended runtime caller is generate-plan.ts, gated
 * behind AI_USE_ACADEMIC_CLARIFICATION_PREFLIGHT (default disabled).
 *
 * resumeClarificationPreflight — the answers-aware wrapper. Merges answers via
 * applyClarificationLoopAnswers (academic_clarification_loop.ts, which
 * validates each answer's shape before delegating to
 * applyClarificationAnswers, academic_clarification_answers.ts) and re-runs
 * the preflight against the updated request. With no answers it behaves
 * exactly like runClarificationPreflight.
 */

import {
  applyClarificationLoopAnswers,
  clarifyRequest,
  type ClarificationLoopAnswer,
  type InvalidClarificationAnswer,
} from './academic_clarification_loop';
import { buildClarificationViewModel, type ClarificationViewModel } from './academic_clarification_view_model';
import type { AcademicDecisionRequest } from './academic_decision_agent';
import type { ClarificationResult } from './academic_decision_types';

export interface ClarificationPreflightResult {
  needsClarification: boolean;
  /** True when a critical missing input means planning should not be delegated. */
  blocked: boolean;
  clarification: ClarificationResult;
  viewModel: ClarificationViewModel;
}

/** Mirrors AcademicDecisionAgent.run()'s own "any critical missing input" rule (academic_decision_agent.ts). */
function isBlocked(clarification: ClarificationResult): boolean {
  return clarification.missingInputs.some((missingInput) => missingInput.critical);
}

export async function runClarificationPreflight(
  req: AcademicDecisionRequest,
): Promise<ClarificationPreflightResult> {
  const clarification = await clarifyRequest(req);
  const blocked = isBlocked(clarification);
  const viewModel = buildClarificationViewModel(clarification, { blocking: blocked });

  return {
    needsClarification: clarification.needsClarification,
    blocked,
    clarification,
    viewModel,
  };
}

export interface ClarificationResumeResult extends ClarificationPreflightResult {
  /** The request after merging any valid answers — identical to the input when no answers are supplied. */
  request: AcademicDecisionRequest;
  /** Answers that failed shape validation (academic_clarification_loop.ts) — never silently merged. */
  invalidAnswers: InvalidClarificationAnswer[];
}

/**
 * Answers-aware wrapper over runClarificationPreflight: applies any supplied
 * answers (validated and merged via applyClarificationLoopAnswers,
 * academic_clarification_loop.ts) to a fresh copy of `req`, then re-runs the
 * clarification preflight against the updated request. With no answers, this
 * is exactly runClarificationPreflight (same result, request echoed back
 * unchanged). Pure, no-I/O — does not mutate `req`.
 */
export async function resumeClarificationPreflight(
  req: AcademicDecisionRequest,
  answers: ClarificationLoopAnswer[] = [],
): Promise<ClarificationResumeResult> {
  if (answers.length === 0) {
    const preflight = await runClarificationPreflight(req);
    return { ...preflight, request: req, invalidAnswers: [] };
  }

  const { request, invalidAnswers } = applyClarificationLoopAnswers(req, answers);
  const clarification = await clarifyRequest(request);
  const blocked = isBlocked(clarification);
  const viewModel = buildClarificationViewModel(clarification, { blocking: blocked, invalidAnswers });

  return {
    needsClarification: clarification.needsClarification,
    blocked,
    clarification,
    viewModel,
    request,
    invalidAnswers,
  };
}

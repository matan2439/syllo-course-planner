/**
 * ClarificationUX view-model adapter — pure, deterministic, no-I/O transform
 * from an existing ClarificationResult (produced by
 * DeterministicClarificationCapability, academic_clarification.ts, and
 * optionally re-validated by academic_clarification_loop.ts) into a stable,
 * UI-ready shape a future UI layer can render directly.
 *
 * Consumes ClarificationQuestion[] as-is — does not re-derive or duplicate
 * what's missing; that decision stays in DeterministicClarificationCapability.
 * `blocking` is likewise a caller-supplied fact (AcademicDecisionAgent's own
 * `blocked` field), not recomputed here.
 *
 * No React/DOM/Supabase/LLM/production-planner imports. Not wired into
 * AcademicDecisionAgent, the factory, generate-plan.ts, planner-run.ts,
 * PlannerWorker, PlannerAgent, or planner_orchestration.ts.
 */

import type { ClarificationQuestion, ClarificationResult } from './academic_decision_types';
import type { InvalidClarificationAnswer } from './academic_clarification_loop';

export interface ClarificationViewModelItem {
  id: string;
  inputKey: string;
  label: string;
  prompt: string;
  answerType: string;
  required: boolean;
  critical: boolean;
  examples?: string[];
  options?: Array<{ value: string; label: string }>;
  validationMessage?: string;
}

export interface ClarificationViewModel {
  needsUserInput: boolean;
  title: string;
  summary: string;
  blocking: boolean;
  items: ClarificationViewModelItem[];
  primaryActionLabel: string;
  secondaryActionLabel?: string;
}

export interface BuildClarificationViewModelOptions {
  /** Caller-supplied fact (e.g. AcademicDecisionResult.blocked) — never recomputed here. */
  blocking?: boolean;
  /** Invalid-answer metadata from academic_clarification_loop.ts's applyClarificationLoopAnswers. */
  invalidAnswers?: InvalidClarificationAnswer[];
}

function labelFromId(id: string): string {
  return id
    .split('_')
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
}

function toItem(
  question: ClarificationQuestion,
  validationMessageByQuestionId: Map<string, string>,
): ClarificationViewModelItem {
  return {
    id: question.id,
    inputKey: question.inputKey,
    label: labelFromId(question.id),
    prompt: question.question,
    answerType: question.answerType,
    required: question.required,
    critical: question.critical,
    examples: question.examples,
    options: question.options,
    validationMessage: validationMessageByQuestionId.get(question.id),
  };
}

function buildSummary(clarification: ClarificationResult, blocking: boolean): string {
  if (!clarification.needsClarification) {
    return 'All planning inputs are present.';
  }
  if (blocking) {
    return 'Answer the required questions below before we can continue planning.';
  }
  return 'Answering these questions will improve your plan, but planning can continue without them.';
}

export function buildClarificationViewModel(
  clarification: ClarificationResult,
  options: BuildClarificationViewModelOptions = {},
): ClarificationViewModel {
  const { blocking = false, invalidAnswers = [] } = options;
  const validationMessageByQuestionId = new Map(invalidAnswers.map((a) => [a.questionId, a.reason]));

  const items = clarification.questions.map((question) =>
    toItem(question, validationMessageByQuestionId),
  );

  return {
    needsUserInput: clarification.needsClarification,
    title: clarification.needsClarification ? 'We need a bit more information' : 'Ready to plan',
    summary: buildSummary(clarification, blocking),
    blocking,
    items,
    primaryActionLabel: clarification.needsClarification ? 'Submit answers' : 'Continue',
    secondaryActionLabel: clarification.needsClarification && !blocking ? 'Skip for now' : undefined,
  };
}

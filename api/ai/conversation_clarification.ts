/**
 * Server-owned bridge between the conversation wire contract and the durable
 * academic context. A clarification answer is a user claim, not a planner
 * instruction: it is stored as context and receives fresh digests before the
 * agent is allowed to plan against it.
 */
import { academicStatusDigest, preferenceDigest } from './apply_runtime';
import {
  applyClarificationLoopAnswers,
  type ClarificationLoopAnswer,
} from './academic_clarification_loop';
import type { AcademicDecisionRequest } from './academic_decision_agent';

export type ConversationClarificationAnswer = ClarificationLoopAnswer;

export interface ConversationClarificationContextInput {
  programId: string;
  planContext: Record<string, unknown>;
  personalStatus: Record<string, unknown>;
  preferences: Record<string, unknown>;
  answers: ConversationClarificationAnswer[];
}

export interface ConversationClarificationContextResult {
  planContext: Record<string, unknown>;
  personalStatus: Record<string, unknown>;
  preferences: Record<string, unknown>;
  academicStatusDigest: string;
  preferenceDigest: string;
  invalidAnswers: Array<{ questionId: string; reason: string }>;
  changed: boolean;
}

const ANSWERABLE_QUESTION_IDS = new Set([
  'completed_courses',
  'current_courses',
  'excluded_courses',
  'max_weekly_hours',
  'track_or_focus',
]);

/** Apply only the stable questions emitted by this endpoint. */
export function applyConversationClarificationAnswers(
  input: ConversationClarificationContextInput,
): ConversationClarificationContextResult {
  const answers = input.answers.filter((answer) => ANSWERABLE_QUESTION_IDS.has(answer.questionId));
  if (answers.length === 0) {
    return {
      planContext: input.planContext,
      personalStatus: input.personalStatus,
      preferences: input.preferences,
      academicStatusDigest: academicStatusDigest(input.personalStatus),
      preferenceDigest: preferenceDigest(input.preferences),
      invalidAnswers: [],
      changed: false,
    };
  }

  const personal = input.personalStatus;
  // Build a patch from this turn's answers only. Reconstructing the existing
  // personal status through planner ID lists loses course metadata and can
  // turn an unanswered completion question into an explicit "none" answer.
  const baseRequest: AcademicDecisionRequest = { programId: input.programId };
  const merged = applyClarificationLoopAnswers(baseRequest, answers);
  const nextPersonalStatus: Record<string, unknown> = { ...personal };
  const nextPreferences: Record<string, unknown> = { ...input.preferences };
  const nextPlanContext: Record<string, unknown> = { ...input.planContext };
  const nextOptions = merged.request.buildModelOptions;

  if (nextOptions?.completedCourseIds !== undefined) {
    nextPersonalStatus.completed = nextOptions.completedCourseIds.map((course_id) => ({ course_id }));
    nextPersonalStatus.completed_knowledge = { status: 'known', provenance: 'explicit_user' };
  }
  if (merged.request.currentCourseIds !== undefined) {
    nextPersonalStatus.currently_taking = merged.request.currentCourseIds.map((course_id) => ({ course_id }));
  }
  if (nextOptions?.disallowedCourseIds !== undefined) {
    nextPreferences.disallowed_course_ids = nextOptions.disallowedCourseIds;
  }
  if (nextOptions?.maxHoursPerSemester !== undefined) {
    nextPreferences.max_weekly_hours = nextOptions.maxHoursPerSemester;
  }
  if (merged.request.track !== undefined) nextPlanContext.track = merged.request.track;
  nextPlanContext.personal_status = nextPersonalStatus;

  return {
    planContext: nextPlanContext,
    personalStatus: nextPersonalStatus,
    preferences: nextPreferences,
    academicStatusDigest: academicStatusDigest(nextPersonalStatus),
    preferenceDigest: preferenceDigest(nextPreferences),
    invalidAnswers: merged.invalidAnswers,
    changed: answers.length > 0 && merged.invalidAnswers.length < answers.length,
  };
}

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
import { earlyYearHoursById } from '../../shared/planner/early_year_courses';

/**
 * Credit hours of the completed courses: the program's Years 1–2 table first
 * (those courses are absent from the board), else the board catalog's hours.
 */
export function completedCreditHours(programId: string, board: unknown, courseIds: readonly string[]): number {
  const early = earlyYearHoursById(programId);
  const boardHours = new Map<string, number>();
  const raw = board as { semesters?: Array<{ courses?: unknown[] }>; metadata?: { program_repository_courses?: unknown[] } } | null;
  for (const course of [
    ...(raw?.semesters ?? []).flatMap((semester) => semester.courses ?? []),
    ...(raw?.metadata?.program_repository_courses ?? []),
  ] as Array<{ course_id?: unknown; weekly_hours?: unknown }>) {
    if (typeof course?.course_id === 'string' && typeof course.weekly_hours === 'number') {
      boardHours.set(course.course_id, course.weekly_hours);
    }
  }
  return [...new Set(courseIds)].reduce((sum, id) => sum + (early[id] ?? boardHours.get(id) ?? 0), 0);
}

/**
 * The degree credit the planner starts from (`known_completed_hours`) must follow
 * the completed courses; otherwise completing Years 1–2 in the chat or panel
 * leaves the plan ~90h short and it can never validate.
 */
export function withCompletedCredit(
  planContext: Record<string, unknown>,
  programId: string,
  board: unknown,
  /** The completed ids BEFORE this change — for contexts saved before the credit marker existed. */
  previousCompletedIds?: readonly string[],
): Record<string, unknown> {
  const personal = (planContext.personal_status ?? {}) as { completed?: Array<{ course_id?: unknown } | string> };
  const ids = (personal.completed ?? [])
    .map((course) => typeof course === 'string' ? course : course?.course_id)
    .filter((id): id is string => typeof id === 'string');
  const progress = (planContext.total_hours_progress ?? {}) as Record<string, unknown>;
  const derived = completedCreditHours(programId, board, ids);
  // Keep credit the student entered by hand (e.g. transfer credit, the web client's
  // max rule), but never a value this function derived earlier: removing a completed
  // course must lower the credit, or a short plan could validate.
  const known = typeof progress.known_completed_hours === 'number' ? progress.known_completed_hours : 0;
  const previouslyDerived = typeof progress.completed_courses_credit_hours === 'number'
    ? progress.completed_courses_credit_hours
    // No marker yet (saved before it existed): the credit the previous list carried is
    // what the client/server derived then, not hand-entered credit.
    : previousCompletedIds ? completedCreditHours(programId, board, previousCompletedIds) : undefined;
  const entered = previouslyDerived !== undefined && known <= previouslyDerived ? 0 : known;
  return {
    ...planContext,
    total_hours_progress: {
      ...progress,
      completed_courses_credit_hours: derived,
      known_completed_hours: Math.max(entered, derived),
    },
  };
}

export type ConversationClarificationAnswer = {
  questionId: string;
  value: ClarificationLoopAnswer['value'] | Record<string, number>;
};

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
  'wanted_courses',
  'completed_category_counts',
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
  const allAnswers = input.answers.filter((answer) => ANSWERABLE_QUESTION_IDS.has(answer.questionId));
  // Wanted courses come from the profile panel only; they map straight onto the preference.
  const wanted = allAnswers.filter((answer) => answer.questionId === 'wanted_courses');
  const wantedInvalid = wanted
    .filter((answer) => !(Array.isArray(answer.value) && answer.value.every((id) => typeof id === 'string')))
    .map((answer) => ({ questionId: answer.questionId, reason: "'wanted_courses' expects a list of strings" }));
  // Category counts (e.g. how many שער רוח courses) come from the profile panel only; they are
  // plan context, never course ids.
  const isCounts = (value: unknown) => typeof value === 'object' && value !== null && !Array.isArray(value)
    && Object.values(value).every((n) => Number.isInteger(n) && (n as number) >= 0)
  const counts = allAnswers.filter((answer) => answer.questionId === 'completed_category_counts');
  const countsInvalid = counts
    .filter((answer) => !isCounts(answer.value))
    .map((answer) => ({ questionId: answer.questionId, reason: "'completed_category_counts' expects category id → count" }));
  const validCounts = counts.filter((answer) => isCounts(answer.value));
  const answers = allAnswers.filter((answer) => answer.questionId !== 'wanted_courses' && answer.questionId !== 'completed_category_counts');
  if (answers.length === 0 && wanted.length === 0 && counts.length === 0) {
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
  // Only panel-only answers (wanted, counts) carry non-loop values, and both were filtered out above.
  const merged = applyClarificationLoopAnswers(baseRequest, answers as ClarificationLoopAnswer[]);
  const nextPersonalStatus: Record<string, unknown> = { ...personal };
  const nextPreferences: Record<string, unknown> = { ...input.preferences };
  const validWanted = wanted.filter((answer) => Array.isArray(answer.value) && answer.value.every((id) => typeof id === 'string'));
  if (validWanted.length) nextPreferences.wanted_course_ids = validWanted[validWanted.length - 1].value;
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
  if (validCounts.length) nextPlanContext.completed_category_counts = validCounts[validCounts.length - 1].value;
  nextPlanContext.personal_status = nextPersonalStatus;

  return {
    planContext: nextPlanContext,
    personalStatus: nextPersonalStatus,
    preferences: nextPreferences,
    academicStatusDigest: academicStatusDigest(nextPersonalStatus),
    preferenceDigest: preferenceDigest(nextPreferences),
    invalidAnswers: [...merged.invalidAnswers, ...wantedInvalid, ...countsInvalid],
    changed: validWanted.length > 0 || validCounts.length > 0
      || (answers.length > 0 && merged.invalidAnswers.length < answers.length),
  };
}

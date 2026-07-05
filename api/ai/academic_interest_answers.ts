/**
 * Interest Answer Application — converts structured answers to the 5 opt-in
 * Interest Clarification Questions (academic_clarification.ts:
 * academic_focus_areas / academic_avoid_areas / course_style_preferences /
 * optimization_priorities / career_goals) into an AcademicInterestProfile.
 *
 * Mirrors applyClarificationLoopAnswers' validate-then-apply pattern
 * (academic_clarification_loop.ts): each answer's value shape is checked
 * against its stable question id before it's allowed to touch the profile —
 * an invalid or unknown answer is dropped and reported in `invalidAnswers`,
 * never silently applied. Unlike that sibling, an invalid multi_choice
 * answer is partially salvageable: a bad focus-area id among otherwise-valid
 * ones is reported, but the valid ones still apply — mirrors
 * normalizeAcademicInterestProfile's own per-entry tolerance (it silently
 * drops unknown enum members rather than rejecting the whole list) rather
 * than an all-or-nothing reject.
 *
 * Pure, no I/O, never mutates its `baseProfile` argument. Reuses
 * normalizeAcademicInterestProfile (clamp/dedupe/sort) and
 * mergeAcademicInterestProfiles (override-wins precedence) verbatim — no
 * reimplemented clamping/merge logic, and no duplicated
 * AcademicFocusArea/CourseStyle/OptimizationPriority enums. Every selected
 * value gets DEFAULT_INTEREST_WEIGHT (1.0) — this epic's answer shape
 * (string[] | string | number, mirroring ClarificationLoopAnswer) carries no
 * per-entry weight, so weighted answers are out of scope until a real need
 * for them appears.
 *
 * FOUNDATION EPIC ONLY. Not wired into AcademicDecisionAgent,
 * academic_clarification_answers.ts/academic_clarification_loop.ts (those
 * own the pre-existing 5 non-interest fields only), generate-plan.ts,
 * planner scoring, any UI, LLM, or Supabase. No Interest Alignment Scoring,
 * no CourseTopicProfile mapping — this file only builds the user-side
 * AcademicInterestProfile from answers.
 */

import {
  isAcademicFocusArea,
  isCourseStyle,
  isOptimizationPriority,
  normalizeAcademicInterestProfile,
  mergeAcademicInterestProfiles,
  DEFAULT_INTEREST_WEIGHT,
} from './academic_interest_profile';
import type { AcademicInterestProfile } from './academic_interest_profile';

export interface InterestClarificationAnswer {
  questionId: string;
  value: string[] | string | number;
}

export type InterestClarificationAnswerSet = InterestClarificationAnswer[];

export interface InvalidInterestAnswer {
  questionId: string;
  reason: string;
}

export interface InterestAnswerApplicationResult {
  profile: AcademicInterestProfile;
  /** The stable question ids actually applied, in canonical order (not input order). */
  appliedQuestionIds: string[];
  /** In input order. */
  invalidAnswers: InvalidInterestAnswer[];
}

/** Canonical order — matches academic_clarification.ts's QUESTION_SPECS ordering for these 5 ids. */
const CANONICAL_QUESTION_ORDER = [
  'academic_focus_areas',
  'academic_avoid_areas',
  'course_style_preferences',
  'optimization_priorities',
  'career_goals',
] as const;

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((entry) => typeof entry === 'string');
}

function toCareerGoalStrings(value: unknown): string[] | null {
  if (typeof value === 'string') return [value];
  if (isStringArray(value)) return value;
  return null;
}

/**
 * Validates and applies one multi_choice answer: rejects a non-array value
 * outright (shape error), otherwise partitions entries into valid/invalid
 * enum members — invalid ones are reported, valid ones still push into
 * `target` and mark the question applied. An empty (but well-shaped) array
 * is a legitimate "chose nothing" — a no-op, not an error, not "applied".
 */
function applyMultiChoiceAnswer<T extends string>(
  questionId: string,
  value: unknown,
  isValid: (value: unknown) => value is T,
  kindLabel: string,
  target: T[],
  invalidAnswers: InvalidInterestAnswer[],
  appliedIds: Set<string>,
): void {
  if (!isStringArray(value)) {
    invalidAnswers.push({ questionId, reason: `'${questionId}' expects a list of ${kindLabel} ids` });
    return;
  }
  const invalid: string[] = [];
  for (const entry of value) {
    if (isValid(entry)) target.push(entry);
    else invalid.push(entry);
  }
  if (invalid.length > 0) {
    invalidAnswers.push({
      questionId,
      reason: `'${questionId}' contains invalid ${kindLabel} id(s): ${invalid.join(', ')}`,
    });
  }
  if (value.length - invalid.length > 0) {
    appliedIds.add(questionId);
  }
}

export function applyInterestClarificationAnswers(
  baseProfile: AcademicInterestProfile,
  answers: InterestClarificationAnswer[],
): InterestAnswerApplicationResult {
  const focusAreaIds: string[] = [];
  const avoidAreaIds: string[] = [];
  const styleIds: string[] = [];
  const priorityIds: string[] = [];
  const careerGoalEntries: string[] = [];
  const invalidAnswers: InvalidInterestAnswer[] = [];
  const appliedIds = new Set<string>();

  for (const answer of answers) {
    switch (answer.questionId) {
      case 'academic_focus_areas':
        applyMultiChoiceAnswer(
          answer.questionId,
          answer.value,
          isAcademicFocusArea,
          'focus area',
          focusAreaIds,
          invalidAnswers,
          appliedIds,
        );
        break;
      case 'academic_avoid_areas':
        applyMultiChoiceAnswer(
          answer.questionId,
          answer.value,
          isAcademicFocusArea,
          'focus area',
          avoidAreaIds,
          invalidAnswers,
          appliedIds,
        );
        break;
      case 'course_style_preferences':
        applyMultiChoiceAnswer(
          answer.questionId,
          answer.value,
          isCourseStyle,
          'course style',
          styleIds,
          invalidAnswers,
          appliedIds,
        );
        break;
      case 'optimization_priorities':
        applyMultiChoiceAnswer(
          answer.questionId,
          answer.value,
          isOptimizationPriority,
          'optimization priority',
          priorityIds,
          invalidAnswers,
          appliedIds,
        );
        break;
      case 'career_goals': {
        const goals = toCareerGoalStrings(answer.value);
        if (goals === null) {
          invalidAnswers.push({ questionId: answer.questionId, reason: "'career_goals' expects text or a list of text" });
          break;
        }
        const meaningful = goals.map((g) => g.trim()).filter((g) => g.length > 0);
        if (meaningful.length > 0) {
          careerGoalEntries.push(...meaningful);
          appliedIds.add(answer.questionId);
        }
        break;
      }
      default:
        invalidAnswers.push({ questionId: answer.questionId, reason: `Unknown question id '${answer.questionId}'` });
    }
  }

  const patch = normalizeAcademicInterestProfile({
    focusAreas: focusAreaIds.map((area) => ({ area, weight: DEFAULT_INTEREST_WEIGHT })),
    avoidAreas: avoidAreaIds.map((area) => ({ area, weight: DEFAULT_INTEREST_WEIGHT })),
    courseStylePreferences: styleIds.map((style) => ({ style, weight: DEFAULT_INTEREST_WEIGHT })),
    optimizationPriorities: priorityIds.map((priority) => ({ priority, weight: DEFAULT_INTEREST_WEIGHT })),
    careerGoals: careerGoalEntries,
  });
  const profile = mergeAcademicInterestProfiles(baseProfile, patch);
  const appliedQuestionIds = CANONICAL_QUESTION_ORDER.filter((id) => appliedIds.has(id));

  return { profile, appliedQuestionIds, invalidAnswers };
}

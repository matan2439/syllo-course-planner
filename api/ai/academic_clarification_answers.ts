/**
 * applyClarificationAnswers — pure, no-I/O function that merges answers to
 * ClarificationQuestions (academic_decision_types.ts) back into a fresh
 * AcademicDecisionRequest, ready for a follow-up AcademicDecisionAgent.run()
 * call. It is the inverse of the mapping AcademicDecisionAgent.run() already
 * uses to build a ClarificationPlanningContext from a request
 * (academic_decision_agent.ts) — matched by the same stable question ids
 * DeterministicClarificationCapability produces (academic_clarification.ts):
 * completed_courses / current_courses / excluded_courses / max_weekly_hours /
 * track_or_focus.
 *
 * Not wired into AcademicDecisionAgent or any production path — callers
 * (a future clarification UX) are expected to call this between two
 * agent.run() calls themselves.
 */

import type { AcademicDecisionRequest } from './academic_decision_agent';

export interface ClarificationAnswer {
  questionId: string;
  value: string[] | string | number;
}

export function applyClarificationAnswers(
  req: AcademicDecisionRequest,
  answers: ClarificationAnswer[],
): AcademicDecisionRequest {
  const updated: AcademicDecisionRequest = { ...req };
  const buildModelOptions = { ...req.buildModelOptions };
  let touchedBuildModelOptions = false;

  for (const answer of answers) {
    switch (answer.questionId) {
      case 'completed_courses':
        buildModelOptions.completedCourseIds = answer.value as string[];
        touchedBuildModelOptions = true;
        break;
      case 'current_courses':
        updated.currentCourseIds = answer.value as string[];
        break;
      case 'excluded_courses':
        buildModelOptions.disallowedCourseIds = answer.value as string[];
        touchedBuildModelOptions = true;
        break;
      case 'max_weekly_hours':
        buildModelOptions.maxHoursPerSemester = answer.value as number;
        touchedBuildModelOptions = true;
        break;
      case 'track_or_focus':
        updated.track = answer.value as string;
        break;
    }
  }

  if (touchedBuildModelOptions || req.buildModelOptions) {
    updated.buildModelOptions = buildModelOptions;
  }

  return updated;
}

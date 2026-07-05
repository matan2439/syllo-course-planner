/**
 * mergeClarificationAnswersIntoGeneratePlanInputs — pure, no-I/O helper that
 * closes the gap between the clarification preflight gate
 * (academic_clarification_preflight.ts's resumeClarificationPreflight) and
 * generate-plan.ts's actual planning inputs: answers submitted through
 * clarification_answers must not only unblock the gate, they must also reach
 * the plan_context/preferences shapes generate-plan.ts builds its
 * ConstraintModel from (buildModel, generate-plan.ts).
 *
 * Reuses applyClarificationLoopAnswers (academic_clarification_loop.ts) as the
 * single source of truth for answer validation/shape-checking and the 5 stable
 * question ids — no duplicated validation or id list lives here. It is called
 * against a blank AcademicDecisionRequest ({ programId: '' }) purely so that
 * whatever ends up populated afterward is EXACTLY what a validly-answered,
 * recognized question touched — nothing else. That is what lets partial,
 * invalid, and unknown-id answers cleanly no-op without this module needing to
 * re-derive which ids are recognized or how their values are shaped.
 *
 * Canonical target fields (verified against planner_model.ts/_context.ts, not
 * guessed):
 *   completed_courses  -> plan_context.personal_status.completed
 *   current_courses    -> plan_context.personal_status.currently_taking
 *   excluded_courses   -> preferences.disallowed_course_ids
 *   max_weekly_hours   -> preferences.max_weekly_hours
 *   track_or_focus     -> NOT PROPAGATED. No field for track/specialization
 *     exists anywhere in generate-plan.ts's request/context boundary
 *     (PlanContext, preferencesSchema, or BuildModelOptions) — adding one would
 *     be inventing a new planner preference with no consumer, which is out of
 *     scope. This is a documented, deliberate seam, not an oversight.
 *
 * No React/DOM/Supabase/LLM imports. Not wired into AcademicDecisionAgent, the
 * factory, PlannerAgent, planner_orchestration.ts, planner-run.ts, or
 * PlannerWorker. The only intended runtime caller is generate-plan.ts, inside
 * its existing AI_USE_ACADEMIC_CLARIFICATION_PREFLIGHT-gated block.
 */

import { applyClarificationLoopAnswers, type ClarificationLoopAnswer } from './academic_clarification_loop';

export interface GeneratePlanPreferencesInput {
  disallowed_course_ids?: string[];
  max_weekly_hours?: number | null;
}

export interface MergeClarificationAnswersResult<TPreferences extends GeneratePlanPreferencesInput> {
  planContext: any;
  preferences: TPreferences;
}

export function mergeClarificationAnswersIntoGeneratePlanInputs<TPreferences extends GeneratePlanPreferencesInput>(
  planContext: any,
  preferences: TPreferences,
  answers: ClarificationLoopAnswer[],
): MergeClarificationAnswersResult<TPreferences> {
  if (answers.length === 0) {
    return { planContext, preferences };
  }

  // Blank base request: only fields a validly-answered, recognized question
  // touched will be present on `answered` afterward — see module header.
  const { request: answered } = applyClarificationLoopAnswers({ programId: '' }, answers);

  const completedCourseIds = answered.buildModelOptions?.completedCourseIds;
  const currentCourseIds = answered.currentCourseIds;
  let nextPlanContext = planContext;
  if (completedCourseIds !== undefined || currentCourseIds !== undefined) {
    nextPlanContext = {
      ...planContext,
      personal_status: {
        ...planContext?.personal_status,
        ...(completedCourseIds !== undefined
          ? { completed: completedCourseIds.map((course_id) => ({ course_id })) }
          : {}),
        ...(currentCourseIds !== undefined
          ? { currently_taking: currentCourseIds.map((course_id) => ({ course_id })) }
          : {}),
      },
    };
  }

  const disallowedCourseIds = answered.buildModelOptions?.disallowedCourseIds;
  const maxHoursPerSemester = answered.buildModelOptions?.maxHoursPerSemester;
  const nextPreferences = {
    ...preferences,
    ...(disallowedCourseIds !== undefined ? { disallowed_course_ids: disallowedCourseIds } : {}),
    ...(maxHoursPerSemester !== undefined ? { max_weekly_hours: maxHoursPerSemester } : {}),
  } as TPreferences;

  return { planContext: nextPlanContext, preferences: nextPreferences };
}

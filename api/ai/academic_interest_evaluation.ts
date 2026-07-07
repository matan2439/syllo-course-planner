/**
 * Academic Interest Evaluation Facade — a single, deterministic entry point
 * composing the existing interest-alignment pieces into one evidence package
 * for a candidate plan: AcademicInterestProfile + course topic profiles +
 * planned course ids -> InterestPlanAlignmentResult + InterestPlanScorecard.
 *
 * INTEGRATION INFRASTRUCTURE ONLY. evaluateAcademicInterestFit delegates
 * entirely to the existing, unmodified scorePlanInterestAlignment
 * (interest_plan_alignment.ts) and buildInterestPlanScorecard
 * (interest_plan_scorecard.ts) — no matching logic is reimplemented or
 * recomputed here, and no enum is redeclared (AcademicFocusArea/CourseStyle
 * stay defined exactly once, in academic_interest_profile.ts).
 *
 * AcademicInterestProfile and CourseTopicProfile are, by this codebase's
 * established convention (see interest_course_match.ts's header), value types
 * only ever produced via their own normalize/merge/empty helpers — already
 * canonically ordered and weight-clamped. This facade therefore does not
 * re-normalize them (that would silently re-run dedup/clamping a caller may
 * not expect); it trusts its inputs exactly as scorePlanInterestAlignment and
 * matchCourseToAcademicInterests already do.
 *
 * Not wired into planner_goals.ts, generate-plan.ts, PlannerWorker,
 * planner-run.ts, or any UI. No LLM, no Supabase, no persistence.
 */

import { hasMeaningfulAcademicInterests } from './academic_interest_profile';
import type { AcademicInterestProfile } from './academic_interest_profile';
import type { CourseTopicProfile } from './course_topic_profile';
import { scorePlanInterestAlignment } from './interest_plan_alignment';
import type { InterestPlanAlignmentResult } from './interest_plan_alignment';
import { buildInterestPlanScorecard } from './interest_plan_scorecard';
import type { InterestPlanScorecard } from './interest_plan_scorecard';

export interface AcademicInterestEvaluationInput {
  academicInterestProfile: AcademicInterestProfile;
  courseTopicProfilesByCourseId: Record<string, CourseTopicProfile>;
  plannedCourseIds: string[];
}

export interface AcademicInterestEvaluationResult {
  alignment: InterestPlanAlignmentResult;
  scorecard: InterestPlanScorecard;
  hasMeaningfulAcademicInterests: boolean;
  /** Planned course ids that had a CourseTopicProfile — same as alignment.matchedCourseIds. */
  evaluatedCourseIds: string[];
  unmatchedCourseIds: string[];
  /** alignment.notes followed by scorecard.notes, in that order — no deduping, no new notes. */
  notes: string[];
}

export function evaluateAcademicInterestFit(
  input: AcademicInterestEvaluationInput,
): AcademicInterestEvaluationResult {
  const alignment = scorePlanInterestAlignment({
    academicInterestProfile: input.academicInterestProfile,
    courseTopicProfilesByCourseId: input.courseTopicProfilesByCourseId,
    plannedCourseIds: input.plannedCourseIds,
  });
  const scorecard = buildInterestPlanScorecard(alignment);

  return {
    alignment,
    scorecard,
    hasMeaningfulAcademicInterests: hasMeaningfulAcademicInterests(input.academicInterestProfile),
    evaluatedCourseIds: alignment.matchedCourseIds,
    unmatchedCourseIds: alignment.unmatchedCourseIds,
    notes: [...alignment.notes, ...scorecard.notes],
  };
}

/**
 * Plan Interest Scorecard — deterministic, non-LLM explanation layer built on
 * top of InterestPlanAlignmentResult (interest_plan_alignment.ts).
 *
 * scorePlanInterestAlignment already produces a numeric plan-level alignment
 * score; this file turns that into a user-facing but non-LLM scorecard:
 * ranked "top aligned" / "avoid risk" course lists, a coarse summary level,
 * and short deterministic notes explaining the tradeoffs. It performs NO
 * matching recomputation — every field is derived directly from the fields
 * already present on the alignment result (courseMatches, matchedCourseIds,
 * unmatchedCourseIds, notes). Pure and total: never mutates its input.
 *
 * matchedFocusAreas/matchedStyles are kept in the type (per-area/per-style
 * breakdown grouped by AcademicFocusArea/CourseStyle with contributing
 * courseIds) but are always empty arrays here: InterestPlanAlignmentResult's
 * courseMatches only carries aggregate focusMatchScore/styleMatchScore per
 * course, not the per-area/per-style breakdown that matchCourseToAcademicInterests
 * (interest_course_match.ts) computes internally and discards before storing.
 * Populating these fields for real would require re-matching against the
 * original AcademicInterestProfile/CourseTopicProfile — which this function,
 * by design and by its single-argument signature, does not have access to and
 * must not recompute. Left honestly empty rather than fabricated.
 *
 * FOUNDATION EPIC ONLY. Not wired into generate-plan.ts, PlannerWorker,
 * planner-run.ts, or any UI. Planner scoring (planner_goals.ts) and default
 * generated plans are untouched.
 */

import type { AcademicFocusArea, CourseStyle } from './academic_interest_profile';
import type { InterestPlanAlignmentResult, InterestPlanCourseMatch } from './interest_plan_alignment';

export interface InterestCourseScorecardItem {
  courseId: string;
  interestFitScore: number;
  focusMatchScore: number;
  styleMatchScore: number;
  avoidPenalty: number;
}

export interface InterestPlanScorecard {
  interestAlignmentScore: number;
  summaryLevel: 'none' | 'low' | 'medium' | 'high';
  topAlignedCourses: InterestCourseScorecardItem[];
  avoidRiskCourses: InterestCourseScorecardItem[];
  unmatchedCourseIds: string[];
  matchedFocusAreas: Array<{
    area: AcademicFocusArea;
    contribution: number;
    courseIds: string[];
  }>;
  matchedStyles: Array<{
    style: CourseStyle;
    contribution: number;
    courseIds: string[];
  }>;
  notes: string[];
}

function toScorecardItem(m: InterestPlanCourseMatch): InterestCourseScorecardItem {
  return {
    courseId: m.courseId,
    interestFitScore: m.interestFitScore,
    focusMatchScore: m.focusMatchScore,
    styleMatchScore: m.styleMatchScore,
    avoidPenalty: m.avoidPenalty,
  };
}

function summaryLevelFor(score: number): InterestPlanScorecard['summaryLevel'] {
  if (score === 0) return 'none';
  if (score < 0.4) return 'low';
  if (score < 0.7) return 'medium';
  return 'high';
}

export function buildInterestPlanScorecard(
  alignmentResult: InterestPlanAlignmentResult,
): InterestPlanScorecard {
  const summaryLevel = summaryLevelFor(alignmentResult.interestAlignmentScore);

  const topAlignedCourses = alignmentResult.courseMatches
    .map(toScorecardItem)
    .sort((a, b) => b.interestFitScore - a.interestFitScore || a.courseId.localeCompare(b.courseId));

  const avoidRiskCourses = alignmentResult.courseMatches
    .filter((m) => m.avoidPenalty > 0)
    .map(toScorecardItem)
    .sort((a, b) => b.avoidPenalty - a.avoidPenalty || a.courseId.localeCompare(b.courseId));

  const unmatchedCourseIds = [...alignmentResult.unmatchedCourseIds];

  const notes: string[] = [];
  const noInterestsExpressed = alignmentResult.notes.some((n) => n.includes('academic interests expressed'));
  if (noInterestsExpressed) {
    notes.push('No academic interests expressed — alignment is neutral by default.');
  }
  const totalConsidered = alignmentResult.matchedCourseIds.length + alignmentResult.unmatchedCourseIds.length;
  if (totalConsidered > 0 && alignmentResult.matchedCourseIds.length === 0) {
    notes.push('No planned course has a matched topic profile — interest alignment could not be assessed.');
  }
  if (unmatchedCourseIds.length > 0) {
    notes.push(
      `${unmatchedCourseIds.length} planned course(s) have no topic profile and were excluded from alignment scoring.`,
    );
  }
  if (avoidRiskCourses.length > 0) {
    notes.push(`${avoidRiskCourses.length} planned course(s) carry an avoid-area penalty.`);
  }
  if (summaryLevel === 'high') {
    notes.push('Strong interest alignment — this plan closely matches the expressed academic interests.');
  }

  return {
    interestAlignmentScore: alignmentResult.interestAlignmentScore,
    summaryLevel,
    topAlignedCourses,
    avoidRiskCourses,
    unmatchedCourseIds,
    matchedFocusAreas: [],
    matchedStyles: [],
    notes,
  };
}

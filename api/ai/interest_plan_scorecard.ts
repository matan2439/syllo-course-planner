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
 * matchedFocusAreas/matchedStyles group the per-area/per-style breakdown that
 * InterestPlanAlignmentResult.courseMatches now preserves (each entry carries
 * matchCourseToAcademicInterests' own matchedFocusAreas/matchedStyles/
 * avoidedAreas verbatim). Grouping here is pure aggregation over data already
 * present on the input — summing each area/style's contribution across every
 * course that contributes to it, and collecting the contributing courseIds —
 * never a re-match against AcademicInterestProfile/CourseTopicProfile, which
 * this function's single-argument signature has no access to anyway.
 *
 * FOUNDATION EPIC ONLY. Not wired into generate-plan.ts, PlannerWorker,
 * planner-run.ts, or any UI. Planner scoring (planner_goals.ts) and default
 * generated plans are untouched.
 */

import { ACADEMIC_FOCUS_AREAS, COURSE_STYLES } from './academic_interest_profile';
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

/** Sum a Map<K, {contribution, courseIds}> into sorted, deterministic grouped rows. */
function toSortedGroups<K extends string>(
  byKey: Map<K, { contribution: number; courseIds: Set<string> }>,
  canonical: readonly K[],
): Array<{ key: K; contribution: number; courseIds: string[] }> {
  return [...byKey.entries()]
    .map(([key, { contribution, courseIds }]) => ({
      key,
      contribution,
      courseIds: [...courseIds].sort((a, b) => a.localeCompare(b)),
    }))
    .sort((a, b) => b.contribution - a.contribution || canonical.indexOf(a.key) - canonical.indexOf(b.key));
}

/**
 * Group courseMatches[*].matchedFocusAreas by area, summing contribution across
 * every contributing course and collecting the courseIds that contributed — pure
 * aggregation over data already on the input, no recomputation. Sorted by
 * contribution desc, then area asc (canonical ACADEMIC_FOCUS_AREAS order, matching
 * this codebase's normalize/merge conventions elsewhere).
 */
function groupMatchedFocusAreas(
  courseMatches: readonly InterestPlanCourseMatch[],
): InterestPlanScorecard['matchedFocusAreas'] {
  const byArea = new Map<AcademicFocusArea, { contribution: number; courseIds: Set<string> }>();
  for (const m of courseMatches) {
    for (const f of m.matchedFocusAreas) {
      const existing = byArea.get(f.area) ?? { contribution: 0, courseIds: new Set<string>() };
      existing.contribution += f.contribution;
      existing.courseIds.add(m.courseId);
      byArea.set(f.area, existing);
    }
  }
  return toSortedGroups(byArea, ACADEMIC_FOCUS_AREAS).map(({ key, contribution, courseIds }) => ({
    area: key,
    contribution,
    courseIds,
  }));
}

/** Same aggregation as groupMatchedFocusAreas, over courseMatches[*].matchedStyles grouped by style. */
function groupMatchedStyles(
  courseMatches: readonly InterestPlanCourseMatch[],
): InterestPlanScorecard['matchedStyles'] {
  const byStyle = new Map<CourseStyle, { contribution: number; courseIds: Set<string> }>();
  for (const m of courseMatches) {
    for (const s of m.matchedStyles) {
      const existing = byStyle.get(s.style) ?? { contribution: 0, courseIds: new Set<string>() };
      existing.contribution += s.contribution;
      existing.courseIds.add(m.courseId);
      byStyle.set(s.style, existing);
    }
  }
  return toSortedGroups(byStyle, COURSE_STYLES).map(({ key, contribution, courseIds }) => ({
    style: key,
    contribution,
    courseIds,
  }));
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
    matchedFocusAreas: groupMatchedFocusAreas(alignmentResult.courseMatches),
    matchedStyles: groupMatchedStyles(alignmentResult.courseMatches),
    notes,
  };
}

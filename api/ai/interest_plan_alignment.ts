/**
 * Interest Alignment Scoring — opt-in, deterministic, explainable plan-level
 * academic-interest alignment. This is NOT Interest Alignment Scoring inside
 * the planner's default decision loop: it is a standalone bridge that reuses
 * matchCourseToAcademicInterests (interest_course_match.ts) per course.
 *
 * Two exports, in two independent tiers:
 *
 *   1. scorePlanInterestAlignment — a PURE helper, fully decoupled from
 *      PlanState/ConstraintModel. Takes a flat plannedCourseIds: string[], an
 *      AcademicInterestProfile, and a courseId -> CourseTopicProfile map.
 *      Nothing here imports planner_types.ts or planner_goals.ts.
 *
 *   2. compareScoreWithOptionalInterestAlignment — a narrow, ADDITIVE
 *      comparator that wraps the EXISTING, UNMODIFIED scorePlan/compareScore
 *      (planner_goals.ts, read-only imports — zero diff to that file or to
 *      planner_types.ts). It calls compareScore(scorePlan(a), scorePlan(b))
 *      first: every existing goal (degree completion, requirement coverage,
 *      legality, load balance, preferences, difficulty — the entire
 *      GOAL_STACK) is checked EXACTLY as today, at full priority. Only when
 *      that returns a genuine tie (0) AND the caller explicitly supplies
 *      `options` does interest alignment break the tie. Omitting `options`
 *      reproduces compareScore(scorePlan(...)) byte-for-byte — this function
 *      is a strict superset, never a replacement, and is NOT wired into
 *      PlannerWorker, planner-run.ts, PlannerAgent, or generate-plan.ts. A
 *      future epic choosing to consume it there is the next integration seam.
 *
 * FOUNDATION EPIC ONLY, extra-conservative (first scoring-related step in
 * this track). Default generated plans and default planner behavior are
 * unaffected by construction — nothing here is reachable unless a caller
 * explicitly imports and invokes compareScoreWithOptionalInterestAlignment
 * WITH options, which no existing code path does.
 */

import { matchCourseToAcademicInterests } from './interest_course_match';
import type { MatchedFocusArea, MatchedStyle, AvoidedAreaMatch } from './interest_course_match';
import type { AcademicInterestProfile } from './academic_interest_profile';
import { hasMeaningfulAcademicInterests } from './academic_interest_profile';
import type { CourseTopicProfile } from './course_topic_profile';
import { scorePlan, compareScore } from './planner_goals';
import { placedCourseIds } from './planner_types';
import type { ConstraintModel, PlanState } from './planner_types';

export interface InterestPlanCourseMatch {
  courseId: string;
  interestFitScore: number;
  focusMatchScore: number;
  styleMatchScore: number;
  avoidPenalty: number;
  /** Per-area breakdown from matchCourseToAcademicInterests — preserved for downstream explanation (scorecards). */
  matchedFocusAreas: MatchedFocusArea[];
  /** Per-style breakdown from matchCourseToAcademicInterests — preserved for downstream explanation (scorecards). */
  matchedStyles: MatchedStyle[];
  /** Avoided-area breakdown from matchCourseToAcademicInterests — preserved for downstream explanation (scorecards). */
  avoidedAreas: AvoidedAreaMatch[];
}

export interface InterestPlanAlignmentResult {
  /** Normalized 0..1 — average interestFitScore across matched courses; 0 when none matched. */
  interestAlignmentScore: number;
  /** Planned course ids that had a CourseTopicProfile, in plannedCourseIds order, deduped. */
  matchedCourseIds: string[];
  /** Planned course ids with no CourseTopicProfile — excluded from the average, never scored as 0. */
  unmatchedCourseIds: string[];
  courseMatches: InterestPlanCourseMatch[];
  notes: string[];
}

function clamp01(value: number): number {
  if (value < 0) return 0;
  if (value > 1) return 1;
  return value;
}

/** First-seen order, deduped — protects the average from a caller-supplied duplicate id. */
function dedupePreservingOrder(ids: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const id of ids) {
    if (seen.has(id)) continue;
    seen.add(id);
    out.push(id);
  }
  return out;
}

export function scorePlanInterestAlignment(input: {
  academicInterestProfile: AcademicInterestProfile;
  courseTopicProfilesByCourseId: Record<string, CourseTopicProfile>;
  plannedCourseIds: string[];
}): InterestPlanAlignmentResult {
  const { academicInterestProfile, courseTopicProfilesByCourseId, plannedCourseIds } = input;
  const dedupedIds = dedupePreservingOrder(plannedCourseIds);

  const matchedCourseIds: string[] = [];
  const unmatchedCourseIds: string[] = [];
  const courseMatches: InterestPlanCourseMatch[] = [];

  for (const courseId of dedupedIds) {
    const courseTopicProfile = courseTopicProfilesByCourseId[courseId];
    if (!courseTopicProfile) {
      unmatchedCourseIds.push(courseId);
      continue;
    }
    matchedCourseIds.push(courseId);
    const match = matchCourseToAcademicInterests(academicInterestProfile, courseTopicProfile);
    courseMatches.push({
      courseId,
      interestFitScore: match.interestFitScore,
      focusMatchScore: match.focusMatchScore,
      styleMatchScore: match.styleMatchScore,
      avoidPenalty: match.avoidPenalty,
      matchedFocusAreas: match.matchedFocusAreas,
      matchedStyles: match.matchedStyles,
      avoidedAreas: match.avoidedAreas,
    });
  }

  const interestAlignmentScore =
    courseMatches.length > 0
      ? clamp01(courseMatches.reduce((sum, m) => sum + m.interestFitScore, 0) / courseMatches.length)
      : 0;

  const notes: string[] = [];
  if (dedupedIds.length === 0) {
    notes.push('No planned courses — neutral alignment.');
  } else if (courseMatches.length === 0) {
    notes.push('No planned course has a topic profile — neutral alignment.');
  }
  if (unmatchedCourseIds.length > 0) {
    notes.push(
      `${unmatchedCourseIds.length} planned course(s) have no topic profile and were excluded from alignment scoring.`,
    );
  }
  if (!hasMeaningfulAcademicInterests(academicInterestProfile)) {
    notes.push('No user academic interests expressed — neutral alignment.');
  }

  return { interestAlignmentScore, matchedCourseIds, unmatchedCourseIds, courseMatches, notes };
}

export interface InterestAlignmentTiebreakOptions {
  academicInterestProfile: AcademicInterestProfile;
  courseTopicProfilesByCourseId: Record<string, CourseTopicProfile>;
}

/**
 * Opt-in tiebreak layered STRICTLY AFTER the existing, unmodified
 * compareScore(scorePlan(...)) comparison — see file header for the full
 * safety argument. Returns exactly compareScore(scorePlan(a), scorePlan(b))
 * whenever that is nonzero, or whenever `options` is omitted.
 */
export function compareScoreWithOptionalInterestAlignment(
  stateA: PlanState,
  stateB: PlanState,
  model: ConstraintModel,
  options?: InterestAlignmentTiebreakOptions,
): number {
  const primary = compareScore(scorePlan(stateA, model), scorePlan(stateB, model));
  if (primary !== 0 || !options) return primary;

  const alignmentA = scorePlanInterestAlignment({
    academicInterestProfile: options.academicInterestProfile,
    courseTopicProfilesByCourseId: options.courseTopicProfilesByCourseId,
    plannedCourseIds: placedCourseIds(stateA),
  });
  const alignmentB = scorePlanInterestAlignment({
    academicInterestProfile: options.academicInterestProfile,
    courseTopicProfilesByCourseId: options.courseTopicProfilesByCourseId,
    plannedCourseIds: placedCourseIds(stateB),
  });
  return alignmentA.interestAlignmentScore - alignmentB.interestAlignmentScore;
}

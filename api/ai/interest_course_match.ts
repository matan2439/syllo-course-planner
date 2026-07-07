/**
 * Interest-to-Course Matching Helper — a deterministic, pure, explainable
 * bridge between user-side intent (AcademicInterestProfile) and course-side
 * content (CourseTopicProfile). Computes how well a single course's
 * topic/style contributions align with a user's expressed focus/avoid/style
 * interests.
 *
 * FOUNDATION EPIC ONLY. This is NOT Interest Alignment Scoring inside the
 * planner: scorePlan/planner_goals.ts, generated plans, generate-plan.ts, and
 * all runtime behavior are untouched. Nothing here is wired into any
 * production path — a standalone, pure function awaiting a future planner
 * consumer.
 *
 * Trusts its inputs' existing canonical ordering. Both AcademicInterestProfile
 * and CourseTopicProfile are value types this codebase only ever produces via
 * their own normalize/merge/empty helpers, which already guarantee canonical
 * enum order (academic_interest_profile.ts / course_topic_profile.ts). This
 * function therefore does not re-sort; it iterates each profile's own arrays
 * in the order they arrive, mirroring how getTopicWeight/getStyleWeight/
 * hasMeaningfulAcademicInterests already trust that same invariant.
 *
 * Formula (deliberately simple, per the epic's own "do not over-optimize"
 * instruction):
 *   - For each dimension (focus, avoid, style), contribution per entry =
 *     userWeight * courseWeight (both already 0..1, so each contribution is
 *     0..1). The dimension's sub-score is the AVERAGE contribution across the
 *     user's own entries for that dimension (0 when the user expressed
 *     nothing in it) — bounded 0..1 by construction, and simple to explain:
 *     "how much, on average, of what you asked for does this course deliver."
 *   - matchedFocusAreas/matchedStyles/avoidedAreas only list entries where the
 *     COURSE actually contributes (courseWeight > 0) — nothing to explain
 *     otherwise.
 *   - interestFitScore = clamp(avg(expressed dimensions' sub-scores) -
 *     avoidPenalty, 0, 1). A dimension the user never expressed a preference
 *     for is EXCLUDED from that average (neutral), not counted as 0 — an
 *     unexpressed style preference must not silently drag down fit just
 *     because the user has focus-area opinions. Both the (pre-penalty) focus/
 *     style sub-scores and the avoid penalty stay visible in the result even
 *     when they partially cancel out in the final clamped score.
 */

import { getTopicWeight, getStyleWeight } from './course_topic_profile';
import type { CourseTopicProfile } from './course_topic_profile';
import type { AcademicInterestProfile, AcademicFocusArea, CourseStyle } from './academic_interest_profile';

export interface MatchedFocusArea {
  area: AcademicFocusArea;
  userWeight: number;
  courseWeight: number;
  contribution: number;
}

export interface MatchedStyle {
  style: CourseStyle;
  userWeight: number;
  courseWeight: number;
  contribution: number;
}

export interface AvoidedAreaMatch {
  area: AcademicFocusArea;
  userWeight: number;
  courseWeight: number;
  penalty: number;
}

export interface InterestCourseMatchResult {
  courseId: string;
  /** Normalized 0..1 — clamp(avg(expressed dimension sub-scores) - avoidPenalty, 0, 1). */
  interestFitScore: number;
  /** Average userWeight*courseWeight across profile.focusAreas; 0 when focusAreas is empty. */
  focusMatchScore: number;
  /** Average userWeight*courseWeight across profile.courseStylePreferences; 0 when empty. */
  styleMatchScore: number;
  /** Average userWeight*courseWeight across profile.avoidAreas; 0 when empty. */
  avoidPenalty: number;
  matchedFocusAreas: MatchedFocusArea[];
  matchedStyles: MatchedStyle[];
  avoidedAreas: AvoidedAreaMatch[];
  notes: string[];
}

function averageContribution<T>(
  userEntries: ReadonlyArray<T>,
  userWeightOf: (entry: T) => number,
  courseWeightOf: (entry: T) => number,
): number {
  if (userEntries.length === 0) return 0;
  const total = userEntries.reduce((sum, entry) => sum + userWeightOf(entry) * courseWeightOf(entry), 0);
  return total / userEntries.length;
}

function clamp01(value: number): number {
  if (value < 0) return 0;
  if (value > 1) return 1;
  return value;
}

export function matchCourseToAcademicInterests(
  profile: AcademicInterestProfile,
  courseTopicProfile: CourseTopicProfile,
): InterestCourseMatchResult {
  const focusMatchScore = averageContribution(
    profile.focusAreas,
    (f) => f.weight,
    (f) => getTopicWeight(courseTopicProfile, f.area),
  );
  const matchedFocusAreas: MatchedFocusArea[] = profile.focusAreas
    .map((f) => {
      const courseWeight = getTopicWeight(courseTopicProfile, f.area);
      return { area: f.area, userWeight: f.weight, courseWeight, contribution: f.weight * courseWeight };
    })
    .filter((m) => m.courseWeight > 0);

  const styleMatchScore = averageContribution(
    profile.courseStylePreferences,
    (s) => s.weight,
    (s) => getStyleWeight(courseTopicProfile, s.style),
  );
  const matchedStyles: MatchedStyle[] = profile.courseStylePreferences
    .map((s) => {
      const courseWeight = getStyleWeight(courseTopicProfile, s.style);
      return { style: s.style, userWeight: s.weight, courseWeight, contribution: s.weight * courseWeight };
    })
    .filter((m) => m.courseWeight > 0);

  const avoidPenalty = averageContribution(
    profile.avoidAreas,
    (a) => a.weight,
    (a) => getTopicWeight(courseTopicProfile, a.area),
  );
  const avoidedAreas: AvoidedAreaMatch[] = profile.avoidAreas
    .map((a) => {
      const courseWeight = getTopicWeight(courseTopicProfile, a.area);
      return { area: a.area, userWeight: a.weight, courseWeight, penalty: a.weight * courseWeight };
    })
    .filter((m) => m.courseWeight > 0);

  const expressedDimensionScores: number[] = [];
  if (profile.focusAreas.length > 0) expressedDimensionScores.push(focusMatchScore);
  if (profile.courseStylePreferences.length > 0) expressedDimensionScores.push(styleMatchScore);
  const baseScore =
    expressedDimensionScores.length > 0
      ? expressedDimensionScores.reduce((sum, s) => sum + s, 0) / expressedDimensionScores.length
      : 0;
  const interestFitScore = clamp01(baseScore - avoidPenalty);

  const notes: string[] = [];
  const noUserSignal =
    profile.focusAreas.length === 0 &&
    profile.avoidAreas.length === 0 &&
    profile.courseStylePreferences.length === 0;
  if (noUserSignal) {
    notes.push('No user academic interests expressed (focus/avoid/style) — neutral fit.');
  }
  const noCourseSignal = courseTopicProfile.topics.length === 0 && courseTopicProfile.styles.length === 0;
  if (noCourseSignal) {
    notes.push('Course has no topic or style data — neutral fit.');
  }
  if (avoidedAreas.length > 0) {
    notes.push(`Reduced by ${avoidedAreas.length} avoided area(s) the course also covers.`);
  }

  return {
    courseId: courseTopicProfile.courseId,
    interestFitScore,
    focusMatchScore,
    styleMatchScore,
    avoidPenalty,
    matchedFocusAreas,
    matchedStyles,
    avoidedAreas,
    notes,
  };
}

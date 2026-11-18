/**
 * generate-plan interest-evaluation helper — the pure, additive bridge that
 * turns a generated PlanProposal's semesters + an (opt-in) request-supplied
 * AcademicInterestProfile into an AcademicInterestEvaluationResult.
 *
 * It changes nothing about how the plan is generated: it reads the already-
 * produced proposal semesters, resolves topic profiles for the planned courses
 * via the full-catalog static resolver, and delegates to the existing,
 * unmodified evaluateAcademicInterestFit. No LLM, no Supabase, no plan mutation,
 * no ranking involvement.
 *
 * The resolver is the Mechanical Engineering 2027 full-catalog seed — the only
 * catalog that currently exists. For any other program, planned courses simply
 * resolve as unmatched (honest, no crash, no fabrication) — exactly the
 * "missing topic profile" behavior. When a real second catalog is seeded, this
 * is the single place that would take a program-keyed resolver.
 */

import { normalizeAcademicInterestProfile } from './academic_interest_profile';
import type { RawAcademicInterestProfile } from './academic_interest_profile';
import { evaluateAcademicInterestFit } from './academic_interest_evaluation';
import type { AcademicInterestEvaluationResult } from './academic_interest_evaluation';
import { createMechanicalEngineering2027Resolver } from './course_topic_profiles_static';
import type { TopicId } from './course_topics';
import { areasForTopicIds } from './focus_topic_objective';

export interface ProposalSemester {
  semester_id: string;
  course_ids: string[];
}

/** Flatten proposal semesters into the planned course-id list, order preserved, never reordered. */
export function extractPlannedCourseIds(semesters: ProposalSemester[]): string[] {
  const out: string[] = [];
  for (const sem of semesters ?? []) {
    for (const id of sem?.course_ids ?? []) {
      if (typeof id === 'string') out.push(id);
    }
  }
  return out;
}

/**
 * Build a per-course soft fit score from the static topic profiles, grounded in
 * the confirmed topicIds (from a `prefer_topic_alignment` objective). Scores each
 * catalog course by summing the weights of matching AcademicFocusArea entries in
 * its CourseTopicProfile. Returns undefined when topicIds is empty, no courses
 * are on the board, or none score above zero — the planner is byte-identical
 * to the no-fit case in all such scenarios.
 */
export function buildCourseFitByIdFromTopicProfiles(
  board: unknown,
  topicIds: ReadonlyArray<TopicId>,
): Map<string, number> | undefined {
  if (!topicIds.length) return undefined;

  const requestedAreas = areasForTopicIds(topicIds);
  if (!requestedAreas.size) return undefined;

  const boardAny = board as Record<string, unknown> | null | undefined;
  const courseIds: string[] = [];
  const seen = new Set<string>();
  const addId = (c: unknown) => {
    const id = (c as Record<string, unknown> | null | undefined)?.course_id;
    if (typeof id === 'string' && id && !seen.has(id)) { seen.add(id); courseIds.push(id); }
  };
  for (const s of (boardAny?.semesters as unknown[]) ?? []) {
    for (const c of (s as Record<string, unknown> | null | undefined)?.courses as unknown[] ?? []) addId(c);
  }
  for (const c of ((boardAny?.metadata as Record<string, unknown> | null | undefined)?.program_repository_courses as unknown[]) ?? []) addId(c);

  if (!courseIds.length) return undefined;

  const resolver = createMechanicalEngineering2027Resolver();
  const { profilesByCourseId } = resolver.resolveCourseTopicProfiles(courseIds);

  const fitById = new Map<string, number>();
  for (const [courseId, profile] of Object.entries(profilesByCourseId)) {
    let score = 0;
    for (const tw of profile.topics) {
      if (requestedAreas.has(tw.area)) score += tw.weight;
    }
    if (score > 0) fitById.set(courseId, score);
  }
  return fitById.size ? fitById : undefined;
}

/**
 * Build the additive interest evaluation for a generated plan. `rawProfile` is
 * the untrusted request-supplied profile — normalized through the existing
 * total/safe helper (unknown areas dropped, weights clamped), so a missing or
 * garbage profile deterministically yields hasMeaningfulAcademicInterests=false.
 */
export function buildGeneratePlanInterestEvaluation(
  semesters: ProposalSemester[],
  rawProfile: unknown,
): AcademicInterestEvaluationResult {
  const academicInterestProfile = normalizeAcademicInterestProfile(
    (rawProfile ?? {}) as RawAcademicInterestProfile,
  );
  const plannedCourseIds = extractPlannedCourseIds(semesters);
  const resolver = createMechanicalEngineering2027Resolver();
  const { profilesByCourseId } = resolver.resolveCourseTopicProfiles(plannedCourseIds);

  return evaluateAcademicInterestFit({
    academicInterestProfile,
    courseTopicProfilesByCourseId: profilesByCourseId,
    plannedCourseIds,
  });
}

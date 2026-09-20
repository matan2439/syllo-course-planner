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

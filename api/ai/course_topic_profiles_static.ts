/**
 * Full-catalog static Course Topic Profile seed for TAU Mechanical Engineering
 * 2027 — the concrete supply-side data source that gives every catalog course
 * a CourseTopicProfile.
 *
 * It is "static" in the sense that matters: fully deterministic and derived
 * only from committed inputs. The map is BUILT by running the deterministic
 * inference rules (course_topic_profile_inference.ts) over the committed
 * catalog (course_catalog.ts) — so the rules are the single, reviewable source
 * of truth, and hand-maintaining 68 literal entries (which would just be those
 * rules applied by hand, and would drift) is avoided. Same catalog + same
 * rules => byte-identical map every run.
 *
 * The build is memoized at module scope so the catalog file is read at most
 * once per process. Coverage over the catalog is 100% by construction (every
 * catalog id gets a profile); the coverage audit still exists as an
 * independent, honest check rather than an assumption.
 *
 * No profile here uses source 'manual' or 'syllabus': there are no per-course
 * hand overrides this epic, and syllabus text is deliberately not mined (it is
 * noisy). Those two sources are reserved for future, explicitly-reviewed work.
 *
 * Not wired into generate-plan, PlannerWorker, planner-run, DecisionCapability,
 * or any UI. No LLM, no Supabase.
 */

import { loadMechanicalEngineering2027Catalog } from './course_catalog';
import { inferCourseTopicProfile } from './course_topic_profile_inference';
import { createStaticCourseTopicProfileResolver } from './course_topic_profile_resolver';
import type { CourseTopicProfileResolver } from './course_topic_profile_resolver';
import type { CourseTopicProfile, CourseTopicProfileSource } from './course_topic_profile';

let cachedProfiles: Record<string, CourseTopicProfile> | null = null;

/**
 * The full-catalog courseId->CourseTopicProfile map (memoized). Built once by
 * inferring a profile for every course in the committed catalog.
 */
export function getMechanicalEngineering2027TopicProfiles(): Record<string, CourseTopicProfile> {
  if (cachedProfiles) return cachedProfiles;
  const map: Record<string, CourseTopicProfile> = {};
  for (const course of loadMechanicalEngineering2027Catalog()) {
    map[course.courseId] = inferCourseTopicProfile(course);
  }
  cachedProfiles = map;
  return map;
}

/** A resolver backed by the full-catalog static seed. */
export function createMechanicalEngineering2027Resolver(): CourseTopicProfileResolver {
  return createStaticCourseTopicProfileResolver(getMechanicalEngineering2027TopicProfiles());
}

export interface CourseTopicProfileSourceSummary {
  manual: number;
  syllabus: number;
  inferred: number;
  default: number;
}

/** Count profiles by their `source`, defaulting a missing source to 'default'. */
export function summarizeCourseTopicProfileSources(
  profilesByCourseId: Record<string, CourseTopicProfile>,
): CourseTopicProfileSourceSummary {
  const summary: CourseTopicProfileSourceSummary = { manual: 0, syllabus: 0, inferred: 0, default: 0 };
  for (const profile of Object.values(profilesByCourseId)) {
    const source: CourseTopicProfileSource = profile.source ?? 'default';
    summary[source] += 1;
  }
  return summary;
}

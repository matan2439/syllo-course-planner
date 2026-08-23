/**
 * Adapter between the existing academic-focus intent vocabulary and the
 * evidence-backed syllabus-topic vocabulary.
 *
 * This is an ontology mapping only: it never reads a course title, course id,
 * category or free-form syllabus prose. Unsupported/broader focus areas stay
 * inert instead of being coerced into the nearest topic.
 */
import type { AcademicFocusArea } from './academic_interest_profile';
import type { TopicId } from './course_topics';
import type { GroundedObjectiveResult, ResolvedObjective } from './grounded_preference';

const FOCUS_TO_TOPIC: Partial<Record<AcademicFocusArea, TopicId>> = {
  strength_analysis: 'solid_mechanics',
  finite_elements: 'finite_element_analysis',
  mechanical_design: 'engineering_design',
  heat_transfer: 'thermofluids',
  thermal_systems: 'thermofluids',
  fluids: 'thermofluids',
  control_systems: 'control',
  manufacturing: 'manufacturing',
  materials: 'materials',
  robotics: 'robotics',
};

export function groundedTopicsForFocusAreas(
  focusAreas: ReadonlyArray<{ area: AcademicFocusArea; weight?: number }>,
): TopicId[] {
  return [...new Set(
    focusAreas
      .filter((f) => f.weight === undefined || f.weight > 0)
      .map((f) => FOCUS_TO_TOPIC[f.area])
      .filter((t): t is TopicId => t !== undefined),
  )].sort();
}

/**
 * Add an explicitly interpreted "focus on …" request to the same composed
 * grounded objective set used by typed conversation preferences.
 *
 * Typed preference provenance remains authoritative when a topic objective is
 * already present; the explicit request only unions its supported topic ids.
 */
export function mergeExplicitFocusObjective(
  base: GroundedObjectiveResult | undefined,
  focusAreas: ReadonlyArray<{ area: AcademicFocusArea; weight?: number }>,
  profileVersion: number,
  source: 'explicit_free_text' | 'structured_academic_profile' = 'explicit_free_text',
): GroundedObjectiveResult | undefined {
  const topics = groundedTopicsForFocusAreas(focusAreas);
  if (!topics.length) return base;

  const existing = base?.objectives.find((o) => o.id === 'prefer_topic_alignment');
  const topicObjective: ResolvedObjective = existing
    ? { ...existing, topicIds: [...new Set([...(existing.topicIds ?? []), ...topics])].sort() }
    : {
        id: 'prefer_topic_alignment',
        preferenceId: `${source}:${topics.join('+')}`,
        kind: 'topic',
        target: 'course_topic_interest',
        topicIds: topics,
        source,
        profileVersion,
      };

  const objectives = [
    ...(base?.objectives.filter((o) => o.id !== 'prefer_topic_alignment') ?? []),
    topicObjective,
  ].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  const first = objectives[0];

  return {
    ...(base ?? { objectives: [] }),
    objectives,
    objective: first.id,
    provenance: {
      preferenceId: first.preferenceId,
      feature: first.kind === 'topic' ? 'course_topic_interest' : first.target as 'practical_laboratory' | 'project_based',
      source: first.source,
      profileVersion: first.profileVersion,
    },
    ...(first.kind === 'topic' && first.topicIds?.length ? { topicIds: first.topicIds } : { topicIds: undefined }),
  };
}

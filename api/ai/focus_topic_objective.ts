/**
 * Adapter between the existing academic-focus intent vocabulary and the
 * evidence-backed syllabus-topic vocabulary.
 *
 * This is an ontology mapping only: it never reads a course title, course id,
 * category or free-form syllabus prose. Unsupported/broader focus areas stay
 * inert instead of being coerced into the nearest topic.
 */
import type { AcademicFocusArea, CourseStyle } from './academic_interest_profile';
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
  energy: 'energy_systems',
  robotics: 'robotics',
};

/** Focus choices that have a real evidence-backed planning consumer today. */
export const GROUNDED_FOCUS_AREAS = Object.freeze([
  'strength_analysis',
  'finite_elements',
  'mechanical_design',
  'heat_transfer',
  'thermal_systems',
  'fluids',
  'control_systems',
  'manufacturing',
  'materials',
  'energy',
  'robotics',
] satisfies AcademicFocusArea[]);

const STYLE_TO_OBJECTIVE: Partial<Record<CourseStyle, {
  id: 'prefer_project_courses' | 'prefer_laboratory_courses';
  target: 'project_based' | 'practical_laboratory';
}>> = {
  project_based: { id: 'prefer_project_courses', target: 'project_based' },
  lab_based: { id: 'prefer_laboratory_courses', target: 'practical_laboratory' },
};

/** Style choices that reach an existing grounded objective today. */
export const GROUNDED_COURSE_STYLES = Object.freeze([
  'project_based',
  'lab_based',
] satisfies CourseStyle[]);

function finalize(
  base: GroundedObjectiveResult | undefined,
  objectives: ResolvedObjective[],
): GroundedObjectiveResult | undefined {
  if (!objectives.length && !base?.excluded?.length) return undefined;
  const sorted = [...objectives].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  const first = sorted[0];
  if (!first) {
    if (!base) return undefined;
    const {
      objective: _objective,
      provenance: _provenance,
      topicIds: _topicIds,
      primaryObjectiveId: _primaryObjectiveId,
      prioritySource: _prioritySource,
      priorityChoice: _priorityChoice,
      ...rest
    } = base;
    return { ...rest, objectives: [] };
  }
  return {
    ...(base ?? { objectives: [] }),
    objectives: sorted,
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

  return finalize(base, [
    ...(base?.objectives.filter((o) => o.id !== 'prefer_topic_alignment') ?? []),
    topicObjective,
  ]);
}

/**
 * Add structured topic avoidance as a SOFT minimization objective. A topic
 * simultaneously requested and avoided is removed from BOTH objectives and
 * disclosed as conflicting; no array/source order gets to resolve it.
 */
export function mergeStructuredAvoidObjective(
  base: GroundedObjectiveResult | undefined,
  avoidAreas: ReadonlyArray<{ area: AcademicFocusArea; weight?: number }>,
  profileVersion: number,
): GroundedObjectiveResult | undefined {
  const requestedAvoid = groundedTopicsForFocusAreas(avoidAreas);
  if (!requestedAvoid.length) return base;

  const positive = base?.objectives.find((o) => o.id === 'prefer_topic_alignment');
  const positiveTopics = new Set(positive?.topicIds ?? []);
  const conflicts = requestedAvoid.filter((t) => positiveTopics.has(t));
  const conflictSet = new Set(conflicts);
  const avoidTopics = requestedAvoid.filter((t) => !conflictSet.has(t));
  const keptPositiveTopics = [...positiveTopics].filter((t) => !conflictSet.has(t)).sort();

  const objectives = (base?.objectives ?? [])
    .filter((o) => o.id !== 'prefer_topic_alignment' && o.id !== 'avoid_topic_exposure');
  if (positive && keptPositiveTopics.length) objectives.push({ ...positive, topicIds: keptPositiveTopics });
  if (avoidTopics.length) {
    objectives.push({
      id: 'avoid_topic_exposure',
      preferenceId: `structured_academic_profile:avoid:${avoidTopics.join('+')}`,
      kind: 'topic',
      target: 'course_topic_avoidance',
      topicIds: avoidTopics,
      source: 'structured_academic_profile',
      profileVersion,
    });
  }

  const withConflict = conflicts.length
    ? {
        ...(base ?? { objectives: [] }),
        excluded: [
          ...(base?.excluded ?? []),
          ...conflicts.map((topic) => ({
            id: `conflicting_topic:${topic}`,
            value: topic,
            reason: 'conflicting_grounded_topic' as const,
          })),
        ],
      }
    : base;
  return finalize(withConflict, objectives);
}

/** Map only course styles backed by the official schema-complete delivery field. */
export function mergeStructuredStyleObjectives(
  base: GroundedObjectiveResult | undefined,
  styles: ReadonlyArray<{ style: CourseStyle; weight?: number }>,
  profileVersion: number,
): GroundedObjectiveResult | undefined {
  const supported = [...new Set(
    styles
      .filter((s) => s.weight === undefined || s.weight > 0)
      .map((s) => STYLE_TO_OBJECTIVE[s.style])
      .filter((x): x is NonNullable<typeof x> => x !== undefined)
      .map((x) => `${x.id}|${x.target}`),
  )]
    .map((encoded) => {
      const [id, target] = encoded.split('|') as [
        'prefer_project_courses' | 'prefer_laboratory_courses',
        'project_based' | 'practical_laboratory',
      ];
      return { id, target };
    })
    .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  if (!supported.length) return base;

  const objectives = [...(base?.objectives ?? [])];
  for (const style of supported) {
    if (objectives.some((o) => o.id === style.id)) continue; // typed provenance wins
    objectives.push({
      id: style.id,
      preferenceId: `structured_academic_profile:style:${style.target}`,
      kind: 'delivery',
      target: style.target,
      source: 'structured_academic_profile',
      profileVersion,
    });
  }
  return finalize(base, objectives);
}

/**
 * K9A — the typed GROUNDED COURSE-FEATURE preference, and the SINGLE boundary
 * that maps it to a planner objective.
 *
 * Mirrors `distribution_policy.ts` exactly: one `resolve…(effective)` function
 * sitting on the eligibility boundary, so the conversation, the handler and the
 * planner can never reinterpret the same preference differently. Everything
 * upstream of here speaks about a course FEATURE the student can recognise
 * ('practical_laboratory'); the planner's internal objective id
 * ('prefer_laboratory_courses') appears only on the far side of this mapping and
 * is never a valid input value.
 *
 * Semantics (deliberately conservative, and identical to the distribution
 * policy's):
 *   - confirmed + active + supported feature → the grounded objective;
 *   - indifferent → excluded by `effectivePlannerPreferences`, so no bias — but
 *     still PRESENT in the profile, which is what stops the topic being re-asked;
 *   - uncertain / unconfirmed / rejected → excluded, never influences ranking;
 *   - absent → no objective, no bias;
 *   - supported-but-unrecognised value → a typed `excluded` entry with a stable
 *     reason, never a guess at what the user meant;
 *   - and there is NO output on this path that can change academic legality. A
 *     course-feature preference is a soft ranking signal by construction: even a
 *     `hard_constraint` classification yields only the same soft objective.
 */
import type { EffectivePlannerPreferences } from './preference_eligibility';
import type { GroundedObjectiveId } from './grounded_objectives';
import { TOPIC_IDS, type TopicId } from './course_topics';

/** The preference category the conversation uses for a course-feature question. */
export const GROUNDED_FEATURE_CATEGORY = 'course_feature';
/** The planner knob a course-feature preference influences. */
export const GROUNDED_FEATURE_AFFECTS = 'grounded_course_feature';

/** T4 — the preference category for a course CONTENT/TOPIC interest. */
export const GROUNDED_TOPIC_CATEGORY = 'course_topic_interest';
/** The planner knob a topic-interest preference influences. */
export const GROUNDED_TOPIC_AFFECTS = 'grounded_topic_interest';

/**
 * Feature targets this build can actually ground in official evidence. A value
 * outside this list is reported as unsupported rather than approximated — the
 * same discipline the extractor applies to an unmapped topic.
 *
 * Generic on purpose: adding `no_final_exam` or `project_based` here is a
 * one-line change once each has its OWN end-to-end ranking proof (see the
 * ledger's K8). Shipping an objective without that proof is forbidden.
 */
export const SUPPORTED_GROUNDED_FEATURES = ['practical_laboratory', 'project_based'] as const;
export type SupportedGroundedFeature = (typeof SUPPORTED_GROUNDED_FEATURES)[number];

/** Feature target → planner objective. The only place this translation exists. */
const FEATURE_TO_OBJECTIVE: Record<SupportedGroundedFeature, GroundedObjectiveId> = {
  practical_laboratory: 'prefer_laboratory_courses',
  // K8 — added only after the K8A audit measured its official coverage at 8/8
  // and proved an end-to-end selection change. No objective ships without that.
  project_based: 'prefer_project_courses',
};

export interface GroundedObjectiveExclusion {
  id: string;
  value: string;
  /** Stable machine-readable reason. */
  reason: 'unsupported_grounded_feature' | 'unsupported_grounded_topic';
}

export interface GroundedObjectiveResult {
  /** Present only when a confirmed active preference names a supported feature. */
  objective?: GroundedObjectiveId;
  /** Present alongside `objective` — explanatory provenance, never a legality input. */
  provenance?: {
    preferenceId: string;
    /** The user-facing feature target, for explanation text. */
    feature: SupportedGroundedFeature | 'course_topic_interest';
    source: string;
    profileVersion: number;
  };
  /**
   * T4 — the confirmed topics, present only with `prefer_topic_alignment`.
   * Deduplicated and sorted, so the objective is identical for the same answers
   * regardless of the order they were given in.
   */
  topicIds?: TopicId[];
  /** Eligible preferences naming a feature this build cannot ground. Never silently dropped. */
  excluded?: GroundedObjectiveExclusion[];
}

function isSupported(value: string): value is SupportedGroundedFeature {
  return (SUPPORTED_GROUNDED_FEATURES as readonly string[]).includes(value);
}

function isSupportedTopic(value: string): value is TopicId {
  return (TOPIC_IDS as readonly string[]).includes(value);
}

/**
 * Resolve the grounded objective from the ALREADY-FILTERED effective
 * preferences. Only `hard`/`soft` reach here — `effectivePlannerPreferences` has
 * already removed indifferent, uncertain and unconfirmed entries with their own
 * deterministic reasons, so this function cannot accidentally revive one.
 */
export function resolveGroundedObjective(effective: EffectivePlannerPreferences): GroundedObjectiveResult {
  const active = [...effective.hard, ...effective.soft];
  const prefs = active.filter(
    (p) => p.affects === GROUNDED_FEATURE_AFFECTS || p.category === GROUNDED_FEATURE_CATEGORY,
  );
  const topicPrefs = active.filter(
    (p) => p.affects === GROUNDED_TOPIC_AFFECTS || p.category === GROUNDED_TOPIC_CATEGORY,
  );
  if (!prefs.length) return resolveTopicInterest(topicPrefs, effective);

  const excluded: GroundedObjectiveExclusion[] = [];
  for (const p of prefs) {
    const value = String(p.normalized);
    if (isSupported(value)) {
      return {
        objective: FEATURE_TO_OBJECTIVE[value],
        provenance: {
          preferenceId: p.id,
          feature: value,
          source: p.source,
          profileVersion: effective.profileVersion,
        },
        ...(excluded.length ? { excluded } : {}),
      };
    }
    excluded.push({ id: p.id, value, reason: 'unsupported_grounded_feature' });
  }
  // No delivery feature could be grounded — fall through to topic interest, so
  // an unsupported feature answer does not silently suppress a supported topic.
  const topic = resolveTopicInterest(topicPrefs, effective);
  return { ...topic, excluded: [...excluded, ...(topic.excluded ?? [])] };
}

/**
 * T4 — resolve confirmed topic interests into the topic-alignment objective.
 *
 * Deliberately reached only when no DELIVERY-feature objective resolved. The
 * two are not combined: delivery mode rests on a schema-complete enumerated
 * field where `false` is a real finding, while a topic is only ever affirmed or
 * unknown. Ranking them together would silently mix two different evidential
 * strengths, so the precedence is fixed, documented and tested rather than
 * emergent.
 *
 * Nothing here is specific to any particular topic: every id the mapper can
 * ground is accepted, and an id it cannot is reported rather than approximated.
 */
function resolveTopicInterest(
  topicPrefs: EffectivePlannerPreferences['soft'],
  effective: EffectivePlannerPreferences,
): GroundedObjectiveResult {
  if (!topicPrefs.length) return {};
  const excluded: GroundedObjectiveExclusion[] = [];
  const topicIds: TopicId[] = [];
  let provenanceOf: (typeof topicPrefs)[number] | undefined;

  for (const p of topicPrefs) {
    const value = String(p.normalized);
    if (isSupportedTopic(value)) {
      if (!topicIds.includes(value)) topicIds.push(value);
      provenanceOf ??= p;
      continue;
    }
    excluded.push({ id: p.id, value, reason: 'unsupported_grounded_topic' });
  }

  if (!topicIds.length) return { ...(excluded.length ? { excluded } : {}) };
  return {
    objective: 'prefer_topic_alignment',
    topicIds: topicIds.sort(),
    provenance: {
      preferenceId: provenanceOf!.id,
      feature: 'course_topic_interest',
      source: provenanceOf!.source,
      profileVersion: effective.profileVersion,
    },
    ...(excluded.length ? { excluded } : {}),
  };
}

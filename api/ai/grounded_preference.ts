/**
 * K9A/M1 — the typed GROUNDED preference boundary.
 *
 * M1 replaced the single-objective resolver with a composable OBJECTIVE SET.
 * The old behaviour returned exactly one objective chosen by a fixed precedence
 * (delivery beat topic; array order broke ties inside delivery), so a confirmed
 * lower-precedence preference was silently discarded — see
 * `grounded_objective_set.ts` for the replacement and its rationale.
 *
 * This module is now a thin compatibility surface over that set. It keeps the
 * legacy single-objective fields populated from the FIRST objective in the
 * deterministic (id-sorted) order, so every existing single-objective caller
 * and test observes byte-identical behaviour, while `objectives` carries the
 * complete truth for callers that can compose.
 *
 * Semantics are unchanged and still conservative: only confirmed, active,
 * supported preferences produce an objective; indifferent / uncertain /
 * unconfirmed entries were already removed by `effectivePlannerPreferences`;
 * an unrecognised value is reported as `excluded`, never guessed at; and
 * nothing on this path can change academic legality.
 */
import type { EffectivePlannerPreferences } from './preference_eligibility';
import type { GroundedObjectiveId } from './grounded_objectives';
import type { TopicId } from './course_topics';
import {
  resolveGroundedObjectiveSet,
  GROUNDED_FEATURE_CATEGORY,
  GROUNDED_FEATURE_AFFECTS,
  GROUNDED_TOPIC_CATEGORY,
  GROUNDED_TOPIC_AFFECTS,
  SUPPORTED_GROUNDED_FEATURES,
  type SupportedGroundedFeature,
  type GroundedObjectiveExclusion,
  type ResolvedObjective,
  type ResolvedGroundedObjectiveSet,
} from './grounded_objective_set';

export {
  GROUNDED_FEATURE_CATEGORY,
  GROUNDED_FEATURE_AFFECTS,
  GROUNDED_TOPIC_CATEGORY,
  GROUNDED_TOPIC_AFFECTS,
  SUPPORTED_GROUNDED_FEATURES,
};
export type { SupportedGroundedFeature, GroundedObjectiveExclusion, ResolvedObjective, ResolvedGroundedObjectiveSet };

export interface GroundedObjectiveResult {
  /**
   * EVERY eligible confirmed objective. This is the authoritative field; the
   * single-objective fields below are a compatibility view over it.
   */
  objectives: ResolvedObjective[];
  /** Legacy single-objective view — `objectives[0]`, in deterministic id order. */
  objective?: GroundedObjectiveId;
  provenance?: {
    preferenceId: string;
    feature: SupportedGroundedFeature | 'course_topic_interest';
    source: string;
    profileVersion: number;
  };
  /** Confirmed topics, present when a topic objective is the legacy view. */
  topicIds?: TopicId[];
  /** Eligible preferences naming a target this build cannot ground. */
  excluded?: GroundedObjectiveExclusion[];
  /** Present when the student genuinely supplied relative importance. */
  prioritySource?: 'explicit_preference';
}

/**
 * Resolve grounded objectives from ALREADY-FILTERED effective preferences.
 *
 * Returns the full set. The legacy fields describe `objectives[0]` so callers
 * that have not yet been taught to compose keep working unchanged — but they no
 * longer cause a second confirmed preference to be dropped, because the set is
 * always present.
 */
export function resolveGroundedObjective(effective: EffectivePlannerPreferences): GroundedObjectiveResult {
  const set = resolveGroundedObjectiveSet(effective);
  const first = set.objectives[0];
  return {
    objectives: set.objectives,
    ...(first
      ? {
          objective: first.id,
          provenance: {
            preferenceId: first.preferenceId,
            feature: (first.kind === 'topic' ? 'course_topic_interest' : first.target) as
              SupportedGroundedFeature | 'course_topic_interest',
            source: first.source,
            profileVersion: first.profileVersion,
          },
          ...(first.topicIds?.length ? { topicIds: first.topicIds } : {}),
        }
      : {}),
    ...(set.excluded.length ? { excluded: set.excluded } : {}),
    ...(set.prioritySource ? { prioritySource: set.prioritySource } : {}),
  };
}

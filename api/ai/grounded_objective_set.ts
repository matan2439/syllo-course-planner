/**
 * M1–M4 — COMPOSABLE multi-objective grounded ranking.
 *
 * The defect this replaces: `resolveGroundedObjective` returned ONE objective,
 * chosen by a fixed precedence (delivery beats topic, then array order within
 * delivery). A student who confirmed both "I prefer project courses" and "I'm
 * interested in robotics" had the robotics answer silently discarded — not even
 * reported as excluded — and could be handed a plan that satisfied only one of
 * two preferences when a plan satisfying both existed.
 *
 * The architecture here has NO objective precedence anywhere:
 *
 *   1. RESOLUTION  — every eligible confirmed preference becomes an objective.
 *   2. SCORING     — each objective scores every candidate independently, and
 *                    each score is normalized to a bounded, comparable [0,1].
 *   3. DOMINANCE   — Pareto dominance is evaluated on the full vector BEFORE
 *                    anything is aggregated.
 *   4. COMPOSITION — a documented equal-importance policy over the normalized
 *                    vector, with canonical identity as the final tie-break.
 *
 * Objective ORDER is presentation only. Nothing in ranking reads it: the
 * composed utility is a mean, which is symmetric, and dominance is a
 * conjunction. Both are provably order-invariant, and that is tested.
 *
 * Equal importance is a transparent DEFAULT ranking policy — it is not a claim
 * that the student said their preferences matter equally. When a genuine
 * trade-off exists, that fact is retained and reported rather than hidden
 * behind a precedence rule.
 */
import type { EffectivePlannerPreferences } from './preference_eligibility';
import type { GroundedObjectiveId, FeatureIndex, TopicIndex, ObjectiveContribution } from './grounded_objectives';
import { scoreCandidateOnObjective } from './grounded_objectives';
import { TOPIC_IDS, type TopicId } from './course_topics';

/** Category/affects markers for the delivery-feature preference. */
export const GROUNDED_FEATURE_CATEGORY = 'course_feature';
export const GROUNDED_FEATURE_AFFECTS = 'grounded_course_feature';
/** Category/affects markers for the content/topic-interest preference. */
export const GROUNDED_TOPIC_CATEGORY = 'course_topic_interest';
export const GROUNDED_TOPIC_AFFECTS = 'grounded_topic_interest';

export const SUPPORTED_GROUNDED_FEATURES = ['practical_laboratory', 'project_based'] as const;
export type SupportedGroundedFeature = (typeof SUPPORTED_GROUNDED_FEATURES)[number];

/** Feature target → planner objective. The only place this translation exists. */
const FEATURE_TO_OBJECTIVE: Record<SupportedGroundedFeature, GroundedObjectiveId> = {
  practical_laboratory: 'prefer_laboratory_courses',
  project_based: 'prefer_project_courses',
};

export interface GroundedObjectiveExclusion {
  id: string;
  value: string;
  reason: 'unsupported_grounded_feature' | 'unsupported_grounded_topic';
}

/** One confirmed preference, resolved into an independently rankable objective. */
export interface ResolvedObjective {
  /** Stable planner objective id. */
  id: GroundedObjectiveId;
  /** The preference that produced it — provenance, never importance. */
  preferenceId: string;
  kind: 'delivery' | 'topic';
  /** The normalized user-facing target this objective came from. */
  target: string;
  /** Topic objectives only: every confirmed topic, deduplicated and sorted. */
  topicIds?: TopicId[];
  source: string;
  profileVersion: number;
  /**
   * Explicit relative importance, ONLY when the student genuinely supplied it.
   * Never inferred from array order, question order, enum order or taxonomy
   * order. Absent ⇒ the equal-importance default applies.
   */
  priority?: number;
}

export interface ResolvedGroundedObjectiveSet {
  /**
   * Every eligible confirmed objective. Sorted by objective id purely so the
   * value is deterministic — ranking never reads this order.
   */
  objectives: ResolvedObjective[];
  excluded: GroundedObjectiveExclusion[];
  profileVersion: number;
  /** Where relative priority came from, when any was supplied. */
  prioritySource?: 'explicit_preference';
}

function isSupportedFeature(value: string): value is SupportedGroundedFeature {
  return (SUPPORTED_GROUNDED_FEATURES as readonly string[]).includes(value);
}
function isSupportedTopic(value: string): value is TopicId {
  return (TOPIC_IDS as readonly string[]).includes(value);
}

/**
 * Resolve EVERY eligible confirmed preference into an objective.
 *
 * `effectivePlannerPreferences` has already removed indifferent, uncertain and
 * unconfirmed entries, so nothing here can revive one. Each preference is
 * judged on its own: an unsupported delivery value can no longer suppress a
 * supported topic, and vice versa.
 */
export function resolveGroundedObjectiveSet(
  effective: EffectivePlannerPreferences,
): ResolvedGroundedObjectiveSet {
  const active = [...effective.hard, ...effective.soft];
  const excluded: GroundedObjectiveExclusion[] = [];
  const byObjectiveId = new Map<GroundedObjectiveId, ResolvedObjective>();
  const topicIds: TopicId[] = [];
  let topicPreference: (typeof active)[number] | undefined;
  let prioritySource: 'explicit_preference' | undefined;

  const explicitPriority = (p: (typeof active)[number]): number | undefined => {
    const raw = (p as unknown as { priority?: unknown }).priority;
    if (typeof raw !== 'number' || !Number.isFinite(raw)) return undefined;
    prioritySource = 'explicit_preference';
    return raw;
  };

  for (const p of active) {
    const value = String(p.normalized);
    const isDelivery = p.affects === GROUNDED_FEATURE_AFFECTS || p.category === GROUNDED_FEATURE_CATEGORY;
    const isTopic = p.affects === GROUNDED_TOPIC_AFFECTS || p.category === GROUNDED_TOPIC_CATEGORY;

    if (isDelivery) {
      if (!isSupportedFeature(value)) {
        excluded.push({ id: p.id, value, reason: 'unsupported_grounded_feature' });
        continue;
      }
      const id = FEATURE_TO_OBJECTIVE[value];
      // Two preferences naming the SAME objective are one objective. The
      // surviving provenance is chosen by sorted preference id, never by array
      // position, so the result cannot depend on answer order.
      const existing = byObjectiveId.get(id);
      const priority = explicitPriority(p);
      if (!existing || p.id < existing.preferenceId) {
        byObjectiveId.set(id, {
          id, preferenceId: p.id, kind: 'delivery', target: value,
          source: p.source, profileVersion: effective.profileVersion,
          ...(priority !== undefined ? { priority } : {}),
        });
      }
      continue;
    }

    if (isTopic) {
      if (!isSupportedTopic(value)) {
        excluded.push({ id: p.id, value, reason: 'unsupported_grounded_topic' });
        continue;
      }
      if (!topicIds.includes(value)) topicIds.push(value);
      // Deterministic provenance: lowest preference id, not first answered.
      if (!topicPreference || p.id < topicPreference.id) topicPreference = p;
      explicitPriority(p);
    }
  }

  if (topicIds.length && topicPreference) {
    const priority = (topicPreference as unknown as { priority?: number }).priority;
    byObjectiveId.set('prefer_topic_alignment', {
      id: 'prefer_topic_alignment',
      preferenceId: topicPreference.id,
      kind: 'topic',
      target: GROUNDED_TOPIC_CATEGORY,
      topicIds: [...topicIds].sort(),
      source: topicPreference.source,
      profileVersion: effective.profileVersion,
      ...(typeof priority === 'number' && Number.isFinite(priority) ? { priority } : {}),
    });
  }

  return {
    objectives: [...byObjectiveId.values()].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)),
    excluded,
    profileVersion: effective.profileVersion,
    ...(prioritySource ? { prioritySource } : {}),
  };
}

// ── M2: independent, bounded, comparable per-objective scores ────────────────

export interface ObjectiveScoreComponent {
  objectiveId: GroundedObjectiveId;
  /** Supported matches actually found — courses, or course×topic affirmations. */
  raw: number;
  /** The objective-specific denominator that bounds `raw`. */
  denominator: number;
  /** `raw / denominator`, always within [0,1] and comparable across objectives. */
  normalized: number;
  contributions: ObjectiveContribution[];
  unknownCourseIds: string[];
  variesBySectionCourseIds: string[];
}

/**
 * The denominator is deliberately derived from the CANDIDATE, never from how
 * much evidence happens to exist:
 *
 *   delivery — candidate course count. "What fraction of this plan is a
 *              laboratory/project course."
 *   topic    — candidate course count × confirmed topic count. With a single
 *              confirmed topic this reduces to the delivery denominator, so
 *              one-objective ranking is a monotone transform of the previous
 *              raw counts and the selected candidate is unchanged.
 *
 * Consequences, all tested:
 *   - a LARGER schedule is not rewarded merely for holding more courses — the
 *     denominator grows with it;
 *   - greater evidence COVERAGE cannot raise a score, because coverage never
 *     enters the denominator. Dividing by "courses with evidence" would have
 *     made a less-covered candidate score higher, which is exactly backwards;
 *   - an unknown course occupies the denominator and contributes 0 — the same
 *     as a course whose fact is genuinely false, so unknown is never a penalty
 *     relative to a known negative, and never a reward;
 *   - duplicate evidence and repeated synonyms cannot inflate `raw`, because
 *     the underlying scorer already collapses them to a set.
 */
export function scoreObjective(
  courseIds: readonly string[],
  objective: ResolvedObjective,
  snapshotId: string,
  features: FeatureIndex,
  topics?: TopicIndex,
): ObjectiveScoreComponent {
  const distinct = [...new Set(courseIds)];
  const score = scoreCandidateOnObjective(
    distinct,
    {
      id: objective.id,
      confirmed: true,
      snapshotId,
      ...(objective.topicIds?.length ? { topicIds: objective.topicIds } : {}),
    },
    features,
    topics,
  );
  const perCourse = objective.kind === 'topic' ? Math.max(1, objective.topicIds?.length ?? 0) : 1;
  const denominator = distinct.length * perCourse;
  return {
    objectiveId: objective.id,
    raw: score.score,
    denominator,
    normalized: denominator > 0 ? score.score / denominator : 0,
    contributions: score.contributions,
    unknownCourseIds: score.unknownCourseIds,
    variesBySectionCourseIds: score.variesBySectionCourseIds,
  };
}

// ── M3: Pareto dominance, evaluated before any aggregation ───────────────────

/**
 * `a` dominates `b` when it is at least as good on EVERY active objective and
 * strictly better on at least one. Vectors are aligned by objective order, and
 * the relation is a conjunction over all positions, so it is order-invariant.
 *
 * Callers must only compare candidates that already tie on every higher-priority
 * hard/legality/distribution component — `composeObjectiveRanking` is applied
 * strictly after that prefix in `candidate_set.ts`.
 */
export function dominates(a: readonly number[], b: readonly number[]): boolean {
  if (a.length !== b.length || a.length === 0) return false;
  let strictlyBetter = false;
  for (let i = 0; i < a.length; i++) {
    if (a[i] < b[i]) return false;
    if (a[i] > b[i]) strictlyBetter = true;
  }
  return strictlyBetter;
}

// ── M4: deterministic composition ────────────────────────────────────────────

export type ObjectiveSelectionReason =
  /** Exactly one objective was active — unchanged single-objective behaviour. */
  | 'single_objective'
  /** The selected candidate is at least as good on all, better on one. */
  | 'dominates_all_objectives'
  /** A real trade-off existed; the documented equal-importance default decided. */
  | 'equal_confirmed_preferences'
  /** The student supplied explicit relative importance, and it decided. */
  | 'explicit_priority'
  /** Composed utility was exactly equal; canonical legacy identity decided. */
  | 'canonical_tie_break'
  /** No objective could separate the candidates on applicable evidence. */
  | 'no_distinguishing_evidence';

/**
 * Composed utility over the normalized vector.
 *
 * With no explicit priority this is the arithmetic mean — an explicitly
 * documented EQUAL-IMPORTANCE default, not an inferred user weighting. Being a
 * mean it is symmetric, so objective order cannot change it, and it is monotone
 * in every component, so a Pareto dominator always scores strictly higher than
 * a candidate it dominates.
 *
 * With explicit priorities it is the priority-weighted mean, using the same
 * properties. A priority of 0 is honoured as "this genuinely does not matter",
 * which is different from the preference being absent.
 */
export function composedUtility(
  vector: readonly number[],
  priorities?: readonly (number | undefined)[],
): number {
  if (vector.length === 0) return 0;
  const weights = vector.map((_, i) => {
    const p = priorities?.[i];
    return typeof p === 'number' && Number.isFinite(p) && p >= 0 ? p : 1;
  });
  const total = weights.reduce((a, b) => a + b, 0);
  if (total === 0) return 0;
  return vector.reduce((sum, v, i) => sum + v * weights[i], 0) / total;
}

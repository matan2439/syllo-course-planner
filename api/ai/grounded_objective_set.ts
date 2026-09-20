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
/**
 * C5 — category/affects markers for the GENERIC relative-priority preference.
 * Its value is a stable objective id, or `EQUAL_IMPORTANCE`. There is
 * deliberately no pair-specific field (`topic_over_project` and friends): a
 * pairwise vocabulary cannot express three objectives without inventing an
 * order, and admits cycles that a single primary choice cannot.
 */
export const OBJECTIVE_PRIORITY_CATEGORY = 'objective_priority';
export const OBJECTIVE_PRIORITY_AFFECTS = 'grounded_objective_priority';
/** The student explicitly said the impacted objectives matter the same. */
export const EQUAL_IMPORTANCE = 'equal_importance';

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
  reason: 'unsupported_grounded_feature' | 'unsupported_grounded_topic' | 'conflicting_grounded_topic';
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
  /**
   * C5 — what the student explicitly said about relative importance, if
   * anything. `primary` ⇒ `primaryObjectiveId` names the objective the
   * recommendation is chosen on; `equal_importance` ⇒ they explicitly asked for
   * the equal-importance default. Absent ⇒ unanswered, which is NOT the same as
   * equal importance and is why the question is still worth asking.
   */
  priorityChoice?: 'primary' | 'equal_importance';
  /** Set only with `priorityChoice: 'primary'`, and only for an ACTIVE objective. */
  primaryObjectiveId?: GroundedObjectiveId;
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
      if (!existing || p.id < existing.preferenceId) {
        byObjectiveId.set(id, {
          id, preferenceId: p.id, kind: 'delivery', target: value,
          source: p.source, profileVersion: effective.profileVersion,
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
    }
  }

  if (topicIds.length && topicPreference) {
    byObjectiveId.set('prefer_topic_alignment', {
      id: 'prefer_topic_alignment',
      preferenceId: topicPreference.id,
      kind: 'topic',
      target: GROUNDED_TOPIC_CATEGORY,
      topicIds: [...topicIds].sort(),
      source: topicPreference.source,
      profileVersion: effective.profileVersion,
    });
  }

  const objectives = [...byObjectiveId.values()].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));

  /**
   * C5 — the GENERIC explicit relative priority.
   *
   * It is read from a preference whose normalized value is a stable objective
   * id (or `EQUAL_IMPORTANCE`), and it is honoured ONLY when it names an
   * objective that is genuinely active in THIS request. A priority naming an
   * objective the student is no longer expressing is inert rather than an
   * error: it describes a trade-off that no longer exists.
   *
   * Nothing here reads preference array order, answer order, option order or
   * the objective resolver's own order — a priority exists only when the
   * student explicitly chose one.
   */
  const priorityPreference = active
    .filter((p) => p.affects === OBJECTIVE_PRIORITY_AFFECTS || p.category === OBJECTIVE_PRIORITY_CATEGORY)
    // Two priority captures can only happen through a malformed profile;
    // resolve by sorted preference id so it is never answer-order dependent.
    .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))[0];
  const priorityValue = priorityPreference ? String(priorityPreference.normalized) : undefined;

  if (priorityValue === EQUAL_IMPORTANCE) {
    return {
      objectives, excluded, profileVersion: effective.profileVersion,
      priorityChoice: 'equal_importance',
    };
  }

  const primary = objectives.find((o) => o.id === priorityValue);
  if (!primary) {
    return { objectives, excluded, profileVersion: effective.profileVersion };
  }

  return {
    objectives: objectives.map((o) => ({
      ...o,
      priority: o.id === primary.id ? PRIORITY_PRIMARY_WEIGHT : PRIORITY_BASE_WEIGHT,
    })),
    excluded,
    profileVersion: effective.profileVersion,
    prioritySource: 'explicit_preference',
    priorityChoice: 'primary',
    primaryObjectiveId: primary.id,
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
  const normalized = denominator > 0 ? score.score / denominator : 0;
  return {
    objectiveId: objective.id,
    raw: score.score,
    denominator,
    // Avoidance is a minimization objective represented in the shared
    // higher-is-better [0,1] vector: no PROVEN exposure is neutral-best (1),
    // and each affirmative avoided-topic match lowers it. Missing evidence and
    // known non-matches therefore tie; coverage absence is never rewarded.
    normalized: objective.id === 'avoid_topic_exposure' ? 1 - normalized : normalized,
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


// ── C5: explicit relative priority as a RANKING TIER ─────────────────────────

/**
 * The weight an explicitly PRIMARY objective carries, and the weight every
 * other active objective carries. Only the ORDER of these numbers is read —
 * they select which objectives share a ranking tier, not how much a point on
 * one objective is worth against a point on another.
 */
export const PRIORITY_PRIMARY_WEIGHT = 2;
export const PRIORITY_BASE_WEIGHT = 1;

/**
 * The ordered comparison key a candidate is ranked on.
 *
 * Objectives are grouped into TIERS by their explicit weight, highest first,
 * and each tier contributes the equal-importance mean of its own components.
 * Ranking compares tiers lexicographically, so:
 *
 *   - with NO explicit priority every objective shares one tier and the key is
 *     `[mean(vector)]` — exactly `composedUtility(vector)`, so ranking is
 *     byte-identical to the equal-importance default;
 *   - with one objective marked primary the key is
 *     `[primary, mean(rest)]` — the prioritized objective decides, and the
 *     remaining objectives only separate candidates that tie on it.
 *
 * This is the documented meaning of "this matters more to me": it selects which
 * objective the recommendation is chosen ON, and leaves the rest as tie-breaks.
 * It is deliberately NOT a numeric trade rate, because a student picking one
 * option out of a list has not stated one and we must not invent it.
 *
 * Within every tier the value is a mean, which is symmetric — so objective
 * ORDER cannot change the key, and a Pareto dominator still scores at least as
 * high in every tier (each tier's mean is monotone in its components).
 */
export function objectiveRankKey(
  vector: readonly number[],
  priorities?: readonly (number | undefined)[],
): number[] {
  if (vector.length === 0) return [0];
  const weightAt = (i: number) => {
    const p = priorities?.[i];
    return typeof p === 'number' && Number.isFinite(p) && p >= 0 ? p : PRIORITY_BASE_WEIGHT;
  };
  const tiers = [...new Set(vector.map((_, i) => weightAt(i)))].sort((a, b) => b - a);
  return tiers.map((w) => {
    const members = vector.filter((_, i) => weightAt(i) === w);
    return members.reduce((a, b) => a + b, 0) / members.length;
  });
}

/** Ties must be exact, not floating-point noise, so tie-breaks stay deterministic. */
export const RANK_EPS = 1e-9;

/**
 * Lexicographic comparison of two rank keys. Positive ⇒ `a` ranks BETTER than
 * `b`, matching the `utility(b) - utility(a)` convention the candidate sort
 * already uses. A difference within `RANK_EPS` is not a difference.
 */
export function compareObjectiveKeys(a: readonly number[], b: readonly number[]): number {
  const n = Math.max(a.length, b.length);
  for (let i = 0; i < n; i++) {
    const d = (a[i] ?? 0) - (b[i] ?? 0);
    if (Math.abs(d) > RANK_EPS) return d;
  }
  return 0;
}

/**
 * C5 — the typed PRIORITY-CLARIFICATION IMPACT contract.
 *
 * C1–C4 let the student choose between validated, non-dominated plans and told
 * them truthfully that those plans trade off. This module answers the question
 * that follows: *is it worth asking which objective matters more?* — and, if so,
 * exactly what each possible answer would recommend.
 *
 * The SERVER is authoritative here, and deliberately so. A client must never
 * decide a priority question is worth asking from:
 *
 *   - the mere existence of two alternatives (they may tie, or converge);
 *   - `unresolvedTradeoff` alone (a trade-off can exist while every possible
 *     priority still recommends the same plan — see the tests);
 *   - differences in the objective vectors (a difference is not a decision);
 *   - card order (order is presentation).
 *
 * Instead, every option's recommendation is computed by REPLAYING the real
 * ranking (`compareRankable`) over the already-retained candidates under that
 * hypothetical priority. Nothing is re-planned, no evidence is re-acquired, and
 * the prediction is therefore the same function that will decide the next
 * Rebuild — which is what makes it safe to show the student.
 *
 * The contract carries no score internals, no evidence ids and no plan states:
 * candidate ids are internal handles the UI already holds from the alternative
 * set, and every user-facing string is a localized objective NAME.
 */
import {
  compareRankable,
  HARD_AND_POLICY_PREFIX,
  type PlanCandidate,
  type RankableCandidate,
} from './candidate_set';
import { compareScore } from './planner_goals';
import { objectiveSubjectHe, type GroundedObjectiveId } from './grounded_objectives';
import {
  EQUAL_IMPORTANCE,
  PRIORITY_BASE_WEIGHT,
  PRIORITY_PRIMARY_WEIGHT,
  type ResolvedObjective,
} from './grounded_objective_set';

/** One answerable option, with the recommendation it would produce. */
export interface PriorityImpactOption {
  /**
   * The stable objective id this option would make primary, or
   * `EQUAL_IMPORTANCE`. It is the machine value the answer is stored as — never
   * a label, and never shown.
   */
  value: string;
  /** The localized name the student actually reads. */
  labelHe: string;
  /** The candidate that would be recommended if this option were chosen. */
  recommendedCandidateId: string;
}

export interface PriorityQuestionImpact {
  category: 'objective_priority';
  /** Stable ids of the objectives that genuinely participate in the trade-off. */
  impactedObjectiveIds: string[];
  /** Localized name per impacted objective id — the UI never needs the vocabulary. */
  objectiveLabels: Record<string, string>;
  /** What is recommended right now, before any priority is expressed. */
  currentRecommendedCandidateId: string;
  /** Every answer the student may give, and what each would recommend. */
  options: PriorityImpactOption[];
  /**
   * THE decisive fact: at least two options recommend different candidates.
   * False ⇒ answering could not change anything, so the question is not asked
   * however interesting the trade-off looks.
   */
  changesRecommendation: boolean;
  /** True once the student has explicitly answered (including equal importance). */
  alreadyAnswered: boolean;
  /** All eight eligibility conditions hold — this is what the UI gates on. */
  eligible: boolean;
  profileVersion: number;
  snapshotId: string;
  /** Factual, derived: which objectives pull toward which plan. */
  tradeoffExplanationHe: string;
  /** The user-facing wording of the equal-importance answer. */
  equalImportanceLabelHe: string;
}

/** The single equal-importance option. There is deliberately no separate
 *  "doesn't matter" answer: both would produce the identical product state
 *  (the documented equal-importance composition), and offering two labels for
 *  one outcome would misrepresent it as a choice. */
export const EQUAL_IMPORTANCE_LABEL_HE = 'שניהם חשובים לי באותה מידה';

export interface PriorityImpactInput {
  /** Every retained, ranked candidate for THIS request. */
  candidates: readonly PlanCandidate[];
  /** The active objective set, in the same order as every candidate's vector. */
  objectives: readonly ResolvedObjective[];
  /** The candidate the engine currently recommends (rank 0). */
  recommendedCandidateId: string;
  snapshotId: string;
  profileVersion: number;
  /** The student already expressed a relative priority (primary or equal). */
  alreadyAnswered: boolean;
  /**
   * A clarification that BLOCKS planning is outstanding (condition 8). An
   * optional preference question must never compete with one.
   */
  blockedByHigherPriority?: boolean;
}

const rankableOf = (c: PlanCandidate): RankableCandidate => ({
  scoreVector: c.scoreVector,
  normalizedIdentity: c.normalizedIdentity,
  vector: c.objectiveScores?.map((s) => s.normalized) ?? [],
});

/** Two candidates are comparable only if they tie on every hard/legality/policy term. */
const comparable = (a: PlanCandidate, b: PlanCandidate) =>
  compareScore(
    a.scoreVector.slice(0, HARD_AND_POLICY_PREFIX),
    b.scoreVector.slice(0, HARD_AND_POLICY_PREFIX),
  ) === 0;

/** Replay the REAL ranking under a hypothetical priority and return the winner. */
function recommendationUnder(
  candidates: readonly PlanCandidate[],
  objectives: readonly ResolvedObjective[],
  primaryObjectiveId: GroundedObjectiveId | null,
): string {
  const priorities = objectives.map((o) =>
    primaryObjectiveId === null
      ? undefined
      : o.id === primaryObjectiveId
        ? PRIORITY_PRIMARY_WEIGHT
        : PRIORITY_BASE_WEIGHT,
  );
  return [...candidates]
    .sort((a, b) => compareRankable(rankableOf(a), rankableOf(b), priorities))[0].id;
}

/**
 * Compute the impact contract.
 *
 * Returns `undefined` only when there is nothing to describe at all (no active
 * objectives, or no recommendation). Otherwise it always returns a TRUTHFUL
 * contract — including one whose `eligible` is false, because "we looked and
 * the answer could not change anything" is itself a fact the UI and the tests
 * are entitled to see.
 */
export function computePriorityQuestionImpact(
  input: PriorityImpactInput,
): PriorityQuestionImpact | undefined {
  const { objectives, candidates } = input;
  if (objectives.length < 2 || candidates.length === 0) return undefined;
  if (!candidates.some((c) => c.id === input.recommendedCandidateId)) return undefined;

  // Condition 1/5 — at least two VALID, error-free, NON-DOMINATED, distinct
  // plans. A dominated plan is worse on some confirmed preference and better on
  // none, so no priority over it would be a real decision.
  const seen = new Set<string>();
  const offered = candidates.filter((c) => {
    if (!c.valid || c.validationErrors.length) return false;
    if (c.nonDominated === false) return false;
    if (seen.has(c.normalizedIdentity)) return false;
    seen.add(c.normalizedIdentity);
    return true;
  });

  // Condition 2 — they must answer the SAME question: identical hard
  // constraints, legality and distribution policy (one snapshot and one profile
  // version are guaranteed by construction — a candidate set is built once).
  const cohort = offered.filter((c) => comparable(c, offered[0] ?? c));

  const vectorOf = (c: PlanCandidate) => c.objectiveScores?.map((s) => s.normalized) ?? [];

  /**
   * Condition 3 — an objective participates MATERIALLY when it strictly favours
   * one non-dominated plan while some other objective strictly favours another.
   * An objective every candidate ties on cannot express anything, so it is not
   * offered even though it is active.
   */
  const materiallyTradedOff = (k: number) =>
    cohort.some((a) =>
      cohort.some((b) => {
        const va = vectorOf(a);
        const vb = vectorOf(b);
        return (va[k] ?? 0) > (vb[k] ?? 0) && vb.some((y, j) => j !== k && y > (va[j] ?? 0));
      }),
    );

  const impacted = objectives
    .map((o, k) => ({ o, k }))
    .filter(({ k }) => cohort.length >= 2 && materiallyTradedOff(k));

  const labelFor = (o: ResolvedObjective) => objectiveSubjectHe(o.id, o.topicIds ?? []);

  const options: PriorityImpactOption[] = [
    ...impacted
      // An objective with no supported student-facing name is not offerable:
      // the alternative would be exposing an internal id.
      .filter(({ o }) => !!labelFor(o))
      .map(({ o }) => ({
        value: o.id as string,
        labelHe: labelFor(o)!,
        recommendedCandidateId: recommendationUnder(cohort, objectives, o.id),
      })),
  ];
  if (options.length) {
    options.push({
      value: EQUAL_IMPORTANCE,
      labelHe: EQUAL_IMPORTANCE_LABEL_HE,
      // Equal importance IS the default composition — so it must reproduce the
      // engine's own current recommendation, and this is computed, not assumed.
      recommendedCandidateId: recommendationUnder(cohort, objectives, null),
    });
  }

  // Condition 4 — the answer must be able to change the recommendation. Two
  // options recommending the same plan is a question with one outcome.
  const changesRecommendation = new Set(options.map((o) => o.recommendedCandidateId)).size > 1;

  const objectiveLabels: Record<string, string> = {};
  for (const { o } of impacted) {
    const label = labelFor(o);
    if (label) objectiveLabels[o.id] = label;
  }

  const eligible =
    cohort.length >= 2 &&
    options.length >= 3 && // at least two impacted objectives plus equal importance
    changesRecommendation &&
    // Conditions 6/7 — already answered (primary OR explicit equal importance)
    // means the student has spoken; re-asking would be asking twice.
    !input.alreadyAnswered &&
    // Condition 8 — a blocking clarification always outranks an optional one.
    !input.blockedByHigherPriority;

  return {
    category: 'objective_priority',
    impactedObjectiveIds: impacted.map(({ o }) => o.id),
    objectiveLabels,
    currentRecommendedCandidateId: input.recommendedCandidateId,
    options,
    changesRecommendation,
    alreadyAnswered: input.alreadyAnswered,
    eligible,
    profileVersion: input.profileVersion,
    snapshotId: input.snapshotId,
    tradeoffExplanationHe: tradeoffExplanationHe(Object.values(objectiveLabels)),
    equalImportanceLabelHe: EQUAL_IMPORTANCE_LABEL_HE,
  };
}

/**
 * The factual framing, derived from the impacted objectives only. It states
 * that a trade-off exists and never claims one plan is better.
 */
function tradeoffExplanationHe(labels: readonly string[]): string {
  if (labels.length < 2) return '';
  return (
    `כל החלופות עומדות באותן דרישות ומגבלות, אבל אין ביניהן אחת שמצטיינת גם ב${labels[0]} ` +
    `וגם ב${labels.slice(1).join(', וגם ב')}.`
  );
}

/**
 * C1/C2 — the bounded, user-selectable ALTERNATIVE SET.
 *
 * The engine already retains several validated, deduplicated combinations and
 * knows which of them are Pareto non-dominated. Until now exactly one reached
 * the user. This module turns the retained set into something a person can
 * actually compare and choose between, under one rule:
 *
 *   an alternative is offered only if choosing it would be a legitimate
 *   decision — never merely to fill a UI.
 *
 * So an exposed alternative is validated, applyable, distinct, non-dominated,
 * and built under the SAME hard constraints, completed-course state,
 * distribution policy, profile version and evidence snapshot as every other.
 * A dominated plan is worse on some confirmed preference and better on none, so
 * it is excluded: offering it would invite a strictly worse choice.
 *
 * `balanced` / `compact` / topic / project / laboratory are planning INPUTS,
 * not identities. Labels here are derived from what a plan actually contains.
 */
import { createHash } from 'crypto';
import type { PlanCandidate } from './candidate_set';
import type { ConstraintModel } from './planner_types';
import { placedCourseIds } from './planner_types';
import { TOPIC_INTEREST_LABELS_HE } from './preference_elicitation';
import type { TopicId } from './course_topics';

/** Repository-established bound: `DEFAULT_MAX_CANDIDATES`. */
export const MAX_EXPOSED_ALTERNATIVES = 3;

export interface AlternativeSemester {
  semesterId: string;
  courseIds: string[];
}

export interface PlanAlternative {
  /** Stable candidate id — the Apply target, never an array position. */
  candidateId: string;
  normalizedIdentity: string;
  /** The default the engine recommends. Exactly one alternative carries it. */
  recommended: boolean;
  applyable: boolean;
  /** The COMPLETE plan, so the client never reconstructs one from difference text. */
  semesters: AlternativeSemester[];
  /** Identical across the set — proof they answer the same question. */
  constraintFingerprint: string;
  profileVersion: number;
  snapshotId: string;
  nonDominated: boolean;
  composedUtility: number;
  objectiveScores: Array<{ objectiveId: string; normalized: number }>;
  /** Short, factual, derived from the plan — never a planning-input name. */
  labelHe: string;
  /** Factual differences against the recommended alternative. */
  differencesHe: string[];
  workload: { peakHours: number; totalHours: number; activePeriods: number };
}

/**
 * A stable digest of everything that must be IDENTICAL for two plans to be
 * comparable alternatives rather than answers to different questions.
 */
export function constraintFingerprint(input: {
  model: ConstraintModel;
  completedCourseIds: readonly string[];
  distributionPolicy?: string;
  profileVersion: number;
}): string {
  const m = input.model;
  const parts = {
    required: m.degreeRequiredHours ?? null,
    maxPerSemester: m.maxHoursPerSemester ?? null,
    hardCap: m.hardCap ?? null,
    wanted: [...(m.mustIncludeCourseIds ?? [])].sort(),
    excluded: [...(m.disallowedCourseIds ?? [])].sort(),
    pinned: [...(m.pinnedCourseIds ?? [])].sort(),
    completed: [...input.completedCourseIds].sort(),
    policy: input.distributionPolicy ?? 'neutral',
    profileVersion: input.profileVersion,
  };
  return `cf_${createHash('sha256').update(JSON.stringify(parts), 'utf8').digest('hex').slice(0, 16)}`;
}

const semestersOf = (c: PlanCandidate): AlternativeSemester[] =>
  Object.entries(c.state.semesters)
    .map(([semesterId, courseIds]) => ({ semesterId, courseIds: [...new Set(courseIds)].sort() }))
    .sort((a, b) => (a.semesterId < b.semesterId ? -1 : 1));

const coursesOf = (c: PlanCandidate) => [...new Set(placedCourseIds(c.state))].sort();

function workloadOf(c: PlanCandidate, model: ConstraintModel) {
  const hours = (id: string) => model.profiles.get(id)?.hours ?? 0;
  const perSemester = Object.values(c.state.semesters).map((ids) =>
    [...new Set(ids)].reduce((sum, id) => sum + hours(id), 0));
  return {
    peakHours: perSemester.length ? Math.max(...perSemester) : 0,
    totalHours: perSemester.reduce((a, b) => a + b, 0),
    activePeriods: perSemester.filter((h) => h > 0).length,
  };
}

/** Human wording for an objective, used only when the plan actually leads on it. */
function objectiveLabelHe(objectiveId: string, topicIds: readonly TopicId[]): string | undefined {
  if (objectiveId === 'prefer_project_courses') return 'יותר קורסים פרויקטליים';
  if (objectiveId === 'prefer_laboratory_courses') return 'יותר קורסים עם מעבדה';
  if (objectiveId === 'prefer_topic_alignment') {
    const names = topicIds.map((t) => TOPIC_INTEREST_LABELS_HE[t]).filter(Boolean);
    return names.length ? `יותר קורסים בתחום ${names.join(', ')}` : undefined;
  }
  return undefined;
}

/**
 * A factual label: what this plan leads on among the OFFERED set.
 *
 * Leading on every active objective is described as a combination; leading on
 * exactly one names that one; leading on none falls back to a neutral ordinal,
 * because inventing a distinction the facts do not support would be worse than
 * saying nothing.
 */
function labelFor(
  index: number,
  scores: number[][],
  objectiveIds: string[],
  topicIds: readonly TopicId[],
): string {
  const mine = scores[index] ?? [];
  const leads = objectiveIds
    .map((id, k) => ({ id, k }))
    .filter(({ k }) => mine[k] !== undefined && scores.every((other, j) => j === index || mine[k] >= (other[k] ?? 0)))
    // Only a STRICT advantage over someone is a distinguishing feature.
    .filter(({ k }) => scores.some((other, j) => j !== index && mine[k] > (other[k] ?? 0)));

  const names = leads.map(({ id }) => objectiveLabelHe(id, topicIds)).filter((n): n is string => !!n);
  if (names.length === 1) return names[0];
  if (names.length > 1) return `שילוב: ${names.join(' ו')}`;
  return `חלופה ${index + 1}`;
}

/** Factual differences against the recommended plan — derived, never authored. */
function differencesHe(
  candidate: PlanCandidate,
  recommended: PlanCandidate,
  model: ConstraintModel,
): string[] {
  if (candidate.id === recommended.id) return [];
  const out: string[] = [];
  const mine = coursesOf(candidate);
  const theirs = coursesOf(recommended);
  const name = (id: string) => model.profiles.get(id)?.name_he ?? id;

  const added = mine.filter((c) => !theirs.includes(c));
  const removed = theirs.filter((c) => !mine.includes(c));
  if (added.length) out.push(`כולל ${added.map((c) => `${name(c)} (${c})`).join(', ')}`);
  if (removed.length) out.push(`לא כולל ${removed.map((c) => `${name(c)} (${c})`).join(', ')}`);

  // A course kept but placed in a different period is a real, separate fact.
  const periodOf = (c: PlanCandidate, id: string) =>
    Object.entries(c.state.semesters).find(([, ids]) => ids.includes(id))?.[0];
  const moved = mine
    .filter((c) => theirs.includes(c))
    .filter((c) => periodOf(candidate, c) !== periodOf(recommended, c));
  if (moved.length) out.push(`מיקום שונה בסמסטר: ${moved.map((c) => `${name(c)} (${c})`).join(', ')}`);

  const a = workloadOf(candidate, model);
  const b = workloadOf(recommended, model);
  if (a.peakHours !== b.peakHours) {
    out.push(`עומס שיא ${a.peakHours} ש״ש לעומת ${b.peakHours} ש״ש`);
  }
  if (a.activePeriods !== b.activePeriods) {
    out.push(`${a.activePeriods} סמסטרים פעילים לעומת ${b.activePeriods}`);
  }
  return out;
}

export interface BuildAlternativesInput {
  candidates: readonly PlanCandidate[];
  /** The candidate the engine selected — it must be the recommended alternative. */
  selectedId?: string;
  model: ConstraintModel;
  constraintFingerprint: string;
  snapshotId: string;
  profileVersion: number;
  objectiveIds: string[];
  topicIds?: readonly TopicId[];
  maxExposed?: number;
}

/**
 * Build the exposed set.
 *
 * Returns an EMPTY array unless at least two genuinely selectable alternatives
 * survive: one plan is a proposal, not a comparison, and presenting it as a
 * choice would be dishonest.
 */
export function buildPlanAlternatives(input: BuildAlternativesInput): PlanAlternative[] {
  const max = Math.max(1, input.maxExposed ?? MAX_EXPOSED_ALTERNATIVES);

  // 1. Only legal, applyable, non-dominated, DISTINCT plans may be offered.
  const seen = new Set<string>();
  const eligible = input.candidates.filter((c) => {
    if (!c.valid || c.validationErrors.length) return false;
    if (c.nonDominated === false) return false;
    if (seen.has(c.normalizedIdentity)) return false;
    seen.add(c.normalizedIdentity);
    return true;
  });
  if (eligible.length < 2) return [];

  // 2. Bound deterministically: the recommendation always survives, then the
  //    extreme on each objective (a real reason to prefer it), then whatever
  //    differs most from what is already chosen. Never array order, never random.
  const recommended = eligible.find((c) => c.id === input.selectedId) ?? eligible[0];
  const vectorOf = (c: PlanCandidate) => c.objectiveScores?.map((s) => s.normalized) ?? [];
  const chosen: PlanCandidate[] = [recommended];

  for (let k = 0; k < input.objectiveIds.length && chosen.length < max; k++) {
    const best = eligible
      .filter((c) => !chosen.includes(c))
      .sort((a, b) =>
        ((vectorOf(b)[k] ?? 0) - (vectorOf(a)[k] ?? 0)) ||
        (a.normalizedIdentity < b.normalizedIdentity ? -1 : 1))[0];
    if (best && (vectorOf(best)[k] ?? 0) > (vectorOf(recommended)[k] ?? 0)) chosen.push(best);
  }

  const distance = (a: PlanCandidate, b: PlanCandidate) => {
    const x = new Set(coursesOf(a));
    const y = coursesOf(b);
    return y.filter((c) => !x.has(c)).length + coursesOf(a).filter((c) => !y.includes(c)).length;
  };
  while (chosen.length < max) {
    const next = eligible
      .filter((c) => !chosen.includes(c))
      .sort((a, b) =>
        (Math.min(...chosen.map((c) => distance(b, c))) - Math.min(...chosen.map((c) => distance(a, c)))) ||
        (a.normalizedIdentity < b.normalizedIdentity ? -1 : 1))[0];
    if (!next) break;
    chosen.push(next);
  }

  // 3. Present in the engine's own ranking order, so the recommendation reads
  //    first without the order itself carrying any other meaning.
  const ordered = chosen.slice().sort((a, b) => a.rank - b.rank);
  const scores = ordered.map(vectorOf);
  const topicIds = input.topicIds ?? [];

  return ordered.map((c, i) => ({
    candidateId: c.id,
    normalizedIdentity: c.normalizedIdentity,
    recommended: c.id === recommended.id,
    applyable: true,
    semesters: semestersOf(c),
    constraintFingerprint: input.constraintFingerprint,
    profileVersion: input.profileVersion,
    snapshotId: input.snapshotId,
    nonDominated: c.nonDominated !== false,
    composedUtility: c.composedUtility ?? 0,
    objectiveScores: (c.objectiveScores ?? []).map((s) => ({
      objectiveId: s.objectiveId, normalized: s.normalized,
    })),
    labelHe: labelFor(i, scores, input.objectiveIds, topicIds),
    differencesHe: differencesHe(c, recommended, input.model),
    workload: workloadOf(c, input.model),
  }));
}

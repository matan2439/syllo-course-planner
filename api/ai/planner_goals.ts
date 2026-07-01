/**
 * The prioritized goal stack and the single ranking mechanism shared by the
 * Planner Worker and both orchestrators.
 *
 * Goals, highest priority first:
 *   1. degree_completion   — reach the required degree hours (e.g. 185).
 *   2. requirements        — place all mandatory courses + satisfy all categories.
 *   3. legality            — no semester over the hard cap / over the user cap.
 *   4. balance             — even weekly load across semesters.
 *   5. preferences         — place the courses the user wants.
 *   6. difficulty_comfort  — lower total difficulty (pure tiebreaker; never a
 *                            reason to skip a required course).
 *
 * `scorePlan` returns a lexicographic vector (higher is better at every
 * position); `compareScore` orders two such vectors. A lower goal can never
 * outrank a strictly-better higher goal. `scoreAction` is the marginal of this
 * same vector for a tentative action.
 */

import {
  type ConstraintModel,
  type PlanState,
  type PlannerMutation,
  cloneState,
  placedCourseIds,
} from './planner_types';

export const GOAL_STACK = [
  'degree_completion',
  'requirements_mandatory',
  'requirements_category',
  'legality',
  'balance',
  'preferences',
  'unwanted_avoidance',
  'difficulty_comfort',
] as const;
export type Goal = (typeof GOAL_STACK)[number];

/** Total weekly hours placed, deduplicating annual course pairs by root_course_id. */
export function placedHours(state: PlanState, model: ConstraintModel): number {
  const seenRoots = new Set<string>();
  let sum = 0;
  for (const cid of placedCourseIds(state)) {
    const p = model.profiles.get(cid);
    if (!p) continue;
    if (p.count_hours_once && p.root_course_id) {
      if (seenRoots.has(p.root_course_id)) continue;
      seenRoots.add(p.root_course_id);
    }
    sum += p.hours ?? 0;
  }
  return sum;
}

/** Degree hours achieved: prior progress + placed hours. */
export function degreeHours(state: PlanState, model: ConstraintModel): number {
  return model.priorHours + placedHours(state, model);
}

function semesterLoads(state: PlanState, model: ConstraintModel): number[] {
  return Object.values(state.semesters).map(list =>
    list.reduce((s, cid) => s + (model.profiles.get(cid)?.hours ?? 0), 0),
  );
}

function categoriesSatisfied(state: PlanState, model: ConstraintModel): number {
  const placed = new Set(placedCourseIds(state));
  let n = 0;
  for (const cat of model.categories) {
    const got = cat.candidateIds.filter(id => placed.has(id)).length;
    if (got >= cat.required) n++;
  }
  return n;
}

function mandatoryPlaced(state: PlanState, model: ConstraintModel): number {
  const placed = new Set(placedCourseIds(state));
  return model.requiredMandatoryCourseIds.filter(id => placed.has(id)).length;
}

/**
 * Lexicographic score vector (higher = better at each position), one entry per
 * goal in GOAL_STACK order.
 */
export function scorePlan(state: PlanState, model: ConstraintModel): number[] {
  const loads = semesterLoads(state, model);

  // 1. degree completion — credit toward the requirement, capped (no reward for
  //    overshooting past the target).
  const dh = degreeHours(state, model);
  const g1 = Math.min(dh, model.degreeRequiredHours);

  // 2a. requirements (mandatory) — fraction of mandatory courses placed.
  const mandTotal = model.requiredMandatoryCourseIds.length;
  const g2a = mandTotal > 0 ? mandatoryPlaced(state, model) / mandTotal : 1;

  // 2b. requirements (categories) — fraction of categories satisfied.
  const catTotal = model.categories.length;
  const g2b = catTotal > 0 ? categoriesSatisfied(state, model) / catTotal : 1;

  // 3. legality — penalize semesters over the hard cap and over the user cap.
  const overHard = loads.filter(h => h > model.hardCap).length;
  const overUser = loads.filter(h => h > model.maxHoursPerSemester).length;
  const g3 = -(overHard * 10 + overUser);

  // 4. balance — minimize the spread between busiest and quietest *non-empty* semester.
  //    Empty semesters are intentional placeholders and must not widen the spread.
  const activeLs = loads.filter(h => h > 0);
  const spread = activeLs.length > 1 ? Math.max(...activeLs) - Math.min(...activeLs) : 0;
  const g4 = -spread;

  // 5. preferences — wanted courses placed.
  const placed = new Set(placedCourseIds(state));
  const g5 = [...model.wantedCourseIds].filter(id => placed.has(id)).length;

  // 5b. unwanted avoidance — penalise each unwanted course placed.
  const g5b = -[...placed].filter(id => model.profiles.get(id)?.is_unwanted).length;

  // 6. difficulty / comfort — lower total difficulty preferred (tiebreaker).
  let totalDifficulty = 0;
  for (const cid of placed) totalDifficulty += model.profiles.get(cid)?.difficulty_score ?? 0;
  const g6 = -totalDifficulty;

  return [g1, g2a, g2b, g3, g4, g5, g5b, g6];
}

export interface CompletenessAssessment {
  degreeHours: number;
  degreeMet: boolean;
  /** requiredMandatoryCourseIds not yet placed (and not already completed). */
  missingMandatory: string[];
  /** category ids whose placed-candidate count is below their required count. */
  unsatisfiedCategories: string[];
  /** semester ids whose total placed hours exceed model.hardCap. */
  overCapSemesters: string[];
}

/**
 * The shared degree-completion judgment — the single source of truth for
 * "what's missing" behind both TauPolicyProvider.isGoal (a boolean derived
 * from this) and validateCandidate's CandidateReport (the detailed gaps).
 * Pure: no I/O, no mutation.
 */
export function assessCompleteness(state: PlanState, model: ConstraintModel): CompletenessAssessment {
  const placed = new Set(placedCourseIds(state));

  const dh = degreeHours(state, model);
  const degreeMet = dh >= model.degreeRequiredHours;

  const missingMandatory = model.requiredMandatoryCourseIds.filter(
    id => !placed.has(id) && !model.completedCourseIds.has(id),
  );

  const unsatisfiedCategories = model.categories
    .filter(cat => cat.candidateIds.filter(id => placed.has(id)).length < cat.required)
    .map(cat => cat.id);

  const overCapSemesters = model.knownSemesterIds.filter(
    sem => (state.semesters[sem] ?? []).reduce((s, c) => s + (model.profiles.get(c)?.hours ?? 0), 0) > model.hardCap,
  );

  return { degreeHours: dh, degreeMet, missingMandatory, unsatisfiedCategories, overCapSemesters };
}

/** Compare two score vectors lexicographically: >0 if a is better than b. */
export function compareScore(a: number[], b: number[]): number {
  const n = Math.max(a.length, b.length);
  for (let i = 0; i < n; i++) {
    const d = (a[i] ?? 0) - (b[i] ?? 0);
    if (d !== 0) return d;
  }
  return 0;
}

/**
 * Apply a mutation to a cloned state (no validation — the worker validates).
 * Returns the new state, or null if the mutation is structurally impossible.
 * Pure: used by scoreAction and lookahead rollouts.
 */
export function applyMutation(state: PlanState, mut: PlannerMutation): PlanState | null {
  if (mut.type === 'STOP') return cloneState(state);
  const next = cloneState(state);
  const removeEverywhere = (id: string) => {
    for (const sem of Object.keys(next.semesters)) {
      next.semesters[sem] = next.semesters[sem].filter(c => c !== id);
    }
  };
  switch (mut.type) {
    case 'ADD_COURSE':
      if (placedCourseIds(next).includes(mut.courseId)) return null;
      if (!next.semesters[mut.semesterId]) return null;
      next.semesters[mut.semesterId].push(mut.courseId);
      return next;
    case 'REMOVE_COURSE':
      if (!placedCourseIds(next).includes(mut.courseId)) return null;
      removeEverywhere(mut.courseId);
      return next;
    case 'MOVE_COURSE': {
      if (!placedCourseIds(next).includes(mut.courseId)) return null;
      if (!next.semesters[mut.toSemester]) return null;
      removeEverywhere(mut.courseId);
      next.semesters[mut.toSemester].push(mut.courseId);
      return next;
    }
    case 'REPLACE_COURSE': {
      if (!placedCourseIds(next).includes(mut.outId)) return null;
      if (placedCourseIds(next).includes(mut.inId)) return null;
      if (!next.semesters[mut.semesterId]) return null;
      removeEverywhere(mut.outId);
      next.semesters[mut.semesterId].push(mut.inId);
      return next;
    }
  }
}

/**
 * Marginal goal-advancement of an action: the lexicographic delta between the
 * resulting plan's score and the current plan's score. Higher = more advancing.
 * (Used as the immediate term; the worker adds a downstream/lookahead term for
 * the top candidates.)
 */
export function scoreAction(mut: PlannerMutation, model: ConstraintModel, state: PlanState): number[] {
  const before = scorePlan(state, model);
  const nextState = applyMutation(state, mut);
  if (!nextState) return GOAL_STACK.map(() => -Infinity);
  const after = scorePlan(nextState, model);
  return after.map((v, i) => v - (before[i] ?? 0));
}

/**
 * generateCandidates — produce MULTIPLE valid candidate plans (not one), by
 * branching on alternative legal A/B placements of flexible courses. Each
 * candidate is built by the deterministic worker (so it is fully validated and
 * complete) and the set is deduped, ranked by the goal stack, and bounded.
 *
 * GENERATE_CANDIDATES + VALIDATE: only valid (legal + complete) plans are
 * returned, so no invalid plan can ever be shown as final.
 */

import { PlannerWorker } from './planner_worker';
import { validateCandidate, type CandidateReport } from './planner_validate';
import { legalSemestersFor, isMovable } from './planner_actions';
import { scorePlan, compareScore } from './planner_goals';
import type { PlannerAction } from './planner_trace';
import {
  type ConstraintModel,
  type PlanState,
  emptyState,
  cloneState,
  placedCourseIds,
  semesterOf,
} from './planner_types';

export interface PlanCandidate {
  state: PlanState;
  report: CandidateReport;
  score: number[];
  trace: PlannerAction[];
  signature: string;
}

export interface GenerateCandidatesOptions {
  maxCandidates?: number;
  initial?: PlanState;
  /** How many flexible A/B courses to branch on (bounds the candidate count). */
  maxBranches?: number;
}

/** A stable signature of a plan's placements, for de-duplication. */
function signature(state: PlanState): string {
  return Object.entries(state.semesters)
    .flatMap(([sem, ids]) => ids.map(id => `${sem}:${id}`))
    .sort()
    .join('|');
}

/** Build one candidate by running the worker from a (possibly seeded) start state. */
function build(model: ConstraintModel, initial?: PlanState): PlanCandidate | null {
  const w = new PlannerWorker(model, initial);
  w.run();
  const state = w.getPlan();
  const report = validateCandidate(state, model);
  if (!report.valid) return null;
  return { state, report, score: scorePlan(state, model), trace: w.getTrace(), signature: signature(state) };
}

export function generateCandidates(
  model: ConstraintModel,
  opts: GenerateCandidatesOptions = {},
): PlanCandidate[] {
  const maxCandidates = opts.maxCandidates ?? 4;
  const maxBranches = opts.maxBranches ?? 4;
  const found = new Map<string, PlanCandidate>();

  const base = build(model, opts.initial);
  if (base) found.set(base.signature, base);

  if (base) {
    // Branch on flexible A/B courses placed in the base plan: force each into an
    // alternative legal semester and rebuild around it.
    const placed = placedCourseIds(base.state);
    let branched = 0;
    for (const id of placed) {
      if (branched >= maxBranches) break;
      if (!isMovable(model, id)) continue;
      const here = semesterOf(base.state, id);
      const alternatives = legalSemestersFor(model, id).filter(s => s !== here);
      if (!alternatives.length) continue;

      for (const altSem of alternatives) {
        // Seed: only the branched course, placed in its alternative semester and
        // pinned there; the worker fills the rest around it.
        const seed: PlanState = emptyState(model.knownSemesterIds);
        seed.semesters[altSem] = [id];
        const branchModel: ConstraintModel = {
          ...model,
          pinnedCourseIds: new Set([...model.pinnedCourseIds, id]),
        };
        const variant = build(branchModel, seed);
        if (variant && !found.has(variant.signature)) found.set(variant.signature, variant);
        branched++;
        if (branched >= maxBranches) break;
      }
    }
  }

  return [...found.values()]
    .sort((a, b) => compareScore(b.score, a.score))
    .slice(0, maxCandidates);
}

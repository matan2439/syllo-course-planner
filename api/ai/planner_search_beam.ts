/**
 * Phase 2 — BeamSearchStrategy: first implementation of SearchStrategy.
 *
 * Operates ONLY through SearchDeps closures — never imports ConstraintModel,
 * CourseProfile, planner_actions, planner_goals, or planner_validate.
 * Any S and A work; PlanState/PlannerMutation are just one possible binding.
 *
 * Algorithm:
 *   1. Initialize beam with the single initial state.
 *   2. Each step: expand every beam state via generateActions + applyMutation,
 *      validate each result, score valid ones, sort descending, keep top-k
 *      distinct states (by JSON fingerprint). Record all candidates with
 *      outcomes in DepthRecord.
 *   3. Terminate when all beam states satisfy isGoal, maxSteps is reached,
 *      or no valid expansion exists.
 *   4. Return best terminal state (by score) as finalState; full BeamSearchMeta
 *      including per-depth records, chosenPath, and alternativePaths.
 */

import type {
  SearchDeps,
  SearchResult,
  SearchStrategy,
  BeamSearchMeta,
  CandidateRecord,
  DepthRecord,
  PathStep,
  TerminationReason,
} from './planner_search_types';

/** Internal beam entry — not exported; owned entirely by explore(). */
type BeamEntry<S> = {
  state: S;
  /** Full action+state history from initialState to this entry. */
  path: PathStep[];
  score: number[];
};

/**
 * Beam search over a generic state space S with actions A.
 * Default beam width: 6. Configurable via opts.width.
 */
export class BeamSearchStrategy<S, A> implements SearchStrategy<S, A> {
  explore(
    initialState: S,
    deps: SearchDeps<S, A>,
    opts: { maxSteps: number; width?: number },
  ): SearchResult<S> {
    // ponytail: Math.max(1, ...) guards width=0 (vacuous isGoal on empty beam)
    const width = Math.max(1, opts.width ?? 6);

    let beam: BeamEntry<S>[] = [{
      state: initialState,
      path: [],
      score: deps.score(initialState),
    }];

    const depthRecords: DepthRecord[] = [];
    let terminationReason: TerminationReason = 'max_steps';

    for (let step = 0; step < opts.maxSteps; step++) {
      // Goal check at start of each step (before expansion)
      if (beam.every(e => deps.isGoal(e.state))) {
        terminationReason = 'goal_reached';
        break;
      }

      const candidates: CandidateRecord[] = [];
      type ValidEntry = { action: A; resultState: S; score: number[]; path: PathStep[] };
      const valid: ValidEntry[] = [];

      // Expand every beam state
      for (const entry of beam) {
        for (const action of deps.generateActions(entry.state)) {
          const resultState = deps.applyMutation(entry.state, action);
          const vr = deps.validate(resultState);
          if (!vr.valid) {
            candidates.push({
              action,
              resultState,
              score: [],
              rejected: true,
              rejectReason: 'validation_failed',
              ...(vr.reason !== undefined ? { validationReason: vr.reason } : {}),
            });
          } else {
            const score = deps.score(resultState);
            valid.push({
              action,
              resultState,
              score,
              path: [...entry.path, { action, resultState }],
            });
          }
        }
      }

      if (valid.length === 0) {
        depthRecords.push({ depth: step, candidates, survivors: [] });
        terminationReason = 'no_legal_expansion';
        break;
      }

      // Sort valid candidates descending by score (best first)
      valid.sort((a, b) => deps.compareScore(b.score, a.score));

      // Select top-k distinct states; tag the rest as pruned_by_beam or duplicate
      const nextBeam: BeamEntry<S>[] = [];
      // ponytail: JSON.stringify fingerprint — stable for PlanState (insertion-ordered keys); add injected fn if needed
      const seen = new Set<string>();

      for (const vc of valid) {
        const fp = JSON.stringify(vc.resultState);
        if (seen.has(fp)) {
          candidates.push({
            action: vc.action, resultState: vc.resultState,
            score: vc.score, rejected: true, rejectReason: 'duplicate',
          });
        } else {
          seen.add(fp);
          if (nextBeam.length < width) {
            nextBeam.push({ state: vc.resultState, path: vc.path, score: vc.score });
            candidates.push({
              action: vc.action, resultState: vc.resultState,
              score: vc.score, rejected: false,
            });
          } else {
            candidates.push({
              action: vc.action, resultState: vc.resultState,
              score: vc.score, rejected: true, rejectReason: 'pruned_by_beam',
            });
          }
        }
      }

      depthRecords.push({
        depth: step,
        candidates,
        survivors: nextBeam.map(e => e.state),
      });
      beam = nextBeam;
    }

    // Final goal check: covers the case where the last step completes the beam goal
    if (terminationReason === 'max_steps' && beam.every(e => deps.isGoal(e.state))) {
      terminationReason = 'goal_reached';
    }

    // Pick best terminal state by score; alternativePaths = the rest
    const sorted = [...beam].sort((a, b) => deps.compareScore(b.score, a.score));
    const best = sorted[0];

    const meta: BeamSearchMeta = {
      beamWidth: width,
      depthRecords,
      chosenPath: best.path,
      terminationReason,
      alternativePaths: sorted.slice(1).map(e => e.path),
    };

    return { finalState: best.state, meta };
  }
}

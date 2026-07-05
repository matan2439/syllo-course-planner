/**
 * Phase 2 — tests for api/ai/planner_search_beam.ts (BeamSearchStrategy).
 *
 * All tests use toy S = { n: number }, A = { delta: number } — no PlanState,
 * no ConstraintModel, no domain imports. This proves BeamSearchStrategy is
 * fully generic and independent of university-specific logic.
 *
 * Test list (mirrors Phase 2 requirements from roadmap-v2.md §2.3):
 *  1. Compile-time: BeamSearchStrategy satisfies SearchStrategy<S,A>
 *  2. width=1 converges deterministically
 *  3. width=6 keeps at most 6 beam states per step
 *  4. Invalid candidates carry rejectReason + validationReason
 *  5. depthRecords tracks all candidate outcomes per step
 *  6. chosenPath contains PathStep { action, resultState } pairs
 *  7. terminationReason='max_steps' when goal not reached in time
 *  8. terminationReason='no_legal_expansion' when no actions available
 *  9. Best-scoring terminal state chosen as finalState
 * 10. Initial state at goal → immediate return, empty chosenPath
 * 11. Duplicate resulting states tagged as 'duplicate'
 * 12. alternativePaths populated for unchosen terminal beam states
 */

import { BeamSearchStrategy } from '../../api/ai/planner_search_beam';
import type {
  SearchDeps,
  SearchStrategy,
} from '../../api/ai/planner_search_types';

// ── toy state / action types (no domain coupling) ─────────────────────────────

type S = { n: number };
type A = { delta: number };

/**
 * Baseline SearchDeps: single action +1, always valid, score=[n], goal n>=5.
 * Override individual fields per test.
 */
function makeDeps(overrides: Partial<SearchDeps<S, A>> = {}): SearchDeps<S, A> {
  return {
    generateActions: (_s: S): A[] => [{ delta: 1 }],
    applyMutation:   (s: S, a: A): S => ({ n: s.n + a.delta }),
    validate:        (_s: S) => ({ valid: true }),
    score:           (s: S): number[] => [s.n],
    compareScore:    (a: number[], b: number[]): number => a[0] - b[0],
    isGoal:          (s: S): boolean => s.n >= 5,
    ...overrides,
  };
}

// Single shared instance — SearchStrategy has no mutable state
const strategy = new BeamSearchStrategy<S, A>();

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('BeamSearchStrategy', () => {
  // 1 — compile-time check
  test('satisfies SearchStrategy<S,A> interface at compile time', () => {
    const typed: SearchStrategy<S, A> = strategy;
    expect(typed).toBeDefined();
  });

  // 2 — width=1 deterministic convergence
  test('width=1 converges deterministically to goal', () => {
    const result = strategy.explore({ n: 0 }, makeDeps(), { maxSteps: 10, width: 1 });
    expect(result.meta!.terminationReason).toBe('goal_reached');
    expect(result.finalState.n).toBe(5);
    // 5 steps: n=0→1→2→3→4→5 (goal check fires when beam hits n=5 at start of step 5)
    expect(result.meta!.chosenPath).toHaveLength(5);
    expect(result.meta!.depthRecords).toHaveLength(5);
  });

  // 3 — width=6 caps beam size
  test('width=6 keeps at most 6 beam states per step', () => {
    const deps = makeDeps({
      // 10 distinct actions → 10 distinct result states; all valid
      generateActions: (_s: S): A[] =>
        [1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map(d => ({ delta: d })),
      isGoal: (s: S) => s.n >= 100,
    });
    const result = strategy.explore({ n: 0 }, deps, { maxSteps: 1, width: 6 });
    const dr = result.meta!.depthRecords[0];
    // Exactly 6 survive; 4 are pruned_by_beam
    expect(dr.survivors).toHaveLength(6);
    expect(dr.candidates.filter(c => c.rejectReason === 'pruned_by_beam')).toHaveLength(4);
    // Best terminal state: highest delta selected (delta=10 → n=10)
    expect(result.finalState.n).toBe(10);
  });

  // 4 — invalid candidates carry validationReason
  test('invalid candidates are rejected with rejectReason and validationReason', () => {
    const deps = makeDeps({
      generateActions: (_s: S): A[] => [{ delta: -1 }, { delta: 1 }],
      validate: (s: S) =>
        s.n < 0
          ? { valid: false, reason: 'value cannot be negative' }
          : { valid: true },
      isGoal: (s: S) => s.n >= 5,
    });
    const result = strategy.explore({ n: 0 }, deps, { maxSteps: 1, width: 6 });
    const dr = result.meta!.depthRecords[0];
    const invalid = dr.candidates.find(c => c.rejectReason === 'validation_failed');
    expect(invalid).toBeDefined();
    expect(invalid!.validationReason).toBe('value cannot be negative');
    expect(invalid!.rejected).toBe(true);
    expect((invalid!.resultState as S).n).toBe(-1);
  });

  // 5 — depthRecords records all candidate outcomes
  test('depthRecords records considered/rejected/survived/pruned candidates', () => {
    const deps = makeDeps({
      // 3 actions: invalid, valid-low, valid-high
      generateActions: (_s: S): A[] => [{ delta: -1 }, { delta: 1 }, { delta: 2 }],
      validate: (s: S) =>
        s.n < 0 ? { valid: false, reason: 'negative' } : { valid: true },
      isGoal: (s: S) => s.n >= 100,
    });
    // width=1: only the best valid candidate survives; the other valid one is pruned
    const result = strategy.explore({ n: 0 }, deps, { maxSteps: 1, width: 1 });
    const dr = result.meta!.depthRecords[0];

    expect(dr.candidates).toHaveLength(3);

    const failed   = dr.candidates.filter(c => c.rejectReason === 'validation_failed');
    const pruned   = dr.candidates.filter(c => c.rejectReason === 'pruned_by_beam');
    const survived = dr.candidates.filter(c => !c.rejected);

    expect(failed).toHaveLength(1);    // delta=-1 → n=-1 → invalid
    expect(pruned).toHaveLength(1);    // delta=1  → n=1  → valid but beaten by delta=2
    expect(survived).toHaveLength(1);  // delta=2  → n=2  → best score, survivor
    expect(dr.survivors).toHaveLength(1);
    expect((dr.survivors[0] as S).n).toBe(2);
  });

  // 6 — chosenPath contains PathStep objects
  test('chosenPath contains PathStep { action, resultState } pairs', () => {
    const result = strategy.explore({ n: 0 }, makeDeps(), { maxSteps: 10, width: 1 });
    expect(result.meta!.chosenPath.length).toBeGreaterThan(0);

    const first = result.meta!.chosenPath[0];
    expect(first).toHaveProperty('action');
    expect(first).toHaveProperty('resultState');
    expect((first.action as A).delta).toBe(1);
    expect((first.resultState as S).n).toBe(1);

    // chosenPath mirrors the full trajectory to finalState
    const last = result.meta!.chosenPath.at(-1)!;
    expect((last.resultState as S).n).toBe(result.finalState.n);
  });

  // 7 — max_steps termination
  test("terminationReason is 'max_steps' when goal not reached in time", () => {
    const deps = makeDeps({ isGoal: (s: S) => s.n >= 100 }); // far goal
    const result = strategy.explore({ n: 0 }, deps, { maxSteps: 3, width: 1 });
    expect(result.meta!.terminationReason).toBe('max_steps');
    expect(result.finalState.n).toBe(3); // 3 steps of +1
    expect(result.meta!.depthRecords).toHaveLength(3);
  });

  // 8 — no_legal_expansion termination (empty action list)
  test("terminationReason is 'no_legal_expansion' when generateActions returns empty", () => {
    const deps = makeDeps({ generateActions: (_s: S): A[] => [] });
    const result = strategy.explore({ n: 0 }, deps, { maxSteps: 10, width: 6 });
    expect(result.meta!.terminationReason).toBe('no_legal_expansion');
    expect(result.finalState).toEqual({ n: 0 });
    expect(result.meta!.chosenPath).toHaveLength(0);
    expect(result.meta!.depthRecords).toHaveLength(1);
    expect(result.meta!.depthRecords[0].candidates).toHaveLength(0);
  });

  // 8b — no_legal_expansion when all actions produce invalid states
  test("terminationReason is 'no_legal_expansion' when all actions are invalid", () => {
    const deps = makeDeps({
      generateActions: (_s: S): A[] => [{ delta: -10 }],
      validate: (s: S) => s.n < 0 ? { valid: false, reason: 'negative' } : { valid: true },
      isGoal: (s: S) => s.n >= 100,
    });
    const result = strategy.explore({ n: 0 }, deps, { maxSteps: 5, width: 6 });
    expect(result.meta!.terminationReason).toBe('no_legal_expansion');
    expect(result.finalState).toEqual({ n: 0 });
  });

  // 9 — best-scoring state chosen as finalState
  test('best-scoring terminal state is chosen as finalState', () => {
    const deps = makeDeps({
      // Two valid actions; delta=5 produces higher score than delta=1
      generateActions: (_s: S): A[] => [{ delta: 1 }, { delta: 5 }],
      isGoal: (s: S) => s.n >= 100,
    });
    // width=1: only the top-scoring candidate survives each step
    const result = strategy.explore({ n: 0 }, deps, { maxSteps: 1, width: 1 });
    expect(result.finalState.n).toBe(5); // delta=5 beats delta=1
    expect(result.meta!.terminationReason).toBe('max_steps');
    // The pruned candidate (delta=1 → n=1) appears in depthRecords
    const dr = result.meta!.depthRecords[0];
    expect(dr.candidates.find(c => (c.resultState as S).n === 1)?.rejected).toBe(true);
  });

  // 10 — initial state satisfies goal immediately
  test('initial state satisfying goal returns immediately with empty chosenPath', () => {
    const deps = makeDeps({ isGoal: (_s: S) => true });
    const result = strategy.explore({ n: 0 }, deps, { maxSteps: 10, width: 6 });
    expect(result.meta!.terminationReason).toBe('goal_reached');
    expect(result.meta!.chosenPath).toHaveLength(0);
    expect(result.meta!.depthRecords).toHaveLength(0);
    expect(result.finalState).toEqual({ n: 0 });
  });

  // 11 — duplicate resulting states are tagged 'duplicate'
  test("duplicate resulting states are tagged 'duplicate' in candidates", () => {
    const deps = makeDeps({
      // Two actions, both produce the same resulting state
      generateActions: (_s: S): A[] => [{ delta: 1 }, { delta: 1 }],
      isGoal: (s: S) => s.n >= 100,
    });
    const result = strategy.explore({ n: 0 }, deps, { maxSteps: 1, width: 6 });
    const dr = result.meta!.depthRecords[0];
    const duplicates = dr.candidates.filter(c => c.rejectReason === 'duplicate');
    expect(duplicates).toHaveLength(1);
    expect(dr.survivors).toHaveLength(1);
    expect((dr.survivors[0] as S).n).toBe(1);
  });

  // 12 — alternativePaths populated for unchosen terminal beams
  test('alternativePaths holds paths for non-chosen terminal beam states', () => {
    const deps = makeDeps({
      generateActions: (_s: S): A[] => [{ delta: 1 }, { delta: 2 }],
      isGoal: (s: S) => s.n >= 100,
    });
    // width=2: both candidates survive → 2 terminal beam states
    const result = strategy.explore({ n: 0 }, deps, { maxSteps: 1, width: 2 });
    // best (delta=2, n=2) chosen; alternative (delta=1, n=1) in alternativePaths
    expect(result.finalState.n).toBe(2);
    expect(result.meta!.alternativePaths).toHaveLength(1);
    const altPath = result.meta!.alternativePaths[0];
    expect(altPath).toHaveLength(1);
    expect((altPath[0].resultState as S).n).toBe(1);
  });
});

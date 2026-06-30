/**
 * Phase 1 — compile-time shape tests for api/ai/planner_search_types.ts.
 * There is no runtime logic to test; these assertions prove the exported
 * interfaces are structurally correct and that SearchStrategy is usable
 * without importing ConstraintModel.
 */

import type {
  SearchDeps,
  CandidateRecord,
  DepthRecord,
  BeamSearchMeta,
  TerminationReason,
  SearchResult,
  SearchStrategy,
} from '../../api/ai/planner_search_types';

// ── simple concrete types used as stand-ins ───────────────────────────────────

type S = { value: number };
type A = { delta: number };

// ── SearchDeps shape ──────────────────────────────────────────────────────────

const deps: SearchDeps<S, A> = {
  generateActions: (s: S): A[] => [{ delta: s.value }],
  applyMutation:   (s: S, a: A): S => ({ value: s.value + a.delta }),
  validate:        (_s: S): boolean => true,
  score:           (_s: S): number[] => [0],
  compareScore:    (a: number[], b: number[]): number => a[0] - b[0],
  isGoal:          (s: S): boolean => s.value >= 10,
};

// ── TerminationReason is one of the three literals ───────────────────────────

const r1: TerminationReason = 'goal_reached';
const r2: TerminationReason = 'max_steps';
const r3: TerminationReason = 'no_legal_expansion';

// ── CandidateRecord shape ─────────────────────────────────────────────────────

const accepted: CandidateRecord = {
  action: { delta: 1 },
  resultState: { value: 1 },
  score: [1],
  rejected: false,
};

const rejected: CandidateRecord = {
  action: { delta: 0 },
  resultState: { value: 0 },
  score: [0],
  rejected: true,
  rejectReason: 'validation_failed',
};

const pruned: CandidateRecord = {
  action: { delta: 0 },
  resultState: { value: 0 },
  score: [0],
  rejected: true,
  rejectReason: 'pruned_by_beam',
};

const duplicate: CandidateRecord = {
  action: { delta: 0 },
  resultState: { value: 0 },
  score: [0],
  rejected: true,
  rejectReason: 'duplicate',
};

// ── DepthRecord shape ─────────────────────────────────────────────────────────

const depthRecord: DepthRecord = {
  depth: 0,
  candidates: [accepted, rejected],
  survivors: [{ value: 1 }],
};

// ── BeamSearchMeta shape ──────────────────────────────────────────────────────

const meta: BeamSearchMeta = {
  beamWidth: 6,
  depthRecords: [depthRecord],
  chosenPath: [{ delta: 1 }],
  terminationReason: 'goal_reached',
  alternativePaths: [[{ delta: 2 }]],
};

// ── SearchResult with and without meta ───────────────────────────────────────

const withMeta: SearchResult<S> = {
  finalState: { value: 10 },
  meta,
};

const withoutMeta: SearchResult<S> = {
  finalState: { value: 10 },
};

// ── SearchStrategy interface — implemented inline ─────────────────────────────

const strategy: SearchStrategy<S, A> = {
  explore(
    initialState: S,
    deps: SearchDeps<S, A>,
    opts: { maxSteps: number; width?: number }
  ): SearchResult<S> {
    let state = initialState;
    for (let step = 0; step < opts.maxSteps; step++) {
      const actions = deps.generateActions(state);
      if (actions.length === 0) break;
      state = deps.applyMutation(state, actions[0]);
      if (deps.isGoal(state)) break;
    }
    return { finalState: state };
  },
};

// ── Runtime sanity check (not a type test) ───────────────────────────────────

describe('planner_search_types — shape conformance', () => {
  test('SearchDeps closures operate on generic state without ConstraintModel', () => {
    const initial: S = { value: 0 };
    const actions = deps.generateActions(initial);
    expect(actions).toEqual([{ delta: 0 }]);
    const next = deps.applyMutation(initial, actions[0]);
    expect(next).toEqual({ value: 0 });
    expect(deps.validate(next)).toBe(true);
    expect(deps.score(next)).toEqual([0]);
    expect(deps.isGoal(next)).toBe(false);
    expect(deps.isGoal({ value: 10 })).toBe(true);
  });

  test('SearchStrategy.explore produces a SearchResult', () => {
    const result = strategy.explore({ value: 0 }, deps, { maxSteps: 20, width: 6 });
    expect(result).toHaveProperty('finalState');
    expect(typeof result.finalState.value).toBe('number');
  });

  test('TerminationReason values are the three expected literals', () => {
    const reasons: TerminationReason[] = ['goal_reached', 'max_steps', 'no_legal_expansion'];
    expect(reasons).toHaveLength(3);
  });

  test('CandidateRecord rejectReason is optional', () => {
    expect(accepted.rejectReason).toBeUndefined();
    expect(rejected.rejectReason).toBe('validation_failed');
    expect(pruned.rejectReason).toBe('pruned_by_beam');
    expect(duplicate.rejectReason).toBe('duplicate');
  });

  test('BeamSearchMeta has expected shape', () => {
    expect(meta.beamWidth).toBe(6);
    expect(meta.depthRecords).toHaveLength(1);
    expect(meta.chosenPath).toHaveLength(1);
    expect(meta.terminationReason).toBe('goal_reached');
    expect(meta.alternativePaths).toHaveLength(1);
  });

  test('SearchResult meta is optional', () => {
    expect(withMeta.meta).toBeDefined();
    expect(withoutMeta.meta).toBeUndefined();
  });
});

// Suppress unused-variable TS errors for the pure type-assignment lines above.
void deps; void r1; void r2; void r3;
void accepted; void rejected; void pruned; void duplicate;
void depthRecord; void meta; void withMeta; void withoutMeta; void strategy;

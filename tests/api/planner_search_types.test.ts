/**
 * Phase 1 — compile-time shape tests for api/ai/planner_search_types.ts.
 * There is no runtime logic to test; these assertions prove the exported
 * interfaces are structurally correct and that SearchStrategy is usable
 * without importing ConstraintModel.
 *
 * Phase 1.1 additions:
 *   - validate returns { valid, reason? } — not boolean
 *   - PathStep typed elements in chosenPath / alternativePaths
 *   - validationReason on CandidateRecord
 */

import type {
  SearchDeps,
  CandidateRecord,
  DepthRecord,
  BeamSearchMeta,
  TerminationReason,
  SearchResult,
  SearchStrategy,
  PathStep,
} from '../../api/ai/planner_search_types';

// ── simple concrete types used as stand-ins ───────────────────────────────────

type S = { value: number };
type A = { delta: number };

// ── SearchDeps shape ──────────────────────────────────────────────────────────

const deps: SearchDeps<S, A> = {
  generateActions: (s: S): A[] => [{ delta: s.value }],
  applyMutation:   (s: S, a: A): S => ({ value: s.value + a.delta }),
  // Phase 1.1: validate returns structured result, not plain boolean
  validate:        (_s: S): { valid: boolean; reason?: string } => ({ valid: true }),
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

// Phase 1.1: validationReason present when rejectReason === 'validation_failed'
const rejectedWithDetail: CandidateRecord = {
  action: { delta: 0 },
  resultState: { value: 0 },
  score: [0],
  rejected: true,
  rejectReason: 'validation_failed',
  validationReason: 'semester overload',
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

// ── BeamSearchMeta shape — Phase 1.1: PathStep elements ──────────────────────

const meta: BeamSearchMeta = {
  beamWidth: 6,
  depthRecords: [depthRecord],
  // Phase 1.1: each element is { action, resultState }, not a bare action
  chosenPath: [{ action: { delta: 1 }, resultState: { value: 1 } }],
  terminationReason: 'goal_reached',
  alternativePaths: [[{ action: { delta: 2 }, resultState: { value: 2 } }]],
};

// Phase 1.1: typed PathStep access — proves chosenPath is PathStep[], not unknown[]
const chosenStep: PathStep = meta.chosenPath[0];
const altStep: PathStep = meta.alternativePaths[0][0];

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

// ── Runtime sanity checks ─────────────────────────────────────────────────────

describe('planner_search_types — shape conformance', () => {
  test('SearchDeps closures operate on generic state without ConstraintModel', () => {
    const initial: S = { value: 0 };
    const actions = deps.generateActions(initial);
    expect(actions).toEqual([{ delta: 0 }]);
    const next = deps.applyMutation(initial, actions[0]);
    expect(next).toEqual({ value: 0 });
    // Phase 1.1: validate returns { valid, reason? }
    expect(deps.validate(next)).toEqual({ valid: true });
    expect(deps.validate(next).valid).toBe(true);
    expect(deps.validate(next).reason).toBeUndefined();
    expect(deps.score(next)).toEqual([0]);
    expect(deps.isGoal(next)).toBe(false);
    expect(deps.isGoal({ value: 10 })).toBe(true);
  });

  test('validate can carry a rejection reason', () => {
    const rejectingDeps: SearchDeps<S, A> = {
      ...deps,
      validate: (_s: S) => ({ valid: false, reason: 'semester overloaded' }),
    };
    const result = rejectingDeps.validate({ value: 0 });
    expect(result.valid).toBe(false);
    expect(result.reason).toBe('semester overloaded');
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

  test('CandidateRecord validationReason is optional and present on validation failures', () => {
    expect(rejectedWithDetail.validationReason).toBe('semester overload');
    expect(accepted.validationReason).toBeUndefined();
    expect(rejected.validationReason).toBeUndefined(); // rejectReason present, but no detail
  });

  test('BeamSearchMeta has expected shape with typed PathStep elements', () => {
    expect(meta.beamWidth).toBe(6);
    expect(meta.depthRecords).toHaveLength(1);
    expect(meta.chosenPath).toHaveLength(1);
    // Phase 1.1: elements are { action, resultState } pairs
    expect(meta.chosenPath[0].action).toBeDefined();
    expect(meta.chosenPath[0].resultState).toBeDefined();
    expect(meta.terminationReason).toBe('goal_reached');
    expect(meta.alternativePaths).toHaveLength(1);
    expect(meta.alternativePaths[0][0].action).toBeDefined();
    expect(meta.alternativePaths[0][0].resultState).toBeDefined();
  });

  test('PathStep typed access: chosenPath elements are PathStep, not unknown', () => {
    expect(chosenStep.action).toBeDefined();
    expect(chosenStep.resultState).toBeDefined();
    expect(altStep.action).toBeDefined();
    expect(altStep.resultState).toBeDefined();
  });

  test('SearchResult meta is optional', () => {
    expect(withMeta.meta).toBeDefined();
    expect(withoutMeta.meta).toBeUndefined();
  });
});

// Suppress unused-variable TS errors for the pure type-assignment lines above.
void deps; void r1; void r2; void r3;
void accepted; void rejected; void rejectedWithDetail; void pruned; void duplicate;
void depthRecord; void meta; void withMeta; void withoutMeta; void strategy;
void chosenStep; void altStep;

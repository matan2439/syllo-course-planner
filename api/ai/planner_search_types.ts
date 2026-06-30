/**
 * Phase 1 — SearchStrategy interface and supporting types.
 *
 * Design invariants (from roadmap-v2.md Section 2, Design Invariants):
 *   1. SearchStrategy never imports ConstraintModel. It operates exclusively
 *      through SearchDeps closures.
 *   2. SearchResult.meta (BeamSearchMeta) is the primary debugging mechanism.
 *   3. diffToTrace is a fallback only — used when meta is absent.
 *
 * No runtime logic lives here. Types only.
 */

// ── Dependency injection — the only surface a SearchStrategy sees ─────────────

/**
 * Closed-over functions injected by PlannerAgent. SearchStrategy never
 * imports ConstraintModel; it reasons about states through these closures.
 */
export interface SearchDeps<S, A> {
  generateActions: (state: S) => A[];
  applyMutation:   (state: S, action: A) => S;
  validate:        (state: S) => boolean;
  score:           (state: S) => number[];
  compareScore:    (a: number[], b: number[]) => number;
  isGoal:          (state: S) => boolean;
}

// ── Per-step debug record ─────────────────────────────────────────────────────

export interface CandidateRecord {
  action: unknown;
  resultState: unknown;
  score: number[];
  rejected: boolean;
  /** Present only when rejected === true. */
  rejectReason?: 'validation_failed' | 'pruned_by_beam' | 'duplicate';
}

export interface DepthRecord {
  depth: number;
  candidates: CandidateRecord[];
  /** States that survived into the next depth (beam survivors). */
  survivors: unknown[];
}

// ── Termination ───────────────────────────────────────────────────────────────

export type TerminationReason =
  | 'goal_reached'
  | 'max_steps'
  | 'no_legal_expansion';

// ── BeamSearchMeta — primary debug/trace record for BeamSearchStrategy ────────

export interface BeamSearchMeta {
  beamWidth: number;
  depthRecords: DepthRecord[];
  /** The action sequence of the best terminal state. Primary trace source. */
  chosenPath: unknown[];
  terminationReason: TerminationReason;
  /** Unchosen legal terminal paths (up to beamWidth - 1). */
  alternativePaths: unknown[][];
}

// ── Search result ─────────────────────────────────────────────────────────────

export interface SearchResult<S> {
  finalState: S;
  /** Present for BeamSearchStrategy; absent for future CP-SAT or other strategies. */
  meta?: BeamSearchMeta;
}

// ── Strategy interface ────────────────────────────────────────────────────────

export interface SearchStrategy<S, A> {
  explore(
    initialState: S,
    deps: SearchDeps<S, A>,
    opts: { maxSteps: number; width?: number }
  ): SearchResult<S>;
}

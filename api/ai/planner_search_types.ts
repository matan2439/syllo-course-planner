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
 *
 * Phase 1.1 refinements:
 *   - validate returns { valid, reason? } so rejection details survive into CandidateRecord
 *   - PathStep carries (action, resultState) pairs; chosenPath / alternativePaths use PathStep[]
 *   - CandidateRecord gains optional validationReason for validation_failed rejections
 */

// ── Dependency injection — the only surface a SearchStrategy sees ─────────────

/**
 * Closed-over functions injected by PlannerAgent. SearchStrategy never
 * imports ConstraintModel; it reasons about states through these closures.
 */
export interface SearchDeps<S, A> {
  generateActions: (state: S) => A[];
  applyMutation:   (state: S, action: A) => S;
  /** Returns { valid, reason? } so BeamSearch can record why a state was rejected. */
  validate:        (state: S) => { valid: boolean; reason?: string };
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
  /** Validation error detail — only present when rejectReason === 'validation_failed'. */
  validationReason?: string;
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

// ── PathStep — one step in a beam path (action + resulting state) ─────────────

/**
 * A single step in the chosen or alternative paths stored in BeamSearchMeta.
 * Carrying the resultState alongside the action lets PlannerAgent build the
 * trace without replaying the action sequence through applyMutation.
 */
export interface PathStep {
  action: unknown;
  resultState: unknown;
}

// ── BeamSearchMeta — primary debug/trace record for BeamSearchStrategy ────────

export interface BeamSearchMeta {
  beamWidth: number;
  depthRecords: DepthRecord[];
  /** The winning path as (action, resultState) pairs. Primary trace source. */
  chosenPath: PathStep[];
  terminationReason: TerminationReason;
  /** Unchosen legal terminal paths (up to beamWidth - 1). */
  alternativePaths: PathStep[][];
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

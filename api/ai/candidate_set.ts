/**
 * candidate_set.ts — Slice 17B: retain genuinely distinct, validated, deterministic
 * alternatives produced by the SAME stable planning engine under different
 * semester-distribution policies. No Simulation/Decision/Persistence capability,
 * no comparison UI, no second planner, no re-plan from emptyState (the caller
 * supplies the same starting state + model builder for every policy).
 *
 * Pipeline per policy: build the same model with only distributionPolicy differing
 * → run the SAME PlannerWorker → validate with the EXISTING validator
 * (validatePlanState) → normalize academic identity (course→period, order-invariant)
 * → deduplicate → summarize real differences → deterministic id from the normalized
 * identity (never array position / order / randomness / timestamps).
 */
import { PlannerWorker } from './planner_worker';
import { scorePlan } from './planner_goals';
import { validatePlanState } from './planner_validate';
import { placedCourseIds, type ConstraintModel, type PlanState, type DistributionPolicy } from './planner_types';

export interface DiffFact {
  kind: 'peak_load' | 'spread' | 'active_periods' | 'course_moved';
  balanced?: number | string;
  compact?: number | string;
  courseId?: string;
}

export interface PlanCandidate {
  /** Deterministic id derived from the normalized academic identity (+ namespace). */
  id: string;
  policy: DistributionPolicy;
  state: PlanState;
  valid: boolean;
  validationErrors: string[];
  scoreVector: number[];
  /** Canonical course→period identity (sorted, order-invariant). */
  normalizedIdentity: string;
  profileVersion: number;
  /** The stable planner's own Hebrew explanation for this plan (worker.explain().summary_he). */
  rationaleHe: string;
  /** Populated on the surviving candidate when other policies converged to it. */
  convergedPolicies?: DistributionPolicy[];
}

export interface CandidateSet {
  candidates: PlanCandidate[];
  /** True when every attempted policy normalized to the same plan (no meaningful alternative). */
  converged: boolean;
  /** Factual differences between the distinct candidates (empty when converged). */
  differenceSummary: DiffFact[];
  /**
   * Canonical identity of the LEGACY stable-planner result (the flag-off /
   * 'neutral' run) — the reference neutral selection matches, independent of
   * candidate array/generation order.
   */
  legacyIdentity: string;
  /** The raw legacy/neutral PlanState — proposal fallback when no candidate is valid. */
  legacyState: PlanState;
}

export type SelectionReason = 'confirmed_balanced' | 'confirmed_compact' | 'legacy_default';

// ── canonical identity ────────────────────────────────────────────────────────

/** Course→period map, sorted by course id — invariant to insertion/display order. */
function normalizeIdentity(state: PlanState): string {
  const pairs: Array<[string, string]> = [];
  for (const [period, ids] of Object.entries(state.semesters)) {
    for (const id of ids) pairs.push([id, period]);
  }
  pairs.sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : a[1] < b[1] ? -1 : 1));
  return JSON.stringify(pairs);
}

/** Small deterministic string hash (FNV-1a) — stable across runs, no randomness. */
function hashId(s: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return 'cand_' + (h >>> 0).toString(16).padStart(8, '0');
}

function loads(state: PlanState, model: ConstraintModel): number[] {
  return model.knownSemesterIds.map((s) =>
    (state.semesters[s] ?? []).reduce((h, id) => h + (model.profiles.get(id)?.hours ?? 0), 0),
  );
}
function peak(ls: number[]): number { return ls.length ? Math.max(...ls) : 0; }
function activePeriods(ls: number[]): number { return ls.filter((h) => h > 0).length; }
function spreadOf(ls: number[]): number {
  const active = ls.filter((h) => h > 0);
  return active.length > 1 ? Math.max(...active) - Math.min(...active) : 0;
}

// ── generation ────────────────────────────────────────────────────────────────

const DEFAULT_POLICIES: DistributionPolicy[] = ['balanced', 'compact'];

export function generateCandidateSet(input: {
  /** Builds the SAME model for every policy — only distributionPolicy differs. */
  buildModel: (policy: DistributionPolicy) => ConstraintModel;
  initialState: PlanState;
  profileVersion: number;
  policies?: DistributionPolicy[];
  pinnedHome?: Record<string, string>;
}): CandidateSet {
  const policies = input.policies ?? DEFAULT_POLICIES;

  const runPolicy = (policy: DistributionPolicy) => {
    const model = input.buildModel(policy);
    const worker = new PlannerWorker(model, structuredClone(input.initialState), { topN: 6, rolloutSteps: 80 });
    worker.run(500, 'greedy');
    const state = worker.getPlan();
    return { policy, model, state, validation: validatePlanState(state, model, input.pinnedHome ?? {}), identity: normalizeIdentity(state), scoreVector: scorePlan(state, model), rationaleHe: worker.explain().summary_he };
  };

  // Canonical LEGACY reference — the flag-off / 'neutral' stable-planner result.
  // Neutral selection matches THIS identity, never candidate/generation order.
  const legacyRun = runPolicy('neutral');
  const legacyIdentity = legacyRun.identity;

  // Run the SAME engine per requested policy (deterministic worker config).
  const raw = policies.map(runPolicy);

  // Retain only candidates that pass the EXISTING authoritative validator.
  const valid = raw.filter((r) => r.validation.valid);

  // Deduplicate by normalized identity; record convergence.
  const byIdentity = new Map<string, PlanCandidate>();
  for (const r of valid) {
    const existing = byIdentity.get(r.identity);
    if (existing) {
      existing.convergedPolicies = [...(existing.convergedPolicies ?? [existing.policy]), r.policy];
      continue;
    }
    byIdentity.set(r.identity, {
      id: hashId(r.identity),
      policy: r.policy,
      state: r.state,
      valid: true,
      validationErrors: r.validation.errors,
      scoreVector: r.scoreVector,
      normalizedIdentity: r.identity,
      profileVersion: input.profileVersion,
      rationaleHe: r.rationaleHe,
    });
  }
  const candidates = [...byIdentity.values()];
  const converged = candidates.length <= 1 && valid.length > 1;

  // Difference summary — only when two distinct candidates exist.
  let differenceSummary: DiffFact[] = [];
  if (candidates.length === 2) {
    const bal = valid.find((r) => r.policy === 'balanced');
    const com = valid.find((r) => r.policy === 'compact');
    if (bal && com) {
      const lb = loads(bal.state, bal.model);
      const lc = loads(com.state, com.model);
      const facts: DiffFact[] = [
        { kind: 'peak_load', balanced: peak(lb), compact: peak(lc) },
        { kind: 'spread', balanced: spreadOf(lb), compact: spreadOf(lc) },
        { kind: 'active_periods', balanced: activePeriods(lb), compact: activePeriods(lc) },
      ];
      differenceSummary = facts.filter((f) => f.balanced !== f.compact);
    }
  }

  return { candidates, converged, differenceSummary, legacyIdentity, legacyState: legacyRun.state };
}

/**
 * Deterministic selection. A confirmed balanced/compact preference selects the
 * matching validated candidate. Neutral/indifferent (no confirmed distribution
 * preference) selects the candidate whose normalized plan equals the LEGACY
 * stable-planner result — matched by identity, NOT array/generation order — so
 * it can never silently mean "balanced-first". Never assumes an unconfirmed policy.
 */
export function selectCandidate(set: CandidateSet, preference: DistributionPolicy): PlanCandidate | undefined {
  if (set.candidates.length === 0) return undefined;
  if (preference === 'balanced' || preference === 'compact') {
    return set.candidates.find((c) => c.policy === preference || c.convergedPolicies?.includes(preference)) ?? set.candidates[0];
  }
  // neutral / indifferent → the canonical legacy result (order-independent).
  return set.candidates.find((c) => c.normalizedIdentity === set.legacyIdentity) ?? set.candidates[0];
}

/** Truthful selection reason — a confirmed policy, or the legacy/default (never preference-derived for neutral). */
export function selectionReason(_set: CandidateSet, preference: DistributionPolicy): SelectionReason {
  if (preference === 'balanced') return 'confirmed_balanced';
  if (preference === 'compact') return 'confirmed_compact';
  return 'legacy_default';
}

/**
 * Ask the single balance question ONLY when the answer could change the selected
 * plan: at least two distinct legal candidates whose difference is material, and
 * the topic is not already answered/indifferent. Never ask on convergence.
 */
export function shouldAskBalanceQuestion(set: CandidateSet, opts: { alreadyAnswered: boolean }): boolean {
  if (opts.alreadyAnswered) return false;
  if (set.converged) return false;
  if (set.candidates.length < 2) return false;
  return set.differenceSummary.length > 0;
}

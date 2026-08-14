/**
 * candidate_set.ts — Slice 18B: retain multiple genuinely distinct, validated,
 * deterministic COURSE/PERIOD COMBINATIONS produced by the SAME stable planner
 * under ONE fixed user policy.
 *
 * Product policy this file implements (binding):
 *   1. `balanced` / `compact` / `neutral` CONFIGURE scoring and search — they are
 *      never the alternatives shown to the user. One confirmed profile resolves
 *      to one fixed planning policy, and every candidate for a request uses that
 *      same policy, the same hard constraints, the same catalog and the same
 *      academic rules.
 *   2. Candidate diversity therefore comes from different LEGAL course/period
 *      combinations inside that one fixed problem — never from swapping the
 *      user's stated policy.
 *   3. The balanced-vs-compact dual run survives ONLY as an internal ELICITATION
 *      probe (`probeBalanceImpact`), used to decide whether asking the
 *      `semester_balance` question could still change the plan. It retains no
 *      candidates and is never a user-facing alternative set.
 *
 * ── Search mechanism (why this one) ──────────────────────────────────────────
 * The repository already has exactly one stable planner (`PlannerWorker`, the
 * Observe→Reason→Act→Validate loop) and exactly one place where a single winner
 * is chosen: `step()` commits the FIRST action, among the already-legal,
 * already-validated, already-ranked candidates, that advances the plan. Every
 * other action at that step was legal and merely lost the ranking.
 *
 * So the smallest mechanism that can retain more than the single greedy winner
 * is a BOUNDED DETERMINISTIC DEVIATION: re-run the same planner with
 * `deviation: { atStep, rank }`, which commits the rank-th advancing action at
 * exactly one step and then continues greedily. No second planner, no random
 * variation, no paid provider, no re-plan from a different starting state, and
 * the run count is bounded by `maxRuns` up front.
 *
 * (A beam-search strategy also exists — `planner_search_beam.ts` — but it drives
 * the separate `PlannerAgent` path, not the production `PlannerWorker` used by
 * `generate-plan.ts`. Retaining its beam survivors would have meant switching
 * production planning engines, which is precisely what "do not create a second
 * planner" rules out.)
 *
 * ── Meaningful-distance rule (documented) ────────────────────────────────────
 * Two candidates are meaningfully different IFF their NORMALIZED ACADEMIC
 * IDENTITY differs. That identity is the set of (course_id → period) pairs,
 * sorted by course id — so it is invariant to object key order, array order,
 * equivalent section ordering, candidate ids, explanation text, and generation
 * order. It captures exactly the differences product policy calls meaningful
 * (elective/content composition, semester assignment, and thus workload
 * distribution). Because every candidate shares ONE resolved policy, "balanced
 * vs compact" can no longer appear as a difference at all.
 *
 * ── Ranking ──────────────────────────────────────────────────────────────────
 * Hard constraints and legality are a RETENTION GATE, not score terms: a plan is
 * only ever admitted to the set after `validateCandidate` (degree completion,
 * mandatory courses, categories, prerequisites, load caps, `must_exclude`, and
 * `must_include`) passes. Retained candidates are then ordered by the existing
 * lexicographic `scorePlan` vector — degree completion, requirements, legality,
 * the confirmed distribution preference, soft interests, difficulty — with the
 * normalized identity as a stable final tie-break. The primary recommendation is
 * simply rank 0. No claim of global optimality is made or implied: this is a
 * bounded deterministic search, not a proof.
 */
import { PlannerWorker } from './planner_worker';
import { scorePlan, compareScore } from './planner_goals';
import { validateCandidate } from './planner_validate';
import { placedCourseIds, type ConstraintModel, type PlanState, type DistributionPolicy } from './planner_types';
import {
  scoreCandidateOnObjective,
  type TopicIndex,
  type FeatureIndex,
  type GroundedObjective,
  type GroundedScore,
} from './grounded_objectives';

/** Production worker configuration — identical to generate-plan.ts's own. */
const WORKER_OPTS = { topN: 6, rolloutSteps: 80 } as const;

/** Bounded search defaults. Deliberately small: candidate count, not runtime, is the product need. */
export const DEFAULT_MAX_CANDIDATES = 3;
export const DEFAULT_MAX_RUNS = 8;

// ── difference facts ─────────────────────────────────────────────────────────

/** A factual, plan-derived difference between a candidate and the primary. */
export interface CandidateDifference {
  kind: 'course_added' | 'course_removed' | 'course_moved' | 'peak_load' | 'active_periods';
  courseId?: string;
  /** Value in the primary candidate. */
  primary?: number | string;
  /** Value in this candidate. */
  candidate?: number | string;
}

/** Legacy balanced-vs-compact fact — used ONLY by the elicitation probe. */
export interface DiffFact {
  kind: 'peak_load' | 'spread' | 'active_periods' | 'course_moved';
  balanced?: number | string;
  compact?: number | string;
  courseId?: string;
}

// ── candidate ────────────────────────────────────────────────────────────────

export interface PlanCandidate {
  /** Deterministic id derived from the normalized academic identity (never array position). */
  id: string;
  /** The ONE resolved user policy — identical on every candidate in a set. */
  policy: DistributionPolicy;
  state: PlanState;
  /** Always true: only candidates passing the authoritative validator are retained. */
  valid: boolean;
  validationErrors: string[];
  scoreVector: number[];
  /** Canonical course→period identity (sorted, order-invariant). */
  normalizedIdentity: string;
  /** 0-based position after ranking. 0 = the primary recommendation. */
  rank: number;
  /** How this combination was reached — deterministic provenance, not a label. */
  provenance: string;
  /** Factual differences against the primary. Empty on the primary itself. */
  differences: CandidateDifference[];
  profileVersion: number;
  /** The stable planner's own Hebrew explanation for this plan. */
  rationaleHe: string;
  /**
   * K4 — the confirmed grounded soft objective's evidence-backed score for this
   * candidate. Present only when such an objective was supplied; absent
   * otherwise, so the legacy ordering is untouched.
   */
  groundedScore?: GroundedScore;
}

export interface CandidateSet {
  /** The single resolved policy every candidate was planned under. */
  policy: DistributionPolicy;
  /** Ranked, deduplicated, fully validated. Empty ⇒ no legal solution was found. */
  candidates: PlanCandidate[];
  outcome: 'proposal' | 'infeasible';
  /** False whenever no candidate survived the authoritative validator. */
  applyEligible: boolean;
  /** Canonical identity of the plain greedy (no-deviation) run under this policy. */
  legacyIdentity: string;
  /** The raw greedy PlanState — the proposal fallback when nothing validates. */
  legacyState: PlanState;
  /** What the bounded search was actually allowed to do. */
  searchBudget: { maxCandidates: number; maxRuns: number; runsExecuted: number };
}

export type SelectionReason = 'confirmed_balanced' | 'confirmed_compact' | 'legacy_default';

// ── canonical identity ───────────────────────────────────────────────────────

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

/** Period of each placed course — the comparison basis for `course_moved`. */
function periodByCourse(state: PlanState): Map<string, string> {
  const out = new Map<string, string>();
  for (const [period, ids] of Object.entries(state.semesters)) for (const id of ids) out.set(id, period);
  return out;
}

/**
 * Factual differences of `candidate` against `primary`: which courses were
 * swapped in/out, which moved period, and the resulting load shape. Derived
 * entirely from the two plan states, so a summary can never describe a
 * difference the plans do not actually have.
 */
function describeDifferences(primary: PlanState, candidate: PlanState, model: ConstraintModel): CandidateDifference[] {
  const a = periodByCourse(primary);
  const b = periodByCourse(candidate);
  const out: CandidateDifference[] = [];

  for (const id of [...b.keys()].sort()) {
    if (!a.has(id)) out.push({ kind: 'course_added', courseId: id, candidate: b.get(id) });
    else if (a.get(id) !== b.get(id)) out.push({ kind: 'course_moved', courseId: id, primary: a.get(id), candidate: b.get(id) });
  }
  for (const id of [...a.keys()].sort()) {
    if (!b.has(id)) out.push({ kind: 'course_removed', courseId: id, primary: a.get(id) });
  }

  const la = loads(primary, model);
  const lb = loads(candidate, model);
  if (peak(la) !== peak(lb)) out.push({ kind: 'peak_load', primary: peak(la), candidate: peak(lb) });
  if (activePeriods(la) !== activePeriods(lb)) {
    out.push({ kind: 'active_periods', primary: activePeriods(la), candidate: activePeriods(lb) });
  }
  return out;
}

// ── generation ───────────────────────────────────────────────────────────────

export interface GenerateCandidateSetInput {
  /**
   * Builds the model for THIS request. Called once per run and must be
   * deterministic — every run must see the same catalog, academic rules, hard
   * constraints, workload limits and distribution policy.
   */
  buildModel: (policy: DistributionPolicy) => ConstraintModel;
  /** The single resolved user policy. */
  policy: DistributionPolicy;
  initialState: PlanState;
  profileVersion: number;
  pinnedHome?: Record<string, string>;
  /** How many distinct combinations to retain. Default DEFAULT_MAX_CANDIDATES. */
  maxCandidates?: number;
  /** Hard bound on planner runs (runtime guard). Default DEFAULT_MAX_RUNS. */
  maxRuns?: number;
  /**
   * K4 — a CONFIRMED grounded soft objective, plus the ONE evidence snapshot
   * every candidate is scored against. Omitted (the default) ⇒ ranking is
   * byte-identical to before this feature existed.
   */
  groundedObjective?: {
    objective: GroundedObjective;
    features: FeatureIndex;
    /**
     * T4 — course-level supported topics from the SAME snapshot. Required only
     * by `prefer_topic_alignment`; omitted, that objective scores zero for every
     * candidate and ranking is unchanged.
     */
    topics?: TopicIndex;
  };
}

/**
 * How far into the lexicographic scoreVector the HARD/legality/distribution
 * terms run: [g1 completion, g2a mandatory+must_include, g2b categories,
 * g3 legality, g4a/g4b distribution]. Everything from index 6 on is soft
 * (preferences, interest fit, difficulty). The grounded objective is compared
 * strictly AFTER this prefix and strictly BEFORE the soft remainder, which is
 * what makes it unable to trade away completion, legality, hard constraints or
 * the user's confirmed distribution policy.
 */
const HARD_AND_POLICY_PREFIX = 6;

export function generateCandidateSet(input: GenerateCandidateSetInput): CandidateSet {
  const maxCandidates = Math.max(1, input.maxCandidates ?? DEFAULT_MAX_CANDIDATES);
  const maxRuns = Math.max(1, input.maxRuns ?? DEFAULT_MAX_RUNS);
  const pinnedHome = input.pinnedHome ?? {};

  const run = (deviation?: { atStep: number; rank: number }) => {
    const model = input.buildModel(input.policy);
    const worker = new PlannerWorker(model, structuredClone(input.initialState), {
      ...WORKER_OPTS,
      ...(deviation ? { deviation } : {}),
    });
    worker.run(500, 'greedy');
    const state = worker.getPlan();
    return {
      model,
      state,
      // The AUTHORITATIVE gate: completion + legality + mandatory + categories +
      // must_exclude + must_include. A candidate that fails is never retained —
      // a degraded plan is not an alternative.
      report: validateCandidate(state, model, pinnedHome),
      identity: normalizeIdentity(state),
      scoreVector: scorePlan(state, model),
      rationaleHe: worker.explain().summary_he,
      provenance: deviation ? `deviation:${deviation.atStep}:${deviation.rank}` : 'greedy_baseline',
    };
  };

  // 1. The plain greedy run under the resolved policy — the legacy single-plan
  //    result, and the proposal fallback if nothing validates.
  const baseline = run();
  let runsExecuted = 1;

  type Raw = ReturnType<typeof run>;
  const byIdentity = new Map<string, Raw>();
  if (baseline.report.valid) byIdentity.set(baseline.identity, baseline);

  // 2. Bounded deterministic deviations. Deviating EARLY changes which course
  //    enters the plan first and so reshapes the whole combination; deviating at
  //    increasing depths reaches progressively more of the space. Fixed order ⇒
  //    identical candidates, ids and ranking on every run.
  for (let atStep = 0; runsExecuted < maxRuns && byIdentity.size < maxCandidates; atStep++) {
    const r = run({ atStep, rank: 1 });
    runsExecuted++;
    if (r.report.valid && !byIdentity.has(r.identity)) byIdentity.set(r.identity, r);
    // ponytail: no early-exit heuristic — maxRuns already bounds this, and a
    // deviation that reproduces the baseline is simply collapsed by identity.
  }

  // 3. Rank. Lexicographic, in the documented priority order:
  //      a. hard constraints + legality + the confirmed distribution policy
  //         (the scoreVector's first HARD_AND_POLICY_PREFIX terms);
  //      b. the confirmed GROUNDED soft objective (K4), when one is supplied;
  //      c. the remaining existing soft terms (explicit preferences, interest
  //         fit, difficulty);
  //      d. normalized identity — a stable, deterministic final tie-break.
  //    With no grounded objective, (b) is a constant 0 for every candidate and
  //    the ordering is byte-identical to the legacy comparison.
  const grounded = input.groundedObjective;
  const groundedScoreOf = (r: Raw): GroundedScore | undefined =>
    grounded
      ? scoreCandidateOnObjective([...new Set(placedCourseIds(r.state))], grounded.objective, grounded.features, grounded.topics)
      : undefined;

  const withGrounded = [...byIdentity.values()].map((r) => ({ raw: r, grounded: groundedScoreOf(r) }));

  const ranked = withGrounded
    .sort((a, b) =>
      compareScore(b.raw.scoreVector.slice(0, HARD_AND_POLICY_PREFIX), a.raw.scoreVector.slice(0, HARD_AND_POLICY_PREFIX)) ||
      ((b.grounded?.score ?? 0) - (a.grounded?.score ?? 0)) ||
      compareScore(b.raw.scoreVector, a.raw.scoreVector) ||
      (a.raw.identity < b.raw.identity ? -1 : a.raw.identity > b.raw.identity ? 1 : 0),
    )
    .slice(0, maxCandidates)
    .map((x) => ({ ...x.raw, groundedScore: x.grounded }));

  const primary = ranked[0];
  const candidates: PlanCandidate[] = ranked.map((r, i) => ({
    id: hashId(r.identity),
    policy: input.policy,
    state: r.state,
    valid: true,
    validationErrors: r.report.errors,
    scoreVector: r.scoreVector,
    normalizedIdentity: r.identity,
    rank: i,
    provenance: r.provenance,
    differences: i === 0 ? [] : describeDifferences(primary.state, r.state, r.model),
    profileVersion: input.profileVersion,
    rationaleHe: r.rationaleHe,
    ...(r.groundedScore !== undefined ? { groundedScore: r.groundedScore } : {}),
  }));

  return {
    policy: input.policy,
    candidates,
    outcome: candidates.length ? 'proposal' : 'infeasible',
    applyEligible: candidates.length > 0,
    legacyIdentity: baseline.identity,
    legacyState: baseline.state,
    searchBudget: { maxCandidates, maxRuns, runsExecuted },
  };
}

/**
 * The primary recommendation: the highest-ranked retained candidate. The user's
 * policy was already applied to EVERY candidate during generation, so selection
 * no longer chooses between policies — it only reads rank 0.
 */
export function selectCandidate(set: CandidateSet): PlanCandidate | undefined {
  return set.candidates[0];
}

/** Truthful provenance of the policy the whole set was planned under. */
export function selectionReason(set: CandidateSet): SelectionReason {
  if (set.policy === 'balanced') return 'confirmed_balanced';
  if (set.policy === 'compact') return 'confirmed_compact';
  return 'legacy_default';
}

// ── elicitation probe ────────────────────────────────────────────────────────

export interface BalanceImpactProbe {
  /** True when balanced and compact would produce materially different legal plans. */
  materiallyDifferent: boolean;
  /** The factual differences behind that judgment. Empty when they converge. */
  differenceSummary: DiffFact[];
}

/**
 * INTERNAL elicitation only. Runs the same stable planner under `balanced` and
 * `compact` purely to answer "could the `semester_balance` answer still change
 * the plan?". It retains NO candidates and produces no user-facing alternative:
 * once the user has confirmed a policy, `generateCandidateSet` plans every
 * candidate under that one policy and the opposing plan is never kept.
 */
export function probeBalanceImpact(input: {
  buildModel: (policy: DistributionPolicy) => ConstraintModel;
  initialState: PlanState;
  pinnedHome?: Record<string, string>;
}): BalanceImpactProbe {
  const pinnedHome = input.pinnedHome ?? {};
  const runPolicy = (policy: DistributionPolicy) => {
    const model = input.buildModel(policy);
    const worker = new PlannerWorker(model, structuredClone(input.initialState), WORKER_OPTS);
    worker.run(500, 'greedy');
    const state = worker.getPlan();
    return { model, state, report: validateCandidate(state, model, pinnedHome), identity: normalizeIdentity(state) };
  };

  const bal = runPolicy('balanced');
  const com = runPolicy('compact');
  if (bal.identity === com.identity) return { materiallyDifferent: false, differenceSummary: [] };

  const lb = loads(bal.state, bal.model);
  const lc = loads(com.state, com.model);
  const differenceSummary = ([
    { kind: 'peak_load', balanced: peak(lb), compact: peak(lc) },
    { kind: 'spread', balanced: spreadOf(lb), compact: spreadOf(lc) },
    { kind: 'active_periods', balanced: activePeriods(lb), compact: activePeriods(lc) },
  ] as DiffFact[]).filter((f) => f.balanced !== f.compact);

  return { materiallyDifferent: differenceSummary.length > 0, differenceSummary };
}

/**
 * Ask the single balance question ONLY when the answer could change the plan:
 * the two policies produce materially different legal plans and the topic is not
 * already answered. Answering never generates a plan by itself — the caller
 * decides when to plan.
 */
export function shouldAskBalanceQuestion(probe: BalanceImpactProbe, opts: { alreadyAnswered: boolean }): boolean {
  if (opts.alreadyAnswered) return false;
  return probe.materiallyDifferent;
}

/** Course ids placed in a candidate — small helper for callers building lean summaries. */
export function candidateCourseIds(candidate: PlanCandidate): string[] {
  return [...new Set(placedCourseIds(candidate.state))].sort();
}

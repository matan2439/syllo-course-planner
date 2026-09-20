/**
 * PlannerWorker — the deterministic, goal-driven planning agent that OWNS the
 * planning process. It exposes deterministic tools (add/remove/move/replace),
 * validates after every mutation (rejecting + rolling back anything that
 * introduces a new error), and runs the Observe→Reason→Act→Validate loop.
 *
 * Reason weighs BOTH immediate goal-advancement and downstream impact: among
 * the legal candidate actions it forward-checks feasibility and re-ranks the top
 * ones by the best plan reachable from each (estimateFinalScore), so an action
 * that temporarily looks worse but leads to a better final schedule wins over a
 * myopic one. An Orchestrator (greedy or LLM) chooses among the worker's ranked
 * legal actions; the worker executes and validates each.
 *
 * Deterministic facts (hours, prerequisites, offering legality, category
 * satisfaction, degree completion) come only from the constraint model and the
 * reused validators — never from any LLM text.
 */

import {
  scorePlan,
  compareScore,
  applyMutation,
  degreeHours as computeDegreeHours,
  mandatoryPlaced as computeMandatoryPlaced,
  categoriesSatisfied as computeCategoriesSatisfied,
  incompleteAnnualCourseIds,
  missingMustIncludeCourseIds,
  GOAL_STACK,
} from './planner_goals';
import {
  enumerateActions,
  legalSemestersFor,
  bestLegalSemester,
  isExcluded,
  addCourseActionsFor,
} from './planner_actions';
import { validatePlanState, validateCandidate, buildValidationContext } from './planner_validate';
import type { PlanValidationContext } from './plan_validation';
import { projectFeasibility, estimateFinalScore } from './planner_lookahead';
import { PlannerTracer, type PlannerAction, type PlannerPhase } from './planner_trace';
import {
  type ConstraintModel,
  type PlanState,
  type PlannerMutation,
  emptyState,
  cloneState,
  placedCourseIds,
} from './planner_types';

export interface MutationResult {
  accepted: boolean;
  errorsIntroduced: string[];
  action: PlannerAction;
}

export interface PlanExplanation {
  summary_he: string;
  /** Which degree requirements the plan satisfies (hours / mandatory / categories). */
  requirements_he: string[];
  /** Per-semester placements. */
  placements_he: string[];
  /** Why courses were placed/moved where they were (incl. flexible A/B decisions). */
  decisions_he: string[];
  /** Why rejected alternatives were rejected. */
  rejections_he: string[];
  /** Why the planner stopped. */
  stop_he: string;
  /** Every course_id the explanation references — all drawn from the plan/trace. */
  referencedCourseIds: string[];
}

export interface WorkerObservation {
  phase: PlannerPhase;
  degreeHours: number;
  semesterLoads: Record<string, number>;
  mandatoryPlaced: number;
  categoriesSatisfied: number;
  allCategoriesSatisfied: boolean;
  errors: string[];
}

export interface WorkerOptions {
  /** Weigh downstream impact (forward-check + rollout) when ranking actions. */
  lookahead?: boolean;
  /** How many top immediate actions get a downstream rollout each step. */
  topN?: number;
  /** Rollout depth bound. */
  rolloutSteps?: number;
  /**
   * Request-scoped memo for deterministic rollout scores. Candidate deviation
   * workers revisit many identical states under the same immutable model;
   * sharing this map avoids recomputing those pure rollouts. Never share it
   * across different models or requests.
   */
  sharedLookaheadCache?: Map<string, number[]>;
  /**
   * Slice 18B — deterministic BOUNDED DEVIATION, the whole mechanism behind
   * multi-combination candidate generation. At scored-search step `atStep`, take
   * the action ranked `rank` places below the one the greedy loop would pick,
   * then continue greedily as usual. Same planner, same model, same policy, same
   * validation — only which of the already-legal, already-ranked actions is
   * committed at ONE step differs, which is what makes a genuinely different
   * (but equally legal) course/period combination reachable. Absent ⇒ the
   * legacy single-plan behavior, byte-identical.
   */
  deviation?: { atStep: number; rank: number };
}

type Actor = 'worker' | 'greedy' | 'llm';

const CONSTRAINTS_CHECKED = [
  'degree_hours',
  'category',
  'prerequisites',
  'semester_load',
  'offering',
  'disallowed',
];

/** Collapse a lexicographic score vector to a single number for trace display. */
function scoreScalar(vec: number[]): number {
  const weights = [1e6, 1e5, 1e4, 1e3, 1e2, 1];
  return vec.reduce((a, v, i) => a + v * (weights[i] ?? 1), 0);
}

interface ActionMeta {
  immediateScore?: number;
  estimatedFinalScore?: number;
  feasible?: boolean;
}

export class PlannerWorker {
  private state: PlanState;
  private tracer = new PlannerTracer();
  /** Committed positions of pinned courses (must not move). */
  private pinnedHome: Record<string, string> = {};
  private opts: Required<Omit<WorkerOptions, 'deviation' | 'sharedLookaheadCache'>> & Pick<WorkerOptions, 'deviation'>;
  /** How many scored-search decisions step() has made — the deviation index. */
  private searchStepIndex = 0;
  /** Cached validation context — pure function of (model, pinnedHome), built once. */
  private readonly _validationCtx: PlanValidationContext;
  private readonly _lookaheadCache: Map<string, number[]>;

  constructor(private model: ConstraintModel, initial?: PlanState, opts: WorkerOptions = {}) {
    this.state = initial ? cloneState(initial) : emptyState(model.knownSemesterIds);
    this.opts = {
      lookahead: opts.lookahead ?? true,
      topN: opts.topN ?? 8,
      rolloutSteps: opts.rolloutSteps ?? 200,
      ...(opts.deviation ? { deviation: opts.deviation } : {}),
    };
    this._lookaheadCache = opts.sharedLookaheadCache ?? new Map<string, number[]>();
    for (const cid of model.pinnedCourseIds) {
      const sem = this.semesterOfLocal(cid);
      if (sem) this.pinnedHome[cid] = sem;
    }
    this._validationCtx = buildValidationContext(model, this.pinnedHome);
  }

  // ── public read API ─────────────────────────────────────────────────────────

  getPlan(): PlanState {
    return this.state;
  }

  getTrace(): PlannerAction[] {
    return this.tracer.getTrace();
  }

  getModel(): ConstraintModel {
    return this.model;
  }

  /**
   * The id of a placed `is_annual` course that doesn't yet occupy every one
   * of its effective spans, if any — used both by goalStatus (so
   * isGoalReached/phase know the plan isn't actually done) and by step (to
   * force the repair). Delegates to planner_goals.ts's incompleteAnnualCourseIds
   * (the same shared signal TauPolicyProvider.isGoal uses for the agentic
   * path) so both agree on exactly what counts as an unfinished placement. A
   * course that's mandatory/category/wanted AND incomplete is already
   * covered by group 1-3's own `consider()` gate in enumerateActions; this
   * exists specifically because a plain-elective annual course has no other
   * mechanism that revisits it once degree hours are already met (see
   * enumerateActions' group 0).
   */
  private findIncompleteAnnualCourse(state: PlanState = this.state): string | undefined {
    return incompleteAnnualCourseIds(state, this.model)[0];
  }

  /** Pure rollout score, memoized by canonical academic placement identity. */
  private estimate(state: PlanState): number[] {
    const placement = Object.keys(state.semesters)
      .sort()
      .map((semesterId) => [semesterId, [...(state.semesters[semesterId] ?? [])].sort()] as const);
    const key = `${this.opts.rolloutSteps}:${JSON.stringify(placement)}`;
    const cached = this._lookaheadCache.get(key);
    if (cached) return cached;
    const score = estimateFinalScore(state, this.model, this.opts.rolloutSteps, this._validationCtx);
    this._lookaheadCache.set(key, score);
    return score;
  }

  /**
   * Raw goal status — no phase/validation, safe to call from isGoalReached.
   * Reuses planner_goals.ts's mandatoryPlaced/categoriesSatisfied (rather than
   * a locally-duplicated presence check) so an is_annual course only counts
   * as placed once it occupies EVERY one of its spans_semesters — otherwise
   * isGoalReached() would stop the loop as "done" on a partially-placed
   * annual course before enumerateActions ever gets a chance to repair it.
   * hasIncompleteAnnual covers the same partial-placement case for a course
   * that ISN'T mandatory/category (mandatoryPlaced/categoriesSatisfied
   * already reflect it for those) — a plain elective, otherwise invisible to
   * both this status and to isGoalReached.
   */
  private goalStatus(state: PlanState = this.state) {
    const semesterLoads: Record<string, number> = {};
    for (const id of this.model.knownSemesterIds) {
      semesterLoads[id] = (state.semesters[id] ?? []).reduce(
        (s, cid) => s + (this.model.profiles.get(cid)?.hours ?? 0),
        0,
      );
    }
    const mandatoryPlaced = computeMandatoryPlaced(state, this.model);
    const categoriesSatisfied = computeCategoriesSatisfied(state, this.model);
    return {
      degreeHours: computeDegreeHours(state, this.model),
      semesterLoads,
      mandatoryPlaced,
      categoriesSatisfied,
      allCategoriesSatisfied: categoriesSatisfied === this.model.categories.length,
      hasIncompleteAnnual: this.findIncompleteAnnualCourse(state) !== undefined,
      // Slice 18A — a HARD user inclusion is a requirement, so the bare goal is
      // not reached while one is unsatisfied. Without this the loop could report
      // "המטרה הושגה" for a plan validateCandidate rejects outright.
      missingMustInclude: missingMustIncludeCourseIds(state, this.model),
    };
  }

  getState(): WorkerObservation {
    const g = this.goalStatus();
    return {
      phase: this.phase(),
      degreeHours: g.degreeHours,
      semesterLoads: g.semesterLoads,
      mandatoryPlaced: g.mandatoryPlaced,
      categoriesSatisfied: g.categoriesSatisfied,
      allCategoriesSatisfied: g.allCategoriesSatisfied,
      errors: this.validate(this.state).errors,
    };
  }

  isGoalReached(): boolean {
    const g = this.goalStatus();
    const overHard = Object.values(g.semesterLoads).some(h => h > this.model.hardCap);
    return (
      g.degreeHours >= this.model.degreeRequiredHours &&
      g.mandatoryPlaced === this.model.requiredMandatoryCourseIds.length &&
      g.allCategoriesSatisfied &&
      !overHard &&
      !g.hasIncompleteAnnual &&
      g.missingMustInclude.length === 0
    );
  }

  private phase(): PlannerPhase {
    if (this.isGoalReached()) return 'DONE';
    const g = this.goalStatus();
    // An over-cap semester or a partially-placed annual course is a
    // legality/completeness breach — the loop is repairing it.
    if (Object.values(g.semesterLoads).some(h => h > this.model.hardCap) || g.hasIncompleteAnnual) return 'REPAIR';
    return 'CONSTRUCT_PLAN';
  }

  /** Validate the current (or given) plan state against the deterministic validators. */
  validate(state: PlanState = this.state) {
    return validatePlanState(state, this.model, this.pinnedHome, this._validationCtx);
  }

  /** All reasonable next actions given the current state (delegates to the shared enumerator). */
  enumerateActions(state: PlanState = this.state): PlannerMutation[] {
    return enumerateActions(state, this.model);
  }

  /** Next actions ranked by resulting plan score descending, capped at `limit`. */
  rankActions(limit = 20): Array<PlannerMutation & { score: number[] }> {
    return this.enumerateActions()
      .map(a => {
        const next = applyMutation(this.state, a);
        return { ...a, score: next ? scorePlan(next, this.model) : GOAL_STACK.map(() => -Infinity) };
      })
      .sort((a, b) => compareScore(b.score, a.score))
      .slice(0, limit);
  }

  // ── deterministic tools ───────────────────────────────────────────────────

  addCourse(courseId: string, semesterId?: string, by: Actor = 'worker'): MutationResult {
    if (this.isExcluded(courseId)) {
      return this.recordReject(courseId, 'הקורס סומן כלא-זמין (חריגה מפורשת) ולכן לא ישובץ.', by);
    }
    // Annual (year-long) courses must be placed in every spanned semester
    // atomically, never split into a single semester — the same rule
    // enumerateActions applies for the search, reused here so a direct
    // add_course tool call (the production LlmOrchestrator path) can't place
    // one half of the pair only. When spans_semesters/legal data is
    // confident, addCourseActionsFor returns exactly one atomic bundle and
    // any explicit semesterId is intentionally ignored (splitting is never
    // legal). When it isn't confident, addCourseActionsFor instead falls
    // back to one alternative ADD_COURSE per legal semester — same shape as
    // a non-annual course — so an explicitly requested semesterId (or, when
    // none is given/legal, the same load-based choice bestLegalSemester
    // makes below) must be honored among those alternatives, not just the
    // first one blindly.
    //
    // Checked BEFORE the generic "already placed" rejection below: a course
    // already placed in ONE of its spanned semesters only (e.g. stale data
    // from before this fix, or any other partial placement) must still be
    // repairable by completing the missing span — applyMutation's ADD_COURSE
    // case fills in only what's missing and rejects as a true no-op only
    // once every span is already present.
    if (this.model.profiles.get(courseId)?.is_annual) {
      const actions = addCourseActionsFor(this.model, courseId);
      if (!actions.length) {
        return this.recordReject(courseId, 'לא נמצא סמסטר חוקי לשיבוץ הקורס.', by);
      }
      let action = actions[0];
      if (actions.length > 1) {
        const bySemester = new Map(actions.map(a => [(a as any).semesterId as string, a]));
        const chosenSem: string | null =
          semesterId && bySemester.has(semesterId) ? semesterId : bestLegalSemester(this.state, this.model, courseId);
        action = (chosenSem ? bySemester.get(chosenSem) : undefined) ?? actions[0];
      }
      return this.tryApply(action, 'ADD_COURSE', this.addReason(courseId), by);
    }
    if (new Set(placedCourseIds(this.state)).has(courseId)) {
      return this.recordReject(courseId, 'הקורס כבר משובץ.', by);
    }
    const sem = semesterId ?? bestLegalSemester(this.state, this.model, courseId);
    if (!sem) {
      return this.recordReject(courseId, 'לא נמצא סמסטר חוקי לשיבוץ הקורס.', by);
    }
    return this.tryApply({ type: 'ADD_COURSE', courseId, semesterId: sem }, 'ADD_COURSE', this.addReason(courseId), by);
  }

  removeCourse(courseId: string, by: Actor = 'worker'): MutationResult {
    return this.tryApply({ type: 'REMOVE_COURSE', courseId }, 'REMOVE_COURSE', 'הסרת קורס מיותר', by);
  }

  moveCourse(courseId: string, toSemester: string, by: Actor = 'worker'): MutationResult {
    return this.tryApply({ type: 'MOVE_COURSE', courseId, toSemester }, 'MOVE_COURSE', 'איזון עומס בין סמסטרים', by);
  }

  replaceCourse(outId: string, inId: string, semesterId?: string, by: Actor = 'worker'): MutationResult {
    if (this.isExcluded(inId)) {
      return this.recordReject(inId, 'הקורס המוצע סומן כלא-זמין.', by);
    }
    const sem = semesterId ?? this.semesterOfLocal(outId) ?? bestLegalSemester(this.state, this.model, inId);
    if (!sem) return this.recordReject(inId, 'לא נמצא סמסטר חוקי להחלפה.', by);
    return this.tryApply({ type: 'REPLACE_COURSE', outId, inId, semesterId: sem }, 'REPLACE_COURSE', 'החלפת קורס בחלופה חוקית טובה יותר', by);
  }

  // ── Observe → Reason → Act → Validate ─────────────────────────────────────

  /** One loop iteration. Returns the action taken, or the STOP action when the loop ends. */
  step(by: 'greedy' | 'llm' = 'greedy'): PlannerAction | null {
    // isGoalReached() is NOT an early-exit here: it only reflects bare
    // degree/mandatory/category/legality/annual completion, with zero
    // awareness of model.wantedCourseIds or of any further balance
    // improvement (see its own docstring) — enumerateActions' group 3
    // (wanted courses) and group 5 (balance moves) are unconditional and
    // stay reachable/beneficial even after that bare goal already holds.
    // Stopping the instant it flips true — as this used to do — meant a
    // still-legal, still-improving wanted-course placement was silently
    // never even attempted, while the response nonetheless reported the
    // plan as complete: a real self-contradiction reproduced against the
    // real greedy search (see tests/api/planner_worker.test.ts, "keeps
    // searching past bare degree/mandatory/category completion"). The loop
    // now always falls through to the same Reason/Act/Validate machinery
    // below and only stops once the terminal "no advancing action" check
    // further down finds nothing left to legally improve — bare-goal status
    // only changes which of the two STOP messages that check records.

    // Completing a partially-placed is_annual course is a structural
    // correctness repair (the plan is invalid until every span is filled),
    // not a scored preference — nothing in GOAL_STACK rewards it, so the
    // "does this action score better than staying" gate below could reject
    // it even though leaving it split makes the plan invalid (e.g. a plain
    // elective annual course, once degree hours are already met, might not
    // improve balance/difficulty by getting completed). Repair it first,
    // unconditionally, reusing addCourse()'s existing atomic-bundle/
    // best-semester selection logic instead of duplicating it here. Falls
    // through to the normal scored search if no legal repair exists (e.g.
    // every remaining span would breach the hard cap) so the loop doesn't
    // get stuck retrying an impossible repair.
    const incompleteAnnualId = this.findIncompleteAnnualCourse();
    if (incompleteAnnualId) {
      const res = this.addCourse(incompleteAnnualId, undefined, by);
      if (res.accepted) return res.action;
    }

    const current = scorePlan(this.state, this.model);
    const curFinal = this.opts.lookahead ? this.estimate(this.state) : current;

    // Reason — only LEGAL resulting states are candidates.
    const legal = this.enumerateActions(this.state)
      .map(mut => ({ mut, next: applyMutation(this.state, mut) }))
      .filter((x): x is { mut: PlannerMutation; next: PlanState } => x.next != null && this.validate(x.next).valid)
      .map(x => ({ ...x, imm: scorePlan(x.next, this.model) }))
      .sort((a, b) => compareScore(b.imm, a.imm));

    // Downstream impact — forward-check + rollout the top immediate candidates.
    // projectFeasibility is a RANKING signal, not a hard gate (see its own
    // docstring in planner_lookahead.ts: an action that blocks a still-required
    // item "must be ranked down"). A board can legitimately span fewer
    // semesters than the full degree needs (e.g. prior-hours data is
    // missing/low, or the board only covers the student's remaining years) —
    // projectFeasibility's aggregate 'degree_hours' reason then correctly
    // fires on EVERY state, since the full target can never be reached from
    // ANY of them. That specific reason must never eliminate (or even rank
    // down) every action, or the worker takes zero actions and silently
    // returns an empty, clean-looking plan. A per-course/per-category block
    // (an action that makes a SPECIFIC still-needed mandatory course or
    // category candidate impossible to place later) is a different, genuine
    // self-inflicted mistake and must still be ranked down — collapsing both
    // reasons into one boolean would let a plan actively sabotage a mandatory
    // course just because the aggregate target was already unreachable
    // anyway. So only non-'degree_hours' blocked reasons count against
    // ranking; hitting only the aggregate check ranks the same as feasible.
    //
    // Codex round-2: feasibility/blocker status must be computed for the
    // FULL `legal` set and sorted BEFORE truncating to topN — topN exists to
    // bound the expensive estimateFinalScore rollout below, not to gate
    // which candidates are even considered for blocker-awareness (that check
    // is cheap by comparison). Truncating on raw immediate score first can
    // otherwise let more than topN high-immediate-score blocking actions
    // (e.g. several large electives that all crowd out the same single
    // legal semester of a still-needed mandatory course) fill the entire
    // truncated set, silently excluding the one non-blocking action that
    // would have avoided sabotaging that mandatory course.
    // Codex round-3: the 'degree_hours' reason must only be excused when it
    // was ALREADY present before this action — i.e. the degree target was
    // already unreachable from the current state regardless of what gets
    // chosen. An action that makes a PREVIOUSLY-reachable target newly
    // unreachable (e.g. a "wanted" is_annual course that consumes headroom
    // in multiple semesters while counting only once toward degree credit)
    // is a genuine self-inflicted mistake, not the unavoidable structural
    // case this whole ranking change exists to tolerate — it must still be
    // ranked down, or a court that only wins on preference (g5) could get
    // chosen over an ordinary elective that would have kept the plan
    // completable.
    const currentDegreeHoursAlreadyUnreachable = this.opts.lookahead
      ? projectFeasibility(this.state, this.model).blocked.includes('degree_hours')
      : false;
    const withBlockerStatus = this.opts.lookahead
      ? legal
          .map(x => {
            const report = projectFeasibility(x.next, this.model);
            const hasRealBlocker =
              report.blocked.some(b => b !== 'degree_hours') ||
              (report.blocked.includes('degree_hours') && !currentDegreeHoursAlreadyUnreachable);
            return { ...x, feasible: report.feasible, hasRealBlocker };
          })
          .sort((a, b) => {
            if (a.hasRealBlocker !== b.hasRealBlocker) return a.hasRealBlocker ? 1 : -1;
            return compareScore(b.imm, a.imm);
          })
      : legal.map(x => ({ ...x, feasible: true, hasRealBlocker: false }));
    const top = this.opts.lookahead ? withBlockerStatus.slice(0, this.opts.topN) : withBlockerStatus;
    const evaluated = top
      .map(x => ({
        ...x,
        fin: this.opts.lookahead ? this.estimate(x.next) : x.imm,
      }))
      .sort((a, b) => {
        if (a.hasRealBlocker !== b.hasRealBlocker) return a.hasRealBlocker ? 1 : -1;
        return compareScore(b.fin, a.fin) || compareScore(b.imm, a.imm);
      });

    // Slice 18B — bounded deterministic deviation. This is the ONLY place the
    // candidate search differs from the legacy single run: at one configured
    // scored-search step it commits the Nth-ranked advancing action instead of
    // the 1st. Every skipped action was already legal, already validated and
    // already ranked by the same scorer, so the resulting plan is a genuine
    // alternative under the SAME policy, not a degraded one. If fewer than
    // `rank` advancing actions exist the run simply matches the baseline and the
    // caller's identity dedup collapses it — no error, no randomness.
    const skipCount = this.opts.deviation && this.opts.deviation.atStep === this.searchStepIndex
      ? this.opts.deviation.rank
      : 0;
    this.searchStepIndex++;
    let advancingSeen = 0;

    // Act + Validate — accept the best action that advances the reachable outcome
    // (better final than staying) or makes immediate progress; try next on reject.
    for (const x of evaluated) {
      const advances = compareScore(x.fin, curFinal) > 0 || compareScore(x.imm, current) > 0;
      if (!advances) continue;
      if (advancingSeen++ < skipCount) continue;
      const res = this.applyChosen(x.mut, by, {
        immediateScore: scoreScalar(x.imm),
        estimatedFinalScore: scoreScalar(x.fin),
        feasible: x.feasible,
      });
      if (res.accepted) return res.action;
    }

    // The bare goal (isGoalReached()) may or may not hold at this point —
    // convergence (no further legal action advances the plan) is the real
    // stop condition either way, but the message should still say so
    // accurately: "complete" only when it actually is.
    return this.recordStop(
      this.isGoalReached()
        ? 'המטרה הושגה — התואר מושלם וכל האילוצים מתקיימים.'
        : 'לא נמצאה פעולה חוקית שמשפרת את התוכנית או את התוצאה הסופית הניתנת להשגה.',
    );
  }

  /** Run the loop to completion. */
  run(maxSteps = 500, by: 'greedy' | 'llm' = 'greedy'): void {
    for (let i = 0; i < maxSteps; i++) {
      const a = this.step(by);
      if (!a || a.action === 'STOP') {
        // Converged: the strict-improvement search found nothing more to take.
        // Issue #75 — a wanted course stranded only by an unplaced prerequisite
        // can't be recovered one step at a time (placing the bare prerequisite
        // advances no score component until the wanted course follows, a
        // two-step unlock step()'s strict-improvement gate — and the rollout
        // bound by the same invariant — can never chain). Attempt the atomic
        // bundle recovery; if it actually changed the plan, let the normal loop
        // resume (balance/optimization/further recovery) until it too
        // converges. Bounded: recovery fires at most once per wanted course.
        const before = placedCourseIds(this.state).length;
        this.recoverUnplacedWantedCourses(by);
        if (placedCourseIds(this.state).length > before) continue;
        return;
      }
    }
    // The for-loop ran out of iterations without step() itself ever recording
    // a STOP — i.e. every one of the maxSteps iterations was a real accepted
    // action. Since step() no longer exits the instant the bare goal is met
    // (post-goal wanted-course/balance optimization keeps taking legal
    // actions), isGoalReached() being true here does NOT by itself mean
    // nothing was left to do — it can equally mean the budget ran out
    // mid-optimization, with further legal improvements never attempted
    // (Codex finding on PR #65).
    //
    // But isGoalReached() alone can't distinguish that genuine-truncation
    // case from the boundary case where the very last permitted action
    // (i == maxSteps - 1) happened to be the one that reached full
    // convergence — nothing left to do, we simply never spent one more
    // step() call confirming it. Treating THAT case as truncation is itself
    // a regression (issue #68): a complete, fully-legal, fully-optimized
    // plan gets a "maxSteps" STOP reason, which generate-plan.ts's
    // hitMaxSteps detection then reports as a blocking error — a valid plan
    // presented as broken, the mirror image of the bug PR #65 fixed. So when
    // the bare goal holds, do one non-consuming check (reusing step()'s own
    // "is there a legal action that still advances the plan" logic without
    // applying one) to tell genuine truncation apart from true convergence.
    const genuinelyTruncated = this.isGoalReached() ? this.hasFurtherAdvancingAction() : true;
    this.recordStop(
      !genuinelyTruncated
        ? 'המטרה הושגה — התואר מושלם וכל האילוצים מתקיימים.'
        : this.isGoalReached()
          ? `הגעה למגבלת הצעדים (maxSteps: ${maxSteps}) תוך כדי שיפור נוסף מעבר למטרה הבסיסית (למשל שיבוץ קורסים מבוקשים או איזון עומס) — ייתכן שנותרו שיפורים חוקיים נוספים שלא בוצעו.`
          : `לא הושגה המטרה עד תום מגבלת הצעדים (maxSteps: ${maxSteps}).`,
    );
  }

  /**
   * Non-mutating peek: is there still a legal action that would advance the
   * plan (immediate or lookahead-estimated final score improves), or an
   * incomplete annual course still needing a repair placement? Mirrors the
   * same "Reason" decision step() itself makes, without applying anything or
   * recording a trace entry — used only to tell genuine step-budget
   * truncation apart from the run() ending exactly on the converging action
   * (see run()'s own comment).
   *
   * Two passes, cheapest first:
   *  1. Immediate score, over EVERY legal candidate — no rollout, so
   *     checking all of them (not just opts.topN) is free and strictly more
   *     correct than step()'s own per-iteration search needs to be.
   *  2. Lookahead-estimated final score, but — Codex finding on the initial
   *     version of this method — bounded to the same opts.topN candidates
   *     step() itself would ever roll out per iteration. An unbounded
   *     estimateFinalScore call (rollout over rolloutSteps, each
   *     re-enumerating/validating the full action set) per legal candidate
   *     is roughly quadratic in the size of the action space and, called
   *     right at the maxSteps boundary this method exists to detect, risks
   *     timing out instead of returning the valid plan. Matching step()'s
   *     own topN bound keeps this check's cost the same order of magnitude
   *     as a single ordinary step() call, not worse.
   */
  private hasFurtherAdvancingAction(): boolean {
    if (this.findIncompleteAnnualCourse()) return true;
    const current = scorePlan(this.state, this.model);
    const legal = this.enumerateActions(this.state)
      .map(mut => applyMutation(this.state, mut))
      .filter((next): next is PlanState => next != null && this.validate(next).valid)
      .map(next => ({ next, imm: scorePlan(next, this.model) }))
      .sort((a, b) => compareScore(b.imm, a.imm));

    if (legal.some(x => compareScore(x.imm, current) > 0)) return true;
    if (!this.opts.lookahead) return false;

    const curFinal = this.estimate(this.state);
    return legal.slice(0, this.opts.topN).some(x => {
      const fin = this.estimate(x.next);
      return compareScore(fin, curFinal) > 0;
    });
  }

  /**
   * Repair the current plan: drive the Observe→Reason→Act→Validate loop until no
   * legal improvement remains. The same loop that builds a plan also repairs one
   * — over-cap semesters lower the legality goal, so balancing moves (and missing
   * requirement fills) are chosen until the plan is legal and complete. Returns
   * the resulting candidate report.
   */
  repair(maxSteps = 500): import('./planner_validate').CandidateReport {
    this.run(maxSteps, 'greedy');
    return validateCandidate(this.state, this.model, this.pinnedHome);
  }

  /**
   * Issue #75 — deterministic finishing recovery for a wanted course left
   * unplaced only because its own (non-mandatory, non-category) prerequisite is
   * unplaced. enumerateActions' group 3 offers the wanted course but it fails
   * strict-timing legality while its prerequisite is missing, and that
   * bare-elective prerequisite is only offered by the degree-fill group (gated
   * off once degree hours are already met); step()'s strict-improvement gate
   * then rejects placing the prerequisite on its own, because it advances no
   * score component until the wanted course follows — a two-step unlock the
   * greedy rollout (bound by the same invariant) can never chain.
   *
   * This pass evaluates the wanted course TOGETHER WITH its missing prerequisite
   * chain atomically, and commits the whole bundle only when the resulting plan
   * is valid AND strictly out-scores the current plan. Gated that way it is
   * monotonic-safe: it can never yield a worse or illegal plan than it started
   * from, so it is inert for any plan whose wanted courses are already placed,
   * genuinely unplaceable, or whose recovery would not improve the score. It is
   * seeded ONLY from wantedCourseIds and deliberately kept out of
   * requiredButUnplacedCourseIds (planner_goals.ts), whose set also feeds
   * remainingMandatoryHours' degree-hour reservation budget — a wanted course
   * is a preference, not a degree requirement, and must never distort mandatory
   * reservation scoring for every plan.
   */
  recoverUnplacedWantedCourses(by: Actor = 'worker'): void {
    // Slice 18A — HARD inclusions are recovered FIRST and are NOT subject to the
    // strict-improvement gate below. That gate exists to keep a soft preference
    // from making a plan worse; applied to a `must_include` course it would be a
    // recovery mechanism that treats a missing hard-wanted course as acceptable,
    // which product policy forbids outright. Any layout that survives the same
    // validation is committed. (In practice g2a already improves for a hard
    // inclusion, so this is belt-and-braces — but the gate must not be the thing
    // deciding it.)
    const hardIds = [...(this.model.mustIncludeCourseIds ?? [])];
    const targets: Array<{ id: string; hard: boolean }> = [
      ...hardIds.map(id => ({ id, hard: true })),
      ...[...this.model.wantedCourseIds].filter(id => !hardIds.includes(id)).map(id => ({ id, hard: false })),
    ];
    // At most one recovered course per outer pass; re-scan after each so
    // a freshly-placed chain can enable the next. Bounded by the target count.
    for (let guard = 0; guard <= targets.length; guard++) {
      let placedOne = false;
      for (const { id: wantedId, hard } of targets) {
        const placed = new Set(placedCourseIds(this.state));
        if (placed.has(wantedId) || this.model.completedCourseIds.has(wantedId) || this.isExcluded(wantedId)) continue;
        if (this.model.currentlyPlannedCourseIds?.has(wantedId)) continue;
        const chain = this.orderedMissingPrereqChain(wantedId, placed);
        if (!chain) continue; // an excluded/unknown prerequisite — the course is genuinely unplaceable
        const layout = this.layoutBundleMinimizingPeak([...chain, wantedId]);
        if (!layout) continue; // no legal, valid layout of the whole bundle
        if (!hard && compareScore(scorePlan(layout.state, this.model), scorePlan(this.state, this.model)) <= 0) continue;
        // Commit through the normal validated path (trace + invariants), in
        // dependency order — every intermediate state is legal by construction.
        let committed = true;
        for (const { courseId, semesterId } of layout.placements) {
          if (!this.tryApply({ type: 'ADD_COURSE', courseId, semesterId }, 'ADD_COURSE', this.addReason(courseId), by).accepted) {
            committed = false;
            break;
          }
        }
        if (committed) { placedOne = true; break; }
      }
      if (!placedOne) break;
    }
  }

  /**
   * The unplaced/uncompleted prerequisites of `wantedId`, transitively, in
   * dependency order (a prerequisite before every course that needs it), with
   * `wantedId` itself excluded. Returns null if any prerequisite is excluded or
   * has no profile — in that case the wanted course cannot be legally placed at
   * all, so recovery must not attempt a partial bundle.
   */
  private orderedMissingPrereqChain(wantedId: string, placed: Set<string>): string[] | null {
    const chain: string[] = [];
    const seen = new Set<string>([wantedId]);
    const visit = (id: string): boolean => {
      const p = this.model.profiles.get(id);
      if (!p) return false;
      for (const prereqId of p.prerequisites ?? []) {
        if (this.model.completedCourseIds.has(prereqId)) continue;
        if (this.model.currentlyPlannedCourseIds?.has(prereqId)) continue;
        if (placed.has(prereqId) || seen.has(prereqId)) continue;
        seen.add(prereqId);
        if (this.isExcluded(prereqId)) return false;
        if (!visit(prereqId)) return false;
        chain.push(prereqId);
      }
      return true;
    };
    return visit(wantedId) ? chain : null;
  }

  /**
   * Lay out `ids` (in dependency order) into legal semesters, choosing for each
   * the semester that MINIMIZES the resulting peak weekly load (tie-break:
   * earliest semester, leaving later room for the dependents that follow). Every
   * intermediate placement is validated, so prerequisite strict-timing is
   * enforced automatically (a placement that would put a course before its
   * prerequisite simply fails validation and is skipped). Returns the final
   * state plus the chosen placements, or null if any course has no valid
   * semester. Annual courses are out of scope for this recovery (they need
   * atomic multi-span placement) — a bundle containing one is abandoned.
   *
   * Peak-minimizing (rather than earliest) placement matters: only a layout that
   * uses spare/empty semesters keeps the plan's peak load unchanged, which is
   * what lets the whole bundle strictly out-score the pre-recovery plan (the
   * balance objective g4a outranks the wanted-course objective g5) — an
   * earliest-first layout that raised the peak would fail recoverUnplaced...'s
   * own strict-improvement gate and silently recover nothing.
   */
  private layoutBundleMinimizingPeak(
    ids: string[],
  ): { state: PlanState; placements: Array<{ courseId: string; semesterId: string }> } | null {
    let cur = this.state;
    const placements: Array<{ courseId: string; semesterId: string }> = [];
    for (const id of ids) {
      const p = this.model.profiles.get(id);
      if (!p || p.is_annual) return null;
      const legal = new Set(legalSemestersFor(this.model, id));
      let bestState: PlanState | null = null;
      let bestSem: string | null = null;
      let bestPeak = Infinity;
      for (const sem of this.model.knownSemesterIds) {
        if (!legal.has(sem)) continue;
        const next = applyMutation(cur, { type: 'ADD_COURSE', courseId: id, semesterId: sem });
        if (!next || !this.validate(next).valid) continue;
        const peak = this.peakLoad(next);
        if (peak < bestPeak) { bestPeak = peak; bestState = next; bestSem = sem; }
      }
      if (!bestState || !bestSem) return null;
      cur = bestState;
      placements.push({ courseId: id, semesterId: bestSem });
    }
    return { state: cur, placements };
  }

  private peakLoad(state: PlanState): number {
    let peak = 0;
    for (const sem of this.model.knownSemesterIds) {
      const load = (state.semesters[sem] ?? []).reduce((s, c) => s + (this.model.profiles.get(c)?.hours ?? 0), 0);
      if (load > peak) peak = load;
    }
    return peak;
  }

  /** Full candidate gate for the current plan (legality + completeness). */
  validateCandidate(): import('./planner_validate').CandidateReport {
    return validateCandidate(this.state, this.model, this.pinnedHome);
  }

  /**
   * Explain the selected plan. Built entirely from the worker's own committed
   * state + trace, so it can only reference courses/decisions that are actually
   * in the plan or were acted on — the explanation can never diverge from the
   * plan it describes.
   */
  explain(): PlanExplanation {
    const trace = this.getTrace();
    const g = this.goalStatus();
    const report = this.validateCandidate();
    const nameOf = (id: string) => this.courseName(id) ?? id;

    const requirements_he: string[] = [];
    requirements_he.push(
      `שעות תואר: ${g.degreeHours}/${this.model.degreeRequiredHours}` +
        (report.degreeMet ? ' ✓' : ` (חסרות ${Math.max(0, this.model.degreeRequiredHours - g.degreeHours)})`),
    );
    requirements_he.push(
      `קורסי חובה: ${g.mandatoryPlaced}/${this.model.requiredMandatoryCourseIds.length}` +
        (g.mandatoryPlaced === this.model.requiredMandatoryCourseIds.length ? ' ✓' : ''),
    );
    for (const cat of this.model.categories) {
      const placed = new Set(placedCourseIds(this.state));
      const got = cat.candidateIds.filter(id => placed.has(id)).length;
      requirements_he.push(`קטגוריה ${cat.name}: ${Math.min(got, cat.required)}/${cat.required}` + (got >= cat.required ? ' ✓' : ''));
    }

    const placements_he: string[] = [];
    for (const sem of this.model.knownSemesterIds) {
      const ids = this.state.semesters[sem] ?? [];
      if (!ids.length) continue;
      placements_he.push(`${sem} (${g.semesterLoads[sem]} ש"ש): ${ids.map(nameOf).join(', ')}`);
    }

    // Decisions: why flexible courses landed where they did / were moved (MOVE +
    // ADD actions that carried a downstream estimate).
    const decisions_he = trace
      .filter(a => a.validationAfterAction === 'pass' && (a.action === 'MOVE_COURSE' || a.action === 'ADD_COURSE'))
      .map(a => {
        const where = a.semester ? ` → ${a.semester}` : '';
        return `${a.action === 'MOVE_COURSE' ? 'הזזה' : 'שיבוץ'}: ${a.courseName ?? a.courseId}${where} — ${a.reason}`;
      });

    const rejections_he = trace
      .filter(a => a.action === 'REJECT_COURSE')
      .map(a => `${a.courseName ?? a.courseId}: ${a.reason}`);

    const stops = trace.filter(a => a.action === 'STOP');
    const stop_he = stops.length ? stops[stops.length - 1].reason : 'התהליך הסתיים.';

    const summary_he = report.valid
      ? `התוכנית תקפה ומלאה: ${g.degreeHours}/${this.model.degreeRequiredHours} ש"ש, כל קורסי החובה והקטגוריות שובצו, ללא חריגות עומס.`
      : `התוכנית אינה מלאה עדיין: ${report.errors[0] ?? 'נותרו דרישות פתוחות.'}`;

    // Referenced courses — only those mentioned, all drawn from plan/trace.
    const referencedCourseIds = Array.from(
      new Set([
        ...placedCourseIds(this.state),
        ...trace.map(a => a.courseId).filter((x): x is string => !!x),
      ]),
    );

    return { summary_he, requirements_he, placements_he, decisions_he, rejections_he, stop_he, referencedCourseIds };
  }

  // ── internals ─────────────────────────────────────────────────────────────

  private isExcluded(id: string): boolean {
    return isExcluded(this.model, id);
  }

  private semesterOfLocal(id: string, state: PlanState = this.state): string | null {
    for (const [sem, list] of Object.entries(state.semesters)) {
      if (list.includes(id)) return sem;
    }
    return null;
  }

  private addReason(id: string): string {
    if (this.model.requiredMandatoryCourseIds.includes(id)) return 'שיבוץ קורס חובה';
    for (const cat of this.model.categories) {
      if (cat.candidateIds.includes(id)) return `השלמת דרישת קטגוריה: ${cat.name}`;
    }
    if (this.model.wantedCourseIds.has(id)) return 'שיבוץ קורס מועדף על המשתמש';
    return 'מילוי שעות להשלמת התואר';
  }

  private courseName(id: string): string | undefined {
    return this.model.profiles.get(id)?.name_he ?? undefined;
  }

  private tryApply(
    mut: PlannerMutation,
    actionType: PlannerAction['action'],
    reason: string,
    by: Actor,
    meta: ActionMeta = {},
  ): MutationResult {
    const before = this.state;
    const beforeTotal = computeDegreeHours(before, this.model);
    const errorsBefore = this.validate(before).errors;
    // Phase reflects the state in which the action was DECIDED (e.g. a balancing
    // move decided while a semester is over-cap is a REPAIR action), so capture
    // it before the mutation commits.
    const phaseBefore = this.phase();
    const next = applyMutation(before, mut);

    const ids = this.mutationIds(mut);

    if (!next) {
      const action = this.tracer.record({
        action: actionType, ...ids, reason: `${reason} — לא ניתן לביצוע`,
        beforeTotal, afterTotal: beforeTotal, validationAfterAction: 'fail',
        phase: phaseBefore, by, constraintsChecked: [], ...meta,
      });
      return { accepted: false, errorsIntroduced: [], action };
    }

    const rep = this.validate(next);
    const introduced = rep.errors.filter(e => !errorsBefore.includes(e));
    const afterTotal = computeDegreeHours(next, this.model);

    if (introduced.length > 0) {
      const action = this.tracer.record({
        action: actionType === 'ADD_COURSE' ? 'REJECT_COURSE' : actionType,
        ...ids, reason: introduced[0],
        beforeTotal, afterTotal, validationAfterAction: 'fail',
        phase: phaseBefore, by, constraintsChecked: CONSTRAINTS_CHECKED, ...meta,
      });
      return { accepted: false, errorsIntroduced: introduced, action };
    }

    this.state = next;
    const action = this.tracer.record({
      action: actionType, ...ids, reason,
      beforeTotal, afterTotal, validationAfterAction: 'pass',
      phase: phaseBefore, by, constraintsChecked: CONSTRAINTS_CHECKED, ...meta,
    });
    return { accepted: true, errorsIntroduced: [], action };
  }

  private mutationIds(mut: PlannerMutation): { courseId?: string; courseName?: string; semester?: string; from?: string | null } {
    switch (mut.type) {
      case 'ADD_COURSE':
        return { courseId: mut.courseId, courseName: this.courseName(mut.courseId), semester: mut.semesterId };
      case 'REMOVE_COURSE':
        return { courseId: mut.courseId, courseName: this.courseName(mut.courseId), from: this.semesterOfLocal(mut.courseId) };
      case 'MOVE_COURSE':
        return { courseId: mut.courseId, courseName: this.courseName(mut.courseId), from: this.semesterOfLocal(mut.courseId), semester: mut.toSemester };
      case 'REPLACE_COURSE':
        return { courseId: mut.inId, courseName: this.courseName(mut.inId), semester: mut.semesterId };
      default:
        return {};
    }
  }

  private applyChosen(mut: PlannerMutation, by: 'greedy' | 'llm', meta: ActionMeta): MutationResult {
    switch (mut.type) {
      case 'ADD_COURSE':
        return this.tryApply(mut, 'ADD_COURSE', this.addReason(mut.courseId), by, meta);
      case 'MOVE_COURSE':
        return this.tryApply(mut, 'MOVE_COURSE', 'איזון עומס בין סמסטרים', by, meta);
      case 'REMOVE_COURSE':
        return this.tryApply(mut, 'REMOVE_COURSE', 'הסרת קורס מיותר', by, meta);
      case 'REPLACE_COURSE':
        return this.tryApply(mut, 'REPLACE_COURSE', 'החלפת קורס בחלופה חוקית טובה יותר', by, meta);
      default:
        return { accepted: false, errorsIntroduced: [], action: this.recordStop('אין פעולה לבצע.') };
    }
  }

  private recordReject(courseId: string, reason: string, by: Actor): MutationResult {
    const total = computeDegreeHours(this.state, this.model);
    const action = this.tracer.record({
      action: 'REJECT_COURSE', courseId, courseName: this.courseName(courseId), reason,
      beforeTotal: total, afterTotal: total, validationAfterAction: 'fail',
      phase: this.phase(), by, constraintsChecked: CONSTRAINTS_CHECKED,
    });
    return { accepted: false, errorsIntroduced: [reason], action };
  }

  private recordStop(reason: string): PlannerAction {
    const total = computeDegreeHours(this.state, this.model);
    return this.tracer.record({
      action: 'STOP', reason,
      beforeTotal: total, afterTotal: total, validationAfterAction: 'pass',
      phase: this.phase(), by: 'worker', constraintsChecked: [],
    });
  }
}

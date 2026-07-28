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
  private opts: Required<WorkerOptions>;
  /** Cached validation context — pure function of (model, pinnedHome), built once. */
  private readonly _validationCtx: PlanValidationContext;

  constructor(private model: ConstraintModel, initial?: PlanState, opts: WorkerOptions = {}) {
    this.state = initial ? cloneState(initial) : emptyState(model.knownSemesterIds);
    this.opts = { lookahead: opts.lookahead ?? true, topN: opts.topN ?? 8, rolloutSteps: opts.rolloutSteps ?? 200 };
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
      !g.hasIncompleteAnnual
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
    const curFinal = this.opts.lookahead ? estimateFinalScore(this.state, this.model, this.opts.rolloutSteps) : current;

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
        fin: this.opts.lookahead ? estimateFinalScore(x.next, this.model, this.opts.rolloutSteps) : x.imm,
      }))
      .sort((a, b) => {
        if (a.hasRealBlocker !== b.hasRealBlocker) return a.hasRealBlocker ? 1 : -1;
        return compareScore(b.fin, a.fin) || compareScore(b.imm, a.imm);
      });

    // Act + Validate — accept the best action that advances the reachable outcome
    // (better final than staying) or makes immediate progress; try next on reject.
    for (const x of evaluated) {
      const advances = compareScore(x.fin, curFinal) > 0 || compareScore(x.imm, current) > 0;
      if (!advances) continue;
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
      if (!a || a.action === 'STOP') return;
    }
    if (!this.isGoalReached()) {
      this.recordStop(`לא הושגה המטרה עד תום מגבלת הצעדים (maxSteps: ${maxSteps}).`);
    }
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

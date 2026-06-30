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
} from './planner_goals';
import {
  enumerateActions,
  legalSemestersFor,
  bestLegalSemester,
  isExcluded,
} from './planner_actions';
import { validatePlanState } from './planner_validate';
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

  constructor(private model: ConstraintModel, initial?: PlanState, opts: WorkerOptions = {}) {
    this.state = initial ? cloneState(initial) : emptyState(model.knownSemesterIds);
    this.opts = { lookahead: opts.lookahead ?? true, topN: opts.topN ?? 8, rolloutSteps: opts.rolloutSteps ?? 200 };
    for (const cid of model.pinnedCourseIds) {
      const sem = this.semesterOfLocal(cid);
      if (sem) this.pinnedHome[cid] = sem;
    }
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

  /** Raw goal status — no phase/validation, safe to call from isGoalReached. */
  private goalStatus(state: PlanState = this.state) {
    const placed = new Set(placedCourseIds(state));
    const semesterLoads: Record<string, number> = {};
    for (const id of this.model.knownSemesterIds) {
      semesterLoads[id] = (state.semesters[id] ?? []).reduce(
        (s, cid) => s + (this.model.profiles.get(cid)?.hours ?? 0),
        0,
      );
    }
    const mandatoryPlaced = this.model.requiredMandatoryCourseIds.filter(id => placed.has(id)).length;
    const categoriesSatisfied = this.model.categories.filter(
      cat => cat.candidateIds.filter(id => placed.has(id)).length >= cat.required,
    ).length;
    return {
      degreeHours: computeDegreeHours(state, this.model),
      semesterLoads,
      mandatoryPlaced,
      categoriesSatisfied,
      allCategoriesSatisfied: categoriesSatisfied === this.model.categories.length,
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
      !overHard
    );
  }

  private phase(): PlannerPhase {
    return this.isGoalReached() ? 'DONE' : 'CONSTRUCT_PLAN';
  }

  /** Validate the current (or given) plan state against the deterministic validators. */
  validate(state: PlanState = this.state) {
    return validatePlanState(state, this.model, this.pinnedHome);
  }

  /** All reasonable next actions given the current state (delegates to the shared enumerator). */
  enumerateActions(state: PlanState = this.state): PlannerMutation[] {
    return enumerateActions(state, this.model);
  }

  // ── deterministic tools ───────────────────────────────────────────────────

  addCourse(courseId: string, semesterId?: string, by: Actor = 'worker'): MutationResult {
    if (this.isExcluded(courseId)) {
      return this.recordReject(courseId, 'הקורס סומן כלא-זמין (חריגה מפורשת) ולכן לא ישובץ.', by);
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
    if (this.isGoalReached()) {
      return this.recordStop('המטרה הושגה — התואר מושלם וכל האילוצים מתקיימים.');
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
    const top = this.opts.lookahead ? legal.slice(0, this.opts.topN) : legal;
    const evaluated = top
      .map(x => ({
        ...x,
        feasible: this.opts.lookahead ? projectFeasibility(x.next, this.model).feasible : true,
        fin: this.opts.lookahead ? estimateFinalScore(x.next, this.model, this.opts.rolloutSteps) : x.imm,
      }))
      .filter(x => x.feasible)
      .sort((a, b) => compareScore(b.fin, a.fin) || compareScore(b.imm, a.imm));

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

    return this.recordStop('לא נמצאה פעולה חוקית שמשפרת את התוכנית או את התוצאה הסופית הניתנת להשגה.');
  }

  /** Run the loop to completion. */
  run(maxSteps = 500, by: 'greedy' | 'llm' = 'greedy'): void {
    for (let i = 0; i < maxSteps; i++) {
      const a = this.step(by);
      if (!a || a.action === 'STOP') return;
    }
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
    const next = applyMutation(before, mut);

    const ids = this.mutationIds(mut);

    if (!next) {
      const action = this.tracer.record({
        action: actionType, ...ids, reason: `${reason} — לא ניתן לביצוע`,
        beforeTotal, afterTotal: beforeTotal, validationAfterAction: 'fail',
        phase: this.phase(), by, constraintsChecked: [], ...meta,
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
        phase: this.phase(), by, constraintsChecked: CONSTRAINTS_CHECKED, ...meta,
      });
      return { accepted: false, errorsIntroduced: introduced, action };
    }

    this.state = next;
    const action = this.tracer.record({
      action: actionType, ...ids, reason,
      beforeTotal, afterTotal, validationAfterAction: 'pass',
      phase: this.phase(), by, constraintsChecked: CONSTRAINTS_CHECKED, ...meta,
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

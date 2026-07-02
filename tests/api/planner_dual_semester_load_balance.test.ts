/**
 * Dual-Semester Load-Balancing Preference — unit + worker level.
 *
 * A course legally offered in BOTH Semester A and Semester B must not be biased
 * toward A merely because A is enumerated first: the shared plan score already
 * carries a balance goal (planner_goals.ts g4 = -spread over non-empty
 * semesters), so when A is heavier than B the worker must place the dual course
 * in B, and when B is heavier it must place it in A. Single-semester courses,
 * disallowed courses, and the "B when A is over-cap" behavior must be unchanged.
 *
 * INVESTIGATION NOTE (systematic-debugging Phase 1): this behavior is ALREADY
 * produced by the pre-existing g4 balance goal shared by the greedy worker and
 * the beam/agentic path (both rank via scorePlan/compareScore). The prior epic
 * (0804113) unblocked it by mapping offered_semesters term letters onto real
 * semester ids. These tests LOCK that behavior against regression; no scoring
 * change was required. The one residual A-preference (empty B → consolidation)
 * is a case the scoring model genuinely rates A-better and is asserted as a
 * documented control, per the epic's "A may still be selected when equally good
 * or better under the scoring model".
 */

import { getLegalSemesters } from '../../api/ai/completion_analysis';
import { buildConstraintModel, planContextToState } from '../../api/ai/planner_model';
import { legalSemestersFor, enumerateActions } from '../../api/ai/planner_actions';
import { scorePlan, compareScore } from '../../api/ai/planner_goals';
import { PlannerWorker } from '../../api/ai/planner_worker';
import type { PlannerMutation } from '../../api/ai/planner_types';

const SEM_A = 'year_3_semester_a';
const SEM_B = 'year_3_semester_b';
const SEMS = [SEM_A, SEM_B];

function board(courses: any[], categories: any[] = [], totalHours = 4, semesterIds: string[] = SEMS) {
  return {
    semesters: semesterIds.map(id => ({ semester_id: id, courses: [] })),
    metadata: {
      completed_course_ids: [],
      program_requirements_categories: { total_required_hours: totalHours, categories },
      program_repository_courses: courses,
    },
  };
}

const DUAL_CAT = { category_id: 'dc', name_he: 'קטגוריה', min_courses: 1, course_ids: ['DUAL'] };
function dual(overrides: any = {}) {
  return {
    course_id: 'DUAL', name_he: 'דואלי', weekly_hours: 4, is_mandatory: false,
    course_type: 'elective', placement_policy: 'elective',
    offered_semesters: ['A', 'B'], program_category_id: 'dc', prerequisites: [], ...overrides,
  };
}
function fixed(id: string, sem: string, hours: number) {
  return {
    course_id: id, name_he: id, weekly_hours: hours, is_mandatory: true,
    course_type: 'mandatory', placement_policy: 'fixed',
    effective_allowed_semesters: [sem], recommended_semester: sem, prerequisites: [],
  };
}
/**
 * Distinct semester ids the enumerator is willing to ADD `courseId` into.
 * enumerateActions legitimately emits the same course from several cases (a
 * category candidate is also a degree-hour-fill candidate at its best
 * semester), so the raw list carries duplicates; the CANDIDATE SET is what
 * matters for "which semesters are reachable".
 */
function addTargets(actions: PlannerMutation[], courseId: string): string[] {
  const set = new Set(
    actions
      .filter((a): a is Extract<PlannerMutation, { type: 'ADD_COURSE' }> => a.type === 'ADD_COURSE' && a.courseId === courseId)
      .map(a => a.semesterId),
  );
  return [...set].sort();
}
function semOf(w: PlannerWorker, id: string): string | null {
  const s = w.getPlan().semesters;
  for (const k of Object.keys(s)) if (s[k].includes(id)) return k;
  return null;
}

describe('action/normalization controls', () => {
  test('1. dual-offered course produces legal ADD candidates for both A and B', () => {
    const model = buildConstraintModel(board([dual()], [DUAL_CAT]));
    expect(legalSemestersFor(model, 'DUAL').sort()).toEqual([SEM_A, SEM_B]);
    const actions = enumerateActions({ semesters: { [SEM_A]: [], [SEM_B]: [] } }, model);
    expect(addTargets(actions, 'DUAL')).toEqual([SEM_A, SEM_B]);
  });

  test('2. single-semester A course produces only A candidates', () => {
    const model = buildConstraintModel(board([dual({ offered_semesters: ['A'] })], [DUAL_CAT]));
    expect(legalSemestersFor(model, 'DUAL')).toEqual([SEM_A]);
    const actions = enumerateActions({ semesters: { [SEM_A]: [], [SEM_B]: [] } }, model);
    expect(addTargets(actions, 'DUAL')).toEqual([SEM_A]);
  });

  test('3. single-semester B course produces only B candidates', () => {
    const model = buildConstraintModel(board([dual({ offered_semesters: ['B'] })], [DUAL_CAT]));
    expect(legalSemestersFor(model, 'DUAL')).toEqual([SEM_B]);
    const actions = enumerateActions({ semesters: { [SEM_A]: [], [SEM_B]: [] } }, model);
    expect(addTargets(actions, 'DUAL')).toEqual([SEM_B]);
  });

  test('4. existing offered-letter normalization still holds (getLegalSemesters maps A/B to real ids)', () => {
    const { semesters, confident } = getLegalSemesters(
      { course_type: 'elective', placement_policy: 'elective', offered_semesters: ['A', 'B'] } as any,
      SEMS,
    );
    expect(semesters.sort()).toEqual([SEM_A, SEM_B]);
    expect(confident).toBe(false);
  });
});

describe('planner load-balancing preference (greedy worker)', () => {
  test('5. both legal, A heavier (FIXA=8/A, FIXB=4/B) → DUAL(4) placed in B', () => {
    const model = buildConstraintModel(board([fixed('FIXA', SEM_A, 8), fixed('FIXB', SEM_B, 4), dual()], [DUAL_CAT], 16));
    const w = new PlannerWorker(model);
    w.run(200);
    expect(semOf(w, 'DUAL')).toBe(SEM_B);
    expect(w.validateCandidate().valid).toBe(true);
    // non-vacuous: the score model itself rates B strictly better at the balance goal.
    const inB = { semesters: { [SEM_A]: ['FIXA'], [SEM_B]: ['FIXB', 'DUAL'] } };
    const inA = { semesters: { [SEM_A]: ['FIXA', 'DUAL'], [SEM_B]: ['FIXB'] } };
    expect(compareScore(scorePlan(inB, model), scorePlan(inA, model))).toBeGreaterThan(0);
  });

  test('6. both legal, B heavier (FIXA=4/A, FIXB=8/B) → DUAL(4) placed in A', () => {
    const model = buildConstraintModel(board([fixed('FIXA', SEM_A, 4), fixed('FIXB', SEM_B, 8), dual()], [DUAL_CAT], 16));
    const w = new PlannerWorker(model);
    w.run(200);
    expect(semOf(w, 'DUAL')).toBe(SEM_A);
    expect(w.validateCandidate().valid).toBe(true);
  });

  test('7. A-placement would exceed the hard cap → DUAL goes to B (prior "B when A blocked" locked)', () => {
    // FIXA=6 in A; hardCap 8; DUAL=4 → A would be 10 (illegal), B stays 4 (legal).
    const model = buildConstraintModel(
      board([fixed('FIXA', SEM_A, 6), dual()], [DUAL_CAT], 10),
      { hardCap: 8, maxHoursPerSemester: 8 },
    );
    const w = new PlannerWorker(model);
    w.run(200);
    expect(semOf(w, 'DUAL')).toBe(SEM_B);
    expect(w.validateCandidate().valid).toBe(true);
  });

  test('8. only A offered → DUAL stays in A even though B is lighter (single-semester unchanged)', () => {
    const model = buildConstraintModel(
      board([fixed('FIXA', SEM_A, 8), dual({ offered_semesters: ['A'] })], [DUAL_CAT], 12),
    );
    const w = new PlannerWorker(model);
    w.run(200);
    expect(semOf(w, 'DUAL')).toBe(SEM_A);
  });

  test('9. only B offered → DUAL stays in B', () => {
    const model = buildConstraintModel(
      board([fixed('FIXB', SEM_B, 8), dual({ offered_semesters: ['B'] })], [DUAL_CAT], 12),
    );
    const w = new PlannerWorker(model);
    w.run(200);
    expect(semOf(w, 'DUAL')).toBe(SEM_B);
  });

  test('10. disallowed dual course is blocked in BOTH semesters', () => {
    const model = buildConstraintModel(
      board([dual()], [DUAL_CAT], 4),
      { disallowedCourseIds: ['DUAL'] },
    );
    const w = new PlannerWorker(model);
    w.run(200);
    expect(semOf(w, 'DUAL')).toBeNull();
    // category stays unsatisfied — the disallowed course was not silently placed.
    expect(w.validateCandidate().unsatisfiedCategories).toContain('dc');
  });

  test('control: A has load, B EMPTY → DUAL consolidates into A (scoring model rates A better; permitted)', () => {
    const model = buildConstraintModel(board([fixed('FIXA', SEM_A, 8), dual()], [DUAL_CAT], 12));
    const w = new PlannerWorker(model);
    w.run(200);
    expect(semOf(w, 'DUAL')).toBe(SEM_A);
    // documents WHY: with an empty B, g4 (spread over non-empty semesters) rates
    // A-consolidation (spread 0) above B-spread (spread 4).
    const inA = { semesters: { [SEM_A]: ['FIXA', 'DUAL'], [SEM_B]: [] } };
    const inB = { semesters: { [SEM_A]: ['FIXA'], [SEM_B]: ['DUAL'] } };
    expect(compareScore(scorePlan(inA, model), scorePlan(inB, model))).toBeGreaterThan(0);
  });
});

describe('agentic/beam path shares the same scoring layer', () => {
  test('11/12. beam-path deps (TauPolicyProvider.score/generateActions) rank B over A when A is heavier', () => {
    // The agentic path wires SearchDeps.score = policy.score = scorePlan and
    // .generateActions = enumerateActions (planner_agent.ts / planner_policy.ts),
    // so the identical balance preference holds. Verified here via the same
    // shared functions the beam consumes, plus an end-to-end handler assertion
    // in generate_plan_dual_semester_load_balance.test.ts (agentic path).
    const model = buildConstraintModel(board([fixed('FIXA', SEM_A, 8), fixed('FIXB', SEM_B, 4), dual()], [DUAL_CAT], 16));
    const state = planContextToState({ semesters: [] }, model);
    const inB = { semesters: { [SEM_A]: ['FIXA'], [SEM_B]: ['FIXB', 'DUAL'] } };
    const inA = { semesters: { [SEM_A]: ['FIXA', 'DUAL'], [SEM_B]: ['FIXB'] } };
    expect(compareScore(scorePlan(inB, model), scorePlan(inA, model))).toBeGreaterThan(0);
    // both placements are generated as candidate actions from the empty state.
    expect(addTargets(enumerateActions(state, model), 'DUAL')).toEqual([SEM_A, SEM_B]);
  });
});

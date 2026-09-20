/**
 * Planner Optimization Scorecard / Explanation Contract.
 *
 * `buildPlannerScorecard` is a PURE, read-only helper that EXPLAINS why a plan
 * scores the way it does — it re-exposes the existing signals (`scorePlan`
 * vector, `GOAL_STACK` labels, per-semester loads, peak/spread, over-cap and
 * requirement gaps from `assessCompleteness`) without inventing any new scoring
 * logic or changing planner behavior. Every metric here must agree with the
 * numbers the frozen planner already computes.
 */

import { scorePlan, compareScore, assessCompleteness, GOAL_STACK } from '../../api/ai/planner_goals';
import { buildConstraintModel } from '../../api/ai/planner_model';
import { PlannerWorker } from '../../api/ai/planner_worker';
import type { PlanState } from '../../api/ai/planner_types';
import { buildPlannerScorecard } from '../../api/ai/planner_scorecard';

const SEM_A = 'year_3_semester_a';
const SEM_B = 'year_3_semester_b';
const SEMS = [SEM_A, SEM_B];

/** Board of arbitrary electives; caller controls hours, cap, degree target. */
function mk(
  courses: Array<{ id: string; hours: number; cat?: string }>,
  opts: { totalHours?: number; categories?: any[]; hardCap?: number; maxHours?: number } = {},
) {
  const board = {
    semesters: SEMS.map(id => ({ semester_id: id, courses: [] })),
    metadata: {
      completed_course_ids: [],
      program_requirements_categories: {
        total_required_hours: opts.totalHours ?? 999,
        categories: opts.categories ?? [],
      },
      program_repository_courses: courses.map(c => ({
        course_id: c.id, name_he: c.id, weekly_hours: c.hours,
        is_mandatory: false, course_type: 'elective', placement_policy: 'elective',
        offered_semesters: ['A', 'B'], program_category_id: c.cat ?? null, prerequisites: [],
      })),
    },
  };
  return buildConstraintModel(board, { hardCap: opts.hardCap, maxHoursPerSemester: opts.maxHours });
}

function st(a: string[], b: string[]): PlanState {
  return { semesters: { [SEM_A]: a, [SEM_B]: b } };
}

const five = mk(
  [1, 2, 3, 4, 5].map(i => ({ id: `E${i}`, hours: 4 })),
  { totalHours: 20, hardCap: 26, maxHours: 26 },
);

const PEAK_IDX = GOAL_STACK.indexOf('balance_peak');
const SPREAD_IDX = GOAL_STACK.indexOf('balance_spread');

describe('buildPlannerScorecard — explanation contract', () => {
  test('1. produces the score vector with labels matching GOAL_STACK', () => {
    const state = st(['E1', 'E2', 'E3', 'E4'], ['E5']); // [16, 4]
    const card = buildPlannerScorecard(state, five);

    // exact same vector the planner computes — no re-derivation.
    expect(card.scoreVector).toEqual(scorePlan(state, five));
    // one labeled goal per GOAL_STACK entry, in order, values == the vector.
    expect(card.goals.map(g => g.goal)).toEqual([...GOAL_STACK]);
    expect(card.goals.map(g => g.value)).toEqual(card.scoreVector);
    expect(card.goals).toHaveLength(GOAL_STACK.length);
  });

  test('2. reports per-semester loads correctly', () => {
    const card = buildPlannerScorecard(st(['E1', 'E2', 'E3', 'E4'], ['E5']), five); // [16, 4]
    const byId = Object.fromEntries(card.semesterLoads.map(l => [l.semesterId, l.hours]));
    expect(byId[SEM_A]).toBe(16);
    expect(byId[SEM_B]).toBe(4);
  });

  test('3. reports peak load correctly (and it agrees with the balance_peak score)', () => {
    const card = buildPlannerScorecard(st(['E1', 'E2', 'E3', 'E4'], ['E5']), five); // [16, 4]
    expect(card.peakLoad).toBe(16);
    // faithful to scorePlan: balance_peak == -peak.
    expect(card.peakLoad).toBe(-card.scoreVector[PEAK_IDX]);
  });

  test('4. reports load spread correctly (and it agrees with the balance_spread score)', () => {
    const spread = buildPlannerScorecard(st(['E1', 'E2', 'E3', 'E4'], ['E5']), five); // [16,4] -> 12
    expect(spread.loadSpread).toBe(12);
    expect(spread.loadSpread).toBe(-spread.scoreVector[SPREAD_IDX]);

    // one active semester -> spread 0 (matches scorePlan's non-empty definition).
    const consolidated = buildPlannerScorecard(st(['E1', 'E2', 'E3', 'E4', 'E5'], []), five); // [20,0]
    expect(consolidated.loadSpread).toBe(0);
    expect(consolidated.loadSpread).toBe(-consolidated.scoreVector[SPREAD_IDX]);
  });

  test('5. reports over-cap semesters when caps are available', () => {
    // maxHours 5, hardCap 10: [6,6] is over the user cap in both semesters.
    const m = mk([{ id: 'Y6', hours: 6 }, { id: 'Z6', hours: 6 }], { totalHours: 12, hardCap: 10, maxHours: 5 });
    const card = buildPlannerScorecard(st(['Y6'], ['Z6']), m);
    expect(card.overUserCapSemesters).toEqual([SEM_A, SEM_B]);
    expect(card.overHardCapSemesters).toEqual([]);

    // a hard-cap breach: [12,0] with hardCap 10.
    const m2 = mk([{ id: 'X12', hours: 12 }], { totalHours: 12, hardCap: 10, maxHours: 26 });
    const card2 = buildPlannerScorecard(st(['X12'], []), m2);
    expect(card2.overHardCapSemesters).toEqual([SEM_A]);
    // over-cap summary from assessCompleteness is exposed too.
    expect(card2.overCapSemesters).toEqual(assessCompleteness(st(['X12'], []), m2).overCapSemesters);
  });

  test('6. stable ordering is deterministic', () => {
    const state = st(['E1', 'E2', 'E3', 'E4'], ['E5']);
    const a = buildPlannerScorecard(state, five);
    const b = buildPlannerScorecard(state, five);
    expect(a).toEqual(b);
    // semester loads follow the model's chronological knownSemesterIds order.
    expect(a.semesterLoads.map(l => l.semesterId)).toEqual(five.knownSemesterIds);
    // notes are a deterministic, stable list of strings.
    expect(Array.isArray(a.notes)).toBe(true);
    expect(a.notes.every(n => typeof n === 'string')).toBe(true);
  });

  test('7. does not mutate the plan or the model input', () => {
    const state = st(['E1', 'E2', 'E3', 'E4'], ['E5']);
    const stateBefore = JSON.parse(JSON.stringify(state));
    const semesterKeysBefore = five.knownSemesterIds.slice();
    const mandBefore = five.requiredMandatoryCourseIds.slice();
    const profilesSizeBefore = five.profiles.size;

    buildPlannerScorecard(state, five);

    expect(state).toEqual(stateBefore);
    expect(five.knownSemesterIds).toEqual(semesterKeysBefore);
    expect(five.requiredMandatoryCourseIds).toEqual(mandBefore);
    expect(five.profiles.size).toBe(profilesSizeBefore);
  });

  test('8. existing scorePlan ranking behavior is unchanged (scorecard only reads it)', () => {
    const spread = st(['E1', 'E2', 'E3', 'E4'], ['E5']);        // [16,4]
    const consolidated = st(['E1', 'E2', 'E3', 'E4', 'E5'], []); // [20,0]
    // the established load-distribution policy still holds via the shared scorePlan.
    expect(compareScore(scorePlan(spread, five), scorePlan(consolidated, five))).toBeGreaterThan(0);
    // and the scorecard reflects exactly those vectors (no divergent scoring).
    expect(buildPlannerScorecard(spread, five).scoreVector).toEqual(scorePlan(spread, five));
    expect(buildPlannerScorecard(consolidated, five).scoreVector).toEqual(scorePlan(consolidated, five));
  });
});

describe('buildPlannerScorecard — explains a real dual-offered placement', () => {
  const DC = { category_id: 'dc', name_he: 'קט', min_courses: 1, course_ids: ['DUAL'] };
  const fixedA = { course_id: 'FIXA', name_he: 'FIXA', weekly_hours: 8, is_mandatory: true,
    course_type: 'mandatory', placement_policy: 'fixed', effective_allowed_semesters: [SEM_A],
    recommended_semester: SEM_A, prerequisites: [] };
  const dual = { course_id: 'DUAL', name_he: 'דואלי', weekly_hours: 4, is_mandatory: false,
    course_type: 'elective', placement_policy: 'elective', offered_semesters: ['A', 'B'],
    program_category_id: 'dc', prerequisites: [] };
  const board = {
    semesters: SEMS.map(id => ({ semester_id: id, courses: [] })),
    metadata: { completed_course_ids: [],
      program_requirements_categories: { total_required_hours: 12, categories: [DC] },
      program_repository_courses: [fixedA, dual] },
  };

  test('9. dual course placed in B (A is heavier) — scorecard load metrics explain the choice', () => {
    const model = buildConstraintModel(board);
    const worker = new PlannerWorker(model);
    worker.run(200);
    const chosen = worker.getPlan();

    // sanity: the planner put DUAL in the empty B (lower peak), per policy.
    expect(chosen.semesters[SEM_B]).toContain('DUAL');

    const chosenCard = buildPlannerScorecard(chosen, model);
    // counterfactual: DUAL consolidated onto the heavy A.
    const alt: PlanState = { semesters: { [SEM_A]: ['FIXA', 'DUAL'], [SEM_B]: [] } };
    const altCard = buildPlannerScorecard(alt, model);

    // the metric that explains it: the chosen plan has the lower peak burden.
    expect(chosenCard.peakLoad).toBe(8);
    expect(altCard.peakLoad).toBe(12);
    expect(chosenCard.peakLoad).toBeLessThan(altCard.peakLoad);

    // and per-semester loads make the placement visible.
    const chosenB = chosenCard.semesterLoads.find(l => l.semesterId === SEM_B)!;
    expect(chosenB.hours).toBe(4);
  });
});

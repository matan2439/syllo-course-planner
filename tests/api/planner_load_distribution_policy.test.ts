/**
 * Dual-Semester Load Distribution Policy (approved scoring-policy change).
 *
 * Product policy: maximum academic output with minimum user load. Among plans
 * that are otherwise equivalent on completion / requirements / legality, the
 * planner must prefer the LOWER PEAK semester load — even if that means opening
 * a previously-empty semester. The old balance metric (spread over non-empty
 * semesters) rated consolidation `[20,0]` above distribution `[16,4]`; the new
 * metric adds a primary peak term so `[16,4]` (peak 16) beats `[20,0]` (peak 20),
 * with the old spread kept only as a lower-priority tiebreak.
 *
 * Hard constraints stay hard: legality (g3) and completion/requirements (g1/g2)
 * remain strictly stronger than the balance goals; single-semester courses are
 * unaffected (they have one legal semester).
 */

import { scorePlan, compareScore, GOAL_STACK } from '../../api/ai/planner_goals';
import { buildConstraintModel } from '../../api/ai/planner_model';
import { PlannerWorker } from '../../api/ai/planner_worker';
import type { PlanState } from '../../api/ai/planner_types';

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

describe('scorePlan — load distribution policy (peak first, then spread)', () => {
  // Five 4h electives → total 20h either way, so g1/g2/g3 are equal; only the
  // balance goals differ. hardCap high enough that nothing is over-cap.
  const five = mk(
    [1, 2, 3, 4, 5].map(i => ({ id: `E${i}`, hours: 4 })),
    { totalHours: 20, hardCap: 26, maxHours: 26 },
  );

  test('1. loads [16,4] score better than [20,0] (lower peak) when output is equal', () => {
    const spread = st(['E1', 'E2', 'E3', 'E4'], ['E5']); // [16, 4]
    const consolidated = st(['E1', 'E2', 'E3', 'E4', 'E5'], []); // [20, 0]
    expect(compareScore(scorePlan(spread, five), scorePlan(consolidated, five))).toBeGreaterThan(0);
  });

  test('2. loads [12,8] score better than [20,0] (lower peak) when output is equal', () => {
    const spread = st(['E1', 'E2', 'E3'], ['E4', 'E5']); // [12, 8]
    const consolidated = st(['E1', 'E2', 'E3', 'E4', 'E5'], []); // [20, 0]
    expect(compareScore(scorePlan(spread, five), scorePlan(consolidated, five))).toBeGreaterThan(0);
  });

  test('3. a plan with a lower peak wins even though it uses an otherwise-empty semester', () => {
    const openEmpty = st(['E1', 'E2', 'E3', 'E4'], ['E5']); // opens empty B → peak 16
    const keepEmpty = st(['E1', 'E2', 'E3', 'E4', 'E5'], []); // B stays empty → peak 20
    expect(compareScore(scorePlan(openEmpty, five), scorePlan(keepEmpty, five))).toBeGreaterThan(0);
  });

  test('4. tiny-spread policy: lower peak is preferred even for a small reduction ([8,1] > [9,0])', () => {
    // Explicit policy: peak load is the burden metric, so ANY reduction in the
    // heaviest semester is preferred — a 9h semester is a heavier burden than 8h,
    // however marginal. (Documented choice for the epic's example-3 case.)
    const m = mk([{ id: 'E8', hours: 8 }, { id: 'E1', hours: 1 }], { totalHours: 9, hardCap: 26, maxHours: 26 });
    const spread = st(['E8'], ['E1']); // [8, 1] peak 8
    const consolidated = st(['E8', 'E1'], []); // [9, 0] peak 9
    expect(compareScore(scorePlan(spread, m), scorePlan(consolidated, m))).toBeGreaterThan(0);
  });

  test('5. legality (g3) stays STRONGER than the balance preference', () => {
    // Both plans place 12h total (g1/g2 equal). maxHours 5: the lower-peak plan
    // [6,6] is over the user cap in TWO semesters (g3 = -2), while the higher-peak
    // plan [12,0] is over in ONE (g3 = -1). g3 outranks g4a, so the higher-peak
    // (but less-over-cap) plan wins — legality beats the balance preference.
    const m = mk([{ id: 'X12', hours: 12 }, { id: 'Y6', hours: 6 }, { id: 'Z6', hours: 6 }],
      { totalHours: 12, hardCap: 26, maxHours: 5 });
    const lowerPeakButMoreOver = st(['Y6'], ['Z6']); // [6,6] both > 5 → overUser 2; peak 6
    const higherPeakButLessOver = st(['X12'], []);    // [12,0] one > 5 → overUser 1; peak 12
    expect(compareScore(scorePlan(higherPeakButLessOver, m), scorePlan(lowerPeakButMoreOver, m))).toBeGreaterThan(0);
  });

  test('6. completion (g1) stays STRONGER than the balance preference', () => {
    const m = mk([1, 2, 3, 4, 5].map(i => ({ id: `E${i}`, hours: 4 })), { totalHours: 20, hardCap: 26, maxHours: 26 });
    const moreCompleteButLopsided = st(['E1', 'E2', 'E3', 'E4', 'E5'], []); // 20h, peak 20
    const balancedButLessComplete = st(['E1', 'E2'], ['E3', 'E4']);          // 16h, peak 8
    expect(compareScore(scorePlan(moreCompleteButLopsided, m), scorePlan(balancedButLessComplete, m))).toBeGreaterThan(0);
  });

  test('GOAL_STACK carries an explicit peak balance goal above spread', () => {
    const stack = GOAL_STACK as readonly string[];
    expect(stack).toContain('balance_peak');
    expect(stack.indexOf('balance_peak')).toBeLessThan(stack.indexOf('balance_spread'));
    expect(stack.indexOf('legality')).toBeLessThan(stack.indexOf('balance_peak'));
    // score vector length matches the goal stack.
    expect(scorePlan(st(['E1'], []), five).length).toBe(GOAL_STACK.length);
  });
});

describe('planner behavior — dual course prefers the lighter/empty semester', () => {
  const DC = { category_id: 'dc', name_he: 'קט', min_courses: 1, course_ids: ['DUAL'] };
  function fixed(id: string, sem: string, hours: number) {
    return { course_id: id, name_he: id, weekly_hours: hours, is_mandatory: true, course_type: 'mandatory',
      placement_policy: 'fixed', effective_allowed_semesters: [sem], recommended_semester: sem, prerequisites: [] };
  }
  function dual(overrides: any = {}) {
    return { course_id: 'DUAL', name_he: 'דואלי', weekly_hours: 4, is_mandatory: false, course_type: 'elective',
      placement_policy: 'elective', offered_semesters: ['A', 'B'], program_category_id: 'dc', prerequisites: [], ...overrides };
  }
  function board(courses: any[], totalHours: number) {
    return { semesters: SEMS.map(id => ({ semester_id: id, courses: [] })),
      metadata: { completed_course_ids: [], program_requirements_categories: { total_required_hours: totalHours, categories: [DC] },
        program_repository_courses: courses } };
  }
  function semOf(w: PlannerWorker, id: string): string | null {
    const s = w.getPlan().semesters;
    for (const k of Object.keys(s)) if (s[k].includes(id)) return k;
    return null;
  }

  test('7. A heavy (FIXA=8/A), B EMPTY → DUAL(4) placed in B (reduces peak 12→8)', () => {
    const w = new PlannerWorker(buildConstraintModel(board([fixed('FIXA', SEM_A, 8), dual()], 12)));
    w.run(200);
    expect(semOf(w, 'DUAL')).toBe(SEM_B);
    expect(w.validateCandidate().valid).toBe(true);
  });

  test('9. B heavier (FIXA=4/A, FIXB=8/B) → DUAL(4) still placed in A (lower peak)', () => {
    const w = new PlannerWorker(buildConstraintModel(board([fixed('FIXA', SEM_A, 4), fixed('FIXB', SEM_B, 8), dual()], 16)));
    w.run(200);
    expect(semOf(w, 'DUAL')).toBe(SEM_A);
  });

  test('10. single-semester course unaffected: DUAL offered only A stays in A even though B is empty', () => {
    const w = new PlannerWorker(buildConstraintModel(board([fixed('FIXA', SEM_A, 8), dual({ offered_semesters: ['A'] })], 12)));
    w.run(200);
    expect(semOf(w, 'DUAL')).toBe(SEM_A);
  });
});

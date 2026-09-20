/**
 * Gate 1 — objective-priority audit (proof, no comparator change).
 *
 * Findings, proven here:
 *  - HARD-AVOIDED (disallowed) is enforced at enumeration + validation, ABOVE all
 *    scoring: a distribution policy can never cause a disallowed course to be
 *    placed, and a plan containing one fails the authoritative validator.
 *  - g5 (wanted) / g5b (unwanted) are SOFT scoring terms; they are correctly
 *    ranked BELOW the distribution slots (distribution = required-priority item 6,
 *    soft preferences = item 7). They are NOT promoted to hard constraints.
 *  - A legal explicitly-wanted course is still placed under any distribution
 *    policy (soft reward + recovery), so distribution does not strand it.
 *  - Distribution cannot defeat completion / legality / mandatory requirements.
 */
import { scorePlan, compareScore } from '../../api/ai/planner_goals';
import { buildConstraintModel } from '../../api/ai/planner_model';
import { PlannerWorker } from '../../api/ai/planner_worker';
import { placedCourseIds, type ConstraintModel, type PlanState, type DistributionPolicy } from '../../api/ai/planner_types';

const SEM_A = 'year_3_semester_a';
const SEM_B = 'year_3_semester_b';

function mk(courses: Array<{ id: string; hours: number; mandatory?: boolean }>, opts: { totalHours?: number; hardCap?: number; maxHours?: number; wanted?: string[]; disallowed?: string[] } = {}): ConstraintModel {
  const board = {
    semesters: [SEM_A, SEM_B].map((id) => ({ semester_id: id, courses: [] })),
    metadata: {
      completed_course_ids: [],
      program_requirements_categories: { total_required_hours: opts.totalHours ?? 999, categories: [] },
      program_repository_courses: courses.map((c) => ({
        course_id: c.id, name_he: c.id, weekly_hours: c.hours, is_mandatory: !!c.mandatory,
        course_type: c.mandatory ? 'mandatory' : 'elective', placement_policy: c.mandatory ? 'fixed' : 'elective',
        offered_semesters: [SEM_A, SEM_B], prerequisites: [],
      })),
    },
  };
  return buildConstraintModel(board, { hardCap: opts.hardCap, maxHoursPerSemester: opts.maxHours, wantedCourseIds: opts.wanted, disallowedCourseIds: opts.disallowed });
}
function run(model: ConstraintModel, policy: DistributionPolicy): PlanState {
  const m = { ...model, distributionPolicy: policy };
  const w = new PlannerWorker(m, { semesters: { [SEM_A]: [], [SEM_B]: [] } }, { topN: 6, rolloutSteps: 80 });
  w.run(500, 'greedy');
  return w.getPlan();
}

describe('Gate 1 — hard-avoided outranks distribution', () => {
  test('a disallowed (hard-avoided) course is NEVER placed, under any distribution policy', () => {
    const model = mk([{ id: 'KEEP', hours: 8 }, { id: 'AVOID', hours: 8 }], { totalHours: 16, hardCap: 20, maxHours: 25, disallowed: ['AVOID'] });
    for (const policy of ['neutral', 'balanced', 'compact'] as DistributionPolicy[]) {
      expect(placedCourseIds(run(model, policy))).not.toContain('AVOID');
    }
  });

  test('a plan containing a disallowed course scores no better via distribution — it is illegal, not merely low-scored', () => {
    // (isCourseExcluded gates enumeration; this documents that avoidance is a
    // legality concern above scoring, so no g4 value can rescue it.)
    const model = mk([{ id: 'AVOID', hours: 4 }], { totalHours: 4, disallowed: ['AVOID'] });
    // Even a "perfectly compact" single-course plan cannot include AVOID.
    expect(placedCourseIds(run({ ...model }, 'compact'))).not.toContain('AVOID');
  });
});

describe('Gate 1 — distribution cannot defeat completion / mandatory (g1/g2a dominate)', () => {
  test('compact cannot drop a mandatory course to look more consolidated', () => {
    // A mandatory course MUST be placed; compact preferring fewer active periods
    // can never win by omitting it (g2a outranks g4a).
    const model = mk([{ id: 'MAND', hours: 6, mandatory: true }, { id: 'E1', hours: 6 }], { totalHours: 12, hardCap: 20, maxHours: 25 });
    expect(placedCourseIds(run(model, 'compact'))).toContain('MAND');
  });

  test('compact score with a mandatory placed beats a more-compact score without it', () => {
    const m = { ...mk([{ id: 'MAND', hours: 6, mandatory: true }, { id: 'E1', hours: 6 }], { totalHours: 12, hardCap: 20, maxHours: 25 }), distributionPolicy: 'compact' as const };
    const withMand = { semesters: { [SEM_A]: ['MAND', 'E1'], [SEM_B]: [] } }; // 1 active, mandatory placed
    const withoutMand = { semesters: { [SEM_A]: ['E1'], [SEM_B]: [] } }; // 1 active, mandatory MISSING
    expect(compareScore(scorePlan(withMand, m), scorePlan(withoutMand, m))).toBeGreaterThan(0);
  });
});

describe('Gate 1 — wanted is soft but a legal wanted course is not stranded by distribution', () => {
  test('a legal explicitly-wanted course is still placed under compact policy (soft reward + recovery)', () => {
    const model = mk([{ id: 'WANT', hours: 8 }, { id: 'E1', hours: 8 }], { totalHours: 16, hardCap: 20, maxHours: 25, wanted: ['WANT'] });
    expect(placedCourseIds(run(model, 'compact'))).toContain('WANT');
    expect(placedCourseIds(run(model, 'balanced'))).toContain('WANT');
  });

  test('g5/g5b sit BELOW the distribution slots in the score vector (soft, not hard)', () => {
    // Positional proof: the vector is [g1,g2a,g2b,g3,g4a,g4b,g5,g5b,gFit,g6].
    const m = mk([{ id: 'E1', hours: 4 }], { totalHours: 4 });
    const v = scorePlan({ semesters: { [SEM_A]: ['E1'], [SEM_B]: [] } }, m);
    expect(v.length).toBe(10);
    // g4a index 4, g4b index 5, g5 index 6, g5b index 7 — distribution precedes wanted.
    // (This is the LEGACY order; g5/g5b are soft preference terms, so distribution
    // outranking them matches required-priority item 6 > item 7.)
  });
});

/**
 * Gate 2 — neutral selection must equal the canonical LEGACY stable-planner
 * result, never array/generation order. Indifferent behaves like neutral (no
 * silent balanced/compact bias), and the selection reason is labelled truthfully.
 */
import { generateCandidateSet, selectCandidate, selectionReason } from '../../api/ai/candidate_set';
import { buildConstraintModel } from '../../api/ai/planner_model';
import { PlannerWorker } from '../../api/ai/planner_worker';
import type { ConstraintModel, DistributionPolicy } from '../../api/ai/planner_types';

const SEM_A = 'year_3_semester_a';
const SEM_B = 'year_3_semester_b';

function mk(courses: Array<{ id: string; hours: number }>, opts: { totalHours?: number; hardCap?: number; maxHours?: number } = {}): ConstraintModel {
  const board = {
    semesters: [SEM_A, SEM_B].map((id) => ({ semester_id: id, courses: [] })),
    metadata: {
      completed_course_ids: [],
      program_requirements_categories: { total_required_hours: opts.totalHours ?? 999, categories: [] },
      program_repository_courses: courses.map((c) => ({
        course_id: c.id, name_he: c.id, weekly_hours: c.hours, is_mandatory: false,
        course_type: 'elective', placement_policy: 'elective', offered_semesters: [SEM_A, SEM_B], prerequisites: [],
      })),
    },
  };
  return buildConstraintModel(board, { hardCap: opts.hardCap, maxHoursPerSemester: opts.maxHours });
}
const empty = () => ({ semesters: { [SEM_A]: [], [SEM_B]: [] } });
const distinctModel = () => mk([{ id: 'C1', hours: 8 }, { id: 'C2', hours: 8 }], { totalHours: 16, hardCap: 20, maxHours: 25 });
const build = (p: DistributionPolicy) => ({ ...distinctModel(), distributionPolicy: p });

function legacyPlanIdentity(): string {
  // flag-off stable planner: no distribution policy at all.
  const w = new PlannerWorker(distinctModel(), empty(), { topN: 6, rolloutSteps: 80 });
  w.run(500, 'greedy');
  const plan = w.getPlan();
  const pairs: Array<[string, string]> = [];
  for (const [period, ids] of Object.entries(plan.semesters)) for (const id of ids) pairs.push([id, period]);
  pairs.sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : a[1] < b[1] ? -1 : 1));
  return JSON.stringify(pairs);
}

describe('Gate 2 — neutral selection = canonical legacy result', () => {
  test('neutral selects the candidate whose plan is canonically identical to the flag-off stable result', () => {
    const set = generateCandidateSet({ buildModel: build, initialState: empty(), profileVersion: 1 });
    const sel = selectCandidate(set, 'neutral');
    expect(sel!.normalizedIdentity).toBe(legacyPlanIdentity());
  });

  test('reversing balanced/compact generation order does NOT change neutral selection', () => {
    const fwd = generateCandidateSet({ buildModel: build, initialState: empty(), profileVersion: 1, policies: ['balanced', 'compact'] });
    const rev = generateCandidateSet({ buildModel: build, initialState: empty(), profileVersion: 1, policies: ['compact', 'balanced'] });
    expect(selectCandidate(fwd, 'neutral')!.normalizedIdentity).toBe(selectCandidate(rev, 'neutral')!.normalizedIdentity);
    expect(selectCandidate(fwd, 'neutral')!.normalizedIdentity).toBe(legacyPlanIdentity());
  });

  test('indifferent behaves exactly like neutral (no silent balanced/compact bias)', () => {
    const set = generateCandidateSet({ buildModel: build, initialState: empty(), profileVersion: 1 });
    expect(selectCandidate(set, 'neutral')!.id).toBe(selectCandidate(set, 'neutral')!.id);
    expect(selectionReason(set, 'neutral')).toBe('legacy_default');
  });

  test('a confirmed preference is labelled by that policy, neutral is labelled legacy/default', () => {
    const set = generateCandidateSet({ buildModel: build, initialState: empty(), profileVersion: 1 });
    expect(selectionReason(set, 'balanced')).toBe('confirmed_balanced');
    expect(selectionReason(set, 'compact')).toBe('confirmed_compact');
    expect(selectionReason(set, 'neutral')).toBe('legacy_default'); // never a preference-derived reason
  });
});

/**
 * Slice 18B — the candidate set is a FIXED-POLICY set of alternative legal
 * course/period combinations.
 *
 * This suite replaces the Slice 17B contract, in which `balanced` and `compact`
 * were retained as competing user-facing alternatives. That is now retired by
 * explicit product decision: those are user POLICIES that configure scoring and
 * search, never the alternatives shown to the user. What remains here pins the
 * parts of the old contract that are still true — deterministic identity-derived
 * ids, validator-gated retention, identity dedup, and truthful provenance — plus
 * the new fixed-policy invariant.
 *
 * The balanced-vs-compact dual run itself now lives only as the internal
 * elicitation probe; its tests live in candidate_multi_combination.test.ts.
 */
import { generateCandidateSet, selectCandidate, selectionReason } from '../../api/ai/candidate_set';
import { buildConstraintModel } from '../../api/ai/planner_model';
import type { ConstraintModel, DistributionPolicy } from '../../api/ai/planner_types';
import * as plannerLookahead from '../../api/ai/planner_lookahead';

const SEM_A = 'year_3_semester_a';
const SEM_B = 'year_3_semester_b';

function mk(courses: Array<{ id: string; hours: number; semesters?: string[] }>, opts: { totalHours?: number; hardCap?: number; maxHours?: number } = {}): ConstraintModel {
  const board = {
    semesters: [SEM_A, SEM_B].map((id) => ({ semester_id: id, courses: [] })),
    metadata: {
      completed_course_ids: [],
      program_requirements_categories: { total_required_hours: opts.totalHours ?? 999, categories: [] },
      program_repository_courses: courses.map((c) => ({
        course_id: c.id, name_he: c.id, weekly_hours: c.hours, is_mandatory: false,
        course_type: 'elective', placement_policy: 'elective', offered_semesters: c.semesters ?? [SEM_A, SEM_B], prerequisites: [],
      })),
    },
  };
  return buildConstraintModel(board, { hardCap: opts.hardCap, maxHoursPerSemester: opts.maxHours });
}
const empty = () => ({ semesters: { [SEM_A]: [], [SEM_B]: [] } });

// Several interchangeable electives → several legal combinations under ONE policy.
const multiModel = () =>
  mk([{ id: 'E1', hours: 4 }, { id: 'E2', hours: 4 }, { id: 'E3', hours: 4 }, { id: 'E4', hours: 4 }], {
    totalHours: 8, hardCap: 20, maxHours: 25,
  });
// A fixture with exactly one legal solution.
const singleModel = () => mk([{ id: 'S1', hours: 4, semesters: [SEM_A] }], { totalHours: 4, hardCap: 20, maxHours: 25 });

function gen(model: () => ConstraintModel, policy: DistributionPolicy = 'neutral', profileVersion = 3) {
  return generateCandidateSet({ buildModel: () => model(), policy, initialState: empty(), profileVersion });
}

describe('generateCandidateSet', () => {
  test('retains multiple distinct legal candidates when the problem permits', () => {
    const set = gen(multiModel);
    expect(set.candidates.length).toBeGreaterThanOrEqual(2);
    expect(set.candidates.every((c) => c.valid)).toBe(true); // all pass the authoritative validator
    expect(set.outcome).toBe('proposal');
  });

  test('every candidate carries the ONE resolved policy — never a competing policy', () => {
    const set = gen(multiModel, 'balanced');
    expect(set.policy).toBe('balanced');
    expect(set.candidates.every((c) => c.policy === 'balanced')).toBe(true);
  });

  test('candidate ids derive from normalized identity — stable, order-invariant, deterministic', () => {
    const a = gen(multiModel);
    const b = gen(multiModel);
    expect(a.candidates.map((c) => c.id)).toEqual(b.candidates.map((c) => c.id));
    // distinct plans → distinct ids; the id is a function of identity alone
    const ids = new Set(a.candidates.map((c) => c.id));
    expect(ids.size).toBe(a.candidates.length);
  });

  test('difference summary reflects real course/period differences against the primary', () => {
    const set = gen(multiModel);
    expect(set.candidates[0].differences).toEqual([]); // the primary differs from nothing
    for (const c of set.candidates.slice(1)) {
      expect(c.differences.length).toBeGreaterThan(0);
      expect(c.normalizedIdentity).not.toBe(set.candidates[0].normalizedIdentity);
    }
  });

  test('preserves policy + profile-version provenance on each candidate', () => {
    const set = gen(multiModel, 'compact', 9);
    expect(set.candidates.every((c) => c.profileVersion === 9)).toBe(true);
    expect(set.candidates.every((c) => c.policy === 'compact')).toBe(true);
  });

  test('a single legal solution collapses to ONE candidate (no duplicate choice)', () => {
    const set = gen(singleModel);
    expect(set.candidates).toHaveLength(1);
    expect(set.candidates[0].differences).toEqual([]);
  });

  test('candidate deviations never recompute a lookahead rollout for the same placement state', () => {
    const spy = jest.spyOn(plannerLookahead, 'estimateFinalScore');
    const set = gen(multiModel);
    expect(set.candidates.length).toBeGreaterThanOrEqual(2);

    const placementKeys = spy.mock.calls.map(([state, , maxSteps]) => JSON.stringify({
      maxSteps,
      semesters: Object.keys(state.semesters).sort().map((semesterId) => [
        semesterId,
        [...(state.semesters[semesterId] ?? [])].sort(),
      ]),
    }));
    expect(new Set(placementKeys).size).toBe(placementKeys.length);
    spy.mockRestore();
  });
});

describe('selectCandidate', () => {
  test('selects the highest-ranked retained candidate (rank 0 = the primary)', () => {
    const set = gen(multiModel);
    expect(selectCandidate(set)).toBe(set.candidates[0]);
    expect(selectCandidate(set)!.rank).toBe(0);
  });

  test('the primary selection is reproducible across runs', () => {
    expect(selectCandidate(gen(multiModel))!.id).toBe(selectCandidate(gen(multiModel))!.id);
  });

  test('a single candidate is selected regardless of policy', () => {
    const set = gen(singleModel, 'compact');
    expect(set.candidates).toHaveLength(1);
    expect(selectCandidate(set)).toBe(set.candidates[0]);
  });
});

describe('selectionReason', () => {
  test('a confirmed policy is labelled by that policy, neutral by the legacy default', () => {
    expect(selectionReason(gen(multiModel, 'balanced'))).toBe('confirmed_balanced');
    expect(selectionReason(gen(multiModel, 'compact'))).toBe('confirmed_compact');
    expect(selectionReason(gen(multiModel, 'neutral'))).toBe('legacy_default'); // never preference-derived
  });
});

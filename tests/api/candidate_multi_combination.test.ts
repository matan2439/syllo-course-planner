/**
 * Slice 18B — user policy is NOT candidate identity, and real multi-combination
 * candidate generation.
 *
 * Product policy (binding, this session):
 *   - `balanced` / `compact` / `neutral` CONFIGURE scoring and search. They are
 *     never the alternatives shown to the user. One confirmed profile resolves to
 *     ONE fixed planning policy, and every candidate for that request uses it.
 *   - Candidate diversity comes from different LEGAL course/period combinations
 *     within that same fixed problem.
 *   - The balanced-vs-compact dual run survives ONLY as an internal elicitation
 *     probe, used when `semester_balance` is unanswered.
 */
import {
  generateCandidateSet,
  selectCandidate,
  selectionReason,
  probeBalanceImpact,
  shouldAskBalanceQuestion,
} from '../../api/ai/candidate_set';
import { buildConstraintModel } from '../../api/ai/planner_model';
import { validateCandidate } from '../../api/ai/planner_validate';
import type { ConstraintModel, DistributionPolicy, PlanState } from '../../api/ai/planner_types';

const SEM_A = 'year_3_semester_a';
const SEM_B = 'year_3_semester_b';

interface Raw { id: string; hours: number; semesters?: string[]; mandatory?: boolean }

function mk(courses: Raw[], opts: Parameters<typeof buildConstraintModel>[1] & { totalHours?: number } = {}): ConstraintModel {
  const { totalHours, ...rest } = opts;
  const board = {
    semesters: [SEM_A, SEM_B].map((id) => ({ semester_id: id, courses: [] })),
    metadata: {
      completed_course_ids: [],
      program_requirements_categories: { total_required_hours: totalHours ?? 999, categories: [] },
      program_repository_courses: courses.map((c) => ({
        course_id: c.id, name_he: `קורס ${c.id}`, weekly_hours: c.hours,
        is_mandatory: c.mandatory === true, course_type: c.mandatory ? 'mandatory' : 'elective',
        placement_policy: c.mandatory ? 'mandatory' : 'elective',
        offered_semesters: c.semesters ?? [SEM_A, SEM_B], prerequisites: [],
      })),
    },
  };
  return buildConstraintModel(board, { hardCap: 20, maxHoursPerSemester: 25, ...rest });
}

const empty = (): PlanState => ({ semesters: { [SEM_A]: [], [SEM_B]: [] } });

/**
 * Several interchangeable 4h electives against an 8h degree target: many legal
 * 2-course combinations, all equally complete and legal. The classic "multiple
 * meaningfully different plans that satisfy the same requirements" case.
 */
const manyCombinations = (extra: Parameters<typeof mk>[1] = {}) =>
  mk(
    [
      { id: 'E1', hours: 4 }, { id: 'E2', hours: 4 }, { id: 'E3', hours: 4 },
      { id: 'E4', hours: 4 }, { id: 'E5', hours: 4 },
    ],
    { totalHours: 8, ...extra },
  );

/** Exactly one legal solution: a single course that meets the whole target. */
const singleSolution = () => mk([{ id: 'ONLY', hours: 8, semesters: [SEM_A] }], { totalHours: 8 });

/** No legal solution: the catalog cannot reach the degree target at all. */
const noSolution = () => mk([{ id: 'TINY', hours: 2, semesters: [SEM_A] }], { totalHours: 400 });

function gen(model: () => ConstraintModel, opts: { policy?: DistributionPolicy; profileVersion?: number; maxCandidates?: number } = {}) {
  return generateCandidateSet({
    buildModel: () => model(),
    policy: opts.policy ?? 'neutral',
    initialState: empty(),
    profileVersion: opts.profileVersion ?? 3,
    ...(opts.maxCandidates !== undefined ? { maxCandidates: opts.maxCandidates } : {}),
  });
}

// ── fixed policy ─────────────────────────────────────────────────────────────

describe('one confirmed profile → one fixed planning policy for every candidate', () => {
  test('all candidates share the exact same resolved distribution policy', () => {
    const set = gen(manyCombinations, { policy: 'balanced' });
    expect(set.policy).toBe('balanced');
    expect(set.candidates.every((c) => c.policy === 'balanced')).toBe(true);
  });

  test('confirmed compact produces ONLY compact-policy candidates', () => {
    const set = gen(manyCombinations, { policy: 'compact' });
    expect(set.candidates.length).toBeGreaterThan(0);
    expect(new Set(set.candidates.map((c) => c.policy))).toEqual(new Set(['compact']));
  });

  test('after confirmation, the opposing policy is never retained as a competing alternative', () => {
    for (const policy of ['balanced', 'compact'] as const) {
      const set = gen(manyCombinations, { policy });
      expect(set.candidates.some((c) => c.policy !== policy)).toBe(false);
    }
  });

  test('all candidates share the exact same hard constraints', () => {
    const set = gen(() => manyCombinations({ mustIncludeCourseIds: ['E5'], disallowedCourseIds: ['E1'] }), { policy: 'balanced' });
    expect(set.candidates.length).toBeGreaterThan(0);
    for (const c of set.candidates) {
      const placed = Object.values(c.state.semesters).flat();
      expect(placed).toContain('E5'); // every hard inclusion, in every candidate
      expect(placed).not.toContain('E1'); // every hard exclusion, in every candidate
    }
  });

  test('the selection reason is truthful about where the policy came from', () => {
    expect(selectionReason(gen(manyCombinations, { policy: 'balanced' }))).toBe('confirmed_balanced');
    expect(selectionReason(gen(manyCombinations, { policy: 'compact' }))).toBe('confirmed_compact');
    expect(selectionReason(gen(manyCombinations, { policy: 'neutral' }))).toBe('legacy_default');
  });
});

// ── multi-combination search ─────────────────────────────────────────────────

describe('real multi-combination candidate generation under ONE fixed policy', () => {
  test('a fixture with several legal elective combinations retains at least two DISTINCT candidates', () => {
    const set = gen(manyCombinations);
    expect(set.candidates.length).toBeGreaterThanOrEqual(2);
    const identities = new Set(set.candidates.map((c) => c.normalizedIdentity));
    expect(identities.size).toBe(set.candidates.length); // no duplicate academic identities
  });

  test('every retained candidate passes the SAME authoritative validator', () => {
    const set = gen(manyCombinations);
    for (const c of set.candidates) {
      const report = validateCandidate(c.state, manyCombinations());
      expect(report.valid).toBe(true);
      expect(c.valid).toBe(true);
    }
  });

  test('every retained candidate includes all hard-wanted and excludes all hard-avoided courses', () => {
    const set = gen(() => manyCombinations({ mustIncludeCourseIds: ['E3'], disallowedCourseIds: ['E2'] }));
    expect(set.candidates.length).toBeGreaterThan(0);
    for (const c of set.candidates) {
      const placed = Object.values(c.state.semesters).flat();
      expect(placed).toContain('E3');
      expect(placed).not.toContain('E2');
    }
  });

  test('duplicate academic identities collapse (ordering/ids alone are not a difference)', () => {
    const set = gen(manyCombinations);
    expect(new Set(set.candidates.map((c) => c.id)).size).toBe(set.candidates.length);
    expect(new Set(set.candidates.map((c) => c.normalizedIdentity)).size).toBe(set.candidates.length);
  });

  test('difference summaries match REAL course/period differences against the primary', () => {
    const set = gen(manyCombinations);
    const primary = set.candidates[0];
    for (const c of set.candidates.slice(1)) {
      expect(c.differences.length).toBeGreaterThan(0);
      const primaryPlaced = new Set(Object.values(primary.state.semesters).flat());
      const placed = new Set(Object.values(c.state.semesters).flat());
      for (const d of c.differences) {
        if (d.kind === 'course_added') expect(placed.has(d.courseId!)).toBe(true);
        if (d.kind === 'course_removed') expect(primaryPlaced.has(d.courseId!)).toBe(true);
        if (d.kind === 'course_moved') {
          expect(placed.has(d.courseId!)).toBe(true);
          expect(primaryPlaced.has(d.courseId!)).toBe(true);
        }
      }
    }
  });

  test('repeated runs return the same candidates, ids, order and primary selection', () => {
    const a = gen(manyCombinations);
    const b = gen(manyCombinations);
    expect(a.candidates.map((c) => c.id)).toEqual(b.candidates.map((c) => c.id));
    expect(a.candidates.map((c) => c.normalizedIdentity)).toEqual(b.candidates.map((c) => c.normalizedIdentity));
    expect(selectCandidate(a)!.id).toBe(selectCandidate(b)!.id);
  });

  test('the bounded search respects the configured retention limit', () => {
    expect(gen(manyCombinations, { maxCandidates: 2 }).candidates.length).toBeLessThanOrEqual(2);
    expect(gen(manyCombinations, { maxCandidates: 1 }).candidates.length).toBe(1);
    expect(gen(manyCombinations, { maxCandidates: 3 }).searchBudget.maxCandidates).toBe(3);
  });

  test('one feasible solution returns ONE candidate — no invented alternatives', () => {
    const set = gen(singleSolution);
    expect(set.candidates).toHaveLength(1);
  });

  test('no feasible solution returns an infeasible outcome, never a degraded plan', () => {
    const set = gen(noSolution);
    expect(set.candidates).toHaveLength(0);
    expect(set.outcome).toBe('infeasible');
    expect(set.applyEligible).toBe(false);
  });

  test('additional candidates are valid alternatives, not deliberately worse ones', () => {
    const set = gen(manyCombinations);
    for (const c of set.candidates) expect(c.valid).toBe(true);
    // ranked by the SAME lexicographic scorer, best first
    for (let i = 1; i < set.candidates.length; i++) {
      expect(set.candidates[i].rank).toBe(i);
    }
  });

  test('candidates carry deterministic provenance (policy, profile version, origin)', () => {
    const set = gen(manyCombinations, { profileVersion: 7 });
    expect(set.candidates.every((c) => c.profileVersion === 7)).toBe(true);
    expect(set.candidates[0].provenance).toBe('greedy_baseline');
    expect(set.candidates.slice(1).every((c) => c.provenance.startsWith('deviation:'))).toBe(true);
  });

  test('the flag-off legacy single-plan path is preserved: maxCandidates 1 == the plain greedy result', () => {
    const one = gen(manyCombinations, { maxCandidates: 1 });
    const many = gen(manyCombinations);
    expect(one.candidates[0].normalizedIdentity).toBe(many.legacyIdentity);
    expect(one.candidates[0].provenance).toBe('greedy_baseline');
  });
});

// ── elicitation probe (the ONLY surviving use of the dual run) ────────────────

describe('balanced-vs-compact survives only as an internal elicitation probe', () => {
  test('the probe reports a material difference when the answer could change planning', () => {
    const dual = () => mk([{ id: 'C1', hours: 8 }, { id: 'C2', hours: 8 }], { totalHours: 16 });
    const probe = probeBalanceImpact({ buildModel: (p) => ({ ...dual(), distributionPolicy: p }), initialState: empty() });
    expect(probe.materiallyDifferent).toBe(true);
    expect(probe.differenceSummary.find((f) => f.kind === 'active_periods')).toMatchObject({ balanced: 2, compact: 1 });
    expect(shouldAskBalanceQuestion(probe, { alreadyAnswered: false })).toBe(true);
  });

  test('the probe retains NO candidates — it is an elicitation signal, not an alternative set', () => {
    const dual = () => mk([{ id: 'C1', hours: 8 }, { id: 'C2', hours: 8 }], { totalHours: 16 });
    const probe = probeBalanceImpact({ buildModel: (p) => ({ ...dual(), distributionPolicy: p }), initialState: empty() });
    expect((probe as unknown as { candidates?: unknown }).candidates).toBeUndefined();
  });

  test('the question is not asked when the policies converge, or when already answered', () => {
    const single = () => mk([{ id: 'S1', hours: 4, semesters: [SEM_A] }], { totalHours: 4 });
    const converged = probeBalanceImpact({ buildModel: (p) => ({ ...single(), distributionPolicy: p }), initialState: empty() });
    expect(converged.materiallyDifferent).toBe(false);
    expect(shouldAskBalanceQuestion(converged, { alreadyAnswered: false })).toBe(false);

    const dual = () => mk([{ id: 'C1', hours: 8 }, { id: 'C2', hours: 8 }], { totalHours: 16 });
    const probe = probeBalanceImpact({ buildModel: (p) => ({ ...dual(), distributionPolicy: p }), initialState: empty() });
    expect(shouldAskBalanceQuestion(probe, { alreadyAnswered: true })).toBe(false);
  });
});

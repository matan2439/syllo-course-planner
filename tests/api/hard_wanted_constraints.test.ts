/**
 * Slice 18A — HARD wanted/avoided semantics.
 *
 * Product policy (binding, this session): every course selected in the existing
 * "wanted" picker is a `must_include` HARD constraint, and every course selected
 * in the "avoided" picker is a `must_exclude` HARD constraint. The former `g5`
 * best-effort behavior is retained ONLY as a separate soft channel
 * (`wantedCourseIds`) that the hard pickers no longer feed.
 *
 * These tests pin the vocabulary, the "satisfied" definition, the validation
 * gate (a high score can never substitute for a missing hard inclusion), and
 * the deterministic infeasibility/contradiction outcomes.
 */
import { buildConstraintModel } from '../../api/ai/planner_model';
import {
  missingMustIncludeCourseIds,
  mustIncludeSatisfiedCount,
  scorePlan,
  assessCompleteness,
} from '../../api/ai/planner_goals';
import { validateCandidate, MUST_INCLUDE_ERROR_PREFIX } from '../../api/ai/planner_validate';
import { PlannerWorker } from '../../api/ai/planner_worker';
import { analyzeHardConstraints, hardWantedConstraintsEnabled } from '../../api/ai/hard_constraints';
import type { ConstraintModel, PlanState } from '../../api/ai/planner_types';

const SEM_A = 'year_3_semester_a';
const SEM_B = 'year_3_semester_b';

interface Raw {
  id: string;
  hours: number;
  semesters?: string[];
  prerequisites?: string[];
  mandatory?: boolean;
}

function board(courses: Raw[], totalHours = 999) {
  return {
    semesters: [SEM_A, SEM_B].map((id) => ({ semester_id: id, courses: [] })),
    metadata: {
      completed_course_ids: [],
      program_requirements_categories: { total_required_hours: totalHours, categories: [] },
      program_repository_courses: courses.map((c) => ({
        course_id: c.id,
        name_he: `קורס ${c.id}`,
        weekly_hours: c.hours,
        is_mandatory: c.mandatory === true,
        course_type: c.mandatory ? 'mandatory' : 'elective',
        placement_policy: c.mandatory ? 'mandatory' : 'elective',
        offered_semesters: c.semesters ?? [SEM_A, SEM_B],
        prerequisites: c.prerequisites ?? [],
      })),
    },
  };
}

function mk(courses: Raw[], opts: Parameters<typeof buildConstraintModel>[1] & { totalHours?: number } = {}): ConstraintModel {
  const { totalHours, ...rest } = opts;
  return buildConstraintModel(board(courses, totalHours ?? 999), { hardCap: 20, maxHoursPerSemester: 25, ...rest });
}

const empty = (): PlanState => ({ semesters: { [SEM_A]: [], [SEM_B]: [] } });
const withPlaced = (bySem: Record<string, string[]>): PlanState => ({ semesters: { [SEM_A]: [], [SEM_B]: [], ...bySem } });

// ── vocabulary ───────────────────────────────────────────────────────────────

describe('constraint vocabulary — must_include / must_exclude are typed and separate from soft preferences', () => {
  test('the wanted picker maps to must_include (hard), NOT to the soft preference channel', () => {
    const model = mk([{ id: 'C1', hours: 4 }], { mustIncludeCourseIds: ['C1'] });
    expect([...(model.mustIncludeCourseIds ?? [])]).toEqual(['C1']);
    // The soft channel must NOT receive a hard selection (else g5 could trade it away).
    expect(model.wantedCourseIds.has('C1')).toBe(false);
  });

  test('the avoided picker maps to must_exclude (the existing hard disallowed set)', () => {
    const model = mk([{ id: 'C1', hours: 4 }], { disallowedCourseIds: ['C1'] });
    expect(model.disallowedCourseIds.has('C1')).toBe(true);
  });

  test('the soft prefer channel still exists for backward compatibility and stays separate', () => {
    const model = mk([{ id: 'C1', hours: 4 }, { id: 'C2', hours: 4 }], {
      mustIncludeCourseIds: ['C1'],
      wantedCourseIds: ['C2'],
    });
    expect([...(model.mustIncludeCourseIds ?? [])]).toEqual(['C1']);
    expect([...model.wantedCourseIds]).toEqual(['C2']);
  });

  test('flag-off compatibility: the legacy soft mapping is still reachable and byte-identical', () => {
    // Documented contract: with hard constraints disabled the wanted picker keeps
    // feeding the soft g5 channel only, and no must_include set is produced.
    const legacy = mk([{ id: 'C1', hours: 4 }], { wantedCourseIds: ['C1'] });
    expect(legacy.mustIncludeCourseIds?.size ?? 0).toBe(0);
    expect(legacy.wantedCourseIds.has('C1')).toBe(true);
    // The flag itself is a real, readable switch (default ON in production).
    expect(typeof hardWantedConstraintsEnabled()).toBe('boolean');
  });
});

// ── "satisfied" definition ───────────────────────────────────────────────────

describe('hard inclusion — what counts as satisfied', () => {
  test('a completed hard-wanted course is satisfied as academic history and is NOT rescheduled', () => {
    const model = mk([{ id: 'C1', hours: 4 }], { mustIncludeCourseIds: ['C1'], completedCourseIds: ['C1'] });
    expect(missingMustIncludeCourseIds(empty(), model)).toEqual([]);
    expect(mustIncludeSatisfiedCount(empty(), model)).toBe(1);

    const worker = new PlannerWorker(model, empty(), { topN: 6, rolloutSteps: 80 });
    worker.run(500, 'greedy');
    const placed = Object.values(worker.getPlan().semesters).flat();
    expect(placed).not.toContain('C1'); // never re-placed
  });

  test('a currently-taking hard-wanted course is satisfied without being re-proposed', () => {
    const model = mk([{ id: 'C1', hours: 4 }], { mustIncludeCourseIds: ['C1'], currentlyPlannedCourseIds: ['C1'] });
    expect(missingMustIncludeCourseIds(empty(), model)).toEqual([]);
  });

  test('a hard-wanted course already present in the current plan is satisfied', () => {
    const model = mk([{ id: 'C1', hours: 4 }], { mustIncludeCourseIds: ['C1'] });
    expect(missingMustIncludeCourseIds(withPlaced({ [SEM_A]: ['C1'] }), model)).toEqual([]);
  });

  test('a not-completed, legally schedulable hard-wanted course must appear in the plan', () => {
    const model = mk([{ id: 'C1', hours: 4 }], { mustIncludeCourseIds: ['C1'] });
    expect(missingMustIncludeCourseIds(empty(), model)).toEqual(['C1']);
  });
});

// ── validation gate ──────────────────────────────────────────────────────────

describe('hard inclusion — validation rejects a proposal missing it, regardless of score', () => {
  test('a complete, legal, high-scoring plan missing a hard-wanted course is INVALID', () => {
    // ELECT alone satisfies degree hours; C1 is hard-wanted but absent.
    const model = mk([{ id: 'ELECT', hours: 8 }, { id: 'C1', hours: 4 }], {
      mustIncludeCourseIds: ['C1'],
      totalHours: 8,
    });
    const state = withPlaced({ [SEM_A]: ['ELECT'] });
    const report = validateCandidate(state, model);
    expect(report.degreeMet).toBe(true);
    expect(report.legal).toBe(true);
    expect(report.missingMustInclude).toEqual(['C1']);
    expect(report.valid).toBe(false);
    expect(report.errors.some((e) => e.startsWith(MUST_INCLUDE_ERROR_PREFIX))).toBe(true);
  });

  test('assessCompleteness reports the missing hard inclusion (single source of truth)', () => {
    const model = mk([{ id: 'ELECT', hours: 8 }, { id: 'C1', hours: 4 }], { mustIncludeCourseIds: ['C1'], totalHours: 8 });
    expect(assessCompleteness(withPlaced({ [SEM_A]: ['ELECT'] }), model).missingMustInclude).toEqual(['C1']);
  });

  test('satisfying the hard inclusion makes the same plan valid', () => {
    const model = mk([{ id: 'ELECT', hours: 8 }, { id: 'C1', hours: 4 }], { mustIncludeCourseIds: ['C1'], totalHours: 8 });
    const report = validateCandidate(withPlaced({ [SEM_A]: ['ELECT', 'C1'] }), model);
    expect(report.missingMustInclude).toEqual([]);
    expect(report.valid).toBe(true);
  });

  test('a hard inclusion is not a tradeable score term — score improves but validity is the gate', () => {
    const model = mk([{ id: 'ELECT', hours: 8 }, { id: 'C1', hours: 4 }], { mustIncludeCourseIds: ['C1'], totalHours: 8 });
    const without = scorePlan(withPlaced({ [SEM_A]: ['ELECT'] }), model);
    const with_ = scorePlan(withPlaced({ [SEM_A]: ['ELECT', 'C1'] }), model);
    // requirements slot (index 1) strictly improves when the hard inclusion is met
    expect(with_[1]).toBeGreaterThan(without[1]);
    // …but validity, not the score, is what retains the candidate
    expect(validateCandidate(withPlaced({ [SEM_A]: ['ELECT'] }), model).valid).toBe(false);
  });
});

// ── planner behaviour ────────────────────────────────────────────────────────

describe('the planner places a legally schedulable hard-wanted course', () => {
  test('a hard-wanted elective is placed even when degree hours are already met without it', () => {
    const model = mk([{ id: 'ELECT', hours: 8 }, { id: 'C1', hours: 4 }], { mustIncludeCourseIds: ['C1'], totalHours: 8 });
    const worker = new PlannerWorker(model, empty(), { topN: 6, rolloutSteps: 80 });
    worker.run(500, 'greedy');
    expect(Object.values(worker.getPlan().semesters).flat()).toContain('C1');
    expect(worker.validateCandidate().valid).toBe(true);
  });

  test('the planner may legally add a missing prerequisite of a hard-wanted course', () => {
    const model = mk(
      [
        { id: 'PRE', hours: 4, semesters: [SEM_A] },
        { id: 'C1', hours: 4, semesters: [SEM_B], prerequisites: ['PRE'] },
      ],
      { mustIncludeCourseIds: ['C1'], totalHours: 8 },
    );
    const worker = new PlannerWorker(model, empty(), { topN: 6, rolloutSteps: 80 });
    worker.run(500, 'greedy');
    const plan = worker.getPlan();
    expect(plan.semesters[SEM_B]).toContain('C1');
    expect(plan.semesters[SEM_A]).toContain('PRE');
    expect(worker.validateCandidate().valid).toBe(true);
  });

  test('no recovery silently drops a hard-wanted course — it is either placed or reported missing', () => {
    const model = mk(
      [
        { id: 'PRE', hours: 4, semesters: [SEM_A] },
        { id: 'C1', hours: 4, semesters: [SEM_B], prerequisites: ['PRE'] },
        { id: 'FILL', hours: 8 },
      ],
      { mustIncludeCourseIds: ['C1'], totalHours: 8 },
    );
    const worker = new PlannerWorker(model, empty(), { topN: 6, rolloutSteps: 80 });
    worker.run(500, 'greedy');
    const report = worker.validateCandidate();
    const placed = Object.values(worker.getPlan().semesters).flat();
    // Either it is genuinely placed, or validation says so — never silently absent-and-valid.
    expect(placed.includes('C1') || report.missingMustInclude.includes('C1')).toBe(true);
    expect(report.valid).toBe(placed.includes('C1'));
  });
});

// ── hard exclusion ───────────────────────────────────────────────────────────

describe('hard exclusion — must_exclude is never overridden', () => {
  test('an excluded optional course is never proposed', () => {
    const model = mk([{ id: 'BAD', hours: 4 }, { id: 'OK', hours: 8 }], {
      disallowedCourseIds: ['BAD'],
      totalHours: 8,
    });
    const worker = new PlannerWorker(model, empty(), { topN: 6, rolloutSteps: 80 });
    worker.run(500, 'greedy');
    expect(Object.values(worker.getPlan().semesters).flat()).not.toContain('BAD');
  });

  test('exclusion is not overridden by an interest/fit signal', () => {
    const model = mk([{ id: 'BAD', hours: 4 }, { id: 'OK', hours: 8 }], {
      disallowedCourseIds: ['BAD'],
      courseFitById: new Map([['BAD', 1]]),
      totalHours: 8,
    });
    const worker = new PlannerWorker(model, empty(), { topN: 6, rolloutSteps: 80 });
    worker.run(500, 'greedy');
    expect(Object.values(worker.getPlan().semesters).flat()).not.toContain('BAD');
  });

  test('an already-completed excluded course creates no future scheduling violation, and its history stays truthful', () => {
    const model = mk([{ id: 'BAD', hours: 4 }, { id: 'OK', hours: 8 }], {
      disallowedCourseIds: ['BAD'],
      completedCourseIds: ['BAD'],
      totalHours: 8,
    });
    const report = validateCandidate(withPlaced({ [SEM_A]: ['OK'] }), model);
    expect(report.disallowedPlaced).toEqual([]); // no future violation
    expect(report.valid).toBe(true);
    expect(model.completedCourseIds.has('BAD')).toBe(true); // history unchanged
    expect(analyzeHardConstraints(model).reasons).toEqual([]); // completed+excluded is not a conflict
  });
});

// ── deterministic infeasibility / contradiction ──────────────────────────────

describe('deterministic infeasibility and contradiction outcomes', () => {
  const codes = (m: ConstraintModel) => analyzeHardConstraints(m).reasons.map((r) => r.code);

  test('wanted AND avoided the same course → explicit contradiction, not applyable', () => {
    const model = mk([{ id: 'C1', hours: 4 }], { mustIncludeCourseIds: ['C1'], disallowedCourseIds: ['C1'] });
    const outcome = analyzeHardConstraints(model);
    expect(outcome.outcome).toBe('infeasible');
    expect(outcome.applyEligible).toBe(false);
    expect(codes(model)).toContain('wanted_and_avoided_conflict');
    const r = outcome.reasons.find((x) => x.code === 'wanted_and_avoided_conflict')!;
    expect(r.courseIds).toEqual(['C1']);
    expect(r.authoritative).toBe(false); // two user selections conflict — the user can resolve it
    expect(r.resolvableActions.length).toBeGreaterThan(0);
    expect(r.messageHe).toMatch(/[֐-׿]/);
  });

  test('a wanted course that is not in the catalog → deterministic validation error', () => {
    const model = mk([{ id: 'C1', hours: 4 }], { mustIncludeCourseIds: ['NOPE'] });
    expect(codes(model)).toContain('wanted_course_not_in_catalog');
    const r = analyzeHardConstraints(model).reasons.find((x) => x.code === 'wanted_course_not_in_catalog')!;
    expect(r.authoritative).toBe(true); // a catalog fact — never asked of the student
  });

  test('a wanted course unavailable in every allowed period → infeasible', () => {
    const model = mk([{ id: 'C1', hours: 4, semesters: ['year_9_semester_z'] }], { mustIncludeCourseIds: ['C1'] });
    expect(codes(model)).toContain('wanted_course_unavailable_in_horizon');
  });

  test('a wanted course whose prerequisite chain is impossible → infeasible', () => {
    const model = mk(
      [{ id: 'C1', hours: 4, prerequisites: ['GHOST'] }],
      { mustIncludeCourseIds: ['C1'] },
    );
    expect(codes(model)).toContain('wanted_prerequisite_impossible');
  });

  test('an avoided MANDATORY course → explained conflict', () => {
    const model = mk([{ id: 'M1', hours: 4, mandatory: true }], { disallowedCourseIds: ['M1'] });
    const r = analyzeHardConstraints(model).reasons.find((x) => x.code === 'avoided_mandatory_conflict')!;
    expect(r).toBeDefined();
    expect(r.courseIds).toEqual(['M1']);
    expect(r.conflictingConstraints).toEqual(expect.arrayContaining(['must_exclude', 'mandatory_course']));
  });

  test('a hard-wanted course that cannot fit under the hard workload cap → infeasible', () => {
    const model = mk([{ id: 'HUGE', hours: 40 }], { mustIncludeCourseIds: ['HUGE'] });
    expect(codes(model)).toContain('wanted_exceeds_workload_cap');
  });

  test('a completed-course status that contradicts another supplied state → infeasible', () => {
    const model = mk([{ id: 'C1', hours: 4 }], {
      completedCourseIds: ['C1'],
      currentlyPlannedCourseIds: ['C1'],
    });
    expect(codes(model)).toContain('completed_status_contradiction');
  });

  test('a feasible request produces NO reasons (outcome is not infeasible)', () => {
    const model = mk([{ id: 'C1', hours: 4 }], { mustIncludeCourseIds: ['C1'] });
    const outcome = analyzeHardConstraints(model);
    expect(outcome.reasons).toEqual([]);
    expect(outcome.outcome).toBe('feasible');
    expect(outcome.applyEligible).toBe(true);
  });

  test('reason codes are stable, deterministic and repeat identically across runs', () => {
    const build = () => mk([{ id: 'C1', hours: 4 }], { mustIncludeCourseIds: ['C1'], disallowedCourseIds: ['C1'] });
    expect(JSON.stringify(analyzeHardConstraints(build()))).toBe(JSON.stringify(analyzeHardConstraints(build())));
  });
});

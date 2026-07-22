/**
 * Tests for api/ai/planner_goals.ts — the prioritized goal stack and the single
 * ranking mechanism (scorePlan / compareScore) shared by the worker and both
 * orchestrators. Higher goals must dominate lower ones lexicographically:
 *   1 degree completion > 2 mandatory/category > 3 legality > 4 balance
 *   > 5 user preferences > 6 difficulty/comfort.
 */

import { scorePlan, compareScore, GOAL_STACK, assessCompleteness } from '../../api/ai/planner_goals';
import { PlannerWorker } from '../../api/ai/planner_worker';
import {
  type ConstraintModel,
  type PlanState,
  emptyState,
  placedCourseIds,
} from '../../api/ai/planner_types';
import type { CourseProfile } from '../../api/ai/course_profile';

function profile(id: string, over: Partial<CourseProfile> = {}): CourseProfile {
  return {
    course_id: id,
    name_he: id,
    category_id: null,
    category_name_he: null,
    is_mandatory: false,
    course_type: 'elective',
    placement_policy: 'elective',
    hours: 4,
    offered_semesters: null,
    effective_allowed_semesters: null,
    recommended_semester: null,
    allowed_semesters: null,
    program_allowed_semesters: null,
    prerequisites: [],
    corequisites: [],
    syllabus_url: null,
    syllabus_available: false,
    syllabus_summary_he: null,
    syllabus_topics_he: [],
    assessment_type: null,
    workload_score: null,
    difficulty_score: 3,
    difficulty_level: null,
    grade_average: null,
    is_wanted: false,
    is_unwanted: false,
    excluded: false,
    exclusion_reason: null,
    data_confidence: 0.5,
    provenance: { source: null, data_quality: null, offering_source_url: null, name_source: null },
    ...over,
  };
}

const SEMS = ['year_3_semester_a', 'year_3_semester_b', 'year_4_semester_a', 'year_4_semester_b'];

function model(over: Partial<ConstraintModel> = {}): ConstraintModel {
  const profiles = new Map<string, CourseProfile>();
  for (let i = 0; i < 60; i++) profiles.set(`e${i}`, profile(`e${i}`, { hours: 4 }));
  profiles.set('catFluid', profile('catFluid', { category_id: 'fluids', hours: 4 }));
  return {
    profiles,
    knownSemesterIds: SEMS,
    completedCourseIds: new Set(),
    requiredMandatoryCourseIds: [],
    categories: [{ id: 'fluids', name: 'זורמים', required: 1, candidateIds: ['catFluid'] }],
    degreeRequiredHours: 40,
    priorHours: 0,
    maxHoursPerSemester: 22,
    hardCap: 26,
    disallowedCourseIds: new Set(),
    pinnedCourseIds: new Set(),
    wantedCourseIds: new Set(),
    ...over,
  };
}

function withCourses(sem: string, ids: string[]): PlanState {
  const s = emptyState(SEMS);
  s.semesters[sem] = ids;
  return s;
}

describe('GOAL_STACK', () => {
  it('lists the prioritized goals, completion first and balance split into peak+spread', () => {
    expect(GOAL_STACK[0]).toBe('degree_completion');
    expect(GOAL_STACK).toHaveLength(9);
    expect(GOAL_STACK[GOAL_STACK.length - 1]).toBe('difficulty_comfort');
    // balance is now two goals: peak (primary) above spread (secondary tiebreak).
    expect((GOAL_STACK as readonly string[]).indexOf('balance_peak'))
      .toBeLessThan((GOAL_STACK as readonly string[]).indexOf('balance_spread'));
  });
});

describe('scorePlan — goal priority is lexicographic', () => {
  it('a plan closer to degree completion outranks a less-complete one', () => {
    const m = model();
    const more = withCourses('year_3_semester_a', ['e0', 'e1', 'e2']); // 12h
    const less = withCourses('year_3_semester_a', ['e0']);             // 4h
    expect(compareScore(scorePlan(more, m), scorePlan(less, m))).toBeGreaterThan(0);
  });

  it('once degree hours are equal, satisfying a category wins (goal 2 > goal 4)', () => {
    // Both reach the same hours, but only one places the category course.
    const m = model({ degreeRequiredHours: 8 });
    const withCat = emptyState(SEMS);
    withCat.semesters['year_3_semester_a'] = ['catFluid']; // 4h, satisfies fluids
    withCat.semesters['year_3_semester_b'] = ['e0'];        // 4h
    const withoutCat = emptyState(SEMS);
    withoutCat.semesters['year_3_semester_a'] = ['e1'];     // 4h
    withoutCat.semesters['year_3_semester_b'] = ['e0'];     // 4h, balanced but no category
    expect(compareScore(scorePlan(withCat, m), scorePlan(withoutCat, m))).toBeGreaterThan(0);
  });

  it('with higher goals equal, a balanced plan beats a lopsided one (g4a peak: lower peak wins)', () => {
    // Load Distribution Policy: peak is the primary balance goal.
    // balanced (4h + 4h): peak = 4.
    // lopsided (8h in one sem): peak = 8.
    // Same courses/hours → g1/g2/g3 equal; balanced wins on g4a (lower peak).
    const m = model({ degreeRequiredHours: 8, categories: [] });
    const balanced = emptyState(SEMS);
    balanced.semesters['year_3_semester_a'] = ['e0']; // 4h
    balanced.semesters['year_3_semester_b'] = ['e1']; // 4h
    const lopsided = withCourses('year_3_semester_a', ['e0', 'e1']); // 8h in one sem
    expect(compareScore(scorePlan(balanced, m), scorePlan(lopsided, m))).toBeGreaterThan(0);
  });

  it('with all else equal, lower total difficulty wins (goal 6, tiebreaker)', () => {
    const m = model({ degreeRequiredHours: 4, categories: [] });
    m.profiles.set('easy', profile('easy', { hours: 4, difficulty_score: 1 }));
    m.profiles.set('hard', profile('hard', { hours: 4, difficulty_score: 5 }));
    const easy = withCourses('year_3_semester_a', ['easy']);
    const hard = withCourses('year_3_semester_a', ['hard']);
    expect(compareScore(scorePlan(easy, m), scorePlan(hard, m))).toBeGreaterThan(0);
  });

  it('compareScore returns 0 for identical plans', () => {
    const m = model();
    const a = withCourses('year_3_semester_a', ['e0', 'e1']);
    const b = withCourses('year_3_semester_a', ['e0', 'e1']);
    expect(compareScore(scorePlan(a, m), scorePlan(b, m))).toBe(0);
  });
});

describe('scorePlan — g2 mandatory vs category priority', () => {
  it('placing a mandatory course outranks satisfying a category when hours are equal', () => {
    // Both plans place one 4h course (g1 tied, both short of degree target).
    // Plan A: places the mandatory course (no category satisfied).
    // Plan B: satisfies the category (no mandatory placed).
    // After fix: mandatory completion is a higher sub-goal than category satisfaction.
    const m = model({
      degreeRequiredHours: 20,
      requiredMandatoryCourseIds: ['MAND'],
      categories: [{ id: 'cat', name: 'cat', required: 1, candidateIds: ['CAT'] }],
    });
    m.profiles.set('MAND', profile('MAND', { is_mandatory: true, hours: 4 }));
    m.profiles.set('CAT', profile('CAT', { category_id: 'cat', hours: 4 }));

    const withMandatory = emptyState(SEMS);
    withMandatory.semesters['year_3_semester_a'] = ['MAND'];

    const withCategory = emptyState(SEMS);
    withCategory.semesters['year_3_semester_a'] = ['CAT'];

    expect(compareScore(scorePlan(withMandatory, m), scorePlan(withCategory, m))).toBeGreaterThan(0);
  });

  // Issue #25 Finding #4: g1 (degree_completion) must reserve budget for
  // mandatory courses still unplaced, so electives can't spend "credit" that
  // belongs to them. This test locks the mechanism directly: with 8h of
  // electives already placed and one 2h mandatory course still pending,
  // piling on one more 4h elective (12h real) must NOT outscore placing the
  // mandatory course instead (10h real) — even on g1 ALONE, not just via the
  // lower-priority g2a (mandatory-fraction) tiebreak. Under the old
  // unreserved formula both hit the same min(dh, degreeRequiredHours) cap
  // and only tied (g2a still happened to save the right outcome here); the
  // reservation makes mandatory win outright at the higher-priority g1 tier:
  // budget after the elective add stays at 10-2=8 (MAND still unplaced) so
  // its g1 clips to 8, while budget after the mandatory add rises to 10-0=10
  // so its g1 reaches the full 10. This test alone doesn't prove a behavior
  // change (old code already reached the right answer here via g2a) — the
  // decisive before/after evidence is the PlannerWorker.run() scenario below,
  // which IS RED before this fix and GREEN after it.
  it('g1 alone (not just the g2a tiebreak) ranks a pending mandatory course above piling on more electives past its reserved budget', () => {
    const m = model({
      degreeRequiredHours: 10,
      requiredMandatoryCourseIds: ['MAND'],
      categories: [],
    });
    m.profiles.set('MAND', profile('MAND', { is_mandatory: true, hours: 2 }));
    m.profiles.set('ELECTIVE', profile('ELECTIVE', { hours: 4 }));

    const withMoreElective = withCourses('year_3_semester_a', ['e0', 'e1', 'ELECTIVE']); // 8h existing (e0+e1, 4h each) + 4h = 12h real
    const withMandatoryInstead = withCourses('year_3_semester_a', ['e0', 'e1', 'MAND']); // 8h existing + 2h = 10h real

    const g1Index = 0;
    expect(scorePlan(withMandatoryInstead, m)[g1Index]).toBeGreaterThan(scorePlan(withMoreElective, m)[g1Index]);
    expect(compareScore(scorePlan(withMandatoryInstead, m), scorePlan(withMoreElective, m))).toBeGreaterThan(0);
  });

  // Real end-to-end confirmation of the fix via the actual search
  // (PlannerWorker.run, lookahead disabled to isolate the greedy scoring
  // mechanism this fix changes): 3 mandatory 2h courses + 6 elective 4h
  // courses, degreeRequiredHours=20. Before this fix, the greedy-by-raw-
  // hours search fills the entire 20h target from electives alone before
  // ever placing a mandatory course, then adds all 3 deferred mandatory
  // courses on top — final total 26h (6h avoidable overshoot, reproduced by
  // temporarily reverting just the g1 formula and re-running this exact
  // scenario). After the fix, the reserved budget forces mandatory courses
  // to interleave once the elective share is used up — final total 22h
  // (only 2h left, the unavoidable atomicity slack of not being able to
  // stop exactly on a course boundary).
  it('PlannerWorker.run does not defer all mandatory courses until after the degree target is already spent on electives', () => {
    const profiles = new Map<string, CourseProfile>();
    for (const id of ['M1', 'M2', 'M3']) profiles.set(id, profile(id, { is_mandatory: true, hours: 2 }));
    for (let i = 0; i < 6; i++) profiles.set(`E${i}`, profile(`E${i}`, { hours: 4 }));
    const m = model({
      profiles,
      degreeRequiredHours: 20,
      requiredMandatoryCourseIds: ['M1', 'M2', 'M3'],
      categories: [],
      maxHoursPerSemester: 40,
      hardCap: 40,
    });

    const w = new PlannerWorker(m, undefined, { lookahead: false });
    w.run(50);
    const state = w.getPlan();
    const placed = new Set(placedCourseIds(state));
    let totalHours = 0;
    for (const id of placed) totalHours += m.profiles.get(id)?.hours ?? 0;

    expect(['M1', 'M2', 'M3'].every(id => placed.has(id))).toBe(true);
    // Old behavior overshot to 26h (6h of fully-avoidable deferred-mandatory
    // pile-up); the fix bounds it to the unavoidable atomicity slack of a
    // single 4h elective landing right at the boundary.
    expect(totalHours).toBeLessThanOrEqual(22);
  });

  // Codex finding on this PR: a mandatory course that can NEVER legally fit
  // anywhere (every semester is over the hard cap for it, or it has no
  // legal offering semester at all) must not permanently withhold g1 credit
  // from electives that could otherwise fill the plan — that course's
  // absence already surfaces separately as an honest blocking error
  // (missingMandatory), and reserving budget for something that will never
  // be placed would just needlessly truncate an otherwise-maximal plan.
  it('does not reserve budget for a mandatory course that can never legally fit anywhere', () => {
    const m = model({
      degreeRequiredHours: 10,
      requiredMandatoryCourseIds: ['MAND'],
      categories: [],
      hardCap: 20, // enough room for the electives below, never enough for MAND
    });
    // 100h is larger than the hard cap in every semester — structurally
    // unplaceable no matter what else is on the board.
    m.profiles.set('MAND', profile('MAND', { is_mandatory: true, hours: 100 }));

    const state = withCourses('year_3_semester_a', ['e0', 'e1', 'e2']); // 12h of electives, MAND still unplaced
    const score = scorePlan(state, m);
    // Full target credit (capped only at the real degreeRequiredHours), not
    // withheld/negative because of MAND's unreachable 100h reservation.
    expect(score[0]).toBe(10);
  });

  // Codex finding on this PR: a hard-excluded (user avoid, or profile-level
  // excluded) mandatory course can never be placed either — enumerateActions
  // already keeps it out of every candidate action via isExcluded. Reserving
  // its hours anyway would repeat the exact same over-withholding bug as the
  // "can never legally fit anywhere" case above, just via a different cause.
  it('does not reserve budget for a hard-excluded mandatory course', () => {
    const m = model({
      degreeRequiredHours: 10,
      requiredMandatoryCourseIds: ['MAND'],
      categories: [],
      disallowedCourseIds: new Set(['MAND']),
    });
    m.profiles.set('MAND', profile('MAND', { is_mandatory: true, hours: 4 }));

    const state = withCourses('year_3_semester_a', ['e0', 'e1', 'e2']); // 12h of electives, MAND excluded
    const score = scorePlan(state, m);
    expect(score[0]).toBe(10);
  });

  // Codex finding on this PR: getLegalSemesters can return a fixed/effective
  // semester id that isn't one of the board's actual knownSemesterIds at
  // all — state.semesters only ever has entries for knownSemesterIds, so
  // applyMutation could never actually place the course there. Treating that
  // off-board semester as "empty, so it fits" would wrongly call the course
  // placeable and reserve budget for something that structurally can't be
  // scheduled on this board.
  it('does not reserve budget for a mandatory course fixed to a semester outside the known board', () => {
    const m = model({
      degreeRequiredHours: 10,
      requiredMandatoryCourseIds: ['MAND'],
      categories: [],
    });
    m.profiles.set('MAND', profile('MAND', {
      is_mandatory: true, hours: 4, course_type: 'mandatory', placement_policy: 'fixed',
      recommended_semester: 'year_9_semester_a', // not in SEMS/knownSemesterIds
    }));

    const state = withCourses('year_3_semester_a', ['e0', 'e1', 'e2']); // 12h of electives, MAND unplaceable on this board
    const score = scorePlan(state, m);
    expect(score[0]).toBe(10);
  });

  // Codex finding on this PR: a mandatory course can also be permanently
  // unplaceable via a prerequisite-ordering deadlock, not just offering/cap
  // fit or exclusion — this codebase already has a dedicated fixture for
  // exactly this shape (tests/api/generate_plan_missing_mandatory_gate.test.ts,
  // data/boards/test_program_missing_mandatory_2027.json): MAND2 is only
  // ever legal in year 3, but its prerequisite PRE2 is only ever legal in
  // year 4 — no ordering can ever satisfy both, so MAND2 can never be
  // legally placed. Reproduced here with the same shape.
  it('does not reserve budget for a mandatory course with a permanent prerequisite-ordering deadlock', () => {
    const m = model({
      degreeRequiredHours: 10,
      requiredMandatoryCourseIds: ['MAND2'],
      categories: [],
    });
    m.profiles.set('MAND2', profile('MAND2', {
      is_mandatory: true, hours: 4, course_type: 'mandatory', placement_policy: 'flexible',
      effective_allowed_semesters: ['year_3_semester_a', 'year_3_semester_b'],
      prerequisites: ['PRE2'],
    }));
    m.profiles.set('PRE2', profile('PRE2', {
      hours: 4, effective_allowed_semesters: ['year_4_semester_a', 'year_4_semester_b'],
    }));

    const state = withCourses('year_3_semester_a', ['e0', 'e1', 'e2']); // 12h of electives, MAND2 permanently deadlocked
    const score = scorePlan(state, m);
    expect(score[0]).toBe(10);
  });

  // Codex finding on this PR: the reachability check must honor a CONFIRMED
  // overload the same way validatePlanState does — a mandatory course that
  // only fits above the raw hardCap but under the user-confirmed
  // absoluteMaxReasonable ceiling is legally placeable and must still be
  // reserved, not treated as unreachable.
  it('reserves budget for a mandatory course that only fits under a confirmed overload\'s higher effective cap', () => {
    const m = model({
      degreeRequiredHours: 10,
      requiredMandatoryCourseIds: ['MAND'],
      categories: [],
      hardCap: 6,
      absoluteMaxReasonable: 10,
      overloadAccepted: true,
      overloadConfirmedAt: 1,
    });
    m.profiles.set('MAND', profile('MAND', {
      is_mandatory: true, hours: 4, course_type: 'mandatory', placement_policy: 'fixed',
      recommended_semester: 'year_3_semester_a',
    }));
    // e0 (4h) already occupies MAND's only legal semester: 4+4=8, over the raw
    // hardCap (6) but under the confirmed-overload effective cap (10) — MAND
    // is still legally placeable there. e1 (4h) sits in a different semester
    // so it doesn't crowd MAND's own semester.
    const state = withCourses('year_3_semester_a', ['e0']);
    state.semesters['year_3_semester_b'] = ['e1'];
    const score = scorePlan(state, m);
    // dh = 8 (e0+e1). If MAND is correctly reserved: budget = 10-4=6, g1 =
    // min(8,6) = 6. If the bug were present (MAND wrongly excluded via the
    // raw, unconfirmed hardCap): budget = 10, g1 = min(8,10) = 8.
    expect(score[0]).toBe(6);
  });

  // Codex finding on this PR: reachability must be checked TRANSITIVELY — a
  // mandatory course whose prerequisite has a legally-earlier offering
  // semester on paper is still unreachable if that prerequisite can itself
  // never be placed (e.g. hard-excluded). An ordering-only check would
  // wrongly call the mandatory course reachable and keep reserving its hours.
  it('does not reserve budget for a mandatory course whose prerequisite is itself unreachable', () => {
    const m = model({
      degreeRequiredHours: 10,
      requiredMandatoryCourseIds: ['MAND3'],
      categories: [],
      disallowedCourseIds: new Set(['PRE3']),
    });
    m.profiles.set('MAND3', profile('MAND3', {
      is_mandatory: true, hours: 4, course_type: 'mandatory', placement_policy: 'flexible',
      effective_allowed_semesters: ['year_3_semester_b'],
      prerequisites: ['PRE3'],
    }));
    m.profiles.set('PRE3', profile('PRE3', {
      hours: 4, effective_allowed_semesters: ['year_3_semester_a'], // legally earlier than MAND3, but hard-excluded
    }));

    const state = withCourses('year_3_semester_a', ['e0', 'e1', 'e2']); // 12h of electives, MAND3 transitively unreachable
    const score = scorePlan(state, m);
    expect(score[0]).toBe(10);
  });
});

describe('scorePlan — g5b unwanted_avoidance penalty', () => {
  it('a plan with an unwanted placed course scores worse than one with a neutral course', () => {
    // Both plans reach degree target (4h), g1 tied. No mandatory/categories, so g2a=g2b=1.
    // Neither is wanted, so g5=0. BAD is unwanted → g5b = -1. GOOD is neutral → g5b = 0.
    const m = model({ degreeRequiredHours: 4, categories: [], requiredMandatoryCourseIds: [] });
    m.profiles.set('BAD', profile('BAD', { is_unwanted: true, hours: 4 }));
    m.profiles.set('GOOD', profile('GOOD', { is_unwanted: false, hours: 4 }));

    const withUnwanted = withCourses('year_3_semester_a', ['BAD']);
    const withNeutral = withCourses('year_3_semester_a', ['GOOD']);

    expect(compareScore(scorePlan(withNeutral, m), scorePlan(withUnwanted, m))).toBeGreaterThan(0);
  });
});

describe('placedHours — annual course deduplication', () => {
  it('two courses sharing root_course_id with count_hours_once count as one in g1', () => {
    // Annual courses: course_A (semester A) and course_B (semester B) are the same annual
    // course across two semesters. Both placed → degreeHours should be 3, not 6.
    const m = model({ degreeRequiredHours: 40, categories: [], priorHours: 0 });
    m.profiles.set('ANN_A', profile('ANN_A', { hours: 3, root_course_id: 'ANN', count_hours_once: true }));
    m.profiles.set('ANN_B', profile('ANN_B', { hours: 3, root_course_id: 'ANN', count_hours_once: true }));

    const state = emptyState(SEMS);
    state.semesters['year_3_semester_a'] = ['ANN_A'];
    state.semesters['year_3_semester_b'] = ['ANN_B'];

    const score = scorePlan(state, m);
    // g1 = min(degreeHours, degreeRequiredHours). degreeHours must be 3 (deduplicated), not 6.
    expect(score[0]).toBe(3);
  });

  it('courses without root_course_id are not deduplicated (normal behaviour)', () => {
    const m = model({ degreeRequiredHours: 40, categories: [], priorHours: 0 });
    m.profiles.set('C1', profile('C1', { hours: 3 }));
    m.profiles.set('C2', profile('C2', { hours: 3 }));

    const state = emptyState(SEMS);
    state.semesters['year_3_semester_a'] = ['C1', 'C2'];

    const score = scorePlan(state, m);
    expect(score[0]).toBe(6); // 3 + 3, no dedup
  });

  // Codex round-10 finding on PR #37: the atomic is_annual bundling mechanism
  // (planner_actions.ts's addCourseActionsFor) places the SAME course id into
  // multiple state.semesters entries — a different shape than the
  // root_course_id-paired scheme above (two DIFFERENT ids). Without
  // deduplicating by id itself, a 4h annual course spanning two semesters
  // contributed 8h to degreeHours, letting the planner believe the hour
  // target was met too early.
  it('a single is_annual course id placed in two semesters counts its hours once, even without count_hours_once/root_course_id', () => {
    const m = model({ degreeRequiredHours: 40, categories: [], priorHours: 0 });
    m.profiles.set('ANNUAL', profile('ANNUAL', { hours: 4, is_annual: true, spans_semesters: ['year_3_semester_a', 'year_3_semester_b'] }));

    const state = emptyState(SEMS);
    state.semesters['year_3_semester_a'] = ['ANNUAL'];
    state.semesters['year_3_semester_b'] = ['ANNUAL'];

    const score = scorePlan(state, m);
    expect(score[0]).toBe(4); // not 8
  });
});

describe('assessCompleteness', () => {
  // The shared completeness judgment used by both TauPolicyProvider.isGoal
  // (planner_policy.ts) and validateCandidate (planner_validate.ts) — moved
  // here so both consumers delegate to one implementation instead of each
  // recomputing degreeMet/missingMandatory/unsatisfiedCategories/overCapSemesters.

  it('reports a missing mandatory course', () => {
    const m = model({ requiredMandatoryCourseIds: ['MAND'], categories: [], degreeRequiredHours: 4 });
    m.profiles.set('MAND', profile('MAND', { is_mandatory: true, hours: 4 }));
    const state = withCourses('year_3_semester_a', ['e0']); // MAND never placed
    const r = assessCompleteness(state, m);
    expect(r.missingMandatory).toEqual(['MAND']);
    expect(r.degreeMet).toBe(true);
  });

  it('reports an unsatisfied category', () => {
    const m = model({ degreeRequiredHours: 4 }); // default categories: fluids <- catFluid
    const state = withCourses('year_3_semester_a', ['e0']); // catFluid never placed
    const r = assessCompleteness(state, m);
    expect(r.unsatisfiedCategories).toEqual(['fluids']);
  });

  it('reports degreeMet=false and the actual degreeHours when below target', () => {
    const m = model({ degreeRequiredHours: 40, categories: [] });
    const state = withCourses('year_3_semester_a', ['e0']); // 4h < 40
    const r = assessCompleteness(state, m);
    expect(r.degreeMet).toBe(false);
    expect(r.degreeHours).toBe(4);
  });

  it('reports an over-cap semester by id', () => {
    const m = model({ degreeRequiredHours: 4, categories: [], hardCap: 10 });
    const state = withCourses('year_3_semester_a', ['e0', 'e1', 'e2']); // 12h > hardCap 10
    const r = assessCompleteness(state, m);
    expect(r.overCapSemesters).toEqual(['year_3_semester_a']);
  });

  // Phase 2C overload-override parity with plan_validation.ts's Phase 2C policy
  // (validatePlanState honors overloadAccepted+overloadConfirmedAt; assessCompleteness
  // must agree so isGoal/validate never disagree about the same plan).
  it('does not report an over-hardCap semester as over-cap when overload is confirmed', () => {
    const m = model({
      degreeRequiredHours: 4, categories: [], hardCap: 26,
      overloadAccepted: true, overloadConfirmedAt: Date.now(),
    });
    // 7 courses x 4h = 28h: over hardCap(26), under ABSOLUTE_MAX_REASONABLE(30)
    const state = withCourses('year_3_semester_a', ['e0', 'e1', 'e2', 'e3', 'e4', 'e5', 'e6']);
    const r = assessCompleteness(state, m);
    expect(r.overCapSemesters).toEqual([]);
  });

  it('still reports over-cap when overloadAccepted is true but overloadConfirmedAt is missing', () => {
    const m = model({
      degreeRequiredHours: 4, categories: [], hardCap: 26,
      overloadAccepted: true, // overloadConfirmedAt intentionally not set
    });
    const state = withCourses('year_3_semester_a', ['e0', 'e1', 'e2', 'e3', 'e4', 'e5', 'e6']); // 28h
    const r = assessCompleteness(state, m);
    expect(r.overCapSemesters).toEqual(['year_3_semester_a']);
  });

  it('still reports over-cap above ABSOLUTE_MAX_REASONABLE even with overload confirmed', () => {
    const m = model({
      degreeRequiredHours: 4, categories: [], hardCap: 26,
      overloadAccepted: true, overloadConfirmedAt: Date.now(),
    });
    // 8 courses x 4h = 32h: over ABSOLUTE_MAX_REASONABLE(30) — never overridable
    const state = withCourses('year_3_semester_a', ['e0', 'e1', 'e2', 'e3', 'e4', 'e5', 'e6', 'e7']);
    const r = assessCompleteness(state, m);
    expect(r.overCapSemesters).toEqual(['year_3_semester_a']);
  });

  // Phase 1b — absoluteMaxReasonable is now a model field (defaulting to
  // load_constants.ts's ABSOLUTE_MAX_REASONABLE), so a PolicyProvider serving a
  // different program/institution can raise it without editing shared code.
  it('respects a model-level absoluteMaxReasonable override (raises the previously-fixed ceiling)', () => {
    const m = model({
      degreeRequiredHours: 4, categories: [], hardCap: 26,
      overloadAccepted: true, overloadConfirmedAt: Date.now(),
      absoluteMaxReasonable: 40, // raised above the default 30
    });
    // 8 courses x 4h = 32h: over the default ABSOLUTE_MAX_REASONABLE(30), under this model's 40
    const state = withCourses('year_3_semester_a', ['e0', 'e1', 'e2', 'e3', 'e4', 'e5', 'e6', 'e7']);
    const r = assessCompleteness(state, m);
    expect(r.overCapSemesters).toEqual([]);
  });

  it('returns empty gap lists and degreeMet=true when everything is satisfied', () => {
    const m = model({ requiredMandatoryCourseIds: ['MAND'], degreeRequiredHours: 12, hardCap: 26 });
    m.profiles.set('MAND', profile('MAND', { is_mandatory: true, hours: 4 }));
    const state = emptyState(SEMS);
    state.semesters['year_3_semester_a'] = ['MAND', 'catFluid', 'e0']; // 4+4+4 = 12
    const r = assessCompleteness(state, m);
    expect(r.degreeMet).toBe(true);
    expect(r.missingMandatory).toEqual([]);
    expect(r.unsatisfiedCategories).toEqual([]);
    expect(r.overCapSemesters).toEqual([]);
  });
});

describe('scorePlan — g4 empty semester penalty', () => {
  it('a board with one non-empty semester is not penalized vs two equally-loaded semesters', () => {
    // Use a 2-semester model so empty-semester effect is unambiguous.
    // oneActive: one course in sem-A, sem-B empty.
    //   Before fix: spread = 4-0 = 4, g4 = -4.
    //   After fix:  spread = max([4])-min([4]) = 0, g4 = 0.
    // twoBalanced: one course in each sem (equal load, no empty sem).
    //   Both before and after fix: spread = 4-4 = 0, g4 = 0.
    // g1 is equal (both capped at degreeRequiredHours=4).
    // After fix: oneActive should be >= twoBalanced (same g4=0, oneActive wins g6 by fewer courses).
    // Before fix: oneActive loses at g4 (-4 vs 0) → compareScore < 0.
    const SEMS2 = ['year_3_semester_a', 'year_3_semester_b'];
    const m = model({ degreeRequiredHours: 4, categories: [], knownSemesterIds: SEMS2 });

    const oneActive: PlanState = { semesters: { 'year_3_semester_a': ['e0'], 'year_3_semester_b': [] } };
    const twoBalanced: PlanState = { semesters: { 'year_3_semester_a': ['e0'], 'year_3_semester_b': ['e1'] } };

    expect(compareScore(scorePlan(oneActive, m), scorePlan(twoBalanced, m))).toBeGreaterThanOrEqual(0);
  });
});

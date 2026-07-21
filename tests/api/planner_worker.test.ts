/**
 * Tests for api/ai/planner_worker.ts — the deterministic Planner Worker:
 * the Observe→Reason→Act→Validate loop, deterministic tools, validate-after-
 * every-mutation (reject + rollback on a new error), the trace, and goal-driven
 * convergence. Covers plan tests 10 (trace), 13 (deterministic totals),
 * 14 (deterministic prerequisites), 15 (deterministic category satisfaction),
 * plus the goal-loop convergence behavior.
 */

import { PlannerWorker } from '../../api/ai/planner_worker';
import {
  type ConstraintModel,
  type PlanState,
  emptyState,
  placedCourseIds,
  semesterOf,
} from '../../api/ai/planner_types';
import type { CourseProfile } from '../../api/ai/course_profile';

const SEMS = ['year_3_semester_a', 'year_3_semester_b', 'year_4_semester_a', 'year_4_semester_b'];

function profile(id: string, over: Partial<CourseProfile> = {}): CourseProfile {
  return {
    course_id: id, name_he: id, category_id: null, category_name_he: null,
    is_mandatory: false, course_type: 'elective', placement_policy: 'elective',
    hours: 4, offered_semesters: null, effective_allowed_semesters: null,
    recommended_semester: null, allowed_semesters: null, program_allowed_semesters: null,
    prerequisites: [], corequisites: [], syllabus_url: null, syllabus_available: false,
    syllabus_summary_he: null, syllabus_topics_he: [], assessment_type: null,
    workload_score: null, difficulty_score: 3, difficulty_level: null, grade_average: null,
    is_wanted: false, is_unwanted: false, excluded: false, exclusion_reason: null,
    data_confidence: 0.5,
    provenance: { source: null, data_quality: null, offering_source_url: null, name_source: null },
    ...over,
  };
}

/** Model: 1 fixed mandatory, 1 category (2 candidates), a pool of electives. */
function buildModel(over: Partial<ConstraintModel> = {}): ConstraintModel {
  const profiles = new Map<string, CourseProfile>();
  profiles.set('MAND', profile('MAND', {
    is_mandatory: true, course_type: 'mandatory', placement_policy: 'fixed',
    recommended_semester: 'year_3_semester_a',
    effective_allowed_semesters: ['year_3_semester_a'], hours: 5,
  }));
  profiles.set('FLU1', profile('FLU1', { category_id: 'fluids', hours: 4 }));
  profiles.set('FLU2', profile('FLU2', { category_id: 'fluids', hours: 4 }));
  for (let i = 0; i < 12; i++) profiles.set(`E${i}`, profile(`E${i}`, { hours: 4 }));
  return {
    profiles, knownSemesterIds: SEMS,
    completedCourseIds: new Set(),
    requiredMandatoryCourseIds: ['MAND'],
    categories: [{ id: 'fluids', name: 'זורמים', required: 1, candidateIds: ['FLU1', 'FLU2'] }],
    degreeRequiredHours: 25, priorHours: 0,
    maxHoursPerSemester: 22, hardCap: 26,
    disallowedCourseIds: new Set(), pinnedCourseIds: new Set(), wantedCourseIds: new Set(),
    ...over,
  };
}

describe('PlannerWorker — deterministic tools & validate-after-mutation', () => {
  it('addCourse places a course and records an ADD_COURSE pass action (test 10)', () => {
    const w = new PlannerWorker(buildModel());
    const r = w.addCourse('E0', 'year_3_semester_a');
    expect(r.accepted).toBe(true);
    expect(semesterOf(w.getPlan(), 'E0')).toBe('year_3_semester_a');
    const last = w.getTrace().at(-1)!;
    expect(last.action).toBe('ADD_COURSE');
    expect(last.validationAfterAction).toBe('pass');
    expect(last.constraintsChecked.length).toBeGreaterThan(0);
  });

  it('rejects + rolls back an illegal-semester placement (effective_allowed_semesters)', () => {
    const w = new PlannerWorker(buildModel());
    const r = w.addCourse('MAND', 'year_4_semester_b'); // MAND only legal in y3a
    expect(r.accepted).toBe(false);
    expect(r.errorsIntroduced.length).toBeGreaterThan(0);
    expect(placedCourseIds(w.getPlan())).not.toContain('MAND');
    expect(w.getTrace().at(-1)!.validationAfterAction).toBe('fail');
  });

  it('enforces prerequisite strict timing deterministically (test 14)', () => {
    const m = buildModel();
    m.profiles.set('A', profile('A', { hours: 3 }));
    m.profiles.set('B', profile('B', { hours: 3, prerequisites: ['A'] }));
    const w = new PlannerWorker(m);
    w.addCourse('A', 'year_3_semester_a');
    // same semester as prereq → rejected
    expect(w.addCourse('B', 'year_3_semester_a').accepted).toBe(false);
    // strictly-later semester → accepted
    expect(w.addCourse('B', 'year_3_semester_b').accepted).toBe(true);
  });

  it('computes degree totals deterministically from profiles, not text (test 13)', () => {
    const w = new PlannerWorker(buildModel({ priorHours: 100 }));
    w.addCourse('E0', 'year_3_semester_a'); // +4
    w.addCourse('E1', 'year_3_semester_b'); // +4
    expect(w.getState().degreeHours).toBe(108);
  });

  it('reports category satisfaction deterministically (test 15)', () => {
    const w = new PlannerWorker(buildModel());
    expect(w.getState().categoriesSatisfied).toBe(0);
    w.addCourse('FLU1', 'year_4_semester_a');
    expect(w.getState().categoriesSatisfied).toBe(1);
  });
});

describe('PlannerWorker — goal-driven convergence', () => {
  it('run() builds a complete, legal plan and stops at the goal', () => {
    const w = new PlannerWorker(buildModel());
    w.run();
    const st = w.getState();
    expect(w.isGoalReached()).toBe(true);
    expect(st.degreeHours).toBeGreaterThanOrEqual(25); // degree target met
    expect(st.mandatoryPlaced).toBe(1);
    expect(st.categoriesSatisfied).toBe(1);
    // no semester over the hard cap
    expect(Math.max(...Object.values(st.semesterLoads))).toBeLessThanOrEqual(26);
    // a STOP action is the last recorded step
    expect(w.getTrace().at(-1)!.action).toBe('STOP');
  });

  it('converges even from a suboptimal starting placement (not a fixed greedy order)', () => {
    const m = buildModel();
    // Start with electives crammed into one semester — a bad initial layout.
    const start: PlanState = emptyState(SEMS);
    start.semesters['year_3_semester_b'] = ['E0', 'E1', 'E2'];
    const w = new PlannerWorker(m, start);
    w.run();
    expect(w.isGoalReached()).toBe(true);
    expect(Math.max(...Object.values(w.getState().semesterLoads))).toBeLessThanOrEqual(26);
  });

  it('places a hard-but-required course rather than stopping short (completion over difficulty, test 6)', () => {
    // EASY alone (4h) cannot reach the 8h target; HARD (difficulty 5) is required
    // to complete. High difficulty must never block a needed placement.
    const profiles = new Map<string, CourseProfile>();
    profiles.set('EASY', profile('EASY', { hours: 4, difficulty_score: 1 }));
    profiles.set('HARD', profile('HARD', { hours: 4, difficulty_score: 5 }));
    const m: ConstraintModel = {
      profiles, knownSemesterIds: SEMS, completedCourseIds: new Set(),
      requiredMandatoryCourseIds: [], categories: [],
      degreeRequiredHours: 8, priorHours: 0, maxHoursPerSemester: 22, hardCap: 26,
      disallowedCourseIds: new Set(), pinnedCourseIds: new Set(), wantedCourseIds: new Set(),
    };
    const w = new PlannerWorker(m);
    w.run();
    expect(w.isGoalReached()).toBe(true);
    expect(placedCourseIds(w.getPlan())).toContain('HARD');
  });

  it('never places an explicitly disallowed course', () => {
    const m = buildModel({ disallowedCourseIds: new Set(['FLU1']) });
    m.profiles.get('FLU1')!.excluded = true;
    const w = new PlannerWorker(m);
    w.run();
    expect(placedCourseIds(w.getPlan())).not.toContain('FLU1');
  });
});

describe('PlannerWorker — explain (test 11: explanation matches the selected plan)', () => {
  it('references only courses present in the plan or trace, and reports requirements + stop', () => {
    const w = new PlannerWorker(buildModel());
    w.run();
    const ex = w.explain();

    const placed = new Set(placedCourseIds(w.getPlan()));
    const traceIds = new Set(w.getTrace().map(a => a.courseId).filter(Boolean) as string[]);
    // no divergence: every referenced course is in the plan or was acted on in the trace
    for (const id of ex.referencedCourseIds) {
      expect(placed.has(id) || traceIds.has(id)).toBe(true);
    }
    expect(ex.referencedCourseIds.length).toBeGreaterThan(0);
    expect(ex.requirements_he.length).toBeGreaterThan(0);
    expect(ex.placements_he.length).toBeGreaterThan(0);
    expect(ex.stop_he.length).toBeGreaterThan(0);
    expect(typeof ex.summary_he).toBe('string');
  });

  it('explains rejected alternatives with reasons', () => {
    const m = buildModel({ disallowedCourseIds: new Set(['FLU1']) });
    m.profiles.get('FLU1')!.excluded = true;
    const w = new PlannerWorker(m);
    // explicitly attempt the disallowed course so a REJECT_COURSE is traced
    w.addCourse('FLU1', 'year_4_semester_a');
    w.run();
    const ex = w.explain();
    expect(ex.rejections_he.some(r => r.includes('FLU1') || r.includes('לא-זמין'))).toBe(true);
  });
});

describe('PlannerWorker — repair (validation failure → repair → revalidate)', () => {
  // Two electives crammed into one semester (28h > hardCap 26); both movable.
  function overloadedModel(): ConstraintModel {
    const profiles = new Map<string, CourseProfile>();
    profiles.set('X', profile('X', { hours: 14 }));
    profiles.set('Y', profile('Y', { hours: 14 }));
    return {
      profiles, knownSemesterIds: SEMS, completedCourseIds: new Set(),
      requiredMandatoryCourseIds: [], categories: [],
      degreeRequiredHours: 28, priorHours: 0, maxHoursPerSemester: 22, hardCap: 26,
      disallowedCourseIds: new Set(), pinnedCourseIds: new Set(), wantedCourseIds: new Set(),
    };
  }

  it('repairs an over-cap semester (test 3 / test 9) and records a REPAIR-phase action', () => {
    const start: PlanState = emptyState(SEMS);
    start.semesters['year_3_semester_a'] = ['X', 'Y']; // 28h > 26
    const w = new PlannerWorker(overloadedModel(), start);
    expect(w.validate().valid).toBe(false); // starts invalid (overload)
    const report = w.repair();
    expect(report.valid).toBe(true); // overload resolved
    expect(Math.max(...Object.values(w.getState().semesterLoads))).toBeLessThanOrEqual(26);
    expect(w.getTrace().some(a => a.phase === 'REPAIR')).toBe(true);
  });
});

describe('PlannerWorker — downstream-impact reasoning (a legal action is not a good action)', () => {
  // C is flexible (y4a or y4b); NARROW fits only in y4b. Starting with C wrongly
  // parked in y4b blocks NARROW (10+18 > 26). Moving C to y4a yields no immediate
  // score gain, so a myopic worker leaves it and can never complete; a worker that
  // reasons over future consequences moves C and then places NARROW → complete.
  function abModel(): ConstraintModel {
    const profiles = new Map<string, CourseProfile>();
    profiles.set('C', profile('C', { hours: 10, effective_allowed_semesters: ['year_4_semester_a', 'year_4_semester_b'] }));
    profiles.set('NARROW', profile('NARROW', { hours: 18, effective_allowed_semesters: ['year_4_semester_b'] }));
    return {
      profiles, knownSemesterIds: SEMS, completedCourseIds: new Set(),
      requiredMandatoryCourseIds: [], categories: [],
      degreeRequiredHours: 28, priorHours: 0,
      maxHoursPerSemester: 22, hardCap: 26,
      disallowedCourseIds: new Set(), pinnedCourseIds: new Set(), wantedCourseIds: new Set(),
    };
  }

  function startWithCinB(): PlanState {
    const s = emptyState(SEMS);
    s.semesters['year_4_semester_b'] = ['C'];
    return s;
  }

  it('the myopic worker (lookahead OFF) gets stuck and cannot complete', () => {
    const w = new PlannerWorker(abModel(), startWithCinB(), { lookahead: false });
    w.run();
    expect(w.isGoalReached()).toBe(false); // NARROW never placeable while C blocks y4b
  });

  it('the worker with downstream reasoning (lookahead ON) moves C and completes', () => {
    const w = new PlannerWorker(abModel(), startWithCinB(), { lookahead: true });
    w.run();
    expect(w.isGoalReached()).toBe(true);
    expect(semesterOf(w.getPlan(), 'C')).toBe('year_4_semester_a');
    expect(semesterOf(w.getPlan(), 'NARROW')).toBe('year_4_semester_b');
  });
});

describe('PlannerWorker — feasibility ranks actions, it must never eliminate every action', () => {
  // A real board can legitimately span fewer semesters than the full degree
  // needs (e.g. a "years 3-4 only" board for a student whose prior-hours
  // record is missing/low): the aggregate degree-hours headroom check in
  // projectFeasibility then correctly reports that the FULL target can never
  // be reached from here — but that must never mean the worker takes ZERO
  // actions and returns a silently empty plan. It must still place whatever
  // it legally and usefully can (e.g. a needed mandatory course), the same
  // way a human advisor would build out as much of the plan as fits rather
  // than refusing to touch it at all.
  function unreachableTargetModel(): ConstraintModel {
    const profiles = new Map<string, CourseProfile>();
    profiles.set('MAND', profile('MAND', {
      is_mandatory: true, course_type: 'mandatory', placement_policy: 'fixed',
      effective_allowed_semesters: ['year_3_semester_a'], hours: 5,
    }));
    return {
      profiles, knownSemesterIds: SEMS, completedCourseIds: new Set(),
      requiredMandatoryCourseIds: ['MAND'], categories: [],
      // 4 semesters * hardCap 26 = 104h max headroom, far below a 185h target
      // with 0 prior hours — the full degree literally cannot fit in this
      // board's visible window, by design of the scenario.
      degreeRequiredHours: 185, priorHours: 0,
      maxHoursPerSemester: 22, hardCap: 26,
      disallowedCourseIds: new Set(), pinnedCourseIds: new Set(), wantedCourseIds: new Set(),
    };
  }

  it('still places a trivially legal, needed mandatory course instead of stopping with an empty plan', () => {
    const w = new PlannerWorker(unreachableTargetModel(), undefined, { lookahead: true });
    w.run();
    expect(semesterOf(w.getPlan(), 'MAND')).toBe('year_3_semester_a');
    expect(placedCourseIds(w.getPlan()).length).toBeGreaterThan(0);
  });

  // Codex round-1 finding: the aggregate 'degree_hours' reason (tolerated
  // above) must not be confused with a real, course-specific blocker. An
  // elective and a mandatory course that both only fit in the SAME single
  // semester (hardCap 26) genuinely conflict — placing the 22h elective
  // first makes the 5h mandatory permanently unplaceable there. That must
  // still be ranked down even while the target is intentionally unreachable
  // overall, or the elective wins on immediate score and the worker
  // self-sabotages a course it could otherwise have placed.
  it('still avoids blocking a specific still-needed mandatory course, even while the aggregate target is unreachable', () => {
    const profiles = new Map<string, CourseProfile>();
    profiles.set('MAND', profile('MAND', {
      is_mandatory: true, course_type: 'mandatory', placement_policy: 'fixed',
      effective_allowed_semesters: ['year_3_semester_a'], hours: 5,
    }));
    profiles.set('BIGELECTIVE', profile('BIGELECTIVE', {
      effective_allowed_semesters: ['year_3_semester_a'], hours: 22,
    }));
    const m: ConstraintModel = {
      profiles, knownSemesterIds: SEMS, completedCourseIds: new Set(),
      requiredMandatoryCourseIds: ['MAND'], categories: [],
      degreeRequiredHours: 999, priorHours: 0, // intentionally unreachable
      maxHoursPerSemester: 22, hardCap: 26,
      disallowedCourseIds: new Set(), pinnedCourseIds: new Set(), wantedCourseIds: new Set(),
    };
    const w = new PlannerWorker(m, undefined, { lookahead: true });
    w.run();
    expect(semesterOf(w.getPlan(), 'MAND')).toBe('year_3_semester_a');
  });

  // Codex round-2 finding: the blocker-aware sort ran only on the top-N (by
  // raw immediate score) candidates — topN exists to bound the expensive
  // estimateFinalScore rollout, not to gate blocker-awareness itself. If
  // MORE than topN high-immediate-score actions all block the same specific
  // mandatory course, the non-blocking mandatory-placement action never even
  // enters the truncated set, so the blocker-aware sort never sees it.
  it('still finds the non-blocking mandatory action even when more than topN candidates block it', () => {
    const profiles = new Map<string, CourseProfile>();
    profiles.set('MAND', profile('MAND', {
      is_mandatory: true, course_type: 'mandatory', placement_policy: 'fixed',
      effective_allowed_semesters: ['year_3_semester_a'], hours: 5,
    }));
    // 3 distinct large electives, each legal ONLY in the same single semester
    // as MAND, each individually blocking it (22 + 5 = 27 > hardCap 26) —
    // more than topN (2) below.
    for (const id of ['E1', 'E2', 'E3']) {
      profiles.set(id, profile(id, { effective_allowed_semesters: ['year_3_semester_a'], hours: 22 }));
    }
    const m: ConstraintModel = {
      profiles, knownSemesterIds: SEMS, completedCourseIds: new Set(),
      requiredMandatoryCourseIds: ['MAND'], categories: [],
      degreeRequiredHours: 999, priorHours: 0, // intentionally unreachable
      maxHoursPerSemester: 22, hardCap: 26,
      disallowedCourseIds: new Set(), pinnedCourseIds: new Set(), wantedCourseIds: new Set(),
    };
    const w = new PlannerWorker(m, undefined, { lookahead: true, topN: 2, rolloutSteps: 20 });
    w.run();
    expect(semesterOf(w.getPlan(), 'MAND')).toBe('year_3_semester_a');
  });

  // Codex round-3 finding: the 'degree_hours' reason must only be excused
  // when the target was ALREADY unreachable before the action — not for an
  // action that newly makes a previously-reachable target unreachable. A
  // "wanted" is_annual course consumes headroom in BOTH its spanned
  // semesters while counting only ONCE toward degree credit — a genuinely
  // worse choice than an ordinary elective when it tips the plan from
  // reachable to unreachable, and must still be ranked down even though it
  // scores higher on preference (g5).
  it('still avoids a wanted action that newly makes the target unreachable, preferring an ordinary path that stays completable', () => {
    const TWO_SEMS = ['s1', 's2'];
    const profiles = new Map<string, CourseProfile>();
    // Consumes 20h in EACH of its 2 spans (40h total headroom) but counts
    // only 20h toward degree credit — attractive (is_wanted) but tips a
    // reachable 40h target into unreachable (headroom drops from 52 to 12,
    // gap stays at 20).
    profiles.set('ANNUAL', profile('ANNUAL', {
      is_annual: true, spans_semesters: TWO_SEMS, effective_allowed_semesters: TWO_SEMS,
      hours: 20, is_wanted: true,
    }));
    // Two ordinary electives that together exactly complete the 40h target
    // without over-consuming headroom.
    profiles.set('ORD1', profile('ORD1', { effective_allowed_semesters: ['s1'], hours: 20 }));
    profiles.set('ORD2', profile('ORD2', { effective_allowed_semesters: ['s2'], hours: 20 }));
    const m: ConstraintModel = {
      profiles, knownSemesterIds: TWO_SEMS, completedCourseIds: new Set(),
      requiredMandatoryCourseIds: [], categories: [],
      degreeRequiredHours: 40, priorHours: 0,
      maxHoursPerSemester: 22, hardCap: 26,
      disallowedCourseIds: new Set(), pinnedCourseIds: new Set(), wantedCourseIds: new Set(['ANNUAL']),
    };
    // rolloutSteps: 0 isolates the hasRealBlocker classification itself —
    // with a real rollout, estimateFinalScore's downstream-impact reasoning
    // already happens to prefer the ORD1/ORD2 path (it reaches full degree
    // completion within the rollout, unlike the ANNUAL-first path), which
    // would mask this specific bug. Zeroing the rollout depth reduces `fin`
    // to the immediate score, where g1-g4 tie and only g5 (preference)
    // differs — exactly the scenario where an incorrect hasRealBlocker
    // classification would let the "wanted" but plan-sabotaging action win.
    const w = new PlannerWorker(m, undefined, { lookahead: true, rolloutSteps: 0 });
    w.run();
    expect(w.getState().degreeHours).toBe(40);
    expect(semesterOf(w.getPlan(), 'ANNUAL')).toBeNull();
  });
});

describe('PlannerWorker — STOP trace on maxSteps limit', () => {
  it('records a STOP action with maxSteps reason when the step limit is hit before goal', () => {
    // Model needs enough required work that 1 step cannot reach the goal
    const w = new PlannerWorker(buildModel(), undefined, { lookahead: false });
    w.run(1, 'greedy'); // goal requires many steps, 1 is never enough

    const trace = w.getTrace();
    const stops = trace.filter(a => a.action === 'STOP');
    expect(stops.length).toBeGreaterThan(0);
    const maxStepsStop = stops.find(a => a.reason?.includes('maxSteps'));
    expect(maxStepsStop).toBeDefined();
  });

  it('does NOT emit a maxSteps STOP when the goal is reached within the limit', () => {
    // Trivial model: 0 required hours, already satisfied
    const trivialModel = buildModel({ degreeRequiredHours: 0 });
    const w = new PlannerWorker(trivialModel, undefined, { lookahead: false });
    w.run(500, 'greedy');

    const trace = w.getTrace();
    const maxStepsStops = trace.filter(a => a.action === 'STOP' && a.reason?.includes('maxSteps'));
    expect(maxStepsStops.length).toBe(0);
  });
});

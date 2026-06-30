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

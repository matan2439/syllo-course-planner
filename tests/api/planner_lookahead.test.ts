/**
 * Tests for api/ai/planner_lookahead.ts — downstream-impact reasoning.
 * A legal action is not necessarily a good action: the worker must weigh an
 * action's effect on the remaining feasible planning space.
 *   (a) projectFeasibility — an action that eliminates the only legal slot for a
 *       still-required course makes the resulting state infeasible.
 *   (b) estimateFinalScore — a branch that can still reach a complete plan scores
 *       higher than one that dead-ends, even if they look equal right now.
 */

import {
  projectFeasibility,
  estimateFinalScore,
  greedyComplete,
} from '../../api/ai/planner_lookahead';
import { compareScore } from '../../api/ai/planner_goals';
import {
  type ConstraintModel,
  type PlanState,
  emptyState,
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

function baseModel(over: Partial<ConstraintModel> = {}): ConstraintModel {
  return {
    profiles: new Map(),
    knownSemesterIds: SEMS,
    completedCourseIds: new Set(),
    requiredMandatoryCourseIds: [],
    categories: [],
    degreeRequiredHours: 100,
    priorHours: 0,
    maxHoursPerSemester: 22,
    hardCap: 26,
    disallowedCourseIds: new Set(),
    pinnedCourseIds: new Set(),
    wantedCourseIds: new Set(),
    ...over,
  };
}

describe('projectFeasibility — forward checking (a)', () => {
  it('is feasible while a required mandatory still has a legal, fitting semester', () => {
    const m = baseModel({ requiredMandatoryCourseIds: ['FIX'], degreeRequiredHours: 0 });
    m.profiles.set('FIX', profile('FIX', {
      is_mandatory: true, placement_policy: 'fixed',
      effective_allowed_semesters: ['year_4_semester_b'], hours: 18,
    }));
    const empty = emptyState(SEMS);
    expect(projectFeasibility(empty, m).feasible).toBe(true);
  });

  it('is infeasible when the only legal semester of a required mandatory is full', () => {
    const m = baseModel({ requiredMandatoryCourseIds: ['FIX'], degreeRequiredHours: 0 });
    m.profiles.set('FIX', profile('FIX', {
      is_mandatory: true, placement_policy: 'fixed',
      effective_allowed_semesters: ['year_4_semester_b'], hours: 18,
    }));
    // fill y4b so FIX (18h) can no longer fit under the hard cap (26)
    m.profiles.set('BULK', profile('BULK', { hours: 24 }));
    const blocked: PlanState = emptyState(SEMS);
    blocked.semesters['year_4_semester_b'] = ['BULK']; // 24h, +18 would be 42 > 26
    const rep = projectFeasibility(blocked, m);
    expect(rep.feasible).toBe(false);
    expect(rep.blocked).toContain('FIX');
  });

  it('is infeasible when an unmet category has no remaining eligible candidate', () => {
    const m = baseModel({
      degreeRequiredHours: 0,
      categories: [{ id: 'fluids', name: 'זורמים', required: 1, candidateIds: ['F1'] }],
      disallowedCourseIds: new Set(['F1']),
    });
    m.profiles.set('F1', profile('F1', { category_id: 'fluids', excluded: true }));
    expect(projectFeasibility(emptyState(SEMS), m).feasible).toBe(false);
  });
});

describe('estimateFinalScore — non-myopic choice (b)', () => {
  // A flexible course C (legal in both y4a and y4b) and a narrow course NARROW
  // (legal only in y4b). Putting C in y4b blocks NARROW (10+18 > 26), dead-ending
  // below the degree target; putting C in y4a leaves room for NARROW → complete.
  function abModel(): ConstraintModel {
    const m = baseModel({ degreeRequiredHours: 28 });
    m.profiles.set('C', profile('C', {
      hours: 10, effective_allowed_semesters: ['year_4_semester_a', 'year_4_semester_b'],
    }));
    m.profiles.set('NARROW', profile('NARROW', {
      hours: 18, effective_allowed_semesters: ['year_4_semester_b'],
    }));
    return m;
  }

  it('ranks the branch that can still complete above the dead-end branch', () => {
    const m = abModel();
    const good: PlanState = emptyState(SEMS);
    good.semesters['year_4_semester_a'] = ['C'];
    const bad: PlanState = emptyState(SEMS);
    bad.semesters['year_4_semester_b'] = ['C'];

    const finGood = estimateFinalScore(good, m);
    const finBad = estimateFinalScore(bad, m);
    expect(compareScore(finGood, finBad)).toBeGreaterThan(0);
  });

  it('greedyComplete reaches the degree target from the good branch', () => {
    const m = abModel();
    const good: PlanState = emptyState(SEMS);
    good.semesters['year_4_semester_a'] = ['C'];
    const completed = greedyComplete(good, m);
    const total = Object.values(completed.semesters).flat()
      .reduce((s, id) => s + (m.profiles.get(id)?.hours ?? 0), 0);
    expect(total).toBeGreaterThanOrEqual(28);
  });

  it('greedyComplete is bounded (returns promptly on a larger pool)', () => {
    const m = baseModel({ degreeRequiredHours: 80 });
    for (let i = 0; i < 60; i++) m.profiles.set(`E${i}`, profile(`E${i}`, { hours: 4 }));
    const t0 = Date.now();
    greedyComplete(emptyState(SEMS), m);
    expect(Date.now() - t0).toBeLessThan(4000);
  });
});

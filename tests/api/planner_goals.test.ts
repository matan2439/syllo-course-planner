/**
 * Tests for api/ai/planner_goals.ts — the prioritized goal stack and the single
 * ranking mechanism (scorePlan / compareScore) shared by the worker and both
 * orchestrators. Higher goals must dominate lower ones lexicographically:
 *   1 degree completion > 2 mandatory/category > 3 legality > 4 balance
 *   > 5 user preferences > 6 difficulty/comfort.
 */

import { scorePlan, compareScore, GOAL_STACK } from '../../api/ai/planner_goals';
import {
  type ConstraintModel,
  type PlanState,
  emptyState,
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
  it('lists the eight prioritized goals, completion first', () => {
    expect(GOAL_STACK[0]).toBe('degree_completion');
    expect(GOAL_STACK).toHaveLength(8);
    expect(GOAL_STACK[GOAL_STACK.length - 1]).toBe('difficulty_comfort');
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

  it('with higher goals equal, balanced and lopsided plans score equally when both fit within capacity (g4)', () => {
    // After the g4 fix, spread is computed over non-empty semesters only.
    // lopsided (8h in one sem): non-empty=[8], spread=0, g4=0.
    // balanced (4h + 4h): non-empty=[4,4], spread=0, g4=0.
    // Same courses → same g6. Result: tied. G3 (legality) already handles over-cap loads.
    const m = model({ degreeRequiredHours: 8, categories: [] });
    const balanced = emptyState(SEMS);
    balanced.semesters['year_3_semester_a'] = ['e0']; // 4h
    balanced.semesters['year_3_semester_b'] = ['e1']; // 4h
    const lopsided = withCourses('year_3_semester_a', ['e0', 'e1']); // 8h in one sem
    expect(compareScore(scorePlan(balanced, m), scorePlan(lopsided, m))).toBe(0);
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

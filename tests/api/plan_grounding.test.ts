/**
 * plan_grounding.ts — deterministic, plan-inert academic-fact grounding over a
 * generated plan. Classifies each placed course's facts as known / unknown /
 * inferred / conflicting, carries provenance, and surfaces catalog-vs-normalized
 * and user-assertion-vs-plan conflicts. No LLM, no I/O, never mutates the plan.
 */

import { groundPlan } from '../../api/ai/plan_grounding';
import type { ConstraintModel, PlanState } from '../../api/ai/planner_types';
import type { CourseProfile } from '../../api/ai/course_profile';

function profile(id: string, over: Partial<CourseProfile> = {}): CourseProfile {
  return {
    course_id: id, name_he: id, category_id: null, category_name_he: null,
    is_mandatory: false, course_type: 'elective', placement_policy: 'elective',
    hours: 4, offered_semesters: ['s1'], effective_allowed_semesters: ['s1'],
    recommended_semester: null, allowed_semesters: null, program_allowed_semesters: null,
    prerequisites: [], corequisites: [], syllabus_url: null, syllabus_available: false,
    syllabus_summary_he: null, syllabus_topics_he: [], assessment_type: null,
    workload_score: null, difficulty_score: 3, difficulty_level: null, grade_average: null,
    is_wanted: false, is_unwanted: false, excluded: false, exclusion_reason: null,
    data_confidence: 0.9,
    provenance: { source: 'catalog', data_quality: 'high', offering_source_url: null, name_source: null },
    ...over,
  };
}

function model(profiles: CourseProfile[], over: Partial<ConstraintModel> = {}): ConstraintModel {
  const map = new Map<string, CourseProfile>();
  for (const p of profiles) map.set(p.course_id, p);
  return {
    profiles: map, knownSemesterIds: ['s1', 's2'], completedCourseIds: new Set(),
    requiredMandatoryCourseIds: [], categories: [], degreeRequiredHours: 4, priorHours: 0,
    maxHoursPerSemester: 20, hardCap: 30, disallowedCourseIds: new Set(),
    pinnedCourseIds: new Set(), wantedCourseIds: new Set(), ...over,
  };
}

function plan(placed: Record<string, string[]>): PlanState {
  return { semesters: { s1: [], s2: [], ...placed } };
}

describe('groundPlan', () => {
  test('a fully-specified, high-confidence placed course is classified "known"', () => {
    const g = groundPlan(model([profile('K')]), plan({ s1: ['K'] }));
    const f = g.facts.find((x) => x.courseId === 'K')!;
    expect(f.status).toBe('known');
    expect(f.provenance.source).toBe('catalog');
    expect(g.counts.known).toBe(1);
  });

  test('a placed course with null hours is "unknown"', () => {
    const g = groundPlan(model([profile('U', { hours: null })]), plan({ s1: ['U'] }));
    expect(g.facts.find((x) => x.courseId === 'U')!.status).toBe('unknown');
    expect(g.counts.unknown).toBe(1);
  });

  test('a placed course with null semester availability is "unknown"', () => {
    const g = groundPlan(model([profile('U', { effective_allowed_semesters: null })]), plan({ s1: ['U'] }));
    expect(g.facts.find((x) => x.courseId === 'U')!.status).toBe('unknown');
  });

  test('a low-confidence but fully-specified placed course is "inferred"', () => {
    const g = groundPlan(model([profile('I', { data_confidence: 0.3 })]), plan({ s1: ['I'] }));
    expect(g.facts.find((x) => x.courseId === 'I')!.status).toBe('inferred');
    expect(g.counts.inferred).toBe(1);
  });

  test('catalog-vs-normalized availability disagreement is a conflict', () => {
    const g = groundPlan(
      model([profile('C', { offered_semesters: ['s2'], effective_allowed_semesters: ['s1'] })]),
      plan({ s1: ['C'] }),
    );
    const f = g.facts.find((x) => x.courseId === 'C')!;
    expect(f.status).toBe('conflicting');
    expect(g.conflicts).toContainEqual(
      expect.objectContaining({ courseId: 'C', kind: 'catalog_vs_normalized_availability' }),
    );
  });

  test.each([
    [['A'], ['year_3_semester_a']],
    [['B'], ['year_4_semester_b']],
    [['A', 'B'], ['year_3_semester_a', 'year_3_semester_b']],
  ])('term-only catalog availability %j agrees with normalized semester ids %j', (offered, effective) => {
    const g = groundPlan(
      model([profile('EQUIVALENT', { offered_semesters: offered, effective_allowed_semesters: effective })]),
      plan({ s1: ['EQUIVALENT'] }),
    );

    expect(g.facts.find((x) => x.courseId === 'EQUIVALENT')!.status).toBe('known');
    expect(g.conflicts).toEqual([]);
  });

  test('a user-asserted-completed course that is also placed is a conflict', () => {
    const g = groundPlan(
      model([profile('D')], { completedCourseIds: new Set(['D']) }),
      plan({ s1: ['D'] }),
    );
    expect(g.facts.find((x) => x.courseId === 'D')!.status).toBe('conflicting');
    expect(g.conflicts).toContainEqual(
      expect.objectContaining({ courseId: 'D', kind: 'user_assertion_vs_plan' }),
    );
  });

  test('grounds only placed courses — never fabricates facts about unplaced ones', () => {
    const g = groundPlan(model([profile('P'), profile('NOTPLACED')]), plan({ s1: ['P'] }));
    expect(g.facts.map((f) => f.courseId)).toEqual(['P']);
  });

  test('counts sum to the number of placed courses', () => {
    const g = groundPlan(
      model([profile('K'), profile('U', { hours: null }), profile('I', { data_confidence: 0.2 })]),
      plan({ s1: ['K', 'U'], s2: ['I'] }),
    );
    const { known, unknown, inferred, conflicting } = g.counts;
    expect(known + unknown + inferred + conflicting).toBe(3);
  });
});

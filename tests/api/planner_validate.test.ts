/**
 * Tests for validateCandidate (api/ai/planner_validate.ts) — the deterministic
 * gate every candidate plan must pass before it can be shown as final.
 * Covers: hard legality (over hard cap → invalid, test 7), disallowed exclusion
 * (test 4), degree completeness (test 5), category + mandatory completeness, and
 * the rule that no invalid plan is ever "valid" (test 8).
 */

import { validateCandidate } from '../../api/ai/planner_validate';
import { type ConstraintModel, type PlanState, emptyState } from '../../api/ai/planner_types';
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

function model(over: Partial<ConstraintModel> = {}): ConstraintModel {
  const profiles = new Map<string, CourseProfile>();
  profiles.set('MAND', profile('MAND', { is_mandatory: true, course_type: 'mandatory', hours: 5 }));
  profiles.set('FLU1', profile('FLU1', { category_id: 'fluids', hours: 4 }));
  for (let i = 0; i < 8; i++) profiles.set(`E${i}`, profile(`E${i}`, { hours: 4 }));
  return {
    profiles, knownSemesterIds: SEMS, completedCourseIds: new Set(),
    requiredMandatoryCourseIds: ['MAND'],
    categories: [{ id: 'fluids', name: 'זורמים', required: 1, candidateIds: ['FLU1'] }],
    degreeRequiredHours: 17, priorHours: 0, maxHoursPerSemester: 22, hardCap: 26,
    disallowedCourseIds: new Set(), pinnedCourseIds: new Set(), wantedCourseIds: new Set(),
    ...over,
  };
}

/** A complete, legal plan: MAND(5)+FLU1(4)+E0(4)+E1(4) = 17 = target. */
function completePlan(): PlanState {
  const s = emptyState(SEMS);
  s.semesters['year_3_semester_a'] = ['MAND', 'FLU1'];
  s.semesters['year_3_semester_b'] = ['E0', 'E1'];
  return s;
}

describe('validateCandidate', () => {
  it('accepts a complete, legal plan as valid + complete', () => {
    const r = validateCandidate(completePlan(), model());
    expect(r.legal).toBe(true);
    expect(r.complete).toBe(true);
    expect(r.valid).toBe(true);
    expect(r.degreeMet).toBe(true);
  });

  it('marks an incomplete plan (below degree target) invalid — never stop at 183/185 (test 5)', () => {
    const s = emptyState(SEMS);
    s.semesters['year_3_semester_a'] = ['MAND', 'FLU1']; // 9h, below 17
    const r = validateCandidate(s, model());
    expect(r.degreeMet).toBe(false);
    expect(r.complete).toBe(false);
    expect(r.valid).toBe(false);
  });

  it('flags an unsatisfied category as incomplete', () => {
    const s = emptyState(SEMS);
    s.semesters['year_3_semester_a'] = ['MAND', 'E0'];
    s.semesters['year_3_semester_b'] = ['E1', 'E2']; // 17h but no fluids
    const r = validateCandidate(s, model());
    expect(r.unsatisfiedCategories).toContain('fluids');
    expect(r.valid).toBe(false);
  });

  it('flags a missing mandatory as incomplete', () => {
    const s = emptyState(SEMS);
    s.semesters['year_3_semester_a'] = ['FLU1', 'E0', 'E2'];
    s.semesters['year_3_semester_b'] = ['E1']; // 16h-ish, no MAND
    const r = validateCandidate(s, model());
    expect(r.missingMandatory).toContain('MAND');
    expect(r.valid).toBe(false);
  });

  it('rejects a plan containing an explicitly disallowed course (test 4)', () => {
    const m = model({ disallowedCourseIds: new Set(['E0']) });
    const r = validateCandidate(completePlan(), m);
    expect(r.disallowedPlaced).toContain('E0');
    expect(r.valid).toBe(false);
  });

  it('rejects a plan that re-proposes a currently-taking/in-progress course (currentlyPlannedCourseIds propagation)', () => {
    const m = model({ currentlyPlannedCourseIds: new Set(['FLU1']) });
    const r = validateCandidate(completePlan(), m);
    expect(r.legal).toBe(false);
    expect(r.errors.some(e => e.includes('FLU1'))).toBe(true);
    expect(r.valid).toBe(false);
  });

  it('rejects a plan with a semester over the hard cap as illegal (test 7)', () => {
    const s = emptyState(SEMS);
    // 7 electives * 4 = 28h in one semester > hardCap 26
    s.semesters['year_3_semester_a'] = ['MAND', 'FLU1', 'E0', 'E1', 'E2', 'E3', 'E4'];
    const r = validateCandidate(s, model());
    expect(r.legal).toBe(false);
    expect(r.overCapSemesters).toContain('year_3_semester_a');
    expect(r.valid).toBe(false);
  });
});

/**
 * Verifies that buildValidationContext is called exactly once per PlannerWorker
 * instance (in the constructor) rather than on every validate/step call.
 *
 * Uses a module-level jest.mock so the spy intercepts the call from within
 * planner_validate.ts's validatePlanState.
 */

import type { CourseProfile } from '../../api/ai/course_profile';
import type { ConstraintModel } from '../../api/ai/planner_types';

// Track calls to buildValidationContext via module mock.
let bvcCallCount = 0;

jest.mock('../../api/ai/planner_validate', () => {
  const actual = jest.requireActual('../../api/ai/planner_validate') as typeof import('../../api/ai/planner_validate');
  return {
    ...actual,
    buildValidationContext: (...args: Parameters<typeof actual.buildValidationContext>) => {
      bvcCallCount++;
      return actual.buildValidationContext(...args);
    },
  };
});

import { PlannerWorker } from '../../api/ai/planner_worker';

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

function buildModel(): ConstraintModel {
  const profiles = new Map<string, CourseProfile>();
  profiles.set('MAND', profile('MAND', { is_mandatory: true, placement_policy: 'fixed',
    effective_allowed_semesters: ['year_3_semester_a'], hours: 5 }));
  for (let i = 0; i < 12; i++) profiles.set(`E${i}`, profile(`E${i}`, { hours: 4 }));
  return {
    profiles, knownSemesterIds: SEMS,
    completedCourseIds: new Set(),
    requiredMandatoryCourseIds: ['MAND'],
    categories: [],
    degreeRequiredHours: 25, priorHours: 0,
    maxHoursPerSemester: 22, hardCap: 26,
    disallowedCourseIds: new Set(), pinnedCourseIds: new Set(), wantedCourseIds: new Set(),
  };
}

describe('PlannerWorker — buildValidationContext memoization', () => {
  beforeEach(() => { bvcCallCount = 0; });

  it('calls buildValidationContext exactly once per worker instance across multiple steps', () => {
    const w = new PlannerWorker(buildModel(), undefined, { lookahead: false });
    w.run(10, 'greedy');

    // After memoization: called once in constructor only.
    // Before memoization: called once per validate() call (many times per step).
    expect(bvcCallCount).toBe(1);
  });

  it('does not re-call buildValidationContext when validate() is called externally', () => {
    const w = new PlannerWorker(buildModel(), undefined, { lookahead: false });
    // One call expected in constructor
    expect(bvcCallCount).toBe(1);
    const countAfterConstruct = bvcCallCount;

    w.validate(); // should use cached ctx
    w.validate();
    expect(bvcCallCount).toBe(countAfterConstruct); // no additional calls
  });
});

/**
 * Tests for api/ai/planner_actions.ts — enumerateActions action space.
 */

import { enumerateActions } from '../../api/ai/planner_actions';
import { PlannerWorker } from '../../api/ai/planner_worker';
import { type ConstraintModel, emptyState } from '../../api/ai/planner_types';
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
  const profiles = new Map<string, CourseProfile>();
  return {
    profiles,
    knownSemesterIds: SEMS,
    completedCourseIds: new Set(),
    requiredMandatoryCourseIds: [],
    categories: [],
    degreeRequiredHours: 185,
    priorHours: 0,
    maxHoursPerSemester: 22,
    hardCap: 26,
    disallowedCourseIds: new Set(),
    pinnedCourseIds: new Set(),
    wantedCourseIds: new Set(),
    ...over,
  };
}

describe('enumerateActions — Group 4 degree-fill null-hours guard', () => {
  it('does not include null-hours electives in degree-fill ADD_COURSE actions', () => {
    const profiles = new Map<string, CourseProfile>();
    profiles.set('NULL1', profile('NULL1', { hours: null as any }));
    profiles.set('NULL2', profile('NULL2', { hours: undefined as any }));
    profiles.set('ZERO1', profile('ZERO1', { hours: 0 }));

    const model = baseModel({ profiles, degreeRequiredHours: 10, priorHours: 0 });
    const state = emptyState(SEMS);

    const actions = enumerateActions(state, model);
    const addIds = actions.filter(a => a.type === 'ADD_COURSE').map(a => (a as any).courseId);

    expect(addIds).not.toContain('NULL1');
    expect(addIds).not.toContain('NULL2');
    expect(addIds).not.toContain('ZERO1');
  });

  it('terminates with STOP within maxSteps when only null-hours electives remain for degree fill', () => {
    // ponytail: kept from existing suite — verifies P0 fix 1.5
    const profiles = new Map<string, CourseProfile>();
    // A mandatory to ensure there's real content, but only null-hours electives for degree-fill gap
    profiles.set('MAND', profile('MAND', { is_mandatory: true, hours: 5, placement_policy: 'fixed',
      effective_allowed_semesters: ['year_3_semester_a'] }));
    profiles.set('NULL1', profile('NULL1', { hours: null as any }));
    profiles.set('NULL2', profile('NULL2', { hours: undefined as any }));

    const model = baseModel({
      profiles,
      requiredMandatoryCourseIds: ['MAND'],
      degreeRequiredHours: 100, // impossible to reach without real-hours electives
      priorHours: 0,
    });

    const worker = new PlannerWorker(model, undefined, { lookahead: false });
    worker.run(50, 'greedy');

    const trace = worker.getTrace();
    const stops = trace.filter(a => a.action === 'STOP');
    expect(stops.length).toBeGreaterThan(0);
    // Must have stopped, not looped forever
    expect(trace.length).toBeLessThanOrEqual(60);
  });
});

describe('enumerateActions — is_unwanted excluded from degree-fill', () => {
  it('does not include is_unwanted courses in degree-fill ADD_COURSE actions', () => {
    const profiles = new Map<string, CourseProfile>();
    profiles.set('BAD', profile('BAD', { is_unwanted: true, hours: 4 }));
    profiles.set('GOOD', profile('GOOD', { is_unwanted: false, hours: 4 }));

    const m = baseModel({ profiles, degreeRequiredHours: 8, priorHours: 0 });
    const state = emptyState(SEMS);

    const actions = enumerateActions(state, m);
    const addIds = actions.filter(a => a.type === 'ADD_COURSE').map(a => (a as any).courseId);

    expect(addIds).not.toContain('BAD');
    expect(addIds).toContain('GOOD');
  });

  it('still includes is_unwanted course as a category candidate when required', () => {
    // If BAD is the only candidate for a required category, it must still be enumerable.
    const profiles = new Map<string, CourseProfile>();
    profiles.set('BAD', profile('BAD', { is_unwanted: true, hours: 4, category_id: 'cat' }));

    const m = baseModel({
      profiles,
      categories: [{ id: 'cat', name: 'cat', required: 1, candidateIds: ['BAD'] }],
      degreeRequiredHours: 4,
    });
    const state = emptyState(SEMS);

    const actions = enumerateActions(state, m);
    const addIds = actions.filter(a => a.type === 'ADD_COURSE').map(a => (a as any).courseId);

    expect(addIds).toContain('BAD');
  });
});

describe('enumerateActions — REPLACE_COURSE', () => {
  it('includes REPLACE_COURSE mutation when a wanted course could replace a placed unwanted one', () => {
    // 'LOW' is placed (not wanted). 'HIGH' is available and wanted.
    // After fix: enumerateActions should emit REPLACE_COURSE { outId:'LOW', inId:'HIGH' }.
    const profiles = new Map<string, CourseProfile>();
    profiles.set('LOW', profile('LOW', { is_wanted: false, hours: 4, placement_policy: 'elective' }));
    profiles.set('HIGH', profile('HIGH', { is_wanted: true, hours: 4, placement_policy: 'elective' }));

    const m = baseModel({
      profiles,
      wantedCourseIds: new Set(['HIGH']),
      degreeRequiredHours: 4,
      priorHours: 4, // already satisfied so no degree-fill ADD_COURSE noise
    });

    const state = emptyState(SEMS);
    state.semesters['year_3_semester_a'] = ['LOW'];

    const actions = enumerateActions(state, m);
    const replacements = actions.filter(a => a.type === 'REPLACE_COURSE');

    expect(
      replacements.some(a => (a as any).outId === 'LOW' && (a as any).inId === 'HIGH'),
    ).toBe(true);
  });
});

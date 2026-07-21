/**
 * Regression — annual (year-long) courses must be placed atomically into ALL
 * of their `spans_semesters`, never split into a single-semester choice.
 *
 * Root cause (found while re-verifying issue #25's "semester-balance /
 * dual-offered-course placement" item against the real board fixture):
 * `enumerateActions` generated one ADD_COURSE action per legal semester for
 * EVERY course, including `is_annual` ones — the search then treated the two
 * semesters as mutually-exclusive alternatives and placed the course in only
 * one, silently under-reporting the true weekly load for the other spanned
 * semester. `completion_analysis.ts`'s `repairAddMissingMandatory` already
 * handles this correctly for its own (unrelated, dead-for-generate-plan.ts)
 * repair pipeline; this locks the same behavior into the live shared action
 * space (`enumerateActions`/`applyMutation`), which both the default
 * PlannerWorker path and the agentic PlannerAgent/beam path consume via
 * `TauPolicyProvider.generateActions`.
 *
 * Also locks: an already-placed annual course must never be considered
 * movable/replaceable (isMovable) — moving or replacing it out of one
 * semester only would split the pair, exactly what `course_profile.ts`'s own
 * LLM-facing note ("שנתי — לא ניתן להזזה/פיצול") already documents as
 * intended but the code never enforced.
 */

import { enumerateActions, isMovable } from '../../api/ai/planner_actions';
import { applyMutation } from '../../api/ai/planner_goals';
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

function annualProfile(id: string, spans: string[], over: Partial<CourseProfile> = {}): CourseProfile {
  return profile(id, {
    is_mandatory: true,
    course_type: 'mandatory',
    placement_policy: 'annual',
    effective_allowed_semesters: spans,
    hours: 4,
    is_annual: true,
    spans_semesters: spans,
    count_hours_once: true,
    root_course_id: id,
    ...over,
  } as Partial<CourseProfile>);
}

describe('enumerateActions — annual (year-long) course placement', () => {
  it('generates exactly one ADD_COURSE action for an unplaced annual course, targeting both spanned semesters atomically', () => {
    const spans = ['year_3_semester_a', 'year_3_semester_b'];
    const profiles = new Map<string, CourseProfile>();
    profiles.set('ANNUAL', annualProfile('ANNUAL', spans));
    const model = baseModel({ profiles, requiredMandatoryCourseIds: ['ANNUAL'] });
    const state = emptyState(SEMS);

    const actions = enumerateActions(state, model).filter(a => a.type === 'ADD_COURSE' && (a as any).courseId === 'ANNUAL');

    expect(actions).toHaveLength(1);
    const action = actions[0] as any;
    expect([action.semesterId, ...(action.alsoSemesterIds ?? [])].sort()).toEqual([...spans].sort());
  });

  it('applyMutation places the annual course in every spanned semester at once, never just one', () => {
    const spans = ['year_3_semester_a', 'year_3_semester_b'];
    const profiles = new Map<string, CourseProfile>();
    profiles.set('ANNUAL', annualProfile('ANNUAL', spans));
    const model = baseModel({ profiles, requiredMandatoryCourseIds: ['ANNUAL'] });
    const state = emptyState(SEMS);

    const [action] = enumerateActions(state, model).filter(a => a.type === 'ADD_COURSE' && (a as any).courseId === 'ANNUAL');
    const next = applyMutation(state, action);

    expect(next).not.toBeNull();
    expect(next!.semesters['year_3_semester_a']).toContain('ANNUAL');
    expect(next!.semesters['year_3_semester_b']).toContain('ANNUAL');
    expect(next!.semesters['year_4_semester_a']).not.toContain('ANNUAL');
    expect(next!.semesters['year_4_semester_b']).not.toContain('ANNUAL');
  });

  it('a non-annual dual-offered course still gets one ADD_COURSE action per legal semester (unchanged behavior)', () => {
    const profiles = new Map<string, CourseProfile>();
    profiles.set('DUAL', profile('DUAL', {
      is_mandatory: false, course_type: 'elective', placement_policy: 'elective',
      effective_allowed_semesters: ['year_3_semester_a', 'year_3_semester_b'], hours: 4,
    }));
    const model = baseModel({
      profiles,
      categories: [{ id: 'cat', name: 'cat', required: 1, candidateIds: ['DUAL'] }],
      // Keep the degree-hour-fill branch (Group 4) from also proposing DUAL
      // independently of the category branch (Group 2) — this test isolates
      // Group 2's per-legal-semester action generation.
      degreeRequiredHours: 0,
    });
    const state = emptyState(SEMS);

    const actions = enumerateActions(state, model).filter(a => a.type === 'ADD_COURSE' && (a as any).courseId === 'DUAL');
    expect(actions).toHaveLength(2);
    expect(actions.map((a: any) => a.semesterId).sort()).toEqual(['year_3_semester_a', 'year_3_semester_b']);
    expect(actions.every((a: any) => !a.alsoSemesterIds)).toBe(true);
  });

  it('applyMutation returns null (no partial placement) if any spanned semester is unknown to the state', () => {
    const state = emptyState(['year_3_semester_a']); // year_3_semester_b missing entirely
    const next = applyMutation(state, {
      type: 'ADD_COURSE', courseId: 'ANNUAL', semesterId: 'year_3_semester_a', alsoSemesterIds: ['year_3_semester_b'],
    } as any);
    expect(next).toBeNull();
    // Structurally impossible mutations must not partially mutate — confirm no state was touched.
    expect(state.semesters['year_3_semester_a']).toEqual([]);
  });
});

describe('isMovable — annual courses are never movable or replaceable', () => {
  it('returns false for an is_annual course even when its placement_policy is not "fixed"', () => {
    const spans = ['year_3_semester_a', 'year_3_semester_b'];
    const profiles = new Map<string, CourseProfile>();
    profiles.set('ANNUAL', annualProfile('ANNUAL', spans));
    const model = baseModel({ profiles });

    expect(isMovable(model, 'ANNUAL')).toBe(false);
  });

  it('enumerateActions never proposes a MOVE_COURSE or REPLACE_COURSE for an already-placed annual course', () => {
    const spans = ['year_3_semester_a', 'year_3_semester_b'];
    const profiles = new Map<string, CourseProfile>();
    profiles.set('ANNUAL', annualProfile('ANNUAL', spans));
    profiles.set('ELECTIVE', profile('ELECTIVE', { is_wanted: true }));
    const model = baseModel({ profiles, requiredMandatoryCourseIds: ['ANNUAL'] });
    const state = emptyState(SEMS);
    state.semesters['year_3_semester_a'] = ['ANNUAL'];
    state.semesters['year_3_semester_b'] = ['ANNUAL'];

    const actions = enumerateActions(state, model);
    expect(actions.some(a => (a.type === 'MOVE_COURSE' || a.type === 'REPLACE_COURSE') && (a as any).courseId === 'ANNUAL')).toBe(false);
    expect(actions.some(a => a.type === 'REPLACE_COURSE' && (a as any).outId === 'ANNUAL')).toBe(false);
  });
});

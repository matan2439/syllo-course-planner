import { buildConstraintModel } from '../../api/ai/planner_model';
import { validatePlanProposal } from '../../api/ai/plan_validation';
import { requiredButUnplacedCourseIds, requiredCourseSemesterBoundaries } from '../../api/ai/planner_goals';
import { enumerateActions } from '../../api/ai/planner_actions';
import { analyzeHardConstraints } from '../../api/ai/hard_constraints';
import { emptyState } from '../../api/ai/planner_types';

const A = 'year_3_semester_a';
const B = 'year_3_semester_b';
const C = 'year_4_semester_a';
const SEMS = [A, B, C];
const leaf = (course_id: string) => ({ course_id });
const OR = { any_of: [leaf('P'), leaf('Q')] };

function model(expression: unknown, concurrent = false, corequisite?: unknown) {
  const result = buildConstraintModel({
    semesters: SEMS.map(semester_id => ({ semester_id, courses: [] })),
    metadata: {
      program_requirements_categories: { total_required_hours: 4, categories: [] },
      program_repository_courses: [
        { course_id: 'DEP', name_he: 'תלוי', weekly_hours: 2, is_mandatory: true,
          placement_policy: 'mandatory', offered_semesters: [B], prerequisites: ['P', 'Q'],
          prerequisite_expression: expression,
          ...(corequisite !== undefined ? { corequisite_expression: corequisite } : {}) },
        ...['P', 'Q'].map(course_id => ({ course_id, name_he: 'קדם', weekly_hours: 2,
          placement_policy: 'elective', offered_semesters: [A, B, C], prerequisites: [] })),
      ],
    },
  }, { mustIncludeCourseIds: ['DEP'] });
  return Object.assign(result, { allowConcurrentPrerequisites: concurrent });
}

function validate(expression: unknown, bySem: Record<string, string[]>, concurrent = false,
  completed: string[] = [], corequisite?: unknown) {
  const info: any = { prerequisites: ['P', 'Q'], missing_prerequisites: ['P', 'Q'],
    prerequisite_expression: expression,
    ...(corequisite !== undefined ? { corequisite_expression: corequisite } : {}) };
  return validatePlanProposal({
    semesters: Object.entries(bySem).map(([semester_id, course_ids]) => ({ semester_id, course_ids })),
    moves: [], warnings_he: [], rationale_he: '', requirements_status: [],
  }, { completedCourseIds: new Set(completed), allowConcurrentPrerequisites: concurrent,
    courses: { DEP: info, P: {}, Q: {} } }, { knownSemesterIds: SEMS });
}

describe('expression-aware planner integration', () => {
  test('profile preserves OR, unknown and absent corequisite metadata', () => {
    const profile = model(OR).profiles.get('DEP')!;
    expect(profile.prerequisite_expression).toEqual(OR);
    expect(profile.corequisite_expression).toBeUndefined();
    expect(model(OR, false, null).profiles.get('DEP')!.corequisite_expression).toBeNull();
    expect(model({ invalid: [] }).profiles.get('DEP')!.prerequisite_expression).toBeNull();
  });

  test('OR overrides flattened arrays and missing-prerequisite issues', () => {
    expect(validate(OR, { [A]: ['Q'], [B]: ['DEP'] }).errors).toEqual([]);
    expect(validate(OR, { [B]: ['DEP'] }, false, ['Q']).errors).toEqual([]);
    expect(validate(OR, { [B]: ['DEP'] }).errors.length).toBeGreaterThan(0);
  });

  test('OR placement follows strict/concurrent timing and never accepts later alternatives', () => {
    expect(validate(OR, { [B]: ['DEP', 'Q'] }).errors.length).toBeGreaterThan(0);
    expect(validate(OR, { [B]: ['DEP', 'Q'] }, true).errors).toEqual([]);
    expect(validate(OR, { [B]: ['DEP'], [C]: ['P', 'Q'] }, true).errors.length).toBeGreaterThan(0);
  });

  test('all-of requires every branch; malformed and unknown expressions cannot fall back', () => {
    expect(validate({ all_of: [leaf('P'), leaf('Q')] }, { [A]: ['P'], [B]: ['DEP'] }).errors.length).toBeGreaterThan(0);
    for (const expression of [null, {}, { any_of: [] }, leaf('EXTERNAL')]) {
      expect(validate(expression, { [A]: ['P', 'Q'], [B]: ['DEP'] }).errors.length).toBeGreaterThan(0);
      const m = model(expression);
      expect(requiredButUnplacedCourseIds(emptyState(SEMS), m).has('DEP')).toBe(false);
      expect(analyzeHardConstraints(m).outcome).toBe('infeasible');
      if (expression === null || !('course_id' in expression)) {
        expect(enumerateActions(emptyState(SEMS), m).some(a => a.type === 'ADD_COURSE' && a.courseId === 'DEP')).toBe(false);
      }
    }
  });

  test('legacy arrays remain AND when expression absent', () => {
    expect(validate(undefined, { [A]: ['P'], [B]: ['DEP'] }).errors.length).toBeGreaterThan(0);
    expect(validate(undefined, { [A]: ['P', 'Q'], [B]: ['DEP'] }).errors).toEqual([]);
  });

  test.each([false, true])('search chooses one reachable alternative and respects its boundary (concurrent=%s)', concurrent => {
    const m = model(OR, concurrent);
    m.disallowedCourseIds.add('P');
    m.profiles.get('Q')!.effective_allowed_semesters = [B];
    m.profiles.get('Q')!.offered_semesters = [B];
    const state = emptyState(SEMS);
    expect(requiredButUnplacedCourseIds(state, m).has('DEP')).toBe(concurrent);
    expect(analyzeHardConstraints(m).outcome).toBe(concurrent ? 'feasible' : 'infeasible');
    if (concurrent) {
      expect([...requiredButUnplacedCourseIds(state, m)].sort()).toEqual(['DEP', 'Q']);
      expect(requiredCourseSemesterBoundaries(state, m).get('Q')).toBe(1);
      expect(enumerateActions(state, m)).toContainEqual({ type: 'ADD_COURSE', courseId: 'Q', semesterId: B });
    }
  });

  test('completed OR alternative removes the other alternative from reservations and boundaries', () => {
    const m = model(OR);
    m.completedCourseIds.add('Q');
    m.disallowedCourseIds.add('P');
    const state = emptyState(SEMS);
    expect([...requiredButUnplacedCourseIds(state, m)]).toEqual(['DEP']);
    expect(requiredCourseSemesterBoundaries(state, m).has('P')).toBe(false);
    expect(analyzeHardConstraints(m).outcome).toBe('feasible');
  });

  test('annual expression prerequisites must fit before the first dependent span and finish by its boundary', () => {
    const m = model(OR, true);
    m.disallowedCourseIds.add('P');
    const q = m.profiles.get('Q')!;
    q.offered_semesters = [B];
    q.effective_allowed_semesters = [B];
    const dep = m.profiles.get('DEP')!;
    dep.is_annual = true;
    dep.spans_semesters = [A, B];
    dep.offered_semesters = [A, B];
    dep.effective_allowed_semesters = [A, B];
    expect(requiredButUnplacedCourseIds(emptyState(SEMS), m).has('DEP')).toBe(false);
    expect(analyzeHardConstraints(m).outcome).toBe('infeasible');

    dep.is_annual = false;
    dep.offered_semesters = [B];
    dep.effective_allowed_semesters = [B];
    q.is_annual = true;
    q.spans_semesters = [A, C];
    q.offered_semesters = [A, C];
    q.effective_allowed_semesters = [A, C];
    expect(requiredButUnplacedCourseIds(emptyState(SEMS), m).has('DEP')).toBe(false);
    expect(analyzeHardConstraints(m).outcome).toBe('infeasible');
  });

  test('explicit corequisite expressions use same-or-earlier timing; null remains unknown', () => {
    expect(validate({ all_of: [] }, { [B]: ['DEP', 'Q'] }, false, [], OR).errors).toEqual([]);
    expect(validate({ all_of: [] }, { [B]: ['DEP'], [C]: ['Q'] }, true, [], OR).errors.length).toBeGreaterThan(0);
    expect(validate({ all_of: [] }, { [B]: ['DEP'] }, false, [], null).errors.length).toBeGreaterThan(0);
    expect(analyzeHardConstraints(model({ all_of: [] }, false, null)).outcome).toBe('infeasible');
  });

  test('OR relocation can retain a placed dependent through another completed alternative', () => {
    const m = model(OR);
    m.hardCap = 5;
    m.completedCourseIds.add('Q');
    const dep = m.profiles.get('DEP')!;
    m.profiles.set('MAND', { ...dep, course_id: 'MAND', prerequisites: [],
      prerequisite_expression: { all_of: [] }, placement_policy: 'fixed',
      recommended_semester: A, effective_allowed_semesters: [A] });
    m.requiredMandatoryCourseIds = ['MAND'];
    m.mustIncludeCourseIds = new Set();
    m.profiles.get('P')!.hours = 4;
    m.profiles.get('P')!.offered_semesters = [A, B];
    m.profiles.get('DEP')!.hours = 1;
    const state = { semesters: { [A]: ['P'], [B]: ['DEP'], [C]: [] } };
    expect(requiredButUnplacedCourseIds(state, m).has('MAND')).toBe(true);
    m.profiles.get('P')!.prerequisite_expression = leaf('EXTERNAL');
    expect(requiredButUnplacedCourseIds(state, m).has('MAND')).toBe(false);
  });
});

import { buildConstraintModel } from '../../api/ai/planner_model';
import { validatePlanProposal, type PlanValidationContext } from '../../api/ai/plan_validation';
import { requiredButUnplacedCourseIds, requiredCourseSemesterBoundaries } from '../../api/ai/planner_goals';
import { enumerateActions } from '../../api/ai/planner_actions';
import { analyzeHardConstraints } from '../../api/ai/hard_constraints';
import { emptyState, type ConstraintModel, type PlanState } from '../../api/ai/planner_types';

const A = 'year_3_semester_a';
const B = 'year_3_semester_b';
const C = 'year_4_semester_a';
const SEMS = [A, B, C];

function model(flag?: boolean, prereqSemesters = [A], prerequisite = 'PRE', dependentSemesters = [A]): ConstraintModel {
  const result = buildConstraintModel({
    semesters: SEMS.map(semester_id => ({ semester_id, courses: [] })),
    metadata: {
      program_requirements_categories: { total_required_hours: 20, categories: [] },
      program_repository_courses: [
        { course_id: 'DEP', name_he: 'תלוי', weekly_hours: 2, is_mandatory: true,
          placement_policy: 'mandatory', offered_semesters: dependentSemesters, prerequisites: [prerequisite] },
        { course_id: 'PRE', name_he: 'קדם', weekly_hours: 2,
          placement_policy: 'elective', offered_semesters: prereqSemesters, prerequisites: [] },
      ],
    },
  }, { mustIncludeCourseIds: ['DEP'] });
  // The model flag is supplied by the caller; board-rule derivation is tested separately.
  return Object.assign(result, { allowConcurrentPrerequisites: flag });
}

function validate(flag: boolean | undefined, semesters: Record<string, string[]>, prerequisite = 'PRE') {
  const ctx: PlanValidationContext = {
    completedCourseIds: new Set(), allowConcurrentPrerequisites: flag,
    courses: { DEP: { prerequisites: [prerequisite] }, PRE: {} },
  };
  return validatePlanProposal({
    semesters: Object.entries(semesters).map(([semester_id, course_ids]) => ({ semester_id, course_ids })),
    moves: [], warnings_he: [], rationale_he: '', requirements_status: [],
  }, ctx, { knownSemesterIds: SEMS });
}

describe('explicit prerequisite concurrency', () => {
  test('validator accepts the same semester only when enabled', () => {
    expect(validate(true, { [A]: ['DEP', 'PRE'] }).errors).toEqual([]);
    for (const flag of [undefined, false]) {
      expect(validate(flag, { [A]: ['DEP', 'PRE'] }).errors).toHaveLength(1);
    }
  });

  test('later, absent, and unknown prerequisites remain blocking', () => {
    expect(validate(true, { [A]: ['DEP'], [B]: ['PRE'] }).errors).toHaveLength(1);
    expect(validate(true, { [A]: ['DEP'] }).errors).toHaveLength(1);
    expect(validate(true, { [A]: ['DEP'] }, 'EXTERNAL').errors).toHaveLength(1);
    expect(validate(true, { unknown_semester: ['PRE'], [A]: ['DEP'] }).errors).toHaveLength(1);
  });

  test('missing prerequisite issues still require actual placement or completion', () => {
    const proposal = {
      semesters: [{ semester_id: A, course_ids: ['DEP'] }],
      moves: [], warnings_he: [], rationale_he: '', requirements_status: [],
    };
    const ctx: PlanValidationContext = {
      allowConcurrentPrerequisites: true, completedCourseIds: new Set(),
      courses: { DEP: { missing_prerequisites: ['EXTERNAL'] } },
    };
    expect(validatePlanProposal(proposal, ctx).errors).toHaveLength(1);
    expect(ctx.completedCourseIds.size).toBe(0);
  });

  test('annual prerequisites must finish by the dependent semester even in reversed proposals', () => {
    const ctx: PlanValidationContext = {
      allowConcurrentPrerequisites: true, completedCourseIds: new Set(),
      courses: {
        DEP: { prerequisites: ['PRE'] },
        PRE: { is_annual: true, spans_semesters: [A, B] },
      },
    };
    const proposal = {
      semesters: [{ semester_id: B, course_ids: ['PRE'] }, { semester_id: A, course_ids: ['PRE', 'DEP'] }],
      moves: [], warnings_he: [], rationale_he: '', requirements_status: [],
    };
    expect(validatePlanProposal(proposal, ctx).errors).toHaveLength(1);
    proposal.semesters[0].course_ids.push('DEP');
    proposal.semesters[1].course_ids = ['PRE'];
    expect(validatePlanProposal(proposal, ctx).errors).toEqual([]);
  });

  test('chronology follows board order even when proposal semesters arrive reversed', () => {
    expect(validate(true, { [B]: ['PRE'], [A]: ['DEP'] }).errors).toHaveLength(1);
    expect(validate(true, { [B]: ['DEP'], [A]: ['PRE'] }).errors).toEqual([]);
  });

  test.each([true, false, undefined])('reachability and preflight use the same boundary (flag=%s)', flag => {
    const m = model(flag);
    const state = emptyState(SEMS);
    expect(requiredButUnplacedCourseIds(state, m).has('DEP')).toBe(flag === true);
    expect(analyzeHardConstraints(m).outcome).toBe(flag === true ? 'feasible' : 'infeasible');
  });

  test('recursive reachability and actions include concurrent prerequisite chains but exclude later slots', () => {
    const m = model(true, [A, B]);
    m.profiles.get('PRE')!.prerequisites = ['ROOT'];
    m.profiles.set('ROOT', { ...m.profiles.get('PRE')!, course_id: 'ROOT', prerequisites: [] });
    const state = emptyState(SEMS);
    expect([...requiredButUnplacedCourseIds(state, m)].sort()).toEqual(['DEP', 'PRE', 'ROOT']);
    const boundaries = requiredCourseSemesterBoundaries(state, m);
    expect(boundaries.get('PRE')).toBe(0);
    expect(boundaries.get('ROOT')).toBe(0);
    const adds = enumerateActions(state, m).filter(a => a.type === 'ADD_COURSE' && a.courseId !== 'DEP');
    expect(adds).toEqual(expect.arrayContaining([
      { type: 'ADD_COURSE', courseId: 'PRE', semesterId: A },
      { type: 'ADD_COURSE', courseId: 'ROOT', semesterId: A },
    ]));
    expect(adds.every(a => a.type === 'ADD_COURSE' && a.semesterId === A)).toBe(true);
    expect(analyzeHardConstraints(m).outcome).toBe('feasible');
  });

  test.each([false, undefined])('default strict action boundary excludes the dependent semester (flag=%s)', flag => {
    const m = model(flag, [A, B], 'PRE', [B]);
    const state = emptyState(SEMS);
    expect(requiredButUnplacedCourseIds(state, m).has('DEP')).toBe(true);
    expect(analyzeHardConstraints(m).outcome).toBe('feasible');
    expect(enumerateActions(state, m).filter(a => a.type === 'ADD_COURSE' && a.courseId === 'PRE'))
      .toEqual([{ type: 'ADD_COURSE', courseId: 'PRE', semesterId: A }]);
  });

  test('an already placed concurrent prerequisite is reachable but a later one is not', () => {
    const m = model(true, [A, B]);
    expect(requiredButUnplacedCourseIds({ semesters: { [A]: ['PRE'] } }, m).has('DEP')).toBe(true);
    expect(requiredButUnplacedCourseIds({ semesters: { [B]: ['PRE'] } }, m).has('DEP')).toBe(false);
  });

  test.each(['later', 'unknown', 'excluded'])('%s prerequisite remains impossible when enabled', kind => {
    const m = model(true, kind === 'later' ? [B] : [A], kind === 'unknown' ? 'EXTERNAL' : 'PRE');
    if (kind === 'excluded') m.disallowedCourseIds.add('PRE');
    expect(requiredButUnplacedCourseIds(emptyState(SEMS), m).has('DEP')).toBe(false);
    expect(analyzeHardConstraints(m).reasons.map(r => r.code)).toContain('wanted_prerequisite_impossible');
    expect(m.completedCourseIds.size).toBe(0);
  });

  test.each(['upstream', 'downstream'])('relocation respects concurrent %s ordering', direction => {
    const m = model(true);
    m.hardCap = 5;
    const base = m.profiles.get('PRE')!;
    m.profiles.get('DEP')!.prerequisites = [];
    m.profiles.get('DEP')!.placement_policy = 'fixed';
    m.profiles.get('DEP')!.effective_allowed_semesters = [A];
    m.profiles.set('CROWDER', { ...base, course_id: 'CROWDER', hours: 4,
      effective_allowed_semesters: [A, B], offered_semesters: [A, B],
      prerequisites: direction === 'upstream' ? ['ANCHOR'] : [] });
    m.profiles.set('ANCHOR', { ...base, course_id: 'ANCHOR', hours: 1,
      prerequisites: direction === 'downstream' ? ['CROWDER'] : [] });
    const state: PlanState = { semesters: { [A]: ['CROWDER'], [B]: ['ANCHOR'], [C]: [] } };
    expect(requiredButUnplacedCourseIds(state, m).has('DEP')).toBe(true);
    Object.assign(m, { allowConcurrentPrerequisites: false });
    expect(requiredButUnplacedCourseIds(state, m).has('DEP')).toBe(false);
    Object.assign(m, { allowConcurrentPrerequisites: true });
    state.semesters[B] = [];
    state.semesters[direction === 'upstream' ? C : A].push('ANCHOR');
    expect(requiredButUnplacedCourseIds(state, m).has('DEP')).toBe(false);
  });
});

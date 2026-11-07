import { buildConstraintModel } from '../../api/ai/planner_model';
import { validateCandidate, validatePlanState } from '../../api/ai/planner_validate';
import { addCourseActionsFor } from '../../api/ai/planner_actions';
import { boardResponseToModel } from '../../shared/planner/adapters';
import eeMainBoard from '../../data/boards/electrical_engineering_2027.json';
import eeEarlyBoard from '../../data/boards/electrical_engineering_years_1_2_2027.json';
import { manualBoardValidationContext } from '../../api/ai/manual_board_validation';

const A = 'year_3_semester_a';
const model = (rules: unknown[]) => buildConstraintModel({ semesters: [{ semester_id: A, courses: [] }], metadata: {
  completed_course_ids: [], degree_rules: rules,
  program_requirements_categories: { total_required_hours: 3, categories: [] },
  program_repository_courses: ['ONE', 'TWO'].map(course_id => ({ course_id, name_he: course_id,
    weekly_hours: 3, is_mandatory: false, offered_semesters: [A], prerequisites: [], placement_policy: 'elective' })),
} });

test('the planner model enforces declared course exclusions during placement', () => {
  const m = model([{ rule_id: 'overlap', kind: 'mutually_exclusive', course_ids: ['ONE', 'TWO'], params: {} }]);
  expect(validatePlanState({ semesters: { [A]: ['ONE'] } }, m).valid).toBe(true);
  const invalid = validatePlanState({ semesters: { [A]: ['ONE', 'TWO'] } }, m);
  expect(invalid.valid).toBe(false);
  expect(invalid.errors.some(e => e.includes('overlap'))).toBe(true);
});

test('a reported external exclusion counterpart blocks overlap without creating catalog credit', () => {
  const m = buildConstraintModel({ semesters: [{ semester_id: A, courses: [] }], metadata: {
    degree_rules: [{ rule_id: 'external-overlap', kind: 'mutually_exclusive', course_ids: ['0512-4264', '0368-3235'], params: {} }],
    program_requirements_categories: { total_required_hours: 3, categories: [] },
    program_repository_courses: [{ course_id: '0512-4264', name_he: 'EE course', weekly_hours: 3,
      offered_semesters: [A], prerequisites: [], is_mandatory: false, placement_policy: 'elective' }],
  } }, { completedCourseIds: ['0368-3235'] });
  expect(m.completedCourseIds.has('0368-3235')).toBe(false);
  expect(m.priorHours).toBe(0);
  const result = validatePlanState({ semesters: { [A]: ['0512-4264'] } }, m);
  expect(result.valid).toBe(false);
  expect(result.errors.some(e => e.includes('external-overlap'))).toBe(true);
});

test('a partial selection stays editable but cannot be certified complete', () => {
  const m = model([{ rule_id: 'two-tracks', kind: 'distinct_categories', course_ids: ['ONE', 'TWO'],
    params: { min_courses: 2, min_distinct_categories: 2, category_members: { a: ['ONE'], b: ['TWO'] } } }]);
  const state = { semesters: { [A]: ['ONE'] } };
  expect(validatePlanState(state, m).valid).toBe(true);
  expect(validateCandidate(state, m).valid).toBe(false);
});

test('an unimplemented personal eligibility condition is disclosed and cannot certify an AI candidate', () => {
  const m = model([{ rule_id: 'eligibility', kind: 'cohort_restriction', course_ids: ['ONE'], params: { min_average: 85 } }]);
  const state = { semesters: { [A]: ['ONE'] } };
  expect(validatePlanState(state, m).valid).toBe(true);
  expect(validatePlanState(state, m).warnings.some(w => w.includes('eligibility'))).toBe(true);
  expect(validateCandidate(state, m)).toMatchObject({ valid: false, complete: false });
});

test('generated EE boards restrict hardware lab placement before the degree rule is evaluated', () => {
  const courseId = '0512-4013';
  for (const [board, allowed] of [
    [eeEarlyBoard, ['year_1_semester_b', 'year_2_semester_a']],
    [eeMainBoard, []],
  ] as const) {
    const { metadata } = board;
    const withoutRules = { ...board, metadata: { ...metadata, degree_rules: [] } };
    const model = buildConstraintModel(withoutRules, { extraSemesterIds: ['year_5_semester_a'] });
    expect(boardResponseToModel(board).courseCatalog[courseId].offeredSemesters).toEqual(allowed);
    expect(buildConstraintModel(board, { completedCourseIds: [courseId] }).completedCourseIds.has(courseId)).toBe(true);
    expect(addCourseActionsFor(model, courseId)).toEqual(allowed.map(semesterId =>
      ({ type: 'ADD_COURSE', courseId, semesterId })));
    for (const semesterId of model.knownSemesterIds) {
      // This assertion isolates offering legality in an editable draft. Unknown
      // IMS evidence remains a warning here and a blocker for AI certification.
      const result = validatePlanState({ semesters: { [semesterId]: [courseId] } }, model, {}, manualBoardValidationContext(model));
      expect(result.valid).toBe((allowed as readonly string[]).includes(semesterId));
    }
  }
});

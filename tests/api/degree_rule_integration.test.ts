import { buildConstraintModel } from '../../api/ai/planner_model';
import { validateCandidate, validatePlanState } from '../../api/ai/planner_validate';

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

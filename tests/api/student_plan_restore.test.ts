import { validateSavedPlan } from '../../api/ai/student_plan_restore';
import type { AcademicContextRecord } from '../../api/ai/academic_context_store';
import type { SavedPlan } from '../../shared/planner/student-workspace';
const A = 'year_3_semester_a', B = 'year_3_semester_b';
const course = (id: string, more = {}) => ({ course_id: id, name_he: id, weekly_hours: 3, is_mandatory: false,
  offered_semesters: [A, B], effective_allowed_semesters: [A, B], prerequisites: [], placement_policy: 'elective', ...more });
const board = (courses: unknown[]) => ({ semesters: [{ semester_id: A, courses: [] }, { semester_id: B, courses: [] }], metadata: {
  completed_course_ids: [], program_repository_courses: courses,
  program_requirements_categories: { total_required_hours: 6, categories: [] },
} });
const context = (status = {}): AcademicContextRecord => ({ ownerId: 'owner', programId: 'test_program_2027', digest: 'digest', personalStatus: status,
  planContext: { semesters: [], personal_status: status }, preferences: {}, updatedAt: 1 });
const plan = (ids: string[], b: string[] = []): SavedPlan => ({ id: 'plan_test', name: 'Plan', notes: '', catalogVersion: null, createdAt: 1, updatedAt: 1,
  semesters: [{ semesterId: A, courseIds: ids }, { semesterId: B, courseIds: b }], weeklySchedule: { termMapping: {}, selections: {}, freeDays: [] } });
const check = (p: SavedPlan, courses: unknown[], ctx = context()) => validateSavedPlan(p, board(courses), ctx, 'test_program_2027', null);
test('a restored elective cannot bypass prerequisite timing', () => {
  const courses = [course('C0'), course('C1', { prerequisites: ['C0'] })];
  expect(check(plan(['C1']), courses).valid).toBe(false);
  expect(check(plan(['C0'], ['C1']), courses).valid).toBe(true);
});
test('a saved plan rejects completed courses and can display current enrollment', () => {
  const courses = [course('C1')];
  expect(check(plan(['C1']), courses, context({ completed: [{ course_id: 'C1' }] })).valid).toBe(false);
  expect(check(plan(['C1']), courses, context({ currently_taking: [{ course_id: 'C1' }] })).valid).toBe(true);
});
test('restoration preserves mandatory requirements and annual course atomicity', () => {
  expect(check(plan([]), [course('M1', { is_mandatory: true })]).valid).toBe(false);
  const courses = [course('Y1', { is_annual: true, spans_semesters: [A, B] })];
  expect(check(plan(['Y1']), courses).valid).toBe(false);
  expect(check(plan(['Y1'], ['Y1']), courses).valid).toBe(true);
});

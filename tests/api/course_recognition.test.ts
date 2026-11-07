import { evaluateCourseRecognition, recognizedAdditionalCourses, type CourseRecognitionReport } from '../../shared/planner/course-recognition';
import { evaluateDegreeRules, type DegreeRule } from '../../shared/planner/degree-rules';
import { buildModel } from '../../api/ai/generate-plan';
import { buildValidationContext } from '../../api/ai/planner_validate';
import spec from '../../data/degrees/tau/electrical_engineering/2027/spec.json';

const rule = spec.course_rules.find(r => r.rule_id === 'additional-course-recognition')!;
const external = '0599-9999';
const report: CourseRecognitionReport = { useForDegreeCredit: true, scope: 'out_of_catalog', completed: true, priorApproval: true,
  approvalReference: 'Prior teaching-committee decision', syllabusReference: 'Submitted syllabus', instructorConsentReference: 'Instructor consent',
  officialCourseReference: 'University course record', recognizedDegreeHours: 4, creditAwardReference: 'University awarded degree credit', averageAtApproval: 85 };
const evaluate = (reports: Record<string, CourseRecognitionReport> = { [external]: report }, hours: Record<string, number> = {}) => evaluateCourseRecognition(rule, reports, hours);

test('out-of-catalog recognition needs the source conditions and a distinct completion award', () => {
  expect(evaluate().additionalDegreeHours).toBe(4);
  expect(evaluate({ [external]: { ...report, averageAtApproval: 84 } }).status).toBe('fail');
  expect(evaluate({ [external]: { ...report, priorApproval: false } }).status).toBe('needs_review');
  expect(evaluate({ [external]: { ...report, syllabusReference: '' } }).status).toBe('needs_review');
  expect(evaluate({ [external]: { ...report, instructorConsentReference: '' } }).status).toBe('needs_review');
  expect(evaluate({ [external]: { ...report, creditAwardReference: '' } }).status).toBe('needs_review');
  const future = evaluate({ [external]: { ...report, completed: false, creditAwardReference: undefined } });
  expect(future.status).toBe('pass');
  expect(future.additionalDegreeHours).toBe(0);
  expect(future.recognizedCourseIds).toEqual([]);
});

test('the normal one-course limit needs a scoped exceptional decision for additional courses', () => {
  const two = { [external]: report, '0599-9998': report };
  expect(evaluate(two).status).toBe('needs_review');
  expect(evaluate(Object.fromEntries(Object.entries(two).map(([id, value]) => [id, { ...value, exceptionalLimitReference: 'Committee exception covering both named courses' }]))).additionalDegreeHours).toBe(8);
  expect(evaluate({ [external]: { ...report, scope: 'supplementary' } }).status).toBe('needs_review');
});

test('recognized external credit is counted once without creating a catalog course or prerequisite equivalence', () => {
  const board = { semesters: [{ semester_id: 'year_3_semester_a', courses: [] }], metadata: { degree_rules: [rule],
    program_requirements_categories: { total_required_hours: 179, categories: [] }, program_repository_courses: [] } };
  const model = buildModel(board, { total_hours_progress: { known_completed_hours: 4 }, personal_status: { completed: [{ course_id: external }],
    currently_taking: [{ course_id: external, hours: 4 }], degree_evidence: { additionalCourseRecognition: { [rule.rule_id]: { [external]: report } } },
  } }, {}, 'electrical_engineering_2027');
  expect(model.priorHours).toBe(4);
  expect(model.inProgressHours).toBe(0);
  expect(model.profiles.has(external)).toBe(false);
  expect(model.completedCourseIds.has(external)).toBe(false);
  expect(buildValidationContext(model).completedCourseIds.has(external)).toBe(false);
  const secondRule = { ...rule, rule_id: 'second-recognition' };
  const duplicated = recognizedAdditionalCourses([rule, secondRule], { [rule.rule_id]: { [external]: report }, [secondRule.rule_id]: { [external]: report } }, {});
  expect(duplicated.additionalDegreeHours).toBe(4);
  const conflict = recognizedAdditionalCourses([rule, secondRule], { [rule.rule_id]: { [external]: report }, [secondRule.rule_id]: {
    [external]: { ...report, recognizedDegreeHours: 5 },
  } }, {});
  expect(conflict.additionalDegreeHours).toBe(0);
  expect(conflict.conflictingCourseIds).toEqual([external]);
});

test('approval of supplementary filler preserves a valid twelve-course baseline with four distinct-track cores', () => {
  const ids = Array.from({ length: 13 }, (_, i) => `0512-${9000 + i}`);
  const core: DegreeRule = { rule_id: 'core-four-distinct-tracks', kind: 'distinct_categories', course_ids: ids.slice(0, 4),
    params: { min_courses: 4, min_distinct_categories: 4, category_members: Object.fromEntries(ids.slice(0, 4).map((id, i) => [`track${i}`, [id]])) } };
  const hours = Object.fromEntries(ids.map(id => [id, 3]));
  const approval: CourseRecognitionReport = { ...report, scope: 'supplementary', completed: false };
  const status = (approvedIds: string[], selected = ids) => evaluateDegreeRules([rule, core], {
    placements: selected.map(courseId => ({ courseId, semesterId: 5 })), trackCandidateCourseIds: ids, courseHours: hours,
    evidence: { additionalCourseRecognition: { [rule.rule_id]: Object.fromEntries(approvedIds.map(id => [id, approval])) } },
  })[0].status;
  expect(status([])).toBe('needs_review');
  expect(status([ids[12]])).toBe('pass');
  expect(status([ids[0]])).toBe('needs_review'); // The only approval cannot displace a required core.
  expect(status([ids[0], ids[12]])).toBe('pass');
  expect(status([], ids.slice(0, 12))).toBe('pass');
});

import { evaluateCourseExemption } from '../../shared/planner/course-exemptions';
import { evaluateDegreeRules } from '../../shared/planner/degree-rules';
import { buildModel } from '../../api/ai/generate-plan';
import { degreeCatalogFacts } from '../../shared/planner/degree-catalog';
import { earlyYearCoursesFor } from '../../shared/planner/early_year_courses';
import board from '../../data/boards/electrical_engineering_2027.json';
import spec from '../../data/degrees/tau/electrical_engineering/2027/spec.json';

const rule = spec.course_rules.find(r => r.rule_id === 'technician-exemption-eligibility')!;
const id = '0512-3561';
const catalog = degreeCatalogFacts(board, earlyYearCoursesFor('electrical_engineering_2027'));
const award = { approved: true, reference: 'Individual university exemption and degree-credit record', degreeCreditHours: catalog.courseHours[id]! };
const report = { credential: 'computers', governmentExamAverage: 80, excludesProject: true, awards: { [id]: award } };
const check = (value: any) => evaluateCourseExemption(rule, value, catalog.courseHours);

test('eligibility alone neither completes a course nor creates degree credit', () => {
  expect(check({ ...report, awards: {} }).recognizedCourseIds).toEqual([]);
  expect(check(undefined).status).toBe('pass');
  const eligibilityOnly = buildModel(board, { personal_status: { degree_evidence: {
    technicianExemptions: { [rule.rule_id]: { ...report, awards: {} } },
  } } }, {}, 'electrical_engineering_2027');
  expect(eligibilityOnly.completedCourseIds.has(id)).toBe(false);
});

test('a cited full-credit award is recognized once against the actual course catalog', () => {
  expect(check(report).recognizedCourseIds).toEqual([id]);
  const model = buildModel({ ...board, metadata: { ...board.metadata, degree_rules: [rule] } }, { personal_status: {
    completed: [{ course_id: id }], degree_evidence: { technicianExemptions: { [rule.rule_id]: report } },
  } }, {}, 'electrical_engineering_2027');
  expect(model.completedCourseIds.has(id)).toBe(true);
  expect(model.priorHours).toBe(catalog.courseHours[id]);
  expect(model.academicProgress!.recognizedCourseIds.filter(course => course === id)).toHaveLength(1);
  const alsoEnrolled = buildModel({ ...board, metadata: { ...board.metadata, degree_rules: [rule] } }, { personal_status: {
    currently_taking: [{ course_id: id, hours: 99 }], degree_evidence: { technicianExemptions: { [rule.rule_id]: report } },
  } }, {}, 'electrical_engineering_2027');
  expect(alsoEnrolled.priorHours).toBe(catalog.courseHours[id]);
  expect(alsoEnrolled.inProgressHours).toBe(0);
  expect(evaluateDegreeRules([rule], { courseHours: catalog.courseHours,
    evidence: { technicianExemptions: { [rule.rule_id]: report } },
  })[0].status).toBe('pass');
});

test('the government threshold excludes the project and applies to the correct credential list', () => {
  expect(check({ ...report, governmentExamAverage: 79 }).status).toBe('fail');
  expect(check({ ...report, excludesProject: false }).status).toBe('fail');
  expect(check({ ...report, governmentExamAverage: undefined }).status).toBe('needs_review');
  expect(check({ ...report, awards: { '0512-3513': award } }).status).toBe('fail');
});

test('a missing or different credit award cannot silently become catalog credit', () => {
  for (const changed of [{ ...award, reference: '' }, { ...award, degreeCreditHours: undefined },
    { ...award, degreeCreditHours: award.degreeCreditHours + 1 }]) {
    const result = check({ ...report, awards: { [id]: changed } });
    expect(result.status).toBe('needs_review');
    expect(result.recognizedCourseIds).toEqual([]);
  }
});

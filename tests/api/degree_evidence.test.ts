import { evaluateDegreeRules, type DegreeRuleContext } from '../../shared/planner/degree-rules';
import { readDegreeEvidence } from '../../shared/planner/degree-evidence';
import { buildModel } from '../../api/ai/generate-plan';
import ee from '../../data/boards/electrical_engineering_2027.json';
import { earlyYearCoursesFor } from '../../shared/planner/early_year_courses';

const evaluate = (kind: string, params: Record<string, unknown>, context: DegreeRuleContext, ids = ['C']) =>
  evaluateDegreeRules([{ rule_id: 'test', kind, course_ids: ids, params }], context)[0].status;
const placed = (semesterId: number, courseId = 'C') => ({ semesterId, courseId });
const approved = { decisions: { test: { approved: true, reference: 'Student reports faculty decision dated 2026-11-07' } } };

test('invalid evidence never creates an approval or a grade', () => {
  expect(readDegreeEvidence({ average: '100' })).toBeUndefined();
  expect(readDegreeEvidence({ average: 101 })).toBeUndefined();
  expect(readDegreeEvidence({ decisions: { test: { approved: 'yes', reference: 'email' } } })).toBeUndefined();
});

test('course eligibility requires both the threshold and a reported decision reference', () => {
  const params = { years: [4], min_average: 85, admission_interview: true };
  const placements = [placed(7)];
  expect(evaluate('year_restriction', params, { placements })).toBe('needs_review');
  expect(evaluate('year_restriction', params, { placements, evidence: { ...approved, average: 84 } })).toBe('fail');
  expect(evaluate('year_restriction', params, { placements, evidence: { average: 90 } })).toBe('needs_review');
  expect(evaluate('year_restriction', params, { placements, evidence: { ...approved, average: 90 } })).toBe('pass');
  expect(evaluate('year_restriction', params, { placements: [placed(6)], evidence: { ...approved, average: 90 } })).toBe('fail');
});

test('spring-cohort restrictions use the reported intake and exact study semester', () => {
  const params = { cohort: 'spring_intake', semesters: [5] };
  expect(evaluate('cohort_restriction', params, { placements: [placed(6)] })).toBe('needs_review');
  expect(evaluate('cohort_restriction', params, { placements: [placed(6)], evidence: { intake: 'spring' } })).toBe('fail');
  expect(evaluate('cohort_restriction', params, { placements: [placed(5)], evidence: { intake: 'spring' } })).toBe('pass');
  expect(evaluate('cohort_restriction', params, { placements: [placed(6)], evidence: { intake: 'autumn' } })).toBe('pass');
});

test('English recognition counts unique selected course identities after the cohort cutoff', () => {
  const params = { language: 'en', min_courses: 2, applies_from_year: 2021 };
  const context = { completedCourseIds: ['0512-4100', '0512-4200'] };
  expect(evaluate('language_requirement', params, context, [])).toBe('needs_review');
  expect(evaluate('language_requirement', params, { ...context, evidence: { higherEducationStartYear: 2020 } }, [])).toBe('pass');
  expect(evaluate('language_requirement', params, { ...context, evidence: {
    higherEducationStartYear: 2021, recognizedEnglishCourseIds: ['0512-4100', '0512-4100', '0512-4506'],
  } }, [])).toBe('fail');
  expect(evaluate('language_requirement', params, { ...context, evidence: {
    higherEducationStartYear: 2021, recognizedEnglishCourseIds: ['0512-4100', '0512-4200'],
  } }, [])).toBe('pass');
});

test('extensions and reduced load require recorded university decisions', () => {
  const params = { extension_years: 1, standard_semesters: 8 };
  expect(evaluate('study_duration', params, { placements: [placed(8)] }, [])).toBe('pass');
  expect(evaluate('study_duration', params, { placements: [placed(9)] }, [])).toBe('needs_review');
  expect(evaluate('study_duration', params, { placements: [placed(9)], evidence: approved }, [])).toBe('needs_review');
  expect(evaluate('study_duration', params, { placements: [placed(9)], evidence: { durationExtensions: {
    test: { ordinary: { approved: true, approvedThroughSemester: 10, reference: 'Committee decision through semester 10' } },
  } } }, [])).toBe('pass');
  expect(evaluate('study_duration', params, { placements: [placed(20)], evidence: { durationExtensions: {
    test: { ordinary: { approved: true, approvedThroughSemester: 10, reference: 'Ordinary extension' } },
  } } }, [])).toBe('needs_review');
  const load = { min_load_fraction_without_approval: 0.75 };
  const context = { placements: [{ courseId: 'C', semesterId: 'year_3_semester_a' }], courseHours: { C: 15 } };
  const fullTimeLoadBySemester = { year_3_semester_a: { hours: 20, reference: 'University recommended program' } };
  expect(evaluate('load_limit', load, context, [])).toBe('needs_review');
  expect(evaluate('load_limit', load, { ...context, evidence: { fullTimeLoadBySemester } }, [])).toBe('pass');
  expect(evaluate('load_limit', load, { ...context, courseHours: { C: 14 }, evidence: { fullTimeLoadBySemester } }, [])).toBe('needs_review');
  expect(evaluate('load_limit', load, { ...context, courseHours: { C: 14 }, evidence: { ...approved, fullTimeLoadBySemester } }, [])).toBe('pass');
});

test('a university decision cannot bypass the two graduate-courses-per-semester cap', () => {
  const params = { course_level: 'graduate (תואר שני)', max_per_semester: 2 };
  const evidence = { ...approved, average: 90, graduateCourseIds: ['0512-4100', '0512-4200', '0512-4506'],
    graduateEligibility: { test: { committeeMinimumAverage: 85, committeeReference: 'Committee threshold',
      trackHeadApproval: { approved: true, reference: 'Head decision' } } } };
  const placements = evidence.graduateCourseIds.map(courseId => placed(5, courseId));
  expect(evaluate('load_limit', params, { placements, evidence }, [])).toBe('fail');
  expect(evaluate('load_limit', params, { placements: placements.slice(0, 2), evidence }, [])).toBe('pass');
  expect(evaluate('load_limit', params, { placements: placements.slice(0, 2), evidence: { ...evidence, average: 0 } }, [])).toBe('fail');
});

test('concurrent enrollment is not exam eligibility without a cited student record', () => {
  const params = { prerequisite_may_be_concurrent: true, satisfied_by: 'attending the prerequisite course and being eligible for its exam' };
  const context: DegreeRuleContext = { placements: [placed(5, '0512-4100')], currentCourseIds: ['0512-2532'],
    prerequisiteExpressions: { '0512-4100': { any_of: [{ course_id: '0512-2532' }, { course_id: '0512-3632' }] } } };
  expect(evaluate('prerequisite_policy', params, context, [])).toBe('needs_review');
  expect(evaluate('prerequisite_policy', params, { ...context, evidence: { prerequisiteEligibility: {
    '0512-2532': { attended: true, examEligible: true, reference: 'Student university enrollment record' },
  } } }, [])).toBe('pass');
  expect(evaluate('prerequisite_policy', params, { ...context, evidence: { prerequisiteEligibility: {
    '0512-2532': { attended: true, examEligible: false, reference: 'Student record' },
  } } }, [])).toBe('fail');
});

test('the later EE board recognizes exact early-year completions without making them schedulable', () => {
  const courses = earlyYearCoursesFor('electrical_engineering_2027');
  const model = buildModel(ee, { personal_status: {
    completed: courses.map(course => ({ course_id: course.courseId })),
    degree_evidence: { intake: 'spring' },
  } }, {}, 'electrical_engineering_2027');
  expect(model.completedCourseIds.size).toBe(courses.length);
  expect(model.priorHours).toBe(courses.reduce((sum, c) => sum + c.creditHours, 0));
  expect(model.profiles.has(courses[0].courseId)).toBe(false);
  expect(model.degreeEvidence?.intake).toBe('spring');
});

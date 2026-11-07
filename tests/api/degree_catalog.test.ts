import { degreeCatalogFacts } from '../../shared/planner/degree-catalog';
import ee from '../../data/boards/electrical_engineering_2027.json';
import { earlyYearCoursesFor } from '../../shared/planner/early_year_courses';

test('published course homes survive edited plans and include exact early-year requirements', () => {
  const early = earlyYearCoursesFor('electrical_engineering_2027');
  const facts = degreeCatalogFacts(ee, early);
  for (const course of early) {
    expect(facts.mandatorySemesters[course.courseId]).toBe(course.semesterId);
    expect(facts.courseHours[course.courseId]).toBe(course.creditHours);
  }
  for (const semester of ee.semesters) for (const course of semester.courses) {
    if (course.course_type === 'mandatory') expect(facts.mandatorySemesters[course.course_id]).toBe(semester.semester_id);
    expect(facts.courseHours[course.course_id]).toBe(course.weekly_hours);
  }
});

test('unknown hours stay unknown rather than becoming zero load', () => {
  expect(degreeCatalogFacts({ metadata: { program_repository_courses: [
    { course_id: 'missing' }, { course_id: 'negative', weekly_hours: -4 },
  ] } }).courseHours).toEqual({ missing: null, negative: null });
});

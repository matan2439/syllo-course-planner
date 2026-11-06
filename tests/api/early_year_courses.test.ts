import { earlyYearCoursesFor, earlyYearHoursById } from '../../shared/planner/early_year_courses';
import { PROGRAM_REGISTRY } from '../../shared/programs';
import standard from '../../data/config/early_year_courses.json';

const flag = process.env.NEXT_PUBLIC_ENABLE_EE_PLANNER;
afterEach(() => {
  if (flag === undefined) delete process.env.NEXT_PUBLIC_ENABLE_EE_PLANNER;
  else process.env.NEXT_PUBLIC_ENABLE_EE_PLANNER = flag;
});

test('public EE planner recognizes all 21 official early mandatory completions', () => {
  delete process.env.NEXT_PUBLIC_ENABLE_EE_PLANNER;
  const courses = earlyYearCoursesFor('electrical_engineering_2027');
  expect(courses).toHaveLength(21);
  expect(new Set(courses.map((c) => c.courseId)).size).toBe(21);
  expect(earlyYearCoursesFor('electrical_engineering_years_1_2_2027')).toEqual(courses);
  expect(earlyYearHoursById('electrical_engineering_2027'))
    .toEqual(Object.fromEntries(courses.map((c) => [c.courseId, c.creditHours])));
  expect(earlyYearCoursesFor('electrical_engineering_2025')).toEqual([]);
  for (const draft of PROGRAM_REGISTRY.filter((p) => p.status === 'draft' && p.id !== 'electrical_engineering_2027')) {
    expect(earlyYearCoursesFor(draft.id)).toEqual([]);
  }
});

test.each(['0', '1'])('ME stays on its standard index with flag %s', (value) => {
  process.env.NEXT_PUBLIC_ENABLE_EE_PLANNER = value;
  expect(earlyYearCoursesFor('mechanical_engineering_2027')).toEqual(standard.mechanical_engineering_2027);
  expect(earlyYearCoursesFor('mechanical_engineering_years_1_2_2027')).toEqual(standard.mechanical_engineering_2027);
});

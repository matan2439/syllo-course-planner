/**
 * Adapter contract: metadata.program_repository_courses from the board JSON
 * → grouped view model for the Next-native read-only repository surface.
 * Pure presentation mapping; no selection/eligibility logic.
 */
import { adaptRepository } from '../../web/lib/repository';

const rawBoard = {
  semesters: [],
  metadata: {
    program_repository_courses: [
      {
        course_id: '0542-4120',
        name_he: 'מבוא לאווירודינמיקה',
        weekly_hours: 4,
        category_id: 'fluids',
        program_category_name_he: 'קורסי ליבה — זורמים',
        offered_semesters: ['A'],
        difficulty_level: 'medium',
        syllabus_url: 'https://example.test/syllabus',
        is_mandatory: false,
      },
      {
        course_id: '0542-4460',
        name_he: 'קורס התמחות כלשהו',
        weekly_hours: null,
        category_id: 'other_specialization',
        program_category_name_he: 'קורסי התמחות / בחירה נוספים',
        offered_semesters: ['A', 'B'],
        difficulty_level: null,
        syllabus_url: null,
        is_mandatory: false,
      },
      {
        course_id: '0542-4123',
        name_he: 'זרימה צמיגה',
        weekly_hours: 4,
        category_id: 'fluids',
        program_category_name_he: 'קורסי ליבה — זורמים',
        offered_semesters: ['B'],
        difficulty_level: 'medium',
        syllabus_url: null,
        is_mandatory: false,
      },
    ],
  },
};

test('groups courses by category preserving first-appearance order', () => {
  const repo = adaptRepository(rawBoard);
  expect(repo.categories.map((c) => c.id)).toEqual([
    'fluids',
    'other_specialization',
  ]);
  expect(repo.categories[0].title).toBe('קורסי ליבה — זורמים');
  expect(repo.categories[0].courses.map((c) => c.id)).toEqual([
    '0542-4120',
    '0542-4123',
  ]);
  expect(repo.totalCourses).toBe(3);
});

test('maps repository course essentials including semester availability', () => {
  const [c1, c2] = [
    adaptRepository(rawBoard).categories[0].courses[0],
    adaptRepository(rawBoard).categories[1].courses[0],
  ];
  expect(c1).toMatchObject({
    id: '0542-4120',
    name: 'מבוא לאווירודינמיקה',
    weeklyHours: 4,
    offered: ['A'],
    difficulty: 'medium',
    syllabusUrl: 'https://example.test/syllabus',
  });
  expect(c2).toMatchObject({
    id: '0542-4460',
    weeklyHours: null,
    offered: ['A', 'B'],
    syllabusUrl: null,
  });
});

test('null name_he never reaches the view model (real data has such rows)', () => {
  // e.g. 0542-4124 / 0542-4191 ship name_he: null — a null name crashed
  // the search filter in the browser.
  const repo = adaptRepository({
    semesters: [],
    metadata: {
      program_repository_courses: [
        {
          course_id: '0542-4124',
          name_he: null,
          weekly_hours: null,
          category_id: 'fluids',
          program_category_name_he: 'קורסי ליבה — זורמים',
          offered_semesters: null,
          difficulty_level: null,
          syllabus_url: null,
        },
      ],
    },
  });
  const course = repo.categories[0].courses[0];
  expect(typeof course.name).toBe('string');
  expect(course.name.length).toBeGreaterThan(0);
});

test('missing repository metadata yields an empty view model', () => {
  const repo = adaptRepository({ semesters: [] });
  expect(repo.categories).toEqual([]);
  expect(repo.totalCourses).toBe(0);
});

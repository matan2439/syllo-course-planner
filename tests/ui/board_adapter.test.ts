/**
 * Adapter contract: board JSON (as served by /api/board and
 * data/parsed_json/*.json — the same shape the static planner consumes)
 * → view model for the Next-native read-only board. Pure presentation
 * mapping; no planner logic, no credit/hour calculation (totals come
 * from the data).
 */
import { adaptBoard, planOverview, SEMESTER_ORDER } from '../../web/lib/board';

const rawBoard = {
  semesters: [
    // Deliberately shuffled — the adapter must impose the canonical order
    {
      semester_id: 'year_4_semester_a',
      display_name: "שנה ד' — סמסטר א'",
      courses: [],
      total_weekly_hours: 0,
      average_difficulty: null,
      warnings: [],
    },
    {
      semester_id: 'year_3_semester_a',
      display_name: 'Year 3 — Semester A', // real data ships English names
      total_weekly_hours: 26,
      average_difficulty: 2.3,
      warnings: ['עומס גבוה'],
      courses: [
        {
          course_id: '0512-1204',
          name_he: 'המרת אנרגיה והנע חשמלי',
          weekly_hours: 3.5,
          course_type: 'mandatory',
          difficulty_level: null,
          syllabus_url: 'https://example.test/syllabus',
          validation_status: 'ok',
          warnings: [],
        },
        {
          course_id: '0542-9999',
          name_he: 'קורס בחירה כלשהו',
          weekly_hours: 4,
          course_type: 'elective',
          difficulty_level: 'hard',
          syllabus_url: null,
          validation_status: 'ok',
          warnings: ['אזהרה כלשהי'],
        },
      ],
    },
  ],
};

test('orders semesters canonically: Y3A, Y3B, Y4A, Y4B', () => {
  expect(SEMESTER_ORDER).toEqual([
    'year_3_semester_a',
    'year_3_semester_b',
    'year_4_semester_a',
    'year_4_semester_b',
  ]);
  const board = adaptBoard(rawBoard);
  expect(board.semesters.map((s) => s.id)).toEqual([
    'year_3_semester_a',
    'year_4_semester_a',
  ]);
});

test('known semesters get Hebrew titles; totals come from data untouched', () => {
  const sem = adaptBoard(rawBoard).semesters[0];
  expect(sem.title).toBe('שנה ג׳ — סמסטר א׳');
  expect(sem.totalWeeklyHours).toBe(26);
  expect(sem.averageDifficulty).toBe(2.3);
  expect(sem.warnings).toEqual(['עומס גבוה']);
});

test('planOverview exposes the data-shipped counts for the /plan hub', () => {
  const overview = planOverview({
    ...rawBoard,
    summary: { total_courses: 12 },
  });
  expect(overview).toEqual({ plannedCourses: 12, semesterCount: 2 });
});

test('planOverview falls back to counting placed courses when summary is missing', () => {
  expect(planOverview(rawBoard).plannedCourses).toBe(2);
});

test('maps course essentials for the card', () => {
  const [c1, c2] = adaptBoard(rawBoard).semesters[0].courses;
  expect(c1).toMatchObject({
    id: '0512-1204',
    name: 'המרת אנרגיה והנע חשמלי',
    weeklyHours: 3.5,
    type: 'mandatory',
    syllabusUrl: 'https://example.test/syllabus',
    hasWarnings: false,
  });
  expect(c2).toMatchObject({
    id: '0542-9999',
    type: 'elective',
    difficulty: 'hard',
    syllabusUrl: null,
    hasWarnings: true,
  });
});

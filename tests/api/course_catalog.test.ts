/**
 * Course Catalog reader — tests for api/ai/course_catalog.ts.
 *
 * extractCatalogCourses pulls the deterministic course universe (placed
 * semester courses UNION metadata.program_repository_courses) out of a raw
 * board_json, mirroring buildCourseProfiles' universe definition
 * (course_profile.ts) but keeping only the fields needed for deterministic
 * topic inference: courseId, nameHe, categoryId.
 *
 * loadMechanicalEngineering2027Catalog reads the committed local board and
 * returns that catalog for the real TAU Mechanical Engineering 2027 program.
 */

import {
  extractCatalogCourses,
  loadMechanicalEngineering2027Catalog,
  MECHANICAL_ENGINEERING_2027_PROGRAM_ID,
} from '../../api/ai/course_catalog';

describe('extractCatalogCourses', () => {
  test('extracts repository courses with courseId, nameHe and categoryId', () => {
    const board = {
      semesters: [],
      metadata: {
        program_repository_courses: [
          { course_id: 'C1', name_he: 'מכניקת הזורמים', category_id: 'fluids' },
        ],
      },
    };
    expect(extractCatalogCourses(board)).toEqual([{ courseId: 'C1', nameHe: 'מכניקת הזורמים', categoryId: 'fluids' }]);
  });

  test('unions placed semester courses with repository courses (deduped by courseId)', () => {
    const board = {
      semesters: [{ courses: [{ course_id: 'P1', name_he: 'תכן מכני' }] }],
      metadata: {
        program_repository_courses: [{ course_id: 'C1', name_he: 'זרימה', category_id: 'fluids' }],
      },
    };
    const ids = extractCatalogCourses(board).map((c) => c.courseId);
    expect(ids).toEqual(['C1', 'P1']); // sorted asc, both present
  });

  test('is sorted by courseId ascending for determinism', () => {
    const board = {
      semesters: [],
      metadata: {
        program_repository_courses: [
          { course_id: 'C2', name_he: 'b', category_id: 'x' },
          { course_id: 'C1', name_he: 'a', category_id: 'y' },
          { course_id: 'C3', name_he: 'c', category_id: 'z' },
        ],
      },
    };
    expect(extractCatalogCourses(board).map((c) => c.courseId)).toEqual(['C1', 'C2', 'C3']);
  });

  test('a placed course missing a category falls back to null but keeps its name', () => {
    const board = {
      semesters: [{ courses: [{ course_id: 'P1', name_he: 'מבוא לבקרה' }] }],
      metadata: { program_repository_courses: [] },
    };
    expect(extractCatalogCourses(board)).toEqual([{ courseId: 'P1', nameHe: 'מבוא לבקרה', categoryId: null }]);
  });

  test('a null course name is preserved as null (not fabricated)', () => {
    const board = {
      semesters: [],
      metadata: { program_repository_courses: [{ course_id: 'C1', name_he: null, category_id: 'other' }] },
    };
    expect(extractCatalogCourses(board)).toEqual([{ courseId: 'C1', nameHe: null, categoryId: 'other' }]);
  });

  test('merges placed + repository records for the same id, preferring repository category', () => {
    const board = {
      semesters: [{ courses: [{ course_id: 'C1', name_he: 'שם מהלוח' }] }],
      metadata: { program_repository_courses: [{ course_id: 'C1', name_he: 'שם מהמאגר', category_id: 'fluids' }] },
    };
    expect(extractCatalogCourses(board)).toEqual([{ courseId: 'C1', nameHe: 'שם מהמאגר', categoryId: 'fluids' }]);
  });

  test('ignores entries without a string course_id', () => {
    const board = {
      semesters: [{ courses: [{ name_he: 'no id' }, null] }],
      metadata: { program_repository_courses: [{ course_id: 42 }, { course_id: 'C1', name_he: 'ok' }] },
    };
    expect(extractCatalogCourses(board).map((c) => c.courseId)).toEqual(['C1']);
  });

  test('tolerates a missing/empty board without throwing', () => {
    expect(extractCatalogCourses(null)).toEqual([]);
    expect(extractCatalogCourses({})).toEqual([]);
    expect(extractCatalogCourses({ metadata: {} })).toEqual([]);
  });

  test('does not mutate the input board', () => {
    const board = {
      semesters: [{ courses: [{ course_id: 'P1', name_he: 'x' }] }],
      metadata: { program_repository_courses: [{ course_id: 'C1', name_he: 'y', category_id: 'fluids' }] },
    };
    const snapshot = JSON.parse(JSON.stringify(board));
    extractCatalogCourses(board);
    expect(board).toEqual(snapshot);
  });
});

describe('loadMechanicalEngineering2027Catalog', () => {
  test('loads the full 68-course TAU Mechanical Engineering 2027 universe', () => {
    const catalog = loadMechanicalEngineering2027Catalog();
    expect(catalog.length).toBe(68);
    expect(new Set(catalog.map((c) => c.courseId)).size).toBe(68);
  });

  test('includes both repository electives and placed mandatory-core courses', () => {
    const ids = new Set(loadMechanicalEngineering2027Catalog().map((c) => c.courseId));
    expect(ids.has('0542-4120')).toBe(true); // repository elective (תרמודינמיקה)
    expect(ids.has('0542-2400')).toBe(true); // placed core (תכן מכני)
  });

  test('program id constant matches the committed board filename', () => {
    expect(MECHANICAL_ENGINEERING_2027_PROGRAM_ID).toBe('mechanical_engineering_2027');
  });
});

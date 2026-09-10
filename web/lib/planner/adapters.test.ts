/**
 * Tests for shared/planner/adapters.ts, colocated under web/ so web's jest
 * config (the only one that runs TS tests outside tests/api) picks them up.
 */
import { boardResponseToModel } from '../../../shared/planner/adapters'
import { isAnnualCourse } from '../../../shared/planner/model'

const BASE_BOARD = {
  metadata: { board_data_version: 'rev-1' },
  semesters: [
    { semester_id: 'year_3_semester_a', courses: [] },
    { semester_id: 'year_3_semester_b', courses: [] },
    { semester_id: 'year_4_semester_a', courses: [] },
    { semester_id: 'year_4_semester_b', courses: [] },
  ],
}

test('expands bare "A"/"B" offered_semesters into every real semester id ending in that half', () => {
  const board = {
    ...BASE_BOARD,
    semesters: [
      {
        semester_id: 'year_3_semester_a',
        courses: [{ course_id: 'C-1', name_he: 'קורס', weekly_hours: 3, course_type: 'mandatory', offered_semesters: ['A', 'B'] }],
      },
      ...BASE_BOARD.semesters.slice(1),
    ],
  }
  const model = boardResponseToModel(board)
  expect(model.courseCatalog['C-1'].offeredSemesters).toEqual([
    'year_3_semester_a', 'year_4_semester_a', 'year_3_semester_b', 'year_4_semester_b',
  ])
})

test('a course offered in only one bare half expands to every semester id of that half', () => {
  const board = {
    ...BASE_BOARD,
    semesters: [
      {
        semester_id: 'year_4_semester_a',
        courses: [{ course_id: 'C-2', name_he: 'קורס', weekly_hours: 2, course_type: 'elective', offered_semesters: ['A'] }],
      },
      ...BASE_BOARD.semesters.filter((s) => s.semester_id !== 'year_4_semester_a'),
    ],
  }
  const model = boardResponseToModel(board)
  expect(model.courseCatalog['C-2'].offeredSemesters).toEqual(['year_3_semester_a', 'year_4_semester_a'])
})

test('already-full semester ids pass through unchanged, and unknown tokens are dropped', () => {
  const board = {
    ...BASE_BOARD,
    semesters: [
      {
        semester_id: 'year_3_semester_a',
        courses: [{ course_id: 'C-3', name_he: 'קורס', weekly_hours: 2, course_type: 'elective', offered_semesters: ['year_3_semester_a', 'nonsense'] }],
      },
      ...BASE_BOARD.semesters.slice(1),
    ],
  }
  const model = boardResponseToModel(board)
  expect(model.courseCatalog['C-3'].offeredSemesters).toEqual(['year_3_semester_a'])
})

test('a course with no offered_semesters field keeps offeredSemesters absent (unknown, not "any")', () => {
  const board = {
    ...BASE_BOARD,
    semesters: [
      { semester_id: 'year_3_semester_a', courses: [{ course_id: 'C-4', name_he: 'קורס', weekly_hours: 2, course_type: 'elective' }] },
      ...BASE_BOARD.semesters.slice(1),
    ],
  }
  const model = boardResponseToModel(board)
  expect(model.courseCatalog['C-4'].offeredSemesters).toBeUndefined()
})

test('program_category_id and placement_policy pass through to the catalog unchanged', () => {
  const board = {
    metadata: { board_data_version: 'rev-1' },
    semesters: [
      {
        semester_id: 'year_3_semester_a',
        courses: [
          { course_id: 'FLU-1', name_he: 'זרימה', weekly_hours: 3, course_type: 'elective', program_category_id: 'fluids', placement_policy: 'elective' },
          { course_id: 'MAND-1', name_he: 'חובה', weekly_hours: 4, course_type: 'mandatory', placement_policy: 'fixed' },
        ],
      },
      { semester_id: 'year_3_semester_b', courses: [] },
      { semester_id: 'year_4_semester_a', courses: [] },
      { semester_id: 'year_4_semester_b', courses: [] },
    ],
  }
  const model = boardResponseToModel(board)
  expect(model.courseCatalog['FLU-1'].programCategoryId).toBe('fluids')
  expect(model.courseCatalog['MAND-1'].programCategoryId).toBeUndefined()
  expect(model.courseCatalog['MAND-1'].placementPolicy).toBe('fixed')
})

test('isAnnualCourse is true only for placement_policy "annual"', () => {
  expect(isAnnualCourse({ courseId: 'x', nameHe: '', halfHours: null, courseType: '', isMandatory: true, placementPolicy: 'annual' })).toBe(true)
  expect(isAnnualCourse({ courseId: 'x', nameHe: '', halfHours: null, courseType: '', isMandatory: true, placementPolicy: 'flexible' })).toBe(false)
  expect(isAnnualCourse({ courseId: 'x', nameHe: '', halfHours: null, courseType: '', isMandatory: false })).toBe(false)
})

test('isAnnualCourse is true for an annual ELECTIVE course too (is_annual independent of placement_policy)', () => {
  const board = {
    metadata: { board_data_version: 'rev-1' },
    semesters: [
      {
        semester_id: 'year_3_semester_a',
        courses: [{ course_id: 'ANN-ELEC-1', name_he: 'שנתי בחירה', weekly_hours: 4, course_type: 'elective', placement_policy: 'elective', is_annual: true }],
      },
      { semester_id: 'year_3_semester_b', courses: [] },
      { semester_id: 'year_4_semester_a', courses: [] },
      { semester_id: 'year_4_semester_b', courses: [] },
    ],
  }
  const model = boardResponseToModel(board)
  const course = model.courseCatalog['ANN-ELEC-1']
  expect(course.isAnnual).toBe(true)
  expect(course.placementPolicy).toBe('elective')
  expect(isAnnualCourse(course)).toBe(true)
})

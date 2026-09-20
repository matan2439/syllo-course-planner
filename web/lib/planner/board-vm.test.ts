/**
 * Slice 1 — canonical BoardModel → presentational BoardVM, via the shared
 * adapter (never bypassing shared/planner by hand-building a BoardModel).
 */
import { boardModelToVM, semesterTitleHe } from './board-vm'
import { boardResponseToModel } from '../../../shared/planner/adapters'

// Semesters intentionally OUT OF ORDER to prove canonical SEMESTER_ORDER sorting.
const BOARD_UNORDERED = {
  metadata: { board_data_version: 'rev-1' },
  semesters: [
    { semester_id: 'year_3_semester_b', courses: [] },
    {
      semester_id: 'year_3_semester_a',
      courses: [{ course_id: 'C-1', name_he: 'קורס', weekly_hours: 3.5, course_type: 'mandatory', is_mandatory: true }],
    },
  ],
}

test('orders semesters by canonical SEMESTER_ORDER and converts half-hours to exact decimals', () => {
  const vm = boardModelToVM(boardResponseToModel(BOARD_UNORDERED))
  expect(vm.semesters.map((s) => s.id)).toEqual(['year_3_semester_a', 'year_3_semester_b'])
  expect(vm.semesters[0].courses[0].weeklyHours).toBe(3.5) // exact, no rounding
})

test('an empty semester carries no courses (truthful empty)', () => {
  const vm = boardModelToVM(boardResponseToModel(BOARD_UNORDERED))
  expect(vm.semesters[1].id).toBe('year_3_semester_b')
  expect(vm.semesters[1].courses).toEqual([])
})

test('semesterTitleHe derives program-agnostic Hebrew titles and falls back for unknown ids', () => {
  expect(semesterTitleHe('year_4_semester_b')).toBe('שנה ד׳ — סמסטר ב׳')
  expect(semesterTitleHe('unrecognized_id')).toBe('unrecognized_id')
})

test('identifier-agnostic: a synthetic program maps without any real catalog claim', () => {
  const vm = boardModelToVM(
    boardResponseToModel({
      metadata: { board_data_version: 'gen' },
      semesters: [
        { semester_id: 'year_1_semester_a', courses: [{ course_id: 'X-1', name_he: 'x', weekly_hours: 0.5, course_type: 't' }] },
      ],
    }),
  )
  expect(vm.semesters[0].courses[0].weeklyHours).toBe(0.5)
})

test('display fields not in the canonical contract are deferred (D1): difficulty/syllabus/warnings/totals null', () => {
  const vm = boardModelToVM(boardResponseToModel(BOARD_UNORDERED))
  const course = vm.semesters[0].courses[0]
  expect(course.difficulty).toBeNull()
  expect(course.syllabusUrl).toBeNull()
  expect(course.hasWarnings).toBe(false)
  expect(vm.semesters[0].totalWeeklyHours).toBeNull()
})

test('categoryId is copied from the catalog for every categorized course, including mandatory courses', () => {
  const board = {
    metadata: { board_data_version: 'rev-1' },
    semesters: [
      {
        semester_id: 'year_3_semester_a',
        courses: [
          { course_id: 'FLU-1', name_he: 'זרימה', weekly_hours: 3, course_type: 'elective', category_id: 'fluids' },
          { course_id: 'ELEC-2', name_he: 'בחירה כללית', weekly_hours: 2, course_type: 'elective' },
          { course_id: 'MAND-1', name_he: 'חובה', weekly_hours: 4, course_type: 'mandatory', category_id: 'solids' },
        ],
      },
      { semester_id: 'year_3_semester_b', courses: [] },
      { semester_id: 'year_4_semester_a', courses: [] },
      { semester_id: 'year_4_semester_b', courses: [] },
    ],
  }
  const vm = boardModelToVM(boardResponseToModel(board))
  const [flu, elec, mand] = vm.semesters[0].courses
  expect(flu.categoryId).toBe('fluids')
  expect(elec.categoryId).toBe('other_specialization') // uncategorized elective falls back
  expect(mand.categoryId).toBe('solids')
})

test('isAnnual is copied from the catalog placement policy or explicit is_annual flag', () => {
  const board = {
    metadata: { board_data_version: 'rev-1' },
    semesters: [
      {
        semester_id: 'year_3_semester_a',
        courses: [{ course_id: 'ANN-1', name_he: 'שנתי', weekly_hours: 4, course_type: 'mandatory', placement_policy: 'annual' }],
      },
      { semester_id: 'year_3_semester_b', courses: [] },
      { semester_id: 'year_4_semester_a', courses: [] },
      { semester_id: 'year_4_semester_b', courses: [] },
    ],
  }
  const vm = boardModelToVM(boardResponseToModel(board))
  expect(vm.semesters[0].courses[0].isAnnual).toBe(true)
})

test('an unresolved course (not in courseCatalog) never gets a fabricated categoryId or isAnnual', () => {
  // Mirrors the placeholder apply-plan.ts's resolve() produces for a generated
  // course id the catalog doesn't know: courseType '', isMandatory false —
  // truthfully "unknown", not "elective".
  const model = {
    catalogRevision: 'rev-1' as never,
    courseCatalog: {},
    semesters: [
      { semesterId: 'year_3_semester_a', courses: [{ courseId: 'UNKNOWN-1', nameHe: '', halfHours: null, courseType: '', isMandatory: false }] },
    ],
  }
  const vm = boardModelToVM(model)
  const course = vm.semesters[0].courses[0]
  expect(course.categoryId).toBeUndefined()
  expect(course.isAnnual).toBeUndefined()
})

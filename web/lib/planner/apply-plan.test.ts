import { applyCommittedBoard, applyGeneratedToBoard, removedCourseIds } from './apply-plan'
import { boardResponseToModel, generatePlanResponseToModel } from '../../../shared/planner/adapters'
import { catalogRevision } from '../../../shared/planner/model'

const base = () => boardResponseToModel({
  metadata: {
    board_data_version: 'rev-1',
    program_repository_courses: [{ course_id: 'Y-1', name_he: 'קורס Y', weekly_hours: 3.5, is_mandatory: false }],
  },
  semesters: [
    { semester_id: 'year_3_semester_a', courses: [{ course_id: 'X-1', name_he: 'קורס X', weekly_hours: 3.0, course_type: 'mandatory', is_mandatory: true }] },
    { semester_id: 'year_3_semester_b', courses: [] },
  ],
})

test('applying resolves generated ids against the catalog and preserves revision + universe', () => {
  const gen = generatePlanResponseToModel({
    semesters: [{ semester_id: 'year_3_semester_a', course_ids: ['X-1', 'Y-1'] }],
    moves: [], warnings_he: [], errors: [], blocked: false,
  })
  const applied = applyGeneratedToBoard(gen, base())
  expect(applied.catalogRevision).toBe(base().catalogRevision)
  expect(applied.courseCatalog).toEqual(base().courseCatalog) // universe unchanged
  const semA = applied.semesters.find((s) => s.semesterId === 'year_3_semester_a')!
  expect(semA.courses.map((c) => c.courseId)).toEqual(['X-1', 'Y-1'])
  expect(semA.courses.find((c) => c.courseId === 'Y-1')!.nameHe).toBe('קורס Y') // resolved metadata
})

test('an unknown generated id becomes a truthful placeholder, never fabricated', () => {
  const gen = generatePlanResponseToModel({
    semesters: [{ semester_id: 'year_3_semester_a', course_ids: ['GHOST-9'] }],
    moves: [], warnings_he: [], errors: [], blocked: false,
  })
  const c = applyGeneratedToBoard(gen, base()).semesters[0].courses[0]
  expect(c).toEqual({ courseId: 'GHOST-9', nameHe: '', halfHours: null, courseType: '', isMandatory: false })
})

test('removedCourseIds reports base placements the proposal drops', () => {
  const gen = generatePlanResponseToModel({
    semesters: [{ semester_id: 'year_3_semester_a', course_ids: [] }],
    moves: [], warnings_he: [], errors: [], blocked: false,
  })
  expect(removedCourseIds(base(), gen)).toEqual([{ id: 'X-1', nameHe: 'קורס X' }])
})

test('removedCourseIds is empty when every placed course survives', () => {
  const gen = generatePlanResponseToModel({
    semesters: [{ semester_id: 'year_3_semester_a', course_ids: ['X-1'] }],
    moves: [], warnings_he: [], errors: [], blocked: false,
  })
  expect(removedCourseIds(base(), gen)).toEqual([])
})

test('requirementsValidation survives a manual-edit merge unchanged (never recomputed client-side)', () => {
  const base = {
    catalogRevision: catalogRevision('rev-1'),
    courseCatalog: {},
    semesters: [{ semesterId: 'year_3_semester_a', courses: [] }],
    requirementsValidation: {
      valid: false, totalRequiredHours: 185, plannedHours: 128.5, remainingHours: 56.5,
      coreCoursesTotalMin: 6, coreCoursesSelected: 0, coreCoursesSatisfied: false,
      categories: [], warnings: [],
    },
  }
  const result = applyGeneratedToBoard({ semesters: [], moves: [], warningsHe: [], errors: [], blocked: false }, base)
  expect(result.requirementsValidation).toBe(base.requirementsValidation)
})

describe('applyCommittedBoard', () => {
  const requirements = {
    valid: true, totalRequiredHours: 185, plannedHours: 48, remainingHours: 137,
    coreCoursesTotalMin: 6, coreCoursesSelected: 6, coreCoursesSatisfied: true, categories: [], warnings: [],
  }
  const semesters = [{ semesterId: 'year_3_semester_a', courseIds: ['X-1', 'Y-1'] }]

  test('adopts the requirements the server recomputed for the committed plan', () => {
    const board = applyCommittedBoard({ programId: 'p', version: 'bv_1', semesters, requirementsValidation: requirements }, base())
    expect(board.requirementsValidation).toEqual(requirements)
    expect(board.semesters[0].courses.map((c) => c.courseId)).toEqual(['X-1', 'Y-1'])
  })

  test('keeps the base numbers when the server sent none (no base snapshot to refresh)', () => {
    const withBase = { ...base(), requirementsValidation: { ...requirements, plannedHours: 45 } }
    const board = applyCommittedBoard({ programId: 'p', version: 'bv_1', semesters }, withBase)
    expect(board.requirementsValidation?.plannedHours).toBe(45)
  })
})

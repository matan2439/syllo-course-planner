/**
 * Slice 2 — draft view-model. Generated course IDs are resolved through the
 * canonical BoardModel.courseCatalog; new/moved/unchanged markers come from a
 * placement-set diff (NOT from the response `moves` array). Everything flows
 * through shared/planner adapters (no hand-built canonical models).
 */
import { buildDraftVM } from './draft-vm'
import { boardResponseToModel, generatePlanResponseToModel } from '../../../shared/planner/adapters'

// Base board: 1 placed course (X, in year_3_semester_a) + repository universe (R, Y).
const BOARD = {
  metadata: {
    board_data_version: 'rev-1',
    program_repository_courses: [
      { course_id: 'R-1', name_he: 'קורס מאגר', weekly_hours: 2.5, is_mandatory: false },
      { course_id: 'Y-1', name_he: 'קורס Y', weekly_hours: 3.5, is_mandatory: true },
    ],
  },
  semesters: [
    { semester_id: 'year_3_semester_a', courses: [{ course_id: 'X-1', name_he: 'קורס X', weekly_hours: 3.0, course_type: 'mandatory', is_mandatory: true }] },
    { semester_id: 'year_3_semester_b', courses: [] },
  ],
}
const base = () => boardResponseToModel(BOARD)

const genResponse = (overrides: Record<string, unknown> = {}) =>
  generatePlanResponseToModel({
    semesters: [
      { semester_id: 'year_3_semester_a', course_ids: ['X-1', 'Y-1'] },
      { semester_id: 'year_3_semester_b', course_ids: ['R-1'] },
    ],
    moves: [
      { course_id: 'Y-1', from: null, to: 'year_3_semester_a' }, // from:null (new) — but must be proven by diff, not this
      { course_id: 'R-1', from: null, to: 'year_3_semester_b' },
    ],
    warnings_he: ['אזהרה'],
    errors: [],
    blocked: false,
    ...overrides,
  })

test('resolves a repository-only generated course through courseCatalog with real metadata', () => {
  const vm = buildDraftVM(genResponse(), base())
  const semB = vm.semesters.find((s) => s.id === 'year_3_semester_b')!
  const r = semB.courses.find((c) => c.id === 'R-1')!
  expect(r.resolved).toBe(true)
  expect(r.nameHe).toBe('קורס מאגר')
  expect(r.weeklyHours).toBe(2.5) // exact half-hour
})

test('markers: new / moved / unchanged derived from placement-set diff', () => {
  const vm = buildDraftVM(genResponse(), base())
  const byId = (id: string) => vm.semesters.flatMap((s) => s.courses).find((c) => c.id === id)!
  expect(byId('X-1').marker).toBe('unchanged') // base {a}, gen {a}
  expect(byId('Y-1').marker).toBe('new') // not in base placements at all
  expect(byId('R-1').marker).toBe('new') // repo course, newly placed
})

test('moves.from:null does NOT force "new": an annual add (base {a}, gen {a,b}) is "moved"', () => {
  const g = generatePlanResponseToModel({
    semesters: [
      { semester_id: 'year_3_semester_a', course_ids: ['X-1'] },
      { semester_id: 'year_3_semester_b', course_ids: ['X-1'] }, // now spans a+b
    ],
    moves: [{ course_id: 'X-1', from: null, to: 'year_3_semester_b' }], // response says from:null
    warnings_he: [], errors: [], blocked: false,
  })
  const vm = buildDraftVM(g, base())
  // base placement {a} vs generated {a,b} → set differs → moved, NOT new
  expect(vm.semesters.flatMap((s) => s.courses).find((c) => c.id === 'X-1')!.marker).toBe('moved')
})

test('an unresolved generated course id stays visible with a truthful unavailable state (no fabrication)', () => {
  const g = generatePlanResponseToModel({
    semesters: [{ semester_id: 'year_3_semester_a', course_ids: ['GHOST-9'] }],
    moves: [], warnings_he: [], errors: [], blocked: false,
  })
  const vm = buildDraftVM(g, base())
  const ghost = vm.semesters.flatMap((s) => s.courses).find((c) => c.id === 'GHOST-9')!
  expect(ghost.resolved).toBe(false)
  expect(ghost.id).toBe('GHOST-9') // exact id preserved
  expect(ghost.nameHe).toBeNull()
  expect(ghost.weeklyHours).toBeNull()
  expect(ghost.isMandatory).toBeNull()
})

test('a semester with any unresolved/unknown-hours course does not present an authoritative total', () => {
  const g = generatePlanResponseToModel({
    semesters: [{ semester_id: 'year_3_semester_a', course_ids: ['X-1', 'GHOST-9'] }],
    moves: [], warnings_he: [], errors: [], blocked: false,
  })
  const semA = buildDraftVM(g, base()).semesters.find((s) => s.id === 'year_3_semester_a')!
  expect(semA.totalComplete).toBe(false)
  expect(semA.totalWeeklyHours).toBeNull()
})

test('a fully-resolved semester reports an exact authoritative total (no float drift)', () => {
  const g = generatePlanResponseToModel({
    semesters: [{ semester_id: 'year_3_semester_a', course_ids: ['X-1', 'R-1'] }], // 3.0 + 2.5
    moves: [], warnings_he: [], errors: [], blocked: false,
  })
  const semA = buildDraftVM(g, base()).semesters.find((s) => s.id === 'year_3_semester_a')!
  expect(semA.totalComplete).toBe(true)
  expect(semA.totalWeeklyHours).toBe(5.5)
})

test('large authoritative total stays exact (186.5)', () => {
  const board = {
    metadata: { board_data_version: 'r', program_repository_courses: [{ course_id: 'BIG', name_he: 'ב', weekly_hours: 186.5, is_mandatory: false }] },
    semesters: [{ semester_id: 'year_3_semester_a', courses: [] }],
  }
  const g = generatePlanResponseToModel({ semesters: [{ semester_id: 'year_3_semester_a', course_ids: ['BIG'] }], moves: [], warnings_he: [], errors: [], blocked: false })
  const semA = buildDraftVM(g, boardResponseToModel(board)).semesters.find((s) => s.id === 'year_3_semester_a')!
  expect(semA.totalWeeklyHours).toBe(186.5)
})

test('draft semesters follow canonical SEMESTER_ORDER', () => {
  const g = generatePlanResponseToModel({
    semesters: [
      { semester_id: 'year_3_semester_b', course_ids: ['R-1'] },
      { semester_id: 'year_3_semester_a', course_ids: ['X-1'] },
    ],
    moves: [], warnings_he: [], errors: [], blocked: false,
  })
  expect(buildDraftVM(g, base()).semesters.map((s) => s.id)).toEqual(['year_3_semester_a', 'year_3_semester_b'])
})

test('carries blocked/warnings/errors through from the generated model', () => {
  const vm = buildDraftVM(genResponse({ blocked: true, errors: ['שגיאת תחום'] }), base())
  expect(vm.blocked).toBe(true)
  expect(vm.errors).toEqual(['שגיאת תחום'])
  expect(vm.warningsHe).toEqual(['אזהרה'])
})

test('does not mutate the base BoardModel or the GeneratedPlanModel', () => {
  const b = base()
  const g = genResponse()
  const bSnap = JSON.stringify(b)
  const gSnap = JSON.stringify(g)
  buildDraftVM(g, b)
  expect(JSON.stringify(b)).toBe(bSnap)
  expect(JSON.stringify(g)).toBe(gSnap)
})

test('identifier-agnostic (generic program ids)', () => {
  const board = {
    metadata: { board_data_version: 'g', program_repository_courses: [{ course_id: 'GEN-1', name_he: 'g', weekly_hours: 0.5, is_mandatory: false }] },
    semesters: [{ semester_id: 'year_1_semester_a', courses: [] }],
  }
  const g = generatePlanResponseToModel({ semesters: [{ semester_id: 'year_1_semester_a', course_ids: ['GEN-1'] }], moves: [], warnings_he: [], errors: [], blocked: false })
  const vm = buildDraftVM(g, boardResponseToModel(board))
  expect(vm.semesters[0].courses[0].weeklyHours).toBe(0.5)
})

// A course can be IN the catalog (metadata resolved) yet have no display name
// (real repo courses carry name_he: null). resolved and nameHe are independent.
const nullNameBoard = () =>
  boardResponseToModel({
    metadata: { board_data_version: 'r', program_repository_courses: [{ course_id: 'NM-1', name_he: null, weekly_hours: 2.0, is_mandatory: true }] },
    semesters: [{ semester_id: 'year_3_semester_a', courses: [] }],
  })
const genNM = () =>
  generatePlanResponseToModel({ semesters: [{ semester_id: 'year_3_semester_a', course_ids: ['NM-1'] }], moves: [], warnings_he: [], errors: [], blocked: false })

test('a catalog course with a null/empty name resolves (metadata present) but exposes nameHe=null (no fabrication)', () => {
  const c = buildDraftVM(genNM(), nullNameBoard()).semesters[0].courses[0]
  expect(c.resolved).toBe(true) // id IS in courseCatalog
  expect(c.nameHe).toBeNull() // but no display name — never invented
  expect(c.weeklyHours).toBe(2.0) // independent authoritative field preserved
  expect(c.isMandatory).toBe(true)
})

test('a missing name alone does NOT suppress an authoritative total when hours are known', () => {
  const semA = buildDraftVM(genNM(), nullNameBoard()).semesters[0]
  expect(semA.totalComplete).toBe(true)
  expect(semA.totalWeeklyHours).toBe(2.0)
})

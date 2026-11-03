import {
  DEFAULT_SEMESTER_WINDOW, DEGREE_YEARS, degreeYearsForBoard, nextSemesterId, resolveSelectedSemester, semesterWindowForDegreeYear, semesterWindowSlots,
  scheduleSlotsForBoard, windowBoardIdFor, withAddedSemesters,
} from './semester-window'
import { programIdOfBoard } from '../../../shared/planner/window_board'
import { earlyYearCoursesFor } from '../../../shared/planner/early_year_courses'
import { semesterTitleHe } from './board-vm'

test('the default window is the late-degree one: Years 3–4, unchanged', () => {
  expect(DEFAULT_SEMESTER_WINDOW).toBe('late')
  expect(semesterWindowSlots()).toEqual([
    { id: 'year_3_semester_a', label: 'שנה ג׳ — סמסטר א׳' },
    { id: 'year_3_semester_b', label: 'שנה ג׳ — סמסטר ב׳' },
    { id: 'year_4_semester_a', label: 'שנה ד׳ — סמסטר א׳' },
    { id: 'year_4_semester_b', label: 'שנה ד׳ — סמסטר ב׳' },
  ])
  expect(semesterWindowSlots('late')).toEqual(semesterWindowSlots())
})

test('the early-degree window is Years 1–2', () => {
  expect(semesterWindowSlots('early')).toEqual([
    { id: 'year_1_semester_a', label: 'שנה א׳ — סמסטר א׳' },
    { id: 'year_1_semester_b', label: 'שנה א׳ — סמסטר ב׳' },
    { id: 'year_2_semester_a', label: 'שנה ב׳ — סמסטר א׳' },
    { id: 'year_2_semester_b', label: 'שנה ב׳ — סמסטר ב׳' },
  ])
})

test('button text is derived from the stable id, never stored separately', () => {
  for (const slot of [...semesterWindowSlots('early'), ...semesterWindowSlots('late')]) {
    expect(slot.label).toBe(semesterTitleHe(slot.id))
  }
})

test.each([[1, 'early'], [2, 'early'], [3, 'late'], [4, 'late']] as const)(
  'Year %i → the %s window', (year, window) => {
    expect(semesterWindowForDegreeYear(year)).toBe(window)
  })

test('an unknown year keeps the default window', () => {
  expect(semesterWindowForDegreeYear(null)).toBe(DEFAULT_SEMESTER_WINDOW)
})

describe('resolveSelectedSemester', () => {
  const early = semesterWindowSlots('early').map((s) => s.id)
  const late = semesterWindowSlots('late').map((s) => s.id)

  test('a selection still in the window is kept, whatever the year', () => {
    expect(resolveSelectedSemester(early, 'year_1_semester_b', 2)).toBe('year_1_semester_b')
  })

  test('a selection that left the window moves to the current year, same half', () => {
    expect(resolveSelectedSemester(early, 'year_3_semester_b', 1)).toBe('year_1_semester_b')
    expect(resolveSelectedSemester(early, 'year_4_semester_a', 2)).toBe('year_2_semester_a')
    expect(resolveSelectedSemester(late, 'year_1_semester_b', 4)).toBe('year_4_semester_b')
  })

  test('without a usable year it falls back to the first slot of the same half', () => {
    expect(resolveSelectedSemester(late, 'year_2_semester_b', null)).toBe('year_3_semester_b')
    expect(resolveSelectedSemester(late, 'year_2_semester_a', 1)).toBe('year_3_semester_a')
  })

  test('nothing picked yet → the current year’s first semester, or the first tab', () => {
    expect(resolveSelectedSemester(late, '', 4)).toBe('year_4_semester_a')
    expect(resolveSelectedSemester(late, '', null)).toBe('year_3_semester_a')
    expect(resolveSelectedSemester([], '', 3)).toBe('')
  })
})

test('each window resolves to the board that holds it; the published board keeps its own id', () => {
  expect(windowBoardIdFor('mechanical_engineering_2027', 'late', 3)).toBe('mechanical_engineering_2027')
  expect(windowBoardIdFor('mechanical_engineering_2027', 'early', 3)).toBe('mechanical_engineering_years_1_2_2027')
  expect(programIdOfBoard('mechanical_engineering_years_1_2_2027')).toBe('mechanical_engineering_2027')
  expect(programIdOfBoard('mechanical_engineering_2027')).toBe('mechanical_engineering_2027')
  expect(earlyYearCoursesFor('mechanical_engineering_years_1_2_2027'))
    .toEqual(earlyYearCoursesFor('mechanical_engineering_2027'))
})

test('degrees that run long: years 5–6 use the late window and its board grows past year 4', () => {
  expect(DEGREE_YEARS).toEqual([1, 2, 3, 4, 5, 6])
  expect(semesterWindowForDegreeYear(5)).toBe('late')
  const late = ['year_3_semester_a', 'year_3_semester_b', 'year_4_semester_a', 'year_4_semester_b']
  expect(nextSemesterId(late)).toBe('year_5_semester_a')
  expect(nextSemesterId([...late, 'year_5_semester_a'])).toBe('year_5_semester_b')
  expect(nextSemesterId(['year_6_semester_b'])).toBeNull()
  expect(nextSemesterId([])).toBeNull()
})

test('withAddedSemesters appends only the board columns past the window, flagged as added', () => {
  const slots = semesterWindowSlots('late')
  expect(withAddedSemesters(slots, slots.map((s) => s.id))).toEqual(slots)
  expect(withAddedSemesters(slots, [...slots.map((s) => s.id), 'year_5_semester_a']).at(-1))
    .toEqual({ id: 'year_5_semester_a', label: 'שנה ה׳ — סמסטר א׳', added: true })
})

test('a shorter degree drops the window slots its board lacks, and can still grow', () => {
  const slots = semesterWindowSlots('late')
  const threeYear = ['year_3_semester_a', 'year_3_semester_b']
  expect(scheduleSlotsForBoard('late', threeYear).map((s) => s.id)).toEqual(threeYear)
  expect(nextSemesterId(threeYear)).toBe('year_4_semester_a')
  expect(scheduleSlotsForBoard('late', [...threeYear, 'year_4_semester_a']).map((s) => s.id))
    .toEqual([...threeYear, 'year_4_semester_a'])
  // A four-year board keeps the window exactly; a board for the other window leaves it alone.
  expect(scheduleSlotsForBoard('late', slots.map((s) => s.id))).toEqual(slots)
  expect(scheduleSlotsForBoard('early', threeYear)).toEqual(semesterWindowSlots('early'))
  // Its own Year 3 columns are the destinations; Year 4 added there is past them, flagged added.
  const destinations = slots.slice(0, 2)
  expect(withAddedSemesters(destinations, [...threeYear, 'year_4_semester_a']).at(-1))
    .toEqual({ id: 'year_4_semester_a', label: 'שנה ד׳ — סמסטר א׳', added: true })
  // Board order does not matter; columns past the window come out in rank order.
  expect(withAddedSemesters(slots, [...slots.map((s) => s.id), 'year_6_semester_a', 'year_5_semester_b'])
    .slice(4).map((s) => s.id)).toEqual(['year_5_semester_b', 'year_6_semester_a'])
})

test('a board that does not plan the window never extends it', () => {
  const early = semesterWindowSlots('early')
  expect(withAddedSemesters(early, ['year_3_semester_a', 'year_5_semester_a'])).toEqual(early)
})

test('years 5–6 are offered only once the board has a semester there, or one is chosen', () => {
  expect(degreeYearsForBoard(['year_3_semester_a', 'year_4_semester_b'])).toEqual([1, 2, 3, 4])
  expect(degreeYearsForBoard(['year_4_semester_b', 'year_5_semester_a'])).toEqual([1, 2, 3, 4, 5])
  expect(degreeYearsForBoard([], 6)).toEqual([1, 2, 3, 4, 6])
})

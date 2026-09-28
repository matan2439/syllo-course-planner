import {
  DEFAULT_SEMESTER_WINDOW, resolveSelectedSemester, semesterWindowForDegreeYear, semesterWindowSlots, windowBoardIdFor,
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

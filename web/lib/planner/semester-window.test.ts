import { DEFAULT_SEMESTER_WINDOW, semesterWindowSlots } from './semester-window'
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

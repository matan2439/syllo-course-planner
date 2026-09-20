import { annualBandsOf } from './annual-bands'
import type { BoardVM } from '../board'

const board: BoardVM = {
  semesters: [
    { id: 'year_3_semester_a', title: 'א', totalWeeklyHours: null, averageDifficulty: null, warnings: [], courses: [
      { id: 'ANN-1', name: 'שנתי', weeklyHours: 4, type: 'mandatory', difficulty: null, syllabusUrl: null, hasWarnings: false, isAnnual: true },
      { id: 'M-1', name: 'רגיל', weeklyHours: 3, type: 'mandatory', difficulty: null, syllabusUrl: null, hasWarnings: false },
    ] },
    { id: 'year_3_semester_b', title: 'ב', totalWeeklyHours: null, averageDifficulty: null, warnings: [], courses: [
      { id: 'ANN-1', name: 'שנתי', weeklyHours: 4, type: 'mandatory', difficulty: null, syllabusUrl: null, hasWarnings: false, isAnnual: true },
    ] },
    { id: 'year_4_semester_a', title: 'ג', totalWeeklyHours: null, averageDifficulty: null, warnings: [], courses: [] },
    { id: 'year_4_semester_b', title: 'ד', totalWeeklyHours: null, averageDifficulty: null, warnings: [], courses: [] },
  ],
}

test('one band per unique annual course, positioned at the start of its year pair', () => {
  const bands = annualBandsOf(board)
  expect(bands).toEqual([{ course: board.semesters[0].courses[0], startIndex: 0 }])
})

test('no bands when there are no annual courses', () => {
  const noAnnual: BoardVM = { semesters: board.semesters.map((s) => ({ ...s, courses: s.courses.filter((c) => !c.isAnnual) })) }
  expect(annualBandsOf(noAnnual)).toEqual([])
})

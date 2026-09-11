import { render, screen } from '@testing-library/react'
import SemesterColumn from './SemesterColumn'
import type { SemesterVM } from '../../lib/board'

const SEMESTER_FIXTURE: SemesterVM = {
  id: 'year_3_semester_a', title: 'שנה ג׳ — סמסטר א׳', totalWeeklyHours: null, averageDifficulty: null,
  warnings: [], courses: [],
}

test('a successful placement flashes the target column via data-just-placed, keyed to re-trigger on repeat', () => {
  const { rerender } = render(
    <SemesterColumn semester={SEMESTER_FIXTURE} index={0} justPlaced justPlacedKey={1} />,
  )
  expect(screen.getByLabelText(SEMESTER_FIXTURE.title)).toHaveAttribute('data-just-placed', 'true')
  rerender(<SemesterColumn semester={SEMESTER_FIXTURE} index={0} justPlaced={false} justPlacedKey={1} />)
  expect(screen.getByLabelText(SEMESTER_FIXTURE.title)).not.toHaveAttribute('data-just-placed')
})

test('the placement pulse does not remount the column itself — an in-progress drag survives a second placement', () => {
  // The pulse must be a lightweight keyed overlay, not a remount of the whole
  // column: remounting would restart the entrance ".rise" animation and could
  // silently interrupt a native drag in progress in this same column.
  const semesterWithCourse: SemesterVM = {
    ...SEMESTER_FIXTURE,
    courses: [{ id: 'C-1', name: 'קורס לדוגמה', weeklyHours: 3, type: 'elective', difficulty: null, syllabusUrl: null, hasWarnings: false }],
  }
  const { rerender } = render(<SemesterColumn semester={semesterWithCourse} index={0} justPlaced justPlacedKey={1} />)
  const courseNode = screen.getByText('קורס לדוגמה')
  // A second, distinct placement key must not detach and recreate this node —
  // the same DOM element instance must persist across the re-key.
  rerender(<SemesterColumn semester={semesterWithCourse} index={0} justPlaced justPlacedKey={2} />)
  expect(screen.getByText('קורס לדוגמה')).toBe(courseNode)
  rerender(<SemesterColumn semester={semesterWithCourse} index={0} justPlaced={false} justPlacedKey={2} />)
})

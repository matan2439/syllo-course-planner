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

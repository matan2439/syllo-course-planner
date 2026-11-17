import { render, screen } from '@testing-library/react'
import SemesterColumnHeader from './SemesterColumnHeader'
import type { SemesterVM } from '../../../lib/board'

const semester: SemesterVM = { id: 'year_4_semester_a', title: 'שנה ד׳ — סמסטר א׳', totalWeeklyHours: null, averageDifficulty: null, warnings: [], courses: [] }

test('a semester of an unpublished academic year is labelled as an estimate, with the reason on hover', () => {
  render(<SemesterColumnHeader semester={semester} projected />)
  expect(screen.getByText('צפי')).toBeInTheDocument()
  expect(screen.getByText('צפי').closest('span[title]')).toHaveAttribute('title', expect.stringContaining('טרם פורסמה'))
})

test('a published semester carries no estimate label', () => {
  render(<SemesterColumnHeader semester={semester} />)
  expect(screen.queryByText('צפי')).toBeNull()
})

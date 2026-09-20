import { render, screen } from '@testing-library/react'
import CourseCard from './CourseCard'

test('an elective with a categoryId gets the matching category accent class', () => {
  render(<CourseCard course={{
    id: 'FLU-1', name: 'זרימה', weeklyHours: 3, type: 'elective', difficulty: null,
    syllabusUrl: null, hasWarnings: false, categoryId: 'fluids',
  }} />)
  expect(screen.getByText('זרימה').closest('[data-category]')).toHaveAttribute('data-category', 'fluids')
})

test('a mandatory course has no data-category attribute', () => {
  // Named distinctly from the mandatory type badge text ('חובה') so getByText
  // resolves to the course name alone instead of matching both.
  render(<CourseCard course={{
    id: 'M-1', name: 'יסודות המכניקה', weeklyHours: 4, type: 'mandatory', difficulty: null,
    syllabusUrl: null, hasWarnings: false,
  }} />)
  expect(screen.getByText('יסודות המכניקה').closest('[data-category]')).toBeNull()
})

test('an annual course renders like any other card (no special layout) but is never draggable, even with 2+ offered semesters', () => {
  render(<CourseCard course={{
    id: 'ANN-1', name: 'קורס שנתי לדוגמה', weeklyHours: 4, type: 'mandatory', difficulty: null,
    syllabusUrl: null, hasWarnings: false, isAnnual: true,
    offeredSemesters: ['year_3_semester_a', 'year_3_semester_b'],
  }} onMove={jest.fn()} moveDestinations={[
    { semesterId: 'year_3_semester_a', label: 'שנה ג׳ — סמסטר א׳' },
    { semesterId: 'year_3_semester_b', label: 'שנה ג׳ — סמסטר ב׳' },
  ]} />)
  expect(screen.getByText('שנתי (א׳+ב׳)')).toBeInTheDocument()
  expect(screen.getByText('קורס שנתי לדוגמה').closest('[draggable]')).toHaveAttribute('draggable', 'false')
  expect(screen.queryByText(/גרור להעברה/)).toBeNull()
  expect(screen.queryByText(/אפשרויות העברה/)).toBeNull()
})

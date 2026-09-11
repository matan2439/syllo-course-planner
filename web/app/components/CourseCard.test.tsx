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

import { fireEvent, render, screen } from '@testing-library/react'
import { useState } from 'react'
import CompletedCoursesPanel, { EMPTY_ACADEMIC_STATUS, type AcademicStatusDraft } from './CompletedCoursesPanel'
import { EARLY_YEAR_SEMESTERS, earlyYearCoursesFor } from '../../../../shared/planner/early_year_courses'

const PROGRAM = 'mechanical_engineering_2027'

function Harness({ onChange }: { onChange: (next: AcademicStatusDraft) => void }) {
  const [value, setValue] = useState(EMPTY_ACADEMIC_STATUS)
  return (
    <CompletedCoursesPanel programId={PROGRAM} catalogCourses={[]} catalogHoursById={{}} value={value}
      onChange={(next) => { setValue(next); onChange(next) }} />
  )
}

test('one click marks, and then clears, every course of a semester', () => {
  const first = EARLY_YEAR_SEMESTERS[0]
  const ids = earlyYearCoursesFor(PROGRAM).filter((c) => c.semesterId === first.id).map((c) => c.courseId)
  expect(ids.length).toBeGreaterThan(1)
  let last = EMPTY_ACADEMIC_STATUS
  render(<Harness onChange={(next) => { last = next }} />)
  fireEvent.click(screen.getByText('קורסים שהשלמתי'))

  fireEvent.click(screen.getByRole('checkbox', { name: `כל ${first.titleHe}` }))
  expect(ids.every((id) => last.statuses[id] === 'completed')).toBe(true)
  expect(Object.keys(last.statuses)).toHaveLength(ids.length) // other semesters untouched
  expect(last.confirmed).toBe(false)

  fireEvent.click(screen.getByRole('checkbox', { name: `כל ${first.titleHe}` }))
  expect(last.statuses).toEqual({})
})

test('saving marks every unticked standard course not_completed and the set known', () => {
  let last = EMPTY_ACADEMIC_STATUS
  render(<Harness onChange={(next) => { last = next }} />)
  const [first, ...rest] = earlyYearCoursesFor(PROGRAM)
  fireEvent.click(screen.getByRole('checkbox', { name: new RegExp(first.nameHe) }))
  fireEvent.click(screen.getByRole('button', { name: 'שמירה' }))
  expect(last.confirmed).toBe(true)
  expect(last.statuses[first.courseId]).toBe('completed')
  expect(rest.every((c) => last.statuses[c.courseId] === 'not_completed')).toBe(true)
  expect(screen.getByRole('button', { name: 'נשמר' })).toBeDisabled()
})

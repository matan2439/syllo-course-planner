import { useState } from 'react'
import { fireEvent, render, screen } from '@testing-library/react'
import ScheduleOptions from './ScheduleOptions'
import type { WeeklyScheduleState } from '../../../lib/planner/schedule-storage'

const semesterId = 'year_3_semester_a'
function App() {
  const [state, onChange] = useState<WeeklyScheduleState>({ termMapping: {}, selections: {}, freeDays: [] })
  return <><ScheduleOptions programId="test" semesterId={semesterId} state={state} onChange={onChange} meetings={[]} courses={[{ courseId: 'C1', name: 'קורס ראשון' }, { courseId: 'C2', name: 'קורס שני' }]} /><output data-testid="state">{JSON.stringify(state)}</output></>
}
const state = () => JSON.parse(screen.getByTestId('state').textContent!)
test('adds scoped unavailability and rejects reversed times without changing stored state', () => {
  render(<App />)
  fireEvent.click(screen.getByText('אפשרויות מערכת וייצוא ליומן'))
  fireEvent.change(screen.getByLabelText('תיאור'), { target: { value: 'עבודה' } })
  fireEvent.click(screen.getByRole('button', { name: 'הוספת אילוץ' }))
  expect(state().busyTimes[0]).toMatchObject({ label: 'עבודה', semesterId, start: '09:00', end: '10:00' })
  fireEvent.change(screen.getByLabelText('תיאור'), { target: { value: 'לא תקין' } })
  fireEvent.change(screen.getByLabelText('סיום זמן חסום'), { target: { value: '08:00' } })
  fireEvent.click(screen.getByRole('button', { name: 'הוספת אילוץ' }))
  expect(screen.getByRole('alert')).toBeInTheDocument()
  expect(state().busyTimes).toHaveLength(1)
})
test('stores exact entered exams, flags close exams and persists only valid teaching dates', () => {
  render(<App />)
  fireEvent.click(screen.getByText('אפשרויות מערכת וייצוא ליומן'))
  fireEvent.change(screen.getByLabelText('קורס למבחן'), { target: { value: 'C1' } })
  fireEvent.input(screen.getByLabelText('תאריך המבחן'), { target: { value: '2027-02-01' } })
  fireEvent.click(screen.getByRole('button', { name: 'הוספת מבחן' }))
  fireEvent.change(screen.getByLabelText('קורס למבחן'), { target: { value: 'C2' } })
  fireEvent.input(screen.getByLabelText('תאריך המבחן'), { target: { value: '2027-02-02' } })
  fireEvent.click(screen.getByRole('button', { name: 'הוספת מבחן' }))
  expect(screen.getByText(/מרווח של 1 ימים/)).toBeInTheDocument()
  expect(state().exams).toHaveLength(2)
  fireEvent.input(screen.getByLabelText('תחילת תקופת השיעורים'), { target: { value: '2026-11-01' } })
  expect(state().calendarRange).toBeUndefined()
  fireEvent.input(screen.getByLabelText('סיום תקופת השיעורים'), { target: { value: '2027-01-31' } })
  expect(state().calendarRange).toEqual({ startDate: '2026-11-01', endDate: '2027-01-31' })
})

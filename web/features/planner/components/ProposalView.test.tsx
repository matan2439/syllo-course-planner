import { fireEvent, render, screen } from '@testing-library/react'
import ProposalView from './ProposalView'

const draft = {
  semesters: [{ id: 'year_4_semester_a', title: 'שנה ד׳ — סמסטר א׳', courses: [{ id: 'C1', nameHe: 'בינה חישובית', marker: 'new' }] }],
  blocked: false, errors: [], warningsHe: [],
} as any
const base = { draft, stale: false, staleReason: null, canApply: true, onReject: jest.fn(),
  semesterLoads: [{ semesterId: 'year_4_semester_a', hours: 19, overUserCap: false, overHardCap: false }] as any }

test('a proposal that only adds applies in one click and summarizes what changes', () => {
  const onApply = jest.fn()
  render(<ProposalView {...base} removed={[]} onApply={onApply} />)
  expect(screen.getByLabelText('סיכום ההצעה')).toHaveTextContent('+1 נוספו')
  expect(screen.getByLabelText('שינויים בהצעה')).toHaveTextContent('בינה חישובית')
  expect(screen.getByLabelText('שינויים בהצעה')).toHaveTextContent('19 ש״ש')
  fireEvent.click(screen.getByRole('button', { name: 'החל תוכנית' }))
  expect(onApply).toHaveBeenCalledTimes(1)
})

test('removing a board course needs an explicit second confirmation', () => {
  const onApply = jest.fn()
  render(<ProposalView {...base} removed={[{ id: 'R1', nameHe: 'תכן מכני (1)' }]} onApply={onApply} />)
  expect(screen.getByLabelText('קורסים שהוסרו')).toHaveTextContent('תכן מכני (1)')
  fireEvent.click(screen.getByRole('button', { name: 'החל תוכנית' }))
  expect(onApply).not.toHaveBeenCalled()
  fireEvent.click(screen.getByRole('button', { name: 'ביטול' }))
  fireEvent.click(screen.getByRole('button', { name: 'החל תוכנית' }))
  fireEvent.click(screen.getByRole('button', { name: 'כן, להסיר ולהחיל' }))
  expect(onApply).toHaveBeenCalledTimes(1)
})

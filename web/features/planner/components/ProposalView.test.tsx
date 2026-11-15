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

test('a partial plan always shows that it is not fully valid, with the unresolved conflict', () => {
  render(<ProposalView {...base} removed={[]} onApply={jest.fn()}
    unresolvedConflictsHe={['הקורס "אלפא" משובץ בסמסטר שבו אינו ניתן. אפשרויות: לאשר העברה / לאשר הסרה.']} />)
  const banner = screen.getByRole('alert', { name: 'התנגשות שלא נפתרה' })
  expect(banner).toHaveTextContent('תוכנית חלקית — לא תקינה במלואה')
  expect(banner).toHaveTextContent('אלפא')
})

test('a fully valid proposal shows no unresolved-conflict banner', () => {
  render(<ProposalView {...base} removed={[]} onApply={jest.fn()} />)
  expect(screen.queryByRole('alert', { name: 'התנגשות שלא נפתרה' })).toBeNull()
})

test('placements that rest on an estimated offering are labelled as estimates, never as confirmed', () => {
  render(<ProposalView {...base} removed={[]} onApply={jest.fn()} courseNameById={{ C1: 'בינה חישובית', C2: 'אלמנטים סופיים' }}
    projectedPlacements={[{ courseId: 'C1', semesterId: 'year_4_semester_a', status: 'projected' }, { courseId: 'C2', semesterId: 'year_4_semester_b', status: 'unknown' }]} />)
  const note = screen.getByRole('note', { name: 'זמינות צפויה' })
  expect(note).toHaveTextContent('צפויה בלבד')
  expect(note).toHaveTextContent('בינה חישובית')
  expect(note).toHaveTextContent('צפוי')
  expect(note).toHaveTextContent('אין מידע מספיק')
  expect(note).not.toHaveTextContent('מאושר')
})

test('a proposal with only confirmed offerings shows no estimate note', () => {
  render(<ProposalView {...base} removed={[]} onApply={jest.fn()} />)
  expect(screen.queryByRole('note', { name: 'זמינות צפויה' })).toBeNull()
})

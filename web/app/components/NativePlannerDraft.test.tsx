/**
 * Slice 2 — NativePlannerDraft (RTL). Generation goes through an INJECTED
 * function typed from the shared client; the draft flows base → shared adapters →
 * draft-vm. Tests-only (no route/nav/flag). No persistence/apply/edit controls.
 */
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react'
import NativePlannerDraft from './NativePlannerDraft'
import { boardResponseToModel, generatePlanResponseToModel } from '../../../shared/planner/adapters'
import { ContractError } from '../../../shared/planner/model'
import type { GeneratePlanRequest } from '../../../shared/planner/api-client'

const BOARD = {
  metadata: {
    board_data_version: 'rev-1',
    program_repository_courses: [{ course_id: 'Y-1', name_he: 'קורס Y', weekly_hours: 3.5, is_mandatory: true }],
  },
  semesters: [
    { semester_id: 'year_3_semester_a', courses: [{ course_id: 'X-1', name_he: 'קורס בסיס X', weekly_hours: 3.0, course_type: 'mandatory', is_mandatory: true }] },
    { semester_id: 'year_3_semester_b', courses: [] },
  ],
}
const base = (rev = 'rev-1') => boardResponseToModel({ ...BOARD, metadata: { ...BOARD.metadata, board_data_version: rev } })

const PROPOSAL = () => generatePlanResponseToModel({
  semesters: [{ semester_id: 'year_3_semester_a', course_ids: ['X-1', 'Y-1'] }, { semester_id: 'year_3_semester_b', course_ids: [] }],
  moves: [], warnings_he: ['אזהרת תחום'], errors: [], blocked: false,
})
const BLOCKED = () => generatePlanResponseToModel({
  semesters: [{ semester_id: 'year_3_semester_a', course_ids: ['X-1'] }],
  moves: [], warnings_he: [], errors: ['סמסטר עמוס מדי'], blocked: true,
})

const REQUEST: GeneratePlanRequest = {
  program_id: 'mechanical_engineering_2027', plan_context: {}, preferences: {}, session_token: '00000000-0000-4000-8000-000000000000',
}

function deferred<T>() {
  let resolve!: (v: T) => void
  let reject!: (e: unknown) => void
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej })
  return { promise, resolve, reject }
}

test('idle shows the base board and a generate control', () => {
  render(<NativePlannerDraft base={base()} request={REQUEST} generate={jest.fn()} />)
  expect(screen.getByText('קורס בסיס X')).toBeInTheDocument()
  expect(screen.getByRole('button', { name: /בנה/ })).toBeInTheDocument()
})

test('generate is called with the exact request and produces a distinct draft', async () => {
  const generate = jest.fn(async () => PROPOSAL())
  render(<NativePlannerDraft base={base()} request={REQUEST} generate={generate} />)
  fireEvent.click(screen.getByRole('button', { name: /בנה/ }))
  await waitFor(() => expect(screen.getByText('קורס Y')).toBeInTheDocument())
  expect(generate).toHaveBeenCalledWith(REQUEST)
  expect(screen.getByRole('region', { name: /טיוט/ })).toBeInTheDocument() // draft region ("טיוטת תוכנית")
})

test('shows a generating status while the request is in flight', async () => {
  const d = deferred<ReturnType<typeof PROPOSAL>>()
  render(<NativePlannerDraft base={base()} request={REQUEST} generate={() => d.promise} />)
  fireEvent.click(screen.getByRole('button', { name: /בנה/ }))
  expect(screen.getByRole('status')).toHaveTextContent(/בונה|מייצר|טוען/)
  await act(async () => { d.resolve(PROPOSAL()) })
})

test('a blocked result is shown as blocked with its errors, not as success', async () => {
  render(<NativePlannerDraft base={base()} request={REQUEST} generate={async () => BLOCKED()} />)
  fireEvent.click(screen.getByRole('button', { name: /בנה/ }))
  await waitFor(() => expect(screen.getByText(/חסומה|לא ניתן להחיל/)).toBeInTheDocument())
  expect(screen.getByText('סמסטר עמוס מדי')).toBeInTheDocument()
})

test('warnings and errors are separately accessible', async () => {
  render(<NativePlannerDraft base={base()} request={REQUEST} generate={async () => PROPOSAL()} />)
  fireEvent.click(screen.getByRole('button', { name: /בנה/ }))
  await waitFor(() => expect(screen.getByText('אזהרת תחום')).toBeInTheDocument())
})

test('a network failure is shown distinctly from a contract failure', async () => {
  render(<NativePlannerDraft base={base()} request={REQUEST} generate={async () => { throw new Error('boom') }} />)
  fireEvent.click(screen.getByRole('button', { name: /בנה/ }))
  await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent(/רשת|נכשלה/))
})

test('a ContractError is surfaced as a contract failure', async () => {
  render(<NativePlannerDraft base={base()} request={REQUEST} generate={async () => { throw new ContractError('bad') }} />)
  fireEvent.click(screen.getByRole('button', { name: /בנה/ }))
  await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent(/תשובת השרת|לא תקינ/))
})

test('a catalog change after generation surfaces a non-blocking regenerate hint (proposal preserved)', async () => {
  const { rerender } = render(<NativePlannerDraft base={base('rev-1')} request={REQUEST} generate={async () => PROPOSAL()} />)
  fireEvent.click(screen.getByRole('button', { name: /בנה/ }))
  await waitFor(() => expect(screen.getByText('קורס Y')).toBeInTheDocument())
  rerender(<NativePlannerDraft base={base('rev-2')} request={REQUEST} generate={async () => PROPOSAL()} />)
  expect(screen.getByText(/מומלץ לבנות מחדש|קטלוג/)).toBeInTheDocument()
  expect(screen.getByText('קורס Y')).toBeInTheDocument() // proposal still visible
})

test('an older in-flight result cannot overwrite a newer proposal (request token)', async () => {
  const dA = deferred<ReturnType<typeof PROPOSAL>>()
  const dB = deferred<ReturnType<typeof PROPOSAL>>()
  const proposalB = generatePlanResponseToModel({ semesters: [{ semester_id: 'year_3_semester_a', course_ids: ['Y-1'] }], moves: [], warnings_he: ['שנייה'], errors: [], blocked: false })
  let call = 0
  const generate = () => (++call === 1 ? dA.promise : dB.promise)
  render(<NativePlannerDraft base={base()} request={REQUEST} generate={generate} />)
  fireEvent.click(screen.getByRole('button', { name: /בנה/ })) // token 1 (A)
  fireEvent.click(screen.getByRole('button', { name: /בנה/ })) // token 2 (B) supersedes
  await act(async () => { dB.resolve(proposalB); await Promise.resolve() })
  await act(async () => { dA.resolve(PROPOSAL()); await Promise.resolve() }) // older resolves last
  await waitFor(() => expect(screen.getByText('שנייה')).toBeInTheDocument()) // B's warning
  expect(screen.queryByText('אזהרת תחום')).not.toBeInTheDocument() // A's warning must NOT win
})

test('an unresolved generated course id stays visible with a truthful unavailable state', async () => {
  const g = () => generatePlanResponseToModel({ semesters: [{ semester_id: 'year_3_semester_a', course_ids: ['GHOST-9'] }], moves: [], warnings_he: [], errors: [], blocked: false })
  render(<NativePlannerDraft base={base()} request={REQUEST} generate={async () => g()} />)
  fireEvent.click(screen.getByRole('button', { name: /בנה/ }))
  await waitFor(() => expect(screen.getByText('GHOST-9')).toBeInTheDocument())
  expect(screen.getByText(/פרטי הקורס אינם זמינים/)).toBeInTheDocument()
})

test('has no apply/reject/edit/save controls and touches no storage', async () => {
  const setItem = jest.spyOn(Storage.prototype, 'setItem')
  const getItem = jest.spyOn(Storage.prototype, 'getItem')
  render(<NativePlannerDraft base={base()} request={REQUEST} generate={async () => PROPOSAL()} />)
  fireEvent.click(screen.getByRole('button', { name: /בנה/ }))
  await waitFor(() => expect(screen.getByText('קורס Y')).toBeInTheDocument())
  expect(screen.queryByRole('button', { name: /החל|אשר|דחה|שמור|ערוך/ })).toBeNull()
  expect(setItem).not.toHaveBeenCalled()
  expect(getItem).not.toHaveBeenCalled()
  setItem.mockRestore(); getItem.mockRestore()
})

test('a resolved course with no name shows the unavailable-details fallback (no blank heading) + its id', async () => {
  const boardNullName = boardResponseToModel({
    metadata: { board_data_version: 'rev-1', program_repository_courses: [{ course_id: 'NM-1', name_he: null, weekly_hours: 2.0, is_mandatory: false }] },
    semesters: [{ semester_id: 'year_3_semester_a', courses: [] }, { semester_id: 'year_3_semester_b', courses: [] }],
  })
  const gen = () => generatePlanResponseToModel({ semesters: [{ semester_id: 'year_3_semester_a', course_ids: ['NM-1'] }], moves: [], warnings_he: [], errors: [], blocked: false })
  render(<NativePlannerDraft base={boardNullName} request={REQUEST} generate={async () => gen()} />)
  fireEvent.click(screen.getByRole('button', { name: /בנה/ }))
  await waitFor(() => expect(screen.getByText('NM-1')).toBeInTheDocument()) // exact id visible
  expect(screen.getByText(/פרטי הקורס אינם זמינים/)).toBeInTheDocument() // truthful fallback, not a blank heading
  expect(screen.queryByText('סכום חלקי')).toBeNull() // hours are known → total NOT suppressed by the missing name
})

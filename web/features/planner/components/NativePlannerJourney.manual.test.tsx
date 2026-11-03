import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import NativePlannerJourney from './NativePlannerJourney'
import { boardResponseToModel } from '../../../../shared/planner/adapters'
import type { ManualBoardEditResult } from '../../../../shared/planner/api-client'
import type { ConversationResponse } from '../../../../shared/planner/conversation-wire'
import { writeRepositoryDrag } from '../../../lib/planner/drag-payload'

const A = 'year_3_semester_a'
const B = 'year_3_semester_b'
const PROGRAM = 'mechanical_engineering_2027'
const baseBoard = () => boardResponseToModel({
  metadata: { board_data_version: 'rev-1', program_repository_courses: [
    { course_id: 'NEW', name_he: 'קורס חדש', weekly_hours: 3, is_mandatory: false },
  ] },
  semesters: [
    { semester_id: A, courses: [{ course_id: 'BASE', name_he: 'קורס קיים', weekly_hours: 3, course_type: 'elective', is_mandatory: false }] },
    { semester_id: B, courses: [] },
  ],
})
const success = (a: string[], b: string[]): ManualBoardEditResult => ({
  ok: true, replayed: false, operationId: 'edit_test',
  board: { programId: PROGRAM, version: 'bv_1', semesters: [
    { semesterId: A, courseIds: a }, { semesterId: B, courseIds: b },
  ] },
})
const deps = () => ({
  programId: PROGRAM,
  getBoardFn: async () => baseBoard(),
  committedBoardFn: async () => null,
  planningContextFn: async () => null,
  establishPlanningContextFn: async () => ({ academicStatusDigest: 'as_current' }),
})
const proposal = (): ConversationResponse => ({
  outcome: 'proposal', message_he: 'הצעה', events: [],
  proposal: {
    proposal_id: 'prop_test', candidate_ids: ['cand_test'], recommended_candidate_id: 'cand_test',
    base_board_version: null, profile_version: 1, academic_status_digest: 'as_current', expires_at: Date.now() + 3_600_000,
    alternatives: [{
      candidate_id: 'cand_test', normalized_identity: 'identity', recommended: true, applyable: true,
      semesters: [{ semester_id: A, course_ids: ['BASE'] }, { semester_id: B, course_ids: ['NEW'] }],
      constraint_fingerprint: 'cf', profile_version: 1, snapshot_id: 'snap', non_dominated: true,
      composed_utility: 0, objective_scores: [], label_he: 'המומלצת', differences_he: [],
      workload: { peak_hours: 3, total_hours: 6, active_periods: 2 },
    }],
  },
} as unknown as ConversationResponse)
const ask = async () => {
  fireEvent.change(screen.getByRole('textbox', { name: 'הודעה לעוזר האקדמי' }), { target: { value: 'בנה תוכנית' } })
  fireEvent.click(screen.getByRole('button', { name: 'שלח לעוזר' }))
  await screen.findByLabelText('טיוטת תוכנית')
}

test('a chosen single destination saves once without a second confirmation, including StrictMode effect replay', async () => {
  const editBoardFn = jest.fn(async () => success(['BASE', 'NEW'], []))
  const settled = jest.fn()
  const intent = { courseId: 'NEW', semesterIds: [A] }
  const view = render(<NativePlannerJourney {...deps()} manualAddIntent={intent} editBoardFn={editBoardFn} onManualAddSettled={settled} />, { reactStrictMode: true })
  await waitFor(() => expect(settled).toHaveBeenCalledTimes(1))
  expect(editBoardFn).toHaveBeenCalledTimes(1)
  expect(editBoardFn).toHaveBeenCalledWith(expect.objectContaining({ operation: 'add_course', course_id: 'NEW', semester_id: A }))
  expect(screen.queryByRole('button', { name: /הוסף אל/ })).toBeNull()
  view.rerender(<NativePlannerJourney {...deps()} manualAddIntent={intent} editBoardFn={editBoardFn} onManualAddSettled={settled} />)
  expect(editBoardFn).toHaveBeenCalledTimes(1)
})

test('multiple destinations ask only for the missing semester choice', async () => {
  const editBoardFn = jest.fn(async () => success(['BASE'], ['NEW']))
  render(<NativePlannerJourney {...deps()} manualAddIntent={{ courseId: 'NEW', semesterIds: [A, B] }} editBoardFn={editBoardFn} />)
  await screen.findByText('קורס קיים')
  expect(editBoardFn).not.toHaveBeenCalled()
  fireEvent.click(screen.getByRole('button', { name: /הוסף אל.*סמסטר ב׳/ }))
  await waitFor(() => expect(editBoardFn).toHaveBeenCalledTimes(1))
})

test('an agent preview allows a direct repository drop and leaves unapplied draft courses out of the committed edit', async () => {
  const editBoardFn = jest.fn(async () => success(['BASE', 'NEW'], []))
  render(<NativePlannerJourney {...deps()} editBoardFn={editBoardFn} sendConversationFn={async () => proposal()} />)
  await screen.findByText('קורס קיים')
  await ask()
  const transfer = {
    values: new Map<string, string>(),
    setData(type: string, value: string) { this.values.set(type, value) },
    getData(type: string) { return this.values.get(type) ?? '' },
  }
  writeRepositoryDrag(transfer, 'NEW', [A])
  fireEvent.drop(screen.getByRole('region', { name: 'שנה ג׳ — סמסטר א׳' }), { dataTransfer: transfer })
  await waitFor(() => expect(editBoardFn).toHaveBeenCalledTimes(1))
  expect(editBoardFn).toHaveBeenCalledWith(expect.objectContaining({ operation: 'add_course', course_id: 'NEW', semester_id: A, expected_board_version: null }))
  await waitFor(() => expect(within(screen.getByRole('region', { name: 'שנה ג׳ — סמסטר א׳' })).getByText('קורס חדש')).toBeInTheDocument())
  expect(within(screen.getByRole('region', { name: 'שנה ג׳ — סמסטר ב׳' })).queryByText('קורס חדש')).toBeNull()
  expect(screen.getByRole('button', { name: 'החל תוכנית' })).toBeDisabled()
})

test('an agent preview keeps existing committed courses movable and does not make preview-only courses editable', async () => {
  const editBoardFn = jest.fn(async () => success([], ['BASE']))
  render(<NativePlannerJourney {...deps()} editBoardFn={editBoardFn} sendConversationFn={async () => proposal()} />)
  await screen.findByText('קורס קיים')
  await ask()
  expect(screen.queryByRole('button', { name: 'הסר קורס חדש מהלוח' })).toBeNull()
  fireEvent.click(screen.getByRole('button', { name: 'העבר קורס קיים אל שנה ג׳ — סמסטר ב׳' }))
  await waitFor(() => expect(editBoardFn).toHaveBeenCalledTimes(1))
  expect(editBoardFn).toHaveBeenCalledWith(expect.objectContaining({ operation: 'move_course', course_id: 'BASE', semester_id: B }))
  await waitFor(() => expect(within(screen.getByLabelText('התוכנית הנוכחית')).queryByText('קורס חדש')).toBeNull())
})

test('manual edits synchronize changed profile inputs instead of validating against the context loaded on mount', async () => {
  const establishPlanningContextFn = jest.fn(async (_request: unknown) => ({ academicStatusDigest: 'as_changed' }))
  const editBoardFn = jest.fn(async () => success(['BASE', 'NEW'], []))
  render(<NativePlannerJourney {...deps()} planningContextFn={async () => ({
    academicStatusDigest: 'as_old', preferenceDigest: 'pref_old',
    personalStatus: {
      completed: [{ course_id: '0509-1821' }],
      currently_taking: [{ course_id: '0542-4422', semester_id: A, hours: 4 }],
      planned: [{ course_id: '0542-4455', semester_id: B }],
      completed_knowledge: { status: 'known' },
    },
    preferences: { max_weekly_hours: 6 },
  })} establishPlanningContextFn={establishPlanningContextFn} editBoardFn={editBoardFn} />)
  await screen.findByText('קורס קיים')
  fireEvent.change(screen.getByRole('textbox', { name: 'מגבלת שעות שבועיות' }), { target: { value: '12' } })
  const transfer = {
    values: new Map<string, string>(),
    setData(type: string, value: string) { this.values.set(type, value) },
    getData(type: string) { return this.values.get(type) ?? '' },
  }
  writeRepositoryDrag(transfer, 'NEW', [A])
  fireEvent.drop(screen.getByRole('region', { name: 'שנה ג׳ — סמסטר א׳' }), { dataTransfer: transfer })
  await waitFor(() => expect(editBoardFn).toHaveBeenCalledTimes(1))
  expect(establishPlanningContextFn).toHaveBeenCalledWith(expect.objectContaining({ preferences: expect.objectContaining({ max_weekly_hours: 12 }) }))
  expect(establishPlanningContextFn).toHaveBeenCalledWith(expect.objectContaining({
    plan_context: expect.objectContaining({ personal_status: expect.objectContaining({
      completed: [{ course_id: '0509-1821' }],
      currently_taking: [{ course_id: '0542-4422', semester_id: A, hours: 4 }],
      planned: [{ course_id: '0542-4455', semester_id: B }],
    }) }),
  }))
  expect(editBoardFn).toHaveBeenCalledWith(expect.objectContaining({ academic_status_digest: 'as_changed' }))
})

test('a network retry keeps its key while a different edit receives its own key', async () => {
  const editBoardFn = jest.fn()
    .mockRejectedValueOnce(new Error('response lost'))
    .mockRejectedValueOnce(new Error('retry response lost'))
    .mockResolvedValue(success(['BASE'], ['NEW']))
  render(<NativePlannerJourney {...deps()} editBoardFn={editBoardFn} />)
  await screen.findByText('קורס קיים')
  const transfer = {
    values: new Map<string, string>(),
    setData(type: string, value: string) { this.values.set(type, value) },
    getData(type: string) { return this.values.get(type) ?? '' },
  }
  writeRepositoryDrag(transfer, 'NEW', [A, B])
  fireEvent.drop(screen.getByRole('region', { name: 'שנה ג׳ — סמסטר א׳' }), { dataTransfer: transfer })
  await screen.findByRole('alert')
  fireEvent.drop(screen.getByRole('region', { name: 'שנה ג׳ — סמסטר א׳' }), { dataTransfer: transfer })
  await waitFor(() => expect(editBoardFn).toHaveBeenCalledTimes(2))
  await screen.findByRole('alert')
  fireEvent.drop(screen.getByRole('region', { name: 'שנה ג׳ — סמסטר ב׳' }), { dataTransfer: transfer })
  await waitFor(() => expect(editBoardFn).toHaveBeenCalledTimes(3))
  expect(editBoardFn.mock.calls[0][0].operation_id).toBe(editBoardFn.mock.calls[1][0].operation_id)
  expect(editBoardFn.mock.calls[1][0].operation_id).not.toBe(editBoardFn.mock.calls[2][0].operation_id)
})

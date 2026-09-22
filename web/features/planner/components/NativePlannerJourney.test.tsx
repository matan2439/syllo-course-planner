/**
 * The native planner journey composed over the EXISTING shared infra (real
 * adapters here; transport injected): load current board → the assistant
 * conversation offers a proposal → it is previewed on the board with a diff
 * marker → reject / safe apply (blocked can never apply) → the applied plan
 * becomes the visible current board.
 */
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react'
import NativePlannerJourney from './NativePlannerJourney'
import { boardResponseToModel } from '../../../../shared/planner/adapters'
import type { ConversationResponse } from '../../../../shared/planner/conversation-wire'

const BOARD = {
  metadata: {
    board_data_version: 'rev-1',
    program_repository_courses: [
      { course_id: 'Y-1', name_he: 'קורס Y', weekly_hours: 3.5, is_mandatory: false },
    ],
  },
  semesters: [
    { semester_id: 'year_3_semester_a', courses: [{ course_id: 'X-1', name_he: 'קורס בסיס X', weekly_hours: 3.0, course_type: 'mandatory', is_mandatory: true }] },
    { semester_id: 'year_3_semester_b', courses: [] },
  ],
}
const board = () => boardResponseToModel(BOARD)

const PROPOSAL_ID = 'prop_main'
const CANDIDATE = 'cand_main'

// A proposal that ADDS Y-1 alongside the existing X-1 (a truthful "new" diff).
const proposalResponse = (): ConversationResponse => ({
  outcome: 'proposal',
  message_he: 'הכנתי הצעה.',
  events: [],
  proposal: {
    proposal_id: PROPOSAL_ID, candidate_ids: [CANDIDATE], recommended_candidate_id: CANDIDATE,
    base_board_version: null, profile_version: 1, academic_status_digest: 'as_test',
    expires_at: Date.now() + 3_600_000,
    alternatives: [{
      candidate_id: CANDIDATE, normalized_identity: 'id_main', recommended: true, applyable: true,
      semesters: [
        { semester_id: 'year_3_semester_a', course_ids: ['X-1', 'Y-1'] },
        { semester_id: 'year_3_semester_b', course_ids: [] },
      ],
      constraint_fingerprint: 'cf', profile_version: 1, snapshot_id: 'snap', non_dominated: true,
      composed_utility: 0, objective_scores: [], label_he: 'המומלצת', differences_he: [],
      workload: { peak_hours: 6.5, total_hours: 6.5, active_periods: 1 },
    }],
  },
} as unknown as ConversationResponse)

// The server marks the recommended candidate not-applyable (e.g. it would overload a semester).
const notApplyableResponse = (): ConversationResponse => ({
  outcome: 'proposal',
  message_he: 'הצעה זו חוסמת את הסמסטר.',
  events: [],
  proposal: {
    proposal_id: PROPOSAL_ID, candidate_ids: [CANDIDATE], recommended_candidate_id: CANDIDATE,
    base_board_version: null, profile_version: 1, academic_status_digest: 'as_test',
    expires_at: Date.now() + 3_600_000,
    alternatives: [{
      candidate_id: CANDIDATE, normalized_identity: 'id_blocked', recommended: true, applyable: false,
      semesters: [{ semester_id: 'year_3_semester_a', course_ids: ['X-1'] }],
      constraint_fingerprint: 'cf', profile_version: 1, snapshot_id: 'snap', non_dominated: true,
      composed_utility: 0, objective_scores: [], label_he: 'המומלצת', differences_he: [],
      workload: { peak_hours: 3, total_hours: 3, active_periods: 1 },
    }],
  },
} as unknown as ConversationResponse)

const deps = (over: Partial<{ getBoardFn: any; sendConversationFn: any }> = {}) => ({
  programId: 'mechanical_engineering_2027',
  getBoardFn: over.getBoardFn ?? (async () => board()),
  planningContextFn: async () => null,
  sendConversationFn: over.sendConversationFn ?? (async () => proposalResponse()),
})

async function renderReady(over = {}) {
  const view = render(<NativePlannerJourney {...deps(over)} />)
  await waitFor(() => expect(screen.getByText('קורס בסיס X')).toBeInTheDocument())
  return view
}

const askAgent = async (text = 'בנה לי תוכנית') => {
  fireEvent.change(screen.getByRole('textbox', { name: 'הודעה לעוזר האקדמי' }), { target: { value: text } })
  fireEvent.click(screen.getByRole('button', { name: 'שלח לעוזר' }))
}

test('loads and shows the current semester plan', async () => {
  const getBoardFn = jest.fn(async () => board())
  render(<NativePlannerJourney {...deps({ getBoardFn })} />)
  await waitFor(() => expect(screen.getByText('קורס בסיס X')).toBeInTheDocument())
  expect(getBoardFn).toHaveBeenCalledWith('mechanical_engineering_2027')
})

test('keeps a labelled semester-board shell visible while the board loads', () => {
  render(<NativePlannerJourney {...deps({ getBoardFn: () => new Promise(() => undefined) })} />)

  expect(screen.getByRole('region', { name: 'התוכנית הנוכחית' })).toBeInTheDocument()
  expect(screen.getByRole('heading', { name: 'לוח הסמסטרים' })).toBeInTheDocument()
  expect(screen.getByRole('status')).toHaveTextContent('טוען את התוכנית הנוכחית')
})

test('a board load failure is shown truthfully (no silent blank)', async () => {
  render(<NativePlannerJourney {...deps({ getBoardFn: async () => { throw new Error('down') } })} />)
  await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent(/טעינ|נכשל|שגיא/))
  expect(screen.getByRole('region', { name: 'התוכנית הנוכחית' })).toBeInTheDocument()
  expect(screen.getByRole('heading', { name: 'לוח הסמסטרים' })).toBeInTheDocument()
})

test('a proposal from the agent is previewed on the board with an added-course diff marker and enabled apply/reject controls', async () => {
  await renderReady()
  await askAgent()
  await waitFor(() => expect(screen.getByRole('region', { name: /טיוט/ })).toBeInTheDocument())
  // The proposal is previewed ON the board, the changed card carries the marker...
  const board = screen.getByRole('region', { name: 'התוכנית הנוכחית' })
  expect(within(board).getByText('קורס Y')).toBeInTheDocument()
  expect(within(board).getByText('חדש')).toBeInTheDocument() // added marker
  // ...and the draft region lists what would change.
  expect(within(screen.getByRole('region', { name: /טיוט/ })).getByLabelText('שינויים בהצעה')).toHaveTextContent('קורס Y')
  expect(screen.getByRole('button', { name: /החל/ })).toBeEnabled()
  expect(screen.getByRole('button', { name: /דחה/ })).toBeInTheDocument()
})

test('rejecting a previewed proposal restores the committed board', async () => {
  await renderReady()
  const board = () => screen.getByRole('region', { name: 'התוכנית הנוכחית' })
  expect(board()).not.toHaveTextContent('תצוגה מקדימה של ההצעה')

  await askAgent()
  await waitFor(() => expect(screen.getByRole('region', { name: /טיוט/ })).toBeInTheDocument())
  expect(board()).toHaveTextContent('תצוגה מקדימה של ההצעה')
  expect(within(board()).getByText('חדש')).toBeInTheDocument()

  fireEvent.click(screen.getByRole('button', { name: /דחה/ }))
  await waitFor(() => expect(screen.queryByRole('region', { name: /טיוט/ })).toBeNull())
  expect(board()).not.toHaveTextContent('תצוגה מקדימה של ההצעה')
  expect(within(board()).queryByText('חדש')).toBeNull()
  expect(within(board()).queryByText('קורס Y')).toBeNull()
})

test('a proposal the server marked not-applyable cannot be applied', async () => {
  await renderReady({ sendConversationFn: async () => notApplyableResponse() })
  await askAgent()
  await waitFor(() => expect(screen.getByRole('region', { name: /טיוט/ })).toBeInTheDocument())
  const apply = screen.queryByRole('button', { name: /החל/ })
  expect(apply === null || (apply as HTMLButtonElement).disabled).toBe(true)
})

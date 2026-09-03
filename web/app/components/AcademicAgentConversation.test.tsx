import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import AcademicAgentConversation from './AcademicAgentConversation'
import type { ConversationResponse } from '../../../shared/planner/conversation-wire'
import { ConversationContextConflictError } from '../../../shared/planner/api-client'

const requestContext = {
  programId: 'mechanical_engineering_2027',
  sessionToken: '00000000-0000-4000-8000-000000000000',
  boardVersion: null,
  academicStatusDigest: 'as_1',
  preferenceDigest: 'pref_1',
}

test('submits Hebrew transcript on Enter, keeps Shift+Enter as a newline, and hides raw tool payloads', async () => {
  const sendConversation = jest.fn(async () => ({
    outcome: 'proposal',
    message_he: 'מצאתי חלופה חוקית.',
    events: [
      { type: 'tool_status', tool: 'rank_candidates', status: 'completed' },
      { type: 'assistant_message', text_he: 'מצאתי חלופה חוקית.' },
      { type: 'alternatives_ready', proposal_id: 'prop_1', candidate_ids: ['cand_1'] },
    ],
    proposal_id: 'prop_1',
    proposal: {
      proposal_id: 'prop_1',
      candidate_ids: ['cand_1'],
      recommended_candidate_id: 'cand_1',
      base_board_version: null,
      profile_version: 0,
      academic_status_digest: 'as_1',
      expires_at: Date.now() + 3_600_000,
      alternatives: [{
        candidate_id: 'cand_1',
        normalized_identity: 'plan_1',
        recommended: true,
        applyable: true,
        semesters: [{ semester_id: 'year_3_semester_a', course_ids: ['COURSE-1'] }],
        constraint_fingerprint: 'cf_1',
        profile_version: 0,
        snapshot_id: 'snapshot_1',
        non_dominated: true,
        composed_utility: 0,
        objective_scores: [],
        label_he: 'הצעת העוזר',
        differences_he: [],
        workload: { peak_hours: 3, total_hours: 3, active_periods: 1 },
      }],
    },
  } satisfies ConversationResponse))
  const onProposalReady = jest.fn()
  render(<AcademicAgentConversation {...requestContext} sendConversationFn={sendConversation} onProposalReady={onProposalReady} />)

  const composer = screen.getByRole('textbox', { name: 'הודעה לעוזר האקדמי' })
  fireEvent.change(composer, { target: { value: 'אני רוצה עומס מאוזן' } })
  fireEvent.keyDown(composer, { key: 'Enter', shiftKey: true })
  expect(sendConversation).not.toHaveBeenCalled()
  fireEvent.keyDown(composer, { key: 'Enter' })

  await waitFor(() => expect(sendConversation).toHaveBeenCalledTimes(1))
  const request = (sendConversation as jest.Mock).mock.calls[0][0] as { transcript: unknown }
  expect(request.transcript).toEqual([
    { role: 'user', text: 'אני רוצה עומס מאוזן' },
  ])
  expect(screen.getByText('אני רוצה עומס מאוזן')).toBeInTheDocument()
  expect(screen.getByText('מצאתי חלופה חוקית.')).toBeInTheDocument()
  expect(screen.getByText('דירוג חלופות — הושלם')).toBeInTheDocument()
  expect(screen.queryByText('rank_candidates')).not.toBeInTheDocument()
  expect(onProposalReady).toHaveBeenCalledWith(expect.objectContaining({ proposal_id: 'prop_1' }))
})

test('renders pending state and the explicit build-alternatives action', async () => {
  let resolve: ((value: ConversationResponse) => void) | undefined
  const sendConversation = jest.fn(() => new Promise<ConversationResponse>((done) => { resolve = done }))
  render(<AcademicAgentConversation {...requestContext} sendConversationFn={sendConversation} />)

  fireEvent.change(screen.getByRole('textbox', { name: 'הודעה לעוזר האקדמי' }), { target: { value: 'בדוק את התוכנית' } })
  fireEvent.click(screen.getByRole('button', { name: 'שלח לעוזר' }))
  expect(screen.getByRole('status')).toHaveTextContent('בודק את התוכנית…')
  expect(screen.getByRole('button', { name: 'בנה חלופות' })).toBeDisabled()

  resolve?.({ outcome: 'conversation', message_he: 'צריך עוד מידע.', events: [] })
  await waitFor(() => expect(screen.getByText('צריך עוד מידע.')).toBeInTheDocument())
  expect(screen.getByRole('button', { name: 'בנה חלופות' })).toBeEnabled()
})

test('makes the authoritative board context and non-mutating boundary visible', () => {
  render(
    <AcademicAgentConversation
      {...requestContext}
      boardVersion="board_v7"
      sendConversationFn={jest.fn()}
    />,
  )

  expect(screen.getByTestId('academic-agent-board-context')).toHaveTextContent('לוח התוכנית הנוכחי')
  expect(screen.getByTestId('academic-agent-board-context')).toHaveTextContent('גרסה שמורה')
  expect(screen.getByTestId('academic-agent-board-context')).toHaveTextContent('הצעה לא משנה את הלוח')
})

test('shows the typed unavailable state without pretending that an assistant replied', async () => {
  const sendConversation = jest.fn(async () => ({
    outcome: 'assistant_unavailable',
    message_he: 'העוזר האקדמי אינו זמין כרגע.',
    events: [{ type: 'assistant_unavailable', message_he: 'העוזר האקדמי אינו זמין כרגע.' }],
  } satisfies ConversationResponse))
  render(<AcademicAgentConversation {...requestContext} sendConversationFn={sendConversation} />)

  fireEvent.change(screen.getByRole('textbox', { name: 'הודעה לעוזר האקדמי' }), { target: { value: 'שלום' } })
  fireEvent.click(screen.getByRole('button', { name: 'שלח לעוזר' }))

  await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('העוזר האקדמי אינו זמין כרגע.'))
  expect(screen.getByRole('button', { name: 'בנה חלופות' })).toBeEnabled()
})

test('explains a stale planning context and offers a clean conversation restart', async () => {
  const sendConversation = jest.fn(async () => {
    throw new ConversationContextConflictError({
      ok: false,
      code: 'BOARD_VERSION_CONFLICT',
      message_he: 'הלוח השתנה מאז תחילת השיחה. יש להתחיל שיחה חדשה.',
      currentBoardVersion: 'bv_2',
    })
  })
  render(<AcademicAgentConversation {...requestContext} sendConversationFn={sendConversation} />)

  const composer = screen.getByRole('textbox', { name: 'הודעה לעוזר האקדמי' })
  fireEvent.change(composer, { target: { value: 'בנה לי חלופה' } })
  fireEvent.click(screen.getByRole('button', { name: 'שלח לעוזר' }))

  const alert = await screen.findByRole('alert')
  expect(alert).toHaveTextContent('הלוח השתנה מאז תחילת השיחה')
  expect(screen.getByRole('button', { name: 'התחל שיחה חדשה' })).toBeInTheDocument()

  fireEvent.click(screen.getByRole('button', { name: 'התחל שיחה חדשה' }))

  expect(screen.queryByRole('alert')).toBeNull()
  expect(screen.getByRole('log')).toHaveTextContent('כתבו בקשה')
  expect(screen.getByRole('button', { name: 'שלח לעוזר' })).toBeDisabled()
})

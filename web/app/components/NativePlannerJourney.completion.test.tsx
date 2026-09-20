/**
 * Academic-status integration for the mounted AcademicDecisionAgent.
 *
 * The agent owns proposal creation. These checks exercise the conversation
 * boundary rather than the retired standalone "בנה תוכנית" button, whose
 * flag-off behavior remains covered by the standard journey tests.
 */
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react'
import NativePlannerJourney from './NativePlannerJourney'
import { boardResponseToModel } from '../../../shared/planner/adapters'
import type { ConversationResponse } from '../../../shared/planner/conversation-wire'

const board = () => boardResponseToModel({
  metadata: { board_data_version: 'rev-1', program_repository_courses: [] },
  semesters: [
    { semester_id: 'year_3_semester_a', courses: [{ course_id: 'X-1', name_he: 'קורס בסיס X', weekly_hours: 3, is_mandatory: true }] },
    { semester_id: 'year_3_semester_b', courses: [] },
  ],
})

const reply = (): ConversationResponse => ({
  outcome: 'conversation', message_he: 'קיבלתי את העדכון.', next_action: 'ask', events: [],
})

async function renderAgent(over: Partial<React.ComponentProps<typeof NativePlannerJourney>> = {}) {
  const sendConversationFn = jest.fn(async () => reply())
  render(<NativePlannerJourney
    programId="mechanical_engineering_2027"
    getBoardFn={async () => board()}
    planningContextFn={async () => null}
    committedBoardFn={async () => null}
    useAcademicDecisionAgent
    sendConversationFn={sendConversationFn}
    {...over}
  />)
  await screen.findByText('קורס בסיס X')
  return { sendConversationFn }
}

test('waits for persisted academic context before enabling an agent turn', async () => {
  let resolve!: (value: any) => void
  const pendingContext = new Promise<any>((done) => { resolve = done })
  await renderAgent({ planningContextFn: async () => pendingContext })

  const composer = screen.getByRole('textbox', { name: 'הודעה לעוזר האקדמי' })
  expect(composer).toBeDisabled()
  resolve({ academicStatusDigest: 'as_saved', preferenceDigest: 'pref_saved', personalStatus: {}, preferences: {} })
  await waitFor(() => expect(composer).toBeEnabled())
})

test('confirmed completed courses are sent as the next structured agent answer', async () => {
  const { sendConversationFn } = await renderAgent()
  fireEvent.click(screen.getByText('מה חשוב לעוזר לדעת? (אופציונלי)'))
  fireEvent.click(screen.getByRole('button', { name: 'פתח' }))
  const row = screen.getByRole('group', { name: 'סטטוס: גרפיקה הנדסית' })
  fireEvent.click(within(row).getByRole('button', { name: /^השלמתי$/ }))
  fireEvent.click(screen.getByRole('button', { name: 'אשר את הסטטוס' }))
  expect(sendConversationFn).not.toHaveBeenCalled()

  const composer = screen.getByRole('textbox', { name: 'הודעה לעוזר האקדמי' })
  fireEvent.change(composer, { target: { value: 'נמשיך לתכנון' } })
  fireEvent.click(screen.getByRole('button', { name: 'שלח לעוזר' }))
  await waitFor(() => expect(sendConversationFn).toHaveBeenCalledTimes(1))
  expect((sendConversationFn as jest.Mock).mock.calls[0][0]).toEqual(expect.objectContaining({
    clarification_answers: [{ question_id: 'completed_courses', value: ['0509-1510'] }],
  }))
})

test('an untouched completion panel does not invent a completed-course answer', async () => {
  const { sendConversationFn } = await renderAgent()
  const composer = screen.getByRole('textbox', { name: 'הודעה לעוזר האקדמי' })
  fireEvent.change(composer, { target: { value: 'אני רוצה חלופה מאוזנת' } })
  fireEvent.click(screen.getByRole('button', { name: 'שלח לעוזר' }))
  await waitFor(() => expect(sendConversationFn).toHaveBeenCalledTimes(1))
  expect((sendConversationFn as jest.Mock).mock.calls[0][0]).not.toHaveProperty('clarification_answers')
})

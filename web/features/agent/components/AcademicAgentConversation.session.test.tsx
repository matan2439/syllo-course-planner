import { render, screen, waitFor, fireEvent } from '@testing-library/react'
import AcademicAgentConversation from './AcademicAgentConversation'

jest.mock('../../auth/AuthProvider', () => ({ useAuth: () => ({ refreshCreditBalance: jest.fn() }) }))
jest.mock('../../billing/ai_access', () => ({
  useAiAccess: () => 'ok', AiAccessNotice: () => null, AiPaywall: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}))

const props = {
  programId: 'mechanical_engineering_2027', sessionToken: '5dbda0de-bfa7-4f38-9f45-2f13ae81e267', boardVersion: 'v1',
  academicStatusDigest: 'as_1', preferenceDigest: 'p_1', sendConversationFn: jest.fn(),
}
const view = (turns: Array<{ role: 'user' | 'assistant'; text: string }>) => ({
  ok: true as const, enabled: true,
  session: { turns, pending_question_he: null, directions_he: ['מכניקה חישובית'], decisions_he: ['אושר: אלמנטים סופיים'] },
})

test('after a reload the conversation continues where it was left, with what was decided', async () => {
  const loadSessionFn = jest.fn().mockResolvedValue(view([{ role: 'user', text: 'אני רוצה אלמנטים סופיים' }, { role: 'assistant', text: 'מעולה, נתחיל מהמבוא' }]))
  render(<AcademicAgentConversation {...props} loadSessionFn={loadSessionFn} resetSessionFn={jest.fn()} />)
  await waitFor(() => expect(screen.getByText('מעולה, נתחיל מהמבוא')).toBeInTheDocument())
  expect(screen.getByText('אני רוצה אלמנטים סופיים')).toBeInTheDocument()
  expect(screen.getByTestId('academic-agent-resumed')).toHaveTextContent('ממשיכים מהשיחה הקודמת')
  expect(screen.getByTestId('academic-agent-resumed')).toHaveTextContent('מכניקה חישובית')
  expect(loadSessionFn).toHaveBeenCalledWith('mechanical_engineering_2027')
})

test('with persistent sessions off, or nothing saved, the page starts empty as before', async () => {
  const loadSessionFn = jest.fn().mockResolvedValue({ ok: true, enabled: false, session: null })
  render(<AcademicAgentConversation {...props} loadSessionFn={loadSessionFn} resetSessionFn={jest.fn()} />)
  await waitFor(() => expect(loadSessionFn).toHaveBeenCalled())
  expect(screen.queryByTestId('academic-agent-resumed')).toBeNull()
  expect(screen.getByText('איך אפשר לעזור בתכנון התואר?')).toBeInTheDocument()
})

test('a failing session lookup never blocks the conversation', async () => {
  const loadSessionFn = jest.fn().mockRejectedValue(new Error('network'))
  render(<AcademicAgentConversation {...props} loadSessionFn={loadSessionFn} resetSessionFn={jest.fn()} />)
  await waitFor(() => expect(loadSessionFn).toHaveBeenCalled())
  expect(screen.getByText('איך אפשר לעזור בתכנון התואר?')).toBeInTheDocument()
})

test('"new conversation" also forgets the saved session', async () => {
  const resetSessionFn = jest.fn().mockResolvedValue(undefined)
  const loadSessionFn = jest.fn().mockResolvedValue(view([{ role: 'user', text: 'שלום' }, { role: 'assistant', text: 'היי' }]))
  render(<AcademicAgentConversation {...props} loadSessionFn={loadSessionFn} resetSessionFn={resetSessionFn} />)
  await waitFor(() => expect(screen.getByText('היי')).toBeInTheDocument())
  fireEvent.click(screen.getByRole('button', { name: /שיחה חדשה/ }))
  expect(resetSessionFn).toHaveBeenCalledWith('mechanical_engineering_2027')
  expect(screen.queryByText('היי')).toBeNull()
  expect(screen.queryByTestId('academic-agent-resumed')).toBeNull()
})

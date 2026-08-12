/**
 * Slice 13 — the native preference conversation is driven by the REAL typed
 * conversation state machine (api/ai/conversation_state) + elicitation catalog.
 * Answers update draft preference state only and never call Generate; only the
 * explicit Build action does (via onBuild, which receives the typed profile).
 */
import { render, screen, fireEvent, within } from '@testing-library/react'
import PreferenceConversation from './PreferenceConversation'

function setup(over: Partial<React.ComponentProps<typeof PreferenceConversation>> = {}) {
  const onBuild = jest.fn()
  const onProfileChange = jest.fn()
  render(<PreferenceConversation onBuild={onBuild} onProfileChange={onProfileChange} {...over} />)
  return { onBuild, onProfileChange }
}

test('presents exactly one question at a time, with its rationale', () => {
  setup()
  expect(screen.getAllByRole('group', { name: /שאלה/ })).toHaveLength(1)
  // the highest-impact question (workload) is asked first
  expect(screen.getByText(/מה חשוב לך יותר כרגע/)).toBeInTheDocument()
})

test('a concrete choice advances to the next question and never calls Generate', () => {
  const { onBuild } = setup()
  fireEvent.click(screen.getByRole('button', { name: 'שבוע קל יותר' }))
  expect(screen.getByText(/מה עדיף לך/)).toBeInTheDocument() // next question (balance)
  expect(onBuild).not.toHaveBeenCalled()
})

test('"לא משנה לי" records indifference, does not re-ask, and does not Generate', () => {
  const { onBuild } = setup()
  fireEvent.click(screen.getByRole('button', { name: /לא משנה לי/ }))
  expect(screen.queryByText(/מה חשוב לך יותר כרגע/)).toBeNull() // not re-asked
  expect(onBuild).not.toHaveBeenCalled()
})

test('a vague free-text answer on a consequential topic asks for confirmation before activating', () => {
  setup()
  fireEvent.change(screen.getByRole('textbox', { name: /תשובה חופשית/ }), { target: { value: 'לא עמוס' } })
  fireEvent.click(screen.getByRole('button', { name: 'שליחת תשובה' }))
  expect(screen.getByText(/האם הבנתי נכון/)).toBeInTheDocument()
  expect(screen.getByRole('button', { name: /כן, זו הכוונה/ })).toBeInTheDocument()
})

test('confirming a vague interpretation adds it to the "מה הבנתי ממך" summary', () => {
  setup()
  fireEvent.change(screen.getByRole('textbox', { name: /תשובה חופשית/ }), { target: { value: 'לא עמוס' } })
  fireEvent.click(screen.getByRole('button', { name: 'שליחת תשובה' }))
  fireEvent.click(screen.getByRole('button', { name: /כן, זו הכוונה/ }))
  const summary = screen.getByRole('region', { name: /מה הבנתי ממך/ })
  expect(within(summary).getByText(/לא עמוס/)).toBeInTheDocument()
})

test('a captured preference can be removed, updating draft state only (no Generate)', () => {
  const { onBuild } = setup()
  fireEvent.click(screen.getByRole('button', { name: 'שבוע קל יותר' }))
  const summary = screen.getByRole('region', { name: /מה הבנתי ממך/ })
  fireEvent.click(within(summary).getByRole('button', { name: /הסר/ }))
  // nothing captured → the summary region unmounts (draft state only, no Generate)
  expect(screen.queryByRole('region', { name: /מה הבנתי ממך/ })).toBeNull()
  expect(onBuild).not.toHaveBeenCalled()
})

test('the user may Build before answering optional questions; Build passes the typed profile and never before', () => {
  const { onBuild } = setup()
  fireEvent.click(screen.getByRole('button', { name: 'שבוע קל יותר' })) // answer one, leave the rest
  expect(onBuild).not.toHaveBeenCalled()
  fireEvent.click(screen.getByRole('button', { name: /בנה תוכנית/ }))
  expect(onBuild).toHaveBeenCalledTimes(1)
  const profile = onBuild.mock.calls[0][0]
  expect(profile.version).toBeGreaterThan(1)
  expect(profile.preferences.find((p: any) => p.id === 'workload_target')).toBeTruthy()
})

test('when all impactful questions are answered, it shows a ready-to-build state', () => {
  setup()
  fireEvent.click(screen.getByRole('button', { name: 'שבוע קל יותר' }))
  fireEvent.click(screen.getByRole('button', { name: 'עומס מאוזן' }))
  fireEvent.click(screen.getByRole('button', { name: 'עדיף להימנע מבוקר' }))
  expect(screen.getByText(/אפשר לבנות עכשיו/)).toBeInTheDocument() // visible ready-to-build message
})

test('answering does not call Generate; only explicit Build does', () => {
  const { onBuild } = setup()
  fireEvent.click(screen.getByRole('button', { name: 'שבוע קל יותר' }))
  fireEvent.change(screen.getByRole('textbox', { name: /תשובה חופשית/ }), { target: { value: 'משהו' } })
  fireEvent.click(screen.getByRole('button', { name: 'שליחת תשובה' }))
  expect(onBuild).not.toHaveBeenCalled()
})

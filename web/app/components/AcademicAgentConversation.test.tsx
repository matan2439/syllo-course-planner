import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import AcademicAgentConversation from './AcademicAgentConversation'
import type { ConversationResponse } from '../../../shared/planner/conversation-wire'
import { ConversationContextConflictError } from '../../../shared/planner/api-client'
import type { PreferenceProfile } from '../../../api/ai/preference_model'

const requestContext = {
  programId: 'mechanical_engineering_2027',
  sessionToken: '00000000-0000-4000-8000-000000000000',
  boardVersion: null,
  academicStatusDigest: 'as_1',
  preferenceDigest: 'pref_1',
}

test('answers a course clarification by selecting Hebrew names without sending until confirmation', async () => {
  const sendConversation = jest.fn()
    .mockResolvedValueOnce({
      outcome: 'clarification_required', message_he: 'אילו קורסים השלמת?', next_action: 'ask',
      events: [{ type: 'clarification', question_id: 'completed_courses', answer_type: 'course_id_list', question_he: 'אילו קורסים השלמת?' }],
    } satisfies ConversationResponse)
    .mockResolvedValueOnce({
      outcome: 'conversation', message_he: 'קיבלתי את רשימת הקורסים.', next_action: 'ask', events: [],
    } satisfies ConversationResponse)
  const onProposalReady = jest.fn()
  render(<AcademicAgentConversation {...requestContext} sendConversationFn={sendConversation} onProposalReady={onProposalReady}
    courseNameById={{ '0542-2400': 'תכן מכני (1)', '0542-2500': 'מכניקת הזורמים (1)' }} />)
  fireEvent.change(screen.getByRole('textbox', { name: 'הודעה לעוזר האקדמי' }), { target: { value: 'עזור לי לתכנן' } })
  fireEvent.click(screen.getByRole('button', { name: 'שלח לעוזר' }))
  const question = await screen.findByRole('group', { name: 'שאלת המשך מהעוזר האקדמי' })
  const search = within(question).getByRole('searchbox', { name: 'חיפוש קורסים לתשובה' })
  fireEvent.change(search, { target: { value: 'תכן מכני' } })
  fireEvent.click(within(question).getByRole('checkbox', { name: /תכן מכני/ }))
  fireEvent.change(search, { target: { value: 'מכניקת הזורמים' } })
  fireEvent.click(within(question).getByRole('checkbox', { name: /מכניקת הזורמים/ }))
  expect(sendConversation).toHaveBeenCalledTimes(1)
  expect(onProposalReady).not.toHaveBeenCalled()
  expect(screen.queryByRole('button', { name: 'בנה חלופות' })).toBeNull()
  fireEvent.click(within(question).getByRole('button', { name: 'אישור 2 קורסים' }))
  await screen.findByText('קיבלתי את רשימת הקורסים.')
  expect(sendConversation.mock.calls[1][0]).toEqual(expect.objectContaining({
    clarification_answers: [{ question_id: 'completed_courses', value: ['0542-2400', '0542-2500'] }],
    transcript: expect.arrayContaining([{ role: 'user', text: 'הקורסים שהשלמתי: תכן מכני (1), מכניקת הזורמים (1)' }]),
  }))
});

test.each(['לא יודע', 'אין לי מושג', 'לא השלמתי 0542-2400'])('does not turn uncertain or negative free text into course claims: %s', async (answer) => {
  const sendConversation = jest.fn().mockResolvedValue({
    outcome: 'clarification_required', message_he: 'אילו קורסים השלמת?', next_action: 'ask',
    events: [{ type: 'clarification', question_id: 'completed_courses', answer_type: 'course_id_list', question_he: 'אילו קורסים השלמת?' }],
  } satisfies ConversationResponse)
  render(<AcademicAgentConversation {...requestContext} sendConversationFn={sendConversation} />)
  const composer = screen.getByRole('textbox', { name: 'הודעה לעוזר האקדמי' })
  fireEvent.change(composer, { target: { value: 'עזור לי' } })
  fireEvent.click(screen.getByRole('button', { name: 'שלח לעוזר' }))
  await screen.findByRole('group', { name: 'שאלת המשך מהעוזר האקדמי' })
  fireEvent.change(composer, { target: { value: answer } })
  fireEvent.click(screen.getByRole('button', { name: 'שלח לעוזר' }))
  await waitFor(() => expect(sendConversation).toHaveBeenCalledTimes(2))
  expect(sendConversation.mock.calls[1][0]).not.toHaveProperty('clarification_answers')
})

test.each([
  ['completed_courses', 'לא השלמתי קורסים'],
  ['current_courses', 'איני לומד/ת קורסים כעת'],
  ['excluded_courses', 'אין קורסים להחרגה'],
] as const)('sends an explicit empty list only on the none action for %s', async (questionId, noneLabel) => {
  const sendConversation = jest.fn().mockResolvedValue({
    outcome: 'clarification_required', message_he: 'אילו קורסים?', next_action: 'ask',
    events: [{ type: 'clarification', question_id: questionId, answer_type: 'course_id_list', question_he: 'אילו קורסים?' }],
  } satisfies ConversationResponse)
  render(<AcademicAgentConversation {...requestContext} sendConversationFn={sendConversation}
    courseNameById={{ '0542-2400': 'תכן מכני (1)' }} />)
  fireEvent.change(screen.getByRole('textbox', { name: 'הודעה לעוזר האקדמי' }), { target: { value: 'עזור לי' } })
  fireEvent.click(screen.getByRole('button', { name: 'שלח לעוזר' }))
  const noneButton = await screen.findByRole('button', { name: noneLabel })
  fireEvent.click(screen.getByRole('checkbox', { name: /תכן מכני/ }))
  expect(noneButton).toBeDisabled()
  fireEvent.click(screen.getByRole('button', { name: /הסר תכן מכני/ }))
  expect(screen.getByRole('button', { name: 'אישור 0 קורסים' })).toBeDisabled()
  fireEvent.click(noneButton)
  await waitFor(() => expect(sendConversation).toHaveBeenCalledTimes(2))
  expect(sendConversation.mock.calls[1][0].clarification_answers).toEqual([{ question_id: questionId, value: [] }])
})

test('preserves the selected answer after a send failure so it can be retried', async () => {
  const sendConversation = jest.fn()
    .mockResolvedValueOnce({
      outcome: 'clarification_required', message_he: 'אילו קורסים השלמת?', next_action: 'ask',
      events: [{ type: 'clarification', question_id: 'completed_courses', answer_type: 'course_id_list', question_he: 'אילו קורסים השלמת?' }],
    } satisfies ConversationResponse)
    .mockRejectedValueOnce(new Error('network unavailable'))
  render(<AcademicAgentConversation {...requestContext} sendConversationFn={sendConversation}
    courseNameById={{ '0542-2400': 'תכן מכני (1)' }} />)
  fireEvent.change(screen.getByRole('textbox', { name: 'הודעה לעוזר האקדמי' }), { target: { value: 'עזור לי' } })
  fireEvent.click(screen.getByRole('button', { name: 'שלח לעוזר' }))
  fireEvent.click(await screen.findByRole('checkbox', { name: /תכן מכני/ }))
  fireEvent.click(screen.getByRole('button', { name: 'אישור קורס אחד' }))
  await screen.findByRole('alert')
  expect(screen.getByRole('checkbox', { name: /תכן מכני/ })).toBeChecked()
  expect(screen.getByRole('button', { name: 'אישור קורס אחד' })).toBeEnabled()
})

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

test('sends the structured preference profile with each agent turn', async () => {
  const sendConversation = jest.fn(async () => ({
    outcome: 'conversation',
    message_he: 'הבנתי את סדר העדיפויות שלך.',
    next_action: 'ask',
    events: [],
  } satisfies ConversationResponse))
  const preferenceProfile: PreferenceProfile = {
    version: 2,
    preferences: [{
      id: 'semester_balance',
      category: 'workload',
      value: 'lighter',
      normalized: 'lighter',
      originalWording: 'שבוע קל יותר',
      classification: 'soft_preference',
      confidence: 1,
      source: 'explicit_answer',
      confirmationStatus: 'confirmed',
      affects: 'balance_score',
      mayAffectPlanningBeforeConfirmation: true,
    }],
  }
  render(
    <AcademicAgentConversation
      {...requestContext}
      preferenceProfile={preferenceProfile}
      sendConversationFn={sendConversation}
    />,
  )

  fireEvent.change(screen.getByRole('textbox', { name: 'הודעה לעוזר האקדמי' }), { target: { value: 'תמשיך' } })
  fireEvent.click(screen.getByRole('button', { name: 'שלח לעוזר' }))
  await waitFor(() => expect(sendConversation).toHaveBeenCalledTimes(1))
  expect((sendConversation as jest.Mock).mock.calls[0][0]).toEqual(expect.objectContaining({
    preference_profile: preferenceProfile,
  }))
})

test('renders known course ids in assistant replies as Hebrew names with the id retained', async () => {
  const sendConversation = jest.fn(async () => ({
    outcome: 'conversation',
    message_he: 'מומלץ לשבץ את 0542-4224 ואת 0542-4221 בסמסטר הבא.',
    events: [],
  } satisfies ConversationResponse))
  render(
    <AcademicAgentConversation
      {...requestContext}
      sendConversationFn={sendConversation}
      courseNameById={{ '0542-4224': 'תורת הבקרה', '0542-4221': 'מערכות בקרה' }}
    />,
  )

  fireEvent.change(screen.getByRole('textbox', { name: 'הודעה לעוזר האקדמי' }), { target: { value: 'תציע לי סמסטר' } })
  fireEvent.click(screen.getByRole('button', { name: 'שלח לעוזר' }))

  const reply = await screen.findByText(/מומלץ לשבץ/)
  expect(reply).toHaveTextContent('תורת הבקרה (0542-4224)')
  expect(reply).toHaveTextContent('מערכות בקרה (0542-4221)')
})

test('keeps preference questions inside the same assistant conversation surface', () => {
  render(
    <AcademicAgentConversation
      {...requestContext}
      preferenceContent={<div data-testid="embedded-preferences">מה חשוב לך יותר כרגע?</div>}
    />,
  )

  const surface = screen.getByTestId('academic-agent-conversation')
  expect(surface).toContainElement(screen.getByTestId('embedded-preferences'))
  expect(surface).toContainElement(screen.getByRole('log', { name: 'תמליל שיחה עם עוזר התכנון' }))
})

test('presents preference context as an integrated conversation region, not a second card', () => {
  render(
    <AcademicAgentConversation
      {...requestContext}
      preferenceContent={<div data-testid="embedded-preferences">מה חשוב לך יותר כרגע?</div>}
    />,
  )

  const context = screen.getByRole('region', { name: 'מידע שהעוזר צריך לדעת' })
  expect(context).toContainElement(screen.getByTestId('embedded-preferences'))
  expect(context.className).toContain('border-b')
  expect(context.className).not.toContain('rounded-xl')
})

test('renders pending state and the explicit build-alternatives action', async () => {
  let resolve: ((value: ConversationResponse) => void) | undefined
  const sendConversation = jest.fn(() => new Promise<ConversationResponse>((done) => { resolve = done }))
  render(<AcademicAgentConversation {...requestContext} sendConversationFn={sendConversation} />)

  fireEvent.change(screen.getByRole('textbox', { name: 'הודעה לעוזר האקדמי' }), { target: { value: 'בדוק את התוכנית' } })
  fireEvent.click(screen.getByRole('button', { name: 'שלח לעוזר' }))
  expect(screen.getByRole('status')).toHaveTextContent('בודק את התוכנית…')
  expect(screen.queryByRole('button', { name: 'בנה חלופות' })).toBeNull()

  resolve?.({ outcome: 'conversation', message_he: 'צריך עוד מידע.', events: [], next_action: 'ask' })
  await waitFor(() => expect(screen.getByText('צריך עוד מידע.')).toBeInTheDocument())
  expect(screen.queryByRole('button', { name: 'בנה חלופות' })).toBeNull()
})

test('renders an agent clarification question and offers build only when the agent says so', async () => {
  const sendConversation = jest.fn()
    .mockResolvedValueOnce({
      outcome: 'conversation',
      message_he: 'כדי להתאים את החלופה, מה חשוב יותר?',
      next_action: 'ask',
      events: [{
        type: 'clarification',
        question_he: 'מה חשוב יותר בסמסטר הקרוב?',
        options_he: ['שבוע קל יותר', 'לסיים מוקדם יותר'],
      }],
    } satisfies ConversationResponse)
    .mockResolvedValueOnce({
      outcome: 'conversation',
      message_he: 'יש לי מספיק מידע כדי להכין חלופות.',
      next_action: 'offer_build',
      events: [],
    } satisfies ConversationResponse)
  render(<AcademicAgentConversation {...requestContext} sendConversationFn={sendConversation} />)

  fireEvent.change(screen.getByRole('textbox', { name: 'הודעה לעוזר האקדמי' }), { target: { value: 'אני מתלבט' } })
  fireEvent.click(screen.getByRole('button', { name: 'שלח לעוזר' }))
  expect(await screen.findByRole('group', { name: 'שאלת המשך מהעוזר האקדמי' })).toHaveTextContent('מה חשוב יותר בסמסטר הקרוב?')
  expect(screen.getByRole('button', { name: 'שבוע קל יותר' })).toBeInTheDocument()
  expect(screen.queryByRole('button', { name: 'בנה חלופות' })).toBeNull()

  fireEvent.click(screen.getByRole('button', { name: 'שבוע קל יותר' }))
  await waitFor(() => expect(sendConversation).toHaveBeenCalledTimes(2))
  expect(await screen.findByRole('button', { name: 'בנה חלופות' })).toBeEnabled()
})

test('renders the server-owned readiness state inside the conversation surface', async () => {
  const sendConversation = jest.fn(async () => ({
    outcome: 'clarification_required',
    message_he: 'נדרש עוד מידע אקדמי.',
    next_action: 'ask',
    academic_decision: {
      engine: 'AcademicDecisionAgent',
      ready_to_plan: false,
      planned: false,
      clarification_required: true,
    },
    events: [{
      type: 'clarification',
      question_he: 'אילו קורסים כבר השלמת?',
    }],
  } satisfies ConversationResponse))
  render(<AcademicAgentConversation {...requestContext} sendConversationFn={sendConversation} />)

  fireEvent.change(screen.getByRole('textbox', { name: 'הודעה לעוזר האקדמי' }), { target: { value: 'בנה לי חלופות' } })
  fireEvent.click(screen.getByRole('button', { name: 'שלח לעוזר' }))

  const readiness = await screen.findByTestId('academic-agent-readiness')
  expect(readiness).toHaveTextContent('עדיין לא ניתן לבנות חלופות')
  expect(readiness).toHaveTextContent('נדרש מידע אקדמי נוסף')
  expect(screen.queryByRole('button', { name: 'בנה חלופות' })).toBeNull()
})

test('sends a structured answer for the active clarification and accepts refreshed context', async () => {
  const sendConversation = jest.fn()
    .mockResolvedValueOnce({
      outcome: 'clarification_required',
      message_he: 'האם יש קורסים שתרצה להחריג?',
      next_action: 'ask',
      academic_decision: {
        engine: 'AcademicDecisionAgent', ready_to_plan: false, planned: false, clarification_required: true,
      },
      events: [{
        type: 'clarification', question_id: 'excluded_courses', answer_type: 'course_id_list',
        question_he: 'האם יש קורסים שתרצה להחריג?',
      }],
    } satisfies ConversationResponse)
    .mockResolvedValueOnce({
      outcome: 'conversation',
      message_he: 'תודה, שמרתי את התשובה.',
      next_action: 'ask',
      context_update: { academic_status_digest: 'as_2', preference_digest: 'pref_2' },
      events: [],
    } satisfies ConversationResponse)
  const onAcademicContextUpdated = jest.fn()
  render(<AcademicAgentConversation {...requestContext} sendConversationFn={sendConversation} onAcademicContextUpdated={onAcademicContextUpdated} />)

  fireEvent.change(screen.getByRole('textbox', { name: 'הודעה לעוזר האקדמי' }), { target: { value: 'אין קורסים' } })
  fireEvent.click(screen.getByRole('button', { name: 'שלח לעוזר' }))
  await screen.findByRole('group', { name: 'שאלת המשך מהעוזר האקדמי' })

  fireEvent.change(screen.getByRole('textbox', { name: 'הודעה לעוזר האקדמי' }), { target: { value: 'אין קורסים' } })
  fireEvent.click(screen.getByRole('button', { name: 'שלח לעוזר' }))
  await waitFor(() => expect(sendConversation).toHaveBeenCalledTimes(2))
  expect((sendConversation as jest.Mock).mock.calls[1][0]).toEqual(expect.objectContaining({
    clarification_answers: [{ question_id: 'excluded_courses', value: [] }],
  }))
  expect(onAcademicContextUpdated).toHaveBeenCalledWith({ academic_status_digest: 'as_2', preference_digest: 'pref_2' })
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
  expect(screen.queryByRole('button', { name: 'בנה חלופות' })).toBeNull()
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

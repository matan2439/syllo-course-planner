/**
 * Slice 13/14 integration closure — the live NativePlannerJourney mounts the
 * real PreferenceConversation (typed conversation state machine) on the flagged
 * path, sends its typed profile+version through the real Generate contract, and
 * enforces profile-version staleness at the real Apply handler. Flag-off is
 * unchanged.
 */
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react'
import NativePlannerJourney from './NativePlannerJourney'
import { boardResponseToModel } from '../../../shared/planner/adapters'
import type { GeneratePlanRequest } from '../../../shared/planner/api-client'
import { createServerApplyStub } from './serverApplyStub'
import type { GeneratedPlanModel } from '../../../shared/planner/model'
import type { ConversationResponse } from '../../../shared/planner/conversation-wire'

const BOARD = {
  metadata: { board_data_version: 'rev-1', program_repository_courses: [{ course_id: 'Y-1', name_he: 'קורס Y', weekly_hours: 3.5, is_mandatory: false }] },
  semesters: [
    { semester_id: 'year_3_semester_a', courses: [{ course_id: 'X-1', name_he: 'קורס בסיס X', weekly_hours: 3.0, course_type: 'mandatory', is_mandatory: true }] },
    { semester_id: 'year_3_semester_b', courses: [] },
  ],
}
const board = () => boardResponseToModel(BOARD)

/** An agent proposal that ECHOES the request's profile version (as the real server does). */
function agentProposal(req: GeneratePlanRequest): GeneratedPlanModel {
  const version = (req as any).preference_profile?.version
  return {
    semesters: [
      { semesterId: 'year_3_semester_a', courseIds: ['X-1', 'Y-1'] },
      { semesterId: 'year_3_semester_b', courseIds: [] },
    ],
    moves: [{ courseId: 'Y-1', from: null, to: 'year_3_semester_a' }],
    warningsHe: [], errors: [], blocked: false,
    agentOutcome: 'proposal', applyEligible: true, profileVersion: version,
    // S1 — the authoritative receipt. With no comparison to offer, the single
    // recommendation is still a candidate the server holds and can commit.
    proposal: {
      proposalId: PROPOSAL_ID,
      candidateIds: [SINGLE_CANDIDATE],
      recommendedCandidateId: SINGLE_CANDIDATE,
      baseBoardVersion: null,
      profileVersion: version ?? 0,
      academicStatusDigest: 'as_test',
      expiresAt: Date.now() + 3_600_000,
    },
  }
}

const PROPOSAL_ID = 'prop_agent'
const SINGLE_CANDIDATE = 'cand_agent'
let server: ReturnType<typeof createServerApplyStub>

const offerBuildResponse = (): ConversationResponse => ({
  outcome: 'conversation',
  message_he: 'יש לי מספיק מידע כדי להכין חלופות.',
  next_action: 'offer_build',
  events: [],
})

const deps = (over: Partial<{ getBoardFn: any; generateFn: any; useAcademicDecisionAgent: boolean; sendConversationFn: any }> = {}) => ({
  programId: 'mechanical_engineering_2027',
  getBoardFn: over.getBoardFn ?? (async () => board()),
  generateFn: over.generateFn ?? (async (req: GeneratePlanRequest) => agentProposal(req)),
  applyFn: server.applyFn,
  committedBoardFn: server.committedBoardFn,
  planningContextFn: async () => null,
  sendConversationFn: over.sendConversationFn ?? (async () => offerBuildResponse()),
  useAcademicDecisionAgent: over.useAcademicDecisionAgent ?? false,
})

async function renderReady(over = {}) {
  server = createServerApplyStub({
    proposalId: PROPOSAL_ID,
    candidates: [{
      candidateId: SINGLE_CANDIDATE,
      semesters: [
        { semesterId: 'year_3_semester_a', courseIds: ['X-1', 'Y-1'] },
        { semesterId: 'year_3_semester_b', courseIds: [] },
      ],
    }],
  })
  render(<NativePlannerJourney {...deps(over)} />)
  await waitFor(() => expect(screen.getByText('קורס בסיס X')).toBeInTheDocument())
  if ((over as { useAcademicDecisionAgent?: boolean }).useAcademicDecisionAgent) {
    await waitFor(() => expect(screen.getByTestId('academic-agent-conversation')).toBeInTheDocument())
  }
}

async function askAgentToBuild() {
  const composer = screen.getByRole('textbox', { name: 'הודעה לעוזר האקדמי' })
  fireEvent.change(composer, { target: { value: 'יש לי מידע נוסף לתכנון' } })
  fireEvent.click(screen.getByRole('button', { name: 'שלח לעוזר' }))
  await waitFor(() => {
    if (!screen.queryByRole('button', { name: 'בנה חלופות' }) && !screen.queryByRole('region', { name: 'טיוטת תוכנית' })) {
      throw new Error('agent has not offered build or returned a proposal yet')
    }
  })
  const buildButton = screen.queryByRole('button', { name: 'בנה חלופות' })
  if (buildButton) fireEvent.click(buildButton)
}

describe('NativePlannerJourney — mounted preference conversation (flag on)', () => {
  test('refreshing an accepted chat answer also refreshes the completed-course panel', async () => {
    server = createServerApplyStub({ proposalId: PROPOSAL_ID, candidates: [] })
    let stored = { academicStatusDigest: 'as_old', preferenceDigest: 'pref_old', personalStatus: {} as unknown, preferences: {} }
    render(<NativePlannerJourney {...deps({ useAcademicDecisionAgent: true })}
      planningContextFn={async () => stored}
      sendConversationFn={async () => {
        stored = { ...stored, academicStatusDigest: 'as_new', personalStatus: {
          completed: [{ course_id: '0509-1510' }], completed_knowledge: { status: 'known' },
        } }
        return { outcome: 'conversation', next_action: 'ask', message_he: 'שמרתי את הקורסים', events: [],
          context_update: { academic_status_digest: 'as_new', preference_digest: 'pref_old' } }
      }} />)
    await screen.findByText('קורס בסיס X')
    fireEvent.click(screen.getByText('מה חשוב לעוזר לדעת? (אופציונלי)'))
    fireEvent.change(screen.getByRole('textbox', { name: 'הודעה לעוזר האקדמי' }), { target: { value: 'עדכן את הרשימה' } })
    fireEvent.click(screen.getByRole('button', { name: 'שלח לעוזר' }))
    await screen.findByText(/אושר בטיוטה: 1 קורסים/)
  })

  test('manual moves reuse saved academic context instead of overwriting answers from chat', async () => {
    server = createServerApplyStub({ proposalId: PROPOSAL_ID, candidates: [] })
    const establish = jest.fn(async () => ({ academicStatusDigest: 'overwritten' }))
    const edit = jest.fn(async () => ({ ok: false as const, code: 'PLAN_INVALID', messageHe: 'השרת דחה את ההעברה' }))
    render(<NativePlannerJourney {...deps({ useAcademicDecisionAgent: true })}
      getBoardFn={async () => boardResponseToModel({ ...BOARD, semesters: [
        { ...BOARD.semesters[0], courses: [{ ...BOARD.semesters[0].courses[0], offered_semesters: ['year_3_semester_a', 'year_3_semester_b'] }] },
        BOARD.semesters[1],
      ] })}
      planningContextFn={async () => ({ academicStatusDigest: 'as_chat', preferenceDigest: 'pref_chat',
        personalStatus: { completed: [], currently_taking: [{ course_id: 'Y-1' }] }, preferences: { max_weekly_hours: 18 } })}
      establishPlanningContextFn={establish} editBoardFn={edit} />)
    await screen.findByText('קורס בסיס X')
    fireEvent.click(screen.getByText('אפשרויות העברה עבור קורס בסיס X'))
    fireEvent.click(screen.getByRole('button', { name: 'העבר קורס בסיס X אל שנה ג׳ — סמסטר ב׳' }))
    await screen.findByText('השרת דחה את ההעברה')
    expect(establish).not.toHaveBeenCalled()
    expect(edit).toHaveBeenCalledWith(expect.objectContaining({ academic_status_digest: 'as_chat', operation: 'move_course' }))
    expect(within(screen.getByRole('region', { name: 'שנה ג׳ — סמסטר א׳' })).getByText('קורס בסיס X')).toBeInTheDocument()
  })

  test('sends confirmed panel completion with the next chat turn, only until accepted', async () => {
    const send = jest.fn().mockResolvedValue(offerBuildResponse())
    await renderReady({ useAcademicDecisionAgent: true, sendConversationFn: send })
    fireEvent.click(screen.getByText('מה חשוב לעוזר לדעת? (אופציונלי)'))
    fireEvent.click(screen.getByRole('button', { name: 'פתח' }))
    fireEvent.click(within(screen.getByRole('group', { name: 'סטטוס: גרפיקה הנדסית' })).getByRole('button', { name: /^השלמתי$/ }))
    fireEvent.click(screen.getByRole('button', { name: 'אשר את הסטטוס' }))
    expect(send).not.toHaveBeenCalled()
    const composer = screen.getByRole('textbox', { name: 'הודעה לעוזר האקדמי' })
    fireEvent.change(composer, { target: { value: 'מילאתי את הקורסים שלי, נמשיך' } })
    fireEvent.click(screen.getByRole('button', { name: 'שלח לעוזר' }))
    await screen.findByRole('button', { name: 'בנה חלופות' })
    expect(send.mock.calls[0][0].clarification_answers).toEqual([
      { question_id: 'completed_courses', value: ['0509-1510'] },
    ])
    fireEvent.change(composer, { target: { value: 'חשוב לי שבוע קל' } })
    fireEvent.click(screen.getByRole('button', { name: 'שלח לעוזר' }))
    await waitFor(() => expect(send).toHaveBeenCalledTimes(2))
    expect(send.mock.calls[1][0]).not.toHaveProperty('clarification_answers')
  })

  test('course clarification includes early-year course names alongside the active board catalog', async () => {
    const sendConversation = jest.fn(async () => ({
      outcome: 'clarification_required', message_he: 'אילו קורסים כבר השלמת?', next_action: 'ask',
      events: [{ type: 'clarification', question_id: 'completed_courses', answer_type: 'course_id_list', question_he: 'אילו קורסים כבר השלמת?' }],
    } satisfies ConversationResponse))
    await renderReady({ useAcademicDecisionAgent: true, sendConversationFn: sendConversation })
    fireEvent.change(screen.getByRole('textbox', { name: 'הודעה לעוזר האקדמי' }), { target: { value: 'אני רוצה לתכנן את שנה ג' } })
    fireEvent.click(screen.getByRole('button', { name: 'שלח לעוזר' }))
    const search = await screen.findByRole('searchbox', { name: 'חיפוש קורסים לתשובה' })
    fireEvent.change(search, { target: { value: 'גרפיקה הנדסית' } })
    expect(screen.getByRole('checkbox', { name: /גרפיקה הנדסית/ })).toBeInTheDocument()
    fireEvent.change(search, { target: { value: 'קורס בסיס X' } })
    expect(screen.getByRole('checkbox', { name: /קורס בסיס X/ })).toBeInTheDocument()
  })

  test('flag OFF: no conversation is mounted (existing journey unchanged)', async () => {
    await renderReady({ useAcademicDecisionAgent: false })
    expect(screen.queryByText(/מה חשוב לך יותר כרגע/)).toBeNull()
    expect(screen.getByRole('textbox', { name: 'הודעה / בקשה / העדפה' })).toBeInTheDocument()
  })

  test('flag ON: the real conversation is mounted (one question at a time)', async () => {
    await renderReady({ useAcademicDecisionAgent: true })
    expect(screen.queryByText(/מה חשוב לך יותר כרגע/)).toBeNull()
    expect(screen.getByRole('textbox', { name: 'הודעה לעוזר האקדמי' })).toBeInTheDocument()
    expect(screen.queryByLabelText('שיחה')).toBeNull()
    expect(screen.queryByRole('textbox', { name: 'הודעה / בקשה / העדפה' })).toBeNull()
  })

  test('flag ON: preference questions and free-form agent chat share one conversation surface', async () => {
    await renderReady({ useAcademicDecisionAgent: true })
    const conversation = screen.getByTestId('academic-agent-conversation')

    expect(within(conversation).queryByText(/מה חשוב לך יותר כרגע/)).toBeNull()
    expect(within(conversation).getByRole('textbox', { name: 'הודעה לעוזר האקדמי' })).toBeInTheDocument()
  })

  test('flag ON starts with the agent composer, not a standalone workload question', async () => {
    await renderReady({ useAcademicDecisionAgent: true })

    expect(screen.queryByRole('group', { name: /שאלה:.*מה חשוב לך יותר כרגע/ })).toBeNull()
    expect(screen.getByRole('textbox', { name: 'הודעה לעוזר האקדמי' })).toHaveAttribute('placeholder', 'כתבו בקשה או שאלה…')
  })

  test('flag ON keeps optional planning context collapsed so the conversation leads', async () => {
    await renderReady({ useAcademicDecisionAgent: true })

    const context = screen.getByRole('region', { name: 'מידע שהעוזר צריך לדעת' })
    const details = within(context).getByText('מה חשוב לעוזר לדעת? (אופציונלי)').closest('details')

    expect(details).not.toHaveAttribute('open')
    expect(screen.getByRole('textbox', { name: 'הודעה לעוזר האקדמי' })).toBeVisible()
  })

  test('answering a conversation choice does NOT Generate', async () => {
    const generateFn = jest.fn(async (req: GeneratePlanRequest) => agentProposal(req))
    const sendConversation = jest.fn(async () => ({
      outcome: 'conversation', message_he: 'מה חשוב לך יותר?', next_action: 'ask',
      events: [{ type: 'clarification', question_he: 'מה חשוב לך יותר?', options_he: ['שבוע קל יותר'] }],
    } as unknown as ConversationResponse))
    await renderReady({ useAcademicDecisionAgent: true, generateFn, sendConversationFn: sendConversation })
    const composer = screen.getByRole('textbox', { name: 'הודעה לעוזר האקדמי' })
    fireEvent.change(composer, { target: { value: 'אני רוצה עזרה' } })
    fireEvent.click(screen.getByRole('button', { name: 'שלח לעוזר' }))
    await waitFor(() => expect(screen.getByRole('button', { name: 'שבוע קל יותר' })).toBeInTheDocument())
    fireEvent.click(screen.getByRole('button', { name: 'שבוע קל יותר' }))
    expect(generateFn).not.toHaveBeenCalled()
  })

  test('the agent owns the build action after it has enough conversation context', async () => {
    const sendConversation = jest.fn(async () => offerBuildResponse())
    const generateFn = jest.fn(async (req: GeneratePlanRequest) => agentProposal(req))
    await renderReady({ useAcademicDecisionAgent: true, generateFn, sendConversationFn: sendConversation })
    expect(screen.queryByRole('button', { name: 'בנה תוכנית' })).toBeNull()
    await askAgentToBuild()
    expect(sendConversation).toHaveBeenCalledTimes(2)
    expect(generateFn).not.toHaveBeenCalled()
  })

  test('a matching-version proposal applies exactly once and updates the committed board', async () => {
    const sendConversation = jest.fn(async () => ({
      outcome: 'proposal', message_he: 'מצאתי חלופה חוקית.', events: [],
      proposal_id: PROPOSAL_ID,
      proposal: {
        proposal_id: PROPOSAL_ID, candidate_ids: [SINGLE_CANDIDATE], recommended_candidate_id: SINGLE_CANDIDATE,
        base_board_version: null, profile_version: 1, academic_status_digest: 'as_test', expires_at: Date.now() + 3_600_000,
        alternatives: [{
          candidate_id: SINGLE_CANDIDATE, normalized_identity: 'identity', recommended: true, applyable: true,
          semesters: [{ semester_id: 'year_3_semester_a', course_ids: ['X-1', 'Y-1'] }, { semester_id: 'year_3_semester_b', course_ids: [] }],
          constraint_fingerprint: 'cf', profile_version: 1, snapshot_id: 'snap', non_dominated: true, composed_utility: 0,
          objective_scores: [], label_he: 'חלופה', differences_he: [], workload: { peak_hours: 4, total_hours: 4, active_periods: 1 },
        }],
      },
    } as unknown as ConversationResponse))
    await renderReady({ useAcademicDecisionAgent: true, sendConversationFn: sendConversation })
    await askAgentToBuild()
    await waitFor(() => expect(screen.getByRole('button', { name: /החל/ })).toBeInTheDocument())
    fireEvent.click(screen.getByRole('button', { name: /החל/ }))
    // committed board now shows the applied plan (Y-1 added) and the draft closed
    await waitFor(() => expect(screen.getByText('התוכנית הנוכחית')).toBeInTheDocument())
    // …and it was the SERVER that committed it, exactly once.
    expect(server.calls).toHaveLength(1)
    expect(server.committed?.version).toBe('bv_1')
  })

  test('editing a preference AFTER a proposal stales it — the real Apply handler rejects it', async () => {
    const sendConversation = jest.fn(async () => ({
      outcome: 'proposal', message_he: 'מצאתי חלופה חוקית.', events: [], proposal_id: PROPOSAL_ID,
      proposal: {
        proposal_id: PROPOSAL_ID, candidate_ids: [SINGLE_CANDIDATE], recommended_candidate_id: SINGLE_CANDIDATE,
        base_board_version: null, profile_version: 1, academic_status_digest: 'as_test', expires_at: Date.now() + 3_600_000,
        alternatives: [{ candidate_id: SINGLE_CANDIDATE, normalized_identity: 'identity', recommended: true, applyable: true,
          semesters: [{ semester_id: 'year_3_semester_a', course_ids: ['X-1', 'Y-1'] }, { semester_id: 'year_3_semester_b', course_ids: [] }],
          constraint_fingerprint: 'cf', profile_version: 1, snapshot_id: 'snap', non_dominated: true, composed_utility: 0,
          objective_scores: [], label_he: 'חלופה', differences_he: [], workload: { peak_hours: 4, total_hours: 4, active_periods: 1 } }],
      },
    } as unknown as ConversationResponse))
    await renderReady({ useAcademicDecisionAgent: true, sendConversationFn: sendConversation })
    await askAgentToBuild()
    await waitFor(() => expect(screen.getByRole('button', { name: /החל/ })).toBeInTheDocument())
    // change an explicit preference → the proposal is stale
    fireEvent.change(screen.getByRole('textbox', { name: 'מגבלת שעות שבועיות' }), { target: { value: '12' } })
    const applyBtn = screen.getByRole('button', { name: /החל/ }) as HTMLButtonElement
    expect(applyBtn).toBeDisabled()
    // real handler enforces it too: clicking does not change the committed board
    fireEvent.click(applyBtn)
    expect(server.calls).toHaveLength(0)
    expect(screen.getByLabelText('התוכנית הנוכחית')).toHaveTextContent('לא נשמר עד לאישור מפורש')
  })

  test('a profile-version-stale proposal is VISIBLY marked stale, not just disabled', async () => {
    // Browser acceptance (check 4B) found the guard working but silent: editing a
    // preference disabled Apply while rendering no explanation, so the state was
    // conveyed only by a greyed-out control. Meaning must be carried by TEXT.
    const sendConversation = jest.fn(async () => ({
      outcome: 'proposal', message_he: 'מצאתי חלופה חוקית.', events: [], proposal_id: PROPOSAL_ID,
      proposal: {
        proposal_id: PROPOSAL_ID, candidate_ids: [SINGLE_CANDIDATE], recommended_candidate_id: SINGLE_CANDIDATE,
        base_board_version: null, profile_version: 1, academic_status_digest: 'as_test', expires_at: Date.now() + 3_600_000,
        alternatives: [{ candidate_id: SINGLE_CANDIDATE, normalized_identity: 'identity', recommended: true, applyable: true,
          semesters: [{ semester_id: 'year_3_semester_a', course_ids: ['X-1', 'Y-1'] }, { semester_id: 'year_3_semester_b', course_ids: [] }],
          constraint_fingerprint: 'cf', profile_version: 1, snapshot_id: 'snap', non_dominated: true, composed_utility: 0,
          objective_scores: [], label_he: 'חלופה', differences_he: [], workload: { peak_hours: 4, total_hours: 4, active_periods: 1 } }],
      },
    } as unknown as ConversationResponse))
    await renderReady({ useAcademicDecisionAgent: true, sendConversationFn: sendConversation })
    await askAgentToBuild()
    await waitFor(() => expect(screen.getByRole('button', { name: /החל/ })).toBeInTheDocument())

    fireEvent.change(screen.getByRole('textbox', { name: 'מגבלת שעות שבועיות' }), { target: { value: '12' } })

    expect(screen.getByRole('button', { name: /החל/ })).toBeDisabled()
    // …and the reason is stated in text the user can actually read.
    const note = screen.getByRole('note')
    expect(note).toBeInTheDocument()
    // …and it names the ACTUAL cause. Saying "the catalog changed" here would be
    // false: the catalog is untouched, the preference profile advanced.
    expect(note.textContent ?? '').toMatch(/העדפ/)
    expect(note.textContent ?? '').not.toMatch(/הקטלוג/)
  })

  test('the agent prevents duplicate requests while a conversation turn is pending', async () => {
    let resolve: ((value: ConversationResponse) => void) | undefined
    const sendConversation = jest.fn(() => new Promise<ConversationResponse>((done) => { resolve = done }))
    await renderReady({ useAcademicDecisionAgent: true, sendConversationFn: sendConversation })
    const composer = screen.getByRole('textbox', { name: 'הודעה לעוזר האקדמי' })
    fireEvent.change(composer, { target: { value: 'בדוק את הלוח' } })
    fireEvent.click(screen.getByRole('button', { name: 'שלח לעוזר' }))
    expect(sendConversation).toHaveBeenCalledTimes(1)
    expect(screen.getByRole('button', { name: 'שלח לעוזר' })).toBeDisabled()
    resolve?.(offerBuildResponse())
    await waitFor(() => expect(screen.getByRole('button', { name: 'בנה חלופות' })).toBeEnabled())
  })

  test('the conversational agent sends the current board context through the single journey', async () => {
    const sendConversation = jest.fn(async () => ({
      outcome: 'conversation',
      message_he: 'הלוח נבדק.',
      events: [],
    } satisfies ConversationResponse))
    render(
      <NativePlannerJourney
        {...deps({ useAcademicDecisionAgent: true })}
        planningContextFn={async () => ({
          academicStatusDigest: 'as_test',
          preferenceDigest: 'pref_test',
          personalStatus: {},
          preferences: {},
        })}
        sendConversationFn={sendConversation}
      />,
    )
    await waitFor(() => expect(screen.getByText('קורס בסיס X')).toBeInTheDocument())
    const composer = screen.getByRole('textbox', { name: 'הודעה לעוזר האקדמי' })
    fireEvent.change(composer, { target: { value: 'בדוק את העומס' } })
    fireEvent.keyDown(composer, { key: 'Enter' })
    await waitFor(() => expect(sendConversation).toHaveBeenCalledTimes(1))
    const request = (sendConversation as jest.Mock).mock.calls[0][0]
    expect(request).toEqual(expect.objectContaining({
      program_id: 'mechanical_engineering_2027',
      board_version: null,
      academic_status_digest: 'as_test',
      preference_digest: 'pref_test',
    }))
  })

  test('a conversation proposal becomes the visible draft instead of only a receipt message', async () => {
    const sendConversation = jest.fn(async () => ({
      outcome: 'proposal',
      message_he: 'מצאתי טיוטה חוקית לבדיקה.',
      events: [{
        type: 'alternatives_ready',
        proposal_id: PROPOSAL_ID,
        candidate_ids: [SINGLE_CANDIDATE],
      }],
      proposal: {
        proposal_id: PROPOSAL_ID,
        candidate_ids: [SINGLE_CANDIDATE],
        recommended_candidate_id: SINGLE_CANDIDATE,
        base_board_version: null,
        profile_version: 1,
        academic_status_digest: 'as_test',
        expires_at: Date.now() + 3_600_000,
        alternatives: [{
          candidate_id: SINGLE_CANDIDATE,
          normalized_identity: 'conversation-plan',
          recommended: true,
          applyable: true,
          semesters: [
            { semester_id: 'year_3_semester_a', course_ids: ['X-1', 'Y-1'] },
            { semester_id: 'year_3_semester_b', course_ids: [] },
          ],
          constraint_fingerprint: 'cf_conversation',
          profile_version: 1,
          snapshot_id: 'conversation-snapshot',
          non_dominated: true,
          composed_utility: 0,
          objective_scores: [],
          label_he: 'הצעת העוזר',
          differences_he: ['כולל קורס Y'],
          workload: { peak_hours: 4, total_hours: 4, active_periods: 1 },
        }],
      },
    } as unknown as ConversationResponse))

    render(
      <NativePlannerJourney
        {...deps({ useAcademicDecisionAgent: true })}
        planningContextFn={async () => ({
          academicStatusDigest: 'as_test',
          preferenceDigest: 'pref_test',
          personalStatus: {},
          preferences: {},
        })}
        sendConversationFn={sendConversation}
      />,
    )
    await waitFor(() => expect(screen.getByText('קורס בסיס X')).toBeInTheDocument())
    const composer = screen.getByRole('textbox', { name: 'הודעה לעוזר האקדמי' })
    fireEvent.change(composer, { target: { value: 'בנה לי טיוטה' } })
    fireEvent.keyDown(composer, { key: 'Enter' })

    await waitFor(() => expect(screen.getByRole('region', { name: 'טיוטת תוכנית' })).toBeInTheDocument())
    expect(screen.getByRole('region', { name: 'טיוטת תוכנית' })).toHaveTextContent('קורס Y')
    expect(screen.getByRole('button', { name: /החל/ })).toBeInTheDocument()
  })
})

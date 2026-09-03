/**
 * Slice 13/14 integration closure — the live NativePlannerJourney mounts the
 * real PreferenceConversation (typed conversation state machine) on the flagged
 * path, sends its typed profile+version through the real Generate contract, and
 * enforces profile-version staleness at the real Apply handler. Flag-off is
 * unchanged.
 */
import { render, screen, fireEvent, waitFor, act, within } from '@testing-library/react'
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

const deps = (over: Partial<{ getBoardFn: any; generateFn: any; useAcademicDecisionAgent: boolean }> = {}) => ({
  programId: 'mechanical_engineering_2027',
  getBoardFn: over.getBoardFn ?? (async () => board()),
  generateFn: over.generateFn ?? (async (req: GeneratePlanRequest) => agentProposal(req)),
  applyFn: server.applyFn,
  committedBoardFn: server.committedBoardFn,
  planningContextFn: async () => null,
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
    await waitFor(() => expect(screen.getByRole('button', { name: 'בנה תוכנית' })).toBeEnabled())
  }
}

describe('NativePlannerJourney — mounted preference conversation (flag on)', () => {
  test('flag OFF: no conversation is mounted (existing journey unchanged)', async () => {
    await renderReady({ useAcademicDecisionAgent: false })
    expect(screen.queryByText(/מה חשוב לך יותר כרגע/)).toBeNull()
  })

  test('flag ON: the real conversation is mounted (one question at a time)', async () => {
    await renderReady({ useAcademicDecisionAgent: true })
    expect(screen.getByText(/מה חשוב לך יותר כרגע/)).toBeInTheDocument()
  })

  test('answering a conversation choice does NOT Generate', async () => {
    const generateFn = jest.fn(async (req: GeneratePlanRequest) => agentProposal(req))
    await renderReady({ useAcademicDecisionAgent: true, generateFn })
    fireEvent.click(screen.getByRole('button', { name: 'שבוע קל יותר' }))
    expect(generateFn).not.toHaveBeenCalled()
  })

  test('explicit Build sends the current typed profile + version through the real request', async () => {
    let captured: GeneratePlanRequest | null = null
    const generateFn = jest.fn(async (req: GeneratePlanRequest) => { captured = req; return agentProposal(req) })
    await renderReady({ useAcademicDecisionAgent: true, generateFn })
    fireEvent.click(screen.getByRole('button', { name: 'שבוע קל יותר' })) // answer one (version bumps)
    fireEvent.click(screen.getByRole('button', { name: 'בנה תוכנית' }))
    await waitFor(() => expect(generateFn).toHaveBeenCalledTimes(1))
    const pp = (captured as any).preference_profile
    expect(pp).toBeDefined()
    expect(pp.version).toBeGreaterThan(1)
    expect(pp.preferences.find((p: any) => p.id === 'workload_target')).toBeTruthy()
    expect((captured as any).use_academic_decision_agent).toBe(true)
  })

  test('a matching-version proposal applies exactly once and updates the committed board', async () => {
    await renderReady({ useAcademicDecisionAgent: true })
    fireEvent.click(screen.getByRole('button', { name: 'שבוע קל יותר' }))
    fireEvent.click(screen.getByRole('button', { name: 'בנה תוכנית' }))
    await waitFor(() => expect(screen.getByRole('button', { name: /החל/ })).toBeInTheDocument())
    fireEvent.click(screen.getByRole('button', { name: /החל/ }))
    // committed board now shows the applied plan (Y-1 added) and the draft closed
    await waitFor(() => expect(screen.getByText('התוכנית הנוכחית')).toBeInTheDocument())
    // …and it was the SERVER that committed it, exactly once.
    expect(server.calls).toHaveLength(1)
    expect(server.committed?.version).toBe('bv_1')
  })

  test('editing a preference AFTER a proposal stales it — the real Apply handler rejects it', async () => {
    await renderReady({ useAcademicDecisionAgent: true })
    fireEvent.click(screen.getByRole('button', { name: 'שבוע קל יותר' }))
    fireEvent.click(screen.getByRole('button', { name: 'בנה תוכנית' }))
    await waitFor(() => expect(screen.getByRole('button', { name: /החל/ })).toBeInTheDocument())
    // remove the captured preference → profile version advances → proposal is stale
    const summary = screen.getByRole('region', { name: /מה הבנתי ממך/ })
    fireEvent.click(within(summary).getByRole('button', { name: /הסר/ }))
    const applyBtn = screen.getByRole('button', { name: /החל/ }) as HTMLButtonElement
    expect(applyBtn).toBeDisabled()
    // real handler enforces it too: clicking does not change the committed board
    fireEvent.click(applyBtn)
    expect(server.calls).toHaveLength(0)
    expect(screen.getByLabelText('התוכנית הנוכחית')).toHaveTextContent('קורס בסיס X')
    expect(screen.getByLabelText('התוכנית הנוכחית')).not.toHaveTextContent('קורס Y')
  })

  test('a profile-version-stale proposal is VISIBLY marked stale, not just disabled', async () => {
    // Browser acceptance (check 4B) found the guard working but silent: editing a
    // preference disabled Apply while rendering no explanation, so the state was
    // conveyed only by a greyed-out control. Meaning must be carried by TEXT.
    await renderReady({ useAcademicDecisionAgent: true })
    fireEvent.click(screen.getByRole('button', { name: 'שבוע קל יותר' }))
    fireEvent.click(screen.getByRole('button', { name: 'בנה תוכנית' }))
    await waitFor(() => expect(screen.getByRole('button', { name: /החל/ })).toBeInTheDocument())

    const summary = screen.getByRole('region', { name: /מה הבנתי ממך/ })
    fireEvent.click(within(summary).getByRole('button', { name: /הסר/ }))

    expect(screen.getByRole('button', { name: /החל/ })).toBeDisabled()
    // …and the reason is stated in text the user can actually read.
    const note = screen.getByRole('note')
    expect(note).toBeInTheDocument()
    // …and it names the ACTUAL cause. Saying "the catalog changed" here would be
    // false: the catalog is untouched, the preference profile advanced.
    expect(note.textContent ?? '').toMatch(/העדפ/)
    expect(note.textContent ?? '').not.toMatch(/הקטלוג/)
  })

  test('a late response superseded by a newer Build never becomes the proposal', async () => {
    let resolveFirst: () => void = () => {}
    let call = 0
    const generateFn = jest.fn((req: GeneratePlanRequest) => {
      call += 1
      if (call === 1) return new Promise<GeneratedPlanModel>((res) => { resolveFirst = () => res(agentProposal(req)) })
      return Promise.resolve(agentProposal(req))
    })
    await renderReady({ useAcademicDecisionAgent: true, generateFn })
    fireEvent.click(screen.getByRole('button', { name: 'שבוע קל יותר' }))
    fireEvent.click(screen.getByRole('button', { name: 'בנה תוכנית' })) // build #1 (in-flight)
    fireEvent.click(screen.getByRole('button', { name: 'עומס מאוזן' })) // answer more (version bumps)
    fireEvent.click(screen.getByRole('button', { name: 'בנה תוכנית' })) // build #2 supersedes #1
    await waitFor(() => expect(screen.getByRole('button', { name: /החל/ })).toBeInTheDocument())
    // now resolve the STALE first response — it must be ignored
    await act(async () => { resolveFirst() })
    expect(generateFn).toHaveBeenCalledTimes(2)
    // still a single, current proposal (not replaced by the late one)
    expect(screen.getByRole('button', { name: /החל/ })).toBeInTheDocument()
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
        profile_version: 0,
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
          profile_version: 0,
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

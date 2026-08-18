/**
 * S5 — the journey's Apply is a SERVER action.
 *
 * The properties that matter are the ones the old client-only Apply could not
 * have: the committed board changes only after the server says so, a refusal
 * leaves it untouched, a refresh reads the server's board back, and the request
 * carries a candidate NAME rather than a plan.
 */
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import NativePlannerJourney from './NativePlannerJourney'
import { boardResponseToModel } from '../../../shared/planner/adapters'
import { createServerApplyStub } from './serverApplyStub'
import type { GeneratePlanRequest, CommittedBoardState } from '../../../shared/planner/api-client'
import type { GeneratedPlanModel } from '../../../shared/planner/model'

const SEM_A = 'year_3_semester_a'
const SEM_B = 'year_3_semester_b'
const PROPOSAL_ID = 'prop_server_apply'
const REC = 'cand_rec'
const OTHER = 'cand_other'

const BOARD = {
  metadata: {
    board_data_version: 'rev-1',
    program_repository_courses: [
      { course_id: 'Y-1', name_he: 'קורס Y', weekly_hours: 4, is_mandatory: false },
      { course_id: 'Z-1', name_he: 'קורס Z', weekly_hours: 4, is_mandatory: false },
    ],
  },
  semesters: [
    { semester_id: SEM_A, courses: [{ course_id: 'X-1', name_he: 'קורס בסיס X', weekly_hours: 4, course_type: 'mandatory', is_mandatory: true }] },
    { semester_id: SEM_B, courses: [] },
  ],
}

const PLAN_REC = [{ semesterId: SEM_A, courseIds: ['X-1'] }, { semesterId: SEM_B, courseIds: ['Y-1'] }]
const PLAN_OTHER = [{ semesterId: SEM_A, courseIds: ['X-1'] }, { semesterId: SEM_B, courseIds: ['Z-1'] }]

const alt = (candidateId: string, semesters: typeof PLAN_REC, recommended: boolean, labelHe: string) => ({
  candidateId, normalizedIdentity: `id_${candidateId}`, recommended, applyable: true, semesters,
  constraintFingerprint: 'cf_same', profileVersion: 1, snapshotId: 'snap_same', nonDominated: true,
  composedUtility: 0.5, objectiveScores: [{ objectiveId: 'prefer_project_courses', normalized: 0.5 }],
  labelHe, differencesHe: [], workload: { peakHours: 4, totalHours: 8, activePeriods: 2 },
})

function proposal(req: GeneratePlanRequest): GeneratedPlanModel {
  const version = (req as unknown as { preference_profile?: { version: number } }).preference_profile?.version
  return {
    semesters: PLAN_REC,
    moves: [], warningsHe: [], errors: [], blocked: false,
    agentOutcome: 'proposal', applyEligible: true, profileVersion: version,
    alternatives: [alt(REC, PLAN_REC, true, 'המומלצת'), alt(OTHER, PLAN_OTHER, false, 'החלופה השנייה')],
    proposal: {
      proposalId: PROPOSAL_ID,
      candidateIds: [REC, OTHER],
      recommendedCandidateId: REC,
      baseBoardVersion: null,
      profileVersion: version ?? 0,
      expiresAt: Date.now() + 3_600_000,
    },
  }
}

type Stub = ReturnType<typeof createServerApplyStub>

async function renderReady(over: {
  stub?: Stub
  committedBoardFn?: (programId: string) => Promise<CommittedBoardState | null>
} = {}) {
  const server = over.stub ?? createServerApplyStub({
    proposalId: PROPOSAL_ID,
    candidates: [
      { candidateId: REC, semesters: PLAN_REC },
      { candidateId: OTHER, semesters: PLAN_OTHER },
    ],
  })
  render(
    <NativePlannerJourney
      programId="mechanical_engineering_2027"
      getBoardFn={async () => boardResponseToModel(BOARD)}
      generateFn={async (req: GeneratePlanRequest) => proposal(req)}
      applyFn={server.applyFn}
      committedBoardFn={over.committedBoardFn ?? server.committedBoardFn}
      useAcademicDecisionAgent
    />,
  )
  await waitFor(() => expect(screen.getByText('קורס בסיס X')).toBeInTheDocument())
  return server
}

const build = async () => {
  fireEvent.click(screen.getByRole('button', { name: /^בנה תוכנית$/ }))
  await waitFor(() => expect(screen.getByRole('button', { name: /החל/ })).toBeInTheDocument())
}
const applyBtn = () => screen.getByRole('button', { name: /החל/ })
const committed = () => screen.queryByLabelText('התוכנית הנוכחית')?.textContent ?? ''

describe('S5 — Apply goes to the server, and only the server commits', () => {
  test('the request names a candidate and carries NO plan', async () => {
    const server = await renderReady()
    await build()
    fireEvent.click(applyBtn())
    await waitFor(() => expect(server.calls).toHaveLength(1))

    const sent = server.calls[0]
    expect(sent.proposal_id).toBe(PROPOSAL_ID)
    expect(sent.candidate_id).toBe(REC)
    expect(sent.expected_board_version).toBeNull()
    expect(typeof sent.idempotency_key).toBe('string')
    // Structurally incapable of choosing the committed content.
    expect(JSON.stringify(sent)).not.toMatch(/courseIds|semesterId|X-1|Y-1/)
  })

  test('the committed board becomes the SERVER’s board, and its version is adopted', async () => {
    const server = await renderReady()
    await build()
    fireEvent.click(applyBtn())

    await waitFor(() => expect(screen.getByLabelText('התוכנית הנוכחית')).toBeInTheDocument())
    expect(committed()).toContain('קורס Y')
    expect(server.committed?.version).toBe('bv_1')

    // A SECOND build+apply must send the version the server actually minted.
    await build()
    fireEvent.click(applyBtn())
    await waitFor(() => expect(server.calls).toHaveLength(2))
    expect(server.calls[1].expected_board_version).toBe('bv_1')
  })

  test('selecting B then applying commits the SERVER’s copy of B', async () => {
    const server = await renderReady()
    await build()
    fireEvent.click(screen.getAllByRole('radio')[1])
    await waitFor(() => expect(screen.getByLabelText('טיוטת תוכנית')).toHaveTextContent('קורס Z'))
    fireEvent.click(applyBtn())

    await waitFor(() => expect(screen.getByLabelText('התוכנית הנוכחית')).toBeInTheDocument())
    expect(server.calls[0].candidate_id).toBe(OTHER)
    expect(committed()).toContain('קורס Z')
    expect(committed()).not.toContain('קורס Y')
  })

  test('selecting an alternative sends NOTHING to the server', async () => {
    const server = await renderReady()
    await build()
    fireEvent.click(screen.getAllByRole('radio')[1])
    fireEvent.click(screen.getAllByRole('radio')[0])
    expect(server.calls).toHaveLength(0)
  })

  test('a pending Apply is announced and cannot be double-submitted', async () => {
    let release!: () => void
    const gate = new Promise<void>((r) => { release = r })
    const inner = createServerApplyStub({
      proposalId: PROPOSAL_ID,
      candidates: [{ candidateId: REC, semesters: PLAN_REC }, { candidateId: OTHER, semesters: PLAN_OTHER }],
    })
    const server: Stub = {
      ...inner,
      applyFn: async (req) => { await gate; return inner.applyFn(req) },
      get calls() { return inner.calls },
      get committed() { return inner.committed },
    } as Stub

    await renderReady({ stub: server })
    await build()
    fireEvent.click(applyBtn())

    await waitFor(() => expect(screen.getByText('מחיל את התוכנית…')).toBeInTheDocument())
    expect(applyBtn()).toBeDisabled()
    fireEvent.click(applyBtn())     // a second click while in flight
    release()
    await waitFor(() => expect(screen.getByLabelText('התוכנית הנוכחית')).toBeInTheDocument())
    expect(inner.calls).toHaveLength(1)
  })
})

describe('S5 — a refusal leaves the committed board alone', () => {
  test('a typed server refusal is shown and nothing is committed', async () => {
    const server = createServerApplyStub({
      proposalId: PROPOSAL_ID,
      candidates: [{ candidateId: REC, semesters: PLAN_REC }],
      reject: { code: 'PROPOSAL_SUPERSEDED', messageHe: 'נבנתה הצעה חדשה יותר. יש לבנות מחדש ולבחור שוב.' },
    })
    await renderReady({ stub: server })
    await build()
    fireEvent.click(applyBtn())

    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('נבנתה הצעה חדשה יותר'))
    // The board was never optimistically replaced.
    expect(screen.queryByLabelText('התוכנית הנוכחית')).toBeNull()
    expect(screen.getByLabelText('טיוטת תוכנית')).toBeInTheDocument() // still inspectable
    expect(server.committed).toBeNull()
  })

  test('a NETWORK failure leaves the committed board unchanged and says so', async () => {
    const server = createServerApplyStub({
      proposalId: PROPOSAL_ID,
      candidates: [{ candidateId: REC, semesters: PLAN_REC }],
      throwOnApply: true,
    })
    await renderReady({ stub: server })
    await build()
    fireEvent.click(applyBtn())

    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent(/שגיאת רשת/))
    expect(screen.queryByLabelText('התוכנית הנוכחית')).toBeNull()
    expect(server.committed).toBeNull()
    // …and it can be retried, because nothing was consumed.
    expect(applyBtn()).not.toBeDisabled()
  })

  test('no rejection exposes a stack trace or an internal id', async () => {
    const server = createServerApplyStub({
      proposalId: PROPOSAL_ID,
      candidates: [{ candidateId: REC, semesters: PLAN_REC }],
      reject: { code: 'BOARD_VERSION_CONFLICT', messageHe: 'התוכנית הנוכחית התעדכנה בינתיים.' },
    })
    await renderReady({ stub: server })
    await build()
    fireEvent.click(applyBtn())
    await waitFor(() => expect(screen.getByRole('alert')).toBeInTheDocument())
    const text = screen.getByRole('alert').textContent ?? ''
    expect(text).not.toMatch(/Error|stack|prop_|cand_|at Object/)
  })
})

describe('S5 — refresh reads the server’s board back', () => {
  test('a session that already committed sees its board on mount, not the catalog default', async () => {
    // Models a page reload: the server already holds a committed board.
    const saved: CommittedBoardState = {
      programId: 'mechanical_engineering_2027', version: 'bv_7', semesters: PLAN_OTHER,
    }
    await renderReady({ committedBoardFn: async () => saved })

    // The committed board is the SERVER's, not the catalog's original placement.
    await waitFor(() => expect(screen.getByText('קורס Z')).toBeInTheDocument())
    expect(screen.queryByText('קורס Y')).toBeNull()
  })

  test('the restored version is what a later Apply sends as its base', async () => {
    const server = createServerApplyStub({
      proposalId: PROPOSAL_ID,
      candidates: [{ candidateId: REC, semesters: PLAN_REC }],
    })
    await renderReady({
      stub: server,
      committedBoardFn: async () => ({
        programId: 'mechanical_engineering_2027', version: 'bv_7', semesters: PLAN_OTHER,
      }),
    })
    await build()
    fireEvent.click(applyBtn())
    await waitFor(() => expect(server.calls).toHaveLength(1))
    expect(server.calls[0].expected_board_version).toBe('bv_7')
  })

  test('a session with NO committed board falls back to the catalog honestly', async () => {
    await renderReady({ committedBoardFn: async () => null })
    expect(screen.getByText('קורס בסיס X')).toBeInTheDocument()
    expect(screen.queryByText('קורס Z')).toBeNull()
  })

  test('a failure to read the committed board does not hide the catalog', async () => {
    const spy = jest.spyOn(console, 'error').mockImplementation(() => {})
    await renderReady({ committedBoardFn: async () => { throw new Error('offline') } })
    expect(screen.getByText('קורס בסיס X')).toBeInTheDocument()
    spy.mockRestore()
  })
})

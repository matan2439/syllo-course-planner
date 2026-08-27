/**
 * C3/C4/C6 — comparing, selecting and applying a validated alternative.
 *
 * The rules under test are the ones that keep a comparison honest: it appears
 * only when a real choice exists, selecting never regenerates and never touches
 * the committed board, the applied plan is the SELECTED candidate's exact state
 * rather than whatever the UI labelled as recommended, and a stale set can be
 * read but not chosen from.
 */
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react'
import PlanAlternatives from './PlanAlternatives'
import NativePlannerJourney from './NativePlannerJourney'
import { boardResponseToModel } from '../../../shared/planner/adapters'
import type { GeneratePlanRequest } from '../../../shared/planner/api-client'
import type { GeneratedPlanModel } from '../../../shared/planner/model'
import { createServerApplyStub } from './serverApplyStub'

type Alternative = NonNullable<GeneratedPlanModel['alternatives']>[number]

const SEM_A = 'year_3_semester_a'
const SEM_B = 'year_3_semester_b'

const alt = (over: Partial<Alternative> & { candidateId: string }): Alternative => ({
  normalizedIdentity: `id_${over.candidateId}`,
  recommended: false,
  applyable: true,
  semesters: [{ semesterId: SEM_A, courseIds: ['X-1'] }, { semesterId: SEM_B, courseIds: [] }],
  constraintFingerprint: 'cf_same',
  profileVersion: 4,
  snapshotId: 'snap_same',
  nonDominated: true,
  composedUtility: 0.5,
  objectiveScores: [{ objectiveId: 'prefer_project_courses', normalized: 0.5 }],
  labelHe: 'חלופה',
  differencesHe: [],
  workload: { peakHours: 4, totalHours: 8, activePeriods: 2 },
  ...over,
})

const A = alt({
  candidateId: 'cand_a', recommended: true, labelHe: 'יותר קורסים פרויקטליים',
  semesters: [{ semesterId: SEM_A, courseIds: ['X-1'] }, { semesterId: SEM_B, courseIds: ['Y-1'] }],
})
const B = alt({
  candidateId: 'cand_b', labelHe: 'יותר קורסים בתחום רובוטיקה',
  semesters: [{ semesterId: SEM_A, courseIds: ['X-1'] }, { semesterId: SEM_B, courseIds: ['Z-1'] }],
  differencesHe: ['כולל קורס Z (Z-1)', 'לא כולל קורס Y (Y-1)'],
})

// ── the comparison component ─────────────────────────────────────────────────

describe('C3 — the comparison appears only when a real choice exists', () => {
  test('a single alternative is not dressed up as a comparison', () => {
    const { container } = render(
      <PlanAlternatives alternatives={[A]} selectedId="cand_a" onSelect={() => {}} />,
    )
    expect(container).toBeEmptyDOMElement()
  })

  test('two alternatives render as a radiogroup with the recommended one selected', () => {
    render(<PlanAlternatives alternatives={[A, B]} selectedId="cand_a" onSelect={() => {}} />)
    const group = screen.getByRole('radiogroup', { name: 'בחירת חלופת תוכנית' })
    const options = within(group).getAllByRole('radio')
    expect(options).toHaveLength(2)
    expect(options[0]).toHaveAttribute('aria-checked', 'true')
    expect(options[1]).toHaveAttribute('aria-checked', 'false')
  })

  test('the selected state is conveyed by TEXT, not colour alone', () => {
    render(<PlanAlternatives alternatives={[A, B]} selectedId="cand_a" onSelect={() => {}} />)
    expect(screen.getByText('✓ נבחר')).toBeInTheDocument()
    expect(screen.getByText('לא נבחר')).toBeInTheDocument()
  })

  test('labels are the factual server labels, never a planning input name', () => {
    render(<PlanAlternatives alternatives={[A, B]} selectedId="cand_a" onSelect={() => {}} />)
    expect(screen.getByText('יותר קורסים פרויקטליים')).toBeInTheDocument()
    expect(screen.getByText('יותר קורסים בתחום רובוטיקה')).toBeInTheDocument()
    expect(screen.queryByText(/מאוזנ|מרוכז/)).not.toBeInTheDocument()
  })

  test('each card shows its own courses, load and differences', () => {
    render(<PlanAlternatives alternatives={[A, B]} selectedId="cand_a" onSelect={() => {}} />)
    expect(screen.getByText(/כולל קורס Z/)).toBeInTheDocument()
    expect(screen.getAllByText(/עומס שיא 4 ש״ש/).length).toBeGreaterThan(0)
  })

  test('arrow keys move between alternatives (RTL: left advances)', () => {
    const onSelect = jest.fn()
    render(<PlanAlternatives alternatives={[A, B]} selectedId="cand_a" onSelect={onSelect} />)
    fireEvent.keyDown(screen.getAllByRole('radio')[0], { key: 'ArrowLeft' })
    expect(onSelect).toHaveBeenCalledWith('cand_b')
  })

  test('a live region announces the selected alternative', () => {
    render(<PlanAlternatives alternatives={[A, B]} selectedId="cand_b" onSelect={() => {}} />)
    expect(screen.getByRole('status')).toHaveTextContent('יותר קורסים בתחום רובוטיקה')
  })

  test('a STALE set is readable but not selectable', () => {
    const onSelect = jest.fn()
    render(<PlanAlternatives alternatives={[A, B]} selectedId="cand_a" onSelect={onSelect} disabled />)
    const options = screen.getAllByRole('radio')
    expect(options[1]).toBeDisabled()
    fireEvent.click(options[1])
    expect(onSelect).not.toHaveBeenCalled()
    // Still comparable — the courses remain on screen.
    expect(screen.getByText('יותר קורסים בתחום רובוטיקה')).toBeInTheDocument()
  })
})

// ── selection and Apply through the real journey ─────────────────────────────

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

function proposal(req: GeneratePlanRequest): GeneratedPlanModel {
  const version = (req as unknown as { preference_profile?: { version: number } }).preference_profile?.version
  return {
    // The handler's own `semesters` are the RECOMMENDED alternative's plan.
    semesters: [
      { semesterId: SEM_A, courseIds: ['X-1'] },
      { semesterId: SEM_B, courseIds: ['Y-1'] },
    ],
    moves: [{ courseId: 'Y-1', from: null, to: SEM_B }],
    warningsHe: [], errors: [], blocked: false,
    agentOutcome: 'proposal', applyEligible: true, profileVersion: version,
    alternatives: [A, B],
    // S1 — the authoritative receipt. Apply names the proposal and a candidate;
    // it never sends a plan.
    proposal: {
      proposalId: PROPOSAL_ID,
      candidateIds: [A.candidateId, B.candidateId],
      recommendedCandidateId: A.candidateId,
      baseBoardVersion: null,
      profileVersion: version ?? 0,
      academicStatusDigest: 'as_test',
      expiresAt: Date.now() + 3_600_000,
    },
  }
}

const PROPOSAL_ID = 'prop_alternatives'
/**
 * The server's own copy of the candidates. Note it is built from A and B
 * directly rather than from anything the journey sends, so a test can only pass
 * if the journey genuinely asked the server to commit a NAMED candidate.
 */
let server: ReturnType<typeof createServerApplyStub>

async function renderReady(over: Partial<{ generateFn: unknown }> = {}) {
  server = createServerApplyStub({
    proposalId: PROPOSAL_ID,
    candidates: [A, B].map((a) => ({ candidateId: a.candidateId, semesters: a.semesters })),
  })
  render(
    <NativePlannerJourney
      programId="mechanical_engineering_2027"
      getBoardFn={async () => boardResponseToModel(BOARD)}
      generateFn={(over.generateFn as never) ?? (async (req: GeneratePlanRequest) => proposal(req))}
      applyFn={server.applyFn}
      committedBoardFn={server.committedBoardFn}
      useAcademicDecisionAgent
    />,
  )
  await waitFor(() => expect(screen.getByText('קורס בסיס X')).toBeInTheDocument())
}
const buildPlan = async () => {
  fireEvent.click(screen.getByRole('button', { name: /בנה|בניית|בנייה/ }))
  await waitFor(() => expect(screen.getByRole('radiogroup', { name: 'בחירת חלופת תוכנית' })).toBeInTheDocument())
}
const applyPlan = () => fireEvent.click(screen.getByRole('button', { name: 'החל תוכנית' }))
const committedText = () => screen.getByLabelText('התוכנית הנוכחית').textContent ?? ''

describe('C4 — selecting an alternative, and applying the one selected', () => {
  test('selecting another alternative does NOT Generate', async () => {
    const generateFn = jest.fn(async (req: GeneratePlanRequest) => proposal(req))
    await renderReady({ generateFn })
    await buildPlan()
    expect(generateFn).toHaveBeenCalledTimes(1)

    fireEvent.click(screen.getAllByRole('radio')[1])
    expect(generateFn).toHaveBeenCalledTimes(1)
  })

  test('the shown draft becomes the EXACT selected candidate', async () => {
    await renderReady()
    await buildPlan()
    // Recommended A places Y-1.
    expect(screen.getByLabelText('טיוטת תוכנית')).toHaveTextContent('קורס Y')

    fireEvent.click(screen.getAllByRole('radio')[1])
    await waitFor(() => expect(screen.getByLabelText('טיוטת תוכנית')).toHaveTextContent('קורס Z'))
    expect(screen.getByLabelText('טיוטת תוכנית')).not.toHaveTextContent('קורס Y')
  })

  test('browsing and selecting never mutates the committed board', async () => {
    await renderReady()
    await buildPlan()
    fireEvent.click(screen.getAllByRole('radio')[1])
    // The committed board is only replaced by Apply.
    expect(screen.queryByText('הצעת תוכנית')).toBeInTheDocument()
    expect(screen.queryByRole('region', { name: 'התוכנית הנוכחית' })).toBeNull()
  })

  test('applying after selecting B commits B — not the recommended A', async () => {
    await renderReady()
    await buildPlan()
    fireEvent.click(screen.getAllByRole('radio')[1])
    await waitFor(() => expect(screen.getByLabelText('טיוטת תוכנית')).toHaveTextContent('קורס Z'))
    applyPlan()

    await waitFor(() => expect(screen.getByLabelText('התוכנית הנוכחית')).toBeInTheDocument())
    expect(committedText()).toContain('קורס Z')
    expect(committedText()).not.toContain('קורס Y')
    // The commit came from the SERVER's copy of candidate B, named by id.
    expect(server.calls).toHaveLength(1)
    expect(server.calls[0].candidate_id).toBe('cand_b')
    expect(server.calls[0].proposal_id).toBe(PROPOSAL_ID)
    // …and the request carried no plan at all.
    expect(JSON.stringify(server.calls[0])).not.toMatch(/courseIds|semesterId/)
    expect(server.committed?.version).toBe('bv_1')
  })

  test('applying without changing selection commits the recommended plan', async () => {
    await renderReady()
    await buildPlan()
    applyPlan()
    await waitFor(() => expect(screen.getByLabelText('התוכנית הנוכחית')).toBeInTheDocument())
    expect(committedText()).toContain('קורס Y')
    expect(server.calls[0].candidate_id).toBe('cand_a')
  })

  test('Apply is possible exactly once — the control is gone afterwards', async () => {
    await renderReady()
    await buildPlan()
    applyPlan()
    await waitFor(() => expect(screen.getByLabelText('התוכנית הנוכחית')).toBeInTheDocument())
    expect(screen.queryByRole('button', { name: 'החל תוכנית' })).toBeNull()
  })

  test('a Rebuild REPLACES the set and resets the selection to the recommendation', async () => {
    await renderReady()
    await buildPlan()
    fireEvent.click(screen.getAllByRole('radio')[1])
    await waitFor(() => expect(screen.getByLabelText('טיוטת תוכנית')).toHaveTextContent('קורס Z'))

    fireEvent.click(screen.getByRole('button', { name: /בנה|בניית|בנייה/ }))
    await waitFor(() => expect(screen.getByLabelText('טיוטת תוכנית')).toHaveTextContent('קורס Y'))
    expect(screen.getAllByRole('radio')[0]).toHaveAttribute('aria-checked', 'true')
  })

  test('with fewer than two alternatives no comparison is shown', async () => {
    await renderReady({
      generateFn: async (req: GeneratePlanRequest) => ({ ...proposal(req), alternatives: [A] }),
    })
    fireEvent.click(screen.getByRole('button', { name: /בנה|בניית|בנייה/ }))
    await waitFor(() => expect(screen.getByLabelText('טיוטת תוכנית')).toBeInTheDocument())
    expect(screen.queryByRole('radiogroup', { name: 'בחירת חלופת תוכנית' })).toBeNull()
  })
})

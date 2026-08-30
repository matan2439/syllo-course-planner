/**
 * C5/P3 — the priority clarification, end to end in the real journey.
 *
 * The question is asked through the SAME machinery every other question uses:
 * `DeterministicPreferenceElicitation` selects it, `ConversationState` records
 * the answer, and the answer lands in the typed `PreferenceProfile`. There is
 * deliberately no comparison-card questionnaire and no UI-only priority state —
 * if there were, the answer could not survive a Rebuild, which is the entire
 * point of asking.
 *
 * The interaction contract under test: answering updates DRAFT state only, never
 * Generates, advances the profile version, stales the WHOLE alternative set,
 * disables every Apply, and requires an explicit Rebuild.
 */
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react'
import NativePlannerJourney from './NativePlannerJourney'
import { boardResponseToModel } from '../../../shared/planner/adapters'
import type { GeneratePlanRequest } from '../../../shared/planner/api-client'
import type { GeneratedPlanModel } from '../../../shared/planner/model'
import { createServerApplyStub } from './serverApplyStub'

const BOARD = {
  metadata: {
    board_data_version: 'rev-1',
    program_repository_courses: [
      { course_id: 'E2', name_he: 'קורס פרויקט', weekly_hours: 4, is_mandatory: false },
      { course_id: 'E3', name_he: 'קורס רובוטיקה', weekly_hours: 4, is_mandatory: false },
    ],
  },
  semesters: [
    { semester_id: 'year_3_semester_a', courses: [{ course_id: 'X-1', name_he: 'קורס בסיס X', weekly_hours: 3.0, course_type: 'mandatory', is_mandatory: true }] },
    { semester_id: 'year_3_semester_b', courses: [] },
  ],
}
const board = () => boardResponseToModel(BOARD)

const PROJECT_LEADER = 'cand_project'
const TOPIC_LEADER = 'cand_topic'

/** The server's contract: naming the topic would move the recommendation. */
const PRIORITY_IMPACT: NonNullable<GeneratedPlanModel['priorityQuestionImpact']> = {
  category: 'objective_priority',
  impactedObjectiveIds: ['prefer_project_courses', 'prefer_topic_alignment'],
  objectiveLabels: {
    prefer_project_courses: 'קורסים מבוססי פרויקט',
    prefer_topic_alignment: 'תחום התוכן: רובוטיקה',
  },
  currentRecommendedCandidateId: PROJECT_LEADER,
  options: [
    { value: 'prefer_project_courses', labelHe: 'קורסים מבוססי פרויקט', recommendedCandidateId: PROJECT_LEADER },
    { value: 'prefer_topic_alignment', labelHe: 'תחום התוכן: רובוטיקה', recommendedCandidateId: TOPIC_LEADER },
    { value: 'equal_importance', labelHe: 'שניהם חשובים לי באותה מידה', recommendedCandidateId: PROJECT_LEADER },
  ],
  changesRecommendation: true,
  alreadyAnswered: false,
  eligible: true,
  profileVersion: 1,
  snapshotId: 'snap_test',
  tradeoffExplanationHe: 'כל החלופות עומדות באותן דרישות ומגבלות, אבל אין ביניהן אחת שמצטיינת גם בקורסים מבוססי פרויקט וגם בתחום התוכן: רובוטיקה.',
  equalImportanceLabelHe: 'שניהם חשובים לי באותה מידה',
}

const alternative = (
  candidateId: string,
  courseId: string,
  labelHe: string,
  recommended: boolean,
): NonNullable<GeneratedPlanModel['alternatives']>[number] => ({
  candidateId,
  normalizedIdentity: `identity_${candidateId}`,
  recommended,
  applyable: true,
  semesters: [
    { semesterId: 'year_3_semester_a', courseIds: ['X-1'] },
    { semesterId: 'year_3_semester_b', courseIds: [courseId] },
  ],
  constraintFingerprint: 'cf_test',
  profileVersion: 1,
  snapshotId: 'snap_test',
  nonDominated: true,
  composedUtility: 0.25,
  objectiveScores: [
    { objectiveId: 'prefer_project_courses', normalized: courseId === 'E2' ? 0.5 : 0 },
    { objectiveId: 'prefer_topic_alignment', normalized: courseId === 'E3' ? 0.5 : 0 },
  ],
  labelHe,
  differencesHe: [],
  workload: { peakHours: 4, totalHours: 7, activePeriods: 2 },
})

/** The recommendation the server would return for a given priority answer. */
function proposalFor(req: GeneratePlanRequest, opts: { impact?: boolean } = {}): GeneratedPlanModel {
  const profile = (req as unknown as {
    preference_profile?: { version: number; preferences: Array<{ id: string; normalized: string }> }
  }).preference_profile
  const priority = profile?.preferences.find((p) => p.id === 'objective_priority')?.normalized
  const recommendedId = priority === 'prefer_topic_alignment' ? TOPIC_LEADER : PROJECT_LEADER
  const alternatives = [
    alternative(PROJECT_LEADER, 'E2', 'יותר קורסים פרויקטליים', recommendedId === PROJECT_LEADER),
    alternative(TOPIC_LEADER, 'E3', 'יותר קורסים בתחום רובוטיקה', recommendedId === TOPIC_LEADER),
  ]
  const recommended = alternatives.find((a) => a.recommended)!
  return {
    proposal: {
      proposalId: PROPOSAL_ID,
      candidateIds: alternatives.map((a) => a.candidateId),
      recommendedCandidateId: recommended.candidateId,
      baseBoardVersion: null,
      profileVersion: profile?.version ?? 0,
      academicStatusDigest: 'as_test',
      expiresAt: Date.now() + 3_600_000,
    },
    semesters: recommended.semesters,
    moves: [],
    warningsHe: [], errors: [], blocked: false,
    agentOutcome: 'proposal', applyEligible: true,
    profileVersion: profile?.version,
    alternatives,
    ...(opts.impact === false
      ? {}
      : {
          priorityQuestionImpact: {
            ...PRIORITY_IMPACT,
            profileVersion: profile?.version ?? 1,
            currentRecommendedCandidateId: recommendedId,
            // Once answered the server closes the question — the UI must not
            // re-open it from the option list alone.
            alreadyAnswered: !!priority,
            eligible: !priority,
          },
        }),
  }
}

const PRIORITY_QUESTION = /יש ביניהן פשרה\. מה חשוב לך יותר לצורך ההמלצה/
const TOPIC_OPTION = 'תחום התוכן: רובוטיקה'
const EQUAL_OPTION = 'שניהם חשובים לי באותה מידה'

const PROPOSAL_ID = 'prop_priority'
let server: ReturnType<typeof createServerApplyStub>

async function renderReady(generateFn?: unknown) {
  server = createServerApplyStub({
    proposalId: PROPOSAL_ID,
    candidates: [
      { candidateId: PROJECT_LEADER, semesters: alternative(PROJECT_LEADER, 'E2', '', false).semesters },
      { candidateId: TOPIC_LEADER, semesters: alternative(TOPIC_LEADER, 'E3', '', false).semesters },
    ],
  })
  render(
    <NativePlannerJourney
      programId="mechanical_engineering_2027"
      getBoardFn={async () => board()}
      generateFn={(generateFn as never) ?? (async (req: GeneratePlanRequest) => proposalFor(req))}
      applyFn={server.applyFn}
      committedBoardFn={server.committedBoardFn}
      planningContextFn={async () => null}
      useAcademicDecisionAgent
    />,
  )
  await waitFor(() => expect(screen.getByText('קורס בסיס X')).toBeInTheDocument())
}

/** Clear the higher-impact catalog questions so priority is next in line. */
function answerHigherImpactQuestions() {
  fireEvent.click(screen.getByRole('button', { name: 'שבוע קל יותר' }))
  fireEvent.click(screen.getByRole('button', { name: 'עומס מאוזן' }))
  fireEvent.click(screen.getByRole('button', { name: 'עדיף להימנע מבוקר' }))
}

const buildButton = () =>
  screen.getByRole('button', { name: /^(בנה תוכנית|בנה מחדש)$/ })
async function build() {
  fireEvent.click(buildButton())
  await waitFor(() => expect(screen.getByRole('radiogroup', { name: 'בחירת חלופת תוכנית' })).toBeInTheDocument())
}

const radios = () => screen.getAllByRole('radio')
const applyButton = () => screen.getByRole('button', { name: 'החל תוכנית' })

describe('C5/P3 — the question is asked only when the server says it decides something', () => {
  test('before any Build there is no priority question', async () => {
    await renderReady()
    answerHigherImpactQuestions()
    expect(screen.queryByText(PRIORITY_QUESTION)).not.toBeInTheDocument()
  })

  test('after a Build reporting an eligible trade-off, exactly ONE question appears with real objective names', async () => {
    await renderReady()
    answerHigherImpactQuestions()
    await build()

    await waitFor(() => expect(screen.getByText(PRIORITY_QUESTION)).toBeInTheDocument())
    expect(screen.getAllByText(PRIORITY_QUESTION)).toHaveLength(1)

    // Exactly the server's options — no internal ids, no invented extras.
    expect(screen.getByRole('button', { name: 'קורסים מבוססי פרויקט' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: TOPIC_OPTION })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: EQUAL_OPTION })).toBeInTheDocument()
    // The generic "doesn't matter" answer is NOT offered alongside equal
    // importance: they would be one product state under two labels.
    expect(screen.queryByRole('button', { name: 'לא משנה לי' })).not.toBeInTheDocument()
    // No internal objective id is ever rendered.
    expect(document.body.textContent).not.toMatch(/prefer_project_courses|prefer_topic_alignment|equal_importance/)
  })

  test('a Build reporting NO impact leaves the question unasked', async () => {
    await renderReady(async (req: GeneratePlanRequest) => proposalFor(req, { impact: false }))
    answerHigherImpactQuestions()
    await build()
    expect(screen.queryByText(PRIORITY_QUESTION)).not.toBeInTheDocument()
  })

  test('the alternatives stay visible and selectable while the question is unanswered', async () => {
    await renderReady()
    answerHigherImpactQuestions()
    await build()
    await waitFor(() => expect(screen.getByText(PRIORITY_QUESTION)).toBeInTheDocument())

    expect(radios()).toHaveLength(2)
    for (const r of radios()) expect(r).not.toBeDisabled()
    expect(applyButton()).not.toBeDisabled()
  })

  test('selecting an alternative does NOT answer the priority question', async () => {
    await renderReady()
    answerHigherImpactQuestions()
    await build()
    await waitFor(() => expect(screen.getByText(PRIORITY_QUESTION)).toBeInTheDocument())

    fireEvent.click(radios()[1])
    // The card is a plan choice, not a statement of what the student values.
    expect(screen.getByText(PRIORITY_QUESTION)).toBeInTheDocument()
    expect(screen.queryByText('מה הבנתי ממך')).toBeInTheDocument()
    expect(screen.queryByText(TOPIC_OPTION, { selector: 'span' })).not.toBeInTheDocument()
  })

  test('an unanswered priority does not block applying a current valid alternative', async () => {
    await renderReady()
    answerHigherImpactQuestions()
    await build()
    await waitFor(() => expect(screen.getByText(PRIORITY_QUESTION)).toBeInTheDocument())

    fireEvent.click(radios()[1])
    expect(applyButton()).not.toBeDisabled()
    fireEvent.click(applyButton())
    // The board became the applied plan — the E3 alternative, not the default.
    await waitFor(() => expect(screen.getByRole('region', { name: 'התוכנית הנוכחית' })).toBeInTheDocument())
    const committed = screen.getByRole('region', { name: 'התוכנית הנוכחית' })
    expect(within(committed).getByText('קורס רובוטיקה')).toBeInTheDocument()
    expect(within(committed).queryByText('קורס פרויקט')).not.toBeInTheDocument()
  })
})

describe('C5/P3 — answering updates draft state only, and stales everything', () => {
  test('answering does NOT Generate, advances the version, and stales the whole set', async () => {
    const generateFn = jest.fn(async (req: GeneratePlanRequest) => proposalFor(req))
    await renderReady(generateFn)
    answerHigherImpactQuestions()
    await build()
    expect(generateFn).toHaveBeenCalledTimes(1)
    await waitFor(() => expect(screen.getByRole('button', { name: TOPIC_OPTION })).toBeInTheDocument())

    fireEvent.click(screen.getByRole('button', { name: TOPIC_OPTION }))

    // No Generate. This is the whole "answering is not building" contract.
    expect(generateFn).toHaveBeenCalledTimes(1)

    // The ENTIRE alternative set is stale: every card inert, every Apply off.
    await waitFor(() => expect(radios()[0]).toBeDisabled())
    for (const r of radios()) expect(r).toBeDisabled()
    expect(applyButton()).toBeDisabled()
    // Both surfaces say WHY, each in its own words: the card group explains why
    // choosing is unavailable, the proposal note why Apply is.
    expect(screen.getByText(/ההעדפות שלך השתנו מאז הבנייה — צריך לבנות מחדש כדי לבחור חלופה/)).toBeInTheDocument()
    expect(screen.getByRole('note')).toHaveTextContent(/ההעדפות שלך השתנו מאז הבנייה — יש לבנות מחדש לפני החלה/)
  })

  test('switching stale cards cannot restore Apply', async () => {
    await renderReady()
    answerHigherImpactQuestions()
    await build()
    await waitFor(() => expect(screen.getByRole('button', { name: TOPIC_OPTION })).toBeInTheDocument())
    fireEvent.click(screen.getByRole('button', { name: TOPIC_OPTION }))
    await waitFor(() => expect(radios()[0]).toBeDisabled())

    for (const r of radios()) {
      fireEvent.click(r)
      expect(applyButton()).toBeDisabled()
    }
  })

  test('the committed board is untouched until an explicit Rebuild and Apply', async () => {
    await renderReady()
    answerHigherImpactQuestions()
    await build()
    await waitFor(() => expect(screen.getByRole('button', { name: TOPIC_OPTION })).toBeInTheDocument())
    fireEvent.click(screen.getByRole('button', { name: TOPIC_OPTION }))

    // The base course is still the only committed content; nothing was applied.
    await waitFor(() => expect(applyButton()).toBeDisabled())
    fireEvent.click(screen.getByRole('button', { name: 'דחה' }))
    expect(screen.getByText('קורס בסיס X')).toBeInTheDocument()
    expect(screen.queryByText('קורס רובוטיקה')).not.toBeInTheDocument()
  })

  test('the captured answer is shown by its NAME, never its internal id', async () => {
    await renderReady()
    answerHigherImpactQuestions()
    await build()
    await waitFor(() => expect(screen.getByRole('button', { name: TOPIC_OPTION })).toBeInTheDocument())
    fireEvent.click(screen.getByRole('button', { name: TOPIC_OPTION }))

    const summary = screen.getByRole('region', { name: 'מה הבנתי ממך' })
    expect(within(summary).getByText(TOPIC_OPTION)).toBeInTheDocument()
    expect(summary.textContent).not.toMatch(/prefer_topic_alignment/)
  })
})

describe('C5/P3 — the explicit Rebuild carries everything and changes the recommendation', () => {
  test('Rebuild sends every confirmed preference plus the priority, at the current version', async () => {
    const sent: GeneratePlanRequest[] = []
    const generateFn = jest.fn(async (req: GeneratePlanRequest) => { sent.push(req); return proposalFor(req) })
    await renderReady(generateFn)
    answerHigherImpactQuestions()
    await build()
    await waitFor(() => expect(screen.getByRole('button', { name: TOPIC_OPTION })).toBeInTheDocument())
    fireEvent.click(screen.getByRole('button', { name: TOPIC_OPTION }))

    fireEvent.click(buildButton())
    await waitFor(() => expect(generateFn).toHaveBeenCalledTimes(2))

    const profile = (sent[1] as unknown as {
      preference_profile: { version: number; preferences: Array<{ id: string; normalized: string; affects: string }> }
    }).preference_profile
    const ids = profile.preferences.map((p) => p.id)
    // Nothing the student said earlier was dropped to make room for the priority.
    expect(ids).toEqual(expect.arrayContaining(['workload_target', 'semester_balance', 'time_of_day', 'objective_priority']))
    const priority = profile.preferences.find((p) => p.id === 'objective_priority')!
    expect(priority.normalized).toBe('prefer_topic_alignment')
    expect(priority.affects).toBe('grounded_objective_priority')
    // And the version advanced past the one the stale proposal was built from.
    const firstVersion = (sent[0] as unknown as { preference_profile: { version: number } }).preference_profile.version
    expect(profile.version).toBeGreaterThan(firstVersion)
  })

  test('after Rebuild the recommendation is the predicted candidate and Apply works again', async () => {
    await renderReady()
    answerHigherImpactQuestions()
    await build()
    await waitFor(() => expect(screen.getByRole('button', { name: TOPIC_OPTION })).toBeInTheDocument())
    fireEvent.click(screen.getByRole('button', { name: TOPIC_OPTION }))

    fireEvent.click(buildButton())
    await waitFor(() => expect(applyButton()).not.toBeDisabled())

    // The contract predicted TOPIC_LEADER; the rendered default must be it.
    const group = screen.getByRole('radiogroup', { name: 'בחירת חלופת תוכנית' })
    const recommended = within(group).getAllByRole('radio').find((r) => r.textContent?.includes('ברירת המחדל שלנו'))!
    expect(recommended.textContent).toContain('יותר קורסים בתחום רובוטיקה')
    expect(recommended).toHaveAttribute('aria-checked', 'true')

    // …and the draft on the board is that same plan, not the old default.
    const draft = screen.getByRole('list', { name: 'טיוטה — סמסטרים' })
    expect(within(draft).getByText('קורס רובוטיקה')).toBeInTheDocument()
    expect(within(draft).queryByText('קורס פרויקט')).not.toBeInTheDocument()
  })

  test('the question is NOT asked twice after it has been answered', async () => {
    await renderReady()
    answerHigherImpactQuestions()
    await build()
    await waitFor(() => expect(screen.getByRole('button', { name: TOPIC_OPTION })).toBeInTheDocument())
    fireEvent.click(screen.getByRole('button', { name: TOPIC_OPTION }))
    fireEvent.click(buildButton())

    await waitFor(() => expect(applyButton()).not.toBeDisabled())
    expect(screen.queryByText(PRIORITY_QUESTION)).not.toBeInTheDocument()
  })
})

describe('C5/P3 — accessibility of the decision', () => {
  test('the options are real buttons in a labelled group, reachable and focusable', async () => {
    await renderReady()
    answerHigherImpactQuestions()
    await build()
    await waitFor(() => expect(screen.getByText(PRIORITY_QUESTION)).toBeInTheDocument())

    const group = screen.getByRole('group', { name: /שאלה: החלופות מתאימות לכל הדרישות/ })
    const option = within(group).getByRole('button', { name: TOPIC_OPTION })
    option.focus()
    expect(document.activeElement).toBe(option)
    // Keyboard activation is the browser's own for a real <button>.
    expect(option.tagName).toBe('BUTTON')
    // A visible focus ring is declared rather than suppressed.
    expect(option.className).toContain('focus-visible:outline')
  })

  test('the stale set is announced in a live region, not signalled by colour alone', async () => {
    await renderReady()
    answerHigherImpactQuestions()
    await build()
    await waitFor(() => expect(screen.getByRole('button', { name: TOPIC_OPTION })).toBeInTheDocument())
    fireEvent.click(screen.getByRole('button', { name: TOPIC_OPTION }))

    await waitFor(() => {
      const live = screen.getByText(/החלופות אינן זמינות לבחירה/)
      expect(live).toHaveAttribute('aria-live', 'polite')
    })
    // The reason is also visible as text for sighted users.
    expect(screen.getByText(/ההעדפות שלך השתנו מאז הבנייה — צריך לבנות מחדש/)).toBeInTheDocument()
  })

  test('the conversation renders RTL', async () => {
    await renderReady()
    answerHigherImpactQuestions()
    await build()
    await waitFor(() => expect(screen.getByText(PRIORITY_QUESTION)).toBeInTheDocument())
    expect(screen.getByText(PRIORITY_QUESTION).closest('[dir="rtl"]')).not.toBeNull()
  })
})

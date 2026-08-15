/**
 * W2 — the last link: the journey hands the SERVER's topic probe to the real
 * conversation, and the question appears only after a Build that reported it.
 *
 * This is the wiring the earlier session deliberately left undone. The browser
 * must not recompute candidate differences, so the only thing under test here
 * is that the signal travels and gates correctly.
 */
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import NativePlannerJourney from './NativePlannerJourney'
import { boardResponseToModel } from '../../../shared/planner/adapters'
import type { GeneratePlanRequest } from '../../../shared/planner/api-client'
import type { GeneratedPlanModel } from '../../../shared/planner/model'

const BOARD = {
  metadata: {
    board_data_version: 'rev-1',
    program_repository_courses: [{ course_id: 'Y-1', name_he: 'קורס Y', weekly_hours: 3.5, is_mandatory: false }],
  },
  semesters: [
    { semester_id: 'year_3_semester_a', courses: [{ course_id: 'X-1', name_he: 'קורס בסיס X', weekly_hours: 3.0, course_type: 'mandatory', is_mandatory: true }] },
    { semester_id: 'year_3_semester_b', courses: [] },
  ],
}
const board = () => boardResponseToModel(BOARD)

const TOPIC_IMPACT: NonNullable<GeneratedPlanModel['topicQuestionImpact']> = {
  category: 'course_topic_interest',
  distinguishesCandidates: true,
  distinguishingTopics: ['robotics', 'control'],
  topicLabels: { robotics: 'רובוטיקה', control: 'בקרה ומערכות' },
  coverageSufficient: true,
  hasConflicts: false,
  unknownTopicCourseCount: 0,
  snapshotId: 'snap_test',
  profileVersion: 1,
}

function proposal(req: GeneratePlanRequest, impact?: GeneratedPlanModel['topicQuestionImpact']): GeneratedPlanModel {
  const version = (req as unknown as { preference_profile?: { version: number } }).preference_profile?.version
  return {
    semesters: [
      { semesterId: 'year_3_semester_a', courseIds: ['X-1', 'Y-1'] },
      { semesterId: 'year_3_semester_b', courseIds: [] },
    ],
    moves: [{ courseId: 'Y-1', from: null, to: 'year_3_semester_a' }],
    warningsHe: [], errors: [], blocked: false,
    agentOutcome: 'proposal', applyEligible: true, profileVersion: version,
    ...(impact ? { topicQuestionImpact: impact } : {}),
  }
}

const TOPIC_QUESTION = /יש תחום תוכן שמעניין אותך במיוחד/

async function renderReady(over: Partial<{ generateFn: unknown; useAcademicDecisionAgent: boolean }> = {}) {
  render(
    <NativePlannerJourney
      programId="mechanical_engineering_2027"
      getBoardFn={async () => board()}
      generateFn={(over.generateFn as never) ?? (async (req: GeneratePlanRequest) => proposal(req, TOPIC_IMPACT))}
      useAcademicDecisionAgent={over.useAcademicDecisionAgent ?? true}
    />,
  )
  await waitFor(() => expect(screen.getByText('קורס בסיס X')).toBeInTheDocument())
}

/** Answer the higher-impact topics so the topic question is next in line. */
function answerHigherImpactTopics() {
  fireEvent.click(screen.getByRole('button', { name: 'שבוע קל יותר' }))
  fireEvent.click(screen.getByRole('button', { name: 'עומס מאוזן' }))
  fireEvent.click(screen.getByRole('button', { name: 'עדיף להימנע מבוקר' }))
}

async function build() {
  fireEvent.click(screen.getByRole('button', { name: /בנה|בניית|בנייה/ }))
  await waitFor(() => expect(screen.getByText('קורס Y')).toBeInTheDocument())
}

describe('W2 — the journey delivers the server topic probe to the conversation', () => {
  test('before any Build the topic question is not asked', async () => {
    await renderReady()
    answerHigherImpactTopics()
    expect(screen.queryByText(TOPIC_QUESTION)).not.toBeInTheDocument()
  })

  test('after a Build that reports impact, the question appears with the server labels', async () => {
    await renderReady()
    answerHigherImpactTopics()
    await build()
    // The impact arrives with the proposal, so the conversation re-selects in a
    // follow-up effect — await it rather than asserting mid-flush.
    await waitFor(() => expect(screen.getByText(TOPIC_QUESTION)).toBeInTheDocument())
    expect(screen.getByRole('button', { name: 'רובוטיקה' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'בקרה ומערכות' })).toBeInTheDocument()
  })

  test('a Build that reports NO impact leaves the question unasked', async () => {
    await renderReady({ generateFn: async (req: GeneratePlanRequest) => proposal(req) })
    answerHigherImpactTopics()
    await build()
    expect(screen.queryByText(TOPIC_QUESTION)).not.toBeInTheDocument()
  })

  test('answering the topic does NOT Generate again', async () => {
    const generateFn = jest.fn(async (req: GeneratePlanRequest) => proposal(req, TOPIC_IMPACT))
    await renderReady({ generateFn })
    answerHigherImpactTopics()
    await build()
    expect(generateFn).toHaveBeenCalledTimes(1)

    await waitFor(() => expect(screen.getByRole('button', { name: 'רובוטיקה' })).toBeInTheDocument())
    fireEvent.click(screen.getByRole('button', { name: 'רובוטיקה' }))
    expect(generateFn).toHaveBeenCalledTimes(1)
  })

  test('the explicit Rebuild sends the normalized topic and the advanced version', async () => {
    const sent: GeneratePlanRequest[] = []
    const generateFn = jest.fn(async (req: GeneratePlanRequest) => { sent.push(req); return proposal(req, TOPIC_IMPACT) })
    await renderReady({ generateFn })
    answerHigherImpactTopics()
    await build()
    const versionBefore = (sent[0] as unknown as { preference_profile: { version: number } }).preference_profile.version

    await waitFor(() => expect(screen.getByRole('button', { name: 'רובוטיקה' })).toBeInTheDocument())
    fireEvent.click(screen.getByRole('button', { name: 'רובוטיקה' }))
    fireEvent.click(screen.getByRole('button', { name: /בנה|בניית|בנייה/ }))
    await waitFor(() => expect(generateFn).toHaveBeenCalledTimes(2))

    const profile = (sent[1] as unknown as { preference_profile: { version: number; preferences: Array<Record<string, unknown>> } }).preference_profile
    expect(profile.version).toBeGreaterThan(versionBefore)
    const topic = profile.preferences.find((p) => p.id === 'course_topic_interest')!
    expect(topic.normalized).toBe('robotics')
    expect(topic.affects).toBe('grounded_topic_interest')
  })

  test('FLAG-OFF: no conversation, so no topic question can appear', async () => {
    await renderReady({ useAcademicDecisionAgent: false })
    expect(screen.queryByText(TOPIC_QUESTION)).not.toBeInTheDocument()
  })
})

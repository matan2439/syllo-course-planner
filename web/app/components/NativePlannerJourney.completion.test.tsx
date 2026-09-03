/**
 * Completed-course academic status in the live journey — the native replacement
 * for the legacy "הקורסים שלי" modal.
 *
 * Locks the semantics that made a valid flagged Apply unreachable:
 *   - an empty completed list is UNKNOWN until the student confirms, so the
 *     request carries no knowledge marker and the critical gap is retained;
 *   - an explicit "I completed none" IS an answer (marker sent, list empty);
 *   - reported courses (standard + electives) are sent exactly, de-duplicated;
 *   - completed ids NEVER come from the completed-hours field;
 *   - editing status never Generates, and stales an existing proposal.
 */
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react'
import NativePlannerJourney from './NativePlannerJourney'
import { boardResponseToModel } from '../../../shared/planner/adapters'
import type { GeneratePlanRequest } from '../../../shared/planner/api-client'
import type { GeneratedPlanModel } from '../../../shared/planner/model'

const BOARD = {
  metadata: {
    board_data_version: 'rev-1',
    program_repository_courses: [
      { course_id: 'ELEC-1', name_he: 'בחירה מוקדמת', weekly_hours: 3.0, is_mandatory: false },
    ],
  },
  semesters: [
    { semester_id: 'year_3_semester_a', courses: [{ course_id: 'X-1', name_he: 'קורס בסיס X', weekly_hours: 3.0, course_type: 'mandatory', is_mandatory: true }] },
    { semester_id: 'year_3_semester_b', courses: [] },
  ],
}
const board = () => boardResponseToModel(BOARD)

/** Echoes the request's profile version, as the real server does. */
function proposal(req: GeneratePlanRequest): GeneratedPlanModel {
  return {
    semesters: [
      { semesterId: 'year_3_semester_a', courseIds: ['X-1'] },
      { semesterId: 'year_3_semester_b', courseIds: [] },
    ],
    moves: [], warningsHe: [], errors: [], blocked: false,
    agentOutcome: 'proposal', applyEligible: true,
    profileVersion: (req as any).preference_profile?.version,
  }
}

async function setup(useAgent = true) {
  const sent: GeneratePlanRequest[] = []
  render(
    <NativePlannerJourney
      programId="mechanical_engineering_2027"
      getBoardFn={async () => board()}
      generateFn={async (req) => { sent.push(req); return proposal(req) }}
      committedBoardFn={async () => null}
      planningContextFn={async () => null}
      useAcademicDecisionAgent={useAgent}
    />,
  )
  await waitFor(() => expect(screen.getByText('קורס בסיס X')).toBeInTheDocument())
  return { sent }
}

test('refresh hydrates server-owned completed courses before the next explicit Build', async () => {
  const sent: GeneratePlanRequest[] = []
  let release!: (value: any) => void
  const stored = new Promise<any>((resolve) => { release = resolve })
  render(
    <NativePlannerJourney
      programId="mechanical_engineering_2027"
      getBoardFn={async () => board()}
      generateFn={async (req) => { sent.push(req); return proposal(req) }}
      useAcademicDecisionAgent
      committedBoardFn={async () => null}
      planningContextFn={async () => stored}
    />,
  )
  const buildButton = await screen.findByRole('button', { name: 'בנה תוכנית' })
  expect(buildButton).toBeDisabled()
  fireEvent.click(buildButton)
  expect(sent).toHaveLength(0)
  release({
        academicStatusDigest: 'as_0123456789abcdef',
        personalStatus: {
          completed: [{ course_id: '0509-1510' }, { course_id: 'ELEC-1' }],
          currently_taking: [],
          completed_knowledge: { status: 'known', provenance: 'explicit_user' },
        },
        preferences: {},
      })
  await waitFor(() => expect(screen.getByText(/אושר בטיוטה: 2 קורסים שהושלמו/)).toBeInTheDocument())
  expect(buildButton).toBeEnabled()
  build()
  await waitFor(() => expect(sent).toHaveLength(1))
  expect(personalStatus(sent[0]).completed).toEqual([
    { course_id: '0509-1510' },
    { course_id: 'ELEC-1' },
  ])
  expect(personalStatus(sent[0]).completed_knowledge).toEqual({
    status: 'known', provenance: 'explicit_user',
  })
})

const openPanel = () => {
  const panel = screen.getByRole('button', { name: 'פתח' })
  fireEvent.click(panel)
}
const build = () => fireEvent.click(screen.getAllByRole('button', { name: /בנה תוכנית|בנה מחדש/ })[0])
const personalStatus = (req: GeneratePlanRequest) => (req.plan_context as any).personal_status

describe('completed-course academic status (flag on)', () => {
  test('labels confirmation as a local draft until Build persists it', async () => {
    await setup()
    openPanel()

    expect(screen.getByRole('button', { name: 'אשר את הסטטוס' })).toBeInTheDocument()
    expect(screen.getByText(/האישור נשמר בטיוטה המקומית/)).toBeInTheDocument()
  })

  test('flag OFF: no completed-course panel, and the payload keeps the legacy shape', async () => {
    const { sent } = await setup(false)
    expect(screen.queryByText('קורסים שכבר השלמתי')).toBeNull()
    build()
    await waitFor(() => expect(sent).toHaveLength(1))
    expect(personalStatus(sent[0])).toEqual({ completed: [], currently_taking: [], planned: [] })
    expect(personalStatus(sent[0]).completed_knowledge).toBeUndefined()
  })

  test('the panel is offered and lists the program\'s standard early-year courses', async () => {
    await setup()
    expect(screen.getByText('קורסים שכבר השלמתי')).toBeInTheDocument()
    openPanel()
    expect(screen.getByText(/גרפיקה הנדסית/)).toBeInTheDocument() // Year 1 semester A
    expect(screen.getByText(/מכניקת הזורמים/)).toBeInTheDocument() // Year 2 semester B
  })

  test('UNKNOWN until confirmed: an untouched panel sends NO knowledge marker', async () => {
    const { sent } = await setup()
    build()
    await waitFor(() => expect(sent).toHaveLength(1))
    expect(personalStatus(sent[0]).completed).toEqual([])
    expect(personalStatus(sent[0]).completed_knowledge).toBeUndefined() // still unknown
  })

  test('explicit "I completed none" is a real answer: marker sent with an empty list', async () => {
    const { sent } = await setup()
    openPanel()
    fireEvent.click(screen.getByRole('button', { name: 'לא השלמתי אף אחד מהקורסים ברשימה' }))
    fireEvent.click(screen.getByRole('button', { name: 'אשר את הסטטוס' }))
    build()
    await waitFor(() => expect(sent).toHaveLength(1))
    expect(personalStatus(sent[0]).completed).toEqual([])
    expect(personalStatus(sent[0]).completed_knowledge).toEqual({ status: 'known', provenance: 'explicit_user' })
  })

  test('reported completed courses are sent exactly, with explicit-user provenance', async () => {
    const { sent } = await setup()
    openPanel()
    const row = screen.getByRole('group', { name: /גרפיקה הנדסית/ })
    fireEvent.click(within(row).getByRole('button', { name: 'השלמתי' }))
    fireEvent.click(screen.getByRole('button', { name: 'אשר את הסטטוס' }))
    build()
    await waitFor(() => expect(sent).toHaveLength(1))
    expect(personalStatus(sent[0]).completed).toEqual([{ course_id: '0509-1510' }])
    expect(personalStatus(sent[0]).completed_knowledge.provenance).toBe('explicit_user')
  })

  test('identified early-year completion carries its authoritative hours into degree progress', async () => {
    const { sent } = await setup()
    openPanel()
    const row = screen.getByRole('group', { name: /גרפיקה הנדסית/ })
    fireEvent.click(within(row).getByRole('button', { name: 'השלמתי' }))
    fireEvent.click(screen.getByRole('button', { name: 'אשר את הסטטוס' }))
    build()
    await waitFor(() => expect(sent).toHaveLength(1))
    expect((sent[0].plan_context as any).total_hours_progress).toEqual({
      known_completed_hours: 4,
    })
  })

  test('completed ids never come from the completed-HOURS field', async () => {
    const { sent } = await setup()
    // Enter a large prior-hours total but report no courses at all.
    fireEvent.change(screen.getByRole('textbox', { name: 'שעות שהושלמו' }), { target: { value: '92' } })
    build()
    await waitFor(() => expect(sent).toHaveLength(1))
    expect(personalStatus(sent[0]).completed).toEqual([]) // hours produced no identities
    expect((sent[0].plan_context as any).total_hours_progress.known_completed_hours).toBe(92)
  })

  test('a completed ELECTIVE from the catalog is reported (legacy modal covered mandatory only)', async () => {
    const { sent } = await setup()
    openPanel()
    fireEvent.change(screen.getByRole('textbox', { name: /קורסי בחירה שכבר השלמתי/ }), { target: { value: 'בחירה מוקדמת' } })
    fireEvent.click(await screen.findByRole('button', { name: /בחירה מוקדמת/ }))
    fireEvent.click(screen.getByRole('button', { name: 'אשר את הסטטוס' }))
    build()
    await waitFor(() => expect(sent).toHaveLength(1))
    expect(personalStatus(sent[0]).completed).toEqual([{ course_id: 'ELEC-1' }])
  })

  test('editing completion status never Generates', async () => {
    const { sent } = await setup()
    openPanel()
    const row = screen.getByRole('group', { name: /גרפיקה הנדסית/ })
    fireEvent.click(within(row).getByRole('button', { name: 'השלמתי' }))
    fireEvent.click(within(row).getByRole('button', { name: 'לא השלמתי' }))
    fireEvent.click(screen.getByRole('button', { name: 'לא השלמתי אף אחד מהקורסים ברשימה' }))
    fireEvent.click(screen.getByRole('button', { name: 'אשר את הסטטוס' }))
    expect(sent).toHaveLength(0) // only Build generates
  })

  test('changing completion AFTER a Build stales the proposal — Apply is blocked', async () => {
    const { sent } = await setup()
    openPanel()
    fireEvent.click(screen.getByRole('button', { name: 'לא השלמתי אף אחד מהקורסים ברשימה' }))
    fireEvent.click(screen.getByRole('button', { name: 'אשר את הסטטוס' }))
    build()
    await waitFor(() => expect(sent).toHaveLength(1))
    await waitFor(() => expect(screen.getByRole('button', { name: 'החל תוכנית' })).toBeEnabled())
    // report a completed course after the proposal was generated
    const row = screen.getByRole('group', { name: /גרפיקה הנדסית/ })
    fireEvent.click(within(row).getByRole('button', { name: 'השלמתי' }))
    expect(screen.getByRole('button', { name: 'החל תוכנית' })).toBeDisabled()
    expect(sent).toHaveLength(1) // and it did NOT regenerate
  })

  test('exclusions: untouched stays unknown; an explicit "none" sends an empty list', async () => {
    const { sent } = await setup()
    build()
    await waitFor(() => expect(sent).toHaveLength(1))
    expect((sent[0].preferences as any).disallowed_course_ids).toBeUndefined() // unknown
    fireEvent.click(screen.getByRole('button', { name: 'אין קורסים שאני רוצה להימנע מהם' }))
    build()
    await waitFor(() => expect(sent).toHaveLength(2))
    expect((sent[1].preferences as any).disallowed_course_ids).toEqual([]) // explicit none
  })
})

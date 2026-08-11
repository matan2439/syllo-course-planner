/**
 * MVP vertical slice — the full native planner journey composed over the
 * EXISTING shared infra (real adapters here; transport/generation injected):
 * load current board → chat/preferences (no auto-generate) → explicit Build →
 * proposal + diff → reject / safe apply (blocked & stale can never apply) →
 * applied plan becomes the visible current board.
 */
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react'
import NativePlannerJourney from './NativePlannerJourney'
import { boardResponseToModel, generatePlanResponseToModel } from '../../../shared/planner/adapters'
import type { GeneratePlanRequest } from '../../../shared/planner/api-client'

const BOARD = {
  metadata: {
    board_data_version: 'rev-1',
    program_repository_courses: [
      { course_id: 'Y-1', name_he: 'קורס Y', weekly_hours: 3.5, is_mandatory: false },
      // Selectable in the exclude/want name-pickers (course-name → id resolution).
      { course_id: 'THERMO-2', name_he: 'תרמודינמיקה 2', weekly_hours: 3.0, is_mandatory: false },
    ],
  },
  semesters: [
    { semester_id: 'year_3_semester_a', courses: [{ course_id: 'X-1', name_he: 'קורס בסיס X', weekly_hours: 3.0, course_type: 'mandatory', is_mandatory: true }] },
    { semester_id: 'year_3_semester_b', courses: [] },
  ],
}
const board = () => boardResponseToModel(BOARD)

// Proposal that ADDS Y-1 alongside the existing X-1 (a truthful "new" diff).
const PROPOSAL = () => generatePlanResponseToModel({
  semesters: [
    { semester_id: 'year_3_semester_a', course_ids: ['X-1', 'Y-1'] },
    { semester_id: 'year_3_semester_b', course_ids: [] },
  ],
  moves: [{ course_id: 'Y-1', from: null, to: 'year_3_semester_a' }],
  warnings_he: ['אזהרת תחום'], errors: [], blocked: false,
})
const BLOCKED = () => generatePlanResponseToModel({
  semesters: [{ semester_id: 'year_3_semester_a', course_ids: ['X-1'] }],
  moves: [], warnings_he: [], errors: ['סמסטר עמוס מדי — לא ניתן להחיל את התוכנית.'], blocked: true,
})

const deps = (over: Partial<{ getBoardFn: any; generateFn: any }> = {}) => ({
  programId: 'mechanical_engineering_2027',
  getBoardFn: over.getBoardFn ?? (async () => board()),
  generateFn: over.generateFn ?? (async () => PROPOSAL()),
})

async function renderReady(over = {}) {
  const view = render(<NativePlannerJourney {...deps(over)} />)
  await waitFor(() => expect(screen.getByText('קורס בסיס X')).toBeInTheDocument())
  return view
}

test('loads and shows the current semester plan', async () => {
  const getBoardFn = jest.fn(async () => board())
  render(<NativePlannerJourney {...deps({ getBoardFn })} />)
  await waitFor(() => expect(screen.getByText('קורס בסיס X')).toBeInTheDocument())
  expect(getBoardFn).toHaveBeenCalledWith('mechanical_engineering_2027')
})

test('a board load failure is shown truthfully (no silent blank)', async () => {
  render(<NativePlannerJourney {...deps({ getBoardFn: async () => { throw new Error('down') } })} />)
  await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent(/טעינ|נכשל|שגיא/))
})

test('sending a chat message does NOT generate a plan', async () => {
  const generateFn = jest.fn(async () => PROPOSAL())
  await renderReady({ generateFn })
  fireEvent.change(screen.getByRole('textbox', { name: /הודעה|בקשה|העדפה/ }), { target: { value: 'אני מעדיף פחות מעבדות' } })
  fireEvent.click(screen.getByRole('button', { name: /שלח/ }))
  await waitFor(() => expect(screen.getByText('אני מעדיף פחות מעבדות')).toBeInTheDocument())
  expect(generateFn).not.toHaveBeenCalled()
})

test('explicit Build calls the real endpoint once with the conversation + board as plan_context', async () => {
  let captured: GeneratePlanRequest | null = null
  const generateFn = jest.fn(async (req: GeneratePlanRequest) => { captured = req; return PROPOSAL() })
  await renderReady({ generateFn })
  fireEvent.change(screen.getByRole('textbox', { name: /הודעה|בקשה|העדפה/ }), { target: { value: 'תעדיף בוקר' } })
  fireEvent.click(screen.getByRole('button', { name: /שלח/ }))
  fireEvent.click(screen.getByRole('button', { name: /בנה תוכנית/ }))
  await waitFor(() => expect(generateFn).toHaveBeenCalledTimes(1))
  const req = captured! as GeneratePlanRequest
  expect(req.program_id).toBe('mechanical_engineering_2027')
  expect(String(req.session_token)).toMatch(/^[0-9a-f-]{36}$/i) // a real UUID for quota
  const ctx = req.plan_context as any
  expect(ctx.semesters.find((s: any) => s.id === 'year_3_semester_a').courses[0].course_id).toBe('X-1')
  expect((req.preferences as any).extra_request_he).toContain('תעדיף בוקר')
})

test('an excluded course (picked by name) is sent as a hard exclusion (disallowed), never a soft hint', async () => {
  let captured: GeneratePlanRequest | null = null
  const generateFn = jest.fn(async (req: GeneratePlanRequest) => { captured = req; return PROPOSAL() })
  await renderReady({ generateFn })
  // The exclude control is a name-picker (commit 92f473a): type the course NAME,
  // then select the ranked match — that resolves the name to its canonical id.
  fireEvent.change(screen.getByRole('textbox', { name: /להחריג|להוציא|exclude/i }), { target: { value: 'תרמודינמיקה' } })
  fireEvent.click(await screen.findByRole('button', { name: /THERMO-2/ }))
  fireEvent.click(screen.getByRole('button', { name: /בנה תוכנית/ }))
  await waitFor(() => expect(generateFn).toHaveBeenCalled())
  // Intent preserved: a user exclusion reaches the planner as a HARD disallow.
  expect((captured! as GeneratePlanRequest).preferences as any).toMatchObject({ disallowed_course_ids: ['THERMO-2'] })
})

test('the proposal is shown with an added-course diff marker and apply/reject controls', async () => {
  await renderReady()
  fireEvent.click(screen.getByRole('button', { name: /בנה תוכנית/ }))
  await waitFor(() => expect(screen.getByText('קורס Y')).toBeInTheDocument())
  expect(screen.getByRole('region', { name: /טיוט/ })).toBeInTheDocument()
  expect(screen.getByText('חדש')).toBeInTheDocument() // added marker
  expect(screen.getByRole('button', { name: /החל/ })).toBeEnabled()
  expect(screen.getByRole('button', { name: /דחה/ })).toBeInTheDocument()
})

test('reject discards the proposal and restores the current plan', async () => {
  await renderReady()
  fireEvent.click(screen.getByRole('button', { name: /בנה תוכנית/ }))
  await waitFor(() => expect(screen.getByText('קורס Y')).toBeInTheDocument())
  fireEvent.click(screen.getByRole('button', { name: /דחה/ }))
  await waitFor(() => expect(screen.queryByRole('region', { name: /טיוט/ })).toBeNull())
  expect(screen.queryByText('קורס Y')).toBeNull() // added course gone
  expect(screen.getByText('קורס בסיס X')).toBeInTheDocument() // current plan restored
})

test('applying a valid proposal makes it the visible current plan', async () => {
  await renderReady()
  fireEvent.click(screen.getByRole('button', { name: /בנה תוכנית/ }))
  await waitFor(() => expect(screen.getByText('קורס Y')).toBeInTheDocument())
  fireEvent.click(screen.getByRole('button', { name: /החל/ }))
  await waitFor(() => expect(screen.queryByRole('region', { name: /טיוט/ })).toBeNull())
  // Y-1 is now on the CURRENT board (persisted into the applied plan), and a
  // fresh Build would diff against it — the marker is gone.
  expect(screen.getByText('קורס Y')).toBeInTheDocument()
  expect(screen.queryByText('חדש')).toBeNull()
})

test('a blocked proposal cannot be applied and is shown as blocked with its error', async () => {
  await renderReady({ generateFn: async () => BLOCKED() })
  fireEvent.click(screen.getByRole('button', { name: /בנה תוכנית/ }))
  await waitFor(() => expect(screen.getByText('הצעה חסומה — לא ניתן להחיל')).toBeInTheDocument())
  expect(screen.getByText('סמסטר עמוס מדי — לא ניתן להחיל את התוכנית.')).toBeInTheDocument()
  const apply = screen.queryByRole('button', { name: /החל/ })
  expect(apply === null || (apply as HTMLButtonElement).disabled).toBe(true)
})

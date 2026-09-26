import { fireEvent, render, screen, within } from '@testing-library/react'
import * as plannerApi from '../../../../shared/planner/api-client'
import { boardResponseToModel } from '../../../../shared/planner/adapters'
import UnifiedPlannerWorkspace from './UnifiedPlannerWorkspace'

// Keep the workspace, rail and conversation real; only server I/O is controlled.
beforeEach(() => {
  jest.spyOn(plannerApi, 'getBoard').mockResolvedValue(boardResponseToModel({
    metadata: { board_data_version: 'rev-drawer' },
    semesters: [{ semester_id: 'year_3_semester_a', courses: [{
      course_id: '0542-2400', name_he: 'תכן מכני (1)', weekly_hours: 4,
      course_type: 'mandatory', is_mandatory: true,
    }] }],
  }))
  jest.spyOn(plannerApi, 'getCommittedBoard').mockResolvedValue(null)
  jest.spyOn(plannerApi, 'getPlanningContext').mockResolvedValue({
    academicStatusDigest: 'as_drawer', preferenceDigest: 'pref_drawer',
    personalStatus: {}, preferences: {},
  })
})

afterEach(() => jest.restoreAllMocks())

const repositoryWithDetails = {
  totalCourses: 1,
  categories: [{ id: 'control', title: 'בקרה', courses: [{
    id: '0542-4241', name: 'בקרה מודרנית', weeklyHours: 3, offered: ['A'],
    difficulty: null, syllabusUrl: null,
  }] }],
}

const RAIL = { name: 'סרגל כלים' }
const emptyRepo = { categories: [], totalCourses: 0 }

test('course details escapes the scrolling rail so its backdrop covers the workspace', async () => {
  render(<UnifiedPlannerWorkspace programId="mechanical_engineering_2027" repo={repositoryWithDetails} />)
  await screen.findByText('תכן מכני (1)')
  fireEvent.click(screen.getByRole('button', { name: 'פתח כלי תכנון' }))
  const trigger = screen.getByRole('button', { name: 'פרטים על בקרה מודרנית' })
  trigger.focus()
  fireEvent.click(trigger)
  const rail = screen.getByRole('complementary', RAIL)
  const dialog = screen.getByRole('dialog', { name: 'פרטי קורס' })

  // A transformed scrolling rail contains/clips fixed descendants in Chrome.
  expect(rail).not.toContainElement(dialog)
  expect(dialog.parentElement?.parentElement).toBe(document.body)
  fireEvent.click(dialog.parentElement!)
  expect(screen.queryByRole('dialog', { name: 'פרטי קורס' })).toBeNull()
  expect(trigger).toHaveFocus()
})

test('an Escape already handled by a nested surface does not close the rail', async () => {
  render(<UnifiedPlannerWorkspace programId="mechanical_engineering_2027" repo={repositoryWithDetails} />)
  await screen.findByText('תכן מכני (1)')
  const repositoryToggle = screen.getByRole('button', { name: 'פתח כלי תכנון' })
  fireEvent.click(repositoryToggle)
  const close = screen.getByRole('button', { name: 'סגור סרגל כלים' })
  // Next's document-root event delegation can deliver an already-handled event
  // to another document listener; cancelling a dialog must not dismiss its owner.
  const escape = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })
  escape.preventDefault()

  fireEvent(close, escape)

  expect(repositoryToggle).toHaveAttribute('aria-expanded', 'true')
  expect(close).toHaveFocus()
})

test.each([false, true])('course details wraps Tab inside the dialog (shift=%s)', async (shiftKey) => {
  render(<UnifiedPlannerWorkspace programId="mechanical_engineering_2027" repo={repositoryWithDetails} />)
  await screen.findByText('תכן מכני (1)')
  fireEvent.click(screen.getByRole('button', { name: 'פתח כלי תכנון' }))
  fireEvent.click(screen.getByRole('button', { name: 'פרטים על בקרה מודרנית' }))
  const closeButtons = within(screen.getByRole('dialog', { name: 'פרטי קורס' }))
    .getAllByRole('button', { name: 'סגור' })
  const first = closeButtons[0]
  const last = closeButtons[1]
  const boundary = shiftKey ? first : last
  boundary.focus()

  const defaultAllowed = fireEvent.keyDown(boundary, { key: 'Tab', shiftKey })

  expect(defaultAllowed).toBe(false)
  expect(shiftKey ? last : first).toHaveFocus()
})

test.each(['Escape', 'close button', 'backdrop'] as const)(
  'closing course details with %s preserves the open rail and restores its trigger',
  async (method) => {
    render(<UnifiedPlannerWorkspace programId="mechanical_engineering_2027" repo={repositoryWithDetails} />)
    await screen.findByText('תכן מכני (1)')
    const repositoryToggle = screen.getByRole('button', { name: 'פתח כלי תכנון' })
    fireEvent.click(repositoryToggle)
    const trigger = screen.getByRole('button', { name: 'פרטים על בקרה מודרנית' })
    trigger.focus()
    fireEvent.click(trigger)
    const dialog = screen.getByRole('dialog', { name: 'פרטי קורס' })
    const close = within(dialog).getAllByRole('button', { name: 'סגור' })[0]
    expect(close).toHaveFocus()

    if (method === 'Escape') fireEvent.keyDown(close, { key: 'Escape' })
    else if (method === 'close button') fireEvent.click(close)
    else fireEvent.click(dialog.parentElement!)

    expect(screen.queryByRole('dialog', { name: 'פרטי קורס' })).toBeNull()
    expect(repositoryToggle).toHaveAttribute('aria-expanded', 'true')
    expect(trigger).toHaveFocus()
    expect(screen.getByRole('region', { name: 'לוח סמסטרים פעיל' })).toBeInTheDocument()
  },
)

test('switching tabs keeps both panels mounted, so search text survives', async () => {
  render(<UnifiedPlannerWorkspace programId="mechanical_engineering_2027" repo={emptyRepo} />)
  await screen.findByText('תכן מכני (1)')
  fireEvent.click(screen.getByRole('button', { name: 'פתח כלי תכנון' }))
  const search = within(screen.getByRole('complementary', RAIL)).getByRole('searchbox')
  fireEvent.change(search, { target: { value: 'תכן' } })

  fireEvent.click(screen.getByRole('tab', { name: 'עוזר AI' }))
  expect(screen.getByRole('complementary', { name: 'עוזר אקדמי' })).toBeInTheDocument()
  expect(screen.queryByRole('searchbox')).toBeNull()

  fireEvent.click(screen.getByRole('tab', { name: 'קורסים' }))
  expect(within(screen.getByRole('complementary', RAIL)).getByRole('searchbox')).toHaveValue('תכן')
})

test('Escape closes the rail without also invoking the native search clear action', async () => {
  render(<UnifiedPlannerWorkspace programId="mechanical_engineering_2027" repo={emptyRepo} />)
  await screen.findByText('תכן מכני (1)')
  const toggle = screen.getByRole('button', { name: 'פתח כלי תכנון' })
  fireEvent.click(toggle)
  const search = within(screen.getByRole('complementary', RAIL)).getByRole('searchbox')
  fireEvent.change(search, { target: { value: 'תכן' } })

  // JSDOM does not run the native <input type="search"> Escape default action.
  // The event must be cancelled, or Chrome clears the query while closing the rail.
  const browserDefaultAllowed = fireEvent.keyDown(search, { key: 'Escape' })

  expect(browserDefaultAllowed).toBe(false)
  expect(toggle).toHaveAttribute('aria-expanded', 'false')
  expect(toggle).toHaveFocus()
  fireEvent.click(toggle)
  expect(search).toHaveValue('תכן')
})

test('one toggle controls the rail, and the assistant renders inside it', async () => {
  render(<UnifiedPlannerWorkspace programId="mechanical_engineering_2027" repo={emptyRepo} />)
  await screen.findByText('תכן מכני (1)')
  const toggle = screen.getByRole('button', { name: 'פתח כלי תכנון' })

  fireEvent.click(toggle)
  expect(screen.getByRole('button', { name: 'סגור סרגל כלים' })).toHaveFocus()
  fireEvent.click(screen.getByRole('tab', { name: 'עוזר AI' }))

  const rail = screen.getByRole('complementary', RAIL)
  expect(document.getElementById(toggle.getAttribute('aria-controls')!)).toBe(rail)
  expect(within(rail).getByRole('complementary', { name: 'עוזר אקדמי' })).toBeInTheDocument()
  expect(toggle).toHaveAttribute('aria-expanded', 'true')

  fireEvent.keyDown(document, { key: 'Escape' })

  expect(toggle).toHaveAttribute('aria-expanded', 'false')
  expect(toggle).toHaveFocus()
})

test('the rail is inert and absent from accessible navigation while closed', async () => {
  render(<UnifiedPlannerWorkspace programId="mechanical_engineering_2027" repo={emptyRepo} />)
  await screen.findByText('תכן מכני (1)')
  const toggle = screen.getByRole('button', { name: 'פתח כלי תכנון' })
  const rail = document.getElementById(toggle.getAttribute('aria-controls')!)!

  expect(rail).toHaveAttribute('inert')
  expect(screen.queryByRole('complementary', RAIL)).toBeNull()

  fireEvent.click(toggle)

  expect(screen.getByRole('complementary', RAIL)).toBe(rail)
  expect(rail).not.toHaveAttribute('inert')

  fireEvent.keyDown(document, { key: 'Escape' })

  expect(rail).toHaveAttribute('inert')
  expect(screen.queryByRole('complementary', RAIL)).toBeNull()
  expect(toggle).toHaveFocus()
})

test('the profile tab shows the student inputs open, and the chat no longer nests them', async () => {
  render(<UnifiedPlannerWorkspace programId="mechanical_engineering_2027" repo={emptyRepo} />)
  await screen.findByText('תכן מכני (1)')

  fireEvent.click(screen.getByRole('button', { name: 'פתח כלי תכנון' }))
  fireEvent.click(screen.getByRole('tab', { name: 'הפרופיל שלי' }))

  const profile = screen.getByRole('region', { name: 'הפרופיל שלי' })
  expect(within(profile).getByRole('textbox', { name: 'מגבלת שעות שבועיות' })).toBeVisible()
  expect(within(profile).getByRole('textbox', { name: 'שעות שהושלמו' })).toBeVisible()
  expect(screen.queryByText('מה חשוב לעוזר לדעת? (אופציונלי)')).toBeNull()

  fireEvent.click(screen.getByRole('tab', { name: 'עוזר AI' }))
  expect(screen.queryByTestId('academic-agent-context')).toBeNull()
  fireEvent.click(screen.getByRole('tab', { name: 'הפרופיל שלי' }))
  expect(screen.getByRole('textbox', { name: 'מגבלת שעות שבועיות' })).toBeVisible()
})

import { fireEvent, render, screen, within } from '@testing-library/react'
import * as plannerApi from '../../../shared/planner/api-client'
import { boardResponseToModel } from '../../../shared/planner/adapters'
import UnifiedPlannerWorkspace from './UnifiedPlannerWorkspace'

// Keep the workspace, drawers and conversation real; only server I/O is controlled.
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

test('an Escape already handled by a nested surface does not close either drawer', async () => {
  render(<UnifiedPlannerWorkspace programId="mechanical_engineering_2027" repo={repositoryWithDetails} />)
  await screen.findByText('תכן מכני (1)')
  const agentToggle = screen.getByRole('button', { name: 'פתח עוזר AI' })
  const repositoryToggle = screen.getByRole('button', { name: 'פתח מאגר קורסים' })
  fireEvent.click(agentToggle)
  fireEvent.click(repositoryToggle)
  const close = screen.getByRole('button', { name: 'סגור סרגל מאגר קורסים' })
  // Next's document-root event delegation can deliver an already-handled event
  // to another document listener; cancelling a dialog must not dismiss its owner.
  const escape = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })
  escape.preventDefault()

  fireEvent(close, escape)

  expect(repositoryToggle).toHaveAttribute('aria-expanded', 'true')
  expect(agentToggle).toHaveAttribute('aria-expanded', 'true')
  expect(close).toHaveFocus()
})

test.each([false, true])('course details wraps Tab inside the dialog (shift=%s)', async (shiftKey) => {
  render(<UnifiedPlannerWorkspace programId="mechanical_engineering_2027" repo={repositoryWithDetails} />)
  await screen.findByText('תכן מכני (1)')
  fireEvent.click(screen.getByRole('button', { name: 'פתח מאגר קורסים' }))
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
  'closing course details with %s preserves the open drawers and restores its trigger',
  async (method) => {
    render(<UnifiedPlannerWorkspace programId="mechanical_engineering_2027" repo={repositoryWithDetails} />)
    await screen.findByText('תכן מכני (1)')
    const agentToggle = screen.getByRole('button', { name: 'פתח עוזר AI' })
    const repositoryToggle = screen.getByRole('button', { name: 'פתח מאגר קורסים' })
    fireEvent.click(agentToggle)
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
    expect(agentToggle).toHaveAttribute('aria-expanded', 'true')
    expect(trigger).toHaveFocus()
    expect(screen.getByRole('region', { name: 'לוח סמסטרים פעיל' })).toBeInTheDocument()
  },
)

test.each(['agent-first', 'repository-first'] as const)(
  'Escape closes the focused repository, not the other open drawer (%s)',
  async (openingOrder) => {
    render(<UnifiedPlannerWorkspace programId="mechanical_engineering_2027"
      repo={{ categories: [], totalCourses: 0 }} />)
    await screen.findByText('תכן מכני (1)')
    const agentToggle = screen.getByRole('button', { name: 'פתח עוזר AI' })
    const repositoryToggle = screen.getByRole('button', { name: 'פתח מאגר קורסים' })
    const toggles = openingOrder === 'agent-first'
      ? [agentToggle, repositoryToggle] : [repositoryToggle, agentToggle]
    toggles.forEach((toggle) => fireEvent.click(toggle))
    const search = within(screen.getByRole('complementary', { name: 'מאגר קורסים' })).getByRole('searchbox')
    fireEvent.change(search, { target: { value: 'תכן' } })
    search.focus()

    fireEvent.keyDown(search, { key: 'Escape' })

    expect(repositoryToggle).toHaveAttribute('aria-expanded', 'false')
    expect(agentToggle).toHaveAttribute('aria-expanded', 'true')
    expect(repositoryToggle).toHaveFocus()
    fireEvent.click(repositoryToggle)
    expect(search).toHaveValue('תכן')

    const agentClose = screen.getByRole('button', { name: 'סגור סרגל עוזר AI' })
    agentClose.focus()
    fireEvent.keyDown(agentClose, { key: 'Escape' })
    expect(agentToggle).toHaveAttribute('aria-expanded', 'false')
    expect(repositoryToggle).toHaveAttribute('aria-expanded', 'true')
    expect(agentToggle).toHaveFocus()
  },
)

test('Escape closes the repository without also invoking the native search clear action', async () => {
  render(<UnifiedPlannerWorkspace programId="mechanical_engineering_2027"
    repo={{ categories: [], totalCourses: 0 }} />)
  await screen.findByText('תכן מכני (1)')
  const toggle = screen.getByRole('button', { name: 'פתח מאגר קורסים' })
  fireEvent.click(toggle)
  const search = within(screen.getByRole('complementary', { name: 'מאגר קורסים' })).getByRole('searchbox')
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

test('the agent toggle identifies its actual drawer throughout opening and closing', async () => {
  render(<UnifiedPlannerWorkspace programId="mechanical_engineering_2027"
    repo={{ categories: [], totalCourses: 0 }} />)
  await screen.findByText('תכן מכני (1)')
  const toggle = screen.getByRole('button', { name: 'פתח עוזר AI' })

  fireEvent.click(toggle)

  const drawer = screen.getByRole('complementary', { name: 'עוזר אקדמי' })
  expect(document.getElementById(toggle.getAttribute('aria-controls')!)).toBe(drawer)
  expect(toggle).toHaveAttribute('aria-expanded', 'true')
  expect(screen.getByRole('button', { name: 'סגור סרגל עוזר AI' })).toHaveFocus()

  fireEvent.keyDown(document, { key: 'Escape' })

  expect(toggle).toHaveAttribute('aria-expanded', 'false')
  expect(document.getElementById(toggle.getAttribute('aria-controls')!)).toBe(drawer)
  expect(toggle).toHaveFocus()
})

test.each([
  { opener: 'פתח עוזר AI', drawerName: 'עוזר אקדמי' },
  { opener: 'פתח מאגר קורסים', drawerName: 'מאגר קורסים' },
])('$drawerName is inert and absent from accessible navigation while closed', async ({ opener, drawerName }) => {
  render(<UnifiedPlannerWorkspace programId="mechanical_engineering_2027"
    repo={{ categories: [], totalCourses: 0 }} />)
  await screen.findByText('תכן מכני (1)')
  const toggle = screen.getByRole('button', { name: opener })
  const drawer = document.getElementById(toggle.getAttribute('aria-controls')!)!

  expect(drawer).toHaveAttribute('inert')
  expect(screen.queryByRole('complementary', { name: drawerName })).toBeNull()

  fireEvent.click(toggle)

  expect(screen.getByRole('complementary', { name: drawerName })).toBe(drawer)
  expect(drawer).not.toHaveAttribute('inert')

  fireEvent.keyDown(document, { key: 'Escape' })

  expect(drawer).toHaveAttribute('inert')
  expect(screen.queryByRole('complementary', { name: drawerName })).toBeNull()
  expect(toggle).toHaveFocus()

  fireEvent.click(toggle)

  expect(screen.getByRole('complementary', { name: drawerName })).toBe(drawer)
  expect(drawer).not.toHaveAttribute('inert')
})

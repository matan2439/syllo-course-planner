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

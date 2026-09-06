import { fireEvent, render, screen } from '@testing-library/react'
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

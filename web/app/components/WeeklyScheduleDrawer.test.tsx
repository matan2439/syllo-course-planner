import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import WeeklyScheduleDrawer from './WeeklyScheduleDrawer'
import type { ScheduleGroupsResponse, CourseSearchResponse } from '../../../shared/planner/schedule'

const DESTINATIONS = [
  { id: 'year_3_semester_a', label: 'שנה ג׳ — סמסטר א׳' },
  { id: 'year_3_semester_b', label: 'שנה ג׳ — סמסטר ב׳' },
]

const SEMESTER_COURSES = [
  { semesterId: 'year_3_semester_a', courseIds: ['0542-2400', '0512-4266'] },
  { semesterId: 'year_3_semester_b', courseIds: [] },
]

function groupsResponse(overrides: Partial<ScheduleGroupsResponse> = {}): ScheduleGroupsResponse {
  return {
    semester: 1,
    source: 'bidit',
    fetchedAt: '2026-09-10T00:00:00.000Z',
    courses: [
      {
        courseId: '0542-2400', nameHe: 'תכן מכני (1)', cYear: 2026, found: true, incompleteData: false,
        groups: [{
          groupId: '01', havura: 'A', kind: 'ראשית', teachingMode: 'שיעור ותרגיל',
          lecturer: null, room: null,
          slots: [{ day: 'א', start: '10:00', end: '12:00' }],
        }],
      },
      {
        courseId: '0512-4266', nameHe: 'אבטחה ובטיחות', cYear: 2026, found: true, incompleteData: false,
        groups: [{
          groupId: '01', havura: 'A', kind: 'ראשית', teachingMode: 'שיעור',
          lecturer: null, room: null,
          slots: [{ day: 'א', start: '11:00', end: '13:00' }],
        }],
      },
    ],
    ...overrides,
  }
}

function renderDrawer(overrides: Partial<Parameters<typeof WeeklyScheduleDrawer>[0]> = {}) {
  const fetchScheduleGroupsFn = jest.fn().mockResolvedValue(groupsResponse())
  const fetchCourseSearchFn = jest.fn().mockResolvedValue({ results: [], source: 'bidit', fetchedAt: 't' } as CourseSearchResponse)
  const closeRef = { current: null }
  const utils = render(
    <WeeklyScheduleDrawer
      programId="mechanical_engineering_2027"
      semesterDestinations={DESTINATIONS}
      semesterCourses={SEMESTER_COURSES}
      onClose={jest.fn()}
      closeRef={closeRef}
      fetchScheduleGroupsFn={fetchScheduleGroupsFn}
      fetchCourseSearchFn={fetchCourseSearchFn}
      {...overrides}
    />,
  )
  return { ...utils, fetchScheduleGroupsFn, fetchCourseSearchFn }
}

beforeEach(() => window.localStorage.clear())

test('fetches and lists groups for the active tab’s board-synced courses automatically', async () => {
  const { fetchScheduleGroupsFn } = renderDrawer()
  await waitFor(() => expect(fetchScheduleGroupsFn).toHaveBeenCalledWith(
    expect.arrayContaining(['0542-2400', '0512-4266']), 1,
  ))
  expect(await screen.findByText('תכן מכני (1)')).toBeInTheDocument()
  expect(await screen.findByText('אבטחה ובטיחות')).toBeInTheDocument()
})

test('selecting a group renders it on the grid', async () => {
  renderDrawer()
  const checkbox = await screen.findByRole('checkbox', { name: /תכן מכני \(1\).*ראשית.*א.*10:00-12:00/ })
  fireEvent.click(checkbox)
  expect(await screen.findByRole('gridcell', { name: /תכן מכני \(1\)/ })).toBeInTheDocument()
})

test('selecting a second, time-overlapping group is blocked with an explanatory message', async () => {
  renderDrawer()
  const first = await screen.findByRole('checkbox', { name: /תכן מכני \(1\).*ראשית.*א.*10:00-12:00/ })
  fireEvent.click(first)
  const second = await screen.findByRole('checkbox', { name: /אבטחה ובטיחות.*ראשית.*א.*11:00-13:00/ })
  fireEvent.click(second)
  expect(second).not.toBeChecked()
  expect(await screen.findByText(/חופף ל.*תכן מכני/)).toBeInTheDocument()
})

test('a course bid-it has no record for shows a missing-data badge, not an empty conflict-free list', async () => {
  const fetchScheduleGroupsFn = jest.fn().mockResolvedValue(groupsResponse({
    courses: [
      { courseId: '0542-2400', nameHe: null, cYear: null, found: false, incompleteData: false, groups: [] },
      groupsResponse().courses[1],
    ],
  }))
  renderDrawer({ fetchScheduleGroupsFn })
  expect(await screen.findByText('אין נתוני שעות')).toBeInTheDocument()
})

test('switching to a tab with no board-synced courses clears the list without a wasted fetch', async () => {
  const { fetchScheduleGroupsFn } = renderDrawer()
  await waitFor(() => expect(fetchScheduleGroupsFn).toHaveBeenCalledTimes(1))
  expect(fetchScheduleGroupsFn).toHaveBeenLastCalledWith(
    expect.arrayContaining(['0542-2400', '0512-4266']), 1,
  )
  expect(await screen.findByText('תכן מכני (1)')).toBeInTheDocument()

  fireEvent.click(screen.getByRole('tab', { name: 'שנה ג׳ — סמסטר ב׳' }))
  await waitFor(() => expect(screen.queryByText('תכן מכני (1)')).toBeNull())
  // year_3_semester_b has no board-synced courses and nothing was searched in — no call needed.
  expect(fetchScheduleGroupsFn).toHaveBeenCalledTimes(1)
})

test('shows a bid-it provenance line with the fetch time', async () => {
  renderDrawer()
  expect(await screen.findByText(/מקור: bid-it \(לא רשמי\)/)).toBeInTheDocument()
})

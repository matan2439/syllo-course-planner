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
  const utils = render(
    <WeeklyScheduleDrawer
      programId="mechanical_engineering_2027"
      semesterDestinations={DESTINATIONS}
      semesterCourses={SEMESTER_COURSES}
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
  expect((await screen.findAllByText('תכן מכני (1)')).length).toBeGreaterThan(0)
  expect((await screen.findAllByText('אבטחה ובטיחות')).length).toBeGreaterThan(0)
})

test('renders the only available course group on the grid automatically', async () => {
  renderDrawer()
  expect(await screen.findByRole('gridcell', { name: /תכן מכני \(1\)/ })).toBeInTheDocument()
})

test('offers a compact group choice only when a course has real alternatives', async () => {
  const fetchScheduleGroupsFn = jest.fn().mockResolvedValue(groupsResponse({
    courses: [{
      ...groupsResponse().courses[0],
      groups: [
        { ...groupsResponse().courses[0].groups[0], groupId: '01', havura: '1', kind: 'משנית', teachingMode: 'תרגיל' },
        { ...groupsResponse().courses[0].groups[0], groupId: '02', havura: '2', kind: 'משנית', teachingMode: 'תרגיל', slots: [{ day: 'ב', start: '12:00', end: '14:00' }] },
      ],
    }],
  }))
  renderDrawer({ fetchScheduleGroupsFn })

  expect(await screen.findByRole('radio', { name: /תכן מכני \(1\).*קבוצה 1/ })).toBeInTheDocument()
  expect(screen.getByRole('radio', { name: /תכן מכני \(1\).*קבוצה 2/ })).toBeInTheDocument()
  expect(screen.queryByRole('gridcell', { name: /תכן מכני \(1\)/ })).toBeNull()
})

test('a course bid-it has no record for shows a missing-data badge, not an empty conflict-free list', async () => {
  const fetchScheduleGroupsFn = jest.fn().mockResolvedValue(groupsResponse({
    courses: [
      { courseId: '0542-2400', nameHe: null, cYear: null, found: false, incompleteData: false, groups: [] },
      groupsResponse().courses[1],
    ],
  }))
  renderDrawer({ fetchScheduleGroupsFn })
  expect(await screen.findByText(/לחלק מהקורסים אין עדיין נתוני שעות/)).toBeInTheDocument()
})

test('switching to a tab with no board-synced courses clears the list without a wasted fetch', async () => {
  const { fetchScheduleGroupsFn } = renderDrawer()
  await waitFor(() => expect(fetchScheduleGroupsFn).toHaveBeenCalledTimes(1))
  expect(fetchScheduleGroupsFn).toHaveBeenLastCalledWith(
    expect.arrayContaining(['0542-2400', '0512-4266']), 1,
  )
  expect((await screen.findAllByText('תכן מכני (1)')).length).toBeGreaterThan(0)

  fireEvent.click(screen.getByRole('tab', { name: 'שנה ג׳ — סמסטר ב׳' }))
  await waitFor(() => expect(screen.queryAllByText('תכן מכני (1)')).toHaveLength(0))
  // year_3_semester_b has no board-synced courses and nothing was searched in — no call needed.
  expect(fetchScheduleGroupsFn).toHaveBeenCalledTimes(1)
})

test('shows a bid-it provenance line with the fetch time', async () => {
  renderDrawer()
  expect(await screen.findByText(/מקור: bid-it \(לא רשמי\)/)).toBeInTheDocument()
})

test('warns when bid-it returned data for a different year than the mapped term', async () => {
  const fetchScheduleGroupsFn = jest.fn().mockResolvedValue(groupsResponse({
    courses: [
      { ...groupsResponse().courses[0], cYear: 2099 },
      groupsResponse().courses[1],
    ],
  }))
  renderDrawer({ fetchScheduleGroupsFn })
  expect(await screen.findByText(/2099/)).toBeInTheDocument()
})

test('a failed search shows an explanatory message instead of failing silently', async () => {
  const fetchCourseSearchFn = jest.fn().mockRejectedValue(new Error('network down'))
  renderDrawer({ fetchCourseSearchFn })

  fireEvent.change(screen.getByPlaceholderText('חיפוש קורס להוספה לצפייה'), { target: { value: 'תכן' } })
  fireEvent.click(screen.getByRole('button', { name: 'חפש' }))

  expect(await screen.findByText(/החיפוש נכשל/)).toBeInTheDocument()
})

test('a failed schedule-groups fetch shows an error instead of silently rendering an empty list', async () => {
  const fetchScheduleGroupsFn = jest.fn().mockRejectedValue(new Error('network down'))
  renderDrawer({ fetchScheduleGroupsFn })

  expect(await screen.findByText(/טעינת נתוני השעות נכשלה/)).toBeInTheDocument()
})

test('a stale alternative choice that newly conflicts after refetch is removed, not silently kept', async () => {
  let call = 0
  const fetchScheduleGroupsFn = jest.fn().mockImplementation(async () => {
    call += 1
    const primary = (courseId: string, nameHe: string, groupId: string, day: string, start: string, end: string) => ({
      courseId, nameHe, cYear: 2026, found: true, incompleteData: false,
      groups: [
        { groupId, havura: '1', kind: 'ראשית', teachingMode: 'שיעור', lecturer: null, room: null, slots: [{ day, start, end }] },
        { groupId: '02', havura: '2', kind: 'ראשית', teachingMode: 'שיעור', lecturer: null, room: null, slots: [{ day: 'ה', start: '14:00', end: '16:00' }] },
      ],
    })
    if (call === 1) {
      // first load: the two courses do NOT overlap
      return groupsResponse({
        courses: [
          primary('0542-2400', 'תכן מכני (1)', '01', 'א', '10:00', '12:00'),
          primary('0512-4266', 'אבטחה ובטיחות', '01', 'ב', '11:00', '13:00'),
        ],
      })
    }
    // second load (after adding an extra course triggers a refetch): now they DO overlap
    return groupsResponse({
      courses: [
        primary('0542-2400', 'תכן מכני (1)', '01', 'א', '10:00', '12:00'),
        primary('0512-4266', 'אבטחה ובטיחות', '01', 'א', '11:00', '13:00'),
      ],
    })
  })
  const fetchCourseSearchFn = jest.fn().mockResolvedValue({
    results: [{ courseId: '9999-9999', nameHe: 'קורס נוסף' }],
    source: 'bidit',
    fetchedAt: 't',
  } as CourseSearchResponse)
  renderDrawer({ fetchScheduleGroupsFn, fetchCourseSearchFn })

  const first = await screen.findByRole('radio', { name: /תכן מכני \(1\).*קבוצה 1.*א.*10:00[–-]12:00/ })
  fireEvent.click(first)
  const second = await screen.findByRole('radio', { name: /אבטחה ובטיחות.*קבוצה 1.*ב.*11:00[–-]13:00/ })
  fireEvent.click(second)
  expect(first).toBeChecked()
  expect(second).toBeChecked()

  // Trigger a refetch WITHOUT changing the term (which would change the
  // selection-storage key and hide the existing selections regardless of
  // conflict logic). Adding an extra course via search changes the
  // candidate-course-ids key and forces a refetch while keeping the term
  // — and therefore the stored selection keys — stable.
  fireEvent.change(screen.getByPlaceholderText('חיפוש קורס להוספה לצפייה'), { target: { value: 'נוסף' } })
  fireEvent.click(screen.getByRole('button', { name: 'חפש' }))
  const addButton = await screen.findByRole('button', { name: /הוסף קורס נוסף/ })
  fireEvent.click(addButton)

  await waitFor(() => expect(fetchScheduleGroupsFn).toHaveBeenCalledTimes(2))
  // Deterministic outcome: the earlier course in scheduleData.courses
  // ('תכן מכני (1)', index 0) survives the revalidation, and the later one
  // ('אבטחה ובטיחות', index 1) is dropped — per the documented tie-break.
  await waitFor(() => {
    expect(screen.getByRole('radio', { name: /תכן מכני \(1\).*קבוצה 1/ })).toBeChecked()
    expect(screen.getByRole('radio', { name: /אבטחה ובטיחות.*קבוצה 1/ })).not.toBeChecked()
  })
  expect(
    await screen.findByText(/הבחירה ב'אבטחה ובטיחות' הוסרה כי היא חופפת ל'תכן מכני/),
  ).toBeInTheDocument()
})

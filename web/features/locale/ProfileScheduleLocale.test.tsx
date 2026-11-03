import { useState } from 'react'
import { fireEvent, render, screen, within } from '@testing-library/react'
import { LocaleProvider, LOCALE_STORAGE_KEY } from './LocaleProvider'
import LanguageSwitcher from './LanguageSwitcher'
import WeeklyScheduleDrawer from '../schedule/components/WeeklyScheduleDrawer'
import AgentPreferencePanel from '../planner/components/AgentPreferencePanel'
import { EMPTY_ACADEMIC_STATUS } from '../courses/components/CompletedCoursesPanel'
import type { ScheduleGroupsResponse } from '../../../shared/planner/schedule'

beforeEach(() => { localStorage.clear(); localStorage.setItem(LOCALE_STORAGE_KEY, 'en') })

const schedule: ScheduleGroupsResponse = {
  semester: 1, source: 'bidit', fetchedAt: '2026-10-29T09:00:00Z', courses: [{
    courseId: 'C1', nameHe: 'מכניקת זורמים', cYear: 2026, found: true, incompleteData: false,
    groups: [
      { groupId: '01', havura: '1', kind: 'ראשית', teachingMode: 'שיעור', lecturer: null, room: null, slots: [{ day: 'א', start: '10:00', end: '12:00' }] },
      { groupId: '02', havura: '2', kind: 'ראשית', teachingMode: 'שיעור', lecturer: null, room: null, slots: [{ day: 'ב', start: '10:00', end: '12:00' }] },
    ],
  }],
}

test('English timetable can choose groups and free days while keeping course names and schedule state', async () => {
  render(<LocaleProvider><WeeklyScheduleDrawer
    programId="mechanical_engineering_2027" storageScope="owner-a:mechanical"
    semesterDestinations={[{ id: 'year_3_semester_a', label: 'שנה ג׳ — סמסטר א׳' }]}
    semesterCourses={[{ semesterId: 'year_3_semester_a', courseIds: ['C1'] }]}
    fetchScheduleGroupsFn={async () => schedule} fetchCourseSearchFn={async () => ({ results: [], source: 'bidit', fetchedAt: '2026-10-29T09:00:00Z' })}
  /></LocaleProvider>)
  expect(screen.getByRole('tab', { name: 'Year 3 — Semester A' })).toBeInTheDocument()
  const group = await screen.findByRole('radio', { name: /מכניקת זורמים.*Primary.*Group 1.*Sunday/ })
  fireEvent.click(group)
  expect(screen.getByRole('gridcell', { name: /מכניקת זורמים, Primary, Sunday/ })).toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: 'Sunday' }))
  fireEvent.click(screen.getByRole('button', { name: 'Recalculate without my choices' }))
  expect(screen.getByRole('gridcell', { name: /מכניקת זורמים, Primary, Monday/ })).toBeInTheDocument()
  expect(screen.getByRole('table')).toHaveTextContent('Lecture')
  expect(screen.getByRole('table')).toHaveTextContent('Monday')
  expect(screen.getByText(/Source: bid-it \(unofficial\)/)).toBeInTheDocument()
  expect(screen.getByRole('grid')).toHaveAttribute('aria-label', 'Weekly timetable')
  expect(screen.getByRole('grid').closest('[dir]')).toHaveAttribute('dir', 'ltr')
})

test('timetable error messages switch language without refetching or losing their meaning', async () => {
  const fetchGroups = jest.fn(async (): Promise<ScheduleGroupsResponse> => { throw new Error('offline') })
  render(<LocaleProvider><LanguageSwitcher /><WeeklyScheduleDrawer
    programId="mechanical_engineering_2027"
    semesterDestinations={[{ id: 'year_3_semester_a', label: 'שנה ג׳ — סמסטר א׳' }]}
    semesterCourses={[{ semesterId: 'year_3_semester_a', courseIds: ['C1'] }]}
    fetchScheduleGroupsFn={fetchGroups}
  /></LocaleProvider>)
  expect(await screen.findByRole('alert')).toHaveTextContent('Could not load meeting times')
  fireEvent.click(screen.getByRole('button', { name: 'עברית' }))
  expect(screen.getByRole('alert')).toHaveTextContent('טעינת נתוני השעות נכשלה')
  expect(fetchGroups).toHaveBeenCalledTimes(1)
})

function Profile() {
  const [status, setStatus] = useState(EMPTY_ACADEMIC_STATUS)
  const [hours, setHours] = useState('')
  const [year, setYear] = useState<1 | 2 | 3 | 4 | null>(null)
  return <AgentPreferencePanel
    programId="mechanical_engineering_2027" pickerCourses={[]} catalogHoursById={{}}
    academicStatus={status} updateAcademicStatus={setStatus}
    maxHours={hours} setMaxHours={setHours} priorHours="" setPriorHours={() => undefined}
    wantIds={[]} setWantIds={() => undefined} excludeIds={[]} setExcludeIds={() => undefined}
    exclusionsNoneConfirmed={false} setExclusionsNoneConfirmed={() => undefined}
    updatePreferenceVersion={() => undefined} onProfileChange={() => undefined}
    proposal={null} stale={false} alwaysOpen currentDegreeYear={year} onCurrentDegreeYearChange={setYear}
  />
}

test('English profile edits degree year, workload and completed-course confirmation', () => {
  const { container } = render(<LocaleProvider><Profile /></LocaleProvider>)
  const profile = container.firstElementChild as HTMLElement
  const year = within(profile).getByRole('radio', { name: 'Year 3' })
  fireEvent.click(year)
  expect(year).toHaveAttribute('aria-checked', 'true')
  const hours = within(profile).getByRole('textbox', { name: 'Weekly hours limit' })
  fireEvent.change(hours, { target: { value: '20' } })
  expect(hours).toHaveValue('20')
  fireEvent.click(within(profile).getByText('Courses I completed'))
  fireEvent.click(within(profile).getByRole('checkbox', { name: 'All Year 1 — Semester A' }))
  fireEvent.click(within(profile).getByRole('button', { name: 'Save' }))
  expect(within(profile).getByRole('button', { name: 'Saved' })).toBeDisabled()
  expect(within(profile).getByRole('textbox', { name: 'Completed electives' })).toBeInTheDocument()
  expect(profile).toHaveAttribute('dir', 'ltr')
})

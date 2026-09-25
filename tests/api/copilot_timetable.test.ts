import { RunContext, type FunctionTool } from '@openai/agents'
import { checkTimetable } from '../../api/ai/agent/timetable'
import { PlanningSession } from '../../api/ai/agent/session'
import { buildAgentTools } from '../../api/ai/agent/tools'
import { loadLocalBoardJson } from '../../api/ai/board_loader'
import type { ScheduleCourse, ScheduleGroup } from '../../shared/planner/schedule'

const group = (groupId: string, teachingMode: string, ...meetings: string[]): ScheduleGroup => ({
  groupId, havura: '', kind: 'ראשית', teachingMode, lecturer: null, room: null,
  slots: meetings.map((meeting) => {
    const [day, range] = meeting.split(' ')
    const [start, end] = range.split('-')
    return { day, start, end }
  }),
})
const course = (courseId: string, ...groups: ScheduleGroup[]): ScheduleCourse =>
  ({ courseId, nameHe: courseId, cYear: 2026, found: true, incompleteData: false, groups })

test('picks one clash-free group per teaching mode and reports the free days it leaves', () => {
  const result = checkTimetable([
    course('A', group('01', 'שיעור', 'א 10:00-12:00'), group('02', 'שיעור', 'ג 10:00-12:00'), group('11', 'תרגיל', 'א 12:00-13:00')),
    course('B', group('01', 'שיעור', 'א 10:00-12:00')),
  ])
  expect(result.feasible).toBe(true)
  // B only fits Sunday 10-12, so A must take its Tuesday lecture; A's recitation touches (not overlaps) B.
  expect(result.selection).toEqual(expect.arrayContaining([
    expect.objectContaining({ courseId: 'A', mode: 'שיעור', groupId: '02' }),
    expect.objectContaining({ courseId: 'A', mode: 'תרגיל', groupId: '11' }),
    expect.objectContaining({ courseId: 'B', mode: 'שיעור', groupId: '01' }),
  ]))
  expect(result.daysUsed).toEqual(['א', 'ג'])
})

test('honors free days and explains which course blocks them', () => {
  const courses = [
    course('A', group('01', 'שיעור', 'ה 10:00-12:00'), group('02', 'שיעור', 'ב 10:00-12:00')),
    course('B', group('01', 'שיעור', 'ה 14:00-16:00')),
  ]
  expect(checkTimetable(courses, ['ה']).feasible).toBe(false)
  expect(checkTimetable(courses, ['ה']).coursesBlockingFreeDays).toEqual(['B'])
  const withoutB = checkTimetable([courses[0]], ['ה'])
  expect(withoutB.feasible).toBe(true)
  expect(withoutB.selection[0].groupId).toBe('02')
})

test('names the course pairs that can never be scheduled together', () => {
  const result = checkTimetable([
    course('A', group('01', 'שיעור', 'ב 10:00-12:00')),
    course('B', group('01', 'שיעור', 'ב 11:00-13:00')),
    course('C', group('01', 'שיעור', 'ד 09:00-11:00')),
  ])
  expect(result.feasible).toBe(false)
  expect(result.conflictingCoursePairs).toEqual([['A', 'B']])
})

test('courses without timetable data are reported, not guessed', () => {
  const result = checkTimetable([
    course('A', group('01', 'שיעור', 'ב 10:00-12:00')),
    { ...course('X'), found: false },
  ])
  expect(result.feasible).toBe(true)
  expect(result.unknownCourseIds).toEqual(['X'])
})

test('check_timetable checks the draft semester against the stored free days', async () => {
  const planContext = {
    semesters: [{ id: 'year_3_semester_a', courses: [{ course_id: 'MAND' }, { course_id: 'ALPHA' }] }],
    total_hours_progress: { known_completed_hours: 177 },
    personal_status: { completed: [], currently_taking: [], planned: [], completed_knowledge: { status: 'known', provenance: 'explicit_user' } },
  }
  const fetchSchedule = jest.fn(async (ids: string[]) => ids.map((id) => id === 'MAND'
    ? course(id, group('01', 'שיעור', 'ו 08:00-10:00'), group('02', 'שיעור', 'ב 08:00-10:00'))
    : course(id, group('01', 'שיעור', 'ב 09:00-11:00'), group('02', 'שיעור', 'ג 09:00-11:00'))))
  const session = new PlanningSession({
    programId: 'test_program_intent_2027',
    programBoard: loadLocalBoardJson('test_program_intent_2027'),
    planContext, committedContext: planContext,
    preferences: { free_days: ['ו'] },
    clarification: { needsClarification: false, missingInputs: [], questions: [] },
    fetchSchedule,
  })
  const tool = buildAgentTools().find((candidate) => candidate.name === 'check_timetable') as unknown as FunctionTool<PlanningSession>
  const output = await tool.invoke(new RunContext(session), JSON.stringify({ semester_id: 'year_3_semester_a', free_days: null }))
  const data = typeof output === 'string' ? JSON.parse(output) : output

  expect(fetchSchedule).toHaveBeenCalledWith(['MAND', 'ALPHA'], expect.any(Number))
  expect(data.feasible).toBe(true)
  expect(data.free_days_requested).toEqual(['ו'])
  expect(data.days_used).toEqual(['ב', 'ג'])
  expect(data.free_days_kept).toContain('ו')
})

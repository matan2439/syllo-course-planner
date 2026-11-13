import { checkTimetable, lockKey } from '../../shared/planner/timetable'
import type { ScheduleCourse, ScheduleGroup } from '../../shared/planner/schedule'

const group = (groupId: string, day: string, start: string, end: string): ScheduleGroup => ({
  groupId, havura: groupId, kind: 'ראשית', teachingMode: 'שיעור', lecturer: null, room: null, slots: [{ day, start, end }],
})
const course = (courseId: string, ...groups: ScheduleGroup[]): ScheduleCourse => ({
  courseId, nameHe: courseId, cYear: 2026, found: true, incompleteData: false, groups,
})
const lock = (target: ScheduleCourse, groupId: string) => ({ [lockKey(target.courseId, target.groups[0])]: groupId })

// A: Sunday or Monday morning. B: Sunday morning (clashes with A-01) or Tuesday.
const A = course('A', group('01', 'א', '08:00', '10:00'), group('02', 'ב', '08:00', '10:00'))
const B = course('B', group('01', 'א', '09:00', '11:00'), group('02', 'ג', '09:00', '11:00'))

describe('a group the student chose is a hard constraint', () => {
  test('the rest of the week is built around the chosen group', () => {
    const result = checkTimetable([A, B], [], lock(A, '01'))
    expect(result.feasible).toBe(true)
    expect(result.selection.find((item) => item.courseId === 'A')?.groupId).toBe('01')
    expect(result.selection.find((item) => item.courseId === 'B')?.groupId).toBe('02')
    expect(result.lockedConflicts).toEqual([])
  })

  test('a chosen group on a free day is kept and reported, never swapped silently', () => {
    const result = checkTimetable([A, B], ['א'], lock(A, '01'))
    expect(result.feasible).toBe(true)
    expect(result.selection.find((item) => item.courseId === 'A')?.groupId).toBe('01')
    expect(result.lockedConflicts).toEqual([{ courseId: 'A', groupId: '01', reason: 'free_day' }])
  })

  test('a chosen group inside a busy time is kept and reported', () => {
    const result = checkTimetable([A], [], lock(A, '01'), [{ day: 'א', start: '09:00', end: '09:30' }])
    expect(result.selection[0].groupId).toBe('01')
    expect(result.lockedConflicts).toEqual([{ courseId: 'A', groupId: '01', reason: 'busy_time' }])
  })

  test('without a lock the free day is still honoured', () => {
    const result = checkTimetable([A, B], ['א'])
    expect(result.selection.map((item) => item.groupId)).toEqual(expect.arrayContaining(['02']))
    expect(result.daysUsed).not.toContain('א')
  })

  test('two chosen groups that overlap are named as the cause', () => {
    const result = checkTimetable([A, B], [], { ...lock(A, '01'), ...lock(B, '01') })
    expect(result.feasible).toBe(false)
    expect(result.lockedClashes).toEqual([['A', 'B']])
    expect(result.conflictingCoursePairs).toEqual([])
  })

  test('a chosen group that leaves no option for another course names that pair', () => {
    const onlySunday = course('C', group('01', 'א', '08:30', '09:30'))
    const result = checkTimetable([A, onlySunday], [], lock(A, '01'))
    expect(result.feasible).toBe(false)
    expect(result.conflictingCoursePairs).toEqual([['A', 'C']])
  })

  test('a lock on a group that no longer exists is ignored', () => {
    const result = checkTimetable([A], [], lock(A, '99'))
    expect(result.feasible).toBe(true)
    expect(result.lockedConflicts).toEqual([])
  })
})

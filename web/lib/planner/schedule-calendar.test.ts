import { buildScheduleCalendar, jerusalemDateTime } from './schedule-calendar'
import type { ScheduleGroup } from '../../../shared/planner/schedule'

const group: ScheduleGroup = { groupId: '01', havura: '1', kind: 'lecture', teachingMode: 'lecture', room: 'A, B; C\\D', lecturer: null, slots: [{ day: 'א', start: '10:00', end: '12:00' }] }
const input = () => ({ programId: 'test', semesterId: 'year_3_semester_a', range: { startDate: '2026-03-22', endDate: '2026-03-29' }, meetings: [{ courseId: 'C1', courseName: 'קורס, מבחן; \\ חדש\nBEGIN:VEVENT', group }], exams: [], now: new Date('2026-01-01T00:00:00Z') })

test('dated occurrences preserve Jerusalem wall time across the DST boundary', () => {
  const calendar = buildScheduleCalendar(input())
  expect(calendar.eventCount).toBe(2)
  expect(calendar.content).toContain('DTSTART:20260322T080000Z\r\n')
  expect(calendar.content).toContain('DTSTART:20260329T070000Z\r\n')
  expect(calendar.content).toContain('X-WR-TIMEZONE:Asia/Jerusalem')
})

test('manual exams use exact dates even after the class range, and never leak from another semester', () => {
  const exam = { id: 'exam1', courseId: 'C1', date: '2026-04-20', start: '09:00', end: '12:00', kind: 'a' as const, semesterId: 'year_3_semester_a' }
  const result = buildScheduleCalendar({ ...input(), meetings: [], exams: [exam, { ...exam, id: 'other', semesterId: 'year_3_semester_b' }] })
  expect(result.eventCount).toBe(1)
  expect(result.content).toContain('DTSTART:20260420T060000Z')
})

test('calendar text cannot inject properties; UTF-8 physical lines fit 75 octets and UIDs stay stable', () => {
  const value = input()
  value.meetings[0].courseName += ' עברית'.repeat(30)
  const result = buildScheduleCalendar(value)
  const unfolded = result.content.replace(/\r\n /g, '')
  expect(unfolded).toContain('SUMMARY:קורס\\, מבחן\\; \\\\ חדש\\nBEGIN:VEVENT')
  expect(result.content.match(/BEGIN:VEVENT\r\n/g)).toHaveLength(2)
  for (const line of result.content.split('\r\n')) expect(Buffer.byteLength(line, 'utf8')).toBeLessThanOrEqual(75)
  expect(buildScheduleCalendar({ ...value, now: new Date('2027-01-01Z') }).content.match(/UID:.*(?:\r\n .*)*/g)).toEqual(result.content.match(/UID:.*(?:\r\n .*)*/g))
})

test('no dates or events are invented for invalid ranges or missing meeting times', () => {
  expect(() => buildScheduleCalendar({ ...input(), range: { startDate: '2026-02-30', endDate: '2026-03-10' } })).toThrow()
  expect(() => buildScheduleCalendar({ ...input(), meetings: [{ ...input().meetings[0], group: { ...group, slots: [] } }] })).toThrow('NO_EVENTS')
})

test('a skipped spring-forward clock time is rejected instead of moved to another hour', () => {
  expect(() => jerusalemDateTime('2026-03-27', '02:30')).toThrow()
})

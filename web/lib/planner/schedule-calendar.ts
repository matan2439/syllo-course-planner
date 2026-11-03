import type { ScheduleGroup } from '../../../shared/planner/schedule'
import { calendarRangeSchema, manualExamSchema, type CalendarRange, type ManualExam } from '../../../shared/planner/student-schedule-tools'

const zone = new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Jerusalem', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })
const parts = (date: Date) => Object.fromEntries(zone.formatToParts(date).map(p => [p.type, p.value]))
/** Resolve each dated occurrence, keeping wall times stable across DST. Reject nonexistent times. */
export function jerusalemDateTime(date: string, time: string): Date {
  if (!/^20\d{2}-\d{2}-\d{2}$/.test(date) || !/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(time)) throw new Error('INVALID_DATE_TIME')
  const wall = Date.parse(`${date}T${time}:00Z`)
  if (!Number.isFinite(wall) || new Date(wall).toISOString().slice(0, 10) !== date) throw new Error('INVALID_DATE_TIME')
  let candidate = wall
  for (let i = 0; i < 4; i++) {
    const p = parts(new Date(candidate))
    const seen = Date.parse(`${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}:00Z`)
    candidate += wall - seen
  }
  const p = parts(new Date(candidate))
  if (`${p.year}-${p.month}-${p.day}` !== date || `${p.hour}:${p.minute}` !== time) throw new Error('NONEXISTENT_LOCAL_TIME')
  return new Date(candidate)
}
const stamp = (date: Date) => date.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z')
const escapeText = (value: string) => value.replace(/\\/g, '\\\\').replace(/\r\n|\r|\n/g, '\\n').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/[\x00-\x08\x0b\x0c\x0e-\x1f]/g, '')
// RFC 5545 content lines: fold by UTF-8 octets, without splitting a code point.
function fold(line: string) {
  const lines: string[] = []; let current = '', bytes = 0
  for (const char of line) {
    const code = char.codePointAt(0)!
    const size = code <= 0x7f ? 1 : code <= 0x7ff ? 2 : code <= 0xffff ? 3 : 4
    if (bytes + size > 75) { lines.push(current); current = ' '; bytes = 1 }
    current += char; bytes += size
  }
  return [...lines, current].join('\r\n')
}
export interface CalendarMeeting { courseId: string; courseName: string; group: ScheduleGroup }
export function buildScheduleCalendar({ programId, semesterId, range, meetings, exams, now = new Date() }: {
  programId: string; semesterId: string; range: CalendarRange; meetings: readonly CalendarMeeting[]; exams: readonly ManualExam[]; now?: Date
}) {
  calendarRangeSchema.parse(range)
  const lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Syllo//Student timetable//HE', 'CALSCALE:GREGORIAN', 'X-WR-TIMEZONE:Asia/Jerusalem']
  let eventCount = 0
  const ids = new Set<string>()
  const event = (identity: string[], date: string, start: string, end: string, title: string, description: string, location = '') => {
    if (start >= end) throw new Error('INVALID_TIME_RANGE')
    const uid = identity.map(encodeURIComponent).join('/') + '@syllo.cc'
    if (ids.has(uid)) return
    ids.add(uid)
    lines.push('BEGIN:VEVENT', `UID:${uid}`, `DTSTAMP:${stamp(now)}`, `DTSTART:${stamp(jerusalemDateTime(date, start))}`, `DTEND:${stamp(jerusalemDateTime(date, end))}`, `SUMMARY:${escapeText(title)}`, `DESCRIPTION:${escapeText(description)}`)
    if (location) lines.push(`LOCATION:${escapeText(location)}`)
    lines.push('END:VEVENT'); eventCount++
  }
  const days = ['א', 'ב', 'ג', 'ד', 'ה', 'ו', 'ש']
  for (let day = Date.parse(range.startDate); day <= Date.parse(range.endDate); day += 86400000) {
    const date = new Date(day).toISOString().slice(0, 10)
    for (const meeting of meetings) for (const slot of meeting.group.slots) {
      if (slot.day !== days[new Date(day).getUTCDay()]) continue
      event([programId, semesterId, meeting.courseId, meeting.group.groupId, date, slot.start], date, slot.start, slot.end,
        meeting.courseName, `${meeting.courseId} · ${meeting.group.kind} · ${meeting.group.havura || meeting.group.groupId}\nSyllo · bid-it (unofficial)`, meeting.group.room ?? '')
    }
  }
  // Finals often fall after the teaching period. Include exact, entered dates in this semester.
  for (const raw of exams) {
    const exam = manualExamSchema.parse(raw)
    if (exam.semesterId !== semesterId) continue
    const name = meetings.find(m => m.courseId === exam.courseId)?.courseName ?? exam.courseId
    event([programId, semesterId, 'exam', exam.id], exam.date, exam.start, exam.end,
      `${name} — ${exam.label || (exam.kind === 'a' ? 'מועד א׳' : exam.kind === 'b' ? 'מועד ב׳' : 'מבחן')}`, 'Syllo · מועד שהוזן ידנית; יש לוודא באתר הרשמי')
  }
  if (!eventCount) throw new Error('NO_EVENTS')
  lines.push('END:VCALENDAR')
  return { content: lines.map(fold).join('\r\n') + '\r\n', eventCount }
}

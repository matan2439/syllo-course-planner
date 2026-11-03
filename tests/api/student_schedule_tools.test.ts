import { busyTimeSchema, manualExamSchema, calendarRangeSchema, busyTimesForSemester, groupBusyConflicts, examWarnings } from '../../shared/planner/student-schedule-tools';

const busy = { id: 'b1', day: 'א' as const, start: '10:00', end: '12:00', label: 'Work' };
const exam = { id: 'e1', courseId: 'C1', date: '2026-12-01', start: '09:00', end: '12:00', kind: 'a' as const, semesterId: 'year_3_semester_a' };
test('busy constraints validate clock boundaries and scope to current or every semester', () => {
  expect(busyTimeSchema.safeParse({ ...busy, start: '24:00' }).success).toBe(false);
  expect(busyTimeSchema.safeParse({ ...busy, end: '10:00' }).success).toBe(false);
  expect(busyTimesForSemester([busy, { ...busy, id: 'other', semesterId: 'year_3_semester_b' }], 'year_3_semester_a')).toEqual([busy]);
  expect(groupBusyConflicts({ slots: [{ day: 'א', start: '12:00', end: '13:00' }] }, [busy])).toEqual([]);
});
test('calendar/exam schemas reject impossible dates, reversed times and oversized ranges', () => {
  expect(manualExamSchema.safeParse({ ...exam, date: '2026-02-29' }).success).toBe(false);
  expect(manualExamSchema.safeParse({ ...exam, start: '13:00' }).success).toBe(false);
  expect(calendarRangeSchema.safeParse({ startDate: '2026-01-01', endDate: '2027-01-02' }).success).toBe(false);
  expect(calendarRangeSchema.safeParse({ startDate: '2026-01-01', endDate: '2027-01-01' }).success).toBe(true);
});
test('exam warnings distinguish same day from short gaps and ignore other semesters/same-course sittings', () => {
  const result = examWarnings([exam, { ...exam, id: 'e2', courseId: 'C2' }, { ...exam, id: 'e3', courseId: 'C3', date: '2026-12-03' }, { ...exam, id: 'e4', semesterId: 'year_3_semester_b' }], exam.semesterId);
  expect(result).toHaveLength(3);
  expect(result[0]).toMatchObject({ kind: 'same_day', days: 0 });
  expect(examWarnings([exam, { ...exam, id: 'sitting2', kind: 'b' }], exam.semesterId)).toEqual([]);
});
test('exam gap threshold is configurable and a null semester compares across the whole plan', () => {
  const later = { ...exam, id: 'e5', courseId: 'C5', date: '2026-12-06' }; // 5 days after `exam`
  expect(examWarnings([exam, later], exam.semesterId, 3)).toEqual([]);
  expect(examWarnings([exam, later], exam.semesterId, 6)).toMatchObject([{ kind: 'short_gap', days: 5 }]);
  const otherTerm = { ...exam, id: 'e6', courseId: 'C6', semesterId: 'year_3_semester_b' };
  expect(examWarnings([exam, otherTerm], exam.semesterId)).toEqual([]);
  expect(examWarnings([exam, otherTerm], null)).toMatchObject([{ kind: 'same_day' }]);
});

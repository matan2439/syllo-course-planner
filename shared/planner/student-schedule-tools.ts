import { z } from 'zod';
import { hasOverlap, type ScheduleGroup } from './schedule';

const identifier = z.string().trim().min(1).max(128).regex(/^[\w:-]+$/);
const time = z.string().regex(/^(?:[01]\d|2[0-3]):[0-5]\d$/);
const date = z.string().regex(/^20\d{2}-\d{2}-\d{2}$/).refine((value) => {
  const parsed = new Date(`${value}T00:00:00Z`);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}, 'Enter a real calendar date');

export const busyTimeSchema = z.object({
  id: identifier, day: z.enum(['א', 'ב', 'ג', 'ד', 'ה', 'ו']), start: time, end: time,
  label: z.string().trim().min(1).max(80), semesterId: identifier.optional(),
}).strict().refine((value) => value.start < value.end, 'End time must follow start time');
export const manualExamSchema = z.object({
  id: identifier, courseId: identifier, date, start: time, end: time,
  kind: z.enum(['a', 'b', 'other']), label: z.string().trim().max(80).optional(), semesterId: identifier,
}).strict().refine((value) => value.start < value.end, 'End time must follow start time');
export const calendarRangeSchema = z.object({ startDate: date, endDate: date }).strict()
  .refine((value) => value.startDate <= value.endDate, 'End date must follow start date')
  .refine((value) => (Date.parse(value.endDate) - Date.parse(value.startDate)) / 86_400_000 < 366, 'Choose at most 366 days');
export type BusyTime = z.infer<typeof busyTimeSchema>;
export type ManualExam = z.infer<typeof manualExamSchema>;
export type CalendarRange = z.infer<typeof calendarRangeSchema>;

export const busyTimesForSemester = (items: readonly BusyTime[], semesterId: string): BusyTime[] =>
  items.filter((item) => !item.semesterId || item.semesterId === semesterId);
export const groupBusyConflicts = (group: Pick<ScheduleGroup, 'slots'>, busy: readonly BusyTime[]): BusyTime[] =>
  busy.filter((item) => group.slots.some((slot) => hasOverlap(slot, item)));

export interface ExamWarning { firstId: string; secondId: string; kind: 'same_day' | 'short_gap'; days: number }
/** Default minimum days between two exams before a short-gap warning (the student can change it). */
export const DEFAULT_EXAM_GAP_DAYS = 3;
/** A/B sittings of the same course are alternatives, not an exam-load conflict. `semesterId` null = all semesters. */
export function examWarnings(exams: readonly ManualExam[], semesterId: string | null, minGapDays = DEFAULT_EXAM_GAP_DAYS): ExamWarning[] {
  const scoped = semesterId === null ? [...exams] : exams.filter((exam) => exam.semesterId === semesterId);
  const warnings: ExamWarning[] = [];
  for (let i = 0; i < scoped.length; i++) for (let j = i + 1; j < scoped.length; j++) {
    if (scoped[i].courseId === scoped[j].courseId) continue;
    const days = Math.abs(Date.parse(scoped[i].date) - Date.parse(scoped[j].date)) / 86_400_000;
    if (days === 0 || days < minGapDays) warnings.push({ firstId: scoped[i].id, secondId: scoped[j].id, kind: days === 0 ? 'same_day' : 'short_gap', days });
  }
  return warnings;
}

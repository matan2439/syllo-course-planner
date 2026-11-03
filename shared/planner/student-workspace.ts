import { z } from 'zod';
import { biddingDraftSchema, createEmptyBiddingDraft } from './bidding';
import { biddingRoundSnapshotSchema } from './bidding-rounds';
import { savedCourseSearchSchema } from './catalog-searches';
import { courseNoteSchema, MAX_COURSE_NOTES } from './course-notes';
import { busyTimeSchema, manualExamSchema, calendarRangeSchema } from './student-schedule-tools';

const identifier = z.string().trim().min(1).max(128).regex(/^[\w:-]+$/);
export const programIdSchema = z.string().min(1).max(128).regex(/^[A-Za-z0-9_-]+$/);
export const completedStudiesSchema = z.object({
  priorHours: z.number().min(0).max(400).nullable(),
  categoryCounts: z.record(identifier, z.number().int().min(0).max(50)).refine((v) => Object.keys(v).length <= 40),
}).strict();
export type CompletedStudies = z.infer<typeof completedStudiesSchema>;
export const weeklyScheduleSchema = z.object({
  termMapping: z.record(identifier, z.object({ year: z.number().int().min(2000).max(2200), semester: z.union([z.literal(1), z.literal(2)]) }).strict()).refine((v) => Object.keys(v).length <= 40),
  selections: z.record(z.string().max(200), z.array(identifier).max(20)).refine((v) => Object.keys(v).length <= 600),
  freeDays: z.array(z.enum(['א', 'ב', 'ג', 'ד', 'ה', 'ו'])).max(6),
  busyTimes: z.array(busyTimeSchema).max(50).optional(),
  exams: z.array(manualExamSchema).max(100).optional(),
  calendarRange: calendarRangeSchema.optional(),
  /** Warn when two exams are fewer than this many days apart. */
  examGapDays: z.number().int().min(1).max(14).optional(),
}).strict();
export type SavedWeeklySchedule = z.infer<typeof weeklyScheduleSchema>;
export const savedPlanSchema = z.object({
  id: identifier.min(8), name: z.string().trim().min(1).max(80), notes: z.string().max(2000).default(''),
  catalogVersion: z.string().max(200).nullable().default(null),
  createdAt: z.number().int().nonnegative(), updatedAt: z.number().int().nonnegative(),
  semesters: z.array(z.object({ semesterId: identifier, courseIds: z.array(identifier).max(150) }).strict()).min(1).max(40)
    .refine((s) => new Set(s.map((x) => x.semesterId)).size === s.length, 'Duplicate semester'),
  weeklySchedule: weeklyScheduleSchema,
  bidding: biddingDraftSchema.optional(),
  biddingRounds: z.array(biddingRoundSnapshotSchema).max(20).refine((rows) => new Set(rows.map((row) => row.id)).size === rows.length, 'Duplicate round snapshot').optional(),
}).strict();
export type SavedPlan = z.infer<typeof savedPlanSchema>;
export const programWorkspaceSchema = z.object({
  plans: z.array(savedPlanSchema).max(30).default([]),
  activePlanId: identifier.min(8).optional(),
  bidding: biddingDraftSchema.default(() => createEmptyBiddingDraft()),
  biddingRounds: z.array(biddingRoundSnapshotSchema).max(20).refine((rows) => new Set(rows.map((row) => row.id)).size === rows.length, 'Duplicate round snapshot').optional(),
  courseSearches: z.array(savedCourseSearchSchema).max(15).refine((rows) => new Set(rows.map((row) => row.id)).size === rows.length, 'Duplicate saved search').optional(),
  /** Private course/lecturer notes (see course-notes.ts for the community-ready shape). */
  courseNotes: z.array(courseNoteSchema).max(MAX_COURSE_NOTES).refine((rows) => new Set(rows.map((row) => row.id)).size === rows.length, 'Duplicate note').optional(),
  /** Profile facts not tied to named courses: hours done outside the list, unnamed courses per category (e.g. שער רוח). */
  completedStudies: completedStudiesSchema.optional(),
}).strict().refine((value) => new Set(value.plans.map((p) => p.id)).size === value.plans.length, 'Duplicate plan id');
export type ProgramWorkspace = z.infer<typeof programWorkspaceSchema>;
export const preferencesSchema = z.object({ locale: z.enum(['he', 'en']) }).strict();

export const workspaceWriteSchema = z.discriminatedUnion('scope', [
  z.object({ scope: z.literal('preferences'), expected_revision: z.number().int().nonnegative(), data: preferencesSchema }).strict(),
  z.object({ scope: z.literal('program'), program_id: programIdSchema, expected_revision: z.number().int().nonnegative(), data: programWorkspaceSchema }).strict(),
]);
export const restorePlanSchema = z.object({
  action: z.literal('restore'), program_id: programIdSchema, plan_id: identifier,
  expected_board_version: z.string().regex(/^bv_\d+$/).nullable(),
  idempotency_key: z.string().min(8).max(200),
}).strict();
export const shareBidsSchema = z.object({
  action: z.literal('share'), program_id: programIdSchema,
  consent: z.boolean(), draft: biddingDraftSchema,
}).strict();

export const EMPTY_WEEKLY_SCHEDULE: SavedWeeklySchedule = { termMapping: {}, selections: {}, freeDays: [] };

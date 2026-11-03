import { z } from 'zod';

/**
 * A student's note about a course or one of its lecturers, stored in their own workspace document.
 * 'community' notes are also published, anonymously, to a shared store other students read
 * (publish/withdraw actions on the student-workspace endpoint; signed-in authors only).
 */
export const COURSE_NOTE_KINDS = ['experience', 'tip', 'update'] as const;
export const courseNoteSchema = z.object({
  id: z.string().trim().min(8).max(128).regex(/^[\w:-]+$/),
  courseId: z.string().trim().min(1).max(128).regex(/^[\w:-]+$/),
  /** Absent = about the course; set = about this lecturer in this course. */
  lecturer: z.string().trim().min(1).max(80).optional(),
  kind: z.enum(COURSE_NOTE_KINDS),
  body: z.string().trim().min(1).max(1000),
  visibility: z.enum(['private', 'community']),
  createdAt: z.number().int().nonnegative(),
  updatedAt: z.number().int().nonnegative(),
}).strict();
export type CourseNote = z.infer<typeof courseNoteSchema>;
// ponytail: notes share the workspace document's 650 KB request cap; a separate table when notes go community.
export const MAX_COURSE_NOTES = 100;

export const notesForCourse = (notes: readonly CourseNote[], courseId: string): CourseNote[] =>
  notes.filter((note) => note.courseId === courseId).sort((a, b) => b.updatedAt - a.updatedAt);

/** What other students see: no author, no owner key — only an opaque id to report by. */
export interface CommunityCourseNote {
  id: string
  courseId: string
  kind: CourseNote['kind']
  lecturer?: string
  body: string
  updatedAt: number
  mine: boolean
  reported: boolean
}
/** A hidden note as a developer reviews it. */
export interface HiddenCommunityNote { id: string; courseId: string; kind: CourseNote['kind']; lecturer?: string; body: string; reports: number; hiddenAt: number }
/** Reports from distinct signed-in students that hide a note until a developer reviews it. */
export const COMMUNITY_NOTE_HIDE_AFTER_REPORTS = 3;
export const publishNoteSchema = z.object({
  action: z.literal('publish_note'), note: courseNoteSchema.omit({ visibility: true, createdAt: true, updatedAt: true }),
}).strict();
export const withdrawNoteSchema = z.object({ action: z.literal('withdraw_note'), note_id: courseNoteSchema.shape.id }).strict();
export const reportNoteSchema = z.object({ action: z.literal('report_note'), public_id: z.string().uuid() }).strict();
export const moderateNoteSchema = z.object({
  action: z.literal('moderate_note'), public_id: z.string().uuid(), decision: z.enum(['restore', 'remove']),
}).strict();

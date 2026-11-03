import { z } from 'zod';

/**
 * A student's personal note about a course or one of its lecturers.
 *
 * Today every note is private (visibility 'private'), stored in the student's own workspace
 * document and validated with it on the server. The shape is the one a community layer would
 * need later — a subject (course or lecturer), a kind, and timestamps — so notes can be
 * promoted into a moderated, aggregated store by adding 'community' to `visibility` and a
 * moderation record keyed by note id, without migrating existing notes.
 */
export const COURSE_NOTE_KINDS = ['experience', 'tip', 'update'] as const;
export const courseNoteSchema = z.object({
  id: z.string().trim().min(8).max(128).regex(/^[\w:-]+$/),
  courseId: z.string().trim().min(1).max(128).regex(/^[\w:-]+$/),
  /** Absent = about the course; set = about this lecturer in this course. */
  lecturer: z.string().trim().min(1).max(80).optional(),
  kind: z.enum(COURSE_NOTE_KINDS),
  body: z.string().trim().min(1).max(1000),
  visibility: z.literal('private'),
  createdAt: z.number().int().nonnegative(),
  updatedAt: z.number().int().nonnegative(),
}).strict();
export type CourseNote = z.infer<typeof courseNoteSchema>;
// ponytail: notes share the workspace document's 650 KB request cap; a separate table when notes go community.
export const MAX_COURSE_NOTES = 100;

export const notesForCourse = (notes: readonly CourseNote[], courseId: string): CourseNote[] =>
  notes.filter((note) => note.courseId === courseId).sort((a, b) => b.updatedAt - a.updatedAt);

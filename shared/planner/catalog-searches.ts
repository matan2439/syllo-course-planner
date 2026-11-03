import { z } from 'zod'

const unique = (values: readonly string[]) => new Set(values).size === values.length
export const savedCourseSearchFiltersSchema = z.object({
  categoryIds: z.array(z.string().min(1).max(128)).max(100).refine(unique, 'Duplicate category').optional(),
  semesters: z.array(z.enum(['a', 'b', 'summer', 'unknown'])).max(4).refine(unique, 'Duplicate semester').optional(),
  assessments: z.array(z.enum(['exam', 'take_home', 'project', 'assignment', 'lab', 'mixed', 'no_exam', 'unknown'])).max(8).refine(unique, 'Duplicate assessment').optional(),
  minGrade: z.number().finite().min(0).max(100).optional(),
  maxGrade: z.number().finite().min(0).max(100).optional(),
  includeUnknownGrades: z.boolean().optional(),
  favoritesOnly: z.boolean().optional(),
  sort: z.enum(['catalog', 'name', 'grade-desc', 'grade-asc', 'hours-asc', 'hours-desc']).optional(),
}).strict().refine((filters) => filters.minGrade == null || filters.maxGrade == null || filters.minGrade <= filters.maxGrade, 'Invalid grade interval')

/** Account-owned search criteria; favorite course ids always remain outside this payload. */
export const savedCourseSearchSchema = z.object({
  id: z.string().min(8).max(128).regex(/^[\w:-]+$/),
  name: z.string().trim().min(1).max(80),
  query: z.string().max(300),
  filters: savedCourseSearchFiltersSchema,
}).strict()

export type SavedCourseSearch = z.infer<typeof savedCourseSearchSchema>

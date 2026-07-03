/**
 * View-model adapter for the board JSON contract shared by /api/board and
 * data/parsed_json/*.json — the exact shape the canonical static planner
 * consumes. Pure presentation mapping: totals and difficulty come from the
 * data as-is; no planner logic or credit/hour calculation lives here.
 */

export const SEMESTER_ORDER = [
  'year_3_semester_a',
  'year_3_semester_b',
  'year_4_semester_a',
  'year_4_semester_b',
] as const

// The data ships English display_name; the product is Hebrew-first
// (same localization the canonical planner applies itself).
const SEMESTER_TITLES_HE: Record<string, string> = {
  year_3_semester_a: 'שנה ג׳ — סמסטר א׳',
  year_3_semester_b: 'שנה ג׳ — סמסטר ב׳',
  year_4_semester_a: 'שנה ד׳ — סמסטר א׳',
  year_4_semester_b: 'שנה ד׳ — סמסטר ב׳',
}

type RawCourse = {
  course_id: string
  name_he: string
  weekly_hours: number | null
  course_type: string
  difficulty_level: string | null
  syllabus_url: string | null
  validation_status?: string
  warnings?: string[]
}

type RawSemester = {
  semester_id: string
  display_name: string
  courses: RawCourse[]
  total_weekly_hours: number | null
  average_difficulty: number | null
  warnings?: string[]
}

export type RawBoard = {
  semesters: RawSemester[]
  metadata?: Record<string, unknown>
  summary?: { total_courses?: number }
}

export type CourseVM = {
  id: string
  name: string
  weeklyHours: number | null
  type: string
  difficulty: string | null
  syllabusUrl: string | null
  hasWarnings: boolean
}

export type SemesterVM = {
  id: string
  title: string
  totalWeeklyHours: number | null
  averageDifficulty: number | null
  warnings: string[]
  courses: CourseVM[]
}

export type BoardVM = { semesters: SemesterVM[] }

/** Calm counts for the /plan hub — data-shipped, no planner calculation. */
export function planOverview(raw: RawBoard): {
  plannedCourses: number
  semesterCount: number
} {
  return {
    plannedCourses:
      raw.summary?.total_courses ??
      raw.semesters.reduce((n, s) => n + (s.courses?.length ?? 0), 0),
    semesterCount: raw.semesters.length,
  }
}

function adaptCourse(c: RawCourse): CourseVM {
  return {
    id: c.course_id,
    name: c.name_he,
    weeklyHours: c.weekly_hours,
    type: c.course_type,
    difficulty: c.difficulty_level,
    syllabusUrl: c.syllabus_url,
    hasWarnings: (c.warnings?.length ?? 0) > 0 || c.validation_status === 'error',
  }
}

export function adaptBoard(raw: RawBoard): BoardVM {
  const rank = (id: string) => {
    const i = (SEMESTER_ORDER as readonly string[]).indexOf(id)
    return i === -1 ? SEMESTER_ORDER.length : i
  }
  const semesters = [...raw.semesters]
    .sort((a, b) => rank(a.semester_id) - rank(b.semester_id))
    .map((s) => ({
      id: s.semester_id,
      title: SEMESTER_TITLES_HE[s.semester_id] ?? s.display_name,
      totalWeeklyHours: s.total_weekly_hours,
      averageDifficulty: s.average_difficulty,
      warnings: s.warnings ?? [],
      courses: (s.courses ?? []).map(adaptCourse),
    }))
  return { semesters }
}

/**
 * View-model adapter for metadata.program_repository_courses from the board
 * JSON contract (same file the canonical planner consumes). Pure presentation
 * mapping — no selection, eligibility, or requirement logic.
 */
import type { RawBoard } from './board'

type RawRepoCourse = {
  course_id: string
  name_he: string | null
  weekly_hours: number | null
  category_id: string | null
  program_category_name_he: string | null
  offered_semesters: string[] | null
  difficulty_level: string | null
  syllabus_url: string | null
  is_mandatory?: boolean
}

export type RepoCourseVM = {
  id: string
  name: string
  weeklyHours: number | null
  offered: string[]
  difficulty: string | null
  syllabusUrl: string | null
}

export type RepoCategoryVM = {
  id: string
  title: string
  courses: RepoCourseVM[]
}

export type RepositoryVM = {
  categories: RepoCategoryVM[]
  totalCourses: number
}

export function adaptRepository(raw: RawBoard): RepositoryVM {
  const courses = (raw.metadata?.program_repository_courses ??
    []) as RawRepoCourse[]

  const categories: RepoCategoryVM[] = []
  const byId = new Map<string, RepoCategoryVM>()

  for (const c of courses) {
    const catId = c.category_id ?? 'uncategorized'
    let cat = byId.get(catId)
    if (!cat) {
      cat = {
        id: catId,
        title: c.program_category_name_he ?? 'קורסים נוספים',
        courses: [],
      }
      byId.set(catId, cat)
      categories.push(cat) // first-appearance order, as shipped by the data
    }
    cat.courses.push({
      id: c.course_id,
      // Real data has rows with name_he: null — never let null reach the UI
      name: c.name_he ?? `קורס ${c.course_id}`,
      weeklyHours: c.weekly_hours,
      offered: c.offered_semesters ?? [],
      difficulty: c.difficulty_level,
      syllabusUrl: c.syllabus_url,
    })
  }

  return { categories, totalCourses: courses.length }
}

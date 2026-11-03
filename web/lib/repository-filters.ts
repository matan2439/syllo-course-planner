import type { AssessmentKind, RepoCategoryVM, RepoCourseVM, RepositoryVM } from './repository'
import { rankCourseMatches, scoreCourseMatch } from '../../shared/search/course-name-match'

export type RepositorySort = 'catalog' | 'name' | 'grade-desc' | 'grade-asc' | 'hours-asc' | 'hours-desc'
export type RepositoryFilters = {
  categoryIds?: readonly string[]
  semesters?: readonly string[]
  assessments?: readonly AssessmentKind[]
  minGrade?: number
  maxGrade?: number
  includeUnknownGrades?: boolean
  favoritesOnly?: boolean
  favoriteIds?: readonly string[]
  sort?: RepositorySort
}

export function repositorySemester(value: string): string {
  const term = value.toLowerCase().trim()
  if (term === 'a' || term.endsWith('_semester_a')) return 'a'
  if (term === 'b' || term.endsWith('_semester_b')) return 'b'
  if (['summer', 'קיץ', 'c'].includes(term)) return 'summer'
  return term
}

function compareCourse(a: RepoCourseVM, b: RepoCourseVM, sort: RepositorySort) {
  if (sort === 'name') return a.name.localeCompare(b.name, 'he') || a.id.localeCompare(b.id)
  const grade = sort.startsWith('grade')
  const left = grade ? a.gradeSummary?.mean : a.weeklyHours
  const right = grade ? b.gradeSummary?.mean : b.weeklyHours
  if (left == null && right == null) return 0
  if (left == null) return 1
  if (right == null) return -1
  return sort.endsWith('desc') ? right - left : left - right
}

/** OR within each filter, AND between filters; missing data never counts as a zero. */
export function filterRepository(repo: RepositoryVM, rawQuery: string, filters: RepositoryFilters = {}): RepoCategoryVM[] {
  const query = rawQuery.trim()
  const gradeActive = filters.minGrade != null || filters.maxGrade != null
  const active = filters.categoryIds?.length || filters.semesters?.length || filters.assessments?.length || gradeActive || filters.favoritesOnly || (filters.sort && filters.sort !== 'catalog')
  if (!query && !active) return repo.categories
  const favorites = new Set(filters.favoriteIds)
  return repo.categories.filter((category) => !filters.categoryIds?.length || filters.categoryIds.includes(category.id)).map((category) => {
    const titleHit = query && scoreCourseMatch(query, category.title) > 0
    const searched = !query || titleHit ? category.courses : rankCourseMatches(query, category.courses, (course) => course.name, (course) => course.id).map((match) => match.item)
    const courses = searched.filter((course) => {
      if (filters.favoritesOnly && !favorites.has(course.id)) return false
      if (filters.assessments?.length && !filters.assessments.includes(course.assessment?.kind ?? 'unknown')) return false
      if (filters.semesters?.length) {
        const offered = course.offered.map(repositorySemester)
        if (!filters.semesters.some((semester) => semester === 'unknown' ? offered.length === 0 : offered.includes(repositorySemester(semester)))) return false
      }
      if (gradeActive) {
        const mean = course.gradeSummary?.mean
        if (mean == null || !Number.isFinite(mean)) return filters.includeUnknownGrades === true
        if (mean < (filters.minGrade ?? 0) || mean > (filters.maxGrade ?? 100)) return false
      }
      return true
    })
    if (filters.sort && filters.sort !== 'catalog') courses.sort((a, b) => compareCourse(a, b, filters.sort!))
    return { ...category, courses }
  }).filter((category) => category.courses.length > 0)
}

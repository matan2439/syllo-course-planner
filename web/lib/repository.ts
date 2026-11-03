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
  effective_allowed_semesters?: string[] | null
  assessment_type?: string | null
  assessment_text_raw?: string | null
  syllabus_assessment_he?: string | null
  syllabus_source_url?: string | null
  grade_signal?: {
    average_grade?: number | null
    num_students_total?: number | null
    years_available?: number[] | null
    source_name?: string | null
    source_url?: string | null
  } | null
}

export type AssessmentKind = 'exam' | 'take_home' | 'project' | 'assignment' | 'lab' | 'mixed' | 'no_exam' | 'unknown'
export type RepositoryAssessment = { kind: AssessmentKind; text: string | null; sourceUrl: string | null }
export type RepositoryGradeSummary = {
  mean: number
  students: number | null
  /** A board-only signal may list years without individual semester counts. */
  terms: number | null
  years?: number[]
  sources: Array<{ label: string; url: string | null; snapshotAt?: string | null }>
}

export type RepoCourseVM = {
  id: string
  name: string
  weeklyHours: number | null
  offered: string[]
  difficulty: string | null
  syllabusUrl: string | null
  allowedSemesterIds?: string[]
  assessment?: RepositoryAssessment
  gradeSummary?: RepositoryGradeSummary | null
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

function assessmentOf(course: RawRepoCourse): RepositoryAssessment {
  const text = course.assessment_text_raw?.trim() || course.syllabus_assessment_he?.trim() || null
  const explicit = course.assessment_type as AssessmentKind
  const known: AssessmentKind[] = ['exam', 'take_home', 'project', 'assignment', 'lab', 'mixed', 'no_exam']
  let kind: AssessmentKind = known.includes(explicit) ? explicit : 'unknown'
  if (kind === 'unknown' && text) {
    // The official heading identifies the final assessment. Remove the standard
    // "additional assignments may be required" footer before recognizing types.
    const finalText = text.replace(/ייתכנו מטלות נוספות[^|]*|Students may be required to submit additional assignments[^|]*/gi, '')
    const noExam = /(?:ללא|אין)\s+(?:בחינה|מבחן)|no\s+(?:final\s+)?exam/i.test(finalText)
    const examText = finalText.replace(/(?:ללא|אין)\s+(?:בחינה|מבחן)|no\s+(?:final\s+)?exam/gi, '')
    const takeHome = /בחינת?\s+בית|take[ -]?home/i.test(examText)
    const exam = !takeHome && /בחינ[הת]|מבחן|\bexam\b/i.test(examText)
    const project = /פרו?י+קט|\bproject\b/i.test(finalText)
    const lab = /דו[״"']?ח\s+מעבדה|דוח מעבדה|lab(?:oratory)?\s+report/i.test(finalText)
    const assignment = /עבוד[הת]\s+(?:בית|סיכום|מסכמת)|מטלה מסכמת|final\s+(?:paper|assignment)|homework/i.test(finalText)
    const kinds: AssessmentKind[] = [takeHome && 'take_home', exam && 'exam', project && 'project', lab && 'lab', assignment && 'assignment'].filter(Boolean) as AssessmentKind[]
    kind = kinds.length > 1 ? 'mixed' : kinds[0] ?? (noExam ? 'no_exam' : 'unknown')
  }
  return { kind, text, sourceUrl: course.syllabus_source_url ?? course.syllabus_url ?? null }
}

function boardGradeOf(course: RawRepoCourse): RepositoryGradeSummary | null {
  const signal = course.grade_signal
  const mean = signal?.average_grade
  if (typeof mean !== 'number' || !Number.isFinite(mean) || mean < 0 || mean > 100) return null
  const students = signal?.num_students_total
  return {
    mean,
    students: typeof students === 'number' && Number.isInteger(students) && students > 0 ? students : null,
    terms: null,
    years: (signal?.years_available ?? []).filter((year) => Number.isInteger(year)),
    sources: signal?.source_name ? [{ label: signal.source_name, url: signal.source_url ?? null }] : [],
  }
}

export function adaptRepository(raw: RawBoard, gradeSummaries: Readonly<Record<string, RepositoryGradeSummary | null>> = {}): RepositoryVM {
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
      ...(Array.isArray(c.effective_allowed_semesters) ? { allowedSemesterIds: c.effective_allowed_semesters } : {}),
      assessment: assessmentOf(c),
      gradeSummary: gradeSummaries[c.course_id] ?? boardGradeOf(c),
    })
  }

  return { categories, totalCourses: courses.length }
}
